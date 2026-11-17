<script setup lang="ts">
import type { SortKey } from '~/utils/filters';

/** Заголовок с сортировкой: стрелка и номер ключа при многоключевой сортировке. */
const props = defineProps<{ k: string; sorts: SortKey[]; hint?: string; tag?: string }>();
defineEmits<{ sort: [key: string, shift: boolean] }>();
const SORT_HINT = 'Клик — сортировать, Shift+клик — добавить ключ сортировки';
const mark = computed(() => {
  const i = props.sorts.findIndex((s) => s.key === props.k);
  if (i < 0) return { arrow: '', n: '' };
  return { arrow: props.sorts[i]!.dir === 'asc' ? '▲' : '▼', n: props.sorts.length > 1 ? String(i + 1) : '' };
});
</script>

<template>
  <component :is="tag ?? 'th'" class="sortable" :title="(hint ? hint + '. ' : '') + SORT_HINT" @click="$emit('sort', k, $event.shiftKey)">
    <slot /><span class="arr">{{ mark.arrow }}<sup>{{ mark.n }}</sup></span>
  </component>
</template>
