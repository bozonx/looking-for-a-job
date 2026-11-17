export const STATUS_LABEL: Record<string, string> = {
  selected: 'выбрана',
  needs_attention: 'внимание',
  applied: 'отклик',
  apply_failed: 'ошибка',
};
export const ATTENTION_LABEL: Record<string, string> = {
  unknown_question: 'неизвестный вопрос',
  special_media: 'особое медиа',
  captcha: 'капча',
  login: 'логин',
  ambiguous: 'неоднозначно',
  other: 'другое',
};
export const TRACKS = ['vue', 'react', 'angular', 'fullstack', 'ai_engineer', 'automation'] as const;
export const REGIONS = ['argentina', 'cyprus', 'cis', 'europe', 'asia', 'other', 'global'] as const;

/** Badge tone for a 0–100 score; `inverse` = high is bad. */
export function tone(v: unknown, inverse = false): string {
  if (typeof v !== 'number') return 'muted';
  const x = inverse ? 100 - v : v;
  return x >= 70 ? 'good' : x >= 40 ? 'mid' : 'bad';
}

export function fmtSalary(s: any): string {
  if (!s) return '';
  const k = (n: number | null) => (n == null ? '?' : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const per = { year: '/год', month: '/мес', hour: '/ч' }[s.period as string] ?? '';
  return `${k(s.min)}–${k(s.max)} ${s.currency}${per}`;
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
