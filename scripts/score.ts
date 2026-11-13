/**
 * Детерминированный расчёт scores.overall по config/weights.yaml.
 * Без аргументов — все отскоренные вакансии, у которых overall ещё не посчитан.
 * --all — пересчитать все (rescore). Либо список id/путей.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { CONFIG_DIR } from './lib/env.ts';
import { listVacancyFiles, parseVacancy, resolveTargets, writeVacancy } from './lib/vacancy.ts';

interface Weights {
  version: number;
  positive: Record<string, number>;
  inverse: Record<string, number>;
  fit_tracks: Record<string, number>;
  stop_flags: string[];
  scam_legitimacy_below: number;
}
const W = YAML.parse(fs.readFileSync(path.join(CONFIG_DIR, 'weights.yaml'), 'utf8')) as Weights;

export function computeOverall(scores: Record<string, any>, stopFlags: string[]): { overall: number; flags: string[] } {
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

const args = process.argv.slice(2);
const all = args.includes('--all');
const targets = args.filter((a) => !a.startsWith('--'));
const files = targets.length ? resolveTargets(targets) : listVacancyFiles();

let n = 0;
for (const f of files) {
  const v = parseVacancy(f);
  const s = v.data.scores;
  if (!s) continue;
  if (!all && !targets.length && typeof s.overall === 'number') continue;
  const { overall, flags } = computeOverall(s, v.data.stop_flags ?? []);
  v.data.scores = { ...s, overall };
  v.data.stop_flags = flags;
  writeVacancy(f, v.data, v.body);
  n++;
  console.log(`${String(overall).padStart(3)}  ${v.data.id}  ${v.data.title} — ${v.data.company}${flags.length ? `  [${flags.join(',')}]` : ''}`);
}
console.log(`\nScored: ${n} (weights v${W.version})`);
