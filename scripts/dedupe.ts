/**
 * --index: статистика индекса известных вакансий.
 * --check "<company>" "<title>" [url...]: найти дубль среди сохранённых.
 * --groups: найти вероятные дубли среди уже сохранённых (одинаковые company+title).
 */
import path from 'node:path';
import { loadAll } from './lib/vacancy.ts';
import { buildIndex, findDuplicate, key } from './lib/dedupe.ts';

const [cmd = '--index', ...rest] = process.argv.slice(2);
const all = loadAll();
const idx = buildIndex(all);

if (cmd === '--index') {
  console.log(`vacancies: ${all.length}, ids: ${idx.byId.size}, urls: ${idx.byUrl.size}, company+title keys: ${idx.byKey.size}`);
} else if (cmd === '--check') {
  const [company, title, ...urls] = rest;
  const m = findDuplicate(idx, { id: '\0', urls, company, title });
  console.log(m ? `DUPLICATE of ${m.vacancy.data.id} (${m.by}): ${path.relative(process.cwd(), m.vacancy.file)}` : 'NOT FOUND');
} else if (cmd === '--groups') {
  const g = new Map<string, string[]>();
  for (const v of all) {
    const k = key(v.data.company ?? '', v.data.title ?? '');
    g.set(k, [...(g.get(k) ?? []), v.data.id]);
  }
  for (const [k, ids] of g) if (ids.length > 1) console.log(`${k}: ${ids.join(', ')}`);
} else {
  console.error('usage: dedupe [--index | --check <company> <title> [urls...] | --groups]');
  process.exit(2);
}
