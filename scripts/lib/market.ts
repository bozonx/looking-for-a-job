/**
 * «Рынок трека» для анализа резюме (npm run insights, playbooks/analyze.md).
 * Вакансии со стоп-флагом по локации нам недоступны, но о требованиях индустрии говорят то же самое,
 * поэтому в статистику спроса они входят. Не входят: стоп-флаги, где вакансия не показательна
 * (российские госкомпании, неадекват, скам), и роли с низким fit (не наш трек).
 */
/** Минимальный fit трека, чтобы вакансия считалась рынком этого трека. */
export const MARKET_FIT = 50;
/** Стоп-флаги, при которых вакансия не показательна для рынка. */
export const NON_MARKET_FLAGS = new Set(['ru_corporate', 'inadequate', 'scam']);

const maxFit = (d: any) => Math.max(0, ...Object.values(d.scores?.fit ?? {}).map(Number).filter(Number.isFinite));
const marketFlags = (d: any) => !(d.stop_flags ?? []).some((f: string) => NON_MARKET_FLAGS.has(f));

/** Вакансия входит в рынок трека resume_match.resume. */
export const inMarket = (d: any): boolean =>
  !!d.resume_match && marketFlags(d) && Number(d.scores?.fit?.[d.resume_match.resume] ?? 0) >= MARKET_FIT;

/** Короткий скоринг со стоп-флагом по локации без рыночных полей — кандидат на дозаполнение (pending --market). */
export const needsMarketFields = (d: any): boolean =>
  !!d.scores && !d.resume_match && (d.stop_flags ?? []).length > 0 && marketFlags(d) && maxFit(d) >= MARKET_FIT;
