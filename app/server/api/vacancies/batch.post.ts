import { z } from 'zod';
import { applyUiPatch } from '../../../../scripts/lib/uipatch.ts';

/**
 * Массовая правка из UI: одна правка (только status) для многих вакансий.
 * Каждая применяется по тем же правилам, что и PATCH /api/vacancies/:id; конфликты возвращаются списком.
 */
const Body = z
  .object({ ids: z.array(z.string()).min(1).max(2000), patch: z.object({ status: z.enum(['selected', 'applied']).nullable() }).strict() })
  .strict();

export default defineEventHandler(async (event) => {
  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid batch', message: parsed.error.message });
  const { ids, patch } = parsed.data;
  let updated = 0;
  const failed: { id: string; error: string }[] = [];
  for (const id of ids) {
    let err = '';
    const v = patchVacancy(id, (cur) => {
      const r = applyUiPatch(cur, patch);
      if (typeof r === 'string') {
        err = r;
        return cur;
      }
      return r;
    });
    if (!v) failed.push({ id, error: 'не найдена' });
    else if (err) failed.push({ id, error: err });
    else updated++;
  }
  return { updated, failed };
});
