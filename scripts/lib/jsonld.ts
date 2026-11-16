/**
 * schema.org JobPosting из HTML страницы вакансии (<script type="application/ld+json">).
 * Многие площадки кладут туда полное описание и структурированные поля — разбор вёрстки не нужен.
 */
import { decodeEntities, normEmployment } from './job.ts';

export interface JobPosting {
  title: string | null;
  /** HTML описания */
  description: string | null;
  datePosted: string | null;
  company: string | null;
  location: string | null;
  remote: boolean;
  employment: string;
}

function place(p: any): string | null {
  const a = p?.address;
  if (!a) return typeof p?.name === 'string' ? p.name : null;
  if (typeof a === 'string') return a;
  return [a.addressLocality, a.addressRegion, a.addressCountry?.name ?? a.addressCountry].filter((x) => typeof x === 'string' && x).join(', ') || null;
}

export function jobPosting(html: string): JobPosting | null {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let json: any;
    try {
      json = JSON.parse(m[1]!.trim());
    } catch {
      continue;
    }
    const nodes: any[] = [].concat(json?.['@graph'] ?? json);
    const jp = nodes.find((n) => [].concat(n?.['@type']).includes('JobPosting' as never));
    if (!jp) continue;
    const locs = ([] as any[]).concat(jp.jobLocation ?? []).map(place).filter(Boolean) as string[];
    const remote = String(jp.jobLocationType ?? '').toUpperCase().includes('TELECOMMUTE');
    // описание иногда HTML-экранировано (&lt;p&gt;)
    const desc = typeof jp.description === 'string' ? (/&lt;\w/.test(jp.description) ? jp.description.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&') : jp.description) : null;
    return {
      title: typeof jp.title === 'string' ? decodeEntities(jp.title) : null,
      description: desc,
      datePosted: jp.datePosted ?? null,
      company: typeof jp.hiringOrganization?.name === 'string' ? decodeEntities(jp.hiringOrganization.name) : null,
      location: [remote ? 'Remote' : null, ...locs].filter(Boolean).join('; ') || null,
      remote,
      employment: normEmployment(jp.employmentType),
    };
  }
  return null;
}
