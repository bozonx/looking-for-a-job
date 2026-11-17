<script setup lang="ts">
/**
 * Сравнение вакансии с резюме best_resume.
 * Требования — из resume_match (скоринг), пробелы `missing` —
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

const matchedRequired = computed(() => (props.m.required ?? []).filter((s: string) => !missing.value.has(s)));
const missingRequired = computed(() => (props.m.required ?? []).filter((s: string) => missing.value.has(s)));

const matchedNice = computed(() => (props.m.nice_to_have ?? []).filter((s: string) => !missing.value.has(s)));
const missingNice = computed(() => (props.m.nice_to_have ?? []).filter((s: string) => missing.value.has(s)));

const atsMissing = computed(() => (props.m.ats_keywords_missing ?? []) as string[]);

const hasGaps = computed(() => missingRequired.value.length > 0 || missingNice.value.length > 0 || atsMissing.value.length > 0);
</script>

<template>
  <section class="match-card">
    <div class="match-header">
      <h3>Сравнение с резюме · <span class="highlight" :title="`Трек резюме: ${m.resume}`">{{ m.resume }}</span></h3>
      <div v-if="facts.length" class="facts-pill" title="Параметры требований вакансии">{{ facts.join(' · ') }}</div>
    </div>

    <!-- В резюме найдено -->
    <div v-if="matchedRequired.length || matchedNice.length" class="match-group">
      <div class="group-title good-title">✓ Найдено в резюме ({{ matchedRequired.length + matchedNice.length }}):</div>
      <div class="skills">
        <span v-for="s in matchedRequired" :key="s" class="skill good" :title="`Обязательный навык найден в резюме: ${s}`">{{ s }}</span>
        <span v-for="s in matchedNice" :key="s" class="skill good" :title="`Желательный навык найден в резюме: ${s}`">{{ s }} (nice)</span>
      </div>
    </div>

    <!-- Пробелы: Чего не найдено в резюме -->
    <div v-if="hasGaps" class="match-group gaps-group">
      <div class="group-title bad-title">
        <span>⚠ Не найдено в текущем резюме:</span>
      </div>

      <div v-if="missingRequired.length" class="skills-line">
        <span class="muted small sub-label" title="Обязательные навыки, не найденные в резюме">Обязательно:</span>
        <span
          v-for="s in missingRequired"
          :key="s"
          class="skill bad"
          :title="`Обязательный навык не найден в резюме: ${s}`"
        >
          {{ s }}
        </span>
      </div>

      <div v-if="missingNice.length" class="skills-line">
        <span class="muted small sub-label" title="Желательные навыки, не найденные в резюме">Желательно:</span>
        <span
          v-for="s in missingNice"
          :key="s"
          class="skill mid"
          :title="`Желательный навык не найден в резюме: ${s}`"
        >
          {{ s }}
        </span>
      </div>

      <div v-if="atsMissing.length" class="skills-line">
        <span class="muted small sub-label" title="Ключевые слова ATS, не найденные в резюме">ATS-ключевики:</span>
        <span
          v-for="s in atsMissing"
          :key="s"
          class="skill ats-tag"
          :title="`ATS-ключевик не найден в резюме: ${s}`"
        >
          {{ s }}
        </span>
      </div>
    </div>

    <!-- Негативные факторы в резюме -->
    <div v-if="m.in_resume_negative?.length" class="match-group negative-group">
      <div class="group-title bad-title">В резюме упомянуто, но вакансия против:</div>
      <ul class="red small">
        <li v-for="n in m.in_resume_negative" :key="n.skill" :title="`Негативный фактор: ${n.skill}`">
          <b>{{ n.skill }}</b> — {{ n.evidence }}
        </li>
      </ul>
    </div>

    <!-- Soft skills -->
    <div v-if="m.soft_requirements?.length" class="match-group soft-group small">
      <span class="muted" title="Гибкие навыки и личные качества">Soft skills:</span>
      <span class="soft-tags" title="Soft skills (гибкие навыки)"> {{ m.soft_requirements.join(', ') }}</span>
    </div>

    <!-- Обязанности роли -->
    <div v-if="m.responsibilities?.length" class="match-group resp-group">
      <div class="group-title" title="Список обязанностей по вакансии">Обязанности роли ({{ m.responsibilities.length }}):</div>
      <ul class="resp-list">
        <li v-for="r in m.responsibilities" :key="r">{{ r }}</li>
      </ul>
    </div>
  </section>
</template>
