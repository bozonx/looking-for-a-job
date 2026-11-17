<script setup lang="ts">
import type { TriState } from '~/utils/filters';

/** Фильтр «да / нет / неважно». */
defineProps<{ title: string; yes: string; no: string }>();
const model = defineModel<TriState>({ required: true });
</script>

<template>
  <select v-model="model" :class="{ act: model !== 'any' }">
    <option value="any">{{ title }}: все</option>
    <option value="yes">{{ yes }}</option>
    <option value="no">{{ no }}</option>
  </select>
</template>
