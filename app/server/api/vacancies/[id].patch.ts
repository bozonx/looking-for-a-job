import { z } from 'zod';

/** UI ставит только `selected` или снимает статус (null); applied/needs_attention/apply_failed ставит агент. */
const Patch = z
  .object({
    status: z.enum(['selected']).nullable(),
    starred: z.boolean(),
    flagged: z.boolean(),
    notes: z.string(),
  })
  .partial()
  .strict();

export default defineEventHandler(async (event) => {
  const parsed = Patch.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid patch', message: parsed.error.message });
  const patch: Record<string, unknown> = { ...parsed.data };
  if (patch.flagged === true) patch.flag_reviewed_at = null; // повторная пометка — агент перепроверит заново
  const v = patchVacancy(getRouterParam(event, 'id')!, patch);
  if (!v) throw createError({ statusCode: 404, statusMessage: 'Vacancy not found' });
  return { data: v.data };
});
