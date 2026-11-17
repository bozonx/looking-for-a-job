import { z } from 'zod';
import { CHANNEL_BY, CHANNEL_TYPES } from './channels.ts';

const score = z.number().min(0).max(100);
const nscore = score.nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

/** Группы работодателя из config/regions.yaml; поле region вычисляет score.ts. */
export const REGIONS = ['argentina', 'ru_speaking_team', 'ru_speaking', 'anglo', 'spanish', 'europe', 'uae', 'asia', 'other', 'unknown'] as const;
export const TRACKS = ['vue', 'react', 'angular', 'fullstack', 'ai_engineer', 'automation'] as const;
/** Решение по вакансии. Нет статуса (null) — решения нет: такие вакансии со временем удаляет cleanup. */
export const STATUSES = ['selected', 'needs_attention', 'applied', 'apply_failed'] as const;
export const STOP_FLAGS = ['office_outside_ar', 'location_restricted', 'nationality_excluded', 'ru_corporate', 'inadequate', 'scam'] as const;

export const ScoresSchema = z.object({
  remote: score,
  startup: score,
  corporate: score,
  outsource: score,
  end_client_corporate: nscore,
  legitimacy: score,
  region: nscore.optional(), // считает score.ts из regions.yaml по company_country / ru_speaking_team
  language: score,
  // automation добавлен позже: в старых вакансиях ключа нет — допускаем отсутствие
  fit: z.object(Object.fromEntries(TRACKS.map((t) => [t, t === 'automation' ? nscore.optional() : score])) as Record<(typeof TRACKS)[number], typeof score>),
  overall: nscore.optional(),
});

/** Сравнение вакансии с резюме best_resume (scoring_version ≥ 2). Навыки — канонические имена из config/skills.yaml. */
export const ResumeMatchSchema = z.object({
  resume: z.enum(TRACKS),
  required: z.array(z.string()).default([]),
  nice_to_have: z.array(z.string()).default([]),
  missing_required: z.array(z.string()).default([]),
  missing_nice: z.array(z.string()).default([]),
  in_resume_negative: z.array(z.object({ skill: z.string(), evidence: z.string().min(1) })).default([]),
  ats_keywords_missing: z.array(z.string()).default([]),
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
  employment: z.enum(['full-time', 'contract', 'b2b', 'eor', 'unknown']).default('unknown'),
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
  attention_reason: z.enum(['unknown_question', 'special_media', 'captcha', 'login', 'ambiguous', 'other']).nullable().optional(),
  attention_details: z.string().nullable().optional(),
  starred: z.boolean().default(false),
  flagged: z.boolean().default(false), // ⚑ «проблемная»: пользователь считает скоринг/данные неверными; агент разбирает и снимает (playbooks/flagged.md)
  notes: z.string().default(''),
  possibly_closed: z.boolean().default(false), // нет в снимке ATS (collect) или real_url отвечает «нет вакансии» (check-alive)
  alive_checked_at: date.nullable().optional(), // когда npm run check-alive последний раз проверял real_url
  applied_at: z.string().nullable().optional(),
  apply_log: z.string().nullable().optional(),
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
});

export type Vacancy = z.infer<typeof VacancySchema>;
export type ResumeMatch = z.infer<typeof ResumeMatchSchema>;
export type Scores = z.infer<typeof ScoresSchema>;
