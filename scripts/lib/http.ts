/**
 * HTTP для сбора:
 * - пауза между запросами к одному хосту (HOST_GAP_MS) — общая для всех провайдеров, защита от бана;
 * - 429/5xx/сетевые ошибки → до 3 повторов с паузой ~1с, 2с, 4с (±20%, чтобы параллельные запросы к хосту
 *   не повторялись синхронно; или ровно Retry-After: секунды либо HTTP-дата, ≤ 60с);
 * - общий бюджет на один запрос с повторами (TOTAL_BUDGET_MS) — зависший хост не съедает минуты;
 * - 429 после всех повторов → хост блокируется до конца запуска: дальнейшие запросы к нему сразу падают,
 *   а не добивают площадку, которая уже нас ограничила.
 */
export const UA = 'Mozilla/5.0 (job-search personal script)';

const ATTEMPT_TIMEOUT_MS = 30_000;
const TOTAL_BUDGET_MS = 120_000;
const HOST_GAP_MS = 500;
const MAX_RETRY_WAIT_MS = 60_000;

import { AsyncLocalStorage } from 'node:async_hooks';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Обработать items, держа в работе не больше limit одновременно (порядок старта — порядок списка). */
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** хосты, ответившие 429 после всех повторов, — до конца запуска не трогаем */
const blockedHosts = new Set<string>();
/** хост → момент, раньше которого следующий запрос к нему не отправляем */
const nextSlot = new Map<string, number>();

/**
 * Некритичные проблемы (сводятся в «⚠ Предупреждения» лога источника; забирает lib/collect.ts).
 * Источники собираются параллельно, поэтому буфер свой у каждого: lib/collect.ts запускает источник
 * внутри withHttpWarnings(), и warn() пишет в буфер текущего асинхронного контекста.
 */
const warnScope = new AsyncLocalStorage<string[]>();
const globalWarnings: string[] = [];
export const warn = (msg: string) => void (warnScope.getStore() ?? globalWarnings).push(msg);
export const takeHttpWarnings = () => (warnScope.getStore() ?? globalWarnings).splice(0);
export const withHttpWarnings = <T>(fn: () => Promise<T>): Promise<T> => warnScope.run([], fn);

/** ±20% к паузе */
const jitter = (ms: number) => Math.round(ms * (0.8 + Math.random() * 0.4));

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
    const wait = Math.min(ra ?? jitter(1000 * 2 ** attempt), MAX_RETRY_WAIT_MS);
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
