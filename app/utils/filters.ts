/**
 * Фильтрация и сортировка списка вакансий — чистые функции без Vue (тесты: app/utils/filters.test.ts).
 * Импорты явные (с .ts), чтобы модуль запускался и в `node --test`.
 */
import { hasUserNotes } from '../../scripts/lib/uipatch.ts';
import { channelKind } from './labels.ts';

export type Row = Record<string, any>;
export type SortKey = { key: string; dir: 'asc' | 'desc' };
/** Период: null — всё время, 'last' — последний сбор, число — за N дней. */
export type Period = number | 'last' | null;
export type TriState = 'any' | 'yes' | 'no';

/** Значение «не задано» в мультиселектах по полям, которые бывают null (регион, страна, язык, стоп-факторы). */
export const NONE = 'none';

export interface Filters {
  /** статусы + псевдостатусы: none, starred, flagged, noted, closed */
  statuses: string[];
  minOverall: number;
  minTrackFit: number;
  outcomes: string[];
  appliedVia: string[];
  /** отскорена ли агентом (scores != null) */
  scored: TriState;
  tracks: string[];
  sources: string[];
  regions: string[];
  countries: string[];
  langs: string[];
  /** тип канала отклика: ats, form, email, telegram… (labels.ts channelKind) */
  channels: string[];
  employment: string[];
  /** NONE — без стоп-факторов, иначе — есть любой из выбранных */
  stopFlags: string[];
  /** указана ли зарплата */
  salary: TriState;
  period: Period;
  sorts: SortKey[];
}

export const blankFilters = (): Filters => ({
  statuses: [], minOverall: 0, minTrackFit: 0, outcomes: [], appliedVia: [], scored: 'any', tracks: [], sources: [], regions: [], countries: [], langs: [], channels: [],
  employment: [], stopFlags: [], salary: 'any', period: null,
  sorts: [{ key: 'overall', dir: 'desc' }],
});
export const cloneFilters = (x: Filters): Filters => JSON.parse(JSON.stringify(x));

/** Привести сохранённые (localStorage) фильтры к текущей форме: неизвестное — по умолчанию. */
export function normFilters(raw: any): Filters {
  const d = blankFilters();
  if (!raw || typeof raw !== 'object') return d;
  const arr = (x: any) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string') : []);
  const tri = (x: any): TriState => (x === 'yes' || x === 'no' ? x : 'any');
  const sorts = Array.isArray(raw.sorts)
    ? raw.sorts.filter((s: any) => s && typeof s.key === 'string' && (s.dir === 'asc' || s.dir === 'desc'))
    : [];
  return {
    statuses: arr(raw.statuses),
    minOverall: typeof raw.minOverall === 'number' ? raw.minOverall : 0,
    minTrackFit: typeof raw.minTrackFit === 'number' ? Math.max(0, Math.min(100, raw.minTrackFit)) : 0,
    outcomes: arr(raw.outcomes),
    appliedVia: arr(raw.appliedVia),
    scored: tri(raw.scored),
    tracks: arr(raw.tracks),
    sources: arr(raw.sources),
    regions: arr(raw.regions),
    countries: arr(raw.countries),
    langs: arr(raw.langs),
    channels: arr(raw.channels),
    employment: arr(raw.employment),
    stopFlags: arr(raw.stopFlags),
    salary: tri(raw.salary),
    period: raw.period === 'last' || typeof raw.period === 'number' ? raw.period : null,
    sorts: sorts.length ? sorts : d.sorts,
  };
}

/**
 * Статусы и пометки (★, ⚑, заметка): выбранные значения объединяются через ИЛИ.
 * «закрытые» вместе с другими значениями — включить и закрытые; «закрытые» в одиночку — только закрытые.
 * Без «закрытых» закрытые скрыты.
 */
export function matchStatus(v: Row, sel: string[]): boolean {
  const rest = sel.filter((s) => s !== 'closed');
  const withClosed = rest.length < sel.length;
  if (v.possibly_closed && !withClosed) return false;
  if (!rest.length) return !!v.possibly_closed || !withClosed;
  return (
    rest.includes(v.status ?? NONE) ||
    (rest.includes('flagged') && !!v.flagged) ||
    (rest.includes('starred') && !!v.starred) ||
    (rest.includes('noted') && hasUserNotes(v.notes))
  );
}

/** Все типы каналов вакансии: основной + все из apply_channels. */
export function rowKinds(v: Row): string[] {
  const ks = new Set<string>([channelKind(v.apply_method)]);
  for (const c of v.apply_channels ?? []) ks.add(c.type);
  if (ks.size > 1) ks.delete('unknown');
  return [...ks];
}

/** Дата N дней назад, YYYY-MM-DD (локальная). */
export function cutoff(days: number, now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Выбрано ли значение поля; null/'' сопоставляется с NONE. */
const inSel = (sel: string[], val: unknown) => sel.includes(val == null || val === '' ? NONE : String(val));
const tri = (t: TriState, has: boolean) => t === 'any' || (t === 'yes') === has;

export interface MatchCtx {
  /** collected_run последнего сбора — для периода «последний сбор» */
  lastRun: string | null;
  now?: Date;
}

export const isFresh = (v: Row, lastRun: string | null) => !!v.collected_run && v.collected_run === lastRun;

export function matchRow(v: Row, fl: Filters, ctx: MatchCtx): boolean {
  if (!matchStatus(v, fl.statuses)) return false;
  if (!tri(fl.scored, v.scores != null)) return false;
  if (fl.minOverall && v.scores != null && (v.scores.overall ?? 0) < fl.minOverall) return false;
  if (fl.tracks.length && !fl.tracks.includes(v.best_resume) && !(v.role_tracks ?? []).some((t: string) => fl.tracks.includes(t))) return false;
  if (fl.minTrackFit > 0 && !Object.entries(v.scores?.fit ?? {}).some(([track, fit]) =>
    (!fl.tracks.length || fl.tracks.includes(track)) && typeof fit === 'number' && fit >= fl.minTrackFit)) return false;
  if (fl.outcomes.length && !inSel(fl.outcomes, v.outcome)) return false;
  if (fl.appliedVia.length && !inSel(fl.appliedVia, v.applied_via)) return false;
  if (fl.sources.length && !fl.sources.includes(v.source)) return false;
  if (fl.regions.length && !inSel(fl.regions, v.region)) return false;
  if (fl.countries.length && !inSel(fl.countries, v.company_country)) return false;
  if (fl.langs.length && !inSel(fl.langs, v.vacancy_language)) return false;
  if (fl.channels.length && !rowKinds(v).some((k) => fl.channels.includes(k))) return false;
  if (fl.employment.length && !fl.employment.includes(v.employment ?? 'unknown')) return false;
  if (fl.stopFlags.length) {
    const flags: string[] = v.stop_flags ?? [];
    if (!(flags.length ? flags.some((s) => fl.stopFlags.includes(s)) : fl.stopFlags.includes(NONE))) return false;
  }
  if (!tri(fl.salary, v.salary != null)) return false;
  if (fl.period === 'last' && !isFresh(v, ctx.lastRun)) return false;
  if (typeof fl.period === 'number' && fl.period > 0) {
    const d = v.posted_at ?? v.collected_at;
    if (!d || String(d).slice(0, 10) < cutoff(fl.period, ctx.now)) return false;
  }
  return true;
}

/** Быстрый поиск: название, компания, локация, теги, summary, навыки (_skills из списка API). */
export function matchQuery(v: Row, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const hay = [v.title, v.company, v.location, v.summary, ...(v.tags ?? []), ...(v._skills ?? [])].filter(Boolean).join(' ').toLowerCase();
  return s.split(/\s+/).every((w) => hay.includes(w));
}

// ---- сортировка ----
export const SORT_GET: Record<string, (v: Row) => string | number | null> = {
  overall: (v) => v.scores?.overall ?? null,
  date: (v) => v.posted_at ?? v.collected_at ?? null,
  company: (v) => v.company ?? null,
  profile: (v) => v.best_resume ?? null,
  region: (v) => v.region ?? null,
  remote: (v) => v.scores?.remote ?? null,
  startup: (v) => v.scores?.startup ?? null,
  corporate: (v) => v.scores?.corporate ?? null,
  outsource: (v) => v.scores?.outsource ?? null,
  legitimacy: (v) => v.scores?.legitimacy ?? null,
};
/** Ключи, у которых первый клик сортирует по возрастанию. */
export const ASC_FIRST = new Set(['company', 'profile', 'region', 'corporate', 'outsource']);

function cmp1(a: Row, b: Row, { key, dir }: SortKey): number {
  const get = SORT_GET[key];
  if (!get) return 0;
  const x = get(a), y = get(b);
  if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1; // пустые всегда в конце
  const sign = dir === 'asc' ? 1 : -1;
  return sign * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)));
}

/** ★ всегда сверху, дальше — по ключам сортировки. */
export function sortRows(list: Row[], sorts: SortKey[]): Row[] {
  return [...list].sort((a, b) => {
    const st = Number(!!b.starred) - Number(!!a.starred);
    if (st) return st;
    for (const k of sorts) {
      const c = cmp1(a, b, k);
      if (c) return c;
    }
    return 0;
  });
}

/** Клик по заголовку: сменить/перевернуть ключ; с Shift — добавить ключ, третий клик убирает его. */
export function nextSorts(sorts: SortKey[], key: string, shift: boolean): SortKey[] {
  const first: SortKey['dir'] = ASC_FIRST.has(key) ? 'asc' : 'desc';
  const flip = (s: SortKey): SortKey => ({ key: s.key, dir: s.dir === 'asc' ? 'desc' : 'asc' });
  const i = sorts.findIndex((s) => s.key === key);
  if (shift) {
    if (i < 0) return [...sorts, { key, dir: first }];
    if (sorts.length > 1 && sorts[i]!.dir !== first) return sorts.filter((_, j) => j !== i);
    return sorts.map((s, j) => (j === i ? flip(s) : s));
  }
  if (i === 0 && sorts.length === 1) return [flip(sorts[0]!)];
  return [{ key, dir: first }];
}
