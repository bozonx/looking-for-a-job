<script setup lang="ts">
/**
 * Сравнение вакансии с резюме best_resume.
 * Требования — из resume_match (скоринг), пробелы и сопоставление —
 * сервер считает по текущему тексту резюме и profile/facts.md; нет резюме — по устаревшим missing_* из скоринга.
 */
interface ResumeAnalysis {
  missing: string[];
  inFacts: string[];
  responsibilitiesMatched: string[];
  responsibilitiesMissing: string[];
  softMatched: string[];
  spellingDiffs: Record<string, string[]>;
  frequencies: Record<string, number>;
}

const props = defineProps<{
  m: Record<string, any>;
  missing: string[] | null;
  analysis?: ResumeAnalysis | null;
}>();

const { show } = useToast();

const missing = computed(() => new Set<string>(props.analysis?.missing ?? props.missing ?? [...(props.m.missing_required ?? []), ...(props.m.missing_nice ?? [])]));
const inFacts = computed(() => new Set<string>(props.analysis?.inFacts ?? []));
const softMatched = computed(() => new Set<string>(props.analysis?.softMatched ?? []));
const spellingDiffs = computed(() => props.analysis?.spellingDiffs ?? {});
const frequencies = computed(() => props.analysis?.frequencies ?? {});

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

const respMatched = computed(() => props.analysis?.responsibilitiesMatched ?? []);
const respMissing = computed(() =>
  props.analysis ? props.analysis.responsibilitiesMissing : ((props.m.responsibilities ?? []) as string[]),
);

const coverageSummary = computed(() => {
  const parts: string[] = [];
  const reqTotal = (props.m.required ?? []).length;
  if (reqTotal) parts.push(`Обязательные: ${matchedRequired.value.length}/${reqTotal}`);
  const niceTotal = (props.m.nice_to_have ?? []).length;
  if (niceTotal) parts.push(`Nice: ${matchedNice.value.length}/${niceTotal}`);
  const respTotal = (props.m.responsibilities ?? []).length;
  if (respTotal && props.analysis) parts.push(`Обязанности: ${respMatched.value.length}/${respTotal}`);
  return parts;
});

const hasGaps = computed(
  () => missingRequired.value.length > 0 || missingNice.value.length > 0 || atsMissing.value.length > 0,
);

function copySkill(s: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(s).catch(() => {});
    show(`Скопировано в буфер: ${s}`);
  }
}

function gapTitle(s: string) {
  const freq = frequencies.value[s];
  const freqHint = freq && freq > 1 ? ` (встречается в ${freq} вакансиях)` : '';
  return inFacts.value.has(s)
    ? `Есть в profile/facts.md, но нет в резюме трека${freqHint} — кликните, чтобы скопировать`
    : `Нет ни в резюме, ни в profile/facts.md${freqHint} — кликните, чтобы скопировать`;
}
</script>

<template>
  <section class="match-card">
    <div class="match-header">
      <div>
        <h3>Сравнение с резюме · <span class="highlight">{{ m.resume }}</span></h3>
        <div v-if="coverageSummary.length" class="small muted">{{ coverageSummary.join(' · ') }}</div>
      </div>
      <div v-if="facts.length" class="facts-pill">{{ facts.join(' · ') }}</div>
    </div>

    <!-- В резюме найдено -->
    <div v-if="matchedRequired.length || matchedNice.length" class="match-group">
      <div class="group-title good-title">✓ Найдено в резюме ({{ matchedRequired.length + matchedNice.length }}):</div>
      <div class="skills">
        <span
          v-for="s in matchedRequired"
          :key="s"
          class="skill good"
          :title="spellingDiffs[s]?.length ? `В резюме есть, но в вакансии иначе: ${spellingDiffs[s].join(', ')}` : 'Обязательный навык найден в резюме'"
        >
          {{ s }}<template v-if="spellingDiffs[s]?.length"> <span class="muted">→ {{ spellingDiffs[s][0] }}</span></template>
        </span>
        <span
          v-for="s in matchedNice"
          :key="s"
          class="skill good"
          :title="spellingDiffs[s]?.length ? `В резюме есть, но в вакансии иначе: ${spellingDiffs[s].join(', ')}` : 'Желательный навык найден в резюме'"
        >
          {{ s }} (nice)<template v-if="spellingDiffs[s]?.length"> <span class="muted">→ {{ spellingDiffs[s][0] }}</span></template>
        </span>
      </div>
    </div>

    <!-- Пробелы: Чего не найдено в резюме -->
    <div v-if="hasGaps" class="match-group gaps-group">
      <div class="group-title bad-title">
        <span>⚠ Не найдено в текущем резюме (кликните, чтобы скопировать):</span>
      </div>

      <div v-if="missingRequired.length" class="skills-line">
        <span class="muted small sub-label">Обязательно:</span>
        <button
          v-for="s in missingRequired"
          :key="s"
          type="button"
          class="skill bad clickable"
          :title="gapTitle(s)"
          @click="copySkill(s)"
        >
          {{ s }}<span v-if="inFacts.has(s)" class="facts-badge"> · в фактах</span><span v-if="(frequencies[s] ?? 0) > 1" class="freq-badge">×{{ frequencies[s] }}</span>
        </button>
      </div>

      <div v-if="missingNice.length" class="skills-line">
        <span class="muted small sub-label">Желательно:</span>
        <button
          v-for="s in missingNice"
          :key="s"
          type="button"
          class="skill mid clickable"
          :title="gapTitle(s)"
          @click="copySkill(s)"
        >
          {{ s }}<span v-if="inFacts.has(s)" class="facts-badge"> · в фактах</span><span v-if="(frequencies[s] ?? 0) > 1" class="freq-badge">×{{ frequencies[s] }}</span>
        </button>
      </div>

      <div v-if="atsMissing.length" class="skills-line">
        <span class="muted small sub-label">ATS-ключевики:</span>
        <button
          v-for="s in atsMissing"
          :key="s"
          type="button"
          class="skill ats-tag clickable"
          :title="gapTitle(s)"
          @click="copySkill(s)"
        >
          {{ s }}<span v-if="inFacts.has(s)" class="facts-badge"> · в фактах</span><span v-if="(frequencies[s] ?? 0) > 1" class="freq-badge">×{{ frequencies[s] }}</span>
        </button>
      </div>

      <div class="gap-hint small muted">
        💡 Если есть пометка <b>«в фактах»</b> — опыт уже описан в <code>profile/facts.md</code>, добавьте его в <code>profile/resumes/{{ m.resume }}.md</code>. Счётчик <b>×N</b> — в скольких вакансиях встречается требование. Если скоринг ошибся — нажмите <b>⚑ Проблемная</b> (клавиша <b>f</b>).
      </div>
    </div>

    <!-- Негативные факторы в резюме -->
    <div v-if="m.in_resume_negative?.length" class="match-group negative-group">
      <div class="group-title bad-title">В резюме упомянуто, но вакансия против:</div>
      <ul class="red small">
        <li v-for="n in m.in_resume_negative" :key="n.skill">
          <b>{{ n.skill }}</b> — {{ n.evidence }}
        </li>
      </ul>
    </div>

    <!-- Soft skills -->
    <div v-if="m.soft_requirements?.length" class="match-group soft-group small">
      <span class="muted">Soft skills: </span>
      <span v-for="(s, idx) in m.soft_requirements" :key="s">
        <span :class="softMatched.has(s) ? 'good-title' : ''">{{ softMatched.has(s) ? `✓ ${s}` : s }}</span><span v-if="idx < m.soft_requirements.length - 1">, </span>
      </span>
    </div>

    <!-- Обязанности роли -->
    <div v-if="m.responsibilities?.length" class="match-group resp-group">
      <div class="group-title">Обязанности роли ({{ m.responsibilities.length }}):</div>
      <ul v-if="respMatched.length" class="resp-list">
        <li v-for="r in respMatched" :key="r" class="good-title">✓ {{ r }}</li>
      </ul>
      <ul v-if="respMissing.length" class="resp-list">
        <li v-for="r in respMissing" :key="r">
          <button type="button" class="link-btn" :title="gapTitle(r)" @click="copySkill(r)">
            {{ analysis ? '⚠ ' : '' }}{{ r }}<span v-if="inFacts.has(r)" class="muted small"> (в фактах)</span><span v-if="(frequencies[r] ?? 0) > 1" class="freq-badge">×{{ frequencies[r] }}</span>
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>
