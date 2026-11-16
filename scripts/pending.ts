/**
 * Очередь вакансий, ожидающих скоринга агентом (scores: null, status: new).
 * `npm run pending -- [--paths] [--limit N | --all]`
 * Отдаёт не больше SCORE_MAX_PER_RUN (по умолчанию) — бюджет токенов на один «собери».
 * Порядок: сначала свежие (posted_at, иначе collected_at), при равенстве — с известным real_url.
 * Остаток остаётся в очереди и берётся следующим запуском: курсор не нужен, очередь — это сами файлы.
 * Свежесть: вакансии старше `freshness_days` своего источника (config/sources.yaml) в очередь не попадают —
 * откликаться на них поздно, токены на скоринг не тратим. Файлы остаются (видны в UI); `--stale` — взять и их.
 */
import path from 'node:path';
import { env } from './lib/env.ts';
import { loadAll } from './lib/vacancy.ts';
import { freshnessDays } from './lib/freshness.ts';

const args = process.argv.slice(2);
const li = args.indexOf('--limit');
const limit = args.includes('--all') ? Infinity : li >= 0 ? Number(args[li + 1]) : env.SCORE_MAX_PER_RUN;
if (!(limit >= 1)) {
  console.error(`--limit: ожидается число ≥ 1`);
  process.exit(2);
}
const onlyPaths = args.includes('--paths');
const withStale = args.includes('--stale') || args.includes('--all');

const date = (v: { data: any }) => String(v.data.posted_at ?? v.data.collected_at ?? '');
const queue = loadAll().filter((v) => v.data.scores == null && v.data.status === 'new');
const now = Date.now();
const isStale = (v: { data: any }) => {
  const days = freshnessDays(v.data.source);
  const posted = Date.parse(v.data.posted_at ?? '');
  return days != null && Number.isFinite(posted) && now - posted > days * 86400e3;
};
const stale = withStale ? [] : queue.filter(isStale);
const pending = queue
  .filter((v) => withStale || !isStale(v))
  .sort((a, b) => date(b).localeCompare(date(a)) || Number(!!b.data.real_url) - Number(!!a.data.real_url));
const batch = pending.slice(0, limit);

for (const v of batch) {
  const rel = path.relative(process.cwd(), v.file);
  console.log(onlyPaths ? rel : `${rel}\n    ${v.data.id} · ${v.data.title} — ${v.data.company} · ${v.data.location ?? ''}`);
}
if (!onlyPaths) {
  const rest = pending.length - batch.length;
  console.log(`\nК скорингу сейчас: ${batch.length} из ${pending.length}` + (rest ? ` (остальные ${rest} — следующим запуском; лимит SCORE_MAX_PER_RUN=${env.SCORE_MAX_PER_RUN})` : ''));
  if (stale.length) {
    const by: Record<string, number> = {};
    for (const v of stale) by[v.data.source] = (by[v.data.source] ?? 0) + 1;
    console.log(`Пропущено как несвежие (старше freshness_days источника): ${stale.length} — ${Object.entries(by).map(([k, n]) => `${k}: ${n}`).join(', ')}. Взять их: --stale`);
  }
}
