/** Предфильтр по заголовку/тегам из config/prefilter.yaml (общий для всех источников). */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { CONFIG_DIR } from './env.ts';

interface PrefilterConfig {
  include_title: string[];
  include_tags: string[];
  exclude_title: string[];
  /** исключения, которые уступают явному стеку в заголовке (strong_title): «Full Stack PHP/Vue.js» проходит */
  exclude_title_soft?: string[];
  strong_title?: string[];
  /** исключение с оговоркой: ключ отсеивает, если в заголовке нет ни одного из «спасающих» ключей */
  exclude_title_unless?: Record<string, string[]>;
}

/**
 * Короткие «словные» ключи (буквы/цифры/пробелы, любой алфавит) — по началу слова, иначе — подстрокой.
 * Суффикс `$` у ключа — ещё и по концу слова: `intern$` ловит «Intern», но не «Internal».
 */
function toRe(w: string): RegExp {
  const whole = w.endsWith('$');
  const word = w.replace(/^@/, '').replace(/\$$/, '');
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const end = whole ? '(?![\\p{L}\\p{N}])' : '';
  return /^[\p{L}\p{N} ]+$/u.test(word)
    ? new RegExp(`(^|[^\\p{L}\\p{N}])${esc}${end}`, 'iu')
    : new RegExp(`${esc}${end}`, 'iu');
}

export type Prefilter = (title: string, tags: string[]) => { ok: boolean; reason: string };

export function loadPrefilter(): Prefilter {
  const pf = YAML.parse(fs.readFileSync(path.join(CONFIG_DIR, 'prefilter.yaml'), 'utf8')) as PrefilterConfig;
  const exclude = (pf.exclude_title ?? []).map((w) => [w, toRe(w)] as const);
  const excludeSoft = (pf.exclude_title_soft ?? []).map((w) => [w, toRe(w)] as const);
  const strong = (pf.strong_title ?? []).map((w) => [w, toRe(w)] as const);
  const unless = Object.entries(pf.exclude_title_unless ?? {}).map(
    ([w, rescue]) => [w, toRe(w), (rescue ?? []).map((r) => [r, toRe(r)] as const)] as const,
  );
  const include = (pf.include_title ?? []).map((w) => [w, toRe(w)] as const);
  const includeTags = new Set((pf.include_tags ?? []).map((t) => t.toLowerCase()));
  return (title, tags) => {
    const ex = exclude.find(([, re]) => re.test(title));
    if (ex) return { ok: false, reason: `title~"${ex[0]}"` };
    for (const [w, re, rescue] of unless) {
      if (!re.test(title)) continue;
      const r = rescue.find(([, rr]) => rr.test(title));
      if (!r) return { ok: false, reason: `title~"${w}"` };
    }
    const soft = excludeSoft.find(([, re]) => re.test(title));
    if (soft) {
      const st = strong.find(([, re]) => re.test(title));
      if (!st) return { ok: false, reason: `title~"${soft[0]}"` };
      return { ok: true, reason: `title~"${st[0]}" (сильнее «${soft[0]}»)` };
    }
    const inc = include.find(([, re]) => re.test(title));
    if (inc) return { ok: true, reason: `title~"${inc[0]}"` };
    const tag = tags.find((x) => includeTags.has(x.toLowerCase()));
    if (tag) return { ok: true, reason: `tag:${tag}` };
    return { ok: false, reason: 'no matching title/tags' };
  };
}
