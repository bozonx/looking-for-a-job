/**
 * Детерминированный расчёт scores.overall по config/weights.yaml.
 * Без аргументов — все отскоренные вакансии, у которых overall ещё не посчитан.
 * --all — пересчитать все (rescore). Либо список id/путей.
 */
import { listVacancyFiles, parseVacancy, resolveTargets, writeVacancy } from './lib/vacancy.ts';
import { computeOverall, loadWeights } from './lib/scoring.ts';

const W = loadWeights();
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
  const { overall, flags } = computeOverall(W, s, v.data.stop_flags ?? []);
  v.data.scores = { ...s, overall };
  v.data.stop_flags = flags;
  writeVacancy(f, v.data, v.body);
  n++;
  console.log(`${String(overall).padStart(3)}  ${v.data.id}  ${v.data.title} — ${v.data.company}${flags.length ? `  [${flags.join(',')}]` : ''}`);
}
console.log(`\nScored: ${n} (weights v${W.version})`);
