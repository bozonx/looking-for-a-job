/**
 * Get on Board (Латинская Америка): публичный API без ключа, https://www.getonbrd.com/api/v0.
 * Вакансии по категориям, свежие первыми. Не-удалённые вне стран из настроек отсеиваются (skip).
 * Настройки — секция `getonbrd` в config/sources.yaml.
 */
import { eachTolerant, fetchJson } from '../lib/http.ts';
import { makeJob, sourceConfig, toMs } from '../lib/job.ts';
import type { Provider, RawJob } from '../lib/collect.ts';

interface Cfg {
  categories?: string[];
  remote?: string[];
  office_countries?: string[];
}

const PER_PAGE = 50;
/** категории, чья лента уже кончилась (неполная страница) — дальше их страницы не запрашиваем */
const exhausted = new Set<string>();
const cfg = (): Required<Cfg> => {
  const c = sourceConfig<Cfg>('getonbrd') ?? {};
  return { categories: c.categories ?? ['programming'], remote: c.remote ?? ['fully_remote', 'remote_local'], office_countries: c.office_countries ?? ['Argentina'] };
};

const LANG: Record<string, string> = { lang_en: 'en', lang_es: 'es', lang_pt: 'pt' };

function toRaw(d: any, c: Required<Cfg>): RawJob {
  const a = d.attributes ?? {};
  const company = a.company?.data?.attributes?.name ?? 'Unknown';
  const tags = (a.tags?.data ?? []).map((t: any) => t.attributes?.name).filter(Boolean);
  const countries: string[] = a.countries ?? [];
  const modality: string = a.remote_modality ?? (a.remote ? 'fully_remote' : 'no_remote');
  const ok = c.remote.includes(modality) || countries.some((x) => c.office_countries.includes(x));
  const url = d.links?.public_url ?? `https://www.getonbrd.com/jobs/${d.id}`;
  const section = (h: string | undefined, html: string | undefined) => (html ? `<h3>${h ?? ''}</h3>${html}` : '');
  return makeJob({
    extId: d.id,
    postedAt: toMs(a.published_at),
    title: a.title,
    company,
    tags,
    sourceName: 'Get on Board',
    sourceUrl: url,
    location: [modality.replace(/_/g, ' '), countries.join(', ')].filter(Boolean).join(' · '),
    salary: a.min_salary || a.max_salary ? { min: a.min_salary || null, max: a.max_salary || null, currency: 'USD', period: 'month' } : null,
    extra: { 'Remote modality': modality, Countries: countries.join(', '), Language: LANG[a.lang] ?? null, Applications: a.applications_count },
    html:
      section(a.functions_headline, a.functions) +
      section(a.description_headline, a.description) +
      section(a.desirable_headline, a.desirable) +
      section(a.benefits_headline, a.benefits) +
      section('Company / projects', a.projects),
    skip: ok ? null : `формат ${modality} (${countries.join(', ') || '—'})`,
  });
}

function parse(input: unknown): RawJob[] {
  const data = (input as any)?.data;
  if (!Array.isArray(data)) throw new Error('Get on Board API: unexpected response');
  const c = cfg();
  return data.map((d) => toRaw(d, c));
}

export const getonbrd: Provider = {
  source: 'getonbrd',
  paginated: true,
  parse,
  async fetchPage(page) {
    if (page === 0) exhausted.clear();
    const out: RawJob[] = [];
    const cats = cfg().categories.filter((c) => !exhausted.has(c));
    // пауза между запросами к хосту — в lib/http.ts
    await eachTolerant('getonbrd: категория', cats, async (cat) => {
      const url = `https://www.getonbrd.com/api/v0/categories/${encodeURIComponent(cat)}/jobs?per_page=${PER_PAGE}&page=${page + 1}&expand=${encodeURIComponent('["company","tags"]')}`;
      const list = parse(await fetchJson(url));
      if (list.length < PER_PAGE) exhausted.add(cat);
      out.push(...list);
    });
    return out.sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0));
  },
};
