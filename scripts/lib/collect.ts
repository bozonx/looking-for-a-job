/**
 * Общий конвейер фазы A сбора (design.md §5.2) для любого источника.
 * Провайдер (scripts/providers/<source>.ts) только загружает страницы списка и переводит
 * вакансию площадки в поля front matter; лимиты, предфильтр, дедупликация, seen и лог — здесь.
 */
import fs from 'node:fs';
import path from 'node:path';
import { env, today } from './env.ts';
import { loadAll, vacancyPath, writeVacancy } from './vacancy.ts';
import { buildIndex, findDuplicate, key, normUrl, type Index } from './dedupe.ts';
import { appendRunLog } from './runlog.ts';
import { pickApplyTarget } from './target.ts';
import { SeenStore } from './seen.ts';
import { loadPrefilter } from './prefilter.ts';
import { sleep } from './http.ts';

/** Вакансия из списка площадки — минимум для лимитов и предфильтра; полная запись строится лениво. */
export interface RawJob {
  /** id на площадке; итоговый id = `<source>-<extId>` */
  extId: string;
  /** время публикации, мс; null — неизвестно (по возрасту тогда не останавливаемся) */
  postedAt: number | null;
  title: string;
  company: string;
  tags: string[];
  /** поля front matter сверх blankVacancy() и markdown-тело */
  build(): Promise<{ data: Partial<VacancyData>; body: string }> | { data: Partial<VacancyData>; body: string };
}

export interface Provider {
  source: string;
  /** есть ли пагинация (тогда действует COLLECT_MAX_PAGES) */
  paginated: boolean;
  /** страница списка (с 0), новые сверху; пустой массив — конец списка */
  fetchPage(page: number): Promise<RawJob[]>;
  /** разбор сохранённого ответа площадки (флаг --file) */
  parse(json: unknown): RawJob[];
  /** пауза между страницами, мс (по умолчанию 1000) */
  pageDelayMs?: number;
}

export type VacancyData = ReturnType<typeof blankVacancy>;

export function blankVacancy(source: string, extId: string) {
  return {
    id: `${source}-${extId}`,
    title: '',
    company: 'Unknown',
    company_country: null as string | null,
    source,
    source_url: '',
    real_url: null as string | null,
    apply_method: 'unknown',
    duplicates: [] as { source: string; url: string; seen_at?: string }[],
    apply_target: null as string | null,
    collected_at: today(),
    posted_at: null as string | null,
    location: null as string | null,
    region: null as string | null,
    salary: null as null | { min: number | null; max: number | null; currency: string; period: string },
    employment: 'unknown',
    vacancy_language: null as string | null,
    work_languages: null as string[] | null,
    role_tracks: [] as string[],
    tags: [] as string[],
    summary: null,
    key_points: null,
    red_flags: null,
    scores: null,
    stop_flags: [] as string[],
    best_resume: null,
    score_reasoning: null,
    requirements_special: [] as string[],
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
}

/** extId → допустимая часть id (схема: [A-Za-z0-9_-]). */
export const safeExtId = (s: string | number) => String(s).replace(/[^A-Za-z0-9_-]+/g, '_');

export interface CollectOptions {
  dryRun: boolean;
  limit: number;
  file?: string;
}

export interface CollectResult {
  source: string;
  saved: number;
  failed: boolean;
}

async function* pages(p: Provider, opts: CollectOptions, onStop: (r: string) => void): AsyncGenerator<RawJob[]> {
  if (opts.file) {
    yield p.parse(JSON.parse(fs.readFileSync(opts.file, 'utf8')));
    return;
  }
  const max = p.paginated ? env.COLLECT_MAX_PAGES : 1;
  for (let i = 0; i < max; i++) {
    if (i > 0) await sleep(p.pageDelayMs ?? 1000);
    const list = await p.fetchPage(i);
    if (!list.length) return;
    yield list;
  }
  if (p.paginated) onStop(`COLLECT_MAX_PAGES=${max}`);
}

export async function collect(p: Provider, opts: CollectOptions): Promise<CollectResult> {
  const SOURCE = p.source;
  const all = loadAll();
  const idx: Index = buildIndex(all);
  const seen = new SeenStore(SOURCE);
  const prefilter = loadPrefilter();
  const minTime = Date.now() - env.COLLECT_MAX_AGE_DAYS * 86400e3;

  const stats = { listed: 0, pages: 0, viewed: 0, prefiltered: 0, duplicates: 0, known: 0, saved: 0, errors: 0 };
  let stopReason = 'end of list';
  let seenStreak = 0;
  let failed = false;
  const saved: string[] = [];
  const rejected: string[] = [];
  const dupLines: string[] = [];
  const maybeDup: string[] = [];
  const errors: string[] = [];

  outer: try {
    for await (const list of pages(p, opts, (r) => (stopReason = r))) {
      stats.pages++;
      stats.listed += list.length;
      for (const j of list) {
        if (j.postedAt != null && j.postedAt < minTime) {
          stopReason = `older than ${env.COLLECT_MAX_AGE_DAYS}d`;
          break outer;
        }
        if (saved.length >= opts.limit) {
          stopReason = `--limit ${opts.limit}`;
          break outer;
        }
        stats.viewed++;
        const id = `${SOURCE}-${j.extId}`;

        if (idx.byId.has(id) || seen.has(id)) {
          stats.known++;
          if (++seenStreak >= env.COLLECT_STOP_ON_SEEN) {
            stopReason = `${seenStreak} known in a row`;
            break outer;
          }
          continue;
        }
        seenStreak = 0;

        try {
          const f = prefilter(j.title, j.tags);
          if (!f.ok) {
            stats.prefiltered++;
            seen.add(id);
            rejected.push(`- ${j.title} — ${j.company} (${f.reason})`);
            continue;
          }

          const built = await j.build();
          const data: VacancyData = { ...blankVacancy(SOURCE, j.extId), title: j.title, company: j.company || 'Unknown', tags: j.tags, ...built.data, id };
          if (!data.source_url) throw new Error('no source_url');
          const urls = [data.source_url, data.real_url].filter(Boolean) as string[];
          let dup = findDuplicate(idx, { id, urls, company: data.company, title: data.title });

          // company+title в том же источнике при другом id — скорее разные вакансии (другая страна/команда): сохраняем, но помечаем
          if (dup && dup.by === 'company+title' && dup.vacancy.data.source === SOURCE) {
            maybeDup.push(`- ${id} ↔ ${dup.vacancy.data.id}: «${data.title} — ${data.company}» (тот же источник, сохранено отдельно)`);
            dup = null;
          }

          if (dup) {
            stats.duplicates++;
            const d = dup.vacancy.data;
            d.duplicates ??= [];
            const u = normUrl(data.source_url);
            if (!d.duplicates.some((x: any) => normUrl(x.url) === u) && normUrl(d.source_url) !== u) {
              d.duplicates.push({ source: SOURCE, url: data.source_url, seen_at: today() });
              if (data.real_url && !d.real_url) d.real_url = data.real_url;
              d.apply_target = pickApplyTarget(d);
              if (!opts.dryRun) writeVacancy(dup.vacancy.file, d, dup.vacancy.body);
              idx.byUrl.set(u, dup.vacancy);
            }
            const check = dup.by === 'company+title' ? ' — совпадение только по названию, проверь' : '';
            dupLines.push(`- ${data.title} — ${data.company} → дубль ${d.id} (по ${dup.by})${check}`);
            idx.byId.set(id, dup.vacancy);
            seen.add(id); // чтобы при следующем сборе считалась «известной»
            continue;
          }

          data.apply_target = pickApplyTarget(data);
          let file = vacancyPath(data.collected_at, SOURCE, data.company, data.title, j.extId);
          if (fs.existsSync(file)) throw new Error(`file exists: ${file}`);
          if (!opts.dryRun) writeVacancy(file, data, built.body);
          const vf = { file, data, body: built.body };
          idx.byId.set(id, vf);
          for (const u of urls) idx.byUrl.set(normUrl(u), vf);
          idx.byKey.set(key(data.company, data.title), vf);
          stats.saved++;
          saved.push(file);
        } catch (e) {
          stats.errors++;
          errors.push(`- ${id} «${j.title}»: ${(e as Error).message}`);
        }
      }
    }
  } catch (e) {
    failed = true;
    stats.errors++;
    stopReason = `ошибка загрузки списка: ${(e as Error).message}`;
    errors.push(`- список (страница ${stats.pages}): ${(e as Error).message}`);
  }

  const rel = (f: string) => path.relative(process.cwd(), f);
  const log =
    `## ${SOURCE} — ${new Date().toISOString().slice(11, 16)} UTC${opts.dryRun ? ' (dry-run)' : ''}\n\n` +
    `- страниц: ${stats.pages}, в ленте: ${stats.listed}, просмотрено: ${stats.viewed}\n` +
    `- отсеяно предфильтром: ${stats.prefiltered}\n` +
    `- уже известных (вкл. отсеянные ранее): ${stats.known}, дублей с других площадок: ${stats.duplicates}\n` +
    `- сохранено новых: ${stats.saved}\n` +
    `- ошибок: ${stats.errors}\n` +
    `- причина остановки: ${stopReason}\n\n` +
    (errors.length ? `### Ошибки\n${errors.join('\n')}\n\n` : '') +
    (saved.length ? `### Сохранено (ждут скоринга)\n${saved.map((f) => `- ${rel(f)}`).join('\n')}\n\n` : '') +
    (dupLines.length ? `### Дубли\n${dupLines.join('\n')}\n\n` : '') +
    (maybeDup.length ? `### Возможные дубли (проверь)\n${maybeDup.join('\n')}\n\n` : '') +
    (rejected.length ? `<details><summary>Отсеяно предфильтром (${rejected.length})</summary>\n\n${rejected.join('\n')}\n\n</details>\n` : '');

  if (!opts.dryRun) {
    seen.save();
    console.log(`Run log: ${rel(appendRunLog('collect', log))}`);
  }
  console.log(log.replace(/<details>[\s\S]*<\/details>\n?/, `(отсеяно предфильтром: ${rejected.length}, список — в логе)\n`));
  return { source: SOURCE, saved: stats.saved, failed };
}
