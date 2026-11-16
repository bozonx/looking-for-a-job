<script setup lang="ts">
type Row = Record<string, any>;

const { data, refresh } = useFetch<{ items: Row[]; errors: { file: string; error: string }[] }>('/api/vacancies');
const items = computed(() => data.value?.items ?? []);

// ---- filters (remembered per browser) ----
const defaults = { tab: 'inbox', status: '', minOverall: 0, track: '', source: '', region: '', lang: '', since: '', hideClosed: true, q: '', sort: 'overall', dir: 'desc' as 'asc' | 'desc' };
const f = reactive({ ...defaults });
onMounted(() => {
  try {
    Object.assign(f, JSON.parse(localStorage.getItem('filters') || '{}'));
  } catch {}
});
watch(f, () => {
  try {
    localStorage.setItem('filters', JSON.stringify(f));
  } catch {}
});

const uniq = (k: string) => [...new Set(items.value.map((v) => v[k]).filter(Boolean))].sort();
const counts = computed(() => ({
  inbox: items.value.filter((v) => v.status === 'new').length,
  attention: items.value.filter((v) => v.status === 'needs_attention' || v.status === 'apply_failed').length,
  selected: items.value.filter((v) => v.status === 'selected').length,
  all: items.value.length,
}));

const rows = computed(() => {
  const q = f.q.trim().toLowerCase();
  const list = items.value.filter((v) => {
    if (f.tab === 'inbox' && v.status !== 'new') return false;
    if (f.tab === 'attention' && v.status !== 'needs_attention' && v.status !== 'apply_failed') return false;
    if (f.tab === 'selected' && v.status !== 'selected') return false;
    if (f.tab === 'all' && f.status && v.status !== f.status) return false;
    if (f.minOverall && (v.scores?.overall ?? 0) < f.minOverall) return false;
    if (f.track && v.best_resume !== f.track && !(v.role_tracks ?? []).includes(f.track)) return false;
    if (f.source && v.source !== f.source) return false;
    if (f.region && v.region !== f.region) return false;
    if (f.lang && v.vacancy_language !== f.lang) return false;
    if (f.hideClosed && v.possibly_closed && f.tab !== 'all') return false;
    if (f.since && String(v.posted_at ?? v.collected_at) < f.since) return false;
    if (q && !`${v.title} ${v.company} ${v.location ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
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
</script>

<template>
  <div class="layout">
    <aside class="list">
      <nav class="tabs">
        <button v-for="[k, l] in tabs" :key="k" :class="{ on: f.tab === k }" @click="f.tab = k">
          {{ l }} <small>{{ counts[k] }}</small>
        </button>
        <span class="spacer" />
        <button class="ghost" title="Пересчитать overall по weights.yaml" @click="rescore">⟳ rescore</button>
      </nav>

      <div class="filters">
        <input id="q" v-model="f.q" placeholder="Поиск  /" @keydown.esc="($event.target as HTMLInputElement).blur()" />
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
        <button class="ghost" @click="Object.assign(f, { ...defaults, tab: f.tab })">сброс</button>
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
              <th class="sortable" @click="sortBy('region')">регион{{ arrow('region') }}</th><th>бейджи</th><th>яз.</th><th>статус</th><th>дубли</th>
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
              <td class="nowrap">{{ (v.posted_at ?? v.collected_at)?.slice(5) }}</td>
              <td class="title">
                <div><span v-if="v.starred" class="star">★</span><s v-if="v.possibly_closed" title="Возможно, закрыта">{{ v.title }}</s><template v-else>{{ v.title }}</template></div>
                <div class="muted small">{{ v.company }}<template v-if="v.stop_flags?.length"> · <span class="flag">⛔ {{ v.stop_flags.join(', ') }}</span></template></div>
              </td>
              <td>{{ v.region ?? '—' }}</td>
              <td class="badges">
                <template v-if="v.scores">
                  <span class="badge" :class="tone(v.scores.remote)" title="remote">R{{ v.scores.remote }}</span>
                  <span class="badge" :class="tone(v.scores.startup)" title="startup">S{{ v.scores.startup }}</span>
                  <span class="badge" :class="tone(v.scores.corporate, true)" title="corporate">C{{ v.scores.corporate }}</span>
                  <span class="badge" :class="tone(v.scores.outsource, true)" title="outsource">O{{ v.scores.outsource }}</span>
                  <span class="badge" :class="tone(v.scores.legitimacy)" title="legitimacy">L{{ v.scores.legitimacy }}</span>
                </template>
              </td>
              <td>{{ v.vacancy_language ?? '' }}<template v-if="v.work_languages?.length">/{{ v.work_languages.join(',') }}</template></td>
              <td><span class="status" :data-s="v.status">{{ STATUS_LABEL[v.status] ?? v.status }}</span></td>
              <td>{{ v.duplicates?.length || '' }}</td>
            </tr>
            <tr v-if="!rows.length"><td colspan="10" class="muted empty">Пусто</td></tr>
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
.tabs { display: flex; gap: 4px; padding: 10px 12px 6px; align-items: center; }
.tabs small { opacity: .7; }
.spacer { flex: 1; }
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
.status[data-s='selected'], .status[data-s='applied'] { color: var(--good); border-color: currentColor; }
.status[data-s='rejected'] { color: var(--muted); }
.status[data-s='needs_attention'], .status[data-s='apply_failed'] { color: var(--bad); border-color: currentColor; }
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
