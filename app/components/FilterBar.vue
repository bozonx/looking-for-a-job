<script setup lang="ts">
import type { Filters, Row } from '~/utils/filters';

/** Панель фильтров вкладки + быстрый поиск. Фильтры меняются на месте (это объект текущей вкладки). */
const props = defineProps<{ items: Row[]; modified: boolean }>();
const f = defineModel<Filters>('filters', { required: true });
const q = defineModel<string>('q', { required: true });
defineEmits<{ reset: []; commit: [] }>();

/** Статусы + псевдостатусы (пометки). */
const STATUS_OPTIONS = [
  { value: 'none', label: 'без решения' },
  ...optionsOf(STATUS_LABEL),
  { value: 'starred', label: '★ со звездой' },
  { value: 'flagged', label: '⚑ проблемные' },
  { value: 'noted', label: '✎ с заметкой' },
  { value: 'closed', label: 'закрытые' },
];
const CHANNEL_OPTIONS = Object.entries(CHANNEL_LABEL).map(([value, l]) => ({ value, label: `${l.icon} ${l.label}` }));
const REGION_OPTIONS = optionsOf(REGION_LABEL, 'не определён');
const EMPLOYMENT_OPTIONS = optionsOf(EMPLOYMENT_LABEL);
const STOP_OPTIONS = optionsOf(STOP_FLAG_LABEL, 'без стоп-факторов');

/** Значения поля из данных (+ «не задано», если есть пустые). */
function valuesOf(k: string, none?: string) {
  const vals = props.items.map((v) => v[k]);
  const opts: { value: string; label: string }[] = [...new Set(vals.filter(Boolean).map(String))].sort().map((v) => ({ value: v, label: v }));
  return none && vals.some((v) => v == null || v === '') ? [{ value: 'none', label: none }, ...opts] : opts;
}
const sources = computed(() => valuesOf('source'));
const langs = computed(() => valuesOf('vacancy_language', 'не указан'));
const countries = computed(() => valuesOf('company_country', 'не указана'));
</script>

<template>
  <div class="filters">
    <span class="search">
      <input
        id="q"
        v-model="q"
        placeholder="Поиск во вкладке  /"
        title="Быстрый поиск по названию, компании, локации, тегам, summary и навыкам внутри текущей вкладки (не сохраняется); слова через пробел — все должны встретиться"
        @keydown.esc="q = ''; ($event.target as HTMLInputElement).blur()"
      />
      <button v-if="q" class="ghost clear" title="Очистить" @click="q = ''">×</button>
    </span>
    <MultiSelect v-model="f.statuses" :class="{ act: f.statuses.length }" title="статус" placeholder="все открытые" :options="STATUS_OPTIONS" />
    <TriSelect v-model="f.scored" title="скоринг" yes="отскоренные" no="не отскоренные" />
    <label :class="{ act: f.minOverall }">overall ≥ <input v-model.number="f.minOverall" type="number" min="0" max="100" step="5" class="num" /></label>
    <MultiSelect v-model="f.tracks" :class="{ act: f.tracks.length }" title="профиль" :options="TRACKS" />
    <MultiSelect v-model="f.sources" :class="{ act: f.sources.length }" title="источник" :options="sources" />
    <MultiSelect v-model="f.regions" :class="{ act: f.regions.length }" title="регион" :options="REGION_OPTIONS" />
    <MultiSelect v-model="f.countries" :class="{ act: f.countries.length }" title="страна" :options="countries" />
    <MultiSelect v-model="f.langs" :class="{ act: f.langs.length }" title="язык" :options="langs" />
    <MultiSelect v-model="f.channels" :class="{ act: f.channels.length }" title="отклик" :options="CHANNEL_OPTIONS" />
    <MultiSelect v-model="f.employment" :class="{ act: f.employment.length }" title="занятость" :options="EMPLOYMENT_OPTIONS" />
    <MultiSelect v-model="f.stopFlags" :class="{ act: f.stopFlags.length }" title="стоп-факторы" :options="STOP_OPTIONS" />
    <TriSelect v-model="f.salary" title="зарплата" yes="с зарплатой" no="без зарплаты" />
    <PeriodSelect v-model="f.period" />
    <template v-if="modified">
      <button class="ghost" title="Вернуть вкладку к исходным фильтрам" @click="$emit('reset')">↺ сброс</button>
      <button class="ghost" title="Сделать текущие фильтры исходными для этой вкладки" @click="$emit('commit')">✓ закрепить</button>
    </template>
  </div>
</template>
