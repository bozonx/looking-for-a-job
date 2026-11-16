/**
 * Удаление старых вакансий без решения (design.md §5.4).
 * Удаляется вакансия старше N дней (по collected_at), если у неё нет статуса (status: null),
 * нет звезды и она не помечена «проблемной». selected / applied / needs_attention / apply_failed,
 * ★ и flagged хранятся, пока пользователь не снимет отметку.
 * Id остаётся в data/state/seen-*.json, так что удалённая вакансия не вернётся при сборе.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, type VacancyFile } from './vacancy.ts';
import { appendRunLog } from './runlog.ts';

export const isDisposable = (d: Record<string, any>) => d.status == null && !d.starred && !d.flagged;

export function cleanup(days: number, dryRun: boolean, log: (s: string) => void = console.log): VacancyFile[] {
  const cutoff = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
  const victims = loadAll().filter((v) => isDisposable(v.data) && String(v.data.collected_at) < cutoff);
  const rel = (f: string) => path.relative(process.cwd(), f);
  for (const v of victims) {
    log(`${dryRun ? '[dry-run] ' : ''}rm ${rel(v.file)} (${v.data.collected_at})`);
    if (!dryRun) fs.unlinkSync(v.file);
  }
  log(`${dryRun ? 'Будет удалено' : 'Удалено'} старых вакансий без решения: ${victims.length} (старше ${days} дн.)`);
  if (!dryRun && victims.length) appendRunLog('cleanup', `## cleanup\n\n- старше ${days} дн., без статуса/★/флага\n- удалено: ${victims.length}\n\n${victims.map((v) => `- ${rel(v.file)}`).join('\n')}`);
  return victims;
}
