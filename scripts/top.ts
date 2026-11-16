/**
 * Топ вакансий по scores.overall — для отчёта «собери» (playbooks/collect.md, шаг 7).
 * `npm run top -- [N] [--all]`
 * По умолчанию — отскоренные сегодня (`npm run score`, data/state/last-scored.json), N = 5.
 * --all — среди всех открытых (status не rejected, не possibly_closed).
 */
import { loadAll } from './lib/vacancy.ts';
import { readLastScored } from './lib/lastscored.ts';
import { today } from './lib/env.ts';

const args = process.argv.slice(2);
const all = args.includes('--all');
const nArg = args.find((a) => !a.startsWith('--'));
const n = nArg === undefined ? 5 : Number(nArg);
if (!Number.isInteger(n) || n < 1) {
  console.error('usage: npm run top -- [N] [--all]');
  process.exit(2);
}

const last = readLastScored();
const ids = new Set(last.date === today() ? last.ids : []);
if (!all && !ids.size) console.log('Сегодня `npm run score` ничего не посчитал — топ пуст. Среди всех: --all');

const list = loadAll()
  .filter((v) => typeof v.data.scores?.overall === 'number')
  .filter((v) => (all ? v.data.status !== 'rejected' && !v.data.possibly_closed : ids.has(String(v.data.id))))
  .sort((a, b) => b.data.scores!.overall! - a.data.scores!.overall!);

const top = list.slice(0, n);
top.forEach((v, i) => {
  const d = v.data;
  const link = d.real_url ?? d.source_url ?? '—';
  console.log(`${i + 1}. ${d.id} — ${d.scores!.overall} — ${d.company}, ${d.title}; ${d.location ?? 'локация ?'}; откликаться: ${d.apply_target ?? '?'} — ${link}`);
});
console.log(`\n# ИТОГ ТОПА\n- показано: ${top.length} из ${list.length} (${all ? 'все открытые' : 'отскоренные сегодня'})`);
