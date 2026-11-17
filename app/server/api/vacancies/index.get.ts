import { readLastCollect } from '../../../../scripts/lib/lastcollect.ts';

/** Тяжёлые поля, которые нужны только карточке (GET /api/vacancies/:id), — в список не отдаём. */
const CARD_ONLY = ['resume_match', 'score_reasoning', 'key_points', 'red_flags', 'requirements_special', 'apply_log', 'attention_details'];

/**
 * Список: front matter без тяжёлых полей. Фильтрация/сортировка — на клиенте (сотни строк).
 * `?since=<version>`: если индекс не менялся — `{ unchanged: true }` без данных (дешёвый опрос).
 */
export default defineEventHandler((event) => {
  const version = storeVersion();
  if (Number(getQuery(event).since) === version) return { unchanged: true as const, version };
  const items = allVacancies().map((v): Record<string, any> => {
    const row: Record<string, any> = { ...v.data, _file: relFile(v.file), _rev: fileRev(v.file) };
    const m = v.data.resume_match;
    // навыки — для быстрого поиска
    row._skills = m ? [...new Set([...(m.required ?? []), ...(m.nice_to_have ?? [])])] : [];
    for (const k of CARD_ONLY) delete row[k];
    return row;
  });
  return { unchanged: false as const, version, items, errors: loadErrors(), lastRun: readLastCollect() };
});
