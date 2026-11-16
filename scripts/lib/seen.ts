/**
 * Id всех обработанных вакансий источника (сохранённых, отсеянных предфильтром, дублей):
 * data/state/seen-<source>.json. Нужны, чтобы при повторном сборе они считались «известными»
 * (COLLECT_STOP_ON_SEEN) — в том числе после удаления файла (cleanup, ручное удаление дубля).
 * Значение — дата; у отсеянных предфильтром — «<дата> pf»: при следующем сборе их заново прогоняют через
 * предфильтр, и если он с тех пор расширился — вакансия собирается как новая.
 * Записи старше KEEP_DAYS удаляются при сохранении; KEEP_DAYS > CLEANUP_DEFAULT_DAYS с запасом.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, env, today } from './env.ts';

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
    return id in this.map;
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
