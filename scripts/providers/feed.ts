/**
 * Стандартные ленты: RSS 2.0, Atom 1.0 и JSON Feed (https://jsonfeed.org).
 * Каждая лента из секции `feeds` в config/sources.yaml становится отдельным источником.
 * У одной ленты может быть несколько URL (категории площадки) — элементы сливаются, свежие первыми.
 */
import { XMLParser } from 'fast-xml-parser';
import { fetchText, sleep } from '../lib/http.ts';
import { jobPosting } from '../lib/jsonld.ts';
import { htmlToMarkdown } from '../lib/html.ts';
import { decodeEntities, makeJob, normEmployment, sourceConfig, stripTags, toMs } from '../lib/job.ts';
import type { Provider, RawJob } from '../lib/collect.ts';

export interface FeedConfig {
  id: string;
  name?: string;
  urls: string[];
  title_format?: 'company: title' | 'title at company' | 'title';
  location_field?: string;
  company_field?: string;
  tags_field?: string;
  employment_field?: string;
  /** регулярка по заголовку с именованными группами title / company / location (вместо title_format) */
  title_regex?: string;
  /** регулярка по тексту описания (без HTML, абзац = строка) с группами company / location — когда площадка пишет их в описание */
  description_regex?: string;
  /**
   * в ленте обрезанное описание: для прошедших предфильтр грузить страницу вакансии и брать полный текст
   * из schema.org JobPosting (ld+json); не нашлось — остаётся описание из ленты
   */
  full_page?: boolean;
}

/** Элемент ленты в общем виде, независимо от формата. */
export interface FeedItem {
  id: string;
  title: string;
  link: string;
  date: number | null;
  html: string;
  author: string | null;
  categories: string[];
  /** все простые поля элемента (для location_field и т.п.) */
  fields: Record<string, string>;
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  cdataPropName: false,
  processEntities: true,
  htmlEntities: true,
  isArray: (name) => ['item', 'entry', 'category', 'link'].includes(name),
});

const arr = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** Текст узла XML: строка, число или объект с #text. */
function txt(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return txt(v[0]);
  if (typeof v === 'object') return txt((v as Record<string, unknown>)['#text']);
  return '';
}

function simpleFields(o: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    const t = txt(v);
    if (t && !k.startsWith('@_')) out[k] = t;
  }
  return out;
}

/** Разбор текста ленты любого поддерживаемого формата. */
export function parseFeed(input: unknown): FeedItem[] {
  // JSON Feed
  const json = typeof input === 'string' && input.trimStart().startsWith('{') ? JSON.parse(input) : input;
  if (json && typeof json === 'object' && Array.isArray((json as any).items) && String((json as any).version ?? '').includes('jsonfeed')) {
    return ((json as any).items as any[]).map((it) => ({
      id: String(it.id ?? it.url),
      title: String(it.title ?? ''),
      link: String(it.url ?? it.external_url ?? ''),
      date: toMs(it.date_published ?? it.date_modified),
      html: String(it.content_html ?? it.content_text ?? it.summary ?? ''),
      author: it.authors?.[0]?.name ?? it.author?.name ?? null,
      categories: arr(it.tags).map(String),
      fields: simpleFields(it),
    }));
  }
  if (typeof input !== 'string') throw new Error('лента: ожидается XML или JSON Feed');
  const doc = xml.parse(input);

  // RSS 2.0
  const channel = doc?.rss?.channel ?? doc?.['rdf:RDF'];
  if (channel) {
    const items = arr(channel.item ?? doc?.['rdf:RDF']?.item) as Record<string, unknown>[];
    return items.map((it) => {
      const link = txt(it.link) || txt(it.guid);
      return {
        id: txt(it.guid) || link,
        title: txt(it.title),
        link,
        date: toMs(txt(it.pubDate) || txt(it['dc:date'])),
        html: txt(it['content:encoded']) || txt(it.description),
        author: txt(it['dc:creator']) || txt(it.author) || null,
        categories: arr(it.category as unknown[]).map(txt).filter(Boolean),
        fields: simpleFields(it),
      };
    });
  }

  // Atom 1.0
  const feed = doc?.feed;
  if (feed) {
    return (arr(feed.entry) as Record<string, any>[]).map((e) => {
      const links = arr(e.link) as Record<string, string>[];
      const alt = links.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate') ?? links[0];
      return {
        id: txt(e.id) || alt?.['@_href'] || '',
        title: txt(e.title),
        link: alt?.['@_href'] ?? '',
        date: toMs(txt(e.published) || txt(e.updated)),
        html: txt(e.content) || txt(e.summary),
        author: txt(e.author?.name) || null,
        categories: arr(e.category as Record<string, string>[]).map((c) => c['@_term'] ?? txt(c)).filter(Boolean),
        fields: simpleFields(e),
      };
    });
  }
  throw new Error('лента: не RSS, Atom или JSON Feed');
}

function splitTitle(raw: string, fmt: FeedConfig['title_format']): { title: string; company: string | null } {
  const t = decodeEntities(raw);
  if (fmt === 'company: title') {
    const i = t.indexOf(': ');
    if (i > 0) return { company: t.slice(0, i), title: t.slice(i + 2) };
  }
  if (fmt === 'title at company') {
    const m = t.match(/^(.*)\s+at\s+(.+)$/i);
    if (m) return { title: m[1]!, company: m[2]! };
  }
  return { title: t, company: null };
}

/** Короткий стабильный id элемента: хвост ссылки/guid. */
function itemExtId(it: FeedItem): string {
  const s = (it.id || it.link).replace(/[?#].*$/, '').replace(/\/+$/, '');
  return s.split('/').pop()!.slice(-80) || String(Math.abs(hash(s)));
}

/** Текст описания построчно: абзацы и <br> — переводы строк, внутри строки — как stripTags. */
function textLines(html: string): string {
  return html
    .split(/<\/p>|<br\s*\/?>|<\/li>|<\/h\d>|\n/i)
    .map((l) => stripTags(l))
    .filter(Boolean)
    .join('\n');
}

/** Ссылка без utm-меток (иначе одна вакансия из разных лент даёт разные URL). */
function cleanLink(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (k.startsWith('utm_')) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

export function feedProvider(cfg: FeedConfig): Provider {
  const name = cfg.name ?? cfg.id;
  const titleRe = cfg.title_regex ? new RegExp(cfg.title_regex, 'u') : null;
  const descRe = cfg.description_regex ? new RegExp(cfg.description_regex, 'u') : null;
  const toRaw = (it: FeedItem): RawJob | null => {
    if (!it.title || !/^https?:/.test(it.link)) return null;
    const tg = titleRe ? decodeEntities(it.title).match(titleRe)?.groups : undefined;
    const dg = descRe ? textLines(it.html).match(descRe)?.groups : undefined;
    const split = splitTitle(it.title, cfg.title_format);
    const title = tg?.title?.trim() || split.title;
    const company = tg?.company?.trim() || dg?.company?.trim() || split.company;
    const location = tg?.location?.trim() || dg?.location?.trim() || null;
    const f = (k?: string) => (k ? decodeEntities(it.fields[k]) || null : null);
    const tags = cfg.tags_field ? (f(cfg.tags_field) ?? '').split(/,\s*|\s+and\s+/).filter(Boolean) : it.categories;
    const job = makeJob({
      extId: itemExtId(it),
      postedAt: it.date,
      title,
      company: f(cfg.company_field) ?? company ?? it.author ?? 'Unknown',
      tags,
      sourceName: name,
      sourceUrl: cleanLink(it.link),
      location: f(cfg.location_field) ?? location,
      employment: normEmployment(f(cfg.employment_field)),
      extra: cfg.tags_field ? { Skills: f(cfg.tags_field) } : undefined,
      html: it.html,
    });
    if (!cfg.full_page) return job;
    const short = job.build;
    job.build = async () => {
      const base = await short();
      try {
        await sleep(500);
        const jp = jobPosting(await fetchText(base.data.source_url!));
        if (!jp?.description) return base;
        // шапка (заголовок, Source, доп. поля) — из ленты, описание — полное со страницы
        const head = base.body.split('\n\n').slice(0, 2).join('\n\n');
        return {
          data: { ...base.data, location: base.data.location ?? jp.location, employment: base.data.employment !== 'unknown' ? base.data.employment : jp.employment },
          body: `${head}\n\n${jp.location ? `- **Location:** ${jp.location}\n\n` : ''}${htmlToMarkdown(jp.description)}\n`,
        };
      } catch {
        return base; // страница не открылась — хватит и описания из ленты
      }
    };
    return job;
  };
  const parse = (input: unknown): RawJob[] =>
    parseFeed(input)
      .map(toRaw)
      .filter((x): x is RawJob => !!x);
  return {
    source: cfg.id,
    paginated: false,
    parse,
    async fetchPage(page) {
      if (page > 0) return [];
      const all = new Map<string, RawJob>();
      for (const [i, url] of cfg.urls.entries()) {
        if (i > 0) await sleep(500);
        for (const j of parse(await fetchText(url, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml, */*' } })))
          all.set(j.extId, j);
      }
      return [...all.values()].sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0));
    },
  };
}

/** Провайдеры для всех лент из config/sources.yaml. */
export function feedProviders(): Record<string, Provider> {
  const out: Record<string, Provider> = {};
  for (const cfg of sourceConfig<FeedConfig[]>('feeds') ?? []) {
    if (!/^[a-z0-9-]+$/.test(cfg.id)) throw new Error(`config/sources.yaml: id ленты "${cfg.id}" — только a-z, 0-9, дефис`);
    if (!cfg.urls?.length) throw new Error(`config/sources.yaml: у ленты ${cfg.id} нет urls`);
    out[cfg.id] = feedProvider(cfg);
  }
  return out;
}
