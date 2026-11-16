/**
 * Время последнего полного сбора каждого источника: data/state/lastrun.json ({ source: ISO }).
 * По нему считается окно сбора (с прошлого раза + запас) и соблюдается минимальный интервал площадки.
 * «Полный» — лента дочитана до конца или до известных/старых; при обрыве (ошибка, лимиты) не обновляется,
 * чтобы следующий запуск снова взял пропущенный хвост.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './env.ts';

const FILE = path.join(DATA_DIR, 'state', 'lastrun.json');

function read(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** мс последнего полного сбора источника или null */
export function lastRun(source: string): number | null {
  const v = read()[source];
  const n = v ? Date.parse(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function setLastRun(source: string, at: number): void {
  const all = read();
  all[source] = new Date(at).toISOString();
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(all, null, 1));
}
