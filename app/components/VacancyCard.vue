<script setup lang="ts">
/**
 * Карточка вакансии. Полные данные — GET /api/vacancies/:id (в списке тяжёлых полей нет).
 * `rev` — ревизия файла из списка: изменилась — карточка перечитывается (агент, rescore, свои правки).
 */
const props = defineProps<{ id: string; rev?: number }>();
const emit = defineEmits<{ patch: [id: string, patch: Record<string, unknown>] }>();

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

const SCORE_KEYS = [['remote', false], ['startup', false], ['legitimacy', false], ['region', false], ['language', false], ['corporate', true], ['outsource', true]] as const;

const canManual = computed(() => !v.value?.status || v.value.status === 'selected' || (v.value.status === 'applied' && v.value.applied_via === 'manual'));
const ruTeam = computed(() => (v.value?.ru_speaking_team == null ? 'неизвестно' : v.value.ru_speaking_team ? 'да' : 'нет'));
</script>

<template>
  <article v-if="v" class="card">
    <header>
      <h2><span class="muted">{{ v.best_resume ?? '—' }}:</span> {{ v.title }}</h2>
      <div class="sub">
        {{ v.company }}<template v-if="v.company_country"> · {{ v.company_country }}</template>
        <template v-if="v.location"> · {{ v.location }}</template>
        <template v-if="v.salary"> · {{ fmtSalary(v.salary) }}</template>
        · {{ labelOf(EMPLOYMENT_LABEL, v.employment) }}
      </div>
      <div class="sub small">
        регион: {{ labelOf(REGION_LABEL, v.region) }}
        · рус. команда: {{ ruTeam }}
        · язык вакансии: {{ v.vacancy_language ?? '—' }}
        · рабочие языки: {{ v.work_languages?.join(', ') || '—' }}
        <template v-if="v.role_tracks?.length"> · треки: {{ v.role_tracks.join(', ') }}</template>
      </div>
      <div v-if="v.tags?.length" class="sub small">теги: {{ v.tags.join(', ') }}</div>
      <div class="actions">
        <button :class="{ on: v.status === 'selected' }" :disabled="!!v.status && v.status !== 'selected'" title="a / u" @click="emit('patch', id, { status: v.status === 'selected' ? null : 'selected' })">✓ Откликнуться</button>
        <button
          v-if="canManual"
          :class="{ on: v.status === 'applied' }"
          title="m — откликнулся сам (форма, почта, мессенджер); повторный клик / u — отменить"
          @click="emit('patch', id, { status: v.status === 'applied' ? null : 'applied' })"
        >📨 Откликнулся сам</button>
        <button :class="{ on: v.starred }" title="s" @click="emit('patch', id, { starred: !v.starred })">★</button>
        <button :class="{ on: v.flagged }" title="f — скоринг/данные неверны, агент перепроверит" @click="emit('patch', id, { flagged: !v.flagged })">⚑ Проблемная</button>
        <span v-if="v.status" class="status" :data-s="v.status">
          {{ labelOf(STATUS_LABEL, v.status) }}<template v-if="v.status === 'applied'"> · {{ v.applied_via === 'manual' ? 'сам' : 'агент' }}<template v-if="v.applied_at"> {{ String(v.applied_at).slice(0, 10) }}</template></template>
        </span>
      </div>
    </header>

    <section v-if="v.status === 'needs_attention' || v.status === 'apply_failed'" class="attention">
      <b>{{ v.status === 'apply_failed' ? 'Ошибка отклика' : 'Требует внимания' }}: {{ labelOf(ATTENTION_LABEL, v.attention_reason) }}</b>
      <p v-if="v.attention_details" class="pre">{{ v.attention_details }}</p>
    </section>

    <section v-if="v.stop_flags?.length" class="stop">Стоп-факторы: {{ v.stop_flags.map((s: string) => labelOf(STOP_FLAG_LABEL, s)).join(', ') }}</section>
    <section v-if="v.possibly_closed" class="stop">Возможно, вакансия закрыта<template v-if="v.alive_checked_at"> (проверено {{ v.alive_checked_at }})</template></section>

    <section v-if="v.summary"><p>{{ v.summary }}</p></section>

    <section v-if="v.key_points?.length || v.red_flags?.length" class="two">
      <div v-if="v.key_points?.length">
        <h3>Ключевое</h3>
        <ul><li v-for="k in v.key_points" :key="k">{{ k }}</li></ul>
      </div>
      <div v-if="v.red_flags?.length">
        <h3>Красные флаги</h3>
        <ul class="red"><li v-for="k in v.red_flags" :key="k">{{ k }}</li></ul>
      </div>
    </section>

    <section v-if="v.scores">
      <h3>Оценки · overall <span class="badge" :class="tone(v.scores.overall)">{{ v.scores.overall ?? '—' }}</span></h3>
      <div class="scores">
        <div v-for="[k, inv] in SCORE_KEYS" :key="k" class="score">
          <span>{{ k }}</span><span class="badge" :class="tone(v.scores[k], inv)">{{ v.scores[k] ?? '—' }}</span>
        </div>
      </div>
      <div class="scores">
        <div v-for="t in TRACKS" :key="t" class="score" :class="{ best: v.best_resume === t }">
          <span>fit {{ t }}</span><span class="badge" :class="tone(v.scores.fit?.[t])">{{ v.scores.fit?.[t] ?? '—' }}</span>
        </div>
      </div>
      <p v-if="v.score_reasoning" class="reason">{{ v.score_reasoning }}</p>
    </section>
    <section v-else class="muted">Ещё не отскорена агентом.</section>

    <ResumeMatch v-if="v.resume_match" :m="v.resume_match" :missing="full?.resume_missing ?? null" />

    <section v-if="v.requirements_special?.length">
      <h3>Особые требования</h3>
      <ul>
        <li v-for="(r, i) in v.requirements_special" :key="i">
          <b>{{ r.type }}</b><template v-if="!r.standard"> (нестандартное)</template>: {{ r.details }}
        </li>
      </ul>
    </section>

    <ApplyChannels :id="v.id" :channels="v.apply_channels" :apply-method="v.apply_method" />

    <section>
      <h3>Ссылки</h3>
      <ul class="links">
        <li><a :href="v.source_url" target="_blank" rel="noopener">{{ v.source }}</a> — источник</li>
        <li v-if="v.real_url"><a :href="v.real_url" target="_blank" rel="noopener">{{ v.real_url }}</a> — прямая</li>
        <li v-else-if="v.real_url_tried_at" class="muted small">прямая ссылка не найдена (искали {{ v.real_url_tried_at }})</li>
        <li v-for="d in v.duplicates" :key="d.url"><a :href="d.url" target="_blank" rel="noopener">{{ d.source }}</a> — дубль<template v-if="d.seen_at"> ({{ d.seen_at }})</template></li>
      </ul>
      <div class="muted small">
        apply: {{ v.apply_method }} → {{ v.apply_target ?? '—' }} · собрана {{ v.collected_at }}<template v-if="v.collected_run"> (сбор {{ String(v.collected_run).slice(0, 16).replace('T', ' ') }})</template>
        <template v-if="v.posted_at"> · опубликована {{ v.posted_at }}</template>
        <template v-if="v.alive_checked_at"> · живость проверена {{ v.alive_checked_at }}</template>
        <template v-if="v.scoring_version != null"> · scoring v{{ v.scoring_version }}</template>
        · id {{ v.id }} · {{ full!.file }}
      </div>
    </section>

    <section v-if="v.applied_at || v.apply_log">
      <h3>Отклик</h3>
      <div v-if="v.applied_at" class="small">отправлен: {{ v.applied_at }}</div>
      <p v-if="v.apply_log" class="pre small">{{ v.apply_log }}</p>
    </section>

    <section>
      <h3>Заметки</h3>
      <textarea v-model="notes" rows="3" placeholder="Мои заметки…" @blur="saveNotes" @keydown.stop />
    </section>

    <VacancyBody :body="full!.body" />
  </article>
</template>
