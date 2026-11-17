/** zod-проверка front matter всех вакансий (или переданных id/путей). Код выхода 1 при ошибках. */
import path from 'node:path';
import { listVacancyFiles, parseVacancy, resolveTargets } from './lib/vacancy.ts';
import { ScoredVacancySchema, VacancySchema } from './lib/schema.ts';
import { loadSkills, normSkill } from './lib/skills.ts';

const targets = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const files = targets.length ? resolveTargets(targets) : listVacancyFiles();
const ids = new Map<string, string>();
let bad = 0;
let pending = 0;
const skills = loadSkills();
for (const c of skills.conflicts) console.warn(`config/skills.yaml: написание в двух навыках ${c}`);
const unknownSkills = new Map<string, number>();
let warned = 0;

/** Проверки resume_match: обязателен при scoring_version ≥ 2 (кроме вакансий со stop_flags), навыки канонические, missing ⊆ required/nice. */
function checkResumeMatch(data: Record<string, any>, errs: string[], warns: string[]): void {
  const rm = data.resume_match;
  if (data.scores == null) return;
  if (!rm) {
    // стоп-флаг — короткий скоринг без resume_match (playbooks/scoring.md)
    if ((data.stop_flags ?? []).length) return;
    if ((data.scoring_version ?? 0) >= 2) errs.push('resume_match: обязателен при scoring_version ≥ 2');
    else warns.push('resume_match: нет (scoring_version 1) — перескорь по playbooks/scoring.md');
    return;
  }
  if (data.best_resume && rm.resume !== data.best_resume) warns.push(`resume_match.resume (${rm.resume}) ≠ best_resume (${data.best_resume})`);
  const lists = ['required', 'nice_to_have', 'missing_required', 'missing_nice'] as const;
  for (const l of lists)
    for (const s of rm[l] ?? []) {
      const n = normSkill(String(s), skills);
      if (n.aliased) errs.push(`resume_match.${l}: «${s}» → пиши каноническое «${n.name}»`);
      if (!n.known) unknownSkills.set(n.name, (unknownSkills.get(n.name) ?? 0) + 1);
    }
  const req = new Set((rm.required ?? []).map((s: string) => s.toLowerCase()));
  const nice = new Set((rm.nice_to_have ?? []).map((s: string) => s.toLowerCase()));
  for (const s of rm.missing_required ?? []) if (!req.has(String(s).toLowerCase())) errs.push(`resume_match.missing_required: «${s}» нет в required`);
  for (const s of rm.missing_nice ?? []) if (!nice.has(String(s).toLowerCase())) errs.push(`resume_match.missing_nice: «${s}» нет в nice_to_have`);
  // v3: обязанности, написания, домен
  if ((data.scoring_version ?? 0) >= 3) {
    if (!(rm.responsibilities ?? []).length) warns.push('resume_match.responsibilities: пусто (scoring_version 3)');
    if (rm.domain === undefined) warns.push('resume_match.domain: не заполнено (null, если неясно)');
  } else if ((data.scoring_version ?? 0) === 2 && !(data.stop_flags ?? []).length) warns.push('scoring_version 2: нет responsibilities/keyword_spellings/domain — дозаполни через npm run pending -- --upgrade');
  for (const r of rm.responsibilities ?? []) if (String(r).length > 80) warns.push(`resume_match.responsibilities: слишком длинно «${String(r).slice(0, 40)}…» — сократи до «глагол + объект»`);
  for (const k of Object.keys(rm.keyword_spellings ?? {})) {
    if (!req.has(k.toLowerCase()) && !nice.has(k.toLowerCase())) errs.push(`resume_match.keyword_spellings: «${k}» нет в required/nice_to_have`);
  }
}

for (const f of files) {
  const rel = path.relative(process.cwd(), f);
  let errs: string[] = [];
  const warns: string[] = [];
  try {
    const { data } = parseVacancy(f);
    const schema = data.scores == null ? VacancySchema : ScoredVacancySchema;
    if (data.scores == null) pending++;
    const r = schema.safeParse(data);
    if (!r.success) errs = r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    if (data.scores && typeof data.scores.overall !== 'number') errs.push('scores.overall: not computed — run npm run score');
    checkResumeMatch(data, errs, warns);
    if (ids.has(data.id)) errs.push(`id duplicates ${ids.get(data.id)}`);
    ids.set(data.id, rel);
  } catch (e) {
    errs = [(e as Error).message];
  }
  if (errs.length) {
    bad++;
    console.log(`✗ ${rel}\n${errs.map((e) => `    ${e}`).join('\n')}`);
  }
  if (warns.length) {
    warned++;
    console.log(`⚠ ${rel}\n${warns.map((e) => `    ${e}`).join('\n')}`);
  }
}
if (unknownSkills.size)
  console.log(
    `\n⚠ Навыки не из config/skills.yaml (добавь ключом или синонимом): ` +
      [...unknownSkills].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(', '),
  );
console.log(`\nChecked ${files.length}, invalid ${bad}, pending scoring ${pending}, with warnings ${warned}`);
process.exit(bad ? 1 : 0);
