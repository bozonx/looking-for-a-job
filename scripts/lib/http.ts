/**
 * HTTP для сбора:
 * - пауза между запросами к одному хосту (HOST_GAP_MS) — общая для всех провайдеров, защита от бана;
 * - 429/5xx/сетевые ошибки → до 3 повторов с паузой 1с, 2с, 4с (или Retry-After: секунды либо HTTP-дата, ≤ 60с);
 * - общий бюджет на один запрос с повторами (TOTAL_BUDGET_MS) — зависший хост не съедает минуты;
 * - 429 после всех повторов → хост блокируется до конца запуска: дальнейшие запросы к нему сразу падают,
 *   а не добивают площадку, которая уже нас ограничила.
 */
export const UA = 'Mozilla/5.0 (job-search personal script)';

const ATTEMPT_TIMEOUT_MS = 30_000;
const TOTAL_BUDGET_MS = 120_000;
const HOST_GAP_MS = 500;
const MAX_RETRY_WAIT_MS = 60_000;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** хосты, ответившие 429 после всех повторов, — до конца запуска не трогаем */
const blockedHosts = new Set<string>();
/** хост → момент, раньше которого следующий запрос к нему не отправляем */
const nextSlot = new Map<string, number>();

/** некритичные проблемы (сводятся в «⚠ Предупреждения» лога источника; забирает lib/collect.ts) */
const warnings: string[] = [];
export const warn = (msg: string) => void warnings.push(msg);
export const takeHttpWarnings = () => warnings.splice(0);

export class HostBlockedError extends Error {}

/** Ждёт своей очереди к хосту. Слот резервируется синхронно — корректно и при параллельных вызовах. */
async function throttle(host: string): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, at + HOST_GAP_MS);
  if (at > now) await sleep(at - now);
}

/** Retry-After: секунды или HTTP-дата → мс; null — нет/непонятно. */
export function retryAfterMs(v: string | null | undefined, now = Date.now()): number | null {
  if (!v) return null;
  const s = Number(v);
  if (Number.isFinite(s)) return s >= 0 ? s * 1000 : null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - now) : null;
}

export async function fetchWithRetry(url: string, init: RequestInit = {}, retries = 3): Promise<Response> {
  const host = new URL(url).host;
  if (blockedHosts.has(host)) throw new HostBlockedError(`${url}: хост ${host} ограничил запросы (429) — пропущено до следующего сбора`);
  const headers = { 'User-Agent': UA, ...(init.headers as Record<string, string> | undefined) };
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  for (let attempt = 0; ; attempt++) {
    await throttle(host);
    let res: Response | null = null;
    let err: unknown = null;
    try {
      res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, Math.max(1000, deadline - Date.now()))) });
    } catch (e) {
      err = e;
    }
    const retriable = err || (res && (res.status === 429 || res.status >= 500));
    const ra = res ? retryAfterMs(res.headers.get('retry-after')) : null;
    const wait = Math.min(ra ?? 1000 * 2 ** attempt, MAX_RETRY_WAIT_MS);
    const outOfBudget = Date.now() + wait >= deadline;
    if (!retriable || attempt >= retries || outOfBudget) {
      if (res?.status === 429) {
        blockedHosts.add(host);
        warn(`${host}: 429 Too Many Requests после ${attempt + 1} попыток — остальные запросы к хосту в этом запуске пропущены`);
      }
      if (err) throw new Error(`${url}: ${(err as Error).message}`);
      return res!;
    }
    await res?.body?.cancel().catch(() => {}); // освободить соединение перед повтором
    await sleep(wait);
  }
}

export async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetchWithRetry(url, { ...init, headers: { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.slice(0, 80).replace(/\s+/g, ' ');
    throw new Error(`${url}: ответ не JSON (${res.headers.get('content-type') ?? '?'}; «${snippet}…») — капча или сменился API?`);
  }
}

export async function fetchText(url: string, init: RequestInit = {}): Promise<string> {
  const res = await fetchWithRetry(url, init);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/**
 * Загрузка по частям (категории, запросы, URL ленты): ошибка одной части — предупреждение, а не провал источника.
 * Бросает, только если не загрузилась ни одна часть.
 */
export async function eachTolerant<T>(label: string, items: T[], fn: (item: T) => Promise<void>, name: (item: T) => string = String): Promise<void> {
  let ok = 0;
  let last: unknown = null;
  for (const it of items) {
    try {
      await fn(it);
      ok++;
    } catch (e) {
      last = e;
      warn(`${label} «${name(it)}»: ${(e as Error).message}`);
    }
  }
  if (items.length && !ok) throw last instanceof Error ? last : new Error(`${label}: ни одна часть не загрузилась`);
}
