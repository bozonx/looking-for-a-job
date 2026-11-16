/**
 * Площадки СНГ (без ключа, без браузера):
 * - hh — HeadHunter (hh.kz, hh.uz, rabota.by, hh.kg, hh.az — одна база). API api.hh.ru без регистрации
 *   приложения закрыт (403), но страница поиска отдаёт выдачу JSON-ом в <template id="HH-Lux-InitialState">.
 *   Фильтр — регионы hh (area) и формат «удалённо»; описание — schema.org JobPosting на странице вакансии.
 * - getmatch — JSON https://getmatch.ru/api/offers (все активные, свежие сверху; поиска нет —
 *   не удалённые отсеиваются до предфильтра).
 * - geekjob — JSON https://geekjob.ru/json/find/vacancy (все активные, по 100 на страницу);
 *   описание и точная дата — JobPosting на странице вакансии.
 * Настройки — config/sources.yaml (секции hh, getmatch, geekjob).
 */
import { fetchJson, fetchText, warn } from '../lib/http.ts';
import { decodeEntities, makeJob, sourceConfig, toMs } from '../lib/job.ts';
import { jobPosting } from '../lib/jsonld.ts';
import { htmlToMarkdown } from '../lib/html.ts';
import type { Provider, RawJob, VacancyData } from '../lib/collect.ts';

const byDate = (a: RawJob, b: RawJob) => (b.postedAt ?? 0) - (a.postedAt ?? 0);

/** Описание — со страницы вакансии (JobPosting), только для прошедших предфильтр. */
function withFullPage(source: string, job: RawJob, url: string, fallbackLocation: string | null): RawJob {
  const short = job.build;
  job.build = async () => {
    const base = await short();
    try {
      const jp = jobPosting(await fetchText(url));
      if (!jp?.description) {
        warn(`${source}: на странице ${url} нет JobPosting с описанием`);
        return base;
      }
      const head = base.body.split('\n\n').slice(0, 2).join('\n\n');
      const location = base.data.location ?? jp.location ?? fallbackLocation;
      return {
        data: {
          ...base.data,
          location,
          employment: base.data.employment !== 'unknown' ? base.data.employment : jp.employment,
          posted_at: base.data.posted_at ?? (jp.datePosted ? String(jp.datePosted).slice(0, 10) : null),
        },
        body: `${head}\n\n${location ? `- **Location:** ${location}\n\n` : ''}${htmlToMarkdown(jp.description)}\n`,
      };
    } catch (e) {
      warn(`${source}: страница ${url} не загрузилась (${(e as Error).message})`);
      return base;
    }
  };
  return job;
}

/* ---------------- HeadHunter (СНГ) ---------------- */

interface HhConfig {
  /** поисковые запросы (text) */
  queries?: string[];
  /** id регионов hh: 40 Казахстан, 97 Узбекистан, 16 Беларусь, 48 Кыргызстан, 9 Азербайджан, 28 Грузия, 1001 другие */
  areas?: string[];
  /** только «удалённо» (work_format=REMOTE) */
  remote_only?: boolean;
  /** домен для запросов и ссылок (база общая) */
  host?: string;
}

const HH_PAGE = 50;
const HH_COUNTRIES: Record<string, string> = { '40': 'Казахстан', '97': 'Узбекистан', '16': 'Беларусь', '48': 'Кыргызстан', '9': 'Азербайджан', '28': 'Грузия', '113': 'Россия', '5': 'Украина' };
const PERIOD: Record<string, string> = { MONTH: 'month', YEAR: 'year', HOUR: 'hour', DAY: 'day', WEEK: 'week' };

function hhState(html: string): any {
  const m = html.match(/<template[^>]*id="HH-Lux-InitialState"[^>]*>([\s\S]*?)<\/template>/);
  if (!m) throw new Error('hh: на странице нет HH-Lux-InitialState (капча или сменилась вёрстка?)');
  const raw = m[1]!.replace(/&(#x[0-9a-f]+|#\d+|quot|lt|gt|amp|apos);/gi, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ({ quot: '"', lt: '<', gt: '>', amp: '&', apos: "'" } as Record<string, string>)[e.toLowerCase()]!,
  );
  return JSON.parse(raw);
}

function hhParse(input: unknown): RawJob[] {
  const state = typeof input === 'string' ? hhState(input) : input;
  const list = (state as any)?.vacancySearchResult?.vacancies;
  if (!Array.isArray(list)) throw new Error('hh: нет vacancySearchResult.vacancies');
  return list
    .filter((v: any) => v.vacancyId && v.name)
    .map((v: any) => {
      const url = String(v.links?.desktop ?? `https://hh.kz/vacancy/${v.vacancyId}`);
      const formats: string[] = (v.workFormats ?? []).flatMap((f: any) => f.workFormatsElement ?? []);
      const remote = formats.includes('REMOTE');
      const countryId = String(v.area?.path ?? '').split('.')[1] ?? '';
      const country = HH_COUNTRIES[countryId];
      const city = v.area?.name;
      const place = [city, country && country !== city ? country : null].filter(Boolean).join(', ');
      const location = [remote ? 'Remote' : null, place || null].filter(Boolean).join('; ') || null;
      const c = v.compensation ?? {};
      const salary: VacancyData['salary'] =
        (c.from || c.to) && c.currencyCode
          ? { min: c.from ?? null, max: c.to ?? null, currency: c.currencyCode === 'RUR' ? 'RUB' : c.currencyCode, period: PERIOD[c.mode] ?? 'month' }
          : null;
      const employment = v.employmentForm === 'FULL' ? 'full-time' : v.employmentForm === 'PROJECT' ? 'contract' : 'unknown';
      const job = makeJob({
        extId: v.vacancyId,
        postedAt: toMs(v.publicationTime?.$ ?? v.creationTime),
        title: v.name,
        company: v.company?.visibleName ?? v.company?.name ?? 'Unknown',
        sourceName: 'HeadHunter',
        sourceUrl: url,
        location,
        salary,
        employment,
        extra: { 'Формат': formats.join(', ') || null, 'Опыт': v.workExperience, 'Зарплата': salary ? `${salary.min ?? ''}–${salary.max ?? ''} ${salary.currency}${c.gross ? ' до вычета' : ''}` : null },
        html: '',
      });
      return withFullPage('hh', job, url, location);
    })
    .sort(byDate);
}

export const hh: Provider = {
  source: 'hh',
  paginated: true,
  parse: hhParse,
  pageDelayMs: 2000,
  async fetchPage(page) {
    const cfg = sourceConfig<HhConfig>('hh') ?? {};
    const host = cfg.host ?? 'hh.kz';
    const all = new Map<string, RawJob>();
    for (const q of cfg.queries ?? ['vue']) {
      const p = new URLSearchParams({ text: q, order_by: 'publication_time', items_on_page: String(HH_PAGE), page: String(page) });
      for (const a of cfg.areas ?? []) p.append('area', a);
      if (cfg.remote_only !== false) p.append('work_format', 'REMOTE');
      const state = hhState(await fetchText(`https://${host}/search/vacancy?${p}`));
      const found = state?.vacancySearchResult?.totalResults ?? 0;
      if (page * HH_PAGE >= found) continue; // hh на странице за концом повторяет последнюю
      for (const j of hhParse(state)) all.set(j.extId, j);
    }
    return [...all.values()].sort(byDate);
  },
};

/* ---------------- getmatch ---------------- */

const GM = 'https://getmatch.ru';
const GM_PAGE = 50;

function getmatchParse(input: unknown): RawJob[] {
  const list = (input as any)?.offers;
  if (!Array.isArray(list)) throw new Error('getmatch API: нет offers (сменился API?)');
  const remoteOk = sourceConfig<{ remote_only?: boolean }>('getmatch')?.remote_only !== false;
  return list
    .filter((o: any) => o.id && o.position && o.is_active !== false)
    .map((o: any) => {
      const reqs: any[] = o.location_requirements ?? [];
      const remote = reqs.some((r) => r.format === 'remote' && !r.exclude);
      const places = (o.location_items ?? []).filter((l: any) => !l.exclude).map((l: any) => `${l.label}${l.format ? ` (${l.format})` : ''}`);
      const url = `${GM}${o.url}`;
      const salary: VacancyData['salary'] =
        !o.salary_hidden && (o.salary_display_from || o.salary_display_to) && o.salary_currency
          ? { min: o.salary_display_from ?? null, max: o.salary_display_to ?? null, currency: o.salary_currency === 'RUR' ? 'RUB' : o.salary_currency, period: 'month' }
          : null;
      return makeJob({
        extId: o.id,
        postedAt: toMs(o.published_at ? `${o.published_at}Z` : null),
        title: o.position,
        company: o.company?.name ?? 'Unknown',
        tags: (o.skills_objects ?? []).map((s: any) => s?.name ?? s).filter((s: unknown) => typeof s === 'string'),
        sourceName: 'getmatch',
        sourceUrl: url,
        location: [remote ? 'Remote' : null, ...places].filter(Boolean).join('; ') || null,
        salary,
        extra: { 'Локации': places.join('; ') || null, 'Английский': o.english_level?.name ?? o.english_level, 'Зарплата': o.salary_description },
        html: o.description_html || o.offer_description || '',
        skip: remoteOk && !remote ? 'не удалённая' : null,
      });
    })
    .sort(byDate);
}

export const getmatch: Provider = {
  source: 'getmatch',
  paginated: true,
  parse: getmatchParse,
  async fetchPage(page) {
    return getmatchParse(await fetchJson(`${GM}/api/offers?offset=${page * GM_PAGE}&limit=${GM_PAGE}`));
  },
};

/* ---------------- GeekJob ---------------- */

const GJ = 'https://geekjob.ru';
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «16 ноября» (без года) → мс; дата в будущем → прошлый год. */
function ruDate(s: string | null | undefined, now = Date.now()): number | null {
  const m = String(s ?? '').trim().match(/^(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?/i);
  const mon = m ? MONTHS.indexOf(m[2]!.toLowerCase()) : -1;
  if (!m || mon < 0) return null;
  const y = m[3] ? Number(m[3]) : new Date(now).getUTCFullYear();
  let t = Date.UTC(y, mon, Number(m[1]), 12);
  if (!m[3] && t > now + 86400e3) t = Date.UTC(y - 1, mon, Number(m[1]), 12);
  return t;
}

function geekjobParse(input: unknown): RawJob[] {
  const list = (input as any)?.data;
  if (!Array.isArray(list)) throw new Error('geekjob API: нет data (сменился API?)');
  const remoteOk = sourceConfig<{ remote_only?: boolean }>('geekjob')?.remote_only !== false;
  return list
    .filter((j: any) => j.id && j.position && !j.log?.archived)
    .map((j: any) => {
      const f = j.jobFormat ?? {};
      const place = [j.city, j.country].filter(Boolean).join(', ');
      const location = [f.remote ? 'Remote' : null, place || null].filter(Boolean).join('; ') || null;
      const url = `${GJ}/vacancy/${j.id}`;
      const job = makeJob({
        extId: j.id,
        postedAt: ruDate(j.log?.modify),
        title: j.position,
        company: j.company?.name ?? 'Unknown',
        sourceName: 'GeekJob',
        sourceUrl: url,
        location,
        extra: { 'Зарплата': decodeEntities(j.salary) || null, 'Релокация': f.relocate ? 'да' : null, 'Частичная занятость': f.parttime ? 'да' : null },
        html: '',
        skip: remoteOk && !f.remote ? 'не удалённая' : null,
      });
      return withFullPage('geekjob', job, url, location);
    })
    .sort(byDate);
}

export const geekjob: Provider = {
  source: 'geekjob',
  paginated: true,
  parse: geekjobParse,
  async fetchPage(page) {
    const res = (await fetchJson(`${GJ}/json/find/vacancy?page=${page + 1}`)) as any;
    if (page + 1 > Number(res?.pagecount ?? 1) || !res?.data?.length) return [];
    return geekjobParse(res);
  },
};
