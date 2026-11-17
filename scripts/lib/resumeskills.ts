/**
 * Какие навыки из config/skills.yaml упомянуты в тексте резюме (profile/resumes/<track>.md).
 * Пробелы резюме считает скрипт по текущему тексту, а не агент при скоринге: после правки резюме
 * статистика сразу актуальна (playbooks/analyze.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.ts';
import type { SkillDict } from './skills.ts';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Регэксп для написания навыка: по границам «слова» (буквы/цифры), регистр не важен.
 * Короткие чисто буквенные написания (≤ 4: go, next, c, r) — обычные слова английского текста,
 * поэтому только с заглавной буквы или целиком заглавными («Go», «REST», «SQL»).
 */
export function spellingRe(alias: string): RegExp {
  const body = `(?<![\\p{L}\\p{N}])${esc(alias)}(?![\\p{L}\\p{N}#+])`;
  if (/^[a-z]{1,4}$/.test(alias)) {
    const forms = [alias[0]!.toUpperCase() + alias.slice(1), alias.toUpperCase()].map(esc).join('|');
    return new RegExp(`(?<![\\p{L}\\p{N}])(?:${forms})(?![\\p{L}\\p{N}#+])`, 'u');
  }
  return new RegExp(body, 'iu');
}

/** Канонические навыки, упомянутые в тексте (HTML-комментарии игнорируются). */
export function skillsInText(text: string, dict: SkillDict): Set<string> {
  const clean = text.replace(/<!--[\s\S]*?-->/g, ' ');
  const found = new Set<string>();
  for (const [alias, canon] of dict.alias) if (!found.has(canon) && spellingRe(alias).test(clean)) found.add(canon);
  return found;
}

/** Текст базового резюме трека или null, если файла нет. */
export function resumeText(track: string): string | null {
  // имя файла трека — через дефис (ai_engineer → ai-engineer.md)
  for (const name of [track, track.replace(/_/g, '-')]) {
    const f = path.join(ROOT, 'profile', 'resumes', `${name}.md`);
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  }
  return null;
}

/** Есть ли написание дословно (без учёта регистра) в тексте — для проверки ATS-написаний. */
export const hasSpelling = (text: string, s: string) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(s)}(?![\\p{L}\\p{N}#+])`, 'iu').test(text);
