/** Тесты расчёта overall: `npm test`. Веса задаются в тесте, а не из config/, чтобы правка weights.yaml не ломала проверки логики. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOverall, loadWeights, regionGroup, type Weights } from './scoring.ts';
import { STOP_FLAGS } from './schema.ts';

const W: Weights = {
  version: 0,
  positive: { remote: 3, legitimacy: 2, fit: 8, region: 1, language: 2, startup: 1.5 },
  inverse: { corporate: 2, outsource: 0 },
  fit_tracks: { vue: 1, react: 0.9, angular: 0.8, fullstack: 0.9, ai_engineer: 1, automation: 0.8 },
  fit_cap: { below: 40, cap: 35 },
  scam_legitimacy_below: 30,
};
const fit = (o: Record<string, number | null> = {}) => ({ vue: 0, react: 0, angular: 0, fullstack: 0, ai_engineer: 0, automation: 0, ...o });
const base = (o: Record<string, unknown> = {}) => ({ remote: 95, startup: 80, corporate: 10, outsource: 0, legitimacy: 85, region: 70, language: 100, fit: fit({ vue: 90 }), ...o });

test('взвешенное среднее с обратными весами (пример из docs/how-it-works.md)', () => {
  assert.equal(computeOverall(W, base(), []).overall, 89);
});

test('любой стоп-флаг → 0', () => {
  for (const f of STOP_FLAGS) assert.equal(computeOverall(W, base(), [f]).overall, 0, f);
});

test('legitimacy < порога сам ставит scam', () => {
  const r = computeOverall(W, base({ legitimacy: 20 }), []);
  assert.equal(r.overall, 0);
  assert.deepEqual(r.flags, ['scam']);
});

test('неизвестный флаг не обнуляет', () => {
  assert.equal(computeOverall(W, base(), ['whatever']).overall, 89);
});

test('fit берёт лучший трек с учётом веса трека', () => {
  const a = computeOverall(W, base({ fit: fit({ angular: 90 }) }), []).overall; // 0.8·90 = 72
  const v = computeOverall(W, base({ fit: fit({ vue: 72 }) }), []).overall;
  assert.equal(a, v);
});

test('fit_cap: сырой fit < 40 → не выше 35', () => {
  assert.equal(computeOverall(W, base({ fit: fit({ fullstack: 30 }) }), []).overall, 35);
});

test('fit_cap по сырому fit: angular 45 (взвешенно 36) не режется', () => {
  assert.ok(computeOverall(W, base({ fit: fit({ angular: 45 }) }), []).overall > 35);
});

test('null-оценки и треки без веса выпадают из числителя и знаменателя', () => {
  const withNull = computeOverall(W, base({ region: null }), []).overall;
  const W2 = { ...W, positive: { ...W.positive, region: 0 } };
  assert.equal(withNull, computeOverall(W2, base(), []).overall);
  // automation: null (старые вакансии) не ломает расчёт
  assert.equal(computeOverall(W, base({ fit: fit({ vue: 90, automation: null }) }), []).overall, 89);
});

test('regionGroup: ru_speaking_team > страна > other > unknown', () => {
  const R = { anglo: { score: 100, countries: ['US'] }, other: { score: 40, countries: [] }, unknown: { score: 60, countries: [] } };
  assert.equal(regionGroup(R, 'US', true), 'ru_speaking_team');
  assert.equal(regionGroup(R, 'us', null), 'anglo');
  assert.equal(regionGroup(R, 'ZZ', null), 'other');
  assert.equal(regionGroup(R, null, null), 'unknown');
});

test('config/weights.yaml согласован с треками', () => {
  const real = loadWeights();
  for (const t of Object.keys(fit())) assert.ok(t in real.fit_tracks, `fit_tracks.${t}`);
  assert.ok(real.positive.fit > 0);
});

test('уровень junior ограничивает итог, сохраняя высокий fit по стеку', () => {
  const weights = { ...W, seniority_cap: { levels: ['junior'], cap: 35 } };
  const scores = base();
  assert.equal(computeOverall(weights, scores, [], 'junior').overall, 35);
  assert.equal(scores.fit.vue, 90);
  assert.equal(computeOverall(weights, scores, [], 'senior').overall, 89);
  assert.equal(computeOverall(weights, scores, ['location_restricted'], 'junior').overall, 0);
});

test('границы scam/fit и отсутствие оценок', () => {
  assert.equal(computeOverall(W, base({ legitimacy: 30 }), []).flags.includes('scam'), false);
  assert.equal(computeOverall(W, base({ legitimacy: 29 }), []).overall, 0);
  assert.ok(computeOverall(W, base({ fit: fit({ vue: 40 }) }), []).overall > 35);
  assert.equal(computeOverall(W, {}, []).overall, 0);
  assert.deepEqual(computeOverall(W, {}, ['scam', 'scam']).flags, ['scam']);
});
