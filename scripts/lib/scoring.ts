import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { CONFIG_DIR } from './env.ts';

export interface Weights {
  version: number;
  positive: Record<string, number>;
  inverse: Record<string, number>;
  fit_tracks: Record<string, number>;
  /** лучший взвешенный fit < below → overall ≤ cap */
  fit_cap?: { below: number; cap: number };
  stop_flags: string[];
  scam_legitimacy_below: number;
}

export function loadWeights(): Weights {
  return YAML.parse(fs.readFileSync(path.join(CONFIG_DIR, 'weights.yaml'), 'utf8')) as Weights;
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
  if (flags.some((f) => W.stop_flags.includes(f))) return { overall: 0, flags };

  let sum = 0;
  let wsum = 0;
  const add = (w: number, v: unknown) => {
    if (!w || typeof v !== 'number') return;
    sum += w * v;
    wsum += w;
  };
  const fits = Object.entries(scores.fit ?? {}).map(([t, v]) => (W.fit_tracks[t] ?? 0) * (v as number));
  const bestFit = fits.length ? Math.max(...fits) : undefined;
  for (const [k, w] of Object.entries(W.positive)) add(w, k === 'fit' ? bestFit : scores[k]);
  for (const [k, w] of Object.entries(W.inverse)) if (typeof scores[k] === 'number') add(w, 100 - scores[k]);
  let overall = wsum ? Math.round(sum / wsum) : 0;
  if (W.fit_cap && bestFit !== undefined && bestFit < W.fit_cap.below) overall = Math.min(overall, W.fit_cap.cap);
  return { overall, flags };
}
