/**
 * Последний запуск `npm run collect`: data/state/last-collect.json ({ run: ISO }).
 * Вакансии с `collected_run === run` UI показывает как «новые» (собраны последним прогоном).
 * Пишется в конце каждого не-dry-run запуска, даже если новых вакансий не было — тогда «новых» нет.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './env.ts';

const FILE = path.join(DATA_DIR, 'state', 'last-collect.json');

export function readLastCollect(): string | null {
  try {
    const v = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return typeof v?.run === 'string' ? v.run : null;
  } catch {
    return null;
  }
}

export function writeLastCollect(run: string): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ run }, null, 1));
}
