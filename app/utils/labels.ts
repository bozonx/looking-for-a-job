export const STATUS_LABEL: Record<string, string> = {
  new: 'новая',
  selected: 'выбрана',
  rejected: 'отклонена',
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
export const TRACKS = ['vue', 'react', 'angular', 'fullstack', 'ai_engineer'] as const;
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
