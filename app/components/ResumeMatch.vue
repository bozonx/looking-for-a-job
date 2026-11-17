<script setup lang="ts">
/**
 * Сравнение вакансии с резюме best_resume. Требования — из resume_match (скоринг), пробелы `missing` —
 * сервер считает по текущему тексту резюме; нет резюме — по устаревшим missing_* из скоринга.
 */
const props = defineProps<{ m: Record<string, any>; missing: string[] | null }>();

const missing = computed(() => new Set<string>(props.missing ?? [...(props.m.missing_required ?? []), ...(props.m.missing_nice ?? [])]));
const facts = computed(() =>
  [
    props.m.years_required != null ? `опыт от ${props.m.years_required} лет` : '',
    props.m.domain ? `домен: ${props.m.domain}` : '',
    props.m.product_type ? `продукт: ${props.m.product_type}` : '',
  ].filter(Boolean),
);
</script>

<template>
  <section class="match">
    <h3>Сравнение с резюме · {{ m.resume }}</h3>
    <div v-if="facts.length" class="small">{{ facts.join(' · ') }}</div>
    <div v-if="m.required?.length" class="skills">
      <span class="muted small">обязательно:</span>
      <span v-for="s in m.required" :key="s" class="skill" :class="missing.has(s) ? 'bad' : 'good'" :title="missing.has(s) ? 'нет в резюме' : 'есть в резюме'">{{ s }}</span>
    </div>
    <div v-if="m.nice_to_have?.length" class="skills">
      <span class="muted small">желательно:</span>
      <span v-for="s in m.nice_to_have" :key="s" class="skill" :class="missing.has(s) ? 'mid' : 'good'" :title="missing.has(s) ? 'нет в резюме' : 'есть в резюме'">{{ s }}</span>
    </div>
    <div v-if="m.in_resume_negative?.length">
      <span class="muted small">в резюме, но вакансия против:</span>
      <ul class="red small">
        <li v-for="n in m.in_resume_negative" :key="n.skill"><b>{{ n.skill }}</b> — {{ n.evidence }}</li>
      </ul>
    </div>
    <div v-if="m.soft_requirements?.length" class="small"><span class="muted">soft:</span> {{ m.soft_requirements.join(', ') }}</div>
    <details v-if="m.responsibilities?.length" class="small">
      <summary class="muted">обязанности ({{ m.responsibilities.length }})</summary>
      <ul><li v-for="r in m.responsibilities" :key="r">{{ r }}</li></ul>
    </details>
  </section>
</template>
