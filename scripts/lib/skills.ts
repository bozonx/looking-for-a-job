/** Словарь навыков config/skills.yaml: нормализация синонимов к каноническому имени. */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { CONFIG_DIR } from './env.ts';

export interface SkillDict {
  /** любое написание (строчными) → каноническое имя */
  alias: Map<string, string>;
  canonical: Set<string>;
}

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function loadSkills(file = path.join(CONFIG_DIR, 'skills.yaml')): SkillDict {
  const raw = (YAML.parse(fs.readFileSync(file, 'utf8')) ?? {}) as Record<string, string[] | null>;
  const alias = new Map<string, string>();
  const canonical = new Set<string>();
  for (const [name, syn] of Object.entries(raw)) {
    const c = key(name);
    canonical.add(c);
    alias.set(c, c);
    for (const s of syn ?? []) alias.set(key(s), c);
  }
  return { alias, canonical };
}

/** Каноническое имя; неизвестный навык возвращается нормализованным как есть. */
export function normSkill(s: string, d: SkillDict): { name: string; known: boolean; aliased: boolean } {
  const k = key(s);
  const c = d.alias.get(k);
  return c ? { name: c, known: true, aliased: c !== k } : { name: k, known: false, aliased: false };
}
