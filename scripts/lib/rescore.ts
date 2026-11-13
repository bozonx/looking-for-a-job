/** Shared by scripts/score.ts and the UI's POST /api/rescore — one place for derived-field logic. */
import { computeOverall, loadRegions, loadWeights, type Weights } from './scoring.ts';
import { applyMethodFromUrl, pickApplyTarget } from './target.ts';
import { ScoredVacancySchema } from './schema.ts';
import type { VacancyFile } from './vacancy.ts';

export interface RescoreCtx {
  W: Weights;
  R: ReturnType<typeof loadRegions>;
}

export function loadRescoreCtx(): RescoreCtx {
  return { W: loadWeights(), R: loadRegions() };
}

/**
 * Recompute derived fields in place: scores.region, apply_method, apply_target, scores.overall, stop_flags.
 * Returns null if the vacancy is not scored yet. Throws if the result fails schema validation.
 */
export function rescoreVacancy(v: VacancyFile, { W, R }: RescoreCtx): { overall: number; flags: string[] } | null {
  const d = v.data;
  const s = d.scores;
  if (!s) return null;
  if (d.region && typeof R[d.region] === 'number') s.region = R[d.region];
  if (d.real_url && (!d.apply_method || d.apply_method === 'unknown')) d.apply_method = applyMethodFromUrl(d.real_url);
  d.apply_target = pickApplyTarget(d);
  const res = computeOverall(W, s, d.stop_flags ?? []);
  d.scores = { ...s, overall: res.overall };
  d.stop_flags = res.flags;
  const check = ScoredVacancySchema.safeParse(d);
  if (!check.success) throw new Error(`${d.id}: ${check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return res;
}
