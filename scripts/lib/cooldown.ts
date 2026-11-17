/**
 * Паузы для хостов, переживающие перезапуск: data/state/host-cooldown.json, `{"<scope>:<host>": "<ISO до>"}`.
 * Площадка ограничила нас (429) или закрылась защитой (403) — не идём к ней снова через 10 минут.
 * scope разделяет назначение: `http` — любой запрос (lib/http), `resolve` — страницы вакансий в resolve-urls
 * (RSS той же площадки при этом может работать).
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './env.ts';

const FILE = path.join(DATA_DIR, 'state', 'host-cooldown.json');

function load(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** до какого момента хост на паузе; null — не на паузе */
export function cooldownUntil(scope: string, host: string, now = Date.now()): Date | null {
  const v = load()[`${scope}:${host}`];
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) && t > now ? new Date(t) : null;
}

export function setCooldown(scope: string, host: string, ms: number): Date {
  const map = load();
  const now = Date.now();
  for (const [k, v] of Object.entries(map)) if (!(Date.parse(v) > now)) delete map[k]; // истёкшие — убрать
  const until = new Date(now + ms);
  map[`${scope}:${host}`] = until.toISOString();
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(map, null, 1));
  } catch {
    /* нет data/ (тесты, dry-run в чистом клоне) — пауза действует только в этом запуске */
  }
  return until;
}

export const fmtUntil = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
