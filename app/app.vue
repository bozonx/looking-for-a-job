<script setup lang="ts">
type Row = Record<string, any>;

const { data, refresh } = useFetch<{ items: Row[]; errors: { file: string; error: string }[] }>('/api/vacancies');
const items = computed(() => data.value?.items ?? []);

// ---- filters (remembered per browser) ----
export interface FilterPreset {
  id: string;
  name: string;
  filters: {
    tab: string;
    status: string;
    minOverall: number;
    track: string;
    source: string;
    region: string;
    lang: string;
    since: string;
    hideClosed: boolean;
    sort: string;
    dir: 'asc' | 'desc';
  };
}

const defaults = { tab: 'inbox', status: '', minOverall: 0, track: '', source: '', region: '', lang: '', since: '', hideClosed: true, q: '', sort: 'overall', dir: 'desc' as 'asc' | 'desc' };
const f = reactive({ ...defaults });
const savedPresets = ref<FilterPreset[]>([]);
const activePresetId = ref<string | null>(null);

const activePreset = computed(() => savedPresets.value.find((p) => p.id === activePresetId.value) ?? null);

const isPresetModified = computed(() => {
  if (!activePreset.value) return false;
  const p = activePreset.value.filters;
  return (
    f.tab !== p.tab ||
    f.status !== p.status ||
    f.minOverall !== p.minOverall ||
    f.track !== p.track ||
    f.source !== p.source ||
    f.region !== p.region ||
    f.lang !== p.lang ||
    f.since !== p.since ||
    f.hideClosed !== p.hideClosed ||
    f.sort !== p.sort ||
    f.dir !== p.dir
  );
});

onMounted(() => {
  try {
    const rawPresets = localStorage.getItem('saved_presets');
    if (rawPresets) savedPresets.value = JSON.parse(rawPresets);
    const active = localStorage.getItem('active_preset_id');
    if (active && savedPresets.value.some((p) => p.id === active)) {
      activePresetId.value = active;
    }
    const rawFilters = localStorage.getItem('filters');
    if (rawFilters) Object.assign(f, JSON.parse(rawFilters));
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
  inbox: items.value.filter((v) => v.status === 'new').length,
  attention: items.value.filter((v) => v.status === 'needs_attention' || v.status === 'apply_failed').length,
  selected: items.value.filter((v) => v.status === 'selected').length,
  all: items.value.length,
}));

function matchRow(v: Row, filter: typeof defaults, q: string) {
  if (filter.tab === 'inbox' && v.status !== 'new') return false;
  if (filter.tab === 'attention' && v.status !== 'needs_attention' && v.status !== 'apply_failed') return false;
  if (filter.tab === 'selected' && v.status !== 'selected') return false;
  if (filter.tab === 'all' && filter.status && v.status !== filter.status) return false;
  if (filter.minOverall && (v.scores?.overall ?? 0) < filter.minOverall) return false;
  if (filter.track && v.best_resume !== filter.track && !(v.role_tracks ?? []).includes(filter.track)) return false;
  if (filter.source && v.source !== filter.source) return false;
  if (filter.region && v.region !== filter.region) return false;
  if (filter.lang && v.vacancy_language !== filter.lang) return false;
  if (filter.hideClosed && v.possibly_closed && filter.tab !== 'all') return false;
  if (filter.since && String(v.posted_at ?? v.collected_at) < filter.since) return false;
  if (q && !`${v.title} ${v.company} ${v.location ?? ''}`.toLowerCase().includes(q)) return false;
  return true;
}

const presetCounts = computed(() => {
  const res: Record<string, number> = {};
  for (const p of savedPresets.value) {
    res[p.id] = items.value.filter((v) => matchRow(v, { ...defaults, ...p.filters }, '')).length;
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
  for (const id of ids) await patch(id, { status: on ? 'selected' : 'new' });
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
    x: () => id && patch(id, { status: 'rejected' }),
    s: () => id && patch(id, { starred: !cur?.starred }),
    u: () => id && patch(id, { status: 'new' }),
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
  Object.assign(f, {
    tab: preset.filters.tab,
    status: preset.filters.status,
    minOverall: preset.filters.minOverall,
    track: preset.filters.track,
    source: preset.filters.source,
    region: preset.filters.region,
    lang: preset.filters.lang,
    since: preset.filters.since,
    hideClosed: preset.filters.hideClosed,
    sort: preset.filters.sort,
    dir: preset.filters.dir,
  });
}

function updateActivePreset() {
  if (!activePreset.value) return;
  activePreset.value.filters = {
    tab: f.tab,
    status: f.status,
    minOverall: f.minOverall,
    track: f.track,
    source: f.source,
    region: f.region,
    lang: f.lang,
    since: f.since,
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
  Object.assign(f, { ...defaults, tab: f.tab });
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
      track: f.track,
      source: f.source,
      region: f.region,
      lang: f.lang,
      since: f.since,
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

function getFilterTags(filters: FilterPreset['filters']): string[] {
  const tags: string[] = [];
  if (filters.tab && filters.tab !== 'all') {
    const t = tabs.find(([k]) => k === filters.tab);
    if (t) tags.push(`вкладка: ${t[1]}`);
  }
  if (filters.tab === 'all' && filters.status) {
    tags.push(`статус: ${STATUS_LABEL[filters.status] ?? filters.status}`);
  }
  if (filters.minOverall > 0) tags.push(`overall ≥ ${filters.minOverall}`);
  if (filters.track) tags.push(`профиль: ${filters.track}`);
  if (filters.source) tags.push(`источник: ${filters.source}`);
  if (filters.region) tags.push(`регион: ${filters.region}`);
  if (filters.lang) tags.push(`язык: ${filters.lang}`);
  if (filters.since) tags.push(`с ${filters.since}`);
  if (!filters.hideClosed) tags.push(`включая закрытые`);
  if (filters.sort !== 'overall' || filters.dir !== 'desc') {
    tags.push(`сортировка: ${filters.sort} ${filters.dir}`);
  }
  return tags.length ? tags : ['без ограничений'];
}

const currentFilterTags = computed(() =>
  getFilterTags({
    tab: f.tab,
    status: f.status,
    minOverall: f.minOverall,
    track: f.track,
    source: f.source,
    region: f.region,
    lang: f.lang,
    since: f.since,
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
          <option v-for="(l, s) in STATUS_LABEL" :key="s" :value="s">{{ l }}</option>
        </select>
        <label>overall ≥ <input v-model.number="f.minOverall" type="number" min="0" max="100" step="5" class="num" /></label>
        <select v-model="f.track">
          <option value="">профиль: все</option>
          <option v-for="t in TRACKS" :key="t" :value="t">{{ t }}</option>
        </select>
        <select v-model="f.source">
          <option value="">источник: все</option>
          <option v-for="s in uniq('source')" :key="s" :value="s">{{ s }}</option>
        </select>
        <select v-model="f.region">
          <option value="">регион: все</option>
          <option v-for="r in REGIONS" :key="r" :value="r">{{ r }}</option>
        </select>
        <select v-model="f.lang">
          <option value="">язык: все</option>
          <option v-for="l in uniq('vacancy_language')" :key="l" :value="l">{{ l }}</option>
        </select>
        <label>с <input v-model="f.since" type="date" /></label>
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
                  @change="patch(v.id, { status: ($event.target as HTMLInputElement).checked ? 'selected' : 'new' })"
                />
              </td>
              <td><span class="badge big" :class="tone(v.scores?.overall)">{{ v.scores?.overall ?? '…' }}</span></td>
              <td>{{ v.best_resume ?? '—' }}</td>
              <td class="col-date">
                <div class="nowrap date-line">
                  <span v-if="v.status === 'new'" class="dot-new" title="Новая"></span>
                  <span>{{ (v.posted_at ?? v.collected_at)?.slice(5) }}</span>
                </div>
                <div v-if="v.status !== 'new'" class="status-line">
                  <span class="status mini" :data-s="v.status">{{ STATUS_LABEL[v.status] ?? v.status }}</span>
                </div>
              </td>
              <td class="title">
                <div><span v-if="v.starred" class="star">★</span><s v-if="v.possibly_closed" title="Возможно, закрыта">{{ v.title }}</s><template v-else>{{ v.title }}</template></div>
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
      <footer class="muted small">j/k — навигация · a — откликнуться · x — отклонить · s — звезда · u — вернуть в new · / — поиск</footer>
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
.status[data-s='rejected'] { color: var(--muted); }
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
