/**
 * Детерминированный расчёт scores.overall по config/weights.yaml.
 * Без аргументов — все отскоренные вакансии, у которых overall ещё не посчитан.
 * Заодно пересчитывает производные поля: scores.region (из config/regions.yaml по полю region),
 * apply_method (если unknown, а real_url найден) и apply_target (config/source-priority.yaml).
 * --all — пересчитать все (rescore). Либо список id/путей.
 */
import { listVacancyFiles, parseVacancy, resolveTargets, writeVacancy } from './lib/vacancy.ts';
import { loadRescoreCtx, rescoreVacancy } from './lib/rescore.ts';

const ctx = loadRescoreCtx();
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
  let res;
  try {
    res = rescoreVacancy(v, ctx)!;
  } catch (e) {
    console.error(`!  ${(e as Error).message}`);
    process.exitCode = 1;
    continue;
  }
  const { overall, flags } = res;
  writeVacancy(f, v.data, v.body);
  n++;
  console.log(`${String(overall).padStart(3)}  ${v.data.id}  ${v.data.title} — ${v.data.company}${flags.length ? `  [${flags.join(',')}]` : ''}`);
}
console.log(`\nScored: ${n} (weights v${ctx.W.version})`);
