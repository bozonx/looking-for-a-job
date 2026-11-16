/**
 * id вакансий, отскоренных сегодня (`npm run score` без аргументов): data/state/last-scored.json.
 * Источник для `npm run top` — топ именно этого «собери», а не всей базы.
 * Повторный `npm run score` в тот же день дополняет список (после правок по validate он считает 0).
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, today } from './env.ts';

const FILE = path.join(DATA_DIR, 'state', 'last-scored.json');

export function readLastScored(): { date: string; ids: string[] } {
  try {
    const v = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (typeof v?.date === 'string' && Array.isArray(v.ids)) return v;
  } catch {
    /* нет файла */
  }
  return { date: '', ids: [] };
}

export function addLastScored(ids: string[]): void {
  if (!ids.length) return;
  const prev = readLastScored();
  const base = prev.date === today() ? prev.ids : [];
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ date: today(), ids: [...new Set([...base, ...ids])] }, null, 1));
}
