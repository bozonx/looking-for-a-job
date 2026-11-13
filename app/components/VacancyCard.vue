<script setup lang="ts">
import { marked } from 'marked';

const props = defineProps<{ id: string }>();
const emit = defineEmits<{ patch: [id: string, patch: Record<string, unknown>] }>();

const { data: full, refresh } = useFetch(() => `/api/vacancies/${encodeURIComponent(props.id)}`);
defineExpose({ refresh });

const v = computed(() => (full.value as any)?.data);
const showBody = ref(false);
const notes = ref('');
// Take server notes unless the user has unsaved edits (the file may be refreshed while typing).
watch(
  v,
  (x, old) => {
    if (!old || notes.value === (old.notes ?? '')) notes.value = x?.notes ?? '';
  },
  { immediate: true },
);

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
// Vacancy text comes from third-party sites: raw HTML is escaped, links open in a new tab.
const renderer = new marked.Renderer();
renderer.html = ({ text }) => escapeHtml(text);
renderer.link = ({ href, text }) =>
  /^https?:|^mailto:/i.test(href) ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>` : escapeHtml(text);
// Do not load third-party images (tracking pixels): show them as links instead.
renderer.image = ({ href, text }) =>
  /^https?:/i.test(href) ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">[изображение${text ? `: ${escapeHtml(text)}` : ''}]</a>` : '';
const bodyHtml = computed(() => (full.value ? (marked.parse((full.value as any).body, { renderer, async: false }) as string) : ''));

const scoreRows = computed(() => {
  const s = v.value?.scores;
  if (!s) return [];
  return [
    ['remote', s.remote, false],
    ['startup', s.startup, false],
    ['legitimacy', s.legitimacy, false],
    ['region', s.region, false],
    ['language', s.language, false],
    ['corporate', s.corporate, true],
    ['outsource', s.outsource, true],
    ['end client corp.', s.end_client_corporate, true],
  ] as [string, number | null, boolean][];
});

function saveNotes() {
  if (notes.value !== (v.value?.notes ?? '')) emit('patch', props.id, { notes: notes.value });
}
</script>

<template>
  <article v-if="v" class="card">
    <header>
      <h2><span class="muted">{{ v.best_resume ?? '—' }}:</span> {{ v.title }}</h2>
      <div class="sub">
        {{ v.company }}<template v-if="v.company_country"> · {{ v.company_country }}</template>
        <template v-if="v.location"> · {{ v.location }}</template>
        <template v-if="v.salary"> · {{ fmtSalary(v.salary) }}</template>
        · {{ v.employment }}
      </div>
      <div class="sub small">
        регион: {{ v.region ?? '—' }}
        · язык вакансии: {{ v.vacancy_language ?? '—' }}
        · рабочие языки: {{ v.work_languages?.join(', ') || '—' }}
        <template v-if="v.role_tracks?.length"> · треки: {{ v.role_tracks.join(', ') }}</template>
      </div>
      <div v-if="v.tags?.length" class="sub small">теги: {{ v.tags.join(', ') }}</div>
      <div class="actions">
        <button :class="{ on: v.status === 'selected' }" @click="emit('patch', id, { status: 'selected' })" title="a">✓ Откликнуться</button>
        <button :class="{ on: v.status === 'rejected' }" @click="emit('patch', id, { status: 'rejected' })" title="x">✕ Отклонить</button>
        <button :class="{ on: v.starred }" @click="emit('patch', id, { starred: !v.starred })" title="s">★</button>
        <button v-if="v.status !== 'new'" class="ghost" @click="emit('patch', id, { status: 'new' })" title="u">↺ new</button>
        <span class="status" :data-s="v.status">{{ STATUS_LABEL[v.status] ?? v.status }}</span>
      </div>
    </header>

    <section v-if="v.status === 'needs_attention' || v.status === 'apply_failed'" class="attention">
      <b>{{ v.status === 'apply_failed' ? 'Ошибка отклика' : 'Требует внимания' }}: {{ ATTENTION_LABEL[v.attention_reason] ?? v.attention_reason ?? '—' }}</b>
      <p v-if="v.attention_details" class="pre">{{ v.attention_details }}</p>
    </section>

    <section v-if="v.stop_flags?.length" class="stop">Стоп-факторы: {{ v.stop_flags.join(', ') }}</section>
    <section v-if="v.possibly_closed" class="stop">Возможно, вакансия закрыта</section>

    <section v-if="v.summary">
      <p>{{ v.summary }}</p>
    </section>

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
        <div v-for="[k, val, inv] in scoreRows" :key="k" class="score">
          <span>{{ k }}</span><span class="badge" :class="tone(val, inv)">{{ val ?? '—' }}</span>
        </div>
      </div>
      <div class="scores">
        <div v-for="t in TRACKS" :key="t" class="score" :class="{ best: v.best_resume === t }">
          <span>fit {{ t }}</span><span class="badge" :class="tone(v.scores.fit?.[t])">{{ v.scores.fit?.[t] ?? '—' }}</span>
        </div>
      </div>
      <p v-if="v.score_reasoning" class="reason">{{ v.score_reasoning }}</p>
      <div v-if="v.scoring_version != null" class="muted small">scoring_version: {{ v.scoring_version }}</div>
    </section>
    <section v-else class="muted">Ещё не отскорена агентом.</section>

    <section v-if="v.requirements_special?.length">
      <h3>Особые требования</h3>
      <ul>
        <li v-for="(r, i) in v.requirements_special" :key="i">
          <b>{{ r.type }}</b><template v-if="!r.standard"> (нестандартное)</template>: {{ r.details }}
        </li>
      </ul>
    </section>

    <section>
      <h3>Ссылки</h3>
      <ul class="links">
        <li><a :href="v.source_url" target="_blank" rel="noopener">{{ v.source }}</a> — источник</li>
        <li v-if="v.real_url"><a :href="v.real_url" target="_blank" rel="noopener">{{ v.real_url }}</a> — прямая</li>
        <li v-for="d in v.duplicates" :key="d.url"><a :href="d.url" target="_blank" rel="noopener">{{ d.source }}</a> — дубль<template v-if="d.seen_at"> ({{ d.seen_at }})</template></li>
      </ul>
      <div class="muted small">
        apply: {{ v.apply_method }} → {{ v.apply_target ?? '—' }} · собрана {{ v.collected_at }}
        <template v-if="v.posted_at"> · опубликована {{ v.posted_at }}</template>
        · id {{ v.id }} · {{ (full as any).file }}
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

    <section>
      <button class="ghost" @click="showBody = !showBody">{{ showBody ? '▾' : '▸' }} Оригинальный текст</button>
      <div v-if="showBody" class="body" v-html="bodyHtml" />
    </section>
  </article>
</template>
