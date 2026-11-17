/**
 * Конверсия откликов — единственная прямая проверка, работает ли резюме (npm run insights, раздел «Отклики»).
 * Версия заготовок — по бэкапам data/backups/resumes-<дата>/ (playbooks/resume-update.md делает бэкап перед
 * перезаписью): отклик от даты D относится к заготовкам, действовавшим с последнего бэкапа ≤ D.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Без ответа дольше стольких дней — считаем «нет ответа», даже если пользователь не отметил. */
export const SILENCE_DAYS = 21;
/** Меньше откликов в группе — конверсию не сравнивать. */
export const MIN_APPLIED = 10;

export interface Funnel {
  applied: number;
  waiting: number;
  no_reply: number;
  rejected: number;
  positive: number; // screen + interview + offer
  interview: number; // interview + offer
}

export const emptyFunnel = (): Funnel => ({ applied: 0, waiting: 0, no_reply: 0, rejected: 0, positive: 0, interview: 0 });

export function addToFunnel(f: Funnel, d: { outcome?: string | null; applied_at?: string | null }, today: string): void {
  f.applied++;
  const o = d.outcome ?? null;
  if (o === 'rejected') f.rejected++;
  else if (o === 'screen' || o === 'interview' || o === 'offer') {
    f.positive++;
    if (o !== 'screen') f.interview++;
  } else if (o === 'no_reply') f.no_reply++;
  else {
    const days = d.applied_at ? (Date.parse(today) - Date.parse(String(d.applied_at).slice(0, 10))) / 86400e3 : Infinity;
    if (days >= SILENCE_DAYS) f.no_reply++;
    else f.waiting++;
  }
}

/** Даты версий заготовок резюме (по бэкапам), по возрастанию. */
export function resumeVersions(backupsDir: string): string[] {
  if (!fs.existsSync(backupsDir)) return [];
  return fs
    .readdirSync(backupsDir)
    .map((n) => /^resumes-(\d{4}-\d{2}-\d{2})/.exec(n)?.[1])
    .filter((x): x is string => !!x)
    .sort();
}

/** Метка версии заготовок для даты отклика: «до <первая>» или «с <дата>». */
export function versionOf(appliedAt: string | null | undefined, versions: string[]): string {
  const d = String(appliedAt ?? '').slice(0, 10);
  if (!versions.length) return 'текущие';
  let cur: string | null = null;
  for (const v of versions) if (v <= d) cur = v;
  return cur ? `с ${cur}` : `до ${versions[0]}`;
}

export const backupsDir = (dataDir: string) => path.join(dataDir, 'backups');
