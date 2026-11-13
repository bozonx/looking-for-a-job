import { z } from 'zod';
import { STATUSES } from '../../../../scripts/lib/schema.ts';

const Patch = z
  .object({
    status: z.enum(STATUSES),
    starred: z.boolean(),
    notes: z.string(),
  })
  .partial()
  .strict();

export default defineEventHandler(async (event) => {
  const parsed = Patch.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, message: parsed.error.message });
  const v = patchVacancy(getRouterParam(event, 'id')!, parsed.data);
  if (!v) throw createError({ statusCode: 404, statusMessage: 'Vacancy not found' });
  return { data: v.data };
});
