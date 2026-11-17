/**
 * Выборка для калибровки скоринга (playbooks/flagged.md, «Калибровка»): пользователь сам смотрит случайные
 * вакансии из зон, где ошибки скоринга тихие и сами в глаза не бросаются.
 * `npm run calibrate -- [--n 5] [--days 14]`
 *   - середина: без стоп-флагов, overall 40–70 — недооценённое прячется здесь;
 *   - под стоп-флагом: флаг мог стоять зря (location_restricted по «preferred», офис при варианте удалёнки);
 *   - низкий fit: все треки < 40 — роль могла быть нашей, а агент не понял стек.
 * Уже проверенные (★, ⚑, статус, заметка) не берутся. Ничего не меняет.
 */
import { loadAll } from './lib/vacancy.ts';

const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const n = Number(opt('--n') ?? 5);
const since = new Date(Date.now() - Number(opt('--days') ?? 14) * 86400e3).toISOString().slice(0, 10);

const pool = loadAll().filter(
  (v) => v.data.scores && String(v.data.collected_at) >= since && !v.data.starred && !v.data.flagged && !v.data.status && !String(v.data.notes ?? '').trim() && !v.data.possibly_closed,
);
const maxFit = (d: any) => Math.max(0, ...Object.values(d.scores.fit ?? {}).map(Number).filter(Number.isFinite));
const pick = <T,>(a: T[]) => [...a].sort(() => Math.random() - 0.5).slice(0, n);
const groups: [string, typeof pool][] = [
  ['Середина (overall 40–70, без стоп-флагов)', pool.filter((v) => !v.data.stop_flags?.length && v.data.scores.overall >= 40 && v.data.scores.overall <= 70)],
  ['Под стоп-флагом', pool.filter((v) => v.data.stop_flags?.length)],
  ['Низкий fit (все треки < 40, без стоп-флагов)', pool.filter((v) => !v.data.stop_flags?.length && maxFit(v.data) < 40)],
];
console.log(`## Калибровка скоринга — выборка с ${since}\n`);
console.log('Посмотри в UI каждую: оценка верна — ничего не делай; неверна — ⚑ и причина в заметке, потом «проверь проблемные».\n');
for (const [title, vs] of groups) {
  console.log(`### ${title} — ${Math.min(n, vs.length)} из ${vs.length}\n`);
  for (const v of pick(vs)) {
    const d = v.data;
    console.log(`- ${d.id} · overall ${d.scores.overall ?? '—'} · ${d.best_resume ?? '—'}${d.stop_flags?.length ? ` · ${d.stop_flags.join(',')}` : ''} · ${d.title} — ${d.company}`);
  }
  console.log('');
}
