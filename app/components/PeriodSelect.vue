<script setup lang="ts">
import type { Period } from '~/utils/filters';

/** Период: всё время / последний сбор / за N дней (стандартные или свой). */
const period = defineModel<Period>({ required: true });
const STANDARD_DAYS = [1, 3, 7, 14, 30, 60, 90];
const custom = ref(typeof period.value === 'number' && !STANDARD_DAYS.includes(period.value));
watch(period, (p) => (custom.value = typeof p === 'number' && !STANDARD_DAYS.includes(p)));

const selectValue = computed(() => {
  const p = period.value;
  if (p === 'last') return 'last';
  if (custom.value) return 'custom';
  return p == null ? '' : String(p);
});
function onChange(val: string) {
  custom.value = val === 'custom';
  if (val === '') period.value = null;
  else if (val === 'last') period.value = 'last';
  else if (val === 'custom') period.value = typeof period.value === 'number' ? period.value : 5;
  else period.value = Number(val);
}
</script>

<template>
  <select :class="{ act: period != null }" :value="selectValue" @change="onChange(($event.target as HTMLSelectElement).value)">
    <option value="">период: всё время</option>
    <option value="last">последний сбор</option>
    <option v-for="d in STANDARD_DAYS" :key="d" :value="String(d)">за {{ d }} дн.</option>
    <option value="custom">свой период…</option>
  </select>
  <label v-if="custom" title="Количество дней назад">
    <input v-model.number="period" type="number" min="1" max="365" class="num" /> дн.
  </label>
</template>
