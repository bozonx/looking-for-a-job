/**
 * Сводный отчёт для анализа резюме и конвейера (playbooks/analyze.md).
 * `npm run insights -- [--days N | --since YYYY-MM-DD] [--no-save]`
 *
 * Резюме: по каждому треку (resume_match.resume) — частота требований, нехватающих навыков,
 *   ATS-формулировок и «негативных» пунктов резюме. Учитываются только релевантные вакансии:
 *   отскоренные, без stop_flags, не rejected. Вес вакансии = overall/100, selected/starred ×2,
 *   поэтому мусор почти не влияет, а то, куда хочется откликнуться, — сильнее.
 *   v3 (scoring_version ≥ 3): топ обязанностей (сырьё для bullets опыта), как пишут навыки (для ATS — писать
 *   самым частым вариантом), домены и типы продукта, soft-требования, медиана требуемых лет.
 * Конвейер: по источникам — объёмы из data/runs/stats.jsonl, доля мусора, стоп-флагов,
 *   отклонённых вручную, утечки предфильтра (fit по всем трекам низкий).
 * Журнал: счётчики тегов data/insights.md за период.
 * Отчёт печатается и сохраняется в data/runs/<дата>-insights.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, RUNS_DIR, today } from './lib/env.ts';
import { appendRunLog } from './lib/runlog.ts';
import { TRACKS } from './lib/schema.ts';
import { loadSkills, normSkill } from './lib/skills.ts';
import { loadAll } from './lib/vacancy.ts';

const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const days = Number(opt('--days') ?? 30);
const since = opt('--since') ?? new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
const save = !args.includes('--no-save');

const dict = loadSkills();
const vac = loadAll().filter((v) => String(v.data.collected_at) >= since);
const scored = vac.filter((v) => v.data.scores);
const relevant = scored.filter((v) => !(v.data.stop_flags ?? []).length && v.data.status !== 'rejected');
const weight = (d: any) => ((d.scores?.overall ?? 0) / 100) * (d.status === 'selected' || d.starred ? 2 : 1);
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');

type Counter = Map<string, { n: number; w: number; ids: string[] }>;
const bump = (c: Counter, k: string, w: number, id: string) => {
  const e = c.get(k) ?? { n: 0, w: 0, ids: [] };
  e.n++;
  e.w += w;
  if (e.ids.length < 3) e.ids.push(id);
  c.set(k, e);
};
const table = (c: Counter, total: number, top = 15) => {
  const rows = [...c].sort((a, b) => b[1].w - a[1].w).slice(0, top);
  if (!rows.length) return '_нет данных_\n';
  return (
    '| навык | вакансий | доля | вес | примеры |\n|---|---|---|---|---|\n' +
    rows.map(([k, e]) => `| ${k} | ${e.n} | ${pct(e.n, total)} | ${e.w.toFixed(1)} | ${e.ids.join(', ')} |`).join('\n') +
    '\n'
  );
};

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : null;
};
/** Раздел v3 по треку: обязанности, написания навыков, контекст. Пусто, если v3-вакансий нет. */
function v3Block(n3: number, total: number, resp: Counter, spell: Map<string, Map<string, number>>, dom: Counter, prod: Counter, soft: Counter, years: number[]): string[] {
  if (!n3) return [`_Поля v3 (обязанности, написания, домен) пока ни у одной вакансии — npm run pending -- --upgrade._`, ''];
  const sp = [...spell].map(([k, m]) => [k, [...m].sort((a, b) => b[1] - a[1])] as const).sort((a, b) => b[1].reduce((x, y) => x + y[1], 0) - a[1].reduce((x, y) => x + y[1], 0));
  const brief = (c: Counter, top = 8) => [...c].sort((a, b) => b[1].w - a[1].w).slice(0, top).map(([k, e]) => `${k} ×${e.n}`).join(', ') || '—';
  const y = median(years);
  return [
    `**Поля v3** заполнены у ${n3} из ${total}${n3 < total ? ' — доли ниже считаются от всех вакансий трека, дозаполни остальные' : ''}.`,
    '',
    '**Обязанности (сырьё для bullets опыта):**',
    '',
    table(resp, n3, 25).replace('| навык |', '| обязанность |'),
    '**Как пишут навыки (используй в резюме самое частое написание):**',
    '',
    sp.length ? sp.slice(0, 20).map(([k, vs]) => `- ${k}: ${vs.map(([x, c]) => `${x} ×${c}`).join(', ')}`).join('\n') + '\n' : '_нет расхождений с каноническими именами_\n',
    `**Контекст:** домены — ${brief(dom)}; тип продукта — ${brief(prod)}.`,
    '',
    `**Soft / уровень:** ${brief(soft, 10)}. Требуемый опыт: медиана ${y ?? '—'} лет (указан в ${years.length} вакансиях).`,
    '',
  ];
}

const out: string[] = [`## Отчёт с ${since} по ${today()}`, ''];
out.push(
  `Вакансий собрано: ${vac.length}, отскорено: ${scored.length}, релевантных (без стоп-флагов, не rejected): ${relevant.length}, ` +
    `с resume_match: ${relevant.filter((v) => v.data.resume_match).length}.`,
  '',
);

// ---------- Резюме ----------
out.push('### Резюме', '');
const unknown = new Map<string, number>();
for (const track of TRACKS) {
  const vs = relevant.filter((v) => v.data.resume_match?.resume === track);
  if (!vs.length) continue;
  const req: Counter = new Map(), miss: Counter = new Map(), missNice: Counter = new Map(), ats: Counter = new Map();
  const resp: Counter = new Map(), dom: Counter = new Map(), prod: Counter = new Map(), soft: Counter = new Map();
  const spell = new Map<string, Map<string, number>>();
  const years: number[] = [];
  const negative: string[] = [];
  for (const v of vs) {
    const d = v.data, rm = d.resume_match, w = weight(d);
    const n = (s: string) => {
      const r = normSkill(s, dict);
      if (!r.known) unknown.set(r.name, (unknown.get(r.name) ?? 0) + 1);
      return r.name;
    };
    for (const s of rm.required ?? []) bump(req, n(s), w, d.id);
    for (const s of rm.missing_required ?? []) bump(miss, n(s), w, d.id);
    for (const s of rm.missing_nice ?? []) bump(missNice, n(s), w, d.id);
    for (const s of rm.ats_keywords_missing ?? []) bump(ats, String(s).toLowerCase(), w, d.id);
    for (const r of rm.responsibilities ?? []) bump(resp, String(r).toLowerCase().trim(), w, d.id);
    for (const r of rm.soft_requirements ?? []) bump(soft, String(r).toLowerCase().trim(), w, d.id);
    if (rm.domain) bump(dom, String(rm.domain).toLowerCase(), w, d.id);
    if (rm.product_type) bump(prod, String(rm.product_type).toLowerCase(), w, d.id);
    if (typeof rm.years_required === 'number') years.push(rm.years_required);
    for (const [k, vars] of Object.entries(rm.keyword_spellings ?? {})) {
      const m = spell.get(n(k)) ?? new Map<string, number>();
      for (const x of vars as string[]) m.set(String(x), (m.get(String(x)) ?? 0) + 1);
      spell.set(n(k), m);
    }
    for (const x of rm.in_resume_negative ?? []) negative.push(`- **${x.skill}** — ${d.id} (${d.company}): «${x.evidence}»`);
  }
  const avgMiss = vs.reduce((a, v) => a + (v.data.resume_match.missing_required?.length ?? 0), 0) / vs.length;
  const avgReq = vs.reduce((a, v) => a + (v.data.resume_match.required?.length ?? 0), 0) / vs.length;
  out.push(
    `#### ${track} — ${vs.length} вакансий`,
    '',
    `Покрытие обязательных требований: ${avgReq ? Math.round(100 * (1 - avgMiss / avgReq)) : '—'}% (в среднем не хватает ${avgMiss.toFixed(1)} из ${avgReq.toFixed(1)}).`,
    '',
    '**Не хватает (обязательные):**',
    '',
    table(miss, vs.length),
    '**Не хватает (желательные):**',
    '',
    table(missNice, vs.length, 10),
    '**ATS: формулировки, которых нет в тексте резюме:**',
    '',
    table(ats, vs.length, 10),
    '**Есть в резюме, но вакансия считает минусом:**',
    '',
    negative.length ? negative.join('\n') + '\n' : '_нет_\n',
    ...v3Block(vs.filter((v) => (v.data.scoring_version ?? 0) >= 3).length, vs.length, resp, spell, dom, prod, soft, years),
    '<details><summary>Самые частые требования (спрос)</summary>',
    '',
    table(req, vs.length, 25),
    '</details>',
    '',
  );
}
const noRm = scored.filter((v) => !v.data.resume_match).length;
if (noRm) out.push(`⚠ Без resume_match: ${noRm} отскоренных вакансий — в статистику резюме не попали.`, '');
if (unknown.size)
  out.push(`⚠ Навыки вне config/skills.yaml: ${[...unknown].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(', ')}`, '');

// ---------- Конвейер ----------
out.push('### Источники и фильтры', '');
const runs: Record<string, any>[] = [];
const statsFile = path.join(RUNS_DIR, 'stats.jsonl');
if (fs.existsSync(statsFile))
  for (const line of fs.readFileSync(statsFile, 'utf8').split('\n'))
    try {
      if (line.trim()) runs.push(JSON.parse(line));
    } catch {
      /* битая строка — пропускаем */
    }
const sources = [...new Set([...vac.map((v) => v.data.source as string), ...runs.filter((r) => r.date >= since).map((r) => r.source as string)])].sort();
out.push(
  '| источник | прогонов (ошибок) | в ленте | просмотрено | предфильтр | сохранено | отскорено | ср. overall | overall<40 | стоп-флаги | rejected вручную | selected/★ |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
);
for (const s of sources) {
  const r = runs.filter((x) => x.source === s && x.date >= since);
  const sum = (k: string) => r.reduce((a, x) => a + (Number(x[k]) || 0), 0);
  const sv = scored.filter((v) => v.data.source === s);
  const all = vac.filter((v) => v.data.source === s);
  const avg = sv.length ? Math.round(sv.reduce((a, v) => a + (v.data.scores.overall ?? 0), 0) / sv.length) : '—';
  out.push(
    `| ${s} | ${r.length} (${r.filter((x) => x.failed).length}) | ${sum('listed')} | ${sum('viewed')} | ${sum('prefiltered')} (${pct(sum('prefiltered'), sum('viewed'))}) | ${sum('saved')} | ${sv.length} | ${avg} | ` +
      `${pct(sv.filter((v) => (v.data.scores.overall ?? 0) < 40).length, sv.length)} | ${pct(sv.filter((v) => (v.data.stop_flags ?? []).length).length, sv.length)} | ` +
      `${pct(all.filter((v) => v.data.status === 'rejected').length, all.length)} | ${all.filter((v) => v.data.status === 'selected' || v.data.starred).length} |`,
  );
}
if (!runs.length) out.push('', '_data/runs/stats.jsonl пуст — метрики прогонов появятся после следующего «собери»._');
out.push('');

const flags = new Map<string, number>();
for (const v of scored) for (const f of v.data.stop_flags ?? []) flags.set(f, (flags.get(f) ?? 0) + 1);
if (flags.size) out.push(`Стоп-флаги: ${[...flags].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(', ')}`, '');

const leaks = scored.filter((v) => Math.max(...Object.values(v.data.scores.fit ?? {}).map(Number)) < 30);
out.push(
  `**Утечки предфильтра** (fit < 30 по всем трекам — должны были отсеяться): ${leaks.length} из ${scored.length}`,
  '',
  ...leaks.slice(0, 20).map((v) => `- ${v.data.id} · ${v.data.title} — ${v.data.company} (tags: ${(v.data.tags ?? []).slice(0, 6).join(', ')})`),
  '',
);
const noUrl = scored.filter((v) => !v.data.real_url && (v.data.scores.overall ?? 0) >= 60);
out.push(`Без real_url при overall ≥ 60: ${noUrl.length} (${[...new Set(noUrl.map((v) => v.data.source))].join(', ') || '—'})`, '');

// ---------- Журнал ----------
const jf = path.join(DATA_DIR, 'insights.md');
if (fs.existsSync(jf)) {
  let date = '';
  const tags = new Map<string, number>();
  for (const line of fs.readFileSync(jf, 'utf8').split('\n')) {
    const h = /^## (\d{4}-\d{2}-\d{2})/.exec(line);
    if (h) date = h[1]!;
    const t = /^- \[([a-z-]+)\]/.exec(line);
    if (t && date >= since) tags.set(t[1]!, (tags.get(t[1]!) ?? 0) + 1);
  }
  out.push('### Журнал data/insights.md', '', tags.size ? [...tags].map(([k, n]) => `[${k}]×${n}`).join(', ') : '_записей за период нет_', '');
}

const report = out.join('\n');
console.log(report);
if (save) console.log(`\nСохранено: ${path.relative(process.cwd(), appendRunLog('insights', report))}`);
