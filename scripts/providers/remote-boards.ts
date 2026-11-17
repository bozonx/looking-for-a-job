/**
 * Площадки удалённой работы с открытым JSON API без ключа:
 * - Himalayas — https://himalayas.app/jobs/api/search (поиск, 20 на страницу);
 * - Remotive — https://remotive.com/api/remote-jobs (задержка ~24 ч, не чаще 4 раз в день; ссылка на Remotive обязательна);
 * - Jobicy — https://jobicy.com/api/v2/remote-jobs (ссылка на Jobicy обязательна).
 * Ссылка на площадку — в source_url и в теле каждой вакансии. Настройки — config/sources.yaml.
 */
import { eachTolerant, fetchJson } from '../lib/http.ts';

/** страница поиска Himalayas */
const HIMALAYAS_PAGE = 20;
/** запросы Himalayas, чья выдача уже кончилась, — дальше не запрашиваем */
const himalayasDone = new Set<string>();
import { makeJob, normEmployment, sourceConfig, toMs } from '../lib/job.ts';
import type { Provider, RawJob } from '../lib/collect.ts';

const byDate = (a: RawJob, b: RawJob) => (b.postedAt ?? 0) - (a.postedAt ?? 0);
const PERIOD: Record<string, 'year' | 'month' | 'hour'> = { annual: 'year', yearly: 'year', year: 'year', monthly: 'month', month: 'month', hourly: 'hour', hour: 'hour' };

/** Ссылка на отклик, если она ведёт не на саму площадку. */
const external = (url: string | null | undefined, board: RegExp) => (url && !board.test(url) ? url : null);

/* ---------------- Himalayas ---------------- */

function himalayasRaw(j: any): RawJob {
  const url: string = j.guid ?? j.applicationLink;
  const slug = String(url).replace(/[?#].*$/, '').split('/').filter(Boolean);
  const cur = j.currency ?? 'USD';
  return makeJob({
    extId: `${j.companySlug ?? slug.at(-3) ?? ''}-${slug.at(-1)}`,
    postedAt: toMs(j.pubDate),
    title: j.title,
    company: j.companyName,
    tags: [...(j.categories ?? []), ...(j.seniority ?? [])],
    sourceName: 'Himalayas',
    geo: { allowedCountries: j.locationRestrictions },
    sourceUrl: url,
    applyUrl: external(j.applicationLink, /himalayas\.app/i),
    location: j.locationRestrictions?.length ? j.locationRestrictions.join(', ') : 'Worldwide',
    salary: j.minSalary || j.maxSalary ? { min: j.minSalary || null, max: j.maxSalary || null, currency: cur, period: PERIOD[j.salaryPeriod] ?? 'year' } : null,
    employment: normEmployment(j.employmentType),
    extra: {
      Seniority: (j.seniority ?? []).join(', '),
      'Location restrictions': j.locationRestrictions?.join(', ') || 'none',
      'Timezones (UTC)': j.timezoneRestrictions?.length ? j.timezoneRestrictions.join(', ') : null,
    },
    html: j.description,
  });
}

function himalayasParse(input: unknown): RawJob[] {
  const jobs = (input as any)?.jobs;
  if (!Array.isArray(jobs)) throw new Error('Himalayas API: unexpected response');
  return jobs.filter((j: any) => j.title && (j.guid || j.applicationLink)).map(himalayasRaw);
}

export const himalayas: Provider = {
  source: 'himalayas',
  paginated: true,
  parse: himalayasParse,
  async fetchPage(page) {
    const queries = sourceConfig<{ queries?: string[] }>('himalayas')?.queries ?? ['javascript'];
    if (page === 0) himalayasDone.clear();
    const all = new Map<string, RawJob>();
    await eachTolerant('himalayas: запрос', queries.filter((q) => !himalayasDone.has(q)), async (q) => {
      const url = `https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}&sort=recent&page=${page + 1}`;
      const list = himalayasParse(await fetchJson(url));
      if (list.length < HIMALAYAS_PAGE) himalayasDone.add(q);
      for (const j of list) all.set(j.extId, j);
    });
    return [...all.values()].sort(byDate);
  },
};

/* ---------------- Remotive ---------------- */

function remotiveParse(input: unknown): RawJob[] {
  const jobs = (input as any)?.jobs;
  if (!Array.isArray(jobs)) throw new Error('Remotive API: unexpected response');
  return jobs
    .filter((j: any) => j.id && j.title && j.url)
    .map((j: any) =>
      makeJob({
        extId: j.id,
        postedAt: toMs(j.publication_date ? `${j.publication_date}Z` : null),
        title: j.title,
        company: j.company_name,
        // теги Remotive шумные (".Net, android, apache…") — в предфильтр не отдаём, только в тело
        tags: [],
        sourceName: 'Remotive',
        sourceUrl: j.url,
        location: j.candidate_required_location || null,
        employment: normEmployment(j.job_type),
        extra: { Category: j.category, Salary: j.salary, 'Candidate location': j.candidate_required_location, Tags: (j.tags ?? []).join(', ') },
        html: j.description,
      }),
    )
    .sort(byDate);
}

export const remotive: Provider = {
  source: 'remotive',
  paginated: false,
  // условия Remotive: не чаще 4 запросов в день; данные и так обновляются раз в сутки
  minIntervalHours: 6,
  parse: remotiveParse,
  async fetchPage(page) {
    if (page > 0) return [];
    const cats = sourceConfig<{ categories?: string[] }>('remotive')?.categories ?? ['software-dev'];
    // minIntervalHours считается на источник, а каждая категория — отдельный запрос: больше одной — превышение лимита
    if (cats.length > 1) throw new Error('config/sources.yaml: remotive.categories — не больше одной категории (лимит 4 запроса в день)');
    const out: RawJob[] = [];
    await eachTolerant('remotive: категория', cats, async (c) => {
      out.push(...remotiveParse(await fetchJson(`https://remotive.com/api/remote-jobs?category=${encodeURIComponent(c)}`)));
    });
    return out.sort(byDate);
  },
};

/* ---------------- Jobicy ---------------- */

function jobicyParse(input: unknown): RawJob[] {
  const jobs = (input as any)?.jobs;
  if (!Array.isArray(jobs)) throw new Error('Jobicy API: unexpected response');
  return jobs
    .filter((j: any) => j.id && j.jobTitle && j.url)
    .map((j: any) =>
      makeJob({
        extId: j.id,
        postedAt: toMs(j.pubDate),
        title: j.jobTitle,
        company: j.companyName,
        tags: [...(j.jobIndustry ?? []), j.jobLevel].filter(Boolean),
        sourceName: 'Jobicy',
        sourceUrl: j.url,
        location: j.jobGeo || null,
        salary: j.salaryMin || j.salaryMax ? { min: j.salaryMin || null, max: j.salaryMax || null, currency: j.salaryCurrency || 'USD', period: PERIOD[j.salaryPeriod] ?? 'year' } : null,
        employment: normEmployment(j.jobType),
        extra: { Level: j.jobLevel, Geo: j.jobGeo },
        html: j.jobDescription,
      }),
    )
    .sort(byDate);
}

export const jobicy: Provider = {
  source: 'jobicy',
  paginated: false,
  parse: jobicyParse,
  async fetchPage(page) {
    if (page > 0) return [];
    const inds = sourceConfig<{ industries?: string[] }>('jobicy')?.industries ?? ['dev'];
    const out = new Map<string, RawJob>();
    await eachTolerant('jobicy: отрасль', inds, async (ind) => {
      for (const j of jobicyParse(await fetchJson(`https://jobicy.com/api/v2/remote-jobs?count=100&industry=${encodeURIComponent(ind)}`))) out.set(j.extId, j);
    });
    return [...out.values()].sort(byDate);
  },
};
