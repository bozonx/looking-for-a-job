import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { CONFIG_DIR } from './env.ts';

export interface Weights {
  version: number;
  positive: Record<string, number>;
  inverse: Record<string, number>;
  fit_tracks: Record<string, number>;
  stop_flags: string[];
  scam_legitimacy_below: number;
}

export function loadWeights(): Weights {
  return YAML.parse(fs.readFileSync(path.join(CONFIG_DIR, 'weights.yaml'), 'utf8')) as Weights;
}

export function loadRegions(): Record<string, number> {
  return YAML.parse(fs.readFileSync(path.join(CONFIG_DIR, 'regions.yaml'), 'utf8')) as Record<string, number>;
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
  for (const [k, w] of Object.entries(W.positive)) {
    if (k === 'fit') {
      const fits = Object.entries(scores.fit ?? {}).map(([t, v]) => (W.fit_tracks[t] ?? 0) * (v as number));
      add(w, fits.length ? Math.max(...fits) : undefined);
    } else add(w, scores[k]);
  }
  for (const [k, w] of Object.entries(W.inverse)) if (typeof scores[k] === 'number') add(w, 100 - scores[k]);
  return { overall: wsum ? Math.round(sum / wsum) : 0, flags };
}
