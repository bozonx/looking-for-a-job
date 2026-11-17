import { z } from 'zod';
import { CHANNEL_BY, CHANNEL_TYPES } from './channels.ts';

const score = z.number().min(0).max(100);
const nscore = score.nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

import { ATTENTION_REASONS, EMPLOYMENT, REGIONS, STATUSES, STOP_FLAGS, TRACKS } from './enums.ts';

export { ATTENTION_REASONS, EMPLOYMENT, REGIONS, STATUSES, STOP_FLAGS, TRACKS };

export const ScoresSchema = z.object({
  remote: score,
  startup: score,
  corporate: score,
  outsource: score,
  end_client_corporate: nscore.optional(), // устарело (weights v3): не заполняется, в старых файлах остаётся
  legitimacy: score,
  region: nscore.optional(), // считает score.ts из regions.yaml по company_country / ru_speaking_team
  language: score,
  // automation добавлен позже: отсутствие допустимо только у вакансий со stop_flags (проверка в ScoredVacancySchema)
  fit: z.object(Object.fromEntries(TRACKS.map((t) => [t, t === 'automation' ? nscore.optional() : score])) as Record<(typeof TRACKS)[number], typeof score>),
  overall: nscore.optional(),
});

/** Сравнение вакансии с резюме best_resume (scoring_version ≥ 2). Навыки — канонические имена из config/skills.yaml. */
export const ResumeMatchSchema = z.object({
  resume: z.enum(TRACKS),
  required: z.array(z.string()).default([]),
  nice_to_have: z.array(z.string()).default([]),
  // устарело: пробелы считает npm run insights по текущему резюме; в старых вакансиях остаются, не заполнять
  missing_required: z.array(z.string()).optional(),
  missing_nice: z.array(z.string()).optional(),
  in_resume_negative: z.array(z.object({ skill: z.string(), evidence: z.string().min(1) })).default([]),
  ats_keywords_missing: z.array(z.string()).optional(), // устарело, не заполнять
  // scoring_version ≥ 3 — сырьё для блока опыта и формулировок резюме (см. playbooks/scoring.md)
  responsibilities: z.array(z.string()).default([]), // обязанности: короткие фразы «глагол + объект», en, нижний регистр
  keyword_spellings: z.record(z.string(), z.array(z.string())).default({}), // канонический навык → написания из текста, если отличаются
  domain: z.string().nullable().optional(), // предметная область продукта: fintech, e-commerce, healthtech, devtools…
  product_type: z.string().nullable().optional(), // b2b-saas, b2c, marketplace, internal-tools, agency, platform…
  soft_requirements: z.array(z.string()).default([]), // ownership, cross-functional, mentoring, async communication…
  years_required: z.number().nullable().optional(), // минимум лет опыта из текста; нет — null
});

export const VacancySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+-[A-Za-z0-9_-]+$/),
  title: z.string().min(1),
  company: z.string().min(1),
  company_country: z.string().regex(/^[A-Z]{2}$/, 'ISO 3166-1 alpha-2').nullable().optional(), // страна регистрации нанимающей стороны
  ru_speaking_team: z.boolean().nullable().optional(), // явно русскоязычная компания/команда
  source: z.string().min(1),
  source_url: z.string().url(),
  real_url: z.string().url().nullable().optional(),
  real_url_tried_at: date.nullable().optional(), // когда npm run resolve-urls искал real_url на странице источника
  apply_method: z.string().regex(/^(easy-apply|ats-[a-z0-9-]+|email|telegram|whatsapp|facebook|linkedin|platform|dm|other|comment|external|unknown)$/),
  // все известные способы отклика; apply_method/apply_target вычисляются из них (scripts/lib/channels.ts)
  apply_channels: z
    .array(z.object({ type: z.enum(CHANNEL_TYPES), value: z.string().min(1), by: z.enum(CHANNEL_BY).optional(), note: z.string().nullable().optional() }))
    .optional(),
  duplicates: z.array(z.object({ source: z.string(), url: z.string().url(), seen_at: date.optional(), id: z.string().optional() })).default([]),
  apply_target: z.string().nullable().optional(),
  collected_at: date,
  collected_run: z.string().nullable().optional(), // ISO-время старта `npm run collect`, который её собрал (бейдж «новая» в UI)
  posted_at: date.nullable().optional(),
  location: z.string().nullable().optional(),
  region: z.enum(REGIONS).nullable().optional(), // вычисляет score.ts из company_country / ru_speaking_team
  salary: z
    .object({ min: z.number().nullable(), max: z.number().nullable(), currency: z.string(), period: z.enum(['year', 'month', 'hour']) })
    .nullable()
    .optional(),
  employment: z.enum(EMPLOYMENT).default('unknown'),
  vacancy_language: z.string().nullable().optional(),
  work_languages: z.array(z.string()).nullable().optional(),
  role_tracks: z.array(z.enum(TRACKS)).default([]),
  tags: z.array(z.string()).optional(),

  summary: z.string().nullable().optional(),
  key_points: z.array(z.string()).nullable().optional(),
  red_flags: z.array(z.string()).nullable().optional(),

  scores: ScoresSchema.nullable(),
  stop_flags: z.array(z.enum(STOP_FLAGS)).default([]),
  best_resume: z.enum(TRACKS).nullable().optional(),
  score_reasoning: z.string().nullable().optional(),
  resume_match: ResumeMatchSchema.nullable().optional(),

  requirements_special: z
    .array(z.object({ type: z.string(), standard: z.boolean(), details: z.string() }))
    .default([]),

  status: z.enum(STATUSES).nullable().default(null),
  attention_reason: z.enum(ATTENTION_REASONS).nullable().optional(),
  attention_details: z.string().nullable().optional(),
  starred: z.boolean().default(false),
  flagged: z.boolean().default(false), // ⚑ «проблемная»: пользователь считает скоринг/данные неверными; агент разбирает и снимает (playbooks/flagged.md)
  notes: z.string().default(''),
  possibly_closed: z.boolean().default(false), // нет в снимке ATS (collect) или real_url отвечает «нет вакансии» (check-alive)
  alive_checked_at: date.nullable().optional(), // когда npm run check-alive последний раз проверял real_url
  applied_at: z.string().nullable().optional(),
  apply_log: z.string().nullable().optional(),
  applied_via: z.enum(['agent', 'manual']).nullable().optional(), // manual — пользователь откликнулся сам и отметил в UI
  scoring_version: z.number().int().nullable().optional(),
});

/** Stricter check for scored vacancies: everything the agent must fill. */
export const ScoredVacancySchema = VacancySchema.extend({
  scores: ScoresSchema,
  region: z.enum(REGIONS),
  company_country: z.string().regex(/^[A-Z]{2}$/).nullable(), // агент обязан решить: код или явный null
  summary: z.string().min(1),
  best_resume: z.enum(TRACKS),
  score_reasoning: z.string().min(1),
  scoring_version: z.number().int(),
}).superRefine((d, ctx) => {
  // без стоп-флага все шесть треков обязательны: пропуск automation занижал fit автоматизационных ролей
  if (!d.stop_flags.length && typeof d.scores.fit.automation !== 'number')
    ctx.addIssue({ code: 'custom', path: ['scores', 'fit', 'automation'], message: 'обязателен у вакансий без stop_flags' });
});

export type Vacancy = z.infer<typeof VacancySchema>;
export type ResumeMatch = z.infer<typeof ResumeMatchSchema>;
export type Scores = z.infer<typeof ScoresSchema>;
