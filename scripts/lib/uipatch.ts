/**
 * Правила правок из UI (app/server/api/vacancies/[id].patch.ts).
 * UI ставит `selected`, снимает его, и отмечает ручной отклик (`applied` + `applied_via: manual`).
 * Результат отклика (`outcome`) — только у `applied` (и агентского, и ручного).
 * Статусы агента (applied через агента, needs_attention, apply_failed) из UI не меняются.
 */
import type { Outcome } from './enums.ts';

export type UiStatus = 'selected' | 'applied' | null;
export interface UiPatch {
  status?: UiStatus;
  starred?: boolean;
  flagged?: boolean;
  notes?: string;
  outcome?: Outcome | null;
}

/** Применяет правку к свежим данным файла. Возвращает новые данные или текст ошибки. */
export function applyUiPatch(cur: Record<string, any>, p: UiPatch, now = new Date().toISOString()): Record<string, any> | string {
  const d = { ...cur };
  if (p.starred !== undefined) d.starred = p.starred;
  if (p.flagged !== undefined) d.flagged = p.flagged;
  if (p.notes !== undefined) d.notes = p.notes;
  if (p.outcome !== undefined && p.outcome !== (cur.outcome ?? null)) {
    if (cur.status !== 'applied' || p.status === null) return 'результат отклика ставится только у вакансии со статусом «отклик»';
    Object.assign(d, { outcome: p.outcome, outcome_at: p.outcome ? now.slice(0, 10) : null });
  }
  if (p.status === undefined || p.status === (cur.status ?? null)) return d;
  const from = cur.status ?? null;
  const manual = from === 'applied' && cur.applied_via === 'manual';
  if (p.status === 'selected' && from !== null) return `нельзя отметить на отклик: статус «${from}»`;
  if (p.status === 'applied' && from !== null && from !== 'selected') return `нельзя отметить отклик: статус «${from}»`;
  if (p.status === null && from !== 'selected' && !manual) return `статус «${from}» ставит агент, из UI не снимается`;
  d.status = p.status;
  if (p.status === 'applied') Object.assign(d, { applied_at: now, applied_via: 'manual', apply_log: null });
  if (manual) Object.assign(d, { applied_at: null, applied_via: null, outcome: null, outcome_at: null });
  return d;
}

/** Есть ли в заметках текст пользователя (строки агента `[агент …]` не в счёт). */
export const hasUserNotes = (notes: unknown) =>
  String(notes ?? '').split('\n').some((l) => l.trim() && !l.trim().startsWith('[агент'));

/** Отмечена ли вакансия чем-либо (такие чистка не удаляет): статус, ★, ⚑ или заметка пользователя. */
export const isMarked = (d: Record<string, any>) => d.status != null || !!d.starred || !!d.flagged || hasUserNotes(d.notes);
