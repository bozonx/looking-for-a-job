/**
 * In-memory index of data/vacancies/**.md. Files remain the source of truth:
 * chokidar keeps the cache in sync with edits made by the agent or scripts.
 */
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { VACANCIES_DIR } from '../../../scripts/lib/env.ts';
import { listVacancyFiles, parseVacancy, writeVacancy, type VacancyFile } from '../../../scripts/lib/vacancy.ts';

const byFile = new Map<string, VacancyFile>();
const errors = new Map<string, string>();
/** Ревизия файла: растёт при каждом изменении (UI по ней понимает, что открытую карточку пора перечитать). */
const revs = new Map<string, number>();
/** Версия всего индекса: растёт при любом изменении — клиент опрашивает список с ?since=<version>. */
let version = 1;
let watcher: FSWatcher | null = null;

function touch(file: string) {
  revs.set(file, (revs.get(file) ?? 0) + 1);
  version++;
}

const isVacancy = (f: string) => f.endsWith('.md');

function load(file: string) {
  try {
    byFile.set(file, parseVacancy(file));
    errors.delete(file);
  } catch (e) {
    byFile.delete(file);
    errors.set(file, (e as Error).message);
  }
  touch(file);
}

export function initStore() {
  if (watcher) return;
  for (const f of listVacancyFiles()) load(f);
  watcher = chokidar.watch(VACANCIES_DIR, {
    ignoreInitial: true,
    ignored: (p, st) => !!st?.isFile() && !isVacancy(p),
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });
  watcher.on('add', load).on('change', load).on('unlink', (f) => {
    byFile.delete(f);
    errors.delete(f);
    revs.delete(f);
    version++;
  });
}

export function allVacancies(): VacancyFile[] {
  initStore();
  return [...byFile.values()];
}

export const storeVersion = () => (initStore(), version);
export const fileRev = (file: string) => revs.get(file) ?? 0;

export function loadErrors() {
  return [...errors].map(([file, error]) => ({ file: path.relative(VACANCIES_DIR, file), error }));
}

export function findById(id: string): VacancyFile | undefined {
  return allVacancies().find((v) => v.data.id === id);
}

/** Re-read from disk before writing so concurrent agent edits are not lost. */
export function patchVacancy(id: string, patch: Record<string, unknown> | ((cur: Record<string, any>) => Record<string, any>)): VacancyFile | undefined {
  const cached = findById(id);
  if (!cached) return undefined;
  const fresh = parseVacancy(cached.file);
  const data = typeof patch === 'function' ? patch(fresh.data) : { ...fresh.data, ...patch };
  if (data === fresh.data) return fresh; // правка отклонена — файл не трогаем
  writeVacancy(cached.file, data, fresh.body);
  const v = { file: cached.file, data, body: fresh.body };
  byFile.set(cached.file, v);
  touch(cached.file);
  return v;
}

export function relFile(f: string) {
  return path.relative(VACANCIES_DIR, f);
}
