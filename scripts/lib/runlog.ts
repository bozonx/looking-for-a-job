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

/** Текущий размер лога (точка вставки для insertRunLog). */
export function runLogOffset(kind: string): number {
  const file = path.join(RUNS_DIR, `${today()}-${kind}.md`);
  return fs.existsSync(file) ? fs.statSync(file).size : 0;
}

/** Вставить раздел в лог по смещению (перед разделами, дописанными после runLogOffset). */
export function insertRunLog(kind: string, markdown: string, offset: number): string {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const file = path.join(RUNS_DIR, `${today()}-${kind}.md`);
  const buf = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
  const head = `# ${today()} — ${kind}\n\n`;
  // новый файл: offset 0 указывает на начало — заголовок дня оставляем первым
  const at = offset === 0 && buf.toString('utf8', 0, head.length * 3).startsWith(`# ${today()}`) ? Buffer.byteLength(head) : offset;
  const body = buf.length ? Buffer.concat([buf.subarray(0, at), Buffer.from(`${markdown.trim()}\n\n`), buf.subarray(at)]) : Buffer.from(`${head}${markdown.trim()}\n\n`);
  fs.writeFileSync(file, body);
  return file;
}

/** Машиночитаемая метрика прогона: строка JSON в data/runs/stats.jsonl (для npm run insights). */
export function appendRunStats(record: Record<string, unknown>): void {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.appendFileSync(path.join(RUNS_DIR, 'stats.jsonl'), JSON.stringify({ date: today(), at: new Date().toISOString(), ...record }) + '\n');
}
