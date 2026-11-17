<script setup lang="ts">
import { nextSorts } from '~/utils/filters';

/**
 * Каркас UI: вкладки + фильтры + таблица слева, карточка справа.
 * Состояние — composables/ (useVacancies, useViews, useVacancyList, useCheckAlive), логика фильтров — utils/filters.ts.
 */
const { items, errors, lastRun, refresh, patch, patchMany, rescore, usePolling } = useVacancies();
usePolling();
const rejectedTab = ref(false);
const rejected = computed(() => items.value.filter(v => v.prefilter_reason));
const system = computed(() => {
 const all = items.value.filter(v => !v.prefilter_reason);
 return `Очередь: ${all.filter(v => !v.scores && !v.possibly_closed && v.hire_from_ar !== 'no' && !v.stop_flags?.length).length} · Отсеяно: ${rejected.value.length} · Стоп-флаги: ${all.filter(v => v.stop_flags?.length).length}/${all.length} · Без канала: ${all.filter(v => !v.apply_channels?.length).length}`;
});
const { views, activeId, filters, isModified, reset, commit, view } = useViews();
const { q, searchAll, viewCounts, rows, outsideHits, current, currentRow, move } = useVacancyList({ items: computed(() => items.value.filter(v => !v.prefilter_reason)), lastRun, views, filters, activeId });
const { state: alive, start: startAlive } = useCheckAlive(() => refresh());
const { toast, show } = useToast();

function onCommit() {
  commit();
  show(`Вкладка «${view.value.name}»: текущие фильтры стали исходными`);
}
function onSort(key: string, shift: boolean) {
  filters.value.sorts = nextSorts(filters.value.sorts, key, shift);
}
function onMark(ids: string[], status: 'selected' | null) {
  if (ids.length === 1) return patch(ids[0]!, { status });
  return patchMany(ids, status);
}

useHotkeys(() => {
  const id = current.value;
  const cur = currentRow.value;
  const manual = cur?.status === 'applied' && cur?.applied_via === 'manual';
  return {
    j: () => move(1),
    ArrowDown: () => move(1),
    k: () => move(-1),
    ArrowUp: () => move(-1),
    a: () => id && !cur?.status && patch(id, { status: 'selected' }),
    f: () => id && patch(id, { flagged: !cur?.flagged }),
    s: () => id && patch(id, { starred: !cur?.starred }),
    u: () => id && (cur?.status === 'selected' || manual) && patch(id, { status: null }),
    m: () => id && (!cur?.status || cur?.status === 'selected') && patch(id, { status: 'applied' }),
    '/': () => (document.querySelector('#q') as HTMLInputElement | null)?.focus(),
  };
});
</script>

<template>
  <div class="layout">
    <aside class="list">
      <ViewTabs :counts="viewCounts">
        <button
          class="ghost"
          :disabled="alive?.running"
          :title="alive?.running ? alive.last : 'Проверить по ссылкам, не закрыты ли вакансии (без статуса, на отклик, требующие внимания). Shift+клик — перепроверить и проверенные сегодня'"
          @click="startAlive($event.shiftKey)"
        >{{ alive?.running ? '⏳ проверяю…' : '✓ живость' }}</button>
        <button class="ghost" title="Пересчитать overall по weights.yaml" @click="rescore">⟳ rescore</button>
      </ViewTabs>

      <div class="hint small">{{ system }}</div>
      <button @click="rejectedTab = !rejectedTab">{{ rejectedTab ? 'Вакансии' : 'Отсеяно предфильтром' }}</button>
      <div v-if="rejectedTab"><p v-for="v in rejected" :key="v.id"><a :href="v.source_url" target="_blank">{{ v.title }}</a> — {{ v.prefilter_reason }}</p></div>
      <FilterBar v-model:filters="view.filters" v-model:q="q" :items="items" :modified="isModified" @reset="reset" @commit="onCommit" />

      <div v-if="searchAll" class="hint small">
        Поиск по всем вакансиям (фильтры вкладки не действуют, закрытые включены) —
        <a href="#" @click.prevent="searchAll = false">вернуться к вкладке</a>
      </div>
      <div v-else-if="outsideHits > 0" class="hint small">
        Ещё {{ outsideHits }} совпадений вне вкладки —
        <a href="#" @click.prevent="searchAll = true">искать по всем (включая закрытые)</a>
      </div>

      <div v-if="errors.length" class="errors">
        <div v-for="e in errors" :key="e.file">⚠ {{ e.file }}: {{ e.error }}</div>
      </div>

      <VacancyTable v-if="!rejectedTab" :rows="rows" :current="current" :sorts="filters.sorts" :last-run="lastRun" @select="current = $event" @sort="onSort" @mark="onMark" />
      <footer class="muted small">j/k — навигация · a — выбрать · m — откликнулся сам · u — снять выбор/ручной отклик · s — звезда · f — проблемная · / — поиск · Shift+клик по заголовку — доп. сортировка</footer>
    </aside>

    <main class="detail">
      <VacancyCard v-if="current" :id="current" :key="current" :rev="currentRow?._rev" @patch="patch" />
      <p v-else class="muted empty">Выберите вакансию</p>
    </main>
    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>
