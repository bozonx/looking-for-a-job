/** Список вакансий, ожидающих скоринга агентом (scores: null). --paths — только пути. */
import path from 'node:path';
import { loadAll } from './lib/vacancy.ts';

const pending = loadAll().filter((v) => v.data.scores == null && v.data.status === 'new');
const onlyPaths = process.argv.includes('--paths');
for (const v of pending) {
  const rel = path.relative(process.cwd(), v.file);
  console.log(onlyPaths ? rel : `${rel}\n    ${v.data.id} · ${v.data.title} — ${v.data.company} · ${v.data.location ?? ''}`);
}
if (!onlyPaths) console.log(`\nPending: ${pending.length}`);
