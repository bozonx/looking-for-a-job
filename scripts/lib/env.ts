import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '../..');
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
  COLLECT_MAX_AGE_DAYS: num('COLLECT_MAX_AGE_DAYS', 7),
  COLLECT_STOP_ON_SEEN: num('COLLECT_STOP_ON_SEEN', 5),
};

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
