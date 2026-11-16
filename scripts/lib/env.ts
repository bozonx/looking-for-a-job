import path from 'node:path';

/** JOB_ROOT is injected by the Nuxt/Nitro bundle (import.meta.dirname is wrong after bundling). */
export const ROOT = process.env.JOB_ROOT || path.resolve(import.meta.dirname, '../..');
export const DATA_DIR = path.join(ROOT, 'data');
export const VACANCIES_DIR = path.join(DATA_DIR, 'vacancies');
export const RUNS_DIR = path.join(DATA_DIR, 'runs');
export const CONFIG_DIR = path.join(ROOT, 'config');

function num(name: string, def: number): number {
  const v = process.env[name];
  const n = v === undefined || v === '' ? def : Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env ${name} must be a number, got "${v}"`);
  return n;
}

export const env = {
  COLLECT_MAX_PAGES: num('COLLECT_MAX_PAGES', 5),
  COLLECT_MAX_AGE_DAYS: num('COLLECT_MAX_AGE_DAYS', 30),
  COLLECT_STOP_ON_SEEN: num('COLLECT_STOP_ON_SEEN', 5),
  COLLECT_MAX_NEW: num('COLLECT_MAX_NEW', 300),
  SCORE_MAX_PER_RUN: num('SCORE_MAX_PER_RUN', 50),
  APPLY_SCORE_THRESHOLD: num('APPLY_SCORE_THRESHOLD', 80),
  APPLY_MAX_PER_RUN: num('APPLY_MAX_PER_RUN', 15),
  APPLY_CONFIRM_SCORED: !['false', '0', 'no'].includes((process.env.APPLY_CONFIRM_SCORED ?? 'true').toLowerCase()),
  LINKEDIN_APPLY_MAX_PER_DAY: num('LINKEDIN_APPLY_MAX_PER_DAY', 5),
  FILL_DELAY_MIN_MS: num('FILL_DELAY_MIN_MS', 300),
  FILL_DELAY_MAX_MS: num('FILL_DELAY_MAX_MS', 1500),
  TYPE_DELAY_MS: num('TYPE_DELAY_MS', 40),
  BROWSER_CDP_URL: process.env.BROWSER_CDP_URL || 'http://127.0.0.1:9222',
  CLEANUP_DEFAULT_DAYS: num('CLEANUP_DEFAULT_DAYS', 30),
  CLEANUP_ON_COLLECT: !['false', '0', 'no'].includes((process.env.CLEANUP_ON_COLLECT ?? 'true').toLowerCase()),
};

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
