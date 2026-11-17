import type { Row } from '~/utils/filters';

type ListResponse =
  | { unchanged: true; version: number }
  | { unchanged: false; version: number; items: Row[]; errors: { file: string; error: string }[]; lastRun: string | null };

/**
 * Список вакансий — общий для всего приложения (состояние на уровне модуля, Pinia не нужна).
 * Сервер следит за файлами; клиент раз в 5 с спрашивает `?since=<version>` и получает данные, только если что-то изменилось.
 */
const items = ref<Row[]>([]);
const errors = ref<{ file: string; error: string }[]>([]);
const lastRun = ref<string | null>(null);
const loaded = ref(false);
let version = 0;
/** Номер последнего запроса: ответ устаревшего запроса (стартовал до PATCH) игнорируется. */
let seq = 0;
let pollers = 0;
let pollTimer: ReturnType<typeof setInterval> | undefined;

async function refresh(force = false) {
  const my = ++seq;
  const res = await $fetch<ListResponse>('/api/vacancies', { query: force || !version ? {} : { since: version } });
  if (my !== seq || res.unchanged) return;
  version = res.version;
  items.value = res.items;
  errors.value = res.errors;
  lastRun.value = res.lastRun;
  loaded.value = true;
}

async function patch(id: string, body: Record<string, unknown>) {
  const { show } = useToast();
  try {
    const res = await $fetch<{ data: Row }>(`/api/vacancies/${encodeURIComponent(id)}`, { method: 'PATCH', body });
    const it = items.value.find((v) => v.id === id);
    if (it) Object.assign(it, { status: res.data.status, starred: res.data.starred, flagged: res.data.flagged, notes: res.data.notes, applied_at: res.data.applied_at, applied_via: res.data.applied_via, outcome: res.data.outcome });
    seq++; // отменить ответ опроса, ушедшего до PATCH
    await refresh();
  } catch (e) {
    show(`Ошибка сохранения: ${errText(e)}`);
  }
}

/** Массовая смена статуса одним запросом. */
async function patchMany(ids: string[], status: 'selected' | null) {
  if (!ids.length) return;
  const { show } = useToast();
  try {
    const r = await $fetch<{ updated: number; failed: { id: string; error: string }[] }>('/api/vacancies/batch', { method: 'POST', body: { ids, patch: { status } } });
    if (r.failed.length) show(`Изменено: ${r.updated}, не удалось: ${r.failed.length} — ${r.failed.map((x) => x.error).join('; ')}`);
    seq++;
    await refresh();
  } catch (e) {
    show(`Ошибка сохранения: ${errText(e)}`);
  }
}

async function rescore() {
  const { show } = useToast();
  try {
    const r = await $fetch<{ rescored: number; failed: { file: string; error: string }[]; weightsVersion: number }>('/api/rescore', { method: 'POST' });
    show(`Пересчитано: ${r.rescored} (weights v${r.weightsVersion})` + (r.failed.length ? ` · ошибок: ${r.failed.length} — ${r.failed.map((x) => x.error).join('; ')}` : ''));
    await refresh();
  } catch (e) {
    show(`Ошибка пересчёта: ${errText(e)}`);
  }
}

/** Подключить опрос на время жизни компонента. */
function usePolling() {
  onMounted(() => {
    if (!pollers++) {
      void refresh().catch(() => {});
      pollTimer = setInterval(() => document.visibilityState === 'visible' && refresh().catch(() => {}), 5000);
    }
  });
  onUnmounted(() => {
    if (!--pollers) clearInterval(pollTimer);
  });
}

export function useVacancies() {
  return { items, errors: readonly(errors), lastRun: readonly(lastRun), loaded: readonly(loaded), refresh, patch, patchMany, rescore, usePolling };
}
