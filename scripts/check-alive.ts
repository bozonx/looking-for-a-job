/**
 * Проверка, жива ли вакансия по прямой ссылке (real_url) — без браузера и без агента, обычными HTTP-запросами.
 * `npm run check-alive -- [--status none,selected,needs_attention] [--force] [--dry-run] [id|путь …]`
 *
 * Правила по ATS (публичные API, 404 = вакансии нет):
 * - Workable:   apply.workable.com/<acc>/j/<id>      → api/v2/accounts/<acc>/jobs/<id>
 *   (сама страница отвечает 200 с редиректом на ?not_found=true — поэтому смотрим API)
 * - Greenhouse: (job-)boards.greenhouse.io/<co>/jobs/<id> → boards-api.greenhouse.io/v1/boards/<co>/jobs/<id>
 * - Lever:      jobs.lever.co/<co>/<uuid>            → api.lever.co/v0/postings/<co>/<uuid>
 * - Ashby:      jobs.ashbyhq.com/<org>/<uuid>        → id есть в списке posting-api/job-board/<org> (кэш на org)
 * - прочее:     GET real_url; 404/410 или редирект с not_found/expired в URL → закрыта; иначе «неизвестно».
 * Без real_url проверяется source_url (агрегатор) — только «generic»: закрытой считается лишь при явном 404/410/редиректе.
 * HN пропускается: ссылка ведёт на комментарий, он не удаляется вместе с вакансией.
 *
 * Пишет в front matter possibly_closed (true/false) и alive_checked_at (дата). Неизвестный результат possibly_closed не меняет.
 * По умолчанию пропускает проверенные сегодня (--force — проверить заново).
 */
import { fetchWithRetry, pool } from './lib/http.ts';

/** не больше стольких проверок одновременно — иначе сотни хостов = сотни открытых соединений */
const PARALLEL_CHECKS = 16;
import { loadAll, parseVacancy, resolveTargets, writeVacancy } from './lib/vacancy.ts';
import { appendRunLog } from './lib/runlog.ts';

type Verdict = 'open' | 'closed' | 'unknown';

const args = process.argv.slice(2);
const val = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');
const statuses = new Set((val('--status') ?? 'none,selected,needs_attention').split(',').map((s) => s.trim()).filter(Boolean));
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--status');
const today = new Date().toISOString().slice(0, 10);

/** Что проверять: прямую ссылку, иначе страницу источника (кроме HN). */
function targetUrl(d: Record<string, any>): string | null {
  if (d.real_url) return d.real_url;
  if (d.source_url && !/news\.ycombinator\.com/.test(d.source_url)) return d.source_url;
  return null;
}

/** 404/410 → closed, 2xx → open, остальное → unknown */
async function byStatus(url: string): Promise<Verdict> {
  const res = await fetchWithRetry(url, { headers: { Accept: 'application/json' } });
  await res.body?.cancel().catch(() => {});
  if (res.status === 404 || res.status === 410) return 'closed';
  return res.ok ? 'open' : 'unknown';
}

const ashbyBoards = new Map<string, Promise<Set<string> | null>>();
function ashbyIds(org: string): Promise<Set<string> | null> {
  if (!ashbyBoards.has(org)) {
    ashbyBoards.set(
      org,
      (async () => {
        const res = await fetchWithRetry(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}`, { headers: { Accept: 'application/json' } });
        if (!res.ok) return null;
        const j = (await res.json()) as { jobs?: { id: string }[] };
        return Array.isArray(j.jobs) ? new Set(j.jobs.map((x) => x.id.toLowerCase())) : null;
      })().catch(() => null),
    );
  }
  return ashbyBoards.get(org)!;
}

export async function checkUrl(raw: string): Promise<{ verdict: Verdict; how: string }> {
  const u = new URL(raw);
  const p = u.pathname.split('/').filter(Boolean);
  const host = u.hostname;

  if (host === 'apply.workable.com' && p[1] === 'j' && p[2])
    return { verdict: await byStatus(`https://apply.workable.com/api/v2/accounts/${p[0]}/jobs/${p[2]}`), how: 'workable' };

  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const i = p.indexOf('jobs');
    const co = p[0] === 'embed' ? u.searchParams.get('for') : p[0];
    const id = i > 0 ? p[i + 1] : u.searchParams.get('token') ?? u.searchParams.get('gh_jid');
    if (co && id) return { verdict: await byStatus(`https://boards-api.greenhouse.io/v1/boards/${co}/jobs/${id}`), how: 'greenhouse' };
  }

  if (host === 'jobs.lever.co' && p[1])
    return { verdict: await byStatus(`https://api.lever.co/v0/postings/${p[0]}/${p[1]}`), how: 'lever' };

  if (host === 'jobs.ashbyhq.com' && p[1]) {
    const ids = await ashbyIds(decodeURIComponent(p[0]!));
    if (ids) return { verdict: ids.has(p[1].toLowerCase()) ? 'open' : 'closed', how: 'ashby' };
    return { verdict: 'unknown', how: 'ashby: доска недоступна' };
  }

  // Прочие сайты: только явные признаки. 200 не считаем «жива» — многие отдают 200 на заглушку.
  const res = await fetchWithRetry(raw, { redirect: 'follow' });
  await res.body?.cancel().catch(() => {});
  if (res.status === 404 || res.status === 410) return { verdict: 'closed', how: `generic ${res.status}` };
  if (/not_found|notfound|expired|job-closed|no-longer/i.test(res.url) && res.url !== raw) return { verdict: 'closed', how: 'generic redirect' };
  return { verdict: 'unknown', how: `generic ${res.status}` };
}

async function main() {
  const files = positional.length ? resolveTargets(positional).map(parseVacancy) : loadAll();
  const queue = files.filter((v) => {
    if (!positional.length && !statuses.has(v.data.status ?? 'none')) return false;
    if (!targetUrl(v.data)) return false;
    return force || positional.length > 0 || v.data.alive_checked_at !== today;
  });
  const skippedNoUrl = files.filter((v) => (positional.length || statuses.has(v.data.status ?? 'none')) && !targetUrl(v.data)).length;
  console.log(`Проверяю ${queue.length} вакансий (без ссылки для проверки пропущено: ${skippedNoUrl})…`);

  const stat = { open: 0, closed: 0, unknown: 0, error: 0 };
  const closedNow: string[] = [];
  const reopened: string[] = [];
  // throttle в lib/http разводит запросы к одному хосту; разные хосты идут параллельно
  await pool(queue, PARALLEL_CHECKS, async (v) => {
    let r: { verdict: Verdict; how: string };
    try {
      r = await checkUrl(targetUrl(v.data)!);
      if (!v.data.real_url) r.how = `source: ${r.how}`;
    } catch (e) {
      stat.error++;
      console.log(`! ${v.data.id}: ${(e as Error).message}`);
      return;
    }
    stat[r.verdict]++;
    if (r.verdict === 'unknown') {
      console.log(`? ${v.data.id}: ${r.how}`);
      if (dryRun) return;
      const fresh = parseVacancy(v.file); // possibly_closed не трогаем — только отмечаем, что сегодня смотрели
      fresh.data.alive_checked_at = today;
      writeVacancy(v.file, fresh.data, fresh.body);
      return;
    }
    const closed = r.verdict === 'closed';
    if (closed && !v.data.possibly_closed) closedNow.push(`${v.data.id} (${r.how}) ${targetUrl(v.data)}`);
    if (!closed && v.data.possibly_closed) reopened.push(v.data.id);
    if (closed) console.log(`✕ ${v.data.id}: закрыта (${r.how})`);
    if (dryRun) return;
    // перечитываем перед записью: файл мог поменять UI, пока шли запросы
    const fresh = parseVacancy(v.file);
    fresh.data.possibly_closed = closed;
    fresh.data.alive_checked_at = today;
    writeVacancy(v.file, fresh.data, fresh.body);
  });

  const summary =
    `- проверено: ${queue.length}; открыты: ${stat.open}, закрыты: ${stat.closed}, неизвестно: ${stat.unknown}, ошибок: ${stat.error}\n` +
    `- без ссылки для проверки пропущено: ${skippedNoUrl}\n` +
    `- впервые помечены закрытыми: ${closedNow.length}; снова открыты: ${reopened.length}`;
  console.log(`\n# ИТОГ ПРОВЕРКИ${dryRun ? ' (dry-run)' : ''}\n${summary}`);
  if (!dryRun && queue.length)
    appendRunLog('check-alive', `## check-alive\n\n${summary}\n${closedNow.map((s) => `\n- закрыта: ${s}`).join('')}${reopened.map((s) => `\n- снова открыта: ${s}`).join('')}`);
}

await main();
