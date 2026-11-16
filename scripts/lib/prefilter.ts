/** Предфильтр по заголовку/тегам из config/prefilter.yaml (общий для всех источников). */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { CONFIG_DIR } from './env.ts';

interface PrefilterConfig {
  include_title: string[];
  include_tags: string[];
  exclude_title: string[];
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
  const include = (pf.include_title ?? []).map((w) => [w, toRe(w)] as const);
  const includeTags = new Set((pf.include_tags ?? []).map((t) => t.toLowerCase()));
  return (title, tags) => {
    const ex = exclude.find(([, re]) => re.test(title));
    if (ex) return { ok: false, reason: `title~"${ex[0]}"` };
    const inc = include.find(([, re]) => re.test(title));
    if (inc) return { ok: true, reason: `title~"${inc[0]}"` };
    const tag = tags.find((x) => includeTags.has(x.toLowerCase()));
    if (tag) return { ok: true, reason: `tag:${tag}` };
    return { ok: false, reason: 'no matching title/tags' };
  };
}
