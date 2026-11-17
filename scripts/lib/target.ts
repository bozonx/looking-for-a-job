/**
 * Способ отклика по URL и выбор apply_target по config/apply-priority.yaml (design.md §5.3).
 * apply_target хранит конкретное значение (ats-ashby, company-site, linkedin…);
 * неизвестный в списке ats-* ранжируется как ats-other.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { CONFIG_DIR } from './env.ts';
import { channelMethod, channelTarget, type Channel } from './channels.ts';

/** Домены ATS (совпадение — сам домен или поддомен; подстрока не годится: cleverbridge.com ≠ lever). */
const ATS_DOMAINS: Record<string, string> = {
  'greenhouse.io': 'greenhouse',
  'lever.co': 'lever',
  'ashbyhq.com': 'ashby',
  'workable.com': 'workable',
  'smartrecruiters.com': 'smartrecruiters',
  'recruitee.com': 'recruitee',
  'teamtailor.com': 'teamtailor',
  'breezy.hr': 'breezy',
  'bamboohr.com': 'bamboohr',
  'personio.de': 'personio',
  'personio.com': 'personio',
  'myworkdayjobs.com': 'workday',
  'workday.com': 'workday',
  'jobvite.com': 'jobvite',
};

const matchDomain = (h: string, map: Record<string, string>) => Object.entries(map).find(([d]) => h === d || h.endsWith(`.${d}`))?.[1] ?? null;

/** Площадки-агрегаторы: ссылка на них не считается «сайтом компании». */
export const BOARDS: Record<string, string> = {
  'remoteok.com': 'remoteok',
  'remoteok.io': 'remoteok',
  'linkedin.com': 'linkedin',
  'wellfound.com': 'wellfound',
  'getonbrd.com': 'getonbrd',
  'hh.ru': 'hh',
  'hh.kz': 'hh',
  'hh.uz': 'hh',
  'hh.kg': 'hh',
  'hh.az': 'hh',
  'rabota.by': 'hh',
  'djinni.co': 'djinni',
  'getmatch.ru': 'getmatch',
  'geekjob.ru': 'geekjob',
  'himalayas.app': 'himalayas',
  'weworkremotely.com': 'weworkremotely',
  'remotive.com': 'remotive',
  'jobicy.com': 'jobicy',
  'news.ycombinator.com': 'hn',
  'ycombinator.com': 'yc',
  'workatastartup.com': 'yc',
  'workingnomads.com': 'workingnomads',
  'landing.jobs': 'landingjobs',
  'bumeran.com.ar': 'bumeran',
  'zonajobs.com.ar': 'zonajobs',
  'computrabajo.com': 'computrabajo',
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

/** id площадки по ссылке (linkedin, hh, vuejobs…) или null. */
export function boardFromUrl(url: string): string | null {
  const h = host(url);
  return matchDomain(h, BOARDS);
}

/** apply_method по ссылке отклика: ats-<name> | email | external | unknown. */
export function applyMethodFromUrl(url: string | null | undefined): string {
  if (!url) return 'unknown';
  if (url.startsWith('mailto:')) return 'email';
  const h = host(url);
  const ats = matchDomain(h, ATS_DOMAINS);
  return ats ? `ats-${ats}` : 'external';
}

/** Место отклика, которое даёт ссылка: ats-*, источник-агрегатор или company-site. */
export function targetFromUrl(url: string | null | undefined, fallbackSource?: string): string | null {
  if (!url) return fallbackSource ?? null;
  const board = boardFromUrl(url);
  if (board) return board;
  const m = applyMethodFromUrl(url);
  if (m.startsWith('ats-')) return m;
  if (m === 'external') return 'company-site';
  return fallbackSource ?? null;
}

let priority: string[] | null = null;
export function loadPriority(): string[] {
  priority ??= (YAML.parse(fs.readFileSync(path.join(CONFIG_DIR, 'apply-priority.yaml'), 'utf8')) as { priority: string[] }).priority;
  return priority;
}

function rank(target: string): number {
  const p = loadPriority();
  let i = p.indexOf(target);
  if (i < 0 && target.startsWith('ats-')) i = p.indexOf('ats-other');
  return i < 0 ? p.length : i;
}

/** Лучшее место отклика среди каналов (apply_channels), основной ссылки и всех дублей. */
export function pickApplyTarget(d: Record<string, any>): string {
  const cands = [
    ...((d.apply_channels ?? []) as Channel[]).map(channelTarget),
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

/** Канал, соответствующий apply_target (лучший по приоритету), или null. */
export function primaryChannel(d: Record<string, any>): Channel | null {
  const chans = (d.apply_channels ?? []) as Channel[];
  if (!chans.length) return null;
  const t = d.apply_target ?? pickApplyTarget(d);
  return chans.find((c) => channelTarget(c) === t) ?? [...chans].sort((a, b) => rank(channelTarget(a)) - rank(channelTarget(b)))[0]!;
}

/** apply_target и apply_method из каналов: вызывать после любого изменения apply_channels / real_url / duplicates. */
export function deriveApply(d: Record<string, any>): void {
  d.apply_target = pickApplyTarget(d);
  const c = ((d.apply_channels ?? []) as Channel[]).find((x) => channelTarget(x) === d.apply_target);
  if (c) d.apply_method = channelMethod(c);
  else if (d.real_url && targetFromUrl(d.real_url) === d.apply_target) d.apply_method = applyMethodFromUrl(d.real_url);
  else if (d.apply_target === 'linkedin') d.apply_method = 'linkedin';
  else d.apply_method = 'unknown'; // витрина-агрегатор без канала: куда слать — неизвестно
}
