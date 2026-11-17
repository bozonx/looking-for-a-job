/**
 * Набор вакансий на отклик (dev_docs/apply-plan.md §6, шаг 1). Ничего не меняет.
 * `npm run apply-set -- [all|selected|scored|retry] [--json] [--no-limit] [id …]`
 *
 * all       — selected ∪ (status: null, overall ≥ APPLY_SCORE_THRESHOLD, без стоп-флагов)
 * selected  — только selected;  scored — только по порогу;  retry — needs_attention + apply_failed
 * id …      — конкретные вакансии (режим и пороги не применяются, исключения — только предупреждением)
 *
 * Исключает possibly_closed и ⚑; уже отправленные (application.md state: submitted) пропускает.
 * Лимиты: APPLY_MAX_PER_RUN на набор, LINKEDIN_APPLY_MAX_PER_DAY за 24 ч. Сортировка: selected первыми, затем overall.
 * Перед откликом — `npm run check-alive -- <id …>` по набору.
 */
import { env } from './lib/env.ts';
import { loadAll, parseVacancy, resolveTargets } from './lib/vacancy.ts';
import { applicationState, applyUrl, inMode, isLinkedIn, linkedinToday, needsChannel, overall, type Mode } from './lib/apply.ts';

const args = process.argv.slice(2);
const json = args.includes('--json');
const noLimit = args.includes('--no-limit');
const pos = args.filter((a) => !a.startsWith('--'));
const MODES = ['all', 'selected', 'scored', 'retry'];
const mode = (MODES.includes(pos[0] ?? '') ? pos.shift() : 'all') as Mode;
const ids = pos;

const all = loadAll();
interface Row {
  id: string;
  company: string;
  title: string;
  overall: number | null;
  why: string;
  target: string;
  channels: string;
  url: string;
  lang: string;
  track: string;
  state: string | null;
  confirm: boolean;
  issues: string[];
  file: string;
}
const excluded: string[] = [];
let rows: Row[] = [];

const files = ids.length ? resolveTargets(ids).map(parseVacancy) : all;
for (const v of files) {
  const d = v.data;
  const why = ids.length ? 'id' : inMode(d, mode);
  if (!why) continue;
  const state = applicationState(d.id);
  const issues: string[] = [];
  if (d.possibly_closed) issues.push('possibly_closed');
  if (d.flagged) issues.push('⚑');
  if (d.status === 'applied' || state === 'submitted') issues.push('уже отправлено');
  if (!ids.length && issues.length) {
    excluded.push(`${d.id} — ${issues.join(', ')}`);
    continue;
  }
  if (needsChannel(d)) issues.push('агрегатор без канала отклика — найти real_url / email / Telegram');
  if (d.status === 'needs_attention') issues.push(`attention: ${d.attention_reason ?? '?'} — ${d.attention_details ?? ''}`.trim());
  rows.push({
    id: d.id,
    company: d.company,
    title: d.title,
    overall: overall(d),
    why,
    target: d.apply_target ?? d.apply_method ?? '?',
    url: applyUrl(d),
    channels: ((d.apply_channels ?? []) as { type: string; value: string; note?: string | null }[]).map((c) => `${c.type}: ${c.value}${c.note ? ` (${c.note})` : ''}`).join('; '),
    lang: d.vacancy_language ?? 'en',
    track: d.best_resume ?? '?',
    state,
    confirm: why === 'scored' && env.APPLY_CONFIRM_SCORED,
    issues,
    file: v.file,
  });
}

rows.sort((a, b) => Number(b.why === 'selected') - Number(a.why === 'selected') || (b.overall ?? 0) - (a.overall ?? 0));

const skipped: string[] = [];
if (!noLimit && !ids.length) {
  let li = linkedinToday(all);
  const kept: Row[] = [];
  for (const r of rows) {
    if (isLinkedIn(parseVacancy(r.file).data)) {
      if (li >= env.LINKEDIN_APPLY_MAX_PER_DAY) {
        skipped.push(`${r.id} — лимит LinkedIn ${env.LINKEDIN_APPLY_MAX_PER_DAY}/сутки`);
        continue;
      }
      li++;
    }
    if (kept.length >= env.APPLY_MAX_PER_RUN) {
      skipped.push(`${r.id} — APPLY_MAX_PER_RUN ${env.APPLY_MAX_PER_RUN}`);
      continue;
    }
    kept.push(r);
  }
  rows = kept;
}

if (json) {
  console.log(JSON.stringify({ mode, rows, excluded, skipped }, null, 2));
} else {
  console.log(`Набор «${mode}»: ${rows.length}${ids.length ? '' : ` (порог ${env.APPLY_SCORE_THRESHOLD}, лимит ${env.APPLY_MAX_PER_RUN})`}\n`);
  for (const r of rows) {
    const mark = r.why === 'selected' ? '✓' : r.confirm ? '?' : '·';
    console.log(`${mark} ${String(r.overall ?? '—').padStart(3)}  ${r.id}`);
    console.log(`        ${r.company} — ${r.title}`);
    console.log(`        ${r.target} · ${r.lang} · трек ${r.track}${r.state ? ` · пакет: ${r.state}` : ''}`);
    console.log(`        ${r.url}`);
    if (r.channels) console.log(`        каналы: ${r.channels}`);
    for (const i of r.issues) console.log(`        ⚠ ${i}`);
  }
  if (rows.some((r) => r.confirm)) console.log('\n? — попали только по скорингу: подтвердить у пользователя (APPLY_CONFIRM_SCORED)');
  if (excluded.length) console.log(`\nИсключены (${excluded.length}):\n${excluded.map((x) => `  - ${x}`).join('\n')}`);
  if (skipped.length) console.log(`\nНе вошли по лимитам (${skipped.length}):\n${skipped.map((x) => `  - ${x}`).join('\n')}`);
}
