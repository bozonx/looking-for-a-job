/**
 * Общий конвейер фазы A сбора (design.md §5.2) для любого источника.
 * Провайдер (scripts/providers/<source>.ts) только загружает страницы списка и переводит
 * вакансию площадки в поля front matter; лимиты, предфильтр, дедупликация, seen и лог — здесь.
 */
import { freshnessDays } from './freshness.ts';
import fs from 'node:fs';
import path from 'node:path';
import { env, today } from './env.ts';
import { loadAll, parseVacancy, vacancyPath, writeVacancy, type VacancyFile } from './vacancy.ts';
import { buildIndex, findDuplicate, key, normUrl, unknownCompany, type Index } from './dedupe.ts';
import { appendRunLog, appendRunStats } from './runlog.ts';
import { deriveApply } from './target.ts';
import { baseChannels, mergeChannels, type Channel } from './channels.ts';
import { MAX_FAILURES, SeenStore } from './seen.ts';
import { loadPrefilter } from './prefilter.ts';
import { sleep, takeHttpWarnings, takePartialList, withHttpWarnings } from './http.ts';
import { lastAttempt, lastRun, setLastAttempt, setLastRun } from './lastrun.ts';

/** запас окна сбора: площадки публикуют с задержкой, даты бывают в другом поясе */
const WINDOW_MARGIN_DAYS = 2;

/** Вакансия из списка площадки — минимум для лимитов и предфильтра; полная запись строится лениво. */
export interface RawJob {
  /** id на площадке; итоговый id = `<source>-<extId>` */
  extId: string;
  /** время публикации, мс; null — неизвестно (по возрасту тогда не останавливаемся) */
  postedAt: number | null;
  title: string;
  company: string;
  tags: string[];
  /** причина отсеять ещё до предфильтра (формат работы, не вакансия) — учитывается как отсеянная */
  skip?: string;
  /** поля front matter сверх blankVacancy() и markdown-тело */
  build(): Promise<{ data: Partial<VacancyData>; body: string }> | { data: Partial<VacancyData>; body: string };
}

export interface Provider {
  source: string;
  /** есть ли пагинация (тогда действует COLLECT_MAX_PAGES) */
  paginated: boolean;
  /** страница списка (с 0), новые сверху; пустой массив — конец списка */
  fetchPage(page: number): Promise<RawJob[]>;
  /** разбор сохранённого ответа площадки (флаг --file): разобранный JSON или текст (XML-ленты) */
  parse(input: unknown): RawJob[];
  /** пауза между страницами, мс (по умолчанию 1000) */
  pageDelayMs?: number;
  /**
   * Список — снимок всех открытых вакансий (ATS компаний), а не лента «новые сверху»:
   * нет отсечки по возрасту и остановки на известных; известные продлевают запись в seen.
   */
  snapshot?: boolean;
  /**
   * Только для snapshot: покрывает ли успешно загруженный список вакансию с этим extId.
   * Покрытые, но отсутствующие в списке вакансии помечаются possibly_closed: true.
   */
  covers?(extId: string): boolean;
  /** некритичные проблемы последней загрузки (например, одна компания из списка не ответила) */
  takeWarnings?(): string[];
  /** не чаще раза в N часов (условия площадки); раньше — источник пропускается */
  minIntervalHours?: number;
}

/** Идентификатор текущего запуска сбора — время старта процесса; см. lastcollect.ts. */
export const COLLECT_RUN = new Date().toISOString();

export type VacancyData = ReturnType<typeof blankVacancy>;

export function blankVacancy(source: string, extId: string) {
  return {
    id: `${source}-${extId}`,
    title: '',
    company: 'Unknown',
    company_country: null as string | null,
    hire_from_ar: 'unknown' as string,
    hire_from_ar_evidence: null as string | null,
    source,
    source_url: '',
    real_url: null as string | null,
    apply_method: 'unknown',
    apply_channels: [] as Channel[],
    duplicates: [] as { source: string; url: string; seen_at?: string; id?: string }[],
    apply_target: null as string | null,
    collected_at: today(),
    collected_run: COLLECT_RUN as string | null,
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
    status: null as string | null,
    attention_reason: null,
    attention_details: null,
    starred: false,
    flagged: false,
    notes: '',
    possibly_closed: false,
    applied_at: null,
    apply_log: null,
    applied_via: null,
    scoring_version: null,
    prefilter_reason: null as string | null,
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
  /** источник пропущен (minIntervalHours) */
  skipped?: string;
  stats?: { listed: number; prefiltered: number; duplicates: number; known: number; old: number; saved: number; errors: number };
  /** строки разделов «Ошибки» и «⚠ Предупреждения» лога (с ведущим «- ») */
  errors?: string[];
  warnings?: string[];
  /** дубли, совпавшие только по компании+названию, — агент сверяет тексты */
  titleOnlyDups?: string[];
  stopReason?: string;
}

async function* pages(p: Provider, opts: CollectOptions, onStop: (r: string) => void, stopped: () => boolean): AsyncGenerator<RawJob[]> {
  if (opts.file) {
    const text = fs.readFileSync(opts.file, 'utf8');
    let input: unknown = text;
    try {
      input = JSON.parse(text);
    } catch {
      /* не JSON — отдаём текст (RSS/Atom) */
    }
    const list = p.parse(input);
    if (!list.length) throw new Error(`в файле ${opts.file} нет вакансий`);
    yield list;
    return;
  }
  const max = p.paginated ? env.COLLECT_MAX_PAGES : 1;
  for (let i = 0; i < max; i++) {
    if (stopped()) return;
    if (i > 0) await sleep(p.pageDelayMs ?? 1000);
    const list = await p.fetchPage(i);
    // пустая первая страница — скорее капча/логин/сменилась вёрстка, чем пустая лента
    if (!list.length && i === 0) throw new Error('первая страница списка пуста (капча, логин, сменилась вёрстка или слишком узкий фильтр?)');
    if (!list.length) return;
    yield list;
  }
  if (p.paginated) onStop(`COLLECT_MAX_PAGES=${max}`);
}

/**
 * Общее состояние запуска: файлы вакансий и индекс дублей. Источники собираются параллельно,
 * и индекс у них один — вакансия, сохранённая одним источником, сразу видна остальным как дубль.
 * Гонок нет: от findDuplicate до записи файла и обновления индекса в коде нет await,
 * а JS однопоточный — этот участок для каждой вакансии выполняется целиком.
 */
export interface CollectContext {
  all: VacancyFile[];
  idx: Index;
}

/**
 * Изменить вакансию, не затирая чужие правки: снимок `all` загружен в начале запуска, а за минуты сбора
 * файл мог поменять UI (status/starred/notes) или агент (скоринг). Поэтому файл перечитывается прямо
 * перед записью, mutate применяется к свежей версии, и она же становится записью в индексе.
 * mutate возвращает false — менять нечего, файл не пишется.
 */
function updateVacancy(v: VacancyFile, dryRun: boolean, mutate: (d: VacancyData & Record<string, any>) => boolean): boolean {
  let fresh: VacancyFile = v;
  if (!dryRun) {
    try {
      fresh = parseVacancy(v.file);
    } catch {
      /* файла нет/битый — работаем с копией в памяти */
    }
  }
  if (!mutate(fresh.data as any)) return false;
  if (!dryRun) writeVacancy(v.file, fresh.data, fresh.body);
  v.data = fresh.data;
  v.body = fresh.body;
  return true;
}

export function collectContext(): CollectContext {
  const all = loadAll();
  return { all, idx: buildIndex(all) };
}

export function collect(p: Provider, opts: CollectOptions, ctx: CollectContext = collectContext()): Promise<CollectResult> {
  return withHttpWarnings(() => collectSource(p, opts, ctx));
}

async function collectSource(p: Provider, opts: CollectOptions, { all, idx }: CollectContext): Promise<CollectResult> {
  const SOURCE = p.source;
  const seen = new SeenStore(SOURCE);
  const prefilter = loadPrefilter();
  const startedAt = Date.now();
  const prev = opts.file ? null : lastRun(SOURCE);

  const attempt = opts.file ? null : lastAttempt(SOURCE);
  const prevAttempt = opts.file ? null : Math.max(prev ?? 0, attempt ?? 0) || null;
  // прошлый запуск оборвался (лимиты, ошибка, неполный список) — хвост ленты не дочитан и лежит под уже
  // известными вакансиями: известные не останавливают сбор, только вышедшие из окна по дате
  const resume = !!attempt && (!prev || attempt > prev);
  if (prevAttempt && p.minIntervalHours && startedAt - prevAttempt < p.minIntervalHours * 3600e3) {
    const next = new Date(prevAttempt + p.minIntervalHours * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
    console.log(`## ${SOURCE} — пропущен: площадка просит не чаще раза в ${p.minIntervalHours} ч (следующий сбор после ${next} UTC)\n`);
    return { source: SOURCE, saved: 0, failed: false, skipped: `не чаще раза в ${p.minIntervalHours} ч, следующий после ${next} UTC` };
  }

  // окно сбора: с прошлого полного сбора (+ запас), но не дальше COLLECT_MAX_AGE_DAYS; первый сбор — COLLECT_MAX_AGE_DAYS
  // и не дальше freshness_days источника: старее — всё равно не попадёт в очередь скоринга
  const fresh = freshnessDays(SOURCE);
  const maxAgeDays = fresh == null ? env.COLLECT_MAX_AGE_DAYS : Math.min(env.COLLECT_MAX_AGE_DAYS, fresh);
  const capTime = startedAt - maxAgeDays * 86400e3;
  const minTime = prev ? Math.max(capTime, prev - WINDOW_MARGIN_DAYS * 86400e3) : capTime;
  const windowDays = Math.ceil((startedAt - minTime) / 86400e3);
  const windowNote = p.snapshot
    ? 'полный список (snapshot), без окна по дате'
    : `с ${new Date(minTime).toISOString().slice(0, 10)} (${windowDays} дн.; ${prev ? `прошлый сбор ${new Date(prev).toISOString().slice(0, 10)}` : 'первый сбор'})`;

  if (!opts.file && !opts.dryRun) setLastAttempt(SOURCE, startedAt);
  const stats = { listed: 0, pages: 0, viewed: 0, prefiltered: 0, duplicates: 0, known: 0, old: 0, saved: 0, errors: 0 };
  const warnings: string[] = [];
  let stopReason = 'end of list';
  /** лента дочитана до конца или до известных — можно сдвигать окно */
  let complete = true;
  let seenStreak = 0;
  /** COLLECT_STOP_ON_SEEN сработал: текущую страницу дочитываем, следующие не грузим */
  let streakStop = false;
  let failed = false;
  const saved: string[] = [];
  const rejected: string[] = [];
  const dupLines: string[] = [];
  const merged: string[] = [];
  const errors: string[] = [];
  const listedIds = new Set<string>();
  let closed = 0;
  let reopened = 0;

  outer: try {
    for await (const list of pages(p, opts, (r) => ((stopReason = r), (complete = false)), () => streakStop)) {
      stats.pages++;
      stats.listed += list.length;
      for (const j of list) listedIds.add(`${SOURCE}-${j.extId}`);
      for (const j of list) {
        if (saved.length >= opts.limit) {
          stopReason = `--limit ${opts.limit}`;
          complete = false;
          break outer;
        }
        if (saved.length >= env.COLLECT_MAX_NEW) {
          stopReason = `COLLECT_MAX_NEW=${env.COLLECT_MAX_NEW}`;
          complete = false;
          warnings.push(`- сработал страховочный лимит COLLECT_MAX_NEW=${env.COLLECT_MAX_NEW}: лента необычно большая — проверь фильтры источника; хвост ленты не собран`);
          break outer;
        }
        stats.viewed++;
        const id = `${SOURCE}-${j.extId}`;

        // старая (по дате) или известная — пропускаем и считаем подряд: одна закреплённая/промо-вакансия
        // наверху ленты не должна останавливать сбор
        const old = !p.snapshot && j.postedAt != null && j.postedAt < minTime;
        // отсеянная раньше, но проходящая предфильтр сейчас (его расширили) — не «известная», собираем заново
        const refiltered = !idx.byId.has(id) && seen.isPrefiltered(id) && !j.skip && prefilter(j.title, j.tags).ok;
        const known = !refiltered && (idx.byId.has(id) || seen.has(id));
        if (p.snapshot && known) {
          stats.known++;
          seen.add(id); // вакансия всё ещё открыта — не даём записи устареть
          continue;
        }
        if (old || known) {
          if (known) stats.known++;
          else stats.old++;
          // Остановка на известных экономит только загрузку следующих страниц: страница уже скачана,
          // а проверка «известна ли» бесплатна. Поэтому страница всегда дочитывается до конца — иначе новые
          // вакансии, оказавшиеся ниже известных (склейка нескольких лент, хвост прошлого обрыва), теряются.
          if (p.paginated && (old || !resume) && !streakStop && ++seenStreak >= env.COLLECT_STOP_ON_SEEN) {
            stopReason = `${seenStreak} известных/вне окна подряд (страница дочитана)`;
            streakStop = true;
          }
          continue;
        }
        seenStreak = 0;

        try {
          const f = j.skip ? { ok: false, reason: j.skip } : prefilter(j.title, j.tags);
          if (!f.ok) {
            stats.prefiltered++;
            seen.add(id, true);
            rejected.push(`- ${j.title} — ${j.company} (${f.reason})`);
            if (!opts.dryRun) {
              const built = await j.build();
              const data: VacancyData = { ...blankVacancy(SOURCE, j.extId), title: j.title, company: j.company || 'Unknown', tags: j.tags, ...built.data, id, prefilter_reason: f.reason };
              writeVacancy(vacancyPath(data.collected_at, SOURCE, data.company, data.title, j.extId), data, built.body);
            }
            continue;
          }

          const built = await j.build();
          const data: VacancyData = { ...blankVacancy(SOURCE, j.extId), title: j.title, company: j.company || 'Unknown', tags: j.tags, ...built.data, id };
          if (!data.source_url) throw new Error('no source_url');
          const urls = [data.source_url, data.real_url].filter(Boolean) as string[];
          const dup = findDuplicate(idx, { id, urls, company: data.company, title: data.title });

          // company+title в том же источнике при другом id — та же роль в другой стране/офисе: одна запись,
          // локации сливаются в location, ссылка (с id) — в duplicates; скорить одно и то же дважды незачем
          let sameSource = !!dup && dup.by === 'company+title' && dup.vacancy.data.source === SOURCE;
          // snapshot (ATS): обе вакансии открыты одновременно, и если локация не отличается — это разные
          // позиции с одинаковым названием (разные команды), а не одна роль в нескольких офисах
          const otherRole =
            sameSource && !!p.snapshot && (!data.location || String(dup!.vacancy.data.location ?? '').includes(data.location));
          if (otherRole) sameSource = false;

          if (dup && !otherRole) {
            stats.duplicates++;
            const u = normUrl(data.source_url);
            const added = updateVacancy(dup.vacancy, opts.dryRun, (d) => {
              d.duplicates ??= [];
              // перевыложили (дубль опубликован позже) — двигаем posted_at: иначе запись остаётся «несвежей»
              // и не попадёт в очередь скоринга, хотя вакансия жива
              const reposted = !!data.posted_at && (!d.posted_at || data.posted_at > d.posted_at);
              if (reposted) d.posted_at = data.posted_at;
              if (d.duplicates.some((x: any) => normUrl(x.url) === u) || normUrl(d.source_url) === u) return reposted;
              d.duplicates.push({ source: SOURCE, url: data.source_url, seen_at: today(), ...(sameSource ? { id } : {}) });
              if (sameSource && data.location && !String(d.location ?? '').includes(data.location))
                d.location = d.location ? `${d.location}; ${data.location}` : data.location;
              if (data.real_url && !d.real_url) d.real_url = data.real_url;
              d.apply_channels = mergeChannels(d.apply_channels, baseChannels({ ...data, apply_channels: [] }, built.body));
              deriveApply(d);
              return true;
            });
            if (added) idx.byUrl.set(u, dup.vacancy);
            const d = dup.vacancy.data;
            if (sameSource) {
              merged.push(`- ${id} → ${d.id}: «${data.title} — ${data.company}»${data.location ? ` (+ ${data.location})` : ''}`);
              idx.byId.set(id, dup.vacancy);
              seen.add(id);
              continue;
            }
            const check = dup.by === 'company+title' ? ' — совпадение только по названию, проверь' : '';
            dupLines.push(`- ${data.title} — ${data.company} → дубль ${d.id} (по ${dup.by})${check}`);
            idx.byId.set(id, dup.vacancy);
            seen.add(id); // чтобы при следующем сборе считалась «известной»
            continue;
          }

          data.apply_channels = baseChannels(data, built.body);
          deriveApply(data);
          let file = vacancyPath(data.collected_at, SOURCE, data.company, data.title, j.extId);
          if (fs.existsSync(file)) throw new Error(`[bug] коллизия имени файла (другая вакансия уже записана под этим именем): ${path.relative(process.cwd(), file)}`);
          if (!opts.dryRun) writeVacancy(file, data, built.body);
          const vf = { file, data, body: built.body };
          idx.byId.set(id, vf);
          for (const u of urls) idx.byUrl.set(normUrl(u), vf);
          if (!unknownCompany(data.company) && !otherRole) idx.byKey.set(key(data.company, data.title), vf);
          seen.add(id); // чтобы после удаления файла (cleanup) вакансия не вернулась как новая
          stats.saved++;
          saved.push(file);
        } catch (e) {
          stats.errors++;
          const msg = (e as Error).message;
          // повторяем в следующих сборах, но не бесконечно: после MAX_FAILURES — считаем известной
          const n = msg.startsWith('[bug]') ? 0 : seen.addFailure(id);
          if (n && n < MAX_FAILURES && !p.snapshot) complete = false; // окно не сдвигаем — вакансия не выпадет из него
          const tail = n >= MAX_FAILURES ? ` — попытка ${n} из ${MAX_FAILURES}, больше не пробуем` : n ? ` — попытка ${n} из ${MAX_FAILURES}` : '';
          errors.push(`- ${id} «${j.title}»: ${msg}${tail}`);
        }
      }
    }
  } catch (e) {
    failed = true;
    complete = false;
    stats.errors++;
    stopReason = `ошибка загрузки списка: ${(e as Error).message}`;
    errors.push(`- список (страница ${stats.pages}): ${(e as Error).message}`);
  }

  // переполнение окна: лента дочитана до конца, но в ней нет ни одной известной или старой вакансии —
  // значит, между сборами вышло больше, чем отдаёт площадка, и часть вакансий, вероятно, пропущена
  if (!p.snapshot && prev && !failed && complete && stopReason === 'end of list' && stats.listed > 0 && stats.known === 0 && stats.old === 0) {
    const hours = Math.round((startedAt - prev) / 3600e3);
    warnings.push(`- возможен пропуск: все ${stats.listed} вакансий ленты новые (прошлый сбор ${hours} ч назад) — собирай чаще или сузь фильтр источника`);
  }

  warnings.push(...[...(p.takeWarnings?.() ?? []), ...takeHttpWarnings()].map((w) => `- ${w}`));
  // часть лент/категорий/запросов не загрузилась — их вакансии придут в следующий раз, окно не сдвигаем
  if (takePartialList() && !p.snapshot && complete) {
    complete = false;
    stopReason += ' (список загружен не полностью — окно не сдвинуто)';
  }

  // snapshot: вакансии источника, пропавшие из полного списка, вероятно закрыты (и наоборот)
  if (p.snapshot && p.covers && !failed && !opts.file) {
    for (const v of all) {
      const d = v.data;
      if (d.source !== SOURCE) continue;
      const ext = String(d.id).slice(SOURCE.length + 1);
      if (!p.covers(ext)) continue;
      // открыта, если в списке есть она сама или склеенная с ней вакансия того же источника
      updateVacancy(v, opts.dryRun, (fd) => {
        const gone = !listedIds.has(fd.id) && !(fd.duplicates ?? []).some((x: any) => x.id && listedIds.has(x.id));
        if (gone === !!fd.possibly_closed) return false;
        fd.possibly_closed = gone;
        if (gone) closed++;
        else reopened++;
        return true;
      });
    }
  }

  const rel = (f: string) => path.relative(process.cwd(), f);
  const log =
    `## ${SOURCE} — ${new Date().toISOString().slice(11, 16)} UTC${opts.dryRun ? ' (dry-run)' : ''}\n\n` +
    `- окно: ${windowNote}${resume ? '; дочитывание после обрыва (остановка только по дате)' : ''}\n` +
    `- страниц: ${stats.pages}, в ленте: ${stats.listed}, просмотрено: ${stats.viewed}\n` +
    `- отсеяно предфильтром: ${stats.prefiltered}\n` +
    `- уже известных (вкл. отсеянные и удалённые ранее): ${stats.known}, вне окна по дате: ${stats.old}, дублей с других площадок: ${stats.duplicates}\n` +
    `- сохранено новых: ${stats.saved}\n` +
    (p.snapshot ? `- помечено possibly_closed (нет в списке): ${closed}, снова открыто: ${reopened}\n` : '') +
    `- ошибок: ${stats.errors}\n` +
    `- причина остановки: ${stopReason}\n\n` +
    (warnings.length ? `### ⚠ Предупреждения\n${warnings.join('\n')}\n\n` : '') +
    (errors.length ? `### Ошибки\n${errors.join('\n')}\n\n` : '') +
    (saved.length ? `### Сохранено (ждут скоринга)\n${saved.map((f) => `- ${rel(f)}`).join('\n')}\n\n` : '') +
    (dupLines.length ? `### Дубли\n${dupLines.join('\n')}\n\n` : '') +
    (merged.length ? `### Склеено (та же роль в другой локации того же источника)\n${merged.join('\n')}\n\n` : '') +
    (rejected.length ? `<details><summary>Отсеяно предфильтром (${rejected.length})</summary>\n\n${rejected.join('\n')}\n\n</details>\n` : '');

  if (!opts.dryRun) {
    seen.save();
    if (complete && !opts.file) setLastRun(SOURCE, startedAt);
    if (!opts.file) appendRunStats({ kind: 'collect', source: SOURCE, ...stats, closed, reopened, failed, stop: stopReason });
    appendRunLog('collect', log);
  }
  // подробный лог — только в файле (и в dry-run): агенту хватает «ИТОГ СБОРА», не тратим токены на дубль лога
  if (opts.dryRun) console.log(log.replace(/<details>[\s\S]*<\/details>\n?/, `(отсеяно предфильтром: ${rejected.length})\n`));
  else console.log(`${SOURCE}: в ленте ${stats.listed}, новых ${stats.saved}, ошибок ${stats.errors} — ${stopReason}`);
  return {
    source: SOURCE,
    saved: stats.saved,
    failed,
    stats,
    errors,
    warnings,
    titleOnlyDups: dupLines.filter((l) => l.includes('совпадение только по названию')),
    stopReason,
  };
}
