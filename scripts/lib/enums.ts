/**
 * Перечисления схемы вакансии без зависимостей — их импортируют и скрипты (schema.ts), и UI (app/).
 * Менять только здесь: фильтры и подписи UI берут значения отсюда.
 */

/** Группы работодателя из config/regions.yaml; поле region вычисляет score.ts. */
export const REGIONS = ['argentina', 'ru_speaking_team', 'ru_speaking', 'anglo', 'spanish', 'europe', 'uae', 'asia', 'other', 'unknown'] as const;
export const TRACKS = ['vue', 'react', 'angular', 'fullstack', 'ai_engineer', 'automation'] as const;
/** Решение по вакансии. Нет статуса (null) — решения нет: такие вакансии со временем удаляет cleanup. */
export const STATUSES = ['selected', 'needs_attention', 'applied', 'apply_failed'] as const;
export const STOP_FLAGS = ['office_outside_ar', 'location_restricted', 'nationality_excluded', 'ru_corporate', 'inadequate', 'scam'] as const;
export const EMPLOYMENT = ['full-time', 'contract', 'b2b', 'eor', 'unknown'] as const;
/** Результат отклика (status: applied): что ответил работодатель. null — ещё ждём. Ставит пользователь в UI. */
export const OUTCOMES = ['no_reply', 'rejected', 'screen', 'interview', 'offer'] as const;
export const ATTENTION_REASONS = ['unknown_question', 'special_media', 'captcha', 'login', 'ambiguous', 'other'] as const;

export type Region = (typeof REGIONS)[number];
export type Track = (typeof TRACKS)[number];
export type Status = (typeof STATUSES)[number];
export type StopFlag = (typeof STOP_FLAGS)[number];
export type Employment = (typeof EMPLOYMENT)[number];
export type Outcome = (typeof OUTCOMES)[number];
export type AttentionReason = (typeof ATTENTION_REASONS)[number];
