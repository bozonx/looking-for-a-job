import { blankFilters, cloneFilters, normFilters, type Filters } from '~/utils/filters';

/** Вкладка — сохранённый набор фильтров + сортировка; любые изменения сразу пишутся в localStorage. */
export interface View {
  id: string;
  name: string;
  filters: Filters;
  /** Исходное состояние: к нему возвращает «сброс». */
  base: Filters;
  builtin?: boolean;
}

const BUILTIN: [string, string, Partial<Filters>][] = [
  ['all', 'Все', {}],
  ['new', 'Новые', { period: 'last' }],
  ['selected', 'Выбранные', { statuses: ['selected'] }],
  ['applied', 'Отклики', { statuses: ['applied', 'closed'] }],
  ['attention', 'Внимание', { statuses: ['needs_attention', 'apply_failed', 'closed'] }],
  ['starred', '★', { statuses: ['starred', 'closed'] }],
  ['flagged', '⚑ Проблемные', { statuses: ['flagged', 'closed'] }],
  ['closed', 'Закрытые', { statuses: ['closed'] }],
];
const builtinViews = (): View[] =>
  BUILTIN.map(([id, name, p]) => {
    const fl = { ...blankFilters(), ...p };
    return { id, name, filters: cloneFilters(fl), base: cloneFilters(fl), builtin: true };
  });

const LS_VIEWS = 'views_v2';
const LS_ACTIVE = 'active_view';

const views = ref<View[]>(builtinViews());
const activeId = ref('all');
let restored = false;

function restore() {
  if (restored) return;
  restored = true;
  try {
    const raw = localStorage.getItem(LS_VIEWS);
    if (raw) {
      const saved: any[] = JSON.parse(raw);
      const out: View[] = [];
      for (const b of builtinViews()) {
        const s = saved.find((x) => x.id === b.id);
        out.push({ ...b, name: typeof s?.name === 'string' ? s.name : b.name, filters: s ? normFilters(s.filters) : b.filters });
      }
      for (const s of saved) {
        if (typeof s?.id !== 'string' || out.some((b) => b.id === s.id)) continue;
        out.push({ id: s.id, name: String(s.name ?? 'вкладка'), filters: normFilters(s.filters), base: normFilters(s.base ?? s.filters) });
      }
      const pos = (id: string) => {
        const i = saved.findIndex((x) => x.id === id);
        return i < 0 ? Infinity : i;
      };
      views.value = out.sort((a, b) => pos(a.id) - pos(b.id)); // порядок как сохранён
    }
    const a = localStorage.getItem(LS_ACTIVE);
    if (a && views.value.some((v) => v.id === a)) activeId.value = a;
  } catch {}
  watch(
    views,
    (v) => {
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
}

export function useViews() {
  onMounted(restore);
  const view = computed(() => views.value.find((v) => v.id === activeId.value) ?? views.value[0]!);
  const filters = computed(() => view.value.filters);
  const isModified = computed(() => JSON.stringify(view.value.filters) !== JSON.stringify(view.value.base));

  function reset() {
    view.value.filters = cloneFilters(view.value.base);
  }
  /** Зафиксировать текущие фильтры как исходные (для «сброса»). */
  function commit() {
    view.value.base = cloneFilters(view.value.filters);
  }
  function add(name: string) {
    const fl = cloneFilters(view.value.filters);
    const v: View = { id: 'v_' + Date.now(), name, filters: fl, base: cloneFilters(fl) };
    views.value.push(v);
    activeId.value = v.id;
  }
  function rename(v: View, name: string) {
    v.name = name;
  }
  function remove(v: View) {
    if (v.builtin) return;
    views.value = views.value.filter((x) => x.id !== v.id);
    if (activeId.value === v.id) activeId.value = 'all';
  }
  return { views, activeId, view, filters, isModified, reset, commit, add, rename, remove };
}
