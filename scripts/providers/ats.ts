/**
 * Системы найма компаний (Greenhouse, Lever, Ashby): публичные API без ключа.
 * Это первоисточник: закрытая вакансия исчезает из списка → possibly_closed (snapshot).
 * Список компаний — секция `ats` в config/sources.yaml. extId = <ats>-<slug>-<id вакансии>.
 */
import { fetchJson } from '../lib/http.ts';
import { makeJob, normEmployment, sourceConfig, toMs } from '../lib/job.ts';
import { safeExtId, type Provider, type RawJob } from '../lib/collect.ts';

type AtsName = 'greenhouse' | 'lever' | 'ashby';
/** список слагов или словарь «слаг: название компании» (Lever и Ashby название не отдают) */
type AtsConfig = Partial<Record<AtsName, string[] | Record<string, string | null>>>;

const NAMES: Record<AtsName, string> = { greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby' };

const scope = (ats: AtsName, slug: string) => safeExtId(`${ats}-${slug}`);

/** Ответ API одной компании → вакансии. Компания — по слагу, если API не отдаёт название. */
function parseCompany(ats: AtsName, slug: string, json: any, title?: string | null): RawJob[] {
  const ext = (id: string | number) => `${scope(ats, slug)}-${safeExtId(id)}`;
  const name = (n?: string | null) => n || title || slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  if (ats === 'greenhouse') {
    return ((json?.jobs ?? []) as any[]).map((j) =>
      makeJob({
        extId: ext(j.id),
        postedAt: toMs(j.first_published ?? j.updated_at),
        title: j.title,
        company: name(j.company_name),
        tags: (j.departments ?? []).map((d: any) => d.name),
        sourceName: NAMES[ats],
        sourceUrl: j.absolute_url,
        applyUrl: j.absolute_url,
        location: j.location?.name ?? null,
        extra: { Department: (j.departments ?? []).map((d: any) => d.name).join(', '), Offices: (j.offices ?? []).map((o: any) => o.location || o.name).join('; ') },
        // content приходит HTML-экранированным: &lt;div&gt; — makeJob → turndown понимает только настоящий HTML
        html: String(j.content ?? '')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, '&'),
      }),
    );
  }

  if (ats === 'lever') {
    if (!Array.isArray(json)) throw new Error('Lever: unexpected response');
    return (json as any[]).map((j) => {
      const c = j.categories ?? {};
      const lists = (j.lists ?? []).map((l: any) => `<h3>${l.text}</h3>${l.content}`).join('');
      return makeJob({
        extId: ext(j.id),
        postedAt: toMs(j.createdAt),
        title: j.text,
        company: name(null),
        tags: [c.team, c.department].filter(Boolean),
        sourceName: NAMES[ats],
        sourceUrl: j.hostedUrl,
        applyUrl: j.applyUrl ?? j.hostedUrl,
        location: (c.allLocations?.length ? c.allLocations.join('; ') : c.location) ?? null,
        employment: normEmployment(c.commitment),
        geo: { workplace: j.workplaceType, officeCountry: j.country },
        extra: { Workplace: j.workplaceType, Country: j.country, Team: [c.department, c.team].filter(Boolean).join(' / ') },
        html: `${j.description ?? ''}${lists}${j.additional ?? ''}`,
      });
    });
  }

  // ashby
  return ((json?.jobs ?? []) as any[])
    .filter((j) => j.isListed !== false)
    .map((j) => {
      const comp = j.compensation?.scrapeableCompensationSalarySummary ?? j.compensation?.compensationTierSummary;
      const locs = [j.location, ...(j.secondaryLocations ?? []).map((l: any) => l.location)].filter(Boolean);
      return makeJob({
        extId: ext(j.id),
        postedAt: toMs(j.publishedAt),
        title: j.title,
        company: name(null),
        tags: [j.department, j.team].filter(Boolean),
        sourceName: NAMES[ats],
        sourceUrl: j.jobUrl,
        applyUrl: j.applyUrl ?? j.jobUrl,
        location: locs.join('; ') || null,
        employment: normEmployment(j.employmentType),
        extra: { Workplace: j.workplaceType ?? (j.isRemote ? 'Remote' : null), Compensation: comp, Team: [j.department, j.team].filter(Boolean).join(' / ') },
        html: j.descriptionHtml,
      });
    });
}

const URLS: Record<AtsName, (slug: string) => string> = {
  greenhouse: (s) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(s)}/jobs?content=true`,
  lever: (s) => `https://api.lever.co/v0/postings/${encodeURIComponent(s)}?mode=json`,
  ashby: (s) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(s)}?includeCompensation=true`,
};

function companies(): [AtsName, string, string | null][] {
  const cfg = sourceConfig<AtsConfig>('ats') ?? {};
  return (Object.keys(URLS) as AtsName[]).flatMap((a) => {
    const v = cfg[a] ?? [];
    const pairs = Array.isArray(v) ? v.map((s) => [String(s), null] as const) : Object.entries(v);
    return pairs.map(([slug, title]) => [a, slug, title ?? null] as [AtsName, string, string | null]);
  });
}

/** Для --file: { "<ats>": { "<slug>": <ответ API> } }. */
function parse(input: unknown): RawJob[] {
  const out: RawJob[] = [];
  const titles = new Map(companies().map(([a, s, t]) => [`${a}/${s}`, t]));
  for (const [ats, bySlug] of Object.entries((input ?? {}) as Record<string, Record<string, unknown>>)) {
    if (!(ats in URLS)) throw new Error(`ats --file: неизвестная система "${ats}"`);
    for (const [slug, json] of Object.entries(bySlug)) out.push(...parseCompany(ats as AtsName, slug, json, titles.get(`${ats}/${slug}`)));
  }
  return out;
}

const covered = new Set<string>();
let warnings: string[] = [];

export const ats: Provider = {
  source: 'ats',
  paginated: false,
  snapshot: true,
  parse,
  covers: (extId) => [...covered].some((s) => extId.startsWith(`${s}-`)),
  takeWarnings: () => warnings.splice(0),
  async fetchPage(page) {
    if (page > 0) return [];
    covered.clear();
    const list = companies();
    if (!list.length) throw new Error('config/sources.yaml: секция ats пуста');
    const out: RawJob[] = [];
    for (const [i, [a, slug, title]] of list.entries()) {
      try {
        out.push(...parseCompany(a, slug, await fetchJson(URLS[a](slug)), title));
        covered.add(scope(a, slug));
      } catch (e) {
        warnings.push(`ats ${a}/${slug}: ${(e as Error).message} — проверь слаг в config/sources.yaml`);
      }
    }
    if (!covered.size) throw new Error('ни одна компания из секции ats не ответила');
    return out;
  },
};
