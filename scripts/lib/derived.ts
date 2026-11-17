import { TRACKS } from './enums.ts';

/** Лучший трек по взвешенному fit; равенство разрешается порядком TRACKS. */
export function bestTrack(fit: Record<string, unknown>, weights: Record<string, number>) {
  return TRACKS.filter(t => typeof fit[t] === 'number' && (weights[t] ?? 0) > 0)
    .sort((a, b) => (fit[b] as number) * weights[b]! - (fit[a] as number) * weights[a]!)[0] ?? null;
}

/** Без валютных догадок: нормализуем только USD, часы без нормы рабочего времени неизвестны. */
export function monthlyUsd(salary: { min: number | null; max: number | null; currency: string; period: string } | null | undefined) {
  if (!salary || salary.currency.toUpperCase() !== 'USD' || !['year', 'month'].includes(salary.period)) return null;
  const divisor = salary.period === 'year' ? 12 : 1;
  return { min: salary.min == null ? null : Math.round(salary.min / divisor), max: salary.max == null ? null : Math.round(salary.max / divisor) };
}
