<script setup lang="ts">
type Row = Record<string, any>;

const { data, refresh } = useFetch<{ items: Row[]; errors: { file: string; error: string }[]; lastRun: string | null }>('/api/vacancies');
const items = computed(() => data.value?.items ?? []);
/** «Новая» = собрана последним запуском `npm run collect` (data/state/last-collect.json). */
const isFresh = (v: Row) => !!v.collected_run && v.collected_run === data.value?.lastRun;

// ---- вкладки: каждая — сохранённый набор фильтров + сортировка; любые изменения сразу пишутся в localStorage ----
type SortKey = { key: string; dir: 'asc' | 'desc' };
/** Период: null — всё время, 'last' — последний сбор, число — за N дней. */
type Period = number | 'last' | null;
interface Filters {
  statuses: string[];
  minOverall: number;
  tracks: string[];
  sources: string[];
  regions: string[];
  langs: string[];
  /** тип канала отклика: ats, form, email, telegram… (utils/labels.ts channelKind) */
  channels: string[];
  period: Period;
  sorts: SortKey[];
}
interface View {
  id: string;
  name: string;
  filters: Filters;
  /** Исходное состояние: к нему возвращает «сброс». */
  base: Filters;
  builtin?: boolean;
}

const blank = (): Filters => ({
  statuses: [], minOverall: 0, tracks: [], sources: [], regions: [], langs: [], channels: [], period: null,
  sorts: [{ key: 'overall', dir: 'desc' }],
});
const clone = (x: Filters): Filters => JSON.parse(JSON.stringify(x));
const BUILTIN: View[] = (
  [
    ['all', 'Все', {}],
    ['new', 'Новые', { period: 'last' }],
    ['selected', 'Выбранные', { statuses: ['selected'] }],
    ['flagged', '⚑ Проблемные', { statuses: ['flagged'] }],
    ['closed', 'Закрытые', { statuses: ['closed'] }],
  ] as [string, string, Partial<Filters>][]
).map(([id, name, p]) => {
  const fl = { ...blank(), ...p };
  return { id, name, filters: clone(fl), base: clone(fl), builtin: true };
});

/** Статусы + псевдостатусы (пометки). */
const STATUS_OPTIONS = [
  { value: 'none', label: 'без решения' },
  ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
  { value: 'flagged', label: '⚑ проблемные' },
  { value: 'closed', label: 'закрытые' },
];

function normFilters(raw: any): Filters {
  const d = blank();
  if (!raw || typeof raw !== 'object') return d;
  const arr = (x: any) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string') : []);
  const sorts = Array.isArray(raw.sorts)
    ? raw.sorts.filter((s: any) => s && typeof s.key === 'string' && (s.dir === 'asc' || s.dir === 'desc'))
    : [];
  return {
    statuses: arr(raw.statuses),
    minOverall: typeof raw.minOverall === 'number' ? raw.minOverall : 0,
    tracks: arr(raw.tracks),
    sources: arr(raw.sources),
    regions: arr(raw.regions),
    langs: arr(raw.langs),
    channels: arr(raw.channels),
    period: raw.period === 'last' || typeof raw.period === 'number' ? raw.period : typeof raw.days === 'number' ? raw.days : null,
    sorts: sorts.length ? sorts : d.sorts,
  };
}

const views = ref<View[]>(BUILTIN.map((v) => ({ ...v, filters: clone(v.filters), base: clone(v.base) })));
const activeId = ref('all');
const view = computed(() => views.value.find((v) => v.id === activeId.value) ?? views.value[0]!);
const f = computed(() => view.value.filters);

const LS_VIEWS = 'views_v2';
const LS_ACTIVE = 'active_view';
const loaded = ref(false);
onMounted(() => {
  try {
    const raw = localStorage.getItem(LS_VIEWS);
    if (raw) {
      const saved: any[] = JSON.parse(raw);
      const out: View[] = [];
      for (const b of BUILTIN) {
        const s = saved.find((x) => x.id === b.id);
        out.push({ ...b, name: typeof s?.name === 'string' ? s.name : b.name, filters: s ? normFilters(s.filters) : clone(b.filters), base: clone(b.base) });
      }
      for (const s of saved) {
        if (BUILTIN.some((b) => b.id === s.id) || typeof s.id !== 'string') continue;
        out.push({ id: s.id, name: String(s.name ?? 'вкладка'), filters: normFilters(s.filters), base: normFilters(s.base ?? s.filters) });
      }
      // порядок как сохранён
      out.sort((a, b) => saved.findIndex((x) => x.id === a.id) - saved.findIndex((x) => x.id === b.id));
      views.value = out;
    } else {
      // миграция старых сохранённых фильтров
      const old = JSON.parse(localStorage.getItem('saved_presets') ?? '[]');
      for (const p of Array.isArray(old) ? old : []) {
        const fl = normFilters(p.filters);
        views.value.push({ id: String(p.id), name: String(p.name), filters: fl, base: clone(fl) });
      }
    }
    const a = localStorage.getItem(LS_ACTIVE);
    if (a && views.value.some((v) => v.id === a)) activeId.value = a;
  } catch {}
  loaded.value = true;
});
watch(
  views,
  (v) => {
    if (!loaded.value) return;
    try {
      localStorage.setItem(LS_VIEWS, JSON.stringify(v.map(({ id, name, filters, base }) => ({ id, name, filters, base }))));
    } catch {}
  },
  { deep: true },
);
watch(activeId, (id) => {
  try {
    localStorage.setItem(LS_ACTIVE, id);
  } catch {}
});

const isModified = computed(() => JSON.stringify(f.value) !== JSON.stringify(view.value.base));
function resetView() {
  view.value.filters = clone(view.value.base);
}
function addView() {
  const name = prompt('Название вкладки (текущие фильтры будут скопированы):')?.trim();
  if (!name) return;
  const fl = clone(f.value);
  const v: View = { id: 'v_' + Date.now(), name, filters: fl, base: clone(fl) };
  views.value.push(v);
  activeId.value = v.id;
}
function renameView(v: View) {
  const name = prompt('Новое название вкладки:', v.name)?.trim();
  if (name) v.name = name;
}
function deleteView(v: View) {
  if (v.builtin || !confirm(`Удалить вкладку «${v.name}»?`)) return;
  views.value = views.value.filter((x) => x.id !== v.id);
  if (activeId.value === v.id) activeId.value = 'all';
}
/** Зафиксировать текущие фильтры как исходные для вкладки (для «сброса»). */
function commitView() {
  view.value.base = clone(f.value);
  toast.value = `Вкладка «${view.value.name}»: текущие фильтры стали исходными`;
}

// ---- период ----
const STANDARD_DAYS = [1, 3, 7, 14, 30, 60, 90];
const customDays = ref(false);
const periodValue = computed(() => {
  const p = f.value.period;
  if (p === 'last') return 'last';
  if (p == null) return customDays.value ? 'custom' : '';
  return STANDARD_DAYS.includes(p) && !customDays.value ? String(p) : 'custom';
});
function onPeriod(val: string) {
  customDays.value = val === 'custom';
  if (val === '') f.value.period = null;
  else if (val === 'last') f.value.period = 'last';
  else if (val === 'custom') f.value.period = typeof f.value.period === 'number' ? f.value.period : 5;
  else f.value.period = Number(val);
}
watch(activeId, () => {
  const p = f.value.period;
  customDays.value = typeof p === 'number' && !STANDARD_DAYS.includes(p);
});

// ---- фильтрация ----
const uniq = (k: string) => [...new Set(items.value.map((v) => v[k]).filter(Boolean))].sort();

function cutoff(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Статусы: выбранные значения объединяются через ИЛИ.
 * Закрытые видны, только если выбрано «закрытые»; «закрытые» в одиночку — только закрытые.
 */
function matchStatus(v: Row, sel: string[]) {
  const rest = sel.filter((s) => s !== 'closed');
  const withClosed = rest.length < sel.length;
  if (v.possibly_closed && !withClosed) return false;
  if (!rest.length) return !!v.possibly_closed || !withClosed;
  return rest.includes(v.status ?? 'none') || (rest.includes('flagged') && !!v.flagged);
}

/** все типы каналов вакансии (для фильтра): основной + все из apply_channels */
function rowKinds(v: Row): string[] {
  const ks = new Set<string>([channelKind(v.apply_method)]);
  for (const c of v.apply_channels ?? []) ks.add(c.type);
  if (ks.size > 1) ks.delete('unknown');
  return [...ks];
}
const CHANNEL_OPTIONS = Object.entries(CHANNEL_LABEL).map(([value, l]) => ({ value, label: `${l.icon} ${l.label}` }));
const channelTitle = (v: Row) =>
  [`Отклик: ${CHANNEL_LABEL[channelKind(v.apply_method)]!.label} → ${v.apply_target ?? '—'}`, ...(v.apply_channels ?? []).map((c: any) => `${CHANNEL_LABEL[c.type]?.icon ?? ''} ${c.value}`)].join('\n');

function matchRow(v: Row, fl: Filters) {
  if (!matchStatus(v, fl.statuses)) return false;
  if (fl.minOverall && (v.scores?.overall ?? 0) < fl.minOverall) return false;
  if (fl.tracks.length && !fl.tracks.includes(v.best_resume) && !(v.role_tracks ?? []).some((t: string) => fl.tracks.includes(t))) return false;
  if (fl.sources.length && !fl.sources.includes(v.source)) return false;
  if (fl.regions.length && !fl.regions.includes(v.region)) return false;
  if (fl.langs.length && !fl.langs.includes(v.vacancy_language)) return false;
  if (fl.channels.length && !rowKinds(v).some((k) => fl.channels.includes(k))) return false;
  if (fl.period === 'last' && !isFresh(v)) return false;
  if (typeof fl.period === 'number' && fl.period > 0) {
    const d = v.posted_at ?? v.collected_at;
    if (!d || String(d).slice(0, 10) < cutoff(fl.period)) return false;
  }
  return true;
}

// поиск — быстрый, внутри вкладки, не сохраняется
const q = ref('');
const matchQ = (v: Row, s: string) => !s || `${v.title} ${v.company} ${v.location ?? ''}`.toLowerCase().includes(s);

const viewCounts = computed(() => Object.fromEntries(views.value.map((v) => [v.id, items.value.filter((r) => matchRow(r, v.filters)).length])));

const inView = computed(() => items.value.filter((v) => matchRow(v, f.value)));
const outsideHits = computed(() => {
  const s = q.value.trim().toLowerCase();
  if (!s) return 0;
  return items.value.filter((v) => matchQ(v, s)).length - inView.value.filter((v) => matchQ(v, s)).length;
});
function searchEverywhere() {
  activeId.value = 'all';
  const all = views.value.find((v) => v.id === 'all')!;
  all.filters = { ...blank(), statuses: ['none', ...Object.keys(STATUS_LABEL), 'closed'], sorts: all.filters.sorts };
}

// ---- сортировка: клик по заголовку; Shift+клик — дополнительный ключ ----
const SORT_GET: Record<string, (v: Row) => string | number | null> = {
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
const ASC_FIRST = new Set(['company', 'profile', 'region', 'corporate', 'outsource']);

const rows = computed(() => {
  const s = q.value.trim().toLowerCase();
  const list = inView.value.filter((v) => matchQ(v, s));
  const cmp1 = (a: Row, b: Row, { key, dir }: SortKey) => {
    const get = SORT_GET[key];
    if (!get) return 0;
    const x = get(a), y = get(b);
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1; // пустые всегда в конце
    const sign = dir === 'asc' ? 1 : -1;
    return sign * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)));
  };
  return [...list].sort((a, b) => {
    const st = Number(!!b.starred) - Number(!!a.starred);
    if (st) return st;
    for (const k of f.value.sorts) {
      const c = cmp1(a, b, k);
      if (c) return c;
    }
    return 0;
  });
});

function sortBy(key: string, e: MouseEvent) {
  const sorts = f.value.sorts;
  const i = sorts.findIndex((s) => s.key === key);
  const flip = (s: SortKey) => (s.dir = s.dir === 'asc' ? 'desc' : 'asc');
  if (e.shiftKey) {
    if (i < 0) sorts.push({ key, dir: ASC_FIRST.has(key) ? 'asc' : 'desc' });
    else if (sorts.length > 1 && sorts[i]!.dir === (ASC_FIRST.has(key) ? 'desc' : 'asc')) sorts.splice(i, 1); // третий клик — убрать ключ
    else flip(sorts[i]!);
  } else if (i === 0 && sorts.length === 1) flip(sorts[0]!);
  else f.value.sorts = [{ key, dir: ASC_FIRST.has(key) ? 'asc' : 'desc' }];
}
function sortMark(key: string) {
  const i = f.value.sorts.findIndex((s) => s.key === key);
  if (i < 0) return { arrow: '', n: '' };
  return { arrow: f.value.sorts[i]!.dir === 'asc' ? '▲' : '▼', n: f.value.sorts.length > 1 ? String(i + 1) : '' };
}
const SORT_HINT = 'Клик — сортировать, Shift+клик — добавить ключ сортировки';
const SCORE_COLS = [
  ['remote', 'R'], ['startup', 'S'], ['corporate', 'C'], ['outsource', 'O'], ['legitimacy', 'L'],
] as const;

// ---- массовая отметка для автоотклика (видимые строки, кроме уже откликнутых) ----
const markable = computed(() => rows.value.filter((v) => v.status !== 'applied'));
const allMarked = computed(() => markable.value.length > 0 && markable.value.every((v) => v.status === 'selected'));
const someMarked = computed(() => markable.value.some((v) => v.status === 'selected'));
async function markAll(on: boolean) {
  const ids = markable.value.filter((v) => (v.status === 'selected') !== on).map((v) => v.id);
  for (const id of ids) await patch(id, { status: on ? 'selected' : null });
}

// ---- текущая вакансия ----
const current = ref<string | null>(null);
watch(rows, (r) => {
  if (!r.length) current.value = null;
  else if (!current.value) current.value = r[0]!.id;
});
const card = ref<{ refresh: () => void } | null>(null);

function move(d: number) {
  const r = rows.value;
  if (!r.length) return;
  const i = r.findIndex((v) => v.id === current.value);
  current.value = r[Math.max(0, Math.min(r.length - 1, (i < 0 ? 0 : i) + d))]!.id;
  nextTick(() => document.querySelector('tr.cur')?.scrollIntoView({ block: 'nearest' }));
}

const toast = ref('');
async function patch(id: string, body: Record<string, unknown>) {
  // Если строка уходит из списка — переходим к соседней, а не в начало.
  const r = rows.value;
  const i = r.findIndex((v) => v.id === id);
  try {
    const res = await $fetch<{ data: Row }>(`/api/vacancies/${encodeURIComponent(id)}`, { method: 'PATCH', body });
    const it = items.value.find((v) => v.id === id);
    if (it) Object.assign(it, res.data);
    // опрос, стартовавший до PATCH, вернул бы старый статус; новый refresh отменяет его (dedupe: 'cancel')
    void refresh();
    if (current.value === id && !rows.value.some((v) => v.id === id)) {
      const next = r[i + 1] ?? r[i - 1];
      current.value = next && next.id !== id ? next.id : (rows.value[0]?.id ?? null);
    }
  } catch (e: any) {
    toast.value = `Ошибка сохранения: ${errText(e)}`;
  }
}

const errText = (e: any) => e?.data?.message ?? e?.data?.statusMessage ?? e?.message ?? String(e);

async function rescore() {
  try {
    const r = await $fetch<{ rescored: number; failed: { file: string; error: string }[]; weightsVersion: number }>('/api/rescore', { method: 'POST' });
    toast.value = `Пересчитано: ${r.rescored} (weights v${r.weightsVersion})` + (r.failed.length ? ` · ошибок: ${r.failed.length} — ${r.failed.map((x) => x.error).join('; ')}` : '');
    await refresh();
  } catch (e) {
    toast.value = `Ошибка пересчёта: ${errText(e)}`;
  }
}

// ---- check-alive: фоновая проверка живости (server/utils/checkAlive.ts) ----
const alive = ref<{ running: boolean; summary: string; last: string; exitCode: number | null } | null>(null);
let aliveTimer: ReturnType<typeof setInterval> | undefined;
async function pollAlive() {
  try {
    const s = await $fetch<NonNullable<typeof alive.value>>('/api/check-alive');
    const wasRunning = alive.value?.running;
    alive.value = s;
    if (s.running && !aliveTimer) aliveTimer = setInterval(pollAlive, 2000);
    if (!s.running && aliveTimer) {
      clearInterval(aliveTimer);
      aliveTimer = undefined;
    }
    if (wasRunning && !s.running) {
      const line = s.summary.split('\n').find((l) => l.includes('проверено:')) ?? s.summary;
      toast.value = s.exitCode === 0 ? `Проверка живости: ${line.replace(/^- /, '')}` : `Ошибка проверки: ${s.summary}`;
      await refresh();
    }
  } catch {}
}
async function checkAlive(e: MouseEvent) {
  try {
    alive.value = await $fetch('/api/check-alive', { method: 'POST', body: { force: e.shiftKey } });
    if (!aliveTimer) aliveTimer = setInterval(pollAlive, 2000);
  } catch (err) {
    toast.value = `Не удалось запустить проверку: ${errText(err)}`;
  }
}
onMounted(pollAlive);
onUnmounted(() => aliveTimer && clearInterval(aliveTimer));

// Обновить открытую карточку, когда её строка изменилась на диске (агент, rescore, свои правки).
watch(
  () => [current.value, JSON.stringify(items.value.find((v) => v.id === current.value) ?? null)] as const,
  ([id, n], [oldId, o]) => {
    if (id === oldId && o !== 'null' && n !== o) card.value?.refresh();
  },
);
watch(toast, (t) => t && setTimeout(() => (toast.value = ''), t.length > 80 ? 8000 : 3500));

// Живые обновления: сервер следит за файлами, клиент опрашивает дешёвый список.
let timer: ReturnType<typeof setInterval>;
onMounted(() => (timer = setInterval(() => document.visibilityState === 'visible' && refresh(), 5000)));
onUnmounted(() => clearInterval(timer));

function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  if (e.ctrlKey || e.metaKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
  const id = current.value;
  const cur = items.value.find((v) => v.id === id);
  const map: Record<string, () => void> = {
    j: () => move(1),
    ArrowDown: () => move(1),
    k: () => move(-1),
    ArrowUp: () => move(-1),
    a: () => id && patch(id, { status: 'selected' }),
    f: () => id && patch(id, { flagged: !cur?.flagged }),
    s: () => id && patch(id, { starred: !cur?.starred }),
    u: () => id && cur?.status === 'selected' && patch(id, { status: null }),
    '/': () => (document.querySelector('#q') as HTMLInputElement)?.focus(),
  };
  const fn = map[e.key];
  if (fn) {
    e.preventDefault();
    fn();
  }
}
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="layout">
    <aside class="list">
      <nav class="tabs">
        <button
          v-for="v in views"
          :key="v.id"
          class="tab"
          :class="{ on: v.id === activeId }"
          :title="v.builtin ? 'Двойной клик — переименовать' : 'Двойной клик — переименовать'"
          @click="activeId = v.id"
          @dblclick="renameView(v)"
        >
          {{ v.name }} <small>{{ viewCounts[v.id] ?? 0 }}</small>
          <span v-if="!v.builtin" class="tab-del" title="Удалить вкладку" @click.stop="deleteView(v)">×</span>
        </button>
        <button class="ghost add" title="Новая вкладка из текущих фильтров" @click="addView">+</button>
        <span class="spacer" />
        <button
          class="ghost"
          :disabled="alive?.running"
          :title="alive?.running ? alive.last : 'Проверить по ссылкам, не закрыты ли вакансии (без статуса, на отклик, требующие внимания). Shift+клик — перепроверить и проверенные сегодня'"
          @click="checkAlive"
        >{{ alive?.running ? '⏳ проверяю…' : '✓ живость' }}</button>
        <button class="ghost" title="Пересчитать overall по weights.yaml" @click="rescore">⟳ rescore</button>
      </nav>

      <div class="filters">
        <span class="search">
          <input
            id="q"
            v-model="q"
            placeholder="Поиск во вкладке  /"
            title="Быстрый поиск по названию, компании, локации внутри текущей вкладки (не сохраняется)"
            @keydown.esc="q = ''; ($event.target as HTMLInputElement).blur()"
          />
          <button v-if="q" class="ghost clear" title="Очистить" @click="q = ''">×</button>
        </span>
        <MultiSelect
          v-model="f.statuses"
          :class="{ act: f.statuses.length }"
          title="статус"
          placeholder="все открытые"
          :options="STATUS_OPTIONS"
        />
        <label :class="{ act: f.minOverall }">overall ≥ <input v-model.number="f.minOverall" type="number" min="0" max="100" step="5" class="num" /></label>
        <MultiSelect v-model="f.tracks" :class="{ act: f.tracks.length }" title="профиль" :options="TRACKS" />
        <MultiSelect v-model="f.sources" :class="{ act: f.sources.length }" title="источник" :options="uniq('source')" />
        <MultiSelect v-model="f.regions" :class="{ act: f.regions.length }" title="регион" :options="REGIONS" />
        <MultiSelect v-model="f.langs" :class="{ act: f.langs.length }" title="язык" :options="uniq('vacancy_language')" />
        <MultiSelect v-model="f.channels" :class="{ act: f.channels.length }" title="отклик" :options="CHANNEL_OPTIONS" />
        <select :class="{ act: f.period != null }" :value="periodValue" @change="onPeriod(($event.target as HTMLSelectElement).value)">
          <option value="">период: всё время</option>
          <option value="last">последний сбор</option>
          <option v-for="d in STANDARD_DAYS" :key="d" :value="String(d)">за {{ d }} дн.</option>
          <option value="custom">свой период…</option>
        </select>
        <label v-if="periodValue === 'custom'" title="Количество дней назад">
          <input v-model.number="f.period" type="number" min="1" max="365" class="num" /> дн.
        </label>
        <template v-if="isModified">
          <button class="ghost" title="Вернуть вкладку к исходным фильтрам" @click="resetView">↺ сброс</button>
          <button class="ghost" title="Сделать текущие фильтры исходными для этой вкладки" @click="commitView">✓ закрепить</button>
        </template>
      </div>

      <div v-if="outsideHits > 0" class="hint small">
        Ещё {{ outsideHits }} совпадений вне вкладки —
        <a href="#" @click.prevent="searchEverywhere">искать во «Все» (включая закрытые)</a>
      </div>

      <div v-if="data?.errors?.length" class="errors">
        <div v-for="e in data.errors" :key="e.file">⚠ {{ e.file }}: {{ e.error }}</div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="check">
                <input
                  type="checkbox"
                  title="Отметить / снять все видимые"
                  :checked="allMarked"
                  :indeterminate="someMarked && !allMarked"
                  :disabled="!markable.length"
                  @change="markAll(($event.target as HTMLInputElement).checked)"
                />
              </th>
              <th
                v-for="[k, l] in [['overall', 'overall'], ['profile', 'профиль'], ['date', 'дата'], ['company', 'Вакансия'], ['region', 'регион']]"
                :key="k"
                class="sortable"
                :title="k === 'company' ? 'Сортировка по компании. ' + SORT_HINT : SORT_HINT"
                @click="sortBy(k!, $event)"
              >{{ l }}<span class="arr">{{ sortMark(k!).arrow }}<sup>{{ sortMark(k!).n }}</sup></span></th>
              <th class="score-h">
                <span
                  v-for="[k, l] in SCORE_COLS"
                  :key="k"
                  class="sortable"
                  :title="k + '. ' + SORT_HINT"
                  @click="sortBy(k, $event)"
                >{{ l }}<span class="arr">{{ sortMark(k).arrow }}<sup>{{ sortMark(k).n }}</sup></span></span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in rows" :key="v.id" :class="{ cur: v.id === current }" @click="current = v.id">
              <td class="check" @click.stop>
                <input
                  type="checkbox"
                  :checked="v.status === 'selected' || v.status === 'applied'"
                  :disabled="v.status === 'applied'"
                  title="Отметить для автоотклика"
                  @change="patch(v.id, { status: ($event.target as HTMLInputElement).checked ? 'selected' : null })"
                />
              </td>
              <td><span class="badge big" :class="tone(v.scores?.overall)">{{ v.scores?.overall ?? '…' }}</span></td>
              <td>{{ v.best_resume ?? '—' }}</td>
              <td class="col-date">
                <div class="nowrap date-line">
                  <span v-if="isFresh(v)" class="dot-new" title="Новая — из последнего сбора"></span>
                  <span>{{ (v.posted_at ?? v.collected_at)?.slice(5) }}</span>
                </div>
                <div v-if="v.status" class="status-line">
                  <span class="status mini" :data-s="v.status">{{ STATUS_LABEL[v.status] ?? v.status }}</span>
                </div>
              </td>
              <td class="title">
                <div><span v-if="v.starred" class="star">★</span><span v-if="v.flagged" class="flag" title="Проблемная">⚑</span><s v-if="v.possibly_closed" title="Возможно, закрыта">{{ v.title }}</s><template v-else>{{ v.title }}</template></div>
                <div class="muted small">
                  <span class="badge ch-badge" :class="'ch-' + channelKind(v.apply_method)" :title="channelTitle(v)">{{ CHANNEL_LABEL[channelKind(v.apply_method)]!.icon }}<template v-if="(v.apply_channels?.length ?? 0) > 1"> +{{ v.apply_channels.length - 1 }}</template></span>
                  {{ v.company }}
                  <template v-if="v.duplicates?.length"> · <span class="badge dup-badge" :title="'Дубликатов: ' + v.duplicates.length">⧉ {{ v.duplicates.length }}</span></template>
                  <template v-if="v.stop_flags?.length"> · <span class="flag">⛔ {{ v.stop_flags.join(', ') }}</span></template>
                </div>
              </td>
              <td class="col-region">
                <div class="region-line">
                  <span>{{ v.region ?? '—' }}</span>
                  <span
                    v-if="v.vacancy_language"
                    class="badge lang-badge"
                    :title="v.work_languages?.length ? `язык: ${v.vacancy_language}, рабочие: ${v.work_languages.join(', ')}` : `язык: ${v.vacancy_language}`"
                  >{{ v.vacancy_language }}</span>
                </div>
              </td>
              <td class="badges">
                <template v-if="v.scores">
                  <span class="badge" :class="tone(v.scores.remote)" title="remote">{{ v.scores.remote }}</span>
                  <span class="badge" :class="tone(v.scores.startup)" title="startup">{{ v.scores.startup }}</span>
                  <span class="badge" :class="tone(v.scores.corporate, true)" title="corporate">{{ v.scores.corporate }}</span>
                  <span class="badge" :class="tone(v.scores.outsource, true)" title="outsource">{{ v.scores.outsource }}</span>
                  <span class="badge" :class="tone(v.scores.legitimacy)" title="legitimacy">{{ v.scores.legitimacy }}</span>
                </template>
              </td>
            </tr>
            <tr v-if="!rows.length"><td colspan="7" class="muted empty">Пусто</td></tr>
          </tbody>
        </table>
      </div>
      <footer class="muted small">j/k — навигация · a — выбрать · u — снять выбор · s — звезда · f — проблемная · / — поиск · Shift+клик по заголовку — доп. сортировка</footer>
    </aside>

    <main class="detail">
      <VacancyCard v-if="current" :id="current" :key="current" ref="card" @patch="patch" />
      <p v-else class="muted empty">Выберите вакансию</p>
    </main>
    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>


<style>
:root {
  --bg: #f7f7f5; --panel: #fff; --fg: #1d1d1b; --muted: #77756f; --line: #e3e1db; --accent: #2f5bd3;
  --good: #1f7a3d; --good-bg: #e2f3e7; --mid: #8a6500; --mid-bg: #fbf0d0; --bad: #a3271c; --bad-bg: #fae1de; --cur: #eaf0ff;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161615; --panel: #1f1f1d; --fg: #e8e6e0; --muted: #9a978f; --line: #34332f; --accent: #8aa8ff;
    --good: #7fd69a; --good-bg: #1c3a25; --mid: #f0cd6a; --mid-bg: #3d3214; --bad: #ff9a8f; --bad-bg: #45201c; --cur: #233054;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, sans-serif; }
a { color: var(--accent); }
button, input, select, textarea { font: inherit; color: inherit; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; }
button { cursor: pointer; }
button.on { background: var(--accent); color: #fff; border-color: var(--accent); }
button.ghost { border-color: transparent; background: transparent; color: var(--muted); }
.layout { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); height: 100vh; }
.list { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--line); }
.tabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 10px 12px 6px; align-items: center; }
.tabs small { opacity: .7; }
.spacer { flex: 1; }
.tab { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.tab small { opacity: .7; }
.tab-del { opacity: .45; padding: 0 2px; border-radius: 3px; line-height: 1; }
.tab-del:hover { opacity: 1; background: color-mix(in srgb, var(--fg) 15%, transparent); }
.tab:not(.on):not(:hover) .tab-del { visibility: hidden; }
.add { font-size: 16px; line-height: 1; padding: 2px 8px; }
.act { outline: 1px solid var(--accent); outline-offset: -1px; border-radius: 6px; }
label.act { outline: none; color: var(--accent) !important; }
.search { position: relative; display: inline-flex; }
.search .clear { position: absolute; right: 2px; top: 50%; transform: translateY(-50%); padding: 0 6px; }
.hint { padding: 4px 12px; color: var(--muted); border-bottom: 1px solid var(--line); }
.arr { display: inline-block; min-width: 1.3em; padding-left: 2px; font-size: 10px; }
.arr sup { font-size: 9px; }
.score-h { white-space: nowrap; }
.score-h > span { display: inline-block; width: 28px; text-align: center; position: relative; }
.score-h .arr { position: absolute; left: 100%; margin-left: -8px; min-width: 0; padding: 0; }
.filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 12px 10px; border-bottom: 1px solid var(--line); align-items: center; }
.filters label { display: flex; gap: 4px; align-items: center; color: var(--muted); }
.num { width: 64px; }
#q { width: 180px; padding-right: 22px; }
.table-wrap { overflow: auto; flex: 1; }
table { width: 100%; border-collapse: collapse; }
th { white-space: nowrap; position: sticky; top: 0; background: var(--bg); text-align: left; font-weight: 500; color: var(--muted); font-size: 12px; padding: 6px 8px; border-bottom: 1px solid var(--line); }
td { padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
tbody tr { cursor: pointer; }
tbody tr:hover { background: color-mix(in srgb, var(--cur) 50%, transparent); }
tr.cur { background: var(--cur) !important; }
.title { min-width: 220px; }
.nowrap { white-space: nowrap; }
th.sortable { cursor: pointer; user-select: none; }
th.sortable:hover { color: var(--fg); }
.check { width: 28px; text-align: center; }
.check input { cursor: pointer; padding: 0; }
.badges { white-space: nowrap; }
.badge { display: inline-block; min-width: 26px; text-align: center; padding: 0 5px; border-radius: 4px; font-size: 12px; font-variant-numeric: tabular-nums; margin-right: 2px; }
.badge.big { font-size: 14px; font-weight: 600; min-width: 36px; padding: 2px 6px; }
.good { color: var(--good); background: var(--good-bg); }
.mid { color: var(--mid); background: var(--mid-bg); }
.bad { color: var(--bad); background: var(--bad-bg); }
.muted { color: var(--muted); }
.small { font-size: 12px; }
.star { color: #e0a800; margin-right: 4px; }
.flag { color: var(--bad); }
.status { font-size: 12px; padding: 1px 6px; border-radius: 10px; border: 1px solid var(--line); white-space: nowrap; }
.status.mini { font-size: 10px; padding: 0 4px; border-radius: 4px; line-height: 1.3; }
.status[data-s='selected'], .status[data-s='applied'] { color: var(--good); border-color: currentColor; }
.flag { color: var(--bad); margin-right: 4px; }
.status[data-s='needs_attention'], .status[data-s='apply_failed'] { color: var(--bad); border-color: currentColor; }
.dot-new { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); margin-right: 4px; }
.date-line { display: flex; align-items: center; }
.status-line { margin-top: 2px; }
.col-region { white-space: nowrap; }
.region-line { display: flex; align-items: center; gap: 4px; }
.lang-badge { min-width: auto; padding: 0 4px; font-size: 11px; font-weight: 500; background: color-mix(in srgb, var(--line) 80%, transparent); color: var(--fg); border-radius: 3px; text-transform: uppercase; margin: 0; }
.ch-badge { min-width: auto; padding: 0 3px; font-size: 11px; margin: 0 2px 0 0; background: color-mix(in srgb, var(--line) 60%, transparent); border-radius: 3px; }
.ch-badge.ch-unknown { opacity: 0.6; }
.dup-badge { min-width: auto; padding: 0 4px; font-size: 11px; background: color-mix(in srgb, var(--line) 70%, transparent); color: var(--muted); border-radius: 3px; margin: 0; }
.empty { text-align: center; padding: 40px; }
.errors { padding: 6px 12px; color: var(--bad); font-size: 12px; }
footer { padding: 6px 12px; border-top: 1px solid var(--line); }
.detail { overflow: auto; background: var(--panel); }
.card { padding: 16px 20px 40px; }
.card h2 { margin: 0 0 4px; font-size: 20px; }
.card h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 0 0 6px; }
.card section { margin-top: 16px; }
.sub { color: var(--muted); }
.actions { display: flex; gap: 6px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
.attention, .stop { padding: 8px 12px; border-radius: 6px; background: var(--bad-bg); color: var(--bad); }
.pre { white-space: pre-wrap; margin: 6px 0 0; color: var(--fg); }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.card ul { margin: 0; padding-left: 18px; }
ul.red li::marker { color: var(--bad); }
.scores { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-bottom: 6px; }
.score { display: flex; gap: 4px; align-items: center; font-size: 13px; }
.score.best span:first-child { font-weight: 600; text-decoration: underline; }
.reason { color: var(--muted); white-space: pre-wrap; }
.links { list-style: none; padding: 0 !important; word-break: break-all; }
.channels { list-style: none; padding: 0 !important; word-break: break-all; }
.channels li { padding: 1px 0; }
.channels li.main { font-weight: 500; }
.channels .copy { border: 0; background: none; cursor: pointer; color: var(--muted); padding: 0 4px; font-size: 12px; }
textarea { width: 100%; resize: vertical; }
.body { margin-top: 8px; padding: 12px; border: 1px solid var(--line); border-radius: 6px; overflow-wrap: anywhere; }
.body img { max-width: 100%; }
.toast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: var(--fg); color: var(--bg); padding: 8px 14px; border-radius: 6px; }
@media (max-width: 900px) {
  .layout { grid-template-columns: minmax(0, 1fr); height: auto; }
  .list { border-right: 0; }
  .table-wrap { max-height: 60vh; }
  .two { grid-template-columns: 1fr; }
}
</style>
