import { z } from 'zod';
import { applyUiPatch } from '../../../../scripts/lib/uipatch.ts';

/**
 * UI: `selected` ↔ null, ручной отклик (`applied`, applied_via: manual) и его отмена, ★, ⚑, заметки.
 * Переходы проверяются на свежих данных файла (scripts/lib/uipatch.ts): статусы агента UI не затирает.
 */
const Patch = z
  .object({
    status: z.enum(['selected', 'applied']).nullable(),
    starred: z.boolean(),
    flagged: z.boolean(),
    notes: z.string(),
  })
  .partial()
  .strict();

export default defineEventHandler(async (event) => {
  const parsed = Patch.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid patch', message: parsed.error.message });
  let err = '';
  const v = patchVacancy(getRouterParam(event, 'id')!, (cur) => {
    const r = applyUiPatch(cur, parsed.data);
    if (typeof r === 'string') {
      err = r;
      return cur;
    }
    return r;
  });
  if (!v) throw createError({ statusCode: 404, statusMessage: 'Vacancy not found' });
  if (err) throw createError({ statusCode: 409, statusMessage: 'Status conflict', message: err });
  return { data: v.data };
});
