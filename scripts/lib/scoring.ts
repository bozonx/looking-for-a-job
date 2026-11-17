import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { CONFIG_DIR } from './env.ts';
import { STOP_FLAGS } from './schema.ts';

export interface Weights {
  version: number;
  positive: Record<string, number>;
  inverse: Record<string, number>;
  fit_tracks: Record<string, number>;
  /** лучший СЫРОЙ fit (без веса трека) < below → overall ≤ cap: роль нерелевантна ни одному треку */
  fit_cap?: { below: number; cap: number };
  scam_legitimacy_below: number;
}

export function loadWeights(): Weights {
  const W = YAML.parse(fs.readFileSync(path.join(CONFIG_DIR, 'weights.yaml'), 'utf8')) as Weights & { stop_flags?: unknown };
  // стоп-флаги — единый список STOP_FLAGS в schema.ts; старый ключ в weights.yaml игнорируем
  delete W.stop_flags;
  return W;
}

export interface RegionGroup {
  score: number;
  countries: string[];
}
export type Regions = Record<string, RegionGroup>;

export function loadRegions(): Regions {
  return (YAML.parse(fs.readFileSync(path.join(CONFIG_DIR, 'regions.yaml'), 'utf8')) as { groups: Regions }).groups;
}

/** Группа работодателя: русскоязычная команда > страна из списка > other; страна неизвестна → unknown. */
export function regionGroup(R: Regions, country: string | null | undefined, ruTeam: boolean | null | undefined): string {
  if (ruTeam) return 'ru_speaking_team';
  if (!country) return 'unknown';
  const c = country.toUpperCase();
  for (const [g, def] of Object.entries(R)) if (def.countries?.includes(c)) return g;
  return 'other';
}

export function computeOverall(W: Weights, scores: Record<string, any>, stopFlags: string[]): { overall: number; flags: string[] } {
  const flags = [...new Set(stopFlags ?? [])];
  if (typeof scores.legitimacy === 'number' && scores.legitimacy < W.scam_legitimacy_below && !flags.includes('scam')) flags.push('scam');
  if (flags.some((f) => (STOP_FLAGS as readonly string[]).includes(f))) return { overall: 0, flags };

  let sum = 0;
  let wsum = 0;
  const add = (w: number, v: unknown) => {
    if (!w || typeof v !== 'number') return;
    sum += w * v;
    wsum += w;
  };
  const fitEntries = Object.entries(scores.fit ?? {}).filter(([t, v]) => typeof v === 'number' && (W.fit_tracks[t] ?? 0) > 0) as [string, number][];
  const bestFit = fitEntries.length ? Math.max(...fitEntries.map(([t, v]) => (W.fit_tracks[t] ?? 0) * v)) : undefined;
  const bestRawFit = fitEntries.length ? Math.max(...fitEntries.map(([, v]) => v)) : undefined;
  for (const [k, w] of Object.entries(W.positive)) add(w, k === 'fit' ? bestFit : scores[k]);
  for (const [k, w] of Object.entries(W.inverse)) if (typeof scores[k] === 'number') add(w, 100 - scores[k]);
  let overall = wsum ? Math.round(sum / wsum) : 0;
  if (W.fit_cap && bestRawFit !== undefined && bestRawFit < W.fit_cap.below) overall = Math.min(overall, W.fit_cap.cap);
  return { overall, flags };
}
