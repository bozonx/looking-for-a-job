/** Совместимая миграция производных полей. По умолчанию только предварительный просмотр. */
import { loadAll, writeVacancy } from './lib/vacancy.ts';
import { bestTrack, monthlyUsd } from './lib/derived.ts';
import { loadWeights } from './lib/scoring.ts';
import { VacancySchema } from './lib/schema.ts';

const apply = process.argv.includes('--write');
const weights = loadWeights();
const changes = loadAll().flatMap(v => {
  const data: Record<string, any> = { ...v.data, salary_usd_month: monthlyUsd(v.data.salary),
    employer_group: v.data.region ?? null,
    best_track: v.data.scores ? bestTrack(v.data.scores.fit ?? {}, weights.fit_tracks) : null };
  if (JSON.stringify(data) === JSON.stringify(v.data)) return [];
  return [{ ...v, data }];
});
// Проверяем весь набор до первой записи, чтобы ошибка схемы не оставила частичную миграцию.
for (const v of changes) {
  const result = VacancySchema.safeParse(v.data);
  if (!result.success) throw new Error(`${v.data.id}: ${result.error.message}`);
}
for (const v of changes) {
  console.log(`${apply ? 'Обновлено' : 'Будет обновлено'}: ${v.data.id}`);
  if (apply) writeVacancy(v.file, v.data, v.body);
}
console.log(`Всего: ${changes.length}. ${apply ? 'После записи: npm run validate' : 'Для записи: npm run migrate-scoring -- --write'}`);
