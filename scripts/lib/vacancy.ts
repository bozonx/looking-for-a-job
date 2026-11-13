import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { VACANCIES_DIR } from './env.ts';

export interface VacancyFile {
  file: string;
  data: Record<string, any>;
  body: string;
}

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseVacancy(file: string): VacancyFile {
  const raw = fs.readFileSync(file, 'utf8');
  const m = FM.exec(raw);
  if (!m) throw new Error(`${file}: no front matter`);
  return { file, data: YAML.parse(m[1]) ?? {}, body: m[2] };
}

export function serialize(data: Record<string, any>, body: string): string {
  const fm = YAML.stringify(data, { lineWidth: 0, nullStr: 'null' });
  return `---\n${fm}---\n\n${body.replace(/^\n+/, '')}`;
}

/** Atomic write via temp file + rename. */
export function writeVacancy(file: string, data: Record<string, any>, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, serialize(data, body));
  fs.renameSync(tmp, file);
}

export function listVacancyFiles(dir = VACANCIES_DIR): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.md'))
    .map((d) => path.join(d.parentPath, d.name))
    .sort();
}

export function loadAll(): VacancyFile[] {
  return listVacancyFiles().map(parseVacancy);
}

export function slug(s: string, max = 40): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/, '') || 'x'
  );
}

export function vacancyPath(collectedAt: string, source: string, company: string, title: string): string {
  const [y, m] = collectedAt.split('-');
  return path.join(VACANCIES_DIR, y, m, `${collectedAt}-${source}-${slug(company, 30)}-${slug(title, 50)}.md`);
}

/** Resolve CLI args (ids or paths) into files. */
export function resolveTargets(args: string[]): string[] {
  const files = listVacancyFiles();
  return args.map((a) => {
    if (fs.existsSync(a)) return path.resolve(a);
    const hit = files.find((f) => parseVacancy(f).data.id === a);
    if (!hit) throw new Error(`Vacancy not found: ${a}`);
    return hit;
  });
}
