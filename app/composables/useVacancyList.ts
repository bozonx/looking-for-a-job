import { matchQuery, matchRow, sortRows, type Filters, type Row } from '~/utils/filters';
import type { View } from './useViews';

/**
 * Видимый список: фильтры вкладки + быстрый поиск + сортировка, текущая строка и навигация.
 * Поиск не сохраняется. «Искать везде» временно игнорирует фильтры вкладки (саму вкладку не меняет).
 */
export function useVacancyList(opts: { items: Ref<Row[]>; lastRun: Readonly<Ref<string | null>>; views: Ref<View[]>; filters: ComputedRef<Filters>; activeId: Ref<string> }) {
  const { items, lastRun, views, filters, activeId } = opts;
  const ctx = () => ({ lastRun: lastRun.value });

  const q = ref('');
  const searchAll = ref(false);
  watch(activeId, () => (searchAll.value = false));
  watch(q, (s) => !s.trim() && (searchAll.value = false));

  const viewCounts = computed(() => {
    const c = ctx();
    return Object.fromEntries(views.value.map((v) => [v.id, items.value.filter((r) => matchRow(r, v.filters, c)).length]));
  });
  const inView = computed(() => (searchAll.value ? items.value : items.value.filter((v) => matchRow(v, filters.value, ctx()))));
  const outsideHits = computed(() => {
    if (searchAll.value || !q.value.trim()) return 0;
    return items.value.filter((v) => matchQuery(v, q.value)).length - inView.value.filter((v) => matchQuery(v, q.value)).length;
  });
  const rows = computed(() => sortRows(inView.value.filter((v) => matchQuery(v, q.value)), filters.value.sorts));

  // ---- текущая вакансия; если строка ушла из списка — соседняя, а не первая ----
  const current = ref<string | null>(null);
  let lastIndex = 0;
  watch(rows, (r, old) => {
    if (!r.length) return void (current.value = null);
    if (current.value && r.some((v) => v.id === current.value)) return;
    const i = current.value && old ? old.findIndex((v) => v.id === current.value) : -1;
    current.value = r[Math.min(i >= 0 ? i : lastIndex, r.length - 1)]!.id;
  });
  watch(current, (id) => {
    const i = rows.value.findIndex((v) => v.id === id);
    if (i >= 0) lastIndex = i;
  });
  const currentRow = computed(() => items.value.find((v) => v.id === current.value) ?? null);

  function move(d: number) {
    const r = rows.value;
    if (!r.length) return;
    const i = r.findIndex((v) => v.id === current.value);
    current.value = r[Math.max(0, Math.min(r.length - 1, (i < 0 ? 0 : i) + d))]!.id;
    nextTick(() => document.querySelector('tr.cur')?.scrollIntoView({ block: 'nearest' }));
  }

  return { q, searchAll, viewCounts, rows, outsideHits, current, currentRow, move };
}
