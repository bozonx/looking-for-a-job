/**
 * HTTP для сбора:
 * - пауза между запросами к одному хосту (HOST_GAP_MS) — общая для всех провайдеров, защита от бана;
 * - 429/5xx/сетевые ошибки → до 3 повторов с паузой ~1с, 2с, 4с (±20%, чтобы параллельные запросы к хосту
 *   не повторялись синхронно; или ровно Retry-After: секунды либо HTTP-дата, ≤ 60с);
 * - общий бюджет на один запрос с повторами (TOTAL_BUDGET_MS) — зависший хост не съедает минуты;
 * - 429 после всех повторов → хост блокируется до конца запуска: дальнейшие запросы к нему сразу падают,
 *   а не добивают площадку, которая уже нас ограничила; хост ставится на паузу и в data/state/host-cooldown.json
 *   (Retry-After или COOLDOWN_429_MS) — следующие запуски его тоже не трогают;
 * - 403 дважды за запуск от одного хоста → хост блокируется до конца запуска (защита от ботов, долбить бесполезно);
 * - User-Agent — обычный Chrome на Windows: со «скриптовым» UA HTML-страницы за Cloudflare отвечают 403.
 */
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const BROWSER_HEADERS = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' };

const ATTEMPT_TIMEOUT_MS = 30_000;
const TOTAL_BUDGET_MS = 120_000;
const HOST_GAP_MS = 500;
const MAX_RETRY_WAIT_MS = 60_000;
const COOLDOWN_429_MS = 3600e3;
/** после стольких 403 от хоста за запуск — блок до конца запуска */
const MAX_403 = 2;

import { AsyncLocalStorage } from 'node:async_hooks';
import { cooldownUntil, fmtUntil, setCooldown } from './cooldown.ts';

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
/** хост → сколько 403 он отдал за запуск */
const forbidden = new Map<string, number>();
/** хост → момент, раньше которого следующий запрос к нему не отправляем */
const nextSlot = new Map<string, number>();

/**
 * Некритичные проблемы (сводятся в «⚠ Предупреждения» лога источника; забирает lib/collect.ts).
 * Источники собираются параллельно, поэтому буфер свой у каждого: lib/collect.ts запускает источник
 * внутри withHttpWarnings(), и warn() пишет в буфер текущего асинхронного контекста.
 */
interface Scope {
  warnings: string[];
  /** часть списка (лента, категория, запрос) не загрузилась — список неполный */
  partial: boolean;
}
const warnScope = new AsyncLocalStorage<Scope>();
const globalScope: Scope = { warnings: [], partial: false };
const scope = () => warnScope.getStore() ?? globalScope;
export const warn = (msg: string) => void scope().warnings.push(msg);
export const takeHttpWarnings = () => scope().warnings.splice(0);
/** Список источника загружен не полностью (eachTolerant) — окно сбора сдвигать нельзя. */
export const markPartialList = () => void (scope().partial = true);
export const takePartialList = () => {
  const s = scope();
  const p = s.partial;
  s.partial = false;
  return p;
};
export const withHttpWarnings = <T>(fn: () => Promise<T>): Promise<T> => warnScope.run({ warnings: [], partial: false }, fn);

/** ±20% к паузе */
const jitter = (ms: number) => Math.round(ms * (0.8 + Math.random() * 0.4));

export class HostBlockedError extends Error {}

/** Ждёт своей очереди к хосту. Слот резервируется синхронно — корректно и при параллельных вызовах. */
async function throttle(host: string, gapMs = HOST_GAP_MS): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, at + gapMs);
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

/** gapMs — пауза между запросами к хосту, если HOST_GAP_MS мало (HTML-страницы, а не API) */
export async function fetchWithRetry(url: string, init: RequestInit = {}, retries = 3, opts: { gapMs?: number } = {}): Promise<Response> {
  const host = new URL(url).host;
  if (blockedHosts.has(host)) throw new HostBlockedError(`${url}: хост ${host} ограничил запросы (429/403) — пропущено до следующего запуска`);
  const paused = cooldownUntil('http', host);
  if (paused) {
    blockedHosts.add(host);
    warn(`${host}: на паузе после 429 до ${fmtUntil(paused)} — запросы к хосту пропущены`);
    throw new HostBlockedError(`${url}: хост ${host} на паузе до ${fmtUntil(paused)} (429)`);
  }
  const headers = { ...BROWSER_HEADERS, ...(init.headers as Record<string, string> | undefined) };
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  for (let attempt = 0; ; attempt++) {
    await throttle(host, opts.gapMs);
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
        const until = setCooldown('http', host, Math.max(ra ?? 0, COOLDOWN_429_MS));
        warn(`${host}: 429 Too Many Requests после ${attempt + 1} попыток — хост на паузе до ${fmtUntil(until)}`);
      }
      if (res?.status === 403) {
        const n = (forbidden.get(host) ?? 0) + 1;
        forbidden.set(host, n);
        if (n >= MAX_403) {
          blockedHosts.add(host);
          warn(`${host}: ${n}× HTTP 403 (защита от ботов?) — остальные запросы к хосту в этом запуске пропущены`);
        }
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
      markPartialList();
      warn(`${label} «${name(it)}»: ${(e as Error).message}`);
    }
  }
  if (items.length && !ok) throw last instanceof Error ? last : new Error(`${label}: ни одна часть не загрузилась`);
}
