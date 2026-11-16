import fs from 'node:fs';
import path from 'node:path';
import { RUNS_DIR, today } from './env.ts';

/** Append a section to data/runs/<date>-<kind>.md */
export function appendRunLog(kind: string, markdown: string): string {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const file = path.join(RUNS_DIR, `${today()}-${kind}.md`);
  const head = fs.existsSync(file) ? '' : `# ${today()} — ${kind}\n\n`;
  fs.appendFileSync(file, `${head}${markdown.trim()}\n\n`);
  return file;
}

/** Машиночитаемая метрика прогона: строка JSON в data/runs/stats.jsonl (для npm run insights). */
export function appendRunStats(record: Record<string, unknown>): void {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.appendFileSync(path.join(RUNS_DIR, 'stats.jsonl'), JSON.stringify({ date: today(), at: new Date().toISOString(), ...record }) + '\n');
}
