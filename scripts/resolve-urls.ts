/**
 * Поиск прямой ссылки отклика (real_url) и других каналов (email, Telegram, WhatsApp, Facebook — apply_channels) на странице агрегатора — обычным GET, без браузера и агента.
 * `npm run resolve-urls -- [--limit 40] [--status none,selected] [--dry-run] [--force] [id|путь …]`
 *
 * Бережно к площадкам (без бана):
 * - запросы к одной площадке строго последовательно, пауза GAP_MS (+ случайный разброс); разные площадки — параллельно;
 * - не больше --limit страниц с одной площадки за запуск (по умолчанию 40), свежие вакансии первыми;
 * - 403/429 → площадка до конца запуска пропускается;
 * - каждая вакансия пробуется один раз: real_url_tried_at; повтор — только с --force.
 *
 * Правила извлечения (проверены на живых страницах, 2026-11):
 * - vuejobs, weworkremotely: href кнопки «Apply» — внешняя ссылка (обычно ATS);
 * - любая площадка: если на странице ровно одна ссылка на конкретную вакансию в известной ATS — берём её;
 * - любая площадка: mailto:/t.me/wa.me/facebook и адреса в тексте рядом со словами про отклик — в apply_channels.
 * Не используются: workingnomads «Apply now» (там реклама), himalayas (403 от защиты), getonbrd/habr/jobicy/remotive/YC
 * (отклик на самой площадке или за логином), HN (ссылки из комментария извлекает агент при скоринге).
 */
import { fetchWithRetry, sleep } from './lib/http.ts';
import { loadAll, parseVacancy, resolveTargets, writeVacancy, type VacancyFile } from './lib/vacancy.ts';
import { deriveApply } from './lib/target.ts';
import { channelFromUrl, extractChannels, mergeChannels, type Channel } from './lib/channels.ts';
import { htmlToMarkdown } from './lib/html.ts';
import { hasChannel } from './lib/apply.ts';
import { appendRunLog } from './lib/runlog.ts';

const GAP_MS = 3000;
const JITTER_MS = 1500;

const args = process.argv.slice(2);
const val = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');
const limit = Number(val('--limit') ?? 40);
const statuses = new Set((val('--status') ?? 'none,selected').split(',').map((s) => s.trim()).filter(Boolean));
const positional = args.filter((a, i) => !a.startsWith('--') && !['--status', '--limit'].includes(args[i - 1] ?? ''));
const today = new Date().toISOString().slice(0, 10);

/** площадки, где кнопке «Apply» можно верить */
const APPLY_BUTTON_HOSTS = new Set(['vuejobs.com', 'weworkremotely.com']);
/** площадки, которые не трогаем вовсе */
const SKIP_HOSTS = new Set(['news.ycombinator.com', 'himalayas.app', 'www.getonbrd.com', 'getonbrd.com', 'career.habr.com', 'www.ycombinator.com', 'jobicy.com', 'remotive.com', 'linkedin.com', 'www.linkedin.com']);

/** Ссылка на конкретную вакансию в ATS (не на общую доску компании). */
const ATS_JOB = [
  /^https:\/\/(job-boards|boards)(\.eu)?\.greenhouse\.io\/[^/]+\/jobs\/\d+/,
  /^https:\/\/jobs(\.eu)?\.lever\.co\/[^/]+\/[0-9a-f-]{36}/,
  /^https:\/\/jobs\.ashbyhq\.com\/[^/]+\/[0-9a-f-]{36}/,
  /^https:\/\/apply\.workable\.com\/[^/]+\/j\/[0-9A-F]+/i,
  /^https:\/\/jobs\.smartrecruiters\.com\/[^/]+\/\d+/,
  /^https:\/\/[^/]+\.recruitee\.com\/o\/[^/]+/,
  /^https:\/\/[^/]+\.teamtailor\.com\/jobs\/\d+/,
  /^https:\/\/[^/]+\.breezy\.hr\/p\/[^/]+/,
  /^https:\/\/[^/]+\.bamboohr\.com\/careers\/\d+/,
  /^https:\/\/[^/]+\.jobs\.personio\.(de|com)\/job\/\d+/,
];

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/');

/** Убрать трекинг (utm_*, ref, source) и хвост /apply|/application — оставить страницу вакансии. */
export function cleanUrl(raw: string): string {
  const u = new URL(raw);
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref$|source$|gh_src$|lever-source)/i.test(k)) u.searchParams.delete(k);
  u.hash = '';
  return u.toString().replace(/\?$/, '');
}

export function extractApplyUrl(html: string, pageUrl: string): { url: string; how: string } | null {
  const pageHost = new URL(pageUrl).hostname;
  const abs = (h: string) => {
    try {
      return new URL(decode(h), pageUrl).toString();
    } catch {
      return null;
    }
  };

  if (APPLY_BUTTON_HOSTS.has(pageHost.replace(/^www\./, ''))) {
    for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]{0,400}?)<\/a>/g)) {
      const text = m[2]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!/^apply( now| for this (job|position))?$/i.test(text)) continue;
      const href = /href="([^"]+)"/.exec(m[1]!)?.[1];
      const url = href && abs(href);
      if (url && /^https?:/.test(url) && new URL(url).hostname !== pageHost) return { url: cleanUrl(url), how: 'apply-button' };
    }
  }

  const ats = new Set<string>();
  for (const m of html.matchAll(/https?:(?:\/|\\\/){2}[^"'\s<>\\]+(?:\\\/[^"'\s<>\\]+)*/g)) {
    const url = decode(m[0].replace(/\\\//g, '/'));
    if (ATS_JOB.some((r) => r.test(url))) ats.add(cleanUrl(url).replace(/\/(apply|application)\/?$/, ''));
  }
  if (ats.size === 1) return { url: [...ats][0]!, how: 'ats-link' };
  return null;
}

async function main() {
  const files: VacancyFile[] = positional.length ? resolveTargets(positional).map(parseVacancy) : loadAll();
  const date = (v: VacancyFile) => String(v.data.posted_at ?? v.data.collected_at ?? '');
  const queue = files
    .filter((v) => positional.length || (statuses.has(v.data.status ?? 'none') && !hasChannel(v.data) && (force || !v.data.real_url_tried_at)))
    .filter((v) => v.data.source_url && !SKIP_HOSTS.has(new URL(v.data.source_url).hostname))
    .sort((a, b) => date(b).localeCompare(date(a)));

  const byHost = new Map<string, VacancyFile[]>();
  for (const v of queue) {
    const h = new URL(v.data.source_url).hostname;
    const list = byHost.get(h) ?? [];
    if (list.length < limit) list.push(v);
    byHost.set(h, list);
  }
  const total = [...byHost.values()].reduce((s, l) => s + l.length, 0);
  console.log(`Страниц к загрузке: ${total} (в очереди ${queue.length}, лимит ${limit} на площадку): ${[...byHost].map(([h, l]) => `${h} ${l.length}`).join(', ')}`);

  const found: string[] = [];
  const notes: string[] = [];
  let tried = 0;
  await Promise.all(
    [...byHost].map(async ([host, list]) => {
      for (const [i, v] of list.entries()) {
        if (i) await sleep(GAP_MS + Math.random() * JITTER_MS);
        let res: Response;
        try {
          res = await fetchWithRetry(v.data.source_url, {}, 1);
        } catch (e) {
          notes.push(`${host}: ${(e as Error).message} — площадка пропущена`);
          return;
        }
        if (res.status === 403 || res.status === 429) {
          await res.body?.cancel().catch(() => {});
          notes.push(`${host}: HTTP ${res.status} — площадка пропущена до следующего запуска`);
          return;
        }
        tried++;
        const html = res.ok ? await res.text() : (await res.body?.cancel().catch(() => {}), '');
        const hit = html ? extractApplyUrl(html, res.url) : null;
        const chans: Channel[] = html ? extractChannels(htmlToMarkdown(html)).map((c) => ({ ...c, by: 'resolve' as const })) : [];
        if (chans.length) console.log(`  каналы ${v.data.id}: ${chans.map((c) => `${c.type} ${c.value}`).join(', ')}`);
        if (hit || chans.length) found.push(`${v.data.id} → ${[hit?.url, ...chans.map((c) => `${c.type} ${c.value}`)].filter(Boolean).join(', ')}${hit ? ` (${hit.how})` : ''}`);
        if (hit) {
          console.log(`✓ ${v.data.id} → ${hit.url} (${hit.how})`);
        } else console.log(`· ${v.data.id}: ${res.ok ? 'ссылки нет' : `HTTP ${res.status}`}`);
        if (dryRun) continue;
        const fresh = parseVacancy(v.file); // UI мог поменять файл, пока шли запросы
        fresh.data.real_url_tried_at = today;
        if (hit && !fresh.data.real_url) {
          fresh.data.real_url = hit.url;
          delete fresh.data.alive_checked_at; // проверялась ссылка агрегатора — пусть check-alive проверит новую
        }
        const before = JSON.stringify(fresh.data.apply_channels ?? []);
        fresh.data.apply_channels = mergeChannels(fresh.data.apply_channels, [channelFromUrl(fresh.data.real_url, 'resolve'), ...chans]);
        if (hit || before !== JSON.stringify(fresh.data.apply_channels)) deriveApply(fresh.data);
        writeVacancy(v.file, fresh.data, fresh.body);
      }
    }),
  );

  const summary = `- загружено страниц: ${tried} из ${total}; real_url/канал найден: ${found.length}${notes.length ? `\n${notes.map((n) => `- ⚠ ${n}`).join('\n')}` : ''}`;
  console.log(`\n# ИТОГ ПОИСКА REAL_URL${dryRun ? ' (dry-run)' : ''}\n${summary}`);
  if (found.length) console.log('NEXT: npm run score (apply_target), npm run check-alive');
  if (!dryRun && tried) appendRunLog('resolve-urls', `## resolve-urls\n\n${summary}\n${found.map((s) => `\n- ${s}`).join('')}`);
}

await main();
