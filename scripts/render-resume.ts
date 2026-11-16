/**
 * Сборка резюме в PDF: шапка (profile/about.md) + резюме (трек или адаптированное) + пет-проекты (profile/projects.md).
 * markdown → HTML-шаблон → PDF через headless Chromium (один столбец, текстовый слой, без таблиц и картинок).
 *
 *   npm run render-resume -- --track vue [--lang en|ru|es] [--projects fastcat,tyco] [--out file.pdf] [--html]
 *   npm run render-resume -- --file data/generated/<id>/resume.en.md [--out …]
 *   npm run render-resume -- --all            все треки × языки, для которых есть исходник
 *
 * Источник: en — profile/resumes/<track>.md; ru/es — profile/resumes/i18n/<track>.<lang>.md (переводит агент,
 * playbooks/tailor.md). Устаревший перевод (source_hash ≠ хэш английского трека) — предупреждение.
 * Front matter резюме: track, title, projects[], lang (для --file), source_hash (для переводов).
 * Выход по умолчанию: data/generated/base/<Имя>_<track>_<lang>.pdf; для --file — рядом с файлом.
 * Chromium: $CHROMIUM_PATH, иначе chromium / google-chrome из PATH, иначе кэш Playwright.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { marked } from 'marked';

const ROOT = resolve(import.meta.dirname, '..');
const PROFILE = join(ROOT, 'profile');
const RESUMES = join(PROFILE, 'resumes');
const LANGS = ['en', 'ru', 'es'] as const;
type Lang = (typeof LANGS)[number];

const T: Record<Lang, { projects: string; langs: Record<string, string>; levels: Record<string, string> }> = {
  en: {
    projects: 'Pet projects',
    langs: { русский: 'Russian', английский: 'English', испанский: 'Spanish', португальский: 'Portuguese' },
    levels: { native: 'Native', родной: 'Native' },
  },
  ru: {
    projects: 'Пет-проекты',
    langs: { русский: 'Русский', английский: 'Английский', испанский: 'Испанский', португальский: 'Португальский' },
    levels: { native: 'родной', родной: 'родной' },
  },
  es: {
    projects: 'Proyectos personales',
    langs: { русский: 'Ruso', английский: 'Inglés', испанский: 'Español', португальский: 'Portugués' },
    levels: { native: 'Nativo', родной: 'Nativo' },
  },
};

// ---------- аргументы

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function die(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(2);
}

// ---------- разбор файлов

export function splitFrontMatter(text: string): { data: Record<string, any>; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: text };
  return { data: (parseYaml(m[1]) as Record<string, any>) ?? {}, body: text.slice(m[0].length) };
}

const stripComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '');
const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12);

interface Header {
  nameLatin: string;
  nameNative: string;
  location: string | null;
  contacts: { label: string; href?: string }[];
  languages: { name: string; level: string }[];
}

/** Значение «- Ключ: значение» из about.md; «…» и пусто → null. */
function field(about: string, key: string): string | null {
  const m = about.match(new RegExp(`^- ${key}:\\s*(.+)$`, 'm'));
  const v = m?.[1].trim();
  return !v || v.startsWith('…') ? null : v;
}

/** «[text](url)» → url, иначе как есть. */
const mdUrl = (v: string) => v.match(/\]\(([^)]+)\)/)?.[1] ?? v;

function readHeader(): Header {
  const file = join(PROFILE, 'about.md');
  if (!existsSync(file)) die('нет profile/about.md (шаблон — about.example.md)');
  const about = stripComments(readFileSync(file, 'utf8'));
  const rawName = field(about, 'Имя') ?? die('about.md: нет поля «Имя»');
  const paren = rawName.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const nameNative = paren ? paren[1] : rawName;
  const nameLatin = paren ? paren[2] : rawName;

  const contacts: Header['contacts'] = [];
  const email = field(about, 'Email');
  if (email) {
    const e = mdUrl(email).replace(/^mailto:/, '');
    contacts.push({ label: e, href: `mailto:${e}` });
  }
  const phone = field(about, 'Телефон');
  if (phone) contacts.push({ label: phone });
  const tg = field(about, 'Telegram');
  if (tg) contacts.push({ label: `Telegram ${tg}`, href: `https://t.me/${tg.replace(/^@/, '')}` });
  for (const k of ['LinkedIn', 'GitHub']) {
    const v = field(about, k);
    if (v) {
      const url = mdUrl(v);
      contacts.push({ label: url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''), href: url });
    }
  }

  const languages: Header['languages'] = [];
  const langLine = about.match(/## Языки\s*\n+- (.+)/)?.[1] ?? '';
  for (const part of langLine.split(';')) {
    const m = part.trim().match(/^(\S+)\s*[—-]\s*(.+)$/);
    if (m) languages.push({ name: m[1].toLowerCase(), level: m[2].trim() });
  }
  return { nameLatin, nameNative, location: field(about, 'Локация в резюме'), contacts, languages };
}

interface Project {
  id: string;
  name: string;
  links: string[];
  stack: string;
  desc: Partial<Record<Lang, string>>;
}

function readProjects(): Map<string, Project> {
  const file = join(PROFILE, 'projects.md');
  const out = new Map<string, Project>();
  if (!existsSync(file)) return out;
  const text = stripComments(readFileSync(file, 'utf8'));
  for (const sec of text.split(/^## /m).slice(1)) {
    const [idLine, ...rest] = sec.split('\n');
    const f: Record<string, string> = {};
    for (const l of rest) {
      const m = l.match(/^- (\w+):\s*(.*)$/);
      if (m) f[m[1]] = m[2].trim();
    }
    const id = idLine.trim();
    out.set(id, {
      id,
      name: f.name || id,
      links: (f.links ?? '').split('|').map((s) => s.trim()).filter(Boolean),
      stack: f.stack ?? '',
      desc: { en: f.en, ru: f.ru, es: f.es },
    });
  }
  return out;
}

// ---------- HTML

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function projectsMd(ids: string[], all: Map<string, Project>, lang: Lang): string {
  if (!ids.length) return '';
  const items = ids.map((id) => {
    const p = all.get(id) ?? die(`проект «${id}» не найден в profile/projects.md`);
    let d = p.desc[lang];
    if (!d) {
      console.warn(`⚠ у проекта ${id} нет описания «${lang}:» — взято en`);
      d = p.desc.en ?? '';
    }
    const links = p.links.map((u) => `[${u.replace(/^https?:\/\/(www\.)?/, '')}](${u})`).join(' · ');
    return `- **${p.name}**${links ? ` — ${links}` : ''}  \n  ${d}`;
  });
  return `## ${T[lang].projects}\n\n${items.join('\n')}\n`;
}

/** Вставить секцию проектов перед последней секцией (Education), если она последняя; иначе в конец. */
function injectProjects(body: string, projects: string): string {
  if (!projects) return body;
  const sections = [...body.matchAll(/^## .+$/gm)];
  const last = sections.at(-1);
  if (last && /education|образование|educaci[oó]n|formaci[oó]n/i.test(last[0])) {
    return body.slice(0, last.index) + projects + '\n' + body.slice(last.index);
  }
  return body.trimEnd() + '\n\n' + projects;
}

function renderHtml(h: Header, lang: Lang, title: string, body: string): string {
  const name = lang === 'ru' ? h.nameNative : h.nameLatin;
  const langs = h.languages
    .map((l) => {
      const n = T[lang].langs[l.name] ?? l.name;
      return `${n} — ${T[lang].levels[l.level.toLowerCase()] ?? l.level}`;
    })
    .join(' · ');
  const contacts = [
    ...(h.location ? [esc(h.location)] : []),
    ...h.contacts.map((c) => (c.href ? `<a href="${esc(c.href)}">${esc(c.label)}</a>` : esc(c.label))),
  ].join(' · ');
  // голые URL → короткий текст ссылки (без https://www. и хвостового /)
  const linked = body.replace(/(?<![(<\[])\bhttps?:\/\/[^\s)]+/g, (u) => `[${u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}](${u})`);
  const content = marked.parse(linked, { async: false, breaks: true }) as string;
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><title>${esc(name)} — ${esc(title)}</title>
<style>
  @page { size: A4; margin: 14mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Inter", "Helvetica Neue", Arial, "Liberation Sans", sans-serif; font-size: 10pt; line-height: 1.38; color: #1a1a1a; margin: 0; }
  header { margin-bottom: 10pt; }
  h1 { font-size: 20pt; margin: 0; letter-spacing: -0.2pt; }
  .role { font-size: 12pt; color: #333; margin: 2pt 0 4pt; font-weight: 600; }
  .contacts, .langs { font-size: 9pt; color: #444; }
  a { color: inherit; text-decoration: none; }
  h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: 0.6pt; border-bottom: 1px solid #bbb; padding-bottom: 2pt; margin: 12pt 0 5pt; }
  h3 { font-size: 10.5pt; margin: 8pt 0 0; break-after: avoid; }
  h3 + p { margin: 1pt 0 3pt; color: #444; font-size: 9pt; }
  p { margin: 3pt 0; }
  ul { margin: 2pt 0 4pt; padding-left: 14pt; }
  li { margin: 1.5pt 0; }
  li, h3 + p { break-inside: avoid; }
</style></head>
<body>
<header>
  <h1>${esc(name)}</h1>
  <div class="role">${esc(title)}</div>
  <div class="contacts">${contacts}</div>
  ${langs ? `<div class="langs">${esc(langs)}</div>` : ''}
</header>
${content}
</body></html>`;
}

// ---------- PDF

function findChromium(): string {
  const env = process.env.CHROMIUM_PATH;
  if (env) return env;
  for (const bin of ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome']) {
    try {
      return execFileSync('which', [bin], { encoding: 'utf8' }).trim();
    } catch {}
  }
  const pw = join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(pw)) {
    for (const d of readdirSync(pw).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      const p = join(pw, d, 'chrome-linux', 'chrome');
      if (existsSync(p)) return p;
    }
  }
  die('не найден Chromium: установите chromium или задайте CHROMIUM_PATH');
}

function toPdf(htmlFile: string, pdfFile: string): void {
  execFileSync(
    findChromium(),
    ['--headless', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer', `--print-to-pdf=${pdfFile}`, `file://${htmlFile}`],
    { stdio: 'pipe' },
  );
}

// ---------- сборка

interface Job {
  src: string;
  lang: Lang;
  track: string | null;
  out: string;
}

function trackSource(track: string, lang: Lang): string {
  return lang === 'en' ? join(RESUMES, `${track}.md`) : join(RESUMES, 'i18n', `${track}.${lang}.md`);
}

function build(job: Job, header: Header, projects: Map<string, Project>, opts: { projects?: string[]; htmlOnly: boolean }): void {
  const { data, body } = splitFrontMatter(readFileSync(job.src, 'utf8'));
  if (job.track && job.lang !== 'en') {
    const en = readFileSync(trackSource(job.track, 'en'), 'utf8');
    if (data.source_hash !== sha(en)) console.warn(`⚠ ${basename(job.src)}: перевод устарел (source_hash ≠ ${sha(en)}) — обнови по playbooks/tailor.md`);
  }
  const title = data.title ?? die(`${job.src}: нет title во front matter`);
  const ids: string[] = opts.projects ?? data.projects ?? [];
  const md = injectProjects(stripComments(body).trim() + '\n', projectsMd(ids, projects, job.lang));
  const html = renderHtml(header, job.lang, title, md);
  mkdirSync(dirname(job.out), { recursive: true });
  const htmlFile = job.out.replace(/\.pdf$/, '.html');
  writeFileSync(htmlFile, html);
  if (opts.htmlOnly) {
    console.log(`✓ ${htmlFile}`);
    return;
  }
  toPdf(htmlFile, job.out);
  console.log(`✓ ${job.out}`);
}

function main(): void {
  const header = readHeader();
  const projects = readProjects();
  const fileSlug = header.nameLatin.replace(/\s+/g, '_');
  const htmlOnly = flag('html');
  const projOverride = arg('projects')?.split(',').map((s) => s.trim()).filter(Boolean);
  const baseDir = join(ROOT, 'data', 'generated', 'base');
  const jobs: Job[] = [];

  if (flag('all')) {
    for (const f of readdirSync(RESUMES).filter((f) => f.endsWith('.md') && !f.includes('.example.'))) {
      const track = f.replace(/\.md$/, '');
      for (const lang of LANGS) {
        const src = trackSource(track, lang);
        if (existsSync(src)) jobs.push({ src, lang, track, out: join(baseDir, `${fileSlug}_${track}_${lang}.pdf`) });
      }
    }
  } else if (arg('file')) {
    const src = resolve(arg('file')!);
    if (!existsSync(src)) die(`нет файла ${src}`);
    const fm = splitFrontMatter(readFileSync(src, 'utf8')).data;
    const lang = (arg('lang') ?? fm.lang ?? 'en') as Lang;
    if (!LANGS.includes(lang)) die(`язык ${lang} не поддерживается (${LANGS.join(', ')})`);
    jobs.push({ src, lang, track: null, out: resolve(arg('out') ?? join(dirname(src), `${fileSlug}_${lang}.pdf`)) });
  } else {
    const track = arg('track') ?? die('usage: npm run render-resume -- --track <трек> [--lang en|ru|es] | --file <md> | --all');
    const lang = (arg('lang') ?? 'en') as Lang;
    if (!LANGS.includes(lang)) die(`язык ${lang} не поддерживается (${LANGS.join(', ')})`);
    const src = trackSource(track, lang);
    if (!existsSync(src)) {
      die(lang === 'en' ? `нет ${src}` : `нет перевода ${src} — попроси агента «переведи резюме ${track} на ${lang}» (playbooks/tailor.md)`);
    }
    jobs.push({ src, lang, track, out: resolve(arg('out') ?? join(baseDir, `${fileSlug}_${track}_${lang}.pdf`)) });
  }

  if (!jobs.length) die('нечего собирать');
  for (const j of jobs) build(j, header, projects, { projects: projOverride, htmlOnly });
}

/** Хэш английского трека — для source_hash в переводах. `npm run render-resume -- --hash vue` */
if (flag('hash')) {
  const t = arg('hash') ?? die('usage: --hash <трек>');
  console.log(sha(readFileSync(trackSource(t, 'en'), 'utf8')));
} else {
  main();
}
