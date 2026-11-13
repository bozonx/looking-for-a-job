import { z } from 'zod';

const score = z.number().min(0).max(100);
const nscore = score.nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export const REGIONS = ['argentina', 'cyprus', 'cis', 'europe', 'asia', 'other', 'global'] as const;
export const TRACKS = ['vue', 'react', 'angular', 'fullstack', 'ai_engineer'] as const;
export const STATUSES = ['new', 'selected', 'rejected', 'needs_attention', 'applied', 'apply_failed'] as const;
export const STOP_FLAGS = ['office_outside_ar', 'ru_corporate', 'inadequate', 'scam'] as const;

export const ScoresSchema = z.object({
  remote: score,
  startup: score,
  corporate: score,
  outsource: score,
  end_client_corporate: nscore,
  legitimacy: score,
  region: score,
  language: score,
  fit: z.object(Object.fromEntries(TRACKS.map((t) => [t, score])) as Record<(typeof TRACKS)[number], typeof score>),
  overall: nscore.optional(),
});

export const VacancySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+-[A-Za-z0-9_-]+$/),
  title: z.string().min(1),
  company: z.string().min(1),
  company_country: z.string().nullable().optional(),
  source: z.string().min(1),
  source_url: z.string().url(),
  real_url: z.string().url().nullable().optional(),
  apply_method: z.string().regex(/^(easy-apply|ats-[a-z0-9-]+|email|comment|external|unknown)$/),
  duplicates: z.array(z.object({ source: z.string(), url: z.string().url(), seen_at: date.optional() })).default([]),
  apply_target: z.string().nullable().optional(),
  collected_at: date,
  posted_at: date.nullable().optional(),
  location: z.string().nullable().optional(),
  region: z.enum(REGIONS).nullable().optional(),
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

  requirements_special: z
    .array(z.object({ type: z.string(), standard: z.boolean(), details: z.string() }))
    .default([]),

  status: z.enum(STATUSES),
  attention_reason: z.enum(['unknown_question', 'special_media', 'captcha', 'login', 'ambiguous', 'other']).nullable().optional(),
  attention_details: z.string().nullable().optional(),
  starred: z.boolean().default(false),
  notes: z.string().default(''),
  possibly_closed: z.boolean().default(false),
  applied_at: z.string().nullable().optional(),
  apply_log: z.string().nullable().optional(),
  scoring_version: z.number().int().nullable().optional(),
});

/** Stricter check for scored vacancies: everything the agent must fill. */
export const ScoredVacancySchema = VacancySchema.extend({
  scores: ScoresSchema,
  region: z.enum(REGIONS),
  summary: z.string().min(1),
  best_resume: z.enum(TRACKS),
  score_reasoning: z.string().min(1),
  scoring_version: z.number().int(),
});

export type Vacancy = z.infer<typeof VacancySchema>;
export type Scores = z.infer<typeof ScoresSchema>;
