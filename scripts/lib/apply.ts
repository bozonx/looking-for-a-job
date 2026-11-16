/** Общее для скриптов отклика (dev_docs/apply-plan.md §6): наборы, ссылка отклика, состояние пакета. */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { DATA_DIR, env } from './env.ts';
import { targetFromUrl } from './target.ts';
import type { VacancyFile } from './vacancy.ts';

export const GENERATED_DIR = path.join(DATA_DIR, 'generated');
export type Mode = 'all' | 'selected' | 'scored' | 'retry';

const AGGREGATORS = new Set(['remoteok', 'himalayas', 'weworkremotely', 'remotive', 'jobicy', 'nodesk', 'workingnomads', 'vuejobs', 'hn']);

export const overall = (d: Record<string, any>): number | null => d.scores?.overall ?? null;

/** Ссылка, которую открывать для отклика: та, что соответствует apply_target; иначе real_url → source_url. */
export function applyUrl(d: Record<string, any>): string {
  const t = d.apply_target;
  if (d.real_url && (!t || targetFromUrl(d.real_url) === t)) return d.real_url;
  for (const x of (d.duplicates ?? []) as { source: string; url: string }[]) if (t && (targetFromUrl(x.url, x.source) === t || x.source === t)) return x.url;
  if (t === d.source) return d.source_url;
  return d.real_url ?? d.source_url;
}

/** Агрегатор без прямой ссылки: откликнуться там нельзя, нужен real_url. */
export const needsRealUrl = (d: Record<string, any>) => !d.real_url && AGGREGATORS.has(d.source) && (!d.apply_target || AGGREGATORS.has(d.apply_target));

export function inMode(d: Record<string, any>, mode: Mode): 'selected' | 'scored' | 'retry' | null {
  if ((mode === 'all' || mode === 'selected') && d.status === 'selected') return 'selected';
  if ((mode === 'all' || mode === 'scored') && d.status == null && (overall(d) ?? -1) >= env.APPLY_SCORE_THRESHOLD && !(d.stop_flags ?? []).length) return 'scored';
  if (mode === 'retry' && (d.status === 'needs_attention' || d.status === 'apply_failed')) return 'retry';
  return null;
}

export const isLinkedIn = (d: Record<string, any>) => d.apply_target === 'linkedin' || /linkedin\.com/.test(applyUrl(d));

/** Сколько откликов через LinkedIn за последние 24 часа (по applied_at). */
export function linkedinToday(all: VacancyFile[]): number {
  const since = Date.now() - 24 * 3600 * 1000;
  return all.filter((v) => v.data.status === 'applied' && isLinkedIn(v.data) && v.data.applied_at && Date.parse(v.data.applied_at) >= since).length;
}

export function applicationFile(id: string): string {
  return path.join(GENERATED_DIR, id, 'application.md');
}

/** state из data/generated/<id>/application.md (prepared/filled/submitted/skipped) или null. */
export function applicationState(id: string): string | null {
  const f = applicationFile(id);
  if (!fs.existsSync(f)) return null;
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(f, 'utf8'));
  return m ? ((YAML.parse(m[1]!) ?? {}).state ?? null) : null;
}

/** Обновить поля front matter application.md (если файл есть). */
export function setApplicationFields(id: string, fields: Record<string, unknown>): boolean {
  const f = applicationFile(id);
  if (!fs.existsSync(f)) return false;
  const raw = fs.readFileSync(f, 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return false;
  const doc = YAML.parseDocument(m[1]!);
  for (const [k, v] of Object.entries(fields)) doc.set(k, v);
  fs.writeFileSync(f, `---\n${doc.toString({ lineWidth: 0, nullStr: 'null' })}---\n${m[2]}`);
  return true;
}
