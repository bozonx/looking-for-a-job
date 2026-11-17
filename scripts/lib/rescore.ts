/** Shared by scripts/score.ts and the UI's POST /api/rescore — one place for derived-field logic. */
import { computeOverall, loadRegions, loadWeights, regionGroup, type Regions, type Weights } from './scoring.ts';
import { deriveApply } from './target.ts';
import { channelFromUrl, mergeChannels } from './channels.ts';
import { ScoredVacancySchema } from './schema.ts';
import type { VacancyFile } from './vacancy.ts';

export interface RescoreCtx {
  W: Weights;
  R: Regions;
}

export function loadRescoreCtx(): RescoreCtx {
  return { W: loadWeights(), R: loadRegions() };
}

/**
 * Recompute derived fields in place: region, scores.region, apply_channels (+real_url), apply_method, apply_target, scores.overall, stop_flags.
 * Returns null if the vacancy is not scored yet. Throws if the result fails schema validation.
 */
export function rescoreVacancy(v: VacancyFile, { W, R }: RescoreCtx): { overall: number; flags: string[] } | null {
  const d = v.data;
  const s = d.scores;
  if (!s) return null;
  d.region = regionGroup(R, d.company_country, d.ru_speaking_team) as typeof d.region;
  s.region = R[d.region!]?.score ?? null;
  // каналы: агент мог дописать real_url — добавляем его; извлечение из текста делает сбор / npm run channels
  d.apply_channels = mergeChannels(d.apply_channels, [channelFromUrl(d.real_url, 'agent')]);
  deriveApply(d);
  const res = computeOverall(W, s, d.stop_flags ?? []);
  d.scores = { ...s, overall: res.overall };
  d.stop_flags = res.flags;
  const check = ScoredVacancySchema.safeParse(d);
  if (!check.success) throw new Error(`${d.id}: ${check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return res;
}
