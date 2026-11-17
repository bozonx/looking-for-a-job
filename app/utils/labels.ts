import {
  OUTCOMES, type Outcome,
  ATTENTION_REASONS, EMPLOYMENT, REGIONS, STATUSES, STOP_FLAGS, TRACKS,
  type AttentionReason, type Employment, type Region, type Status, type StopFlag,
} from '../../scripts/lib/enums.ts';

/** Перечисления — из схемы (scripts/lib/enums.ts), чтобы фильтры не расходились с данными. */
export { OUTCOMES, ATTENTION_REASONS, EMPLOYMENT, REGIONS, STATUSES, STOP_FLAGS, TRACKS };

export const STATUS_LABEL: Record<Status, string> = {
  selected: 'выбрана',
  needs_attention: 'внимание',
  applied: 'отклик',
  apply_failed: 'ошибка',
};
export const OUTCOME_LABEL: Record<Outcome, string> = {
  no_reply: 'нет ответа',
  rejected: 'отказ',
  screen: 'скрининг',
  interview: 'собеседование',
  offer: 'оффер',
};
export const ATTENTION_LABEL: Record<AttentionReason, string> = {
  unknown_question: 'неизвестный вопрос',
  special_media: 'особое медиа',
  captcha: 'капча',
  login: 'логин',
  ambiguous: 'неоднозначно',
  other: 'другое',
};
export const REGION_LABEL: Record<Region, string> = {
  argentina: 'Аргентина',
  ru_speaking_team: 'русскоязычная команда',
  ru_speaking: 'русскоязычная страна',
  anglo: 'англоязычные',
  spanish: 'испаноязычные',
  europe: 'Европа',
  uae: 'ОАЭ',
  asia: 'Азия',
  other: 'другое',
  unknown: 'неизвестно',
};
export const STOP_FLAG_LABEL: Record<StopFlag, string> = {
  office_outside_ar: 'офис вне AR',
  location_restricted: 'ограничение по локации',
  nationality_excluded: 'гражданство',
  ru_corporate: 'RU-корпорация',
  inadequate: 'неадекватная',
  scam: 'скам',
};
export const EMPLOYMENT_LABEL: Record<Employment, string> = {
  'full-time': 'full-time',
  contract: 'контракт',
  b2b: 'B2B',
  eor: 'EOR',
  unknown: 'не указано',
};

/** Подпись значения перечисления с запасным вариантом. */
export const labelOf = (map: Record<string, string>, v: unknown, empty = '—'): string =>
  v == null || v === '' ? empty : (map[String(v)] ?? String(v));

/** Badge tone for a 0–100 score; `inverse` = high is bad. */
export function tone(v: unknown, inverse = false): string {
  if (typeof v !== 'number') return 'muted';
  const x = inverse ? 100 - v : v;
  return x >= 70 ? 'good' : x >= 40 ? 'mid' : 'bad';
}

export function fmtSalary(s: any): string {
  if (!s) return '';
  const k = (n: number | null) => {
    if (n == null) return '?';
    if (n >= 1000) {
      const inK = n / 1000;
      return Number.isInteger(inK) ? `${inK}k` : `${inK.toFixed(1).replace(/\.0$/, '')}k`;
    }
    return String(n);
  };
  const per = { year: '/год', month: '/мес', hour: '/ч' }[s.period as string] ?? '';
  const cur = s.currency ? ` ${s.currency}` : '';

  if (s.min != null && s.max != null) {
    if (s.min === s.max) return `${k(s.min)}${cur}${per}`;
    return `${k(s.min)}–${k(s.max)}${cur}${per}`;
  }
  if (s.min != null && s.max == null) {
    return `от ${k(s.min)}${cur}${per}`;
  }
  if (s.min == null && s.max != null) {
    return `до ${k(s.max)}${cur}${per}`;
  }
  return `?${cur}${per}`;
}

export function fmtSalaryUsdMonth(s: { min: number | null; max: number | null } | null | undefined): string {
  if (!s || (s.min == null && s.max == null)) return '';
  const num = (n: number | null) => (n == null ? '?' : `$${n.toLocaleString('en-US')}`);
  if (s.min != null && s.max != null) {
    if (s.min === s.max) return num(s.min);
    return `${num(s.min)}–${num(s.max)}`;
  }
  if (s.min != null) return `от ${num(s.min)}`;
  return `до ${num(s.max)}`;
}

/** Канал отклика (apply_channels[].type / apply_method): иконка и подпись. */
export const CHANNEL_LABEL: Record<string, { icon: string; label: string }> = {
  ats: { icon: '📝', label: 'ATS-форма' },
  form: { icon: '🌐', label: 'форма на сайте' },
  email: { icon: '✉️', label: 'email' },
  telegram: { icon: '✈️', label: 'Telegram' },
  whatsapp: { icon: '💬', label: 'WhatsApp' },
  facebook: { icon: '📘', label: 'Facebook' },
  linkedin: { icon: '🔗', label: 'LinkedIn' },
  platform: { icon: '🏢', label: 'на площадке (аккаунт)' },
  dm: { icon: '📨', label: 'личное сообщение' },
  other: { icon: '•', label: 'другое' },
  unknown: { icon: '❓', label: 'неизвестно' },
};

/** apply_method → тип канала (ats-greenhouse → ats, external → form). */
export function channelKind(method: string | null | undefined): string {
  if (!method || method === 'unknown') return 'unknown';
  if (method.startsWith('ats-')) return 'ats';
  if (method === 'external') return 'form';
  if (method === 'easy-apply') return 'linkedin';
  if (method === 'comment') return 'dm';
  return CHANNEL_LABEL[method] ? method : 'other';
}

/** Ссылка для открытия канала. */
export function channelHref(c: { type: string; value: string }): string | null {
  if (c.type === 'email') return `mailto:${c.value}`;
  if (c.type === 'telegram') return `https://t.me/${c.value.replace(/^@/, '')}`;
  if (c.type === 'whatsapp' && /^\+?\d+$/.test(c.value)) return `https://wa.me/${c.value.replace(/^\+/, '')}`;
  return /^https?:/.test(c.value) ? c.value : null;
}

/** Есть ли в заметках текст пользователя — такие вакансии чистка не удаляет. */
export { hasUserNotes } from '../../scripts/lib/uipatch.ts';

/** Опции мультиселекта из словаря подписей (с необязательным «не задано» в начале). */
export function optionsOf(map: Record<string, string>, none?: string): { value: string; label: string }[] {
  return [...(none ? [{ value: 'none', label: none }] : []), ...Object.entries(map).map(([value, label]) => ({ value, label }))];
}

export const EVERGREEN_DAYS = 60;

/** Возраст публикации в днях (null, если posted_at отсутствует или невалидна). */
export function postedAgeDays(postedAt: unknown, now = Date.now()): number | null {
  if (!postedAt) return null;
  const ms = Date.parse(String(postedAt));
  if (!Number.isFinite(ms)) return null;
  return Math.floor((now - ms) / 86_400_000);
}

export function isEvergreen(postedAt: unknown, now = Date.now()): boolean {
  const age = postedAgeDays(postedAt, now);
  return age !== null && age >= EVERGREEN_DAYS;
}
