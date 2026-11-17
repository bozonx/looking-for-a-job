import { geoscreen, type GeoInput } from './geoscreen.ts';
/**
 * Общий построитель RawJob для провайдеров: провайдер нормализует поля площадки в JobFields,
 * а тело вакансии (заголовок, ссылка на источник, доп. поля, описание) собирается здесь единообразно.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { CONFIG_DIR } from './env.ts';
import { htmlToMarkdown } from './html.ts';
import { applyMethodFromUrl } from './target.ts';
import { safeExtId, type RawJob, type VacancyData } from './collect.ts';

export interface JobFields {
  geo?: GeoInput;
  extId: string | number;
  /** время публикации, мс; null — неизвестно */
  postedAt: number | null;
  title: string;
  company: string;
  tags?: string[];
  /** название площадки для строки «Source: [..](..)» */
  sourceName: string;
  sourceUrl: string;
  /** прямая ссылка на отклик (сайт компании / ATS); ссылки на саму площадку сюда не передавать */
  applyUrl?: string | null;
  location?: string | null;
  salary?: VacancyData['salary'];
  employment?: string | null;
  /** доп. строки в шапку тела: «- **Ключ:** значение» (пустые пропускаются) */
  extra?: Record<string, string | number | null | undefined>;
  /** описание: HTML (будет переведён в markdown) или готовый markdown */
  html?: string | null;
  markdown?: string | null;
  /** отсеять до предфильтра с этой причиной (см. RawJob.skip) */
  skip?: string | null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#039': "'", '#x27': "'", '#x2F': '/', '#x2f': '/' };

/** Расшифровка HTML-сущностей в коротком тексте (заголовок, компания). */
export function decodeEntities(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
      if (ENTITIES[e] !== undefined) return ENTITIES[e]!;
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Текст без HTML-тегов (одной строкой). */
export const stripTags = (html: string | null | undefined): string => decodeEntities((html ?? '').replace(/<[^>]+>/g, ' '));

/** Тип занятости площадки → значение схемы (part-time и неизвестное → unknown). */
export function normEmployment(s: string | string[] | null | undefined): string {
  const t = (Array.isArray(s) ? s.join(' ') : (s ?? '')).toLowerCase().replace(/[_\s]+/g, '-');
  if (/contract|freelance|temporary|temp\b/.test(t)) return 'contract';
  if (/full-?time|fulltime|permanent/.test(t)) return 'full-time';
  return 'unknown';
}

/** Дата (строка/секунды/мс) → мс; null — если не разобрать. */
export function toMs(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : null;
}

const isoDate = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : null);

export function makeJob(f: JobFields): RawJob {
  const title = decodeEntities(f.title);
  const company = decodeEntities(f.company) || 'Unknown';
  const tags = (f.tags ?? []).map((t) => decodeEntities(t)).filter(Boolean);
  return {
    extId: safeExtId(f.extId),
    postedAt: f.postedAt,
    title,
    company,
    tags,
    skip: f.skip ?? undefined,
    build() {
      const apply = f.applyUrl && /^(https?:|mailto:)/.test(f.applyUrl) ? f.applyUrl : null;
      const extra = Object.entries(f.extra ?? {})
        .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
        .map(([k, v]) => `- **${k}:** ${String(v).trim()}`);
      const desc = f.markdown ?? htmlToMarkdown(f.html ?? '');
      const body =
        `# ${title} — ${company}\n\n` +
        `Source: [${f.sourceName}](${f.sourceUrl})${apply ? ` · Apply: ${apply}` : ''}\n\n` +
        (extra.length ? `${extra.join('\n')}\n\n` : '') +
        desc +
        '\n';
      return {
        data: {
          ...geoscreen(f.geo ?? {}),
          source_url: f.sourceUrl,
          real_url: apply && /^https?:/.test(apply) ? apply : null,
          apply_method: applyMethodFromUrl(apply),
          posted_at: isoDate(f.postedAt),
          location: f.location ? decodeEntities(f.location) : null,
          salary: f.salary ?? null,
          employment: f.employment ?? 'unknown',
        },
        body,
      };
    },
  };
}

/** Секция config/sources.yaml (настройки провайдеров: ленты, компании ATS, запросы). */
export function sourceConfig<T>(section: string): T | undefined {
  const file = path.join(CONFIG_DIR, 'sources.yaml');
  if (!fs.existsSync(file)) return undefined;
  return (YAML.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>)?.[section] as T | undefined;
}
