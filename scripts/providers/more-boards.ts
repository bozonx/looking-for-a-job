/**
 * Ещё площадки без ключа и без защиты от ботов:
 * - Working Nomads — JSON https://www.workingnomads.com/api/exposed_jobs/ (последние ~30–50 вакансий всех категорий);
 * - Landing.jobs — JSON https://landing.jobs/api/v1/jobs (все активные, Европа/Португалия, snapshot);
 * - Y Combinator — HTML https://www.ycombinator.com/jobs/... : список и страница вакансии отдают JSON
 *   в атрибуте data-page (Inertia), разбор вёрстки не нужен; snapshot.
 * Настройки — config/sources.yaml.
 */
import { fetchJson, fetchText, sleep } from '../lib/http.ts';
import { makeJob, normEmployment, sourceConfig, stripTags, toMs } from '../lib/job.ts';
import type { Provider, RawJob } from '../lib/collect.ts';

const byDate = (a: RawJob, b: RawJob) => (b.postedAt ?? 0) - (a.postedAt ?? 0);

/* ---------------- Working Nomads ---------------- */

function workingnomadsParse(input: unknown): RawJob[] {
  if (!Array.isArray(input)) throw new Error('Working Nomads API: unexpected response');
  const cats = sourceConfig<{ categories?: string[] }>('workingnomads')?.categories ?? ['Development'];
  return (input as any[])
    .filter((j) => j.url && j.title)
    .map((j) =>
      makeJob({
        // url вида https://www.workingnomads.com/job/go/2019516/
        extId: String(j.url).match(/\/(\d+)\/?$/)?.[1] ?? j.url,
        postedAt: toMs(j.pub_date),
        title: j.title,
        company: j.company_name,
        tags: String(j.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean),
        sourceName: 'Working Nomads',
        sourceUrl: j.url,
        location: j.location || null,
        extra: { Category: j.category_name, Tags: j.tags },
        html: j.description,
        skip: cats.includes(j.category_name) ? null : `категория ${j.category_name}`,
      }),
    )
    .sort(byDate);
}

export const workingnomads: Provider = {
  source: 'workingnomads',
  paginated: false,
  parse: workingnomadsParse,
  async fetchPage(page) {
    if (page > 0) return [];
    return workingnomadsParse(await fetchJson('https://www.workingnomads.com/api/exposed_jobs/'));
  },
};

/* ---------------- Landing.jobs ---------------- */

const LJ_PAGE = 50;

function landingjobsParse(input: unknown): RawJob[] {
  if (!Array.isArray(input)) throw new Error('Landing.jobs API: unexpected response');
  const officeCountries = sourceConfig<{ office_countries?: string[] }>('landingjobs')?.office_countries ?? [];
  return (input as any[])
    .filter((j) => j.id && j.title && j.url)
    .map((j) => {
      const locs = ((j.locations ?? []) as { city?: string; country_code?: string }[]).map((l) => [l.city, l.country_code].filter(Boolean).join(', '));
      const office = !j.remote && !(j.locations ?? []).some((l: any) => officeCountries.includes(l.country_code));
      const html = [
        j.role_description,
        j.main_requirements && `<h3>Requirements</h3>${j.main_requirements}`,
        j.nice_to_have && `<h3>Nice to have</h3>${j.nice_to_have}`,
        j.perks && `<h3>Perks</h3>${j.perks}`,
      ]
        .filter(Boolean)
        .join('');
      return makeJob({
        extId: j.id,
        postedAt: toMs(j.published_at),
        title: j.title,
        // название компании есть только в url: /at/<company>/<job>
        company: String(j.url).match(/\/at\/([^/]+)\//)?.[1]?.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ?? 'Unknown',
        tags: j.tags ?? [],
        sourceName: 'Landing.jobs',
        sourceUrl: j.url,
        location: [j.remote ? 'Remote' : null, ...locs].filter(Boolean).join('; ') || null,
        salary: j.gross_salary_low || j.gross_salary_high ? { min: j.gross_salary_low || null, max: j.gross_salary_high || null, currency: j.currency_code || 'EUR', period: 'year' } : null,
        employment: normEmployment(j.type),
        extra: { Remote: j.remote ? 'yes' : 'no', 'Relocation paid': j.relocation_paid ? 'yes' : null, Expires: j.expires_at },
        html,
        skip: office ? 'офис вне office_countries (не удалённая)' : null,
      });
    })
    .sort(byDate);
}

export const landingjobs: Provider = {
  source: 'landingjobs',
  paginated: false,
  snapshot: true,
  covers: () => true,
  parse: landingjobsParse,
  async fetchPage(page) {
    if (page > 0) return [];
    const all: RawJob[] = [];
    for (let offset = 0; offset < 2000; offset += LJ_PAGE) {
      if (offset) await sleep(500);
      const list = await fetchJson(`https://landing.jobs/api/v1/jobs?limit=${LJ_PAGE}&offset=${offset}`);
      if (!Array.isArray(list) || !list.length) break;
      all.push(...landingjobsParse(list));
      if (list.length < LJ_PAGE) break;
    }
    return all;
  },
};

/* ---------------- Y Combinator (Work at a Startup) ---------------- */

const YC = 'https://www.ycombinator.com';

/** JSON из атрибута data-page страницы ycombinator.com (Inertia). */
function dataPage(html: string): any {
  const m = html.match(/data-page="([^"]+)"/);
  if (!m) throw new Error('YC: на странице нет data-page (сменилась вёрстка?)');
  return JSON.parse(unescapeHtml(m[1]!)).props;
}

/** HTML-сущности без схлопывания пробелов (описание YC — markdown с переводами строк). */
function unescapeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** «11 months» / «3 days» → примерная дата публикации, мс. */
function agoMs(s: string | null | undefined): number | null {
  const m = String(s ?? '').match(/(\d+)\s*(minute|hour|day|week|month|year)/i);
  if (!m) return null;
  const unit = { minute: 60e3, hour: 3600e3, day: 86400e3, week: 7 * 86400e3, month: 30 * 86400e3, year: 365 * 86400e3 }[m[2]!.toLowerCase() as 'day'];
  return Date.now() - Number(m[1]) * unit;
}

function ycRaw(j: any): RawJob {
  const url = `${YC}${j.url}`;
  const raw = makeJob({
    extId: j.id,
    postedAt: agoMs(j.createdAt),
    title: j.title,
    company: j.companyName,
    tags: [j.roleSpecificType, ...(j.skills ?? []).map((s: any) => (typeof s === 'string' ? s : s?.name))].filter(Boolean),
    sourceName: 'Y Combinator Jobs',
    sourceUrl: url,
    location: j.location || null,
    employment: normEmployment(j.type),
    markdown: '',
  });
  // описание — на странице вакансии; грузим лениво, только для прошедших предфильтр
  raw.build = async () => {
    await sleep(500);
    const p = dataPage(await fetchText(url));
    const job = p.job ?? {};
    const c = p.company ?? {};
    const lines = [
      ['Company', `${c.name ?? j.companyName}${c.batch_name ? ` (YC ${c.batch_name})` : ''} — ${c.one_liner ?? j.companyOneLiner ?? ''}`],
      ['Website', c.website],
      ['Company location', [c.location, c.country].filter(Boolean).join(', ')],
      ['Team size', c.team_size],
      ['Salary', job.salaryRange],
      ['Equity', job.equityRange],
      ['Experience', job.minExperience],
      ['Visa', job.visa],
      ['Posted', `${job.createdAt ?? j.createdAt} ago`],
    ]
      .filter(([, v]) => v != null && String(v).trim() !== '')
      .map(([k, v]) => `- **${k}:** ${v}`);
    const title = stripTags(j.title);
    const company = stripTags(j.companyName);
    const body =
      `# ${title} — ${company}\n\nSource: [Y Combinator Jobs](${url})\n\n${lines.join('\n')}\n\n` +
      `${unescapeHtml(String(job.description ?? ''))}\n` +
      (job.interview_process ? `\n## Interview process\n\n${unescapeHtml(String(job.interview_process))}\n` : '');
    const base = await makeJob({ extId: j.id, postedAt: agoMs(j.createdAt), title, company, sourceName: 'Y Combinator Jobs', sourceUrl: url, location: j.location || null, employment: normEmployment(j.type) }).build();
    return { data: { ...base.data, company_country: typeof c.country === 'string' && /^[A-Z]{2}$/.test(c.country) ? c.country : null }, body };
  };
  return raw;
}

function ycParse(input: unknown): RawJob[] {
  const props = typeof input === 'string' ? dataPage(input) : (input as any)?.props ?? input;
  const list = props?.jobPostings;
  if (!Array.isArray(list)) throw new Error('YC: нет jobPostings');
  return list.filter((j: any) => j.id && j.title && j.url).map(ycRaw);
}

export const yc: Provider = {
  source: 'yc',
  paginated: false,
  snapshot: true,
  covers: () => true,
  parse: ycParse,
  async fetchPage(page) {
    if (page > 0) return [];
    const paths = sourceConfig<{ pages?: string[] }>('yc')?.pages ?? ['/jobs/role/software-engineer/remote'];
    const all = new Map<string, RawJob>();
    for (const [i, p] of paths.entries()) {
      if (i > 0) await sleep(1000);
      for (const j of ycParse(await fetchText(`${YC}${p}`))) all.set(j.extId, j);
    }
    return [...all.values()];
  },
};
