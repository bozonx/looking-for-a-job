/**
 * Каналы отклика (apply_channels): куда физически слать резюме — ATS, форма на сайте, email, Telegram,
 * WhatsApp, Facebook, LinkedIn, личное сообщение, отклик на самой площадке.
 * Источник истины — apply_channels в front matter; apply_method и apply_target вычисляются из них (rescore / npm run channels).
 *
 * Извлечение из текста — консервативное: адрес берётся, только если рядом слова про отклик
 * (apply, resume, CV, send, присылайте…), служебные адреса (accommodations@, benefits@, «письма придут с @…») отбрасываются.
 */
import { applyMethodFromUrl, boardFromUrl } from './target.ts';

export const CHANNEL_TYPES = ['ats', 'form', 'email', 'telegram', 'whatsapp', 'facebook', 'linkedin', 'platform', 'dm', 'other'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];
export const CHANNEL_BY = ['collect', 'resolve', 'text', 'agent'] as const;

export interface Channel {
  type: ChannelType;
  /** URL, email, @handle или телефон — то, куда писать */
  value: string;
  /** кто нашёл: collect (API площадки), resolve (страница площадки), text (извлечено из текста), agent */
  by?: (typeof CHANNEL_BY)[number];
  /** требования к отклику: тема письма, кодовое слово, что приложить */
  note?: string | null;
}

/** Площадки, где откликаются на самой площадке (нужен аккаунт). Остальные агрегаторы — только витрина. */
export const PLATFORM_APPLY = new Set(['hh', 'habr', 'djinni', 'getonbrd', 'getmatch', 'geekjob', 'wellfound', 'bumeran', 'zonajobs', 'computrabajo', 'landingjobs', 'yc']);

/** Канал по ссылке. Агрегатор-витрина (remoteok, vuejobs…) — null: туда не откликаются. */
export function channelFromUrl(url: string | null | undefined, by?: Channel['by']): Channel | null {
  if (!url) return null;
  const u = url.trim();
  if (/^mailto:/i.test(u)) {
    const addr = decodeURIComponent(u.slice(7).split('?')[0]!).trim().toLowerCase();
    if (!EMAIL_RE_FULL.test(addr)) return null;
    const subj = /[?&]subject=([^&]+)/i.exec(u)?.[1];
    return { type: 'email', value: addr, by, ...(subj ? { note: `тема: ${decodeURIComponent(subj.replace(/\+/g, ' '))}` } : {}) };
  }
  if (/^tg:|^https?:\/\/(www\.)?(t\.me|telegram\.me)\//i.test(u)) {
    const h = /(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{4,})/i.exec(u)?.[1] ?? /domain=([A-Za-z0-9_]+)/.exec(u)?.[1];
    return h && !/^(joinchat|share|s|c|addstickers)$/i.test(h) ? { type: 'telegram', value: `@${h}`, by } : null;
  }
  if (/^https?:\/\/(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\//i.test(u)) return { type: 'whatsapp', value: u, by };
  if (/^https?:\/\/([a-z]+\.)?(facebook\.com|fb\.com|fb\.me|m\.me)\//i.test(u)) return { type: 'facebook', value: u, by };
  if (!/^https?:/i.test(u)) return null;
  const board = boardFromUrl(u);
  if (board === 'linkedin') return { type: 'linkedin', value: u, by };
  if (board) return PLATFORM_APPLY.has(board) ? { type: 'platform', value: u, by } : null;
  return { type: applyMethodFromUrl(u).startsWith('ats-') ? 'ats' : 'form', value: u, by };
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EMAIL_RE_FULL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
/** слова, означающие «шлите сюда отклик» */
const APPLY_CTX =
  /\b(apply|applications?|resume|résumé|cv|send|submit|email (us|me)|e-mail (us|me)|reach out|write (to )?(us|me)|contact|interested|candidates?|portfolio|dm|message)\b|присыла|пришлит|отправ|резюме|пишите|напишите|откли|связ|писать|cv|enví|envia|postul|curr[ií]cul/i;
/** контекст служебного адреса — не для отклика */
const NOISE_CTX =
  /accommodat|disabilit|reasonable adjust|adjustments?|fraud|scam|phish|impersonat|suspicious|claiming to be|outreach|verify|(sent|come) from|ending in|domains?\b|privacy|gdpr|data protection|benefits|unsubscribe|equal (employment )?opportunit|\beeo\b|accessib|technical support|do business|agenc(y|ies)|third[- ]party|vendors?\b|partnerships?|ethics|validity|further information|questions?\b|vragen|fragen|preguntas|dúvidas|вопрос/i;
const NOISE_LOCAL = /^(no-?reply|donotreply|privacy|security|legal|accommodations?|benefits|accessib|dpo|gdpr|abuse|press|media|billing|support|sales|x+|name|your?|first\.?last)@/i;
/** ближний контекст для «это про отклик», дальний — для «это служебный адрес» */
const near = (t: string, i: number, n: number) => ctx(t, i, n, 140, 60);
const far = (t: string, i: number, n: number) => ctx(t, i, n, 260, 80);
/** «with the subject “…”», «тема: …» после адреса */
const subjectNote = (t: string, i: number, n: number) => {
  const m = /(?:subject(?: line)?|тем[аеой])\s*[:\-–]?\s*(?:of\s+)?["“'«]([^"”'»\n]{3,100})["”'»]/i.exec(t.slice(i + n, i + n + 200));
  return m ? `тема: ${m[1]!.trim()}` : undefined;
};

const clean = (s: string) => s.replace(/[\\*_`[\]()<>]/g, ' ');

function ctx(text: string, i: number, len: number, before = 140, after = 60) {
  return text.slice(Math.max(0, i - before), i + len + after);
}

/** Каналы из текста вакансии (markdown/plain). */
export function extractChannels(text: string): Channel[] {
  const out: Channel[] = [];
  if (!text) return out;
  // ссылки: mailto, t.me, wa.me, facebook/m.me — mailto берём всегда (кроме шумного контекста), соцсети — только в контексте отклика
  for (const m of text.matchAll(/(mailto:[^\s)\]>"']+|(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|wa\.me|api\.whatsapp\.com|m\.me|(?:[a-z]+\.)?facebook\.com|fb\.com)\/[^\s)\]>"']+)/gi)) {
    const raw = m[0].replace(/[.,;:!?]+$/, '');
    const c = channelFromUrl(/^(mailto:|https?:)/i.test(raw) ? raw : `https://${raw}`, 'text');
    if (!c) continue;
    if (NOISE_CTX.test(clean(far(text, m.index!, raw.length)))) continue;
    if (c.type === 'email' && NOISE_LOCAL.test(c.value)) continue;
    if (!APPLY_CTX.test(clean(near(text, m.index!, raw.length)))) continue;
    if (c.type === 'email' && !c.note) {
      const note = subjectNote(text, m.index!, raw.length);
      if (note) c.note = note;
    }
    if (c.type === 'facebook' && /facebook\.com\/(sharer|share|tr|plugins|dialog)/i.test(c.value)) continue;
    out.push(c);
  }
  // голые email-адреса
  for (const m of text.matchAll(EMAIL_RE)) {
    const addr = m[0].toLowerCase().replace(/\.$/, '').replace(/^[_.+-]+/, '');
    if (NOISE_LOCAL.test(addr) || /\.(png|jpe?g|gif|svg|webp)$/.test(addr) || /@(example|domain|email)\./.test(addr)) continue;
    if (NOISE_CTX.test(clean(far(text, m.index!, m[0].length))) || !APPLY_CTX.test(clean(near(text, m.index!, m[0].length)))) continue;
    const note = subjectNote(text, m.index!, m[0].length);
    out.push({ type: 'email', value: addr, by: 'text', ...(note ? { note } : {}) });
  }
  // Telegram: «Telegram: @handle», «тг @handle», «пишите в телеграм @handle»
  for (const m of text.matchAll(/(telegram|телеграм\w*|телеграмм\w*|\btg\b|\bтг\b)[^@\n]{0,40}@([A-Za-z][A-Za-z0-9_]{3,31})\b/gi)) {
    out.push({ type: 'telegram', value: `@${m[2]}`, by: 'text' });
  }
  // WhatsApp по номеру: «WhatsApp: +54 9 11 …»
  for (const m of text.matchAll(/whats\s?app[^+\d\n]{0,20}(\+?\d[\d\s()-]{7,18}\d)/gi)) {
    out.push({ type: 'whatsapp', value: m[1]!.replace(/[^\d+]/g, ''), by: 'text' });
  }
  // «DM me on X/Twitter/LinkedIn [@handle]», «message me on LinkedIn»
  for (const m of text.matchAll(/\b(?:dm|message|ping) (?:me|us)\b[^.\n]{0,30}?\b(x|twitter|linkedin|facebook|instagram|discord|slack)\b[^.\n]{0,20}?(@[A-Za-z0-9_]{2,}|https?:\/\/\S+)?/gi)) {
    const net = m[1]!.toLowerCase();
    const handle = m[2]?.replace(/\\/g, '');
    if (net === 'facebook' && handle?.startsWith('http')) out.push({ type: 'facebook', value: handle, by: 'text' });
    else out.push({ type: 'dm', value: `${net === 'twitter' ? 'x' : net}${handle ? ` ${handle}` : ''}`, by: 'text', note: m[0].trim().slice(0, 120) });
  }
  return mergeChannels([], out);
}

const key = (c: Channel) => `${c.type}|${c.value.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[/?#]+$/, '')}`;

/** Слить каналы без дублей; у существующих приоритет (их мог поправить агент). */
export function mergeChannels(base: Channel[] | null | undefined, add: (Channel | null | undefined)[]): Channel[] {
  const out = [...(base ?? [])];
  const seen = new Set(out.map(key));
  for (const c of add) {
    if (!c || !c.value) continue;
    const k = key(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) as Channel);
  }
  return out;
}

/** Значение apply_target для канала (сравнивается с config/apply-priority.yaml). */
export function channelTarget(c: Channel): string {
  switch (c.type) {
    case 'ats':
      return applyMethodFromUrl(c.value);
    case 'form':
      return 'company-site';
    case 'platform':
      return boardFromUrl(c.value) ?? 'platform';
    default:
      return c.type; // email, telegram, whatsapp, facebook, linkedin, dm, other
  }
}

/** apply_method для канала. */
export function channelMethod(c: Channel): string {
  if (c.type === 'ats') return applyMethodFromUrl(c.value);
  if (c.type === 'form') return 'external';
  return c.type;
}

/** Ссылка, по которой можно открыть канал (для UI и apply-set). */
export function channelHref(c: Channel): string | null {
  if (c.type === 'email') return `mailto:${c.value}`;
  if (c.type === 'telegram') return `https://t.me/${c.value.replace(/^@/, '')}`;
  if (c.type === 'whatsapp' && /^\+?\d+$/.test(c.value)) return `https://wa.me/${c.value.replace(/^\+/, '')}`;
  return /^https?:/.test(c.value) ? c.value : null;
}

/**
 * Каналы, которые можно получить без агента: real_url, площадка-источник с откликом на месте, дубли с таких площадок,
 * строка «Apply: …» в теле (её пишет сбор), текст вакансии.
 */
export function baseChannels(d: Record<string, any>, body: string): Channel[] {
  const apply = /^Source: .*· Apply: (\S+)/m.exec(body)?.[1];
  return mergeChannels(d.apply_channels, [
    channelFromUrl(d.real_url, 'collect'),
    channelFromUrl(apply, 'collect'),
    channelFromUrl(d.source_url, 'collect'),
    ...((d.duplicates ?? []) as { url: string }[]).map((x) => channelFromUrl(x.url, 'collect')),
    ...extractChannels(body),
  ]);
}
