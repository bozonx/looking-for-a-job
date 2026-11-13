import { z } from 'zod';

/** UI may only move a vacancy between these statuses; applied/needs_attention/apply_failed are set by the agent. */
const UI_STATUSES = ['new', 'selected', 'rejected'] as const;

const Patch = z
  .object({
    status: z.enum(UI_STATUSES),
    starred: z.boolean(),
    notes: z.string(),
  })
  .partial()
  .strict();

export default defineEventHandler(async (event) => {
  const parsed = Patch.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid patch', message: parsed.error.message });
  const v = patchVacancy(getRouterParam(event, 'id')!, parsed.data);
  if (!v) throw createError({ statusCode: 404, statusMessage: 'Vacancy not found' });
  return { data: v.data };
});
