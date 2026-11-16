/**
 * Чистка вакансий (design.md §5.4): удаляются вакансии старше N дней (по collected_at) без решения —
 * нет статуса, нет ★, нет ⚑. Закрытые (`possibly_closed`) отдельно не удаляются — по тем же правилам, что и все.
 * selected / applied / needs_attention / apply_failed, ★ и ⚑ хранятся, пока отметку не снимут.
 * Id остаётся в data/state/seen-*.json, так что удалённая вакансия не вернётся при сборе.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadAll } from './vacancy.ts';
import { appendRunLog } from './runlog.ts';

export const isDisposable = (d: Record<string, any>, cutoff: string) => d.status == null && !d.starred && !d.flagged && String(d.collected_at) < cutoff;

export function cleanup(days: number, dryRun: boolean, log: (s: string) => void = console.log): number {
  const cutoff = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
  const victims = loadAll().filter((v) => isDisposable(v.data, cutoff));
  const rel = (f: string) => path.relative(process.cwd(), f);
  const lines = victims.map((v) => `${rel(v.file)} (${v.data.collected_at}${v.data.possibly_closed ? ', закрыта' : ''})`);
  for (const l of lines) log(`${dryRun ? '[dry-run] ' : ''}rm ${l}`);
  if (!dryRun) for (const v of victims) fs.unlinkSync(v.file);
  log(`${dryRun ? 'Будет удалено' : 'Удалено'} вакансий без решения старше ${days} дн.: ${victims.length}`);
  if (!dryRun && victims.length) appendRunLog('cleanup', `## cleanup\n\n- без решения, старше ${days} дн.: ${victims.length}\n\n${lines.map((l) => `- ${l}`).join('\n')}`);
  return victims.length;
}
