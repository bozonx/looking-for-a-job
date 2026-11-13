/** zod-проверка front matter всех вакансий (или переданных id/путей). Код выхода 1 при ошибках. */
import path from 'node:path';
import { listVacancyFiles, parseVacancy, resolveTargets } from './lib/vacancy.ts';
import { ScoredVacancySchema, VacancySchema } from './lib/schema.ts';

const targets = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const files = targets.length ? resolveTargets(targets) : listVacancyFiles();
const ids = new Map<string, string>();
let bad = 0;
let pending = 0;

for (const f of files) {
  const rel = path.relative(process.cwd(), f);
  let errs: string[] = [];
  try {
    const { data } = parseVacancy(f);
    const schema = data.scores == null ? VacancySchema : ScoredVacancySchema;
    if (data.scores == null) pending++;
    const r = schema.safeParse(data);
    if (!r.success) errs = r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    if (data.scores && typeof data.scores.overall !== 'number') errs.push('scores.overall: not computed — run npm run score');
    if (ids.has(data.id)) errs.push(`id duplicates ${ids.get(data.id)}`);
    ids.set(data.id, rel);
  } catch (e) {
    errs = [(e as Error).message];
  }
  if (errs.length) {
    bad++;
    console.log(`✗ ${rel}\n${errs.map((e) => `    ${e}`).join('\n')}`);
  }
}
console.log(`\nChecked ${files.length}, invalid ${bad}, pending scoring ${pending}`);
process.exit(bad ? 1 : 0);
