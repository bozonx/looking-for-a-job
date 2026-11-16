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
  CLEANUP_DEFAULT_DAYS: num('CLEANUP_DEFAULT_DAYS', 30),
};

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
