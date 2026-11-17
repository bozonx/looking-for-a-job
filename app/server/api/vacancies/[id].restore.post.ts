import { fetchText } from '../../../../scripts/lib/http.ts';
import { restoredBody } from '../../../../scripts/lib/restore.ts';
import { writeVacancy } from '../../../../scripts/lib/vacancy.ts';
/** Возврат — отдельная операция; произвольные поля через PATCH по-прежнему запрещены. */
export default defineEventHandler(async event => {
  const id = getRouterParam(event, 'id')!;
  const initial = findById(id);
  if (!initial) throw createError({ statusCode: 404, statusMessage: 'Vacancy not found' });
  if (!initial.data.prefilter_reason) return { data: initial.data };
  let body: string;
  try { body = restoredBody(await fetchText(initial.data.source_url), initial.data.source_url); }
  catch (e) { throw createError({ statusCode: 422, message: String(e) }); }
  const v = patchVacancy(id, cur => ({ ...cur, prefilter_reason: null, hire_from_ar: 'unknown', hire_from_ar_evidence: null,
    stop_flags: (cur.stop_flags ?? []).filter((f: string) => !['location_restricted', 'office_outside_ar'].includes(f)),
    notes: `${cur.notes ?? ''}\n[агент: возвращено пользователем из предфильтра]`.trim() }));
  if (!v) throw createError({ statusCode: 404 });
  writeVacancy(v.file, v.data, body);
  return { data: v.data };
});
