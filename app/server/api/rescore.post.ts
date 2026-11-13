/** Recompute derived fields + scores.overall for all scored vacancies (same logic as `npm run rescore`, no LLM). */
import { loadRescoreCtx, rescoreVacancy } from '../../../scripts/lib/rescore.ts';
import { parseVacancy, writeVacancy } from '../../../scripts/lib/vacancy.ts';

export default defineEventHandler(() => {
  const ctx = loadRescoreCtx();
  let n = 0;
  const failed: { file: string; error: string }[] = [];
  for (const cached of allVacancies()) {
    if (!cached.data.scores) continue;
    try {
      const v = parseVacancy(cached.file);
      if (!rescoreVacancy(v, ctx)) continue;
      writeVacancy(v.file, v.data, v.body);
      n++;
    } catch (e) {
      failed.push({ file: relFile(cached.file), error: (e as Error).message });
    }
  }
  return { rescored: n, failed, weightsVersion: ctx.W.version };
});
