/**
 * Hacker News «Ask HN: Who is hiring?» — ежемесячный тред, компании пишут сами.
 * Через публичный API поиска Algolia (без ключа): последние треды пользователя whoishiring,
 * верхнеуровневые комментарии = вакансии. Первая строка поста — «Компания | Роль | Локация | …».
 */
import { fetchJson, sleep } from '../lib/http.ts';
import { decodeEntities, makeJob } from '../lib/job.ts';
import type { Provider, RawJob } from '../lib/collect.ts';

const API = 'https://hn.algolia.com/api/v1';
/** сколько последних тредов смотреть (новый тред — 1-го числа; старый ещё актуален в начале месяца) */
const THREADS = 2;
const ROLE = /engineer|developer|programmer|architect|\blead\b|cto|founding|full[- ]?stack|front[- ]?end|back[- ]?end|devops|sre|scientist|designer|manager|analyst|staff|intern/i;

interface Hit {
  objectID: string;
  comment_text?: string;
  created_at_i: number;
  parent_id: number;
  story_id: number;
  author: string;
}

/** Заголовок поста: текст до первого абзаца. */
function header(html: string): string {
  return decodeEntities(html.split(/<p>/i)[0]!.replace(/<[^>]+>/g, ' '));
}

function toRaw(h: Hit): RawJob {
  const html = h.comment_text ?? '';
  const head = header(html);
  const parts = head.split(/\s+\|\s+|\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
  const looksLikeJob = parts.length >= 2 && !/^(seeking|looking for work|who wants)/i.test(head);
  const location = parts.find((p) => /remote|onsite|on-site|hybrid|office/i.test(p)) ?? null;
  // заголовок — части с названием роли; иначе вторая часть строки
  const roles = parts.slice(1).filter((p) => ROLE.test(p) && p !== location);
  const title = (roles.length ? roles.join(', ') : (parts[1] ?? head)).slice(0, 160);
  return makeJob({
    extId: h.objectID,
    postedAt: h.created_at_i * 1000,
    title,
    company: (parts[0] ?? h.author).slice(0, 80),
    tags: [],
    sourceName: 'Hacker News: Who is hiring',
    sourceUrl: `https://news.ycombinator.com/item?id=${h.objectID}`,
    location,
    extra: { 'HN author': h.author, Header: head },
    html,
    skip: looksLikeJob ? null : 'не похоже на вакансию (нет «Компания | Роль | …»)',
  });
}

function parse(input: unknown): RawJob[] {
  const hits = (input as any)?.hits;
  if (!Array.isArray(hits)) throw new Error('HN Algolia: unexpected response');
  return (hits as Hit[]).filter((h) => h.parent_id === h.story_id && h.comment_text).map(toRaw);
}

export const hn: Provider = {
  source: 'hn',
  paginated: false,
  parse,
  async fetchPage(page) {
    if (page > 0) return [];
    const stories = (await fetchJson(`${API}/search_by_date?tags=story,author_whoishiring&hitsPerPage=10`)) as { hits: { objectID: string; title: string }[] };
    const threads = stories.hits.filter((s) => /who is hiring/i.test(s.title)).slice(0, THREADS);
    if (!threads.length) throw new Error('не найден тред «Who is hiring»');
    const out: RawJob[] = [];
    for (const t of threads) {
      for (let p = 0; ; p++) {
        await sleep(300);
        const res = (await fetchJson(`${API}/search_by_date?tags=comment,story_${t.objectID}&hitsPerPage=1000&page=${p}`)) as { hits: Hit[]; nbPages: number };
        out.push(...parse(res));
        if (p + 1 >= res.nbPages) break;
      }
    }
    return out.sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0));
  },
};
