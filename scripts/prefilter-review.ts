/**
 * Обзор отсеянного предфильтром — чтобы увидеть, не режется ли нужное (playbooks/analyze.md, «Предфильтр»).
 * `npm run prefilter-review -- [--days N | --since YYYY-MM-DD] [--sample N] [--no-save]`
 * Источник — блоки «Отсеяно предфильтром» в data/runs/<дата>-collect.md (пишет collect).
 * Разделы:
 *   - конфликт: отсеяно исключающим правилом, но в заголовке есть ключ include_title/strong_title — главный
 *     кандидат на ошибку (правило сильнее позитивного сигнала);
 *   - «инженерные» без совпадений: нет ни одного include-ключа, но заголовок похож на разработку
 *     (engineer/developer/разработчик…) — возможно, не хватает ключа в include_title;
 *   - правила по числу срабатываний (правило с 0 срабатываний за долгий период — мёртвое);
 *   - случайная выборка остального для просмотра глазами.
 * Отчёт печатается и сохраняется в data/runs/<дата>-prefilter.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { CONFIG_DIR, RUNS_DIR } from './lib/env.ts';
import { appendRunLog } from './lib/runlog.ts';

const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const days = Number(opt('--days') ?? 30);
const since = opt('--since') ?? new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
const sampleN = Number(opt('--sample') ?? 20);
const save = !args.includes('--no-save');

interface Rejected { title: string; company: string; reason: string; source: string; date: string }
const items = new Map<string, Rejected>();
const files = fs.existsSync(RUNS_DIR) ? fs.readdirSync(RUNS_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}-collect\.md$/.test(f) && f.slice(0, 10) >= since).sort() : [];
for (const f of files) {
  let source = '';
  let inBlock = false;
  for (const line of fs.readFileSync(path.join(RUNS_DIR, f), 'utf8').split('\n')) {
    const h = /^## (\S+) — /.exec(line);
    if (h) source = h[1]!;
    if (line.includes('<summary>Отсеяно предфильтром')) inBlock = true;
    else if (line.startsWith('</details>')) inBlock = false;
    else if (inBlock) {
      const m = /^- (.*) — (.*) \(([^()]*(?:\([^()]*\))?[^()]*)\)$/.exec(line);
      if (!m) continue;
      const r = { title: m[1]!, company: m[2]!, reason: m[3]!, source, date: f.slice(0, 10) };
      items.set(`${r.title}|${r.company}`.toLowerCase(), r);
    }
  }
}
const all = [...items.values()];

const pf = YAML.parse(fs.readFileSync(path.join(CONFIG_DIR, 'prefilter.yaml'), 'utf8')) ?? {};
const keyRe = (w: string) => {
  const word = String(w).replace(/^@/, '').replace(/\$$/, '');
  const e = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return /^[\p{L}\p{N} ]+$/u.test(word) ? new RegExp(`(^|[^\\p{L}\\p{N}])${e}`, 'iu') : new RegExp(e, 'iu');
};
const positive = [...(pf.include_title ?? []), ...(pf.strong_title ?? [])].map((w: string) => [w, keyRe(w)] as const);
const ENGINEERING = /engineer|developer|programmer|programador|desarrollador|ingenier|desenvolvedor|разработчик|программист|инженер|architect|архитектор/iu;

const isRule = (r: Rejected) => r.reason.startsWith('title~');
const conflict = all
  .filter(isRule)
  .map((r) => ({ r, pos: positive.find(([, re]) => re.test(r.title))?.[0] }))
  .filter((x) => x.pos);
const conflictSet = new Set(conflict.map((x) => x.r));
const noMatchEng = all.filter((r) => r.reason === 'no matching title/tags' && ENGINEERING.test(r.title));
const byRule = new Map<string, number>();
for (const r of all) byRule.set(r.reason, (byRule.get(r.reason) ?? 0) + 1);
const rules = [...(pf.exclude_title ?? []), ...(pf.exclude_title_soft ?? []), ...Object.keys(pf.exclude_title_unless ?? {})];
const dead = rules.filter((w: string) => !byRule.has(`title~"${w}"`));

const pairs = new Map<string, Rejected[]>();
for (const x of conflict) {
  const k = `${x.r.reason} против include «${x.pos}»`;
  pairs.set(k, [...(pairs.get(k) ?? []), x.r]);
}
const rest = all.filter((r) => !conflictSet.has(r) && !noMatchEng.includes(r));
const sample = [...rest].sort(() => Math.random() - 0.5).slice(0, sampleN);
const line = (r: Rejected) => `- ${r.title} — ${r.company} · ${r.source} · ${r.reason}`;

const out = [
  `## Предфильтр: отсеяно с ${since} — ${all.length} уникальных (${files.length} логов сбора)`,
  '',
  `### Конфликт: исключающее правило против include-ключа (${conflict.length}, пар правил: ${pairs.size})`,
  '',
  'Пара правил с нужными вакансиями в примерах — кандидат на exclude_title_unless / exclude_title_soft.',
  '',
  ...(pairs.size
    ? [...pairs].sort((a, b) => b[1].length - a[1].length).map(([k, rs]) => `- **${k}** ×${rs.length}: ${[...new Set(rs.map((r) => `${r.title} — ${r.company}`))].slice(0, 3).join('; ')}`)
    : ['_нет_']),
  '',
  `### Похоже на разработку, но ни одного include-ключа (${noMatchEng.length})`,
  '',
  ...(noMatchEng.length ? noMatchEng.slice(0, 60).map(line) : ['_нет_']),
  ...(noMatchEng.length > 60 ? [`- … ещё ${noMatchEng.length - 60}`] : []),
  '',
  '### Срабатывания правил',
  '',
  [...byRule].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(', ') || '_нет_',
  '',
  `Правила без срабатываний за период: ${dead.length ? dead.join(', ') : 'нет'}`,
  '',
  `### Случайная выборка остального (${sample.length} из ${rest.length})`,
  '',
  ...(sample.length ? sample.map(line) : ['_нет_']),
  '',
];
const report = out.join('\n');
console.log(report);
if (save) console.log(`\nСохранено: ${path.relative(process.cwd(), appendRunLog('prefilter', report))}`);
