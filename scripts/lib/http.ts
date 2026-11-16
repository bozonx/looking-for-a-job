/** HTTP с повторами: 429/5xx/сетевые ошибки → до 3 повторов с паузой 1с, 2с, 4с (или Retry-After). */
export const UA = 'Mozilla/5.0 (job-search personal script)';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(url: string, init: RequestInit = {}, retries = 3): Promise<Response> {
  const headers = { 'User-Agent': UA, ...(init.headers as Record<string, string> | undefined) };
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    let err: unknown = null;
    try {
      res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      err = e;
    }
    const retriable = err || (res && (res.status === 429 || res.status >= 500));
    if (!retriable || attempt >= retries) {
      if (err) throw err;
      return res!;
    }
    const ra = Number(res?.headers.get('retry-after'));
    await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 60) * 1000 : 1000 * 2 ** attempt);
  }
}

export async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetchWithRetry(url, { ...init, headers: { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export async function fetchText(url: string, init: RequestInit = {}): Promise<string> {
  const res = await fetchWithRetry(url, init);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}
