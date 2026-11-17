/**
 * Общие части резюме: разбор профиля (проекты, soft skills, образование), конфиг треков и дат технологий,
 * разбор опыта в markdown резюме. Используют scripts/render-resume.ts и scripts/resume-check.ts.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ROOT } from './env.ts';

export const PROFILE = join(ROOT, 'profile');
export const LANGS = ['en', 'ru', 'es'] as const;
export type Lang = (typeof LANGS)[number];

export const stripComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '');

export function splitFrontMatter(text: string): { data: Record<string, any>; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: text };
  return { data: (parseYaml(m[1]!) as Record<string, any>) ?? {}, body: text.slice(m[0].length) };
}

// ---------- проекты

export interface Project {
  id: string;
  name: string;
  links: string[];
  stack: string;
  topics: string[];
  desc: Partial<Record<Lang, string>>;
  highlights: { tags: string[]; text: string }[];
}

export function parseProjects(text: string): Map<string, Project> {
  const out = new Map<string, Project>();
  for (const sec of stripComments(text).split(/^## /m).slice(1)) {
    const [idLine, ...rest] = sec.split('\n');
    const f: Record<string, string> = {};
    const highlights: Project['highlights'] = [];
    for (const l of rest) {
      const h = l.match(/^- hl\[([^\]]*)\]:\s*(.+)$/);
      if (h) {
        highlights.push({ tags: h[1]!.split(',').map((s) => s.trim()).filter(Boolean), text: h[2]!.trim() });
        continue;
      }
      const m = l.match(/^- (\w+):\s*(.*)$/);
      if (m) f[m[1]!] = m[2]!.trim();
    }
    const id = idLine!.trim();
    out.set(id, {
      id,
      name: f.name || id,
      links: (f.links ?? '').split('|').map((s) => s.trim()).filter(Boolean),
      stack: f.stack ?? '',
      topics: (f.topics ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      desc: { en: f.en, ru: f.ru, es: f.es },
      highlights,
    });
  }
  return out;
}

export function readProjects(): Map<string, Project> {
  const file = join(PROFILE, 'projects.md');
  return existsSync(file) ? parseProjects(readFileSync(file, 'utf8')) : new Map();
}

/** Элемент `projects:` во front matter: id или {id, desc} (описание под вакансию). */
export type ProjectRef = { id: string; desc?: string };
export function projectRefs(raw: unknown): ProjectRef[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => (typeof p === 'string' ? { id: p } : { id: String(p?.id ?? ''), desc: p?.desc ? String(p.desc) : undefined }));
}

// ---------- soft skills, образование

export interface SoftSkill {
  id: string;
  tags: string[];
  text: Partial<Record<Lang, string>>;
  proof?: string;
}

/** Элемент `soft_skills:` во front matter: id или {id, text} (формулировка под вакансию). */
export type SoftSkillRef = { id: string; text?: string };
export function softSkillRefs(raw: unknown): SoftSkillRef[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => (typeof s === 'string' ? { id: s } : { id: String(s?.id ?? ''), text: s?.text ? String(s.text) : undefined }));
}

/** Пункты из раздела «## <lang>» файла (обратная совместимость для старого формата soft-skills.md). */
export function langSection(text: string, lang: Lang): string[] {
  const m = stripComments(text).match(new RegExp(`^## ${lang}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'));
  return (m?.[1] ?? '').split('\n').map((l) => l.match(/^- (.+)$/)?.[1]?.trim()).filter((s): s is string => !!s);
}

/** Пул soft skills в порядке приоритета из profile/soft-skills.md (секции `## <id>` или legacy `## en/ru/es`). */
export function parseSoftSkills(text: string): Map<string, SoftSkill> {
  const clean = stripComments(text);
  const secs = clean.split(/^## /m).slice(1);
  const headings = secs.map((s) => s.split('\n')[0]!.trim());
  const out = new Map<string, SoftSkill>();
  if (headings.length && headings.every((h) => (LANGS as readonly string[]).includes(h) || /доказательства|proof/i.test(h))) {
    const byLang: Record<Lang, string[]> = { en: langSection(clean, 'en'), ru: langSection(clean, 'ru'), es: langSection(clean, 'es') };
    const max = Math.max(byLang.en.length, byLang.ru.length, byLang.es.length);
    for (let i = 0; i < max; i++) {
      const id = `skill-${i + 1}`;
      out.set(id, { id, tags: [], text: { en: byLang.en[i], ru: byLang.ru[i], es: byLang.es[i] } });
    }
    return out;
  }
  for (const sec of secs) {
    const [idLine, ...rest] = sec.split('\n');
    const id = idLine!.trim();
    if (!id || /доказательства|proof/i.test(id)) continue;
    const f: Record<string, string> = {};
    for (const l of rest) {
      const m = l.match(/^- (\w+):\s*(.*)$/);
      if (m) f[m[1]!] = m[2]!.trim();
    }
    out.set(id, {
      id,
      tags: (f.tags ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      text: { en: f.en, ru: f.ru, es: f.es },
      proof: f.proof || undefined,
    });
  }
  return out;
}

export function readSoftSkillsPool(): Map<string, SoftSkill> {
  const f = join(PROFILE, 'soft-skills.md');
  return existsSync(f) ? parseSoftSkills(readFileSync(f, 'utf8')) : new Map();
}

/**
 * Список строк soft skills для резюме:
 * - если переданы refs (из front matter `soft_skills:` или CLI `--soft-skills`) — берём их в указанном порядке;
 * - иначе — первые `defaultCount` (по умолчанию из config/resume-tracks.yaml → limits.soft_skills_default ?? 7) из пула.
 */
export function resolveSoftSkills(
  pool: Map<string, SoftSkill>,
  lang: Lang,
  refs?: SoftSkillRef[],
  defaultCount = 7,
): string[] {
  const chosen: SoftSkillRef[] = refs?.length
    ? refs
    : [...pool.keys()].slice(0, defaultCount).map((id) => ({ id }));
  const out: string[] = [];
  for (const { id, text } of chosen) {
    const item = pool.get(id);
    if (!item) {
      if (text) out.push(text);
      continue;
    }
    const line = text ?? item.text[lang] ?? item.text.en ?? '';
    if (line) out.push(line);
  }
  return out;
}

export function readSoftSkills(lang: Lang, refs?: SoftSkillRef[], defaultCount?: number): string[] {
  const pool = readSoftSkillsPool();
  if (!pool.size) return [];
  const limit = defaultCount ?? (loadTracks().limits.soft_skills_default ?? 7);
  return resolveSoftSkills(pool, lang, refs, limit);
}

/** Строки «- <lang>: …» из раздела «## Образование» facts.md. */
export function parseEducation(text: string, lang: Lang): string[] {
  const sec = stripComments(text).match(/^## Образование\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1] ?? '';
  return sec.split('\n').map((l) => l.match(new RegExp(`^- ${lang}:\\s*(.+)$`))?.[1]?.trim()).filter((s): s is string => !!s);
}

export function readEducation(lang: Lang): string[] {
  const f = join(PROFILE, 'facts.md');
  return existsSync(f) ? parseEducation(readFileSync(f, 'utf8'), lang) : [];
}

// ---------- конфиги

export interface TracksConfig {
  stacks: Record<string, Record<string, string | string[]>>;
  jobs: string[];
  tracks: Record<string, { file?: string; title: string; projects: string[]; soft_skills?: string[]; places: Record<string, { stack: string[]; title: string; focus?: string }> }>;
  title_variants: string[];
  limits: {
    bullets: number[];
    min_bullets: number[];
    projects: [number, number];
    soft_skills_default?: number;
    soft_skills?: [number, number];
    pages: number;
  };
}

export const loadTracks = (): TracksConfig => parseYaml(readFileSync(join(ROOT, 'config', 'resume-tracks.yaml'), 'utf8'));
export const loadTechDates = (): Record<string, number> => parseYaml(readFileSync(join(ROOT, 'config', 'tech-dates.yaml'), 'utf8'));

// ---------- разбор опыта

export interface JobBlock {
  heading: string;
  /** год окончания (Present → текущий) */
  endYear: number | null;
  text: string;
  bullets: string[];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Места работы: блоки «### …» внутри первой секции опыта (Experience / Опыт / Experiencia). */
export function parseJobs(body: string, now = new Date()): JobBlock[] {
  const clean = stripComments(body);
  const exp = clean.match(/^## (?:Experience|Work Experience|Опыт[^\n]*|Experiencia[^\n]*)\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/im)?.[1];
  if (!exp) return [];
  return exp
    .split(/^### /m)
    .slice(1)
    .map((block) => {
      const [heading, ...rest] = block.split('\n');
      const text = rest.join('\n');
      const dateLine = rest.find((l) => /\b(19|20)\d{2}\b/.test(l)) ?? '';
      const years = [...dateLine.matchAll(/\b((?:19|20)\d{2})\b/g)].map((m) => Number(m[1]));
      const present = /present|по н\.?\s?в|настоящее|actualidad|hoy|presente/i.test(dateLine);
      const endYear = present ? now.getFullYear() : years.length ? Math.max(...years) : null;
      return { heading: heading!.trim(), endYear, text, bullets: rest.filter((l) => /^\s*- /.test(l)).map((l) => l.replace(/^\s*- /, '').trim()) };
    });
}

/** Технологии, упомянутые в тексте позже года окончания места: [технология, год выхода]. */
export function anachronisms(job: JobBlock, dates: Record<string, number>): [string, number][] {
  if (job.endYear == null) return [];
  let text = job.text;
  const out: [string, number][] = [];
  // длинные ключи раньше коротких: «Vue 3» не должен засчитаться как «Vue.js», «Redux Toolkit» — как «Redux»
  for (const [tech, year] of Object.entries(dates).sort((a, b) => b[0].length - a[0].length)) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${esc(tech)}(?![\\p{L}\\p{N}])`, 'giu');
    if (!re.test(text)) continue;
    text = text.replace(re, ' ');
    if (year > job.endYear) out.push([tech, year]);
  }
  return out;
}

// ---------- общие навыки (ATS)

const COMMON_SKILLS_LABEL: Record<Lang, string> = {
  en: 'Tools & Practices',
  ru: 'Инструменты и практики',
  es: 'Herramientas y prácticas',
};

/** Загружает список общих навыков из profile/common-skills.md (строки `- …`). */
export function loadCommonSkills(): string[] {
  const f = join(PROFILE, 'common-skills.md');
  if (!existsSync(f)) return [];
  const raw = stripComments(readFileSync(f, 'utf8'));
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
    .filter(Boolean);
}

/** Добавляет общие навыки в конец секции Skills/Навыки/Habilidades без дублирования. */
export function injectCommonSkills(body: string, lang: Lang, commonSkills: string[]): string {
  if (!commonSkills.length) return body;
  const secRe = /^(## (?:Skills|Навыки|Habilidades)\s*\n)([\s\S]*?)(?=^## |$(?![\s\S]))/im;
  const m = body.match(secRe);
  if (!m) return body;
  const sectionText = m[2]!;
  const missing = commonSkills.filter((skill) => {
    const parts = skill.split('/').map((p) => p.trim()).filter(Boolean);
    return !parts.some((p) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(p)}(?![\\p{L}\\p{N}])`, 'iu').test(sectionText));
  });
  if (!missing.length) return body;
  const label = COMMON_SKILLS_LABEL[lang] ?? COMMON_SKILLS_LABEL.en;
  const trimmed = sectionText.replace(/\s+$/, '');
  const line = `- **${label}:** ${missing.join(', ')}`;
  return body.replace(secRe, `${m[1]}${trimmed}\n${line}\n\n`);
}
