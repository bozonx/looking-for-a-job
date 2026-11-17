<script setup lang="ts">
import type { Row, SortKey } from '~/utils/filters';

/** Таблица вакансий: сортировка по заголовкам, отметка «на отклик», выбор текущей строки. */
const props = defineProps<{ rows: Row[]; current: string | null; sorts: SortKey[]; lastRun: string | null }>();
const emit = defineEmits<{
  select: [id: string];
  sort: [key: string, shift: boolean];
  /** null — снять отметку */
  mark: [ids: string[], status: 'selected' | null];
}>();

const COLS = [['overall', 'overall'], ['profile', 'профиль'], ['date', 'дата'], ['company', 'Вакансия'], ['region', 'регион']] as const;
const SCORE_COLS = [['remote', 'R', false], ['startup', 'S', false], ['corporate', 'C', true], ['outsource', 'O', true], ['legitimacy', 'L', false]] as const;

// массовая отметка: видимые строки без решения или уже выбранные
const markable = computed(() => props.rows.filter((v) => !v.status || v.status === 'selected'));
const allMarked = computed(() => markable.value.length > 0 && markable.value.every((v) => v.status === 'selected'));
const someMarked = computed(() => markable.value.some((v) => v.status === 'selected'));
function markAll(on: boolean) {
  emit('mark', markable.value.filter((v) => (v.status === 'selected') !== on).map((v) => v.id), on ? 'selected' : null);
}

const kind = (v: Row) => channelKind(v.apply_method);
const channelTitle = (v: Row) =>
  [`Отклик: ${CHANNEL_LABEL[kind(v)]!.label} → ${v.apply_target ?? '—'}`, ...(v.apply_channels ?? []).map((c: any) => `${CHANNEL_LABEL[c.type]?.icon ?? ''} ${c.value}`)].join('\n');
const langTitle = (v: Row) => (v.work_languages?.length ? `язык: ${v.vacancy_language}, рабочие: ${v.work_languages.join(', ')}` : `язык: ${v.vacancy_language}`);
</script>

<template>
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
          <SortHeader v-for="[k, l] in COLS" :key="k" :k="k" :sorts="sorts" :hint="k === 'company' ? 'Сортировка по компании' : undefined" @sort="(a, b) => emit('sort', a, b)">{{ l }}</SortHeader>
          <th class="score-h">
            <SortHeader v-for="[k, l] in SCORE_COLS" :key="k" tag="span" :k="k" :sorts="sorts" :hint="k" @sort="(a, b) => emit('sort', a, b)">{{ l }}</SortHeader>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="v in rows" :key="v.id" :class="{ cur: v.id === current }" @click="emit('select', v.id)">
          <td class="check" @click.stop>
            <input
              type="checkbox"
              :checked="v.status === 'selected' || v.status === 'applied'"
              :disabled="!!v.status && v.status !== 'selected'"
              :title="v.status && v.status !== 'selected' ? 'Статус: ' + labelOf(STATUS_LABEL, v.status) : 'Отметить для автоотклика'"
              @change="emit('mark', [v.id], ($event.target as HTMLInputElement).checked ? 'selected' : null)"
            />
          </td>
          <td><span class="badge big" :class="tone(v.scores?.overall)">{{ v.scores?.overall ?? '…' }}</span></td>
          <td>{{ v.best_track ?? v.best_resume ?? '—' }}</td>
          <td class="col-date">
            <div class="nowrap date-line">
              <span v-if="isFresh(v, lastRun)" class="dot-new" title="Новая — из последнего сбора"></span>
              <span>{{ (v.posted_at ?? v.collected_at)?.slice(5) }}</span>
            </div>
            <div v-if="v.status" class="status-line">
              <span class="status mini" :data-s="v.status">{{ labelOf(STATUS_LABEL, v.status) }}</span>
            </div>
          </td>
          <td class="title">
            <div>
              <span v-if="v.starred" class="star">★</span><span v-if="v.flagged" class="flag" title="Проблемная">⚑</span>
              <s v-if="v.possibly_closed" title="Возможно, закрыта">{{ v.title }}</s><template v-else>{{ v.title }}</template>
            </div>
            <div class="muted small">
              <span class="badge ch-badge" :class="'ch-' + kind(v)" :title="channelTitle(v)">{{ CHANNEL_LABEL[kind(v)]!.icon }}<template v-if="(v.apply_channels?.length ?? 0) > 1"> +{{ v.apply_channels.length - 1 }}</template></span>
              {{ v.company }}
              <template v-if="v.duplicates?.length"> · <span class="badge dup-badge" :title="'Дубликатов: ' + v.duplicates.length">⧉ {{ v.duplicates.length }}</span></template>
              <template v-if="v.stop_flags?.length"> · <span class="flag">⛔ {{ v.stop_flags.map((s: string) => labelOf(STOP_FLAG_LABEL, s)).join(', ') }}</span></template>
            </div>
          </td>
          <td class="col-region">
            <div class="region-line">
              <span :title="v.region ? labelOf(REGION_LABEL, v.region) : 'регион не определён'">{{ v.region ?? '—' }}</span>
              <span v-if="v.vacancy_language" class="badge lang-badge" :title="langTitle(v)">{{ v.vacancy_language }}</span>
            </div>
          </td>
          <td class="badges">
            <template v-if="v.scores">
              <span v-for="[k, , inv] in SCORE_COLS" :key="k" class="badge" :class="tone(v.scores[k], inv)" :title="k">{{ v.scores[k] }}</span>
            </template>
          </td>
        </tr>
        <tr v-if="!rows.length"><td colspan="7" class="muted empty">Пусто</td></tr>
      </tbody>
    </table>
  </div>
</template>
