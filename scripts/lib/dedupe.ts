import type { VacancyFile } from './vacancy.ts';

const STOP = /\b(remote|senior|sr|junior|jr|middle|mid|lead|staff|principal|the|a|an|and|of|for|with|\(.*?\))\b/g;

export function normCompany(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|gmbh|corp|corporation|co|s\.?a|s\.?l|limited)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

export function normTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(STOP, ' ').replace(/\s+/g, ' ').trim();
}

export function normUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = '';
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|ref|source|src|gh_src|lever-source)/i.test(k)) x.searchParams.delete(k);
    return `${x.host.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}${x.search}`.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

export interface Index {
  byId: Map<string, VacancyFile>;
  byUrl: Map<string, VacancyFile>;
  byKey: Map<string, VacancyFile>;
}

export const key = (company: string, title: string) => `${normCompany(company)}|${normTitle(title)}`;

export function buildIndex(all: VacancyFile[]): Index {
  const idx: Index = { byId: new Map(), byUrl: new Map(), byKey: new Map() };
  for (const v of all) {
    const d = v.data;
    if (d.id) idx.byId.set(d.id, v);
    for (const u of [d.source_url, d.real_url, ...(d.duplicates ?? []).map((x: any) => x?.url)]) if (u) idx.byUrl.set(normUrl(u), v);
    if (d.company && d.title) idx.byKey.set(key(d.company, d.title), v);
  }
  return idx;
}

export type Match = { vacancy: VacancyFile; by: 'id' | 'url' | 'company+title' } | null;

export function findDuplicate(idx: Index, c: { id: string; urls: string[]; company: string; title: string }): Match {
  const byId = idx.byId.get(c.id);
  if (byId) return { vacancy: byId, by: 'id' };
  for (const u of c.urls) {
    const hit = u && idx.byUrl.get(normUrl(u));
    if (hit) return { vacancy: hit, by: 'url' };
  }
  const byKey = idx.byKey.get(key(c.company, c.title));
  if (byKey) return { vacancy: byKey, by: 'company+title' };
  return null;
}
