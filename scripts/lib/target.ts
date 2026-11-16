/**
 * Способ отклика по URL и выбор apply_target по config/source-priority.yaml (design.md §5.3).
 * apply_target хранит конкретное значение (ats-ashby, company-site, linkedin…);
 * неизвестный в списке ats-* ранжируется как ats-other.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { CONFIG_DIR } from './env.ts';

const ATS = ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee', 'teamtailor', 'breezy', 'bamboohr', 'personio', 'workday', 'jobvite'];

/** Площадки-агрегаторы: ссылка на них не считается «сайтом компании». */
const BOARDS: Record<string, string> = {
  'remoteok.com': 'remoteok',
  'remoteok.io': 'remoteok',
  'linkedin.com': 'linkedin',
  'wellfound.com': 'wellfound',
  'getonbrd.com': 'getonbrd',
  'hh.ru': 'hh',
  'himalayas.app': 'himalayas',
  'weworkremotely.com': 'weworkremotely',
  'remotive.com': 'remotive',
  'jobicy.com': 'jobicy',
  'news.ycombinator.com': 'hn',
  'ycombinator.com': 'yc',
  'workatastartup.com': 'yc',
  'workingnomads.com': 'workingnomads',
  'landing.jobs': 'landingjobs',
  'career.habr.com': 'habr',
  'vuejobs.com': 'vuejobs',
  'nodesk.co': 'nodesk',
};

function host(url: string): string {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** apply_method по ссылке отклика: ats-<name> | email | external | unknown. */
export function applyMethodFromUrl(url: string | null | undefined): string {
  if (!url) return 'unknown';
  if (url.startsWith('mailto:')) return 'email';
  const h = host(url);
  const ats = ATS.find((a) => h.includes(a));
  return ats ? `ats-${ats}` : 'external';
}

/** Место отклика, которое даёт ссылка: ats-*, источник-агрегатор или company-site. */
export function targetFromUrl(url: string | null | undefined, fallbackSource?: string): string | null {
  if (!url) return fallbackSource ?? null;
  const h = host(url);
  const board = Object.entries(BOARDS).find(([d]) => h === d || h.endsWith(`.${d}`));
  if (board) return board[1];
  const m = applyMethodFromUrl(url);
  if (m.startsWith('ats-')) return m;
  if (m === 'external') return 'company-site';
  return fallbackSource ?? null;
}

let priority: string[] | null = null;
function loadPriority(): string[] {
  priority ??= (YAML.parse(fs.readFileSync(path.join(CONFIG_DIR, 'source-priority.yaml'), 'utf8')) as { priority: string[] }).priority;
  return priority;
}

function rank(target: string): number {
  const p = loadPriority();
  let i = p.indexOf(target);
  if (i < 0 && target.startsWith('ats-')) i = p.indexOf('ats-other');
  return i < 0 ? p.length : i;
}

/** Лучшее место отклика среди основной ссылки и всех дублей. */
export function pickApplyTarget(d: Record<string, any>): string {
  const cands = [
    targetFromUrl(d.real_url),
    d.source,
    ...((d.duplicates ?? []) as { source: string; url: string }[]).map((x) => {
      const t = targetFromUrl(x.url, x.source);
      // дубль-ссылка с внешнего домена, но помеченная источником (wellfound и т.п.) — доверяем source
      return t === 'company-site' && x.source && x.source !== 'company-site' ? x.source : t;
    }),
  ].filter((x): x is string => !!x);
  return cands.sort((a, b) => rank(a) - rank(b))[0] ?? d.source;
}
