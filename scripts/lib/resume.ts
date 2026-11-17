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

/** Пункты из раздела «## <lang>» файла (soft-skills.md). */
export function langSection(text: string, lang: Lang): string[] {
  const m = stripComments(text).match(new RegExp(`^## ${lang}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'));
  return (m?.[1] ?? '').split('\n').map((l) => l.match(/^- (.+)$/)?.[1]?.trim()).filter((s): s is string => !!s);
}

export function readSoftSkills(lang: Lang): string[] {
  const f = join(PROFILE, 'soft-skills.md');
  return existsSync(f) ? langSection(readFileSync(f, 'utf8'), lang) : [];
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
  tracks: Record<string, { file?: string; title: string; projects: string[]; places: Record<string, { stack: string[]; title: string; focus?: string }> }>;
  title_variants: string[];
  limits: { bullets: number[]; min_bullets: number[]; projects: [number, number]; pages: number };
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
