/**
 * Чистка вакансий (design.md §5.4). Удаляются:
 * - закрытые (`possibly_closed: true`) — сразу, любого статуса, кроме ★;
 * - старше N дней (по collected_at) без решения: нет статуса, нет ★, нет ⚑.
 * selected / applied / needs_attention / apply_failed, ★ и ⚑ хранятся, пока отметку не снимут.
 * История откликов остаётся в data/runs/*-apply.md, разборы проблемных — в data/flagged-cases.md.
 * Id остаётся в data/state/seen-*.json, так что удалённая вакансия не вернётся при сборе.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, type VacancyFile } from './vacancy.ts';
import { appendRunLog } from './runlog.ts';

export function cleanupReason(d: Record<string, any>, cutoff: string): string | null {
  if (d.starred) return null;
  if (d.possibly_closed) return 'закрыта';
  if (d.status == null && !d.flagged && String(d.collected_at) < cutoff) return 'старая без решения';
  return null;
}

export function cleanup(days: number, dryRun: boolean, log: (s: string) => void = console.log): { closed: number; old: number } {
  const cutoff = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
  const victims = loadAll()
    .map((v) => ({ v, why: cleanupReason(v.data, cutoff) }))
    .filter((x): x is { v: VacancyFile; why: string } => !!x.why);
  const rel = (f: string) => path.relative(process.cwd(), f);
  const lines = victims.map(({ v, why }) => `${rel(v.file)} (${why}, ${v.data.status ?? 'без статуса'}, ${v.data.collected_at})`);
  for (const l of lines) log(`${dryRun ? '[dry-run] ' : ''}rm ${l}`);
  if (!dryRun) for (const { v } of victims) fs.unlinkSync(v.file);
  const closed = victims.filter((x) => x.why === 'закрыта').length;
  const old = victims.length - closed;
  log(`${dryRun ? 'Будет удалено' : 'Удалено'}: закрытых ${closed}, старых без решения ${old} (старше ${days} дн.)`);
  if (!dryRun && victims.length) appendRunLog('cleanup', `## cleanup\n\n- закрытых: ${closed}, старых без решения (> ${days} дн.): ${old}\n\n${lines.map((l) => `- ${l}`).join('\n')}`);
  return { closed, old };
}
