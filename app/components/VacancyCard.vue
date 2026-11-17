<script setup lang="ts">
/**
 * Карточка вакансии. Полные данные — GET /api/vacancies/:id (в списке тяжёлых полей нет).
 * `rev` — ревизия файла из списка: изменилась — карточка перечитывается (агент, rescore, свои правки).
 */
const props = defineProps<{ id: string; rev?: number }>();
const emit = defineEmits<{
  patch: [id: string, patch: Record<string, unknown>];
  tagClick: [tag: string];
}>();

const { data: full, refresh } = useFetch<{ data: Record<string, any>; body: string; file: string; resume_missing: string[] | null }>(() => `/api/vacancies/${encodeURIComponent(props.id)}`);
watch(() => props.rev, (r, old) => r !== old && refresh());
const v = computed(() => full.value?.data);

const notes = ref('');
// Берём заметки с сервера, если пользователь не печатает несохранённое (файл может обновиться во время ввода).
watch(v, (x, old) => {
  if (!old || notes.value === (old.notes ?? '')) notes.value = x?.notes ?? '';
}, { immediate: true });
function saveNotes() {
  if (notes.value !== (v.value?.notes ?? '')) emit('patch', props.id, { notes: notes.value });
}

const SCORE_KEYS = [
  ['remote', false],
  ['startup', false],
  ['legitimacy', false],
  ['corporate', true],
  ['outsource', true],
] as const;

const SCORE_TITLES: Record<string, string> = {
  remote: 'Удалённая работа (0–100)',
  startup: 'Стартап-культура (0–100)',
  legitimacy: 'Легитимность и надёжность компании (0–100)',
  corporate: 'Корпоративность и бюрократия (0–100, меньше — лучше)',
  outsource: 'Признаки аутсорса / галеры (0–100, меньше — лучше)',
  region: 'Соответствие региону найма (0–100)',
  language: 'Соответствие языковым требованиям (0–100)',
};

const canManual = computed(() => !v.value?.status || v.value.status === 'selected' || (v.value.status === 'applied' && v.value.applied_via === 'manual'));
</script>

<template>
  <article v-if="v" class="card">
    <header class="card-header">
      <div class="title-row">
        <h2 class="card-title">
          <span class="track-tag" :title="`Основной подходящий трек: ${v.best_resume ?? 'не определён'}`">{{ v.best_resume ?? '—' }}</span>
          {{ v.title }}
        </h2>
        <div v-if="v.scores" class="score-pills">
          <div class="score-pill main-score" :class="tone(v.scores.overall)" title="Общий балл соответствия (overall, 0–100)">
            <span class="score-label">OVERALL</span>
            <span class="score-val">{{ v.scores.overall ?? '—' }}</span>
          </div>
          <div v-if="v.best_resume && v.scores.fit?.[v.best_resume] != null" class="score-pill fit-score" :class="tone(v.scores.fit[v.best_resume])" :title="`Фит для трека ${v.best_resume}: ${v.scores.fit[v.best_resume]}`">
            <span class="score-label">FIT трек</span>
            <span class="score-val">{{ v.scores.fit[v.best_resume] }}</span>
          </div>
        </div>
      </div>

      <!-- Компания и ключевые условия -->
      <div class="company-row">
        <span class="company-name" title="Работодатель">{{ v.company }}</span>
        <template v-if="v.company_country"> · <span title="Страна компании">{{ v.company_country }}</span></template>
        <template v-if="v.location"> · <span title="Локация вакансии">{{ v.location }}</span></template>
        <template v-if="v.salary"> · <span class="salary-tag" title="Уровень зарплаты">{{ fmtSalary(v.salary) }}</span></template>
        · <span title="Формат занятости">{{ labelOf(EMPLOYMENT_LABEL, v.employment) }}</span>
      </div>

      <!-- Основная линия бейджей -->
      <div class="badges-row">
        <span v-if="v.region" class="badge-item region-badge" :title="`Регион вакансии: ${labelOf(REGION_LABEL, v.region)}`">
          🌐 {{ labelOf(REGION_LABEL, v.region) }}
        </span>
        <span v-if="v.employer_group" class="badge-item employer-group-badge" :title="`Группа работодателя: ${labelOf(REGION_LABEL, v.employer_group)}`">
          🏛 {{ labelOf(REGION_LABEL, v.employer_group) }}
        </span>
        <span v-if="v.work_languages?.length" class="badge-item lang-item" :title="`Рабочие языки команды: ${v.work_languages.join(', ')}`">
          🗣 {{ v.work_languages.join(', ') }}
        </span>
        <span v-if="v.ru_speaking_team != null" class="badge-item ru-team" :class="v.ru_speaking_team ? 'good' : 'muted'" :title="v.ru_speaking_team ? 'Русскоязычная команда: да' : 'Русскоязычная команда: нет'">
          🇷🇺 рус. команда: {{ v.ru_speaking_team ? 'да' : 'нет' }}
        </span>
        <span v-if="v.tags?.length" class="tag-list">
          <button
            v-for="t in v.tags"
            :key="t"
            type="button"
            class="tag-btn"
            :title="`Кликните, чтобы фильтровать список по тегу #${t}`"
            @click="emit('tagClick', t)"
          >#{{ t }}</button>
        </span>
      </div>

      <!-- Факторы скоринга (компактная плашка) - выше кнопок действий -->
      <div v-if="v.scores" class="criteria-bar">
        <div v-for="[k, inv] in SCORE_KEYS" :key="k" class="criteria-item" :title="`${SCORE_TITLES[k] ?? k}: ${v.scores[k] ?? '—'}`">
          <span class="criteria-label">{{ k }}</span>
          <span class="badge" :class="tone(v.scores[k], inv)" :title="`${SCORE_TITLES[k] ?? k}: ${v.scores[k] ?? '—'}`">{{ v.scores[k] ?? '—' }}</span>
        </div>
      </div>
      <div v-else class="muted small criteria-bar">Ещё не отскорена агентом.</div>

      <!-- Панель действий -->
      <div class="actions">
        <button :class="{ on: v.status === 'selected' }" :disabled="!!v.status && v.status !== 'selected'" title="a / u — выбрать для отклика" @click="emit('patch', id, { status: v.status === 'selected' ? null : 'selected' })">✓ Откликнуться</button>
        <button
          v-if="canManual"
          :class="{ on: v.status === 'applied' }"
          title="m — откликнулся сам (форма, почта, мессенджер); повторный клик / u — отменить"
          @click="emit('patch', id, { status: v.status === 'applied' ? null : 'applied' })"
        >📨 Откликнулся сам</button>
        <button :class="{ on: v.starred }" title="s — пометить избранным" @click="emit('patch', id, { starred: !v.starred })">★</button>
        <button :class="{ on: v.flagged }" title="f — скоринг/данные неверны, агент перепроверит" @click="emit('patch', id, { flagged: !v.flagged })">⚑ Проблемная</button>
        <span v-if="v.status" class="status" :data-s="v.status" :title="`Статус вакансии: ${labelOf(STATUS_LABEL, v.status)}`">
          {{ labelOf(STATUS_LABEL, v.status) }}<template v-if="v.status === 'applied'"> · {{ v.applied_via === 'manual' ? 'сам' : 'агент' }}<template v-if="v.applied_at"> {{ String(v.applied_at).slice(0, 10) }}</template></template>
        </span>
        <select
          v-if="v.status === 'applied'"
          :value="v.outcome ?? ''"
          title="Что ответил работодатель — по этим данным считается, работает ли резюме (npm run insights)"
          @change="emit('patch', id, { outcome: ($event.target as HTMLSelectElement).value || null })"
        >
          <option value="">результат: ждём</option>
          <option v-for="o in OUTCOMES" :key="o" :value="o">{{ OUTCOME_LABEL[o] }}</option>
        </select>
      </div>
    </header>

    <!-- Предупреждения: внимание / стоп-факторы / закрыта -->
    <section v-if="v.status === 'needs_attention' || v.status === 'apply_failed'" class="attention">
      <b>{{ v.status === 'apply_failed' ? 'Ошибка отклика' : 'Требует внимания' }}: {{ labelOf(ATTENTION_LABEL, v.attention_reason) }}</b>
      <p v-if="v.attention_details" class="pre">{{ v.attention_details }}</p>
    </section>

    <section v-if="v.stop_flags?.length" class="stop">
      <b>Стоп-факторы:</b> {{ v.stop_flags.map((s: string) => labelOf(STOP_FLAG_LABEL, s)).join(', ') }}
    </section>

    <section v-if="v.possibly_closed" class="stop">
      <b>Возможно, вакансия закрыта</b><template v-if="v.alive_checked_at"> (проверено {{ v.alive_checked_at }})</template>
    </section>

    <!-- Заключение от ИИ (вердикт скоринга) - вынесено ВВЕРХ -->
    <section v-if="v.score_reasoning" class="ai-verdict">
      <p class="verdict-text">{{ v.score_reasoning }}</p>
    </section>

    <!-- Краткое описание -->
    <section v-if="v.summary" class="summary-section">
      <p class="summary-text">{{ v.summary }}</p>
    </section>

    <!-- Ключевое и Красные флаги (2 колонки) -->
    <section v-if="v.key_points?.length || v.red_flags?.length" class="two">
      <div v-if="v.key_points?.length" class="key-points-col">
        <h3>Ключевое</h3>
        <ul><li v-for="k in v.key_points" :key="k">{{ k }}</li></ul>
      </div>
      <div v-if="v.red_flags?.length" class="red-flags-col">
        <h3>Красные флаги</h3>
        <ul class="red"><li v-for="k in v.red_flags" :key="k">{{ k }}</li></ul>
      </div>
    </section>

    <!-- Сравнение с резюме и аналитика -->
    <ResumeMatch v-if="v.resume_match" :m="v.resume_match" :missing="full?.resume_missing ?? null" />

    <!-- Особые требования -->
    <section v-if="v.requirements_special?.length">
      <h3>Особые требования</h3>
      <ul>
        <li v-for="(r, i) in v.requirements_special" :key="i">
          <b>{{ r.type }}</b><template v-if="!r.standard"> (нестандартное)</template>: {{ r.details }}
        </li>
      </ul>
    </section>

    <!-- Каналы отклика -->
    <ApplyChannels :id="v.id" :channels="v.apply_channels" :apply-method="v.apply_method" />

    <!-- Ссылки -->
    <section>
      <h3>Ссылки</h3>
      <ul class="links">
        <li><a :href="v.source_url" target="_blank" rel="noopener">{{ v.source }}</a> — источник</li>
        <li v-if="v.real_url"><a :href="v.real_url" target="_blank" rel="noopener">{{ v.real_url }}</a> — прямая</li>
        <li v-else-if="v.real_url_tried_at" class="muted small">прямая ссылка не найдена (искали {{ v.real_url_tried_at }})</li>
        <li v-for="d in v.duplicates" :key="d.url"><a :href="d.url" target="_blank" rel="noopener">{{ d.source }}</a> — дубль<template v-if="d.seen_at"> ({{ d.seen_at }})</template></li>
      </ul>
    </section>

    <!-- Заметки пользователя -->
    <section>
      <h3>Заметки</h3>
      <textarea v-model="notes" rows="3" placeholder="Мои заметки…" @blur="saveNotes" @keydown.stop />
    </section>

    <!-- Лог отклика -->
    <section v-if="v.applied_at || v.apply_log">
      <h3>Отклик</h3>
      <div v-if="v.applied_at" class="small">отправлен: {{ v.applied_at }}</div>
      <p v-if="v.apply_log" class="pre small">{{ v.apply_log }}</p>
    </section>

    <!-- Свернутая вертикальная таблица со всеми техническими деталями и параметрами схемы -->
    <details class="tech-details">
      <summary>Все технические детали и свойства</summary>
      <table class="tech-table">
        <tbody>
          <tr><th>ID вакансии</th><td><code>{{ v.id }}</code></td></tr>
          <tr v-if="v.scores?.fit">
            <th>Все фит-оценки (fit)</th>
            <td>
              <div class="fit-all-list">
                <span v-for="t in TRACKS" :key="t" class="fit-all-item" :class="{ best: v.best_resume === t }" :title="`Фит для трека ${t}: ${v.scores.fit[t] ?? '—'}`">
                  {{ t }}: <b :class="tone(v.scores.fit[t])">{{ v.scores.fit[t] ?? '—' }}</b>
                </span>
              </div>
            </td>
          </tr>
          <tr v-if="v.scores?.region != null">
            <th>Скоринг: регион (region)</th>
            <td><span class="badge" :class="tone(v.scores.region)" :title="`Оценка соответствия региону: ${v.scores.region}`">{{ v.scores.region }}</span></td>
          </tr>
          <tr v-if="v.scores?.language != null">
            <th>Скоринг: язык (language)</th>
            <td><span class="badge" :class="tone(v.scores.language)" :title="`Оценка соответствия языку: ${v.scores.language}`">{{ v.scores.language }}</span></td>
          </tr>
          <tr v-if="full?.file"><th>Файл на диске</th><td><code>{{ full.file }}</code></td></tr>
          <tr><th>Источник</th><td>{{ v.source }}</td></tr>
          <tr><th>Метод отклика</th><td>{{ v.apply_method }} → {{ v.apply_target ?? '—' }}</td></tr>
          <tr><th>Дата сбора</th><td>{{ v.collected_at }}<template v-if="v.collected_run"> (раунд: {{ String(v.collected_run).slice(0, 16).replace('T', ' ') }})</template></td></tr>
          <tr v-if="v.posted_at"><th>Дата публикации</th><td>{{ v.posted_at }}</td></tr>
          <tr><th>Проверка активности</th><td>{{ v.alive_checked_at ?? 'не проверялась' }}<template v-if="v.possibly_closed"> (возможно, закрыта)</template></td></tr>
          <tr v-if="v.real_url_tried_at"><th>Поиск прямой ссылки</th><td>{{ v.real_url_tried_at }}</td></tr>
          <tr v-if="v.scoring_version != null"><th>Версия скоринга</th><td>v{{ v.scoring_version }}</td></tr>
          <tr v-if="v.vacancy_language && (!v.work_languages?.length || v.work_languages.length > 1 || v.work_languages[0] !== v.vacancy_language)">
            <th>Язык вакансии</th><td>{{ v.vacancy_language }}</td>
          </tr>
          <tr v-if="v.work_languages?.length">
            <th>Рабочие языки</th><td>{{ v.work_languages.join(', ') }}</td>
          </tr>
          <tr v-if="v.seniority"><th>Грейд (seniority)</th><td>{{ v.seniority }}</td></tr>
          <tr v-if="v.company_stage"><th>Стадия компании</th><td>{{ v.company_stage }}</td></tr>
          <tr v-if="v.employer_group"><th>Группа работодателя</th><td>{{ v.employer_group }}</td></tr>
          <tr v-if="v.hire_from_ar"><th>Найм из AR</th><td>{{ v.hire_from_ar }}<template v-if="v.hire_from_ar_evidence"> ({{ v.hire_from_ar_evidence }})</template></td></tr>
          <tr v-if="v.timezone"><th>Таймзона</th><td>{{ v.timezone }}</td></tr>
          <tr v-if="v.salary_usd_month"><th>Зарплата USD/мес</th><td>{{ v.salary_usd_month.min ?? '?' }}–{{ v.salary_usd_month.max ?? '?' }}</td></tr>
          <tr v-if="v.scores?.end_client_corporate != null"><th>end_client_corporate</th><td>{{ v.scores.end_client_corporate }}</td></tr>
          <tr v-if="v.prefilter_reason"><th>Отсев предфильтра</th><td>{{ v.prefilter_reason }}</td></tr>
          <tr v-if="v.applied_via"><th>Способ отклика</th><td>{{ v.applied_via }}</td></tr>
          <tr v-if="v.outcome_at"><th>Дата результата</th><td>{{ v.outcome_at }}</td></tr>
          <tr v-if="v.resume_match?.keyword_spellings && Object.keys(v.resume_match.keyword_spellings).length">
            <th>Написания терминов</th>
            <td>
              <span v-for="(spellings, k) in v.resume_match.keyword_spellings" :key="k">
                <b>{{ k }}</b>: {{ spellings.join(', ') }}; 
              </span>
            </td>
          </tr>
          <tr v-if="v.stop_flags?.length"><th>Стоп-флаги (raw)</th><td>{{ v.stop_flags.join(', ') }}</td></tr>
        </tbody>
      </table>
    </details>

    <!-- Исходный текст вакансии -->
    <VacancyBody :body="full!.body" />
  </article>
</template>
