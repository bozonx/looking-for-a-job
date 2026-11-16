<script setup lang="ts">
type Row = Record<string, any>;

const { data, refresh } = useFetch<{ items: Row[]; errors: { file: string; error: string }[]; lastRun: string | null }>('/api/vacancies');
const items = computed(() => data.value?.items ?? []);
/** «Новая» = собрана последним запуском `npm run collect` (data/state/last-collect.json). */
const isFresh = (v: Row) => !!v.collected_run && v.collected_run === data.value?.lastRun;

// ---- filters (remembered per browser) ----
export interface FilterPreset {
  id: string;
  name: string;
  filters: {
    tab: string;
    status: string;
    minOverall: number;
    tracks: string[];
    sources: string[];
    regions: string[];
    langs: string[];
    days: number | null;
    hideClosed: boolean;
    sort: string;
    dir: 'asc' | 'desc';
  };
}

const defaults = {
  tab: 'inbox',
  status: '',
  minOverall: 0,
  tracks: [] as string[],
  sources: [] as string[],
  regions: [] as string[],
  langs: [] as string[],
  days: null as number | null,
  hideClosed: true,
  q: '',
  sort: 'overall',
  dir: 'desc' as 'asc' | 'desc',
};
const f = reactive({ ...defaults });
const savedPresets = ref<FilterPreset[]>([]);
const activePresetId = ref<string | null>(null);

const STANDARD_DAYS = [1, 3, 7, 14, 30, 60, 90] as const;
const isCustomDays = ref(false);

const daysSelectValue = computed(() => {
  if (f.days == null || f.days <= 0) return isCustomDays.value ? 'custom' : '';
  if (STANDARD_DAYS.includes(f.days as any)) return String(f.days);
  return 'custom';
});

function onDaysSelectChange(val: string) {
  if (val === '') {
    isCustomDays.value = false;
    f.days = null;
  } else if (val === 'custom') {
    isCustomDays.value = true;
    if (f.days == null || f.days <= 0 || STANDARD_DAYS.includes(f.days as any)) {
      f.days = 5;
    }
  } else {
    isCustomDays.value = false;
    f.days = Number(val);
  }
}

function normalizeFilters(raw: any) {
  if (!raw || typeof raw !== 'object') return { ...defaults };
  const tracks = Array.isArray(raw.tracks)
    ? raw.tracks
    : typeof raw.track === 'string' && raw.track
    ? [raw.track]
    : [];
  const sources = Array.isArray(raw.sources)
    ? raw.sources
    : typeof raw.source === 'string' && raw.source
    ? [raw.source]
    : [];
  const regions = Array.isArray(raw.regions)
    ? raw.regions
    : typeof raw.region === 'string' && raw.region
    ? [raw.region]
    : [];
  const langs = Array.isArray(raw.langs)
    ? raw.langs
    : typeof raw.lang === 'string' && raw.lang
    ? [raw.lang]
    : [];

  let days = typeof raw.days === 'number' ? raw.days : null;
  if (days == null && typeof raw.since === 'string' && raw.since) {
    const sinceDate = new Date(raw.since);
    if (!isNaN(sinceDate.getTime())) {
      const diffMs = Date.now() - sinceDate.getTime();
      days = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
    }
  }

  return {
    tab: typeof raw.tab === 'string' ? raw.tab : defaults.tab,
    status: typeof raw.status === 'string' ? raw.status : defaults.status,
    minOverall: typeof raw.minOverall === 'number' ? raw.minOverall : defaults.minOverall,
    tracks,
    sources,
    regions,
    langs,
    days,
    hideClosed: typeof raw.hideClosed === 'boolean' ? raw.hideClosed : defaults.hideClosed,
    sort: typeof raw.sort === 'string' ? raw.sort : defaults.sort,
    dir: (raw.dir === 'asc' || raw.dir === 'desc' ? raw.dir : defaults.dir) as 'asc' | 'desc',
    q: typeof raw.q === 'string' ? raw.q : defaults.q,
  };
}

const activePreset = computed(() => savedPresets.value.find((p) => p.id === activePresetId.value) ?? null);

const isPresetModified = computed(() => {
  if (!activePreset.value) return false;
  const p = normalizeFilters(activePreset.value.filters);
  const arrEqual = (a: string[] = [], b: string[] = []) =>
    a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
  return (
    f.tab !== p.tab ||
    f.status !== p.status ||
    f.minOverall !== p.minOverall ||
    !arrEqual(f.tracks, p.tracks) ||
    !arrEqual(f.sources, p.sources) ||
    !arrEqual(f.regions, p.regions) ||
    !arrEqual(f.langs, p.langs) ||
    f.days !== p.days ||
    f.hideClosed !== p.hideClosed ||
    f.sort !== p.sort ||
    f.dir !== p.dir
  );
});

onMounted(() => {
  try {
    const rawPresets = localStorage.getItem('saved_presets');
    if (rawPresets) {
      const parsed = JSON.parse(rawPresets);
      savedPresets.value = parsed.map((p: any) => ({
        ...p,
        filters: normalizeFilters(p.filters),
      }));
    }
    const active = localStorage.getItem('active_preset_id');
    if (active && savedPresets.value.some((p) => p.id === active)) {
      activePresetId.value = active;
    }
    const rawFilters = localStorage.getItem('filters');
    if (rawFilters) {
      const norm = normalizeFilters(JSON.parse(rawFilters));
      Object.assign(f, norm);
      if (norm.days && !STANDARD_DAYS.includes(norm.days as any)) {
        isCustomDays.value = true;
      }
    }
  } catch {}
});

function persistPresets() {
  try {
    localStorage.setItem('saved_presets', JSON.stringify(savedPresets.value));
  } catch {}
}

watch(f, () => {
  try {
    localStorage.setItem('filters', JSON.stringify(f));
  } catch {}
});

watch(activePresetId, (val) => {
  try {
    if (val) localStorage.setItem('active_preset_id', val);
    else localStorage.removeItem('active_preset_id');
  } catch {}
});

const uniq = (k: string) => [...new Set(items.value.map((v) => v[k]).filter(Boolean))].sort();
const counts = computed(() => ({
  inbox: items.value.filter(isFresh).length,
  flagged: items.value.filter((v) => v.flagged).length,
  closed: items.value.filter((v) => v.possibly_closed).length,
  attention: items.value.filter((v) => v.status === 'needs_attention' || v.status === 'apply_failed').length,
  selected: items.value.filter((v) => v.status === 'selected').length,
  all: items.value.length,
}));

function getCutoffDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function matchRow(v: Row, filter: typeof defaults, q: string) {
  if (filter.tab === 'inbox' && !isFresh(v)) return false;
  if (filter.tab === 'flagged' && !v.flagged) return false;
  if (filter.tab === 'closed' && !v.possibly_closed) return false;
  if (filter.tab === 'attention' && v.status !== 'needs_attention' && v.status !== 'apply_failed') return false;
  if (filter.tab === 'selected' && v.status !== 'selected') return false;
  if (filter.tab === 'all' && filter.status && (v.status ?? 'none') !== filter.status) return false;
  if (filter.minOverall && (v.scores?.overall ?? 0) < filter.minOverall) return false;
  if (filter.tracks?.length) {
    const hasTrack = filter.tracks.includes(v.best_resume) ||
      (v.role_tracks ?? []).some((t: string) => filter.tracks.includes(t));
    if (!hasTrack) return false;
  }
  if (filter.sources?.length && !filter.sources.includes(v.source)) return false;
  if (filter.regions?.length && !filter.regions.includes(v.region)) return false;
  if (filter.langs?.length && !filter.langs.includes(v.vacancy_language)) return false;
  if (filter.hideClosed && v.possibly_closed && filter.tab !== 'all' && filter.tab !== 'closed') return false;
  if (filter.days != null && filter.days > 0) {
    const vDate = v.posted_at ?? v.collected_at;
    if (!vDate) return false;
    const cutoff = getCutoffDate(filter.days);
    if (String(vDate).slice(0, 10) < cutoff) return false;
  }
  if (q && !`${v.title} ${v.company} ${v.location ?? ''}`.toLowerCase().includes(q)) return false;
  return true;
}

const presetCounts = computed(() => {
  const res: Record<string, number> = {};
  for (const p of savedPresets.value) {
    res[p.id] = items.value.filter((v) => matchRow(v, { ...defaults, ...normalizeFilters(p.filters) }, '')).length;
  }
  return res;
});

const rows = computed(() => {
  const q = f.q.trim().toLowerCase();
  const list = items.value.filter((v) => matchRow(v, f, q));
  // Ascending comparators; direction is applied on top. Empty values always go last.
  const key: Record<string, (v: Row) => string | number | null> = {
    overall: (v) => v.scores?.overall ?? null,
    date: (v) => v.posted_at ?? v.collected_at ?? null,
    company: (v) => v.company ?? null,
    profile: (v) => v.best_resume ?? null,
    region: (v) => v.region ?? null,
  };
  const get = key[f.sort] ?? key.overall!;
  const sign = f.dir === 'asc' ? 1 : -1;
  const cmp = (a: Row, b: Row) => {
    const x = get(a), y = get(b);
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
    return sign * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)));
  };
  return [...list].sort((a, b) => Number(!!b.starred) - Number(!!a.starred) || cmp(a, b));
});

// ---- column sort ----
const DEFAULT_DIR: Record<string, 'asc' | 'desc'> = { overall: 'desc', date: 'desc' };
function sortBy(k: string) {
  if (f.sort === k) f.dir = f.dir === 'asc' ? 'desc' : 'asc';
  else Object.assign(f, { sort: k, dir: DEFAULT_DIR[k] ?? 'asc' });
}
const arrow = (k: string) => (f.sort === k ? (f.dir === 'asc' ? ' ▲' : ' ▼') : '');

// ---- bulk mark for auto-apply (visible rows, except already applied) ----
const markable = computed(() => rows.value.filter((v) => v.status !== 'applied'));
const allMarked = computed(() => markable.value.length > 0 && markable.value.every((v) => v.status === 'selected'));
const someMarked = computed(() => markable.value.some((v) => v.status === 'selected'));
async function markAll(on: boolean) {
  const ids = markable.value.filter((v) => (v.status === 'selected') !== on).map((v) => v.id);
  for (const id of ids) await patch(id, { status: on ? 'selected' : null });
}

// ---- selection ----
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
  // When a row leaves the current list, move to its neighbour instead of jumping to the top.
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
    toast.value = `Пересчитано: ${r.rescored} (weights v${r.weightsVersion})` + (r.failed.length ? ` · ошибок: ${r.failed.length} — ${r.failed.map((f) => f.error).join('; ')}` : '');
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

// Refresh the open card whenever its row changes on disk (agent edits, rescore, own patches).
watch(
  () => [current.value, JSON.stringify(items.value.find((v) => v.id === current.value) ?? null)] as const,
  ([id, n], [oldId, o]) => {
    if (id === oldId && o !== 'null' && n !== o) card.value?.refresh();
  },
);
watch(toast, (t) => t && setTimeout(() => (toast.value = ''), t.length > 80 ? 8000 : 3500));

// Live updates: the server watches files; poll the cheap list endpoint.
let timer: ReturnType<typeof setInterval>;
onMounted(() => (timer = setInterval(() => document.visibilityState === 'visible' && refresh(), 5000)));
onUnmounted(() => clearInterval(timer));

function onKey(e: KeyboardEvent) {
  if (showSaveDialog.value || presetToDelete.value) {
    if (e.key === 'Escape') {
      showSaveDialog.value = false;
      presetToDelete.value = null;
    }
    return;
  }
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

const tabs = [
  ['inbox', 'Новые'],
  ['flagged', 'Проблемные'],
  ['closed', 'Закрытые'],
  ['attention', 'Требуют внимания'],
  ['selected', 'Выбранные'],
  ['all', 'Все'],
] as const;

function selectSystemTab(tabKey: string) {
  activePresetId.value = null;
  f.tab = tabKey;
}

function selectPreset(preset: FilterPreset) {
  activePresetId.value = preset.id;
  const p = normalizeFilters(preset.filters);
  Object.assign(f, {
    tab: p.tab,
    status: p.status,
    minOverall: p.minOverall,
    tracks: [...p.tracks],
    sources: [...p.sources],
    regions: [...p.regions],
    langs: [...p.langs],
    days: p.days,
    hideClosed: p.hideClosed,
    sort: p.sort,
    dir: p.dir,
  });
  if (p.days && !STANDARD_DAYS.includes(p.days as any)) {
    isCustomDays.value = true;
  } else {
    isCustomDays.value = false;
  }
}

function updateActivePreset() {
  if (!activePreset.value) return;
  activePreset.value.filters = {
    tab: f.tab,
    status: f.status,
    minOverall: f.minOverall,
    tracks: [...f.tracks],
    sources: [...f.sources],
    regions: [...f.regions],
    langs: [...f.langs],
    days: f.days,
    hideClosed: f.hideClosed,
    sort: f.sort,
    dir: f.dir,
  };
  persistPresets();
  toast.value = `Фильтр «${activePreset.value.name}» обновлён`;
}

function revertActivePreset() {
  if (!activePreset.value) return;
  selectPreset(activePreset.value);
}

function resetFilters() {
  if (activePresetId.value) {
    activePresetId.value = null;
  }
  isCustomDays.value = false;
  Object.assign(f, {
    ...defaults,
    tracks: [],
    sources: [],
    regions: [],
    langs: [],
    tab: f.tab,
  });
}

// ---- Modal: Save Filter ----
const showSaveDialog = ref(false);
const newPresetName = ref('');

function openSaveDialog() {
  newPresetName.value = '';
  showSaveDialog.value = true;
  nextTick(() => {
    (document.getElementById('preset-name-input') as HTMLInputElement)?.focus();
  });
}

function savePreset() {
  const name = newPresetName.value.trim();
  if (!name) return;
  const newPreset: FilterPreset = {
    id: 'preset_' + Date.now(),
    name,
    filters: {
      tab: f.tab,
      status: f.status,
      minOverall: f.minOverall,
      tracks: [...f.tracks],
      sources: [...f.sources],
      regions: [...f.regions],
      langs: [...f.langs],
      days: f.days,
      hideClosed: f.hideClosed,
      sort: f.sort,
      dir: f.dir,
    },
  };
  savedPresets.value.push(newPreset);
  persistPresets();
  activePresetId.value = newPreset.id;
  showSaveDialog.value = false;
  toast.value = `Фильтр «${newPreset.name}» сохранён`;
}

// ---- Modal: Delete Filter ----
const presetToDelete = ref<FilterPreset | null>(null);

function confirmDeletePreset(preset: FilterPreset) {
  presetToDelete.value = preset;
}

function executeDeletePreset() {
  if (!presetToDelete.value) return;
  const target = presetToDelete.value;
  savedPresets.value = savedPresets.value.filter((p) => p.id !== target.id);
  persistPresets();
  if (activePresetId.value === target.id) {
    activePresetId.value = null;
    f.tab = 'inbox';
  }
  presetToDelete.value = null;
  toast.value = `Фильтр «${target.name}» удалён`;
}

function pluralDays(n: number): string {
  const abs = Math.abs(n) % 100;
  const rem = abs % 10;
  if (abs > 10 && abs < 20) return 'дней';
  if (rem > 1 && rem < 5) return 'дня';
  if (rem === 1) return 'день';
  return 'дней';
}

function getFilterTags(filters: FilterPreset['filters']): string[] {
  const norm = normalizeFilters(filters);
  const tags: string[] = [];
  if (norm.tab && norm.tab !== 'all') {
    const t = tabs.find(([k]) => k === norm.tab);
    if (t) tags.push(`вкладка: ${t[1]}`);
  }
  if (norm.tab === 'all' && norm.status) {
    tags.push(`статус: ${STATUS_LABEL[norm.status] ?? norm.status}`);
  }
  if (norm.minOverall > 0) tags.push(`overall ≥ ${norm.minOverall}`);
  if (norm.tracks.length) tags.push(`профиль: ${norm.tracks.join(', ')}`);
  if (norm.sources.length) tags.push(`источник: ${norm.sources.join(', ')}`);
  if (norm.regions.length) tags.push(`регион: ${norm.regions.join(', ')}`);
  if (norm.langs.length) tags.push(`язык: ${norm.langs.join(', ')}`);
  if (norm.days != null && norm.days > 0) {
    tags.push(`за ${norm.days} ${pluralDays(norm.days)}`);
  }
  if (!norm.hideClosed) tags.push(`включая закрытые`);
  if (norm.sort !== 'overall' || norm.dir !== 'desc') {
    tags.push(`сортировка: ${norm.sort} ${norm.dir}`);
  }
  return tags.length ? tags : ['без ограничений'];
}

const currentFilterTags = computed(() =>
  getFilterTags({
    tab: f.tab,
    status: f.status,
    minOverall: f.minOverall,
    tracks: [...f.tracks],
    sources: [...f.sources],
    regions: [...f.regions],
    langs: [...f.langs],
    days: f.days,
    hideClosed: f.hideClosed,
    sort: f.sort,
    dir: f.dir,
  }),
);
</script>

<template>
  <div class="layout">
    <aside class="list">
      <nav class="tabs">
        <div class="tabs-group">
          <button
            v-for="[k, l] in tabs"
            :key="k"
            :class="{ on: !activePresetId && f.tab === k }"
            @click="selectSystemTab(k)"
          >
            {{ l }} <small>{{ counts[k] }}</small>
          </button>
        </div>

        <div v-if="savedPresets.length" class="tabs-divider" />

        <div v-if="savedPresets.length" class="tabs-group presets-group">
          <div
            v-for="p in savedPresets"
            :key="p.id"
            class="preset-tab"
            :class="{ on: activePresetId === p.id }"
            :title="getFilterTags(p.filters).join(' · ')"
            @click="selectPreset(p)"
          >
            <span class="preset-name">
              <span v-if="activePresetId === p.id && isPresetModified" class="mod-dot" title="Фильтр изменён">●</span>
              {{ p.name }}
            </span>
            <small>{{ presetCounts[p.id] ?? 0 }}</small>
            <button
              type="button"
              class="preset-del"
              title="Удалить сохранённый фильтр"
              @click.stop="confirmDeletePreset(p)"
            >×</button>
          </div>
        </div>

        <button class="ghost save-btn" title="Сохранить текущие фильтры как вкладку" @click="openSaveDialog">
          + Сохранить фильтр
        </button>

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
        <input
          id="q"
          v-model="f.q"
          :placeholder="activePreset ? `Поиск в «${activePreset.name}»... /` : 'Поиск  /'"
          @keydown.esc="($event.target as HTMLInputElement).blur()"
        />
        <select v-if="f.tab === 'all'" v-model="f.status">
          <option value="">статус: все</option>
          <option value="none">без решения</option>
          <option v-for="(l, s) in STATUS_LABEL" :key="s" :value="s">{{ l }}</option>
        </select>
        <label>overall ≥ <input v-model.number="f.minOverall" type="number" min="0" max="100" step="5" class="num" /></label>
        <MultiSelect
          v-model="f.tracks"
          title="профиль"
          :options="TRACKS"
        />
        <MultiSelect
          v-model="f.sources"
          title="источник"
          :options="uniq('source')"
        />
        <MultiSelect
          v-model="f.regions"
          title="регион"
          :options="REGIONS"
        />
        <MultiSelect
          v-model="f.langs"
          title="язык"
          :options="uniq('vacancy_language')"
        />
        <select :value="daysSelectValue" @change="onDaysSelectChange(($event.target as HTMLSelectElement).value)">
          <option value="">период: все</option>
          <option value="1">за 1 день</option>
          <option value="3">за 3 дня</option>
          <option value="7">за 7 дней</option>
          <option value="14">за 14 дней</option>
          <option value="30">за 30 дней</option>
          <option value="60">за 60 дней</option>
          <option value="90">за 90 дней</option>
          <option value="custom">свой период...</option>
        </select>
        <label v-if="isCustomDays" title="Количество дней назад">
          <input
            v-model.number="f.days"
            type="number"
            min="1"
            max="365"
            class="num"
            placeholder="дней"
          /> дн.
        </label>
        <label title="Скрыть вакансии с пометкой «возможно, закрыта» (на вкладке «все» видны всегда)"><input v-model="f.hideClosed" type="checkbox" /> скрыть закрытые</label>
        <select :value="f.sort" @change="sortBy(($event.target as HTMLSelectElement).value)">
          <option value="overall">overall</option>
          <option value="profile">профиль</option>
          <option value="date">дата</option>
          <option value="region">регион</option>
          <option value="company">компания</option>
        </select>
        <button class="ghost" :title="f.dir === 'asc' ? 'по возрастанию' : 'по убыванию'" @click="f.dir = f.dir === 'asc' ? 'desc' : 'asc'">{{ f.dir === 'asc' ? '▲' : '▼' }}</button>
        
        <template v-if="activePreset && isPresetModified">
          <span class="filter-mod-badge" title="Параметры отличаются от сохранённого пресета">изменён</span>
          <button class="ghost" title="Перезаписать фильтр текущими параметрами" @click="updateActivePreset">💾 обновить</button>
          <button class="ghost" title="Сбросить к сохранённым в фильтре значениям" @click="revertActivePreset">↺ откат</button>
        </template>
        <button class="ghost" @click="resetFilters">сброс</button>
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
              <th class="sortable" @click="sortBy('overall')">overall{{ arrow('overall') }}</th>
              <th class="sortable" @click="sortBy('profile')">профиль{{ arrow('profile') }}</th>
              <th class="sortable" @click="sortBy('date')">дата{{ arrow('date') }}</th>
              <th>Вакансия</th>
              <th class="sortable" @click="sortBy('region')">регион{{ arrow('region') }}</th>
              <th>бейджи</th>
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
                  <span class="badge" :class="tone(v.scores.remote)" title="remote">R{{ v.scores.remote }}</span>
                  <span class="badge" :class="tone(v.scores.startup)" title="startup">S{{ v.scores.startup }}</span>
                  <span class="badge" :class="tone(v.scores.corporate, true)" title="corporate">C{{ v.scores.corporate }}</span>
                  <span class="badge" :class="tone(v.scores.outsource, true)" title="outsource">O{{ v.scores.outsource }}</span>
                  <span class="badge" :class="tone(v.scores.legitimacy)" title="legitimacy">L{{ v.scores.legitimacy }}</span>
                </template>
              </td>
            </tr>
            <tr v-if="!rows.length"><td colspan="7" class="muted empty">Пусто</td></tr>
          </tbody>
        </table>
      </div>
      <footer class="muted small">j/k — навигация · a — откликнуться · u — снять отклик · s — звезда · f — проблемная · / — поиск</footer>
    </aside>

    <main class="detail">
      <VacancyCard v-if="current" :id="current" :key="current" ref="card" @patch="patch" />
      <p v-else class="muted empty">Выберите вакансию</p>
    </main>
    <div v-if="toast" class="toast">{{ toast }}</div>

    <!-- Модалка: сохранение фильтра -->
    <div v-if="showSaveDialog" class="modal-backdrop" @click.self="showSaveDialog = false">
      <div class="modal">
        <h3>Сохранить фильтр</h3>
        <form @submit.prevent="savePreset">
          <div class="modal-field">
            <label for="preset-name-input">Название фильтра:</label>
            <input
              id="preset-name-input"
              v-model="newPresetName"
              placeholder="Например: Go Remote 80+"
              required
            />
          </div>
          <div class="modal-summary">
            <div class="small muted">Сохраняемые параметры:</div>
            <div class="tags">
              <span v-for="tag in currentFilterTags" :key="tag" class="tag">{{ tag }}</span>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="ghost" @click="showSaveDialog = false">Отмена</button>
            <button type="submit" class="on" :disabled="!newPresetName.trim()">Сохранить</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Модалка: подтверждение удаления фильтра -->
    <div v-if="presetToDelete" class="modal-backdrop" @click.self="presetToDelete = null">
      <div class="modal">
        <h3>Удалить сохранённый фильтр?</h3>
        <p class="modal-text">
          Вы уверены, что хотите удалить фильтр <strong>«{{ presetToDelete.name }}»</strong>?
        </p>
        <div class="modal-summary">
          <div class="tags">
            <span v-for="tag in getFilterTags(presetToDelete.filters)" :key="tag" class="tag">{{ tag }}</span>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="ghost" @click="presetToDelete = null">Отмена</button>
          <button type="button" class="btn-danger" @click="executeDeletePreset">Удалить</button>
        </div>
      </div>
    </div>
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
.tabs-divider { width: 1px; height: 18px; background: var(--line); margin: 0 4px; }
.tabs-group { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.preset-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--panel);
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}
.preset-tab:hover { border-color: var(--muted); }
.preset-tab.on { background: var(--accent); color: #fff; border-color: var(--accent); }
.preset-tab.on small { opacity: .8; color: #fff; }
.preset-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  opacity: .5;
  border-radius: 3px;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  margin-left: 2px;
}
.preset-del:hover { opacity: 1; background: color-mix(in srgb, var(--fg) 15%, transparent); }
.preset-tab.on .preset-del:hover { background: rgba(255, 255, 255, .3); }
.mod-dot { color: #e0a800; margin-right: 2px; }
.preset-tab.on .mod-dot { color: #ffe600; }
.filter-mod-badge {
  font-size: 11px;
  background: var(--mid-bg);
  color: var(--mid);
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
}
.save-btn { font-size: 12px; }
.btn-danger { background: var(--bad); color: #fff; border-color: var(--bad); }
.btn-danger:hover { opacity: .9; }
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, .45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
  backdrop-filter: blur(2px);
}
.modal {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 20px;
  width: 100%;
  max-width: 440px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, .2);
}
.modal h3 { margin: 0 0 12px; font-size: 16px; }
.modal-text { margin: 0 0 12px; }
.modal-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.modal-field input { width: 100%; }
.modal-summary { margin: 12px 0 16px; }
.tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.tag {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--line) 70%, transparent);
  color: var(--fg);
}
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
.filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 12px 10px; border-bottom: 1px solid var(--line); align-items: center; }
.filters label { display: flex; gap: 4px; align-items: center; color: var(--muted); }
.num { width: 64px; }
#q { width: 160px; }
.table-wrap { overflow: auto; flex: 1; }
table { width: 100%; border-collapse: collapse; }
th { position: sticky; top: 0; background: var(--bg); text-align: left; font-weight: 500; color: var(--muted); font-size: 12px; padding: 6px 8px; border-bottom: 1px solid var(--line); }
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
