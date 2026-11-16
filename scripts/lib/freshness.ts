/**
 * Свежесть вакансии для скоринга: сколько дней после публикации на неё ещё есть смысл откликаться.
 * Секция `freshness_days` в config/sources.yaml: `default` + значения по источникам; null — без ограничения
 * (snapshot-источники: вакансия актуальна, пока открыта). Сбор от этого не зависит — только очередь скоринга.
 */
import { sourceConfig } from './job.ts';

const DEFAULT_DAYS = 7;
let cache: Record<string, number | null> | undefined;

export function freshnessDays(source: string): number | null {
  cache ??= sourceConfig<Record<string, number | null>>('freshness_days') ?? {};
  if (source in cache) return cache[source] ?? null;
  return cache.default === undefined ? DEFAULT_DAYS : (cache.default ?? null);
}
