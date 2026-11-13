/** Recompute scores.overall for all scored vacancies from config/weights.yaml (no LLM). */
import { computeOverall, loadWeights } from '../../../scripts/lib/scoring.ts';
import { parseVacancy, writeVacancy } from '../../../scripts/lib/vacancy.ts';

export default defineEventHandler(() => {
  const W = loadWeights();
  let n = 0;
  for (const cached of allVacancies()) {
    if (!cached.data.scores) continue;
    const v = parseVacancy(cached.file);
    if (!v.data.scores) continue;
    const { overall, flags } = computeOverall(W, v.data.scores, v.data.stop_flags ?? []);
    v.data.scores = { ...v.data.scores, overall };
    v.data.stop_flags = flags;
    writeVacancy(v.file, v.data, v.body);
    n++;
  }
  return { rescored: n, weightsVersion: W.version };
});
