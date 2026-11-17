import { TRACKS } from './enums.ts';

/** Лучший трек по взвешенному fit; равенство разрешается порядком TRACKS. */
export function bestTrack(fit: Record<string, unknown>, weights: Record<string, number>) {
  return TRACKS.filter(t => typeof fit[t] === 'number' && (weights[t] ?? 0) > 0)
    .sort((a, b) => (fit[b] as number) * weights[b]! - (fit[a] as number) * weights[a]!)[0] ?? null;
}

/**
 * Примерные курсы валют к USD для нормализации зарплат в фильтрах и сравнении.
 * Значения ориентировочные для оценки ежемесячного дохода в USD.
 */
export const CURRENCY_TO_USD: Record<string, number> = {
  USD: 1.0,
  EUR: 1.08,
  GBP: 1.28,
  CHF: 1.14,
  CAD: 0.73,
  AUD: 0.65,
  NZD: 0.60,
  SGD: 0.75,
  SEK: 0.093,
  NOK: 0.092,
  DKK: 0.145,
  PLN: 0.25,
  CZK: 0.043,
  HUF: 0.0027,
  RON: 0.22,
  BGN: 0.55,
  TRY: 0.028,
  ILS: 0.27,
  AED: 0.272,
  SAR: 0.266,
  QAR: 0.274,
  CNY: 0.14,
  JPY: 0.0066,
  KRW: 0.00072,
  INR: 0.012,
  THB: 0.029,
  VND: 0.000039,
  IDR: 0.000062,
  MYR: 0.225,
  PHP: 0.017,
  BRL: 0.17,
  MXN: 0.050,
  ARS: 0.00095,
  CLP: 0.00105,
  COP: 0.00024,
  PEN: 0.27,
  UYU: 0.024,
  ZAR: 0.055,
  // СНГ / постсоветское пространство
  RUB: 0.0105,
  RUR: 0.0105,
  KZT: 0.0020,
  KGS: 0.0115,
  UZS: 0.000078,
  BYN: 0.31,
  UAH: 0.024,
  GEL: 0.36,
  AMD: 0.0025,
  AZN: 0.588,
};

/** Норма рабочих часов в месяц при стандартной 40-часовой рабочей неделе (4 недели). */
export const HOURS_PER_MONTH = 160;

/**
 * Нормализация зарплаты в эквивалент USD/мес для фильтрации и сортировки.
 * Конвертирует периоды (year -> /12, month -> 1, hour -> *160) и применяет курс валюты.
 */
export function monthlyUsd(salary: { min: number | null; max: number | null; currency: string; period: string } | null | undefined): { min: number | null; max: number | null } | null {
  if (!salary) return null;
  const cur = salary.currency.toUpperCase();
  const rate = CURRENCY_TO_USD[cur];
  if (rate == null) return null;

  let periodMultiplier: number;
  if (salary.period === 'year') {
    periodMultiplier = 1 / 12;
  } else if (salary.period === 'month') {
    periodMultiplier = 1;
  } else if (salary.period === 'hour') {
    periodMultiplier = HOURS_PER_MONTH;
  } else {
    return null;
  }

  const factor = rate * periodMultiplier;
  const min = salary.min == null ? null : Math.round(salary.min * factor);
  const max = salary.max == null ? null : Math.round(salary.max * factor);

  if (min == null && max == null) return null;
  return { min, max };
}
