/**
 * Этап 1, источник RemoteOK: публичный JSON https://remoteok.com/api
 * Скачивает список, применяет лимиты (§5.1), предфильтр, дедупликацию и сохраняет
 * НОВЫЕ вакансии в data/vacancies/ со `scores: null` — их скорит агент (playbooks/scoring.md).
 *
 * Флаги: --dry-run (ничего не пишет), --limit N (не более N новых), --file path.json (вместо сети)
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { CONFIG_DIR, env, today } from './lib/env.ts';
import { loadAll, vacancyPath, writeVacancy } from './lib/vacancy.ts';
import { buildIndex, findDuplicate, key, normUrl } from './lib/dedupe.ts';
import { htmlToMarkdown } from './lib/html.ts';
import { appendRunLog } from './lib/runlog.ts';
import { applyMethodFromUrl, pickApplyTarget } from './lib/target.ts';
import { SeenStore } from './lib/seen.ts';

const SOURCE = 'remoteok';
const API = 'https://remoteok.com/api';

interface RemoteOkJob {
  id: string;
  slug: string;
  epoch: number;
  date: string;
  company: string;
  position: string;
  tags?: string[];
  description?: string;
  location?: string;
  salary_min?: number;
  salary_max?: number;
  apply_url?: string;
  url?: string;
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.indexOf('--limit');
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;
const fileArg = args.indexOf('--file');

async function fetchJobs(): Promise<RemoteOkJob[]> {
  let json: unknown;
  if (fileArg >= 0) {
    json = JSON.parse(fs.readFileSync(args[fileArg + 1], 'utf8'));
  } else {
    const res = await fetch(API, { headers: { 'User-Agent': 'Mozilla/5.0 (job-search personal script)', Accept: 'application/json' } });
    if (!res.ok) throw new Error(`RemoteOK API: HTTP ${res.status}`);
    json = await res.json();
  }
  if (!Array.isArray(json)) throw new Error('RemoteOK API: unexpected response');
  return (json as any[]).filter((j) => j && j.id && j.position) as RemoteOkJob[];
}

// ---------- prefilter ----------
const pf = YAML.parse(fs.readFileSync(path.join(CONFIG_DIR, 'prefilter.yaml'), 'utf8')) as {
  include_title: string[];
  include_tags: string[];
  exclude_title: string[];
};
const toRe = (w: string) => {
  const esc = w.replace(/^@/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // короткие/«словные» ключи — по границе слова
  return /^[a-z0-9 ]+$/i.test(w.replace(/^@/, '')) ? new RegExp(`(^|[^a-z0-9])${esc}`, "i") : new RegExp(esc, 'i');
};
const exclude = pf.exclude_title.map((w) => [w, toRe(w)] as const);
const include = pf.include_title.map((w) => [w, toRe(w)] as const);
const includeTags = new Set(pf.include_tags.map((t) => t.toLowerCase()));

function prefilter(j: RemoteOkJob): { ok: boolean; reason: string } {
  const t = decode(j.position);
  const ex = exclude.find(([, re]) => re.test(t));
  if (ex) return { ok: false, reason: `title~"${ex[0]}"` };
  const inc = include.find(([, re]) => re.test(t));
  if (inc) return { ok: true, reason: `title~"${inc[0]}"` };
  const tag = (j.tags ?? []).find((x) => includeTags.has(x.toLowerCase()));
  if (tag) return { ok: true, reason: `tag:${tag}` };
  return { ok: false, reason: 'no matching title/tags' };
}

// ---------- mapping ----------
/** RemoteOK иногда отдаёт UTF-8, ошибочно перекодированный как latin1 ("â" вместо "—"). */
function fixMojibake(s: string): string {
  if (!/[\u00c2-\u00f4][\u0080-\u00bf]/.test(s)) return s;
  const bytes = Buffer.from(s, 'latin1');
  const out = bytes.toString('utf8');
  return out.includes('\ufffd') ? s : out;
}

function decode(s = ''): string {
  return fixMojibake(s)
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function employment(tags: string[]): string {
  const t = tags.map((x) => x.toLowerCase());
  if (t.some((x) => x.includes('contract') || x.includes('freelance'))) return 'contract';
  if (t.some((x) => x.includes('full time') || x.includes('full-time'))) return 'full-time';
  return 'unknown';
}

function toVacancy(j: RemoteOkJob) {
  const sourceUrl = j.url || `https://remoteok.com/remote-jobs/${j.slug}`;
  const apply = j.apply_url && !/remoteok\.(com|io)/i.test(j.apply_url) ? j.apply_url : null;
  const method = applyMethodFromUrl(apply);
  const tags = j.tags ?? [];
  const hasSalary = (j.salary_min ?? 0) > 0 || (j.salary_max ?? 0) > 0;
  const data = {
    id: `${SOURCE}-${j.id}`,
    title: decode(j.position),
    company: decode(j.company) || 'Unknown',
    company_country: null,
    source: SOURCE,
    source_url: sourceUrl,
    real_url: apply && /^https?:/.test(apply) ? apply : null,
    apply_method: method,
    duplicates: [],
    apply_target: null as string | null,
    collected_at: today(),
    posted_at: j.date?.slice(0, 10) ?? null,
    location: decode(j.location) || null,
    region: null,
    salary: hasSalary ? { min: j.salary_min || null, max: j.salary_max || null, currency: 'USD', period: 'year' } : null,
    employment: employment(tags),
    vacancy_language: null,
    work_languages: null,
    role_tracks: [],
    tags,
    summary: null,
    key_points: null,
    red_flags: null,
    scores: null,
    stop_flags: [],
    best_resume: null,
    score_reasoning: null,
    requirements_special: [],
    status: 'new',
    attention_reason: null,
    attention_details: null,
    starred: false,
    notes: '',
    possibly_closed: false,
    applied_at: null,
    apply_log: null,
    scoring_version: null,
  };
  data.apply_target = pickApplyTarget(data);
  const body =
    `# ${data.title} — ${data.company}\n\n` +
    `Source: [Remote OK](${sourceUrl})${apply ? ` · Apply: ${apply}` : ''}\n\n` +
    htmlToMarkdown(fixMojibake(j.description ?? "").replace(/\\n/g, "\n")) +
    '\n';
  return { data, body };
}

// ---------- main ----------
async function main() {
  const jobs = (await fetchJobs()).sort((a, b) => b.epoch - a.epoch);
  const all = loadAll();
  const idx = buildIndex(all);
  const seen = new SeenStore(SOURCE);
  const minEpoch = Date.now() / 1000 - env.COLLECT_MAX_AGE_DAYS * 86400;

  const stats = { listed: jobs.length, viewed: 0, prefiltered: 0, duplicates: 0, known: 0, saved: 0 };
  let stopReason = 'end of list';
  let seenStreak = 0;
  const saved: string[] = [];
  const rejected: string[] = [];
  const dupLines: string[] = [];

  for (const j of jobs) {
    if (j.epoch < minEpoch) {
      stopReason = `older than ${env.COLLECT_MAX_AGE_DAYS}d`;
      break;
    }
    if (saved.length >= limit) {
      stopReason = `--limit ${limit}`;
      break;
    }
    stats.viewed++;
    const id = `${SOURCE}-${j.id}`;

    if (idx.byId.has(id) || seen.has(id)) {
      stats.known++;
      if (++seenStreak >= env.COLLECT_STOP_ON_SEEN) {
        stopReason = `${seenStreak} known in a row`;
        break;
      }
      continue;
    }
    seenStreak = 0;

    const f = prefilter(j);
    if (!f.ok) {
      stats.prefiltered++;
      seen.add(id);
      rejected.push(`- ${decode(j.position)} — ${decode(j.company)} (${f.reason})`);
      continue;
    }

    const { data, body } = toVacancy(j);
    const dup = findDuplicate(idx, { id, urls: [data.source_url, data.real_url].filter(Boolean) as string[], company: data.company, title: data.title });
    if (dup) {
      stats.duplicates++;
      const d = dup.vacancy.data;
      d.duplicates ??= [];
      const u = normUrl(data.source_url);
      if (!d.duplicates.some((x: any) => normUrl(x.url) === u) && normUrl(d.source_url) !== u) {
        d.duplicates.push({ source: SOURCE, url: data.source_url, seen_at: today() });
        if (data.real_url && !d.real_url) d.real_url = data.real_url;
        d.apply_target = pickApplyTarget(d);
        if (!dryRun) writeVacancy(dup.vacancy.file, d, dup.vacancy.body);
      }
      dupLines.push(`- ${data.title} — ${data.company} → дубль ${d.id} (по ${dup.by})`);
      idx.byId.set(id, dup.vacancy);
      continue;
    }

    const file = vacancyPath(data.collected_at, SOURCE, data.company, data.title);
    if (!dryRun) writeVacancy(file, data, body);
    const vf = { file, data, body };
    idx.byId.set(id, vf);
    idx.byKey.set(key(data.company, data.title), vf);
    stats.saved++;
    saved.push(file);
  }

  const rel = (f: string) => path.relative(process.cwd(), f);
  const log =
    `## ${SOURCE} — ${new Date().toISOString().slice(11, 16)} UTC${dryRun ? ' (dry-run)' : ''}\n\n` +
    `- в ленте: ${stats.listed}, просмотрено: ${stats.viewed}\n` +
    `- отсеяно предфильтром: ${stats.prefiltered}\n` +
    `- уже известных (вкл. отсеянные ранее): ${stats.known}, дублей с других площадок: ${stats.duplicates}\n` +
    `- сохранено новых: ${stats.saved}\n` +
    `- причина остановки: ${stopReason}\n\n` +
    (saved.length ? `### Сохранено (ждут скоринга)\n${saved.map((f) => `- ${rel(f)}`).join('\n')}\n\n` : '') +
    (dupLines.length ? `### Дубли\n${dupLines.join('\n')}\n\n` : '') +
    (rejected.length ? `<details><summary>Отсеяно предфильтром (${rejected.length})</summary>\n\n${rejected.join('\n')}\n\n</details>\n` : '');

  if (!dryRun) {
    seen.save();
    const logFile = appendRunLog('collect', log);
    console.log(`Run log: ${rel(logFile)}`);
  }
  console.log(log.replace(/<details>[\s\S]*<\/details>\n?/, `(отсеяно предфильтром: ${rejected.length}, список — в логе)\n`));
  if (saved.length && !dryRun) console.log(`NEXT: отскорить ${saved.length} вакансий (npm run pending), поискать real_url, затем npm run score && npm run validate; дописать data/insights.md`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
