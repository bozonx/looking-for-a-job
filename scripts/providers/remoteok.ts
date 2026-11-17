/**
 * Remote OK: публичный JSON https://remoteok.com/api (~100 последних вакансий одной страницей).
 * Условия API требуют ссылку на Remote OK как источник — она в source_url и в теле вакансии.
 */
import { htmlToMarkdown } from '../lib/html.ts';
import { fetchJson } from '../lib/http.ts';
import { applyMethodFromUrl } from '../lib/target.ts';
import { safeExtId, type Provider, type RawJob } from '../lib/collect.ts';

const API = 'https://remoteok.com/api';

interface RemoteOkJob {
  id: string;
  slug: string;
  epoch: number;
  date: string;
  company: string;
  position: string;
  tags?: string[];
  description?: string;
  location?: string;
  salary_min?: number;
  salary_max?: number;
  apply_url?: string;
  url?: string;
}

/** RemoteOK иногда отдаёт UTF-8, ошибочно перекодированный как latin1 ("â" вместо "—"). */
function fixMojibake(s: string): string {
  if (!/[Â-ô][\u0080-¿]/.test(s)) return s;
  const out = Buffer.from(s, 'latin1').toString('utf8');
  return out.includes('�') ? s : out;
}

function decode(s = ''): string {
  return fixMojibake(s)
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function employment(tags: string[]): string {
  const t = tags.map((x) => x.toLowerCase());
  if (t.some((x) => x.includes('contract') || x.includes('freelance'))) return 'contract';
  if (t.some((x) => x.includes('full time') || x.includes('full-time'))) return 'full-time';
  return 'unknown';
}

function toRaw(j: RemoteOkJob): RawJob {
  const title = decode(j.position);
  const company = decode(j.company) || 'Unknown';
  const tags = j.tags ?? [];
  return {
    preview: { source_url: j.url || `https://remoteok.com/remote-jobs/${j.slug}`, location: decode(j.location) || null },
    extId: safeExtId(j.id),
    postedAt: j.epoch ? j.epoch * 1000 : null,
    title,
    company,
    tags,
    build() {
      const sourceUrl = j.url || `https://remoteok.com/remote-jobs/${j.slug}`;
      const apply = j.apply_url && !/remoteok\.(com|io)/i.test(j.apply_url) ? j.apply_url : null;
      const hasSalary = (j.salary_min ?? 0) > 0 || (j.salary_max ?? 0) > 0;
      const body =
        `# ${title} — ${company}\n\n` +
        `Source: [Remote OK](${sourceUrl})${apply ? ` · Apply: ${apply}` : ''}\n\n` +
        htmlToMarkdown(fixMojibake(j.description ?? '').replace(/\\n/g, '\n')) +
        '\n';
      return {
        data: {
          source_url: sourceUrl,
          real_url: apply && /^https?:/.test(apply) ? apply : null,
          apply_method: applyMethodFromUrl(apply),
          posted_at: j.date?.slice(0, 10) ?? null,
          location: decode(j.location) || null,
          salary: hasSalary ? { min: j.salary_min || null, max: j.salary_max || null, currency: 'USD', period: 'year' } : null,
          employment: employment(tags),
        },
        body,
      };
    },
  };
}

function parse(json: unknown): RawJob[] {
  if (!Array.isArray(json)) throw new Error('RemoteOK API: unexpected response');
  return (json as RemoteOkJob[])
    .filter((j) => j && j.id && j.position)
    .sort((a, b) => b.epoch - a.epoch)
    .map(toRaw);
}

export const remoteok: Provider = {
  source: 'remoteok',
  paginated: false,
  parse,
  async fetchPage(page) {
    if (page > 0) return [];
    return parse(await fetchJson(API));
  },
};
