/**
 * Фаза A сбора: `npm run collect [-- <source>...] [--dry-run] [--limit N] [--file path.json]`.
 * Без источников — все из scripts/providers/index.ts. --file — только с одним источником.
 * Новые вакансии сохраняются со `scores: null` — их скорит агент (playbooks/scoring.md).
 */
import { collect, collectContext, COLLECT_RUN, type CollectResult } from './lib/collect.ts';
import { writeLastCollect } from './lib/lastcollect.ts';
import { cleanup } from './lib/cleanup.ts';
import { env } from './lib/env.ts';

/**
 * Сколько источников собирать одновременно. Разные площадки — разные хосты, так что параллельность
 * не увеличивает нагрузку ни на одну из них; общий для источника хост (ленты на одном домене)
 * всё равно ограничен паузой между запросами в lib/http.ts.
 */
const PARALLEL_SOURCES = 4;
import { insertRunLog, runLogOffset } from './lib/runlog.ts';
import { acquireLock } from './lib/lock.ts';

/**
 * Итог запуска — точные цифры и дословные ошибки/предупреждения по всем источникам.
 * Агент переносит его в отчёт как есть (playbooks/collect.md, шаг 7), а не пересчитывает по логу.
 */
function summary(rs: CollectResult[], dryRun: boolean): string {
  const sum = (k: keyof NonNullable<CollectResult['stats']>) => rs.reduce((a, r) => a + (r.stats?.[k] ?? 0), 0);
  const section = (title: string, f: (r: CollectResult) => string[] | undefined) => {
    const lines = rs.flatMap((r) => (f(r) ?? []).map((l) => l.replace(/^- /, `- [${r.source}] `)));
    return `### ${title} (${lines.length})\n${lines.length ? lines.join('\n') : '- нет'}\n`;
  };
  const failedSrc = rs.filter((r) => r.failed).map((r) => `- ${r.source}: ${r.stopReason}`);
  const skipped = rs.filter((r) => r.skipped).map((r) => `- ${r.source}: ${r.skipped}`);
  return (
    `\n# ИТОГ СБОРА${dryRun ? ' (dry-run)' : ''}\n\n` +
    `- источников: ${rs.length}, с ошибкой загрузки списка: ${failedSrc.length}, пропущено по интервалу: ${skipped.length}\n` +
    `- в лентах: ${sum('listed')}, отсеяно предфильтром: ${sum('prefiltered')}, уже известных: ${sum('known')}, вне окна: ${sum('old')}\n` +
    `- дублей с других площадок: ${sum('duplicates')}, сохранено новых: ${sum('saved')}, ошибок по вакансиям/списку: ${sum('errors')}\n\n` +
    (failedSrc.length ? `### Источники с ошибкой загрузки\n${failedSrc.join('\n')}\n\n` : '') +
    (skipped.length ? `### Пропущены по интервалу\n${skipped.join('\n')}\n\n` : '') +
    section('Ошибки', (r) => r.errors) +
    '\n' +
    section('⚠ Предупреждения', (r) => r.warnings) +
    '\n' +
    section('Дубли только по названию — сверить тексты', (r) => r.titleOnlyDups)
  );
}
import { providers } from './providers/index.ts';

const args = process.argv.slice(2);
const flagValue = (name: string): string | undefined => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) throw new Error(`${name} требует значение`);
  args.splice(i, 2);
  return v;
};

async function main() {
  const limitRaw = flagValue('--limit');
  const file = flagValue('--file');
  const dryRun = args.includes('--dry-run');
  const names = args.filter((a) => !a.startsWith('--'));
  const unknownFlag = args.find((a) => a.startsWith('--') && a !== '--dry-run');
  if (unknownFlag) throw new Error(`Неизвестный флаг: ${unknownFlag}`);

  const limit = limitRaw === undefined ? Infinity : Number(limitRaw);
  if (!Number.isInteger(limit) && limit !== Infinity) throw new Error(`--limit: ожидается целое число, получено "${limitRaw}"`);
  if (limit < 1) throw new Error('--limit должен быть ≥ 1');

  const unknown = names.filter((n) => !providers[n]);
  if (unknown.length) throw new Error(`Неизвестный источник: ${unknown.join(', ')}. Доступны: ${Object.keys(providers).join(', ')}`);
  const list = names.length ? names : Object.keys(providers);
  if (file && list.length !== 1) throw new Error('--file работает только с одним источником');

  // dry-run и --file ничего не пишут в state — им блокировка не нужна
  if (!dryRun && !file) acquireLock('collect');
  let total = 0;
  let failed = 0;
  const logOffset = runLogOffset('collect');
  // один индекс дублей на весь запуск; результаты — в порядке списка источников, а не завершения
  const ctx = collectContext();
  const results: CollectResult[] = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      results[i] = await collect(providers[list[i]!]!, { dryRun, limit, file }, ctx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_SOURCES, list.length) }, worker));
  for (const r of results) {
    total += r.saved;
    if (r.failed) failed++;
  }
  let itog = summary(results, dryRun);
  if (!dryRun && !file) {
    writeLastCollect(COLLECT_RUN);
    if (env.CLEANUP_ON_COLLECT) {
      const r = cleanup(env.CLEANUP_DEFAULT_DAYS, false, () => {});
      itog += `\n### Очистка (CLEANUP_ON_COLLECT)\n- удалено закрытых: ${r.closed}, старых без решения (> ${env.CLEANUP_DEFAULT_DAYS} дн.): ${r.old}\n`;
    }
  }
  if (!dryRun && !file) insertRunLog('collect', itog.replace('# ИТОГ СБОРА', `## ИТОГ СБОРА — ${new Date().toISOString().slice(11, 16)} UTC`), logOffset);
  console.log(itog);
  if (total && !dryRun) console.log(`NEXT: отскорить ${total} вакансий (npm run pending), поискать real_url, затем npm run score && npm run validate; дописать data/insights.md`);
  if (failed) {
    console.error(`Источников с ошибкой загрузки: ${failed} (см. лог)`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});
