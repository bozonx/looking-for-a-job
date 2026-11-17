/**
 * Id всех обработанных вакансий источника (сохранённых, отсеянных предфильтром, дублей):
 * data/state/seen-<source>.json. Нужны, чтобы при повторном сборе они считались «известными»
 * (COLLECT_STOP_ON_SEEN) — в том числе после удаления файла (cleanup, ручное удаление дубля).
 * Значение — дата; у отсеянных предфильтром — «<дата> pf»: при следующем сборе их заново прогоняют через
 * предфильтр, и если он с тех пор расширился — вакансия собирается как новая.
 * У вакансий, на которых падает построение записи (404 страницы и т. п.), — «<дата> errN»: до MAX_FAILURES
 * попыток они не считаются известными и пробуются заново, после — считаются известными (не повторяем
 * одну и ту же ошибку в каждом отчёте).
 * Записи старше KEEP_DAYS удаляются при сохранении; KEEP_DAYS > CLEANUP_DEFAULT_DAYS с запасом.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, env, today } from './env.ts';

/** после стольких неудачных попыток построить запись вакансия больше не пробуется */
export const MAX_FAILURES = 3;

const KEEP_DAYS = Math.max(90, env.CLEANUP_DEFAULT_DAYS + 60);

export class SeenStore {
  private file: string;
  private map: Record<string, string>;

  constructor(source: string) {
    this.file = path.join(DATA_DIR, 'state', `seen-${source}.json`);
    try {
      this.map = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.map = {};
    }
  }

  has(id: string): boolean {
    const v = this.map[id];
    if (v === undefined) return false;
    const n = this.failures(id);
    return n === 0 || n >= MAX_FAILURES;
  }

  /** число неудачных попыток построить запись (0 — не было или вакансия уже обработана) */
  failures(id: string): number {
    const m = / err(\d+)$/.exec(this.map[id] ?? '');
    return m ? Number(m[1]) : 0;
  }

  /** ещё одна неудачная попытка; возвращает их число */
  addFailure(id: string): number {
    const v = this.map[id];
    if (v !== undefined && this.failures(id) === 0 && !v.endsWith(' pf')) return 0; // уже обработана — не портим запись
    const n = this.failures(id) + 1;
    this.map[id] = `${today()} err${n}`;
    return n;
  }

  /** отсеяна предфильтром (а не сохранена/дубль/удалена) */
  isPrefiltered(id: string): boolean {
    return this.map[id]?.endsWith(' pf') ?? false;
  }

  add(id: string, prefiltered = false): void {
    this.map[id] = prefiltered ? `${today()} pf` : today();
  }

  /** id всех записей (для миграций) */
  ids(): string[] {
    return Object.keys(this.map);
  }

  save(): void {
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86400e3).toISOString().slice(0, 10);
    for (const [k, d] of Object.entries(this.map)) if (d.slice(0, 10) < cutoff) delete this.map[k];
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.map, null, 1));
  }
}
