/**
 * Проверка резюме (заготовки трека или резюме под вакансию) перед рендером/отправкой.
 *
 *   npm run resume-check -- --track vue            заготовка profile/resumes/vue.md
 *   npm run resume-check -- --tracks               все заготовки
 *   npm run resume-check -- --file data/generated/<id>/resume.en.md [--vacancy <id>]
 *
 * Ошибки (✗, код 1): технология новее места работы (config/tech-dates.yaml), неподставленный плейсхолдер {FE},
 *   неизвестный проект, required вакансии из пула навыков, которого нет в тексте резюме.
 * Предупреждения (⚠): число пунктов/проектов/страниц вне лимитов (config/resume-tracks.yaml), процентов больше,
 *   чем абсолютных цифр, должность последнего места не как в треке, required вакансии вне пула (вопрос пользователю).
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, CONFIG_DIR } from './lib/env.ts';
import { loadAll } from './lib/vacancy.ts';
import { loadSkills, normSkill } from './lib/skills.ts';
import { skillsInText } from './lib/resumeskills.ts';
import {
  PROFILE, splitFrontMatter, stripComments, readProjects, projectRefs, softSkillRefs, readSoftSkillsPool, loadTracks, loadTechDates, parseJobs, anachronisms,
} from './lib/resume.ts';

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

const ABS_RE = /\b\d[\d,.]*\s?(ms|s|sec|seconds|min|minutes|h|hours|KB|MB|GB|k\b|x\b|×)|\b\d[\d,]{2,}\+?\s/i;
const PCT_RE = /\d\s?%/;

interface Report {
  errors: string[];
  warns: string[];
}

function checkFile(file: string, track: string | null, vacancyId: string | null): Report {
  const r: Report = { errors: [], warns: [] };
  const { data, body } = splitFrontMatter(readFileSync(file, 'utf8'));
  const text = stripComments(body);
  const cfg = loadTracks();
  const dates = loadTechDates();

  // плейсхолдеры из facts.md
  for (const m of new Set(text.match(/\{(FE|STATE|META|BE)\}/g) ?? [])) r.errors.push(`неподставленный плейсхолдер ${m}`);

  // места работы: анахронизмы и число пунктов
  const jobs = parseJobs(text);
  if (!jobs.length) r.warns.push('не найдена секция опыта (## Experience / ## Опыт / ## Experiencia)');
  jobs.forEach((j, i) => {
    for (const [tech, year] of anachronisms(j, dates)) r.errors.push(`«${j.heading}» (до ${j.endYear}): ${tech} вышел в ${year}`);
    const max = cfg.limits.bullets[i] ?? cfg.limits.bullets.at(-1)!;
    const min = cfg.limits.min_bullets[i] ?? cfg.limits.min_bullets.at(-1)!;
    if (j.bullets.length > max) r.warns.push(`«${j.heading}»: ${j.bullets.length} пунктов, лимит ${max}`);
    if (j.bullets.length < min) r.warns.push(`«${j.heading}»: ${j.bullets.length} пунктов, минимум ${min}`);
  });
  const bullets = jobs.flatMap((j) => j.bullets);
  const pct = bullets.filter((b) => PCT_RE.test(b)).length;
  const abs = bullets.filter((b) => ABS_RE.test(b)).length;
  if (pct > abs) r.warns.push(`процентов в пунктах (${pct}) больше, чем абсолютных цифр (${abs}) — замени на мс/КБ/шт из facts.md`);

  // должность последнего места — как в треке
  const tcfg = track ? cfg.tracks[track] : null;
  if (tcfg && jobs[0]) {
    const want = tcfg.places[cfg.jobs[0]!]?.title;
    if (want && !jobs[0].heading.includes(want)) r.warns.push(`должность на ${cfg.jobs[0]}: «${jobs[0].heading}», в треке — «${want}»`);
  }

  // проекты
  const all = readProjects();
  const refs = projectRefs(data.projects);
  for (const p of refs) if (!all.has(p.id)) r.errors.push(`проект «${p.id}» не найден в profile/projects.md`);
  const [pmin, pmax] = cfg.limits.projects;
  if (refs.length < pmin || refs.length > pmax) r.warns.push(`проектов ${refs.length}, нужно ${pmin}–${pmax}`);

  // soft skills
  const softPool = readSoftSkillsPool();
  const softRefs = softSkillRefs(data.soft_skills);
  for (const s of softRefs) if (!softPool.has(s.id)) r.errors.push(`soft skill «${s.id}» не найден в profile/soft-skills.md`);
  if (softRefs.length && cfg.limits.soft_skills) {
    const [smin, smax] = cfg.limits.soft_skills;
    if (softRefs.length < smin || softRefs.length > smax) r.warns.push(`soft skills ${softRefs.length}, нужно ${smin}–${smax}`);
  }

  // покрытие вакансии
  const vid = vacancyId ?? data.vacancy ?? null;
  if (vid) {
    const v = loadAll().find((x) => x.data.id === vid);
    if (!v) r.warns.push(`вакансия ${vid} не найдена`);
    else if (!v.data.resume_match) r.warns.push(`у вакансии ${vid} нет resume_match — покрытие не проверено`);
    else {
      const dict = loadSkills();
      const projText = refs.map((p) => `${p.desc ?? ''} ${all.get(p.id)?.stack ?? ''}`).join(' ');
      const have = skillsInText(text + ' ' + projText, dict);
      const pool = skillsInText(readFileSync(join(PROFILE, 'facts.md'), 'utf8'), dict);
      for (const [kind, list] of [['required', v.data.resume_match.required], ['nice_to_have', v.data.resume_match.nice_to_have]] as const) {
        for (const s of (list ?? []) as string[]) {
          const n = normSkill(String(s), dict).name;
          if (have.has(n)) continue;
          if (pool.has(n)) (kind === 'required' ? r.errors : r.warns).push(`${kind} «${s}» есть в facts.md, но не в резюме`);
          else r.warns.push(`${kind} «${s}» нет в facts.md — вопрос пользователю (profile/questions.md)`);
        }
      }

      // покрытие soft_requirements вакансии
      if (softPool.size) {
        const softDict = loadSkills(join(CONFIG_DIR, 'soft-requirements.yaml'));
        const defaultCount = cfg.limits.soft_skills_default ?? 7;
        const activeIds = new Set(softRefs.length ? softRefs.map((s) => s.id) : [...softPool.keys()].slice(0, defaultCount));
        for (const req of (v.data.resume_match.soft_requirements ?? []) as string[]) {
          const canon = normSkill(String(req), softDict).name.toLowerCase();
          const raw = String(req).toLowerCase().trim();
          const matching = [...softPool.values()].filter(
            (sk) => sk.id === canon || sk.id === raw || sk.tags.some((t) => t === canon || t === raw || normSkill(t, softDict).name.toLowerCase() === canon),
          );
          if (matching.length && !matching.some((sk) => activeIds.has(sk.id))) {
            r.warns.push(`soft_requirements «${req}» покрывается в soft-skills.md (${matching.map((m) => m.id).join(', ')}), но не включён в soft_skills резюме`);
          }
        }
      }
    }
  }

  // страницы PDF рядом (если уже собран)
  const dir = dirname(file);
  const pdf = readdirSync(dir).find((f) => f.endsWith('.pdf') && (!track || f.includes(`_${track}_`)));
  if (pdf) {
    try {
      const info = execFileSync('pdfinfo', [join(dir, pdf)], { encoding: 'utf8' });
      const pages = Number(info.match(/Pages:\s+(\d+)/)?.[1]);
      if (pages > cfg.limits.pages) r.warns.push(`${pdf}: ${pages} стр., лимит ${cfg.limits.pages}`);
    } catch {}
  }
  return r;
}

function main(): void {
  const cfg = loadTracks();
  const targets: { file: string; track: string | null }[] = [];
  const trackFile = (t: string) => join(PROFILE, 'resumes', `${cfg.tracks[t]?.file ?? t}.md`);
  if (flag('tracks')) for (const t of Object.keys(cfg.tracks)) targets.push({ file: trackFile(t), track: t });
  else if (arg('track')) targets.push({ file: trackFile(arg('track')!), track: arg('track')! });
  else if (arg('file')) targets.push({ file: resolve(arg('file')!), track: null });
  else {
    console.error('usage: npm run resume-check -- --track <трек> | --tracks | --file <md> [--vacancy <id>]');
    process.exit(2);
  }
  let failed = false;
  for (const t of targets) {
    if (!existsSync(t.file)) {
      console.log(`✗ нет ${t.file.replace(ROOT + '/', '')}`);
      failed = true;
      continue;
    }
    const r = checkFile(t.file, t.track, arg('vacancy') ?? null);
    const name = t.file.replace(ROOT + '/', '');
    console.log(`${r.errors.length ? '✗' : '✓'} ${name}${r.errors.length + r.warns.length ? '' : ' — ок'}`);
    for (const e of r.errors) console.log(`  ✗ ${e}`);
    for (const w of r.warns) console.log(`  ⚠ ${w}`);
    if (r.errors.length) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

main();
