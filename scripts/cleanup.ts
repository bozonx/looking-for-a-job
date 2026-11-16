/**
 * Удаление старых вакансий (design.md §5.4).
 * `npm run cleanup -- [--older-than 30d] [--status rejected,applied] [--dry-run]`
 * Возраст — по collected_at (по умолчанию CLEANUP_DEFAULT_DAYS), статусы по умолчанию rejected,applied.
 * Вакансии со звездой не удаляются никогда.
 */
import fs from 'node:fs';
import path from 'node:path';
import { env } from './lib/env.ts';
import { loadAll } from './lib/vacancy.ts';
import { appendRunLog } from './lib/runlog.ts';

const args = process.argv.slice(2);
const val = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = args.includes('--dry-run');
const ageRaw = val('--older-than') ?? `${env.CLEANUP_DEFAULT_DAYS}d`;
const m = /^(\d+)d?$/.exec(ageRaw);
if (!m) {
  console.error(`--older-than: ожидается "<N>d", получено "${ageRaw}"`);
  process.exit(2);
}
const days = Number(m[1]);
const statuses = new Set((val('--status') ?? 'rejected,applied').split(',').map((s) => s.trim()).filter(Boolean));
const cutoff = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);

const victims = loadAll().filter((v) => !v.data.starred && statuses.has(v.data.status) && String(v.data.collected_at) < cutoff);
const rel = (f: string) => path.relative(process.cwd(), f);
for (const v of victims) {
  console.log(`${dryRun ? '[dry-run] ' : ''}rm ${rel(v.file)} (${v.data.status}, ${v.data.collected_at})`);
  if (!dryRun) fs.unlinkSync(v.file);
}
console.log(`\n${dryRun ? 'Будет удалено' : 'Удалено'}: ${victims.length} (старше ${days} дн., статусы: ${[...statuses].join(',')})`);
if (!dryRun && victims.length) appendRunLog('cleanup', `## cleanup\n\n- старше ${days} дн., статусы: ${[...statuses].join(',')}\n- удалено: ${victims.length}\n\n${victims.map((v) => `- ${rel(v.file)}`).join('\n')}`);
