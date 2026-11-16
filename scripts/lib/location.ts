/**
 * Эвристики по локации без LLM:
 * - isLocationSegment — часть заголовка вида «(Poland)», «| UK | Remote», «- USA»: для ключа дедупликации;
 * - regionUnlikely — поле `location` явно указывает на страны/офис вне Аргентины и LATAM:
 *   такие вакансии `npm run pending` ставит в конец очереди (не удаляет, не помечает).
 * Консервативно: сомнительное (просто «Remote», пусто, кириллица, LATAM, Европа+anywhere) — не «unlikely».
 */

/** Страны/города/штаты вне Аргентины и Латинской Америки (по ним обычно стоп-флаг location_restricted/office_outside_ar). */
const FOREIGN = [
  'united states', 'usa', 'us', 'u\\.s\\.?', 'us-based', 'america', 'north america', 'any state', 'canada',
  'united kingdom', 'uk', 'england', 'scotland', 'great britain', 'ireland', 'republic of ireland',
  'germany', 'france', 'spain', 'portugal', 'italy', 'netherlands', 'belgium', 'luxembourg', 'poland', 'serbia',
  'sweden', 'denmark', 'norway', 'finland', 'switzerland', 'austria', 'czechia', 'czech republic', 'romania',
  'bulgaria', 'greece', 'hungary', 'croatia', 'estonia', 'latvia', 'lithuania', 'ukraine', 'turkey', 'cyprus',
  'india', 'pakistan', 'bangladesh', 'philippines', 'china', 'hong kong', 'singapore', 'taiwan', 'japan', 'korea',
  'south korea', 'vietnam', 'indonesia', 'malaysia', 'thailand', 'australia', 'new zealand', 'egypt', 'nigeria',
  'kenya', 'south africa', 'morocco', 'israel', 'uae', 'dubai', 'saudi arabia', 'qatar',
  'san francisco', 'bay area', 'new york', 'nyc', 'seattle', 'austin', 'boston', 'chicago', 'los angeles',
  'palo alto', 'foster city', 'mountain view', 'menlo park', 'toronto', 'vancouver', 'montreal', 'london',
  'berlin', 'munich', 'paris', 'amsterdam', 'dublin', 'warsaw', 'krakow', 'lisbon', 'madrid', 'barcelona',
  'stockholm', 'copenhagen', 'oslo', 'helsinki', 'zurich', 'geneva', 'vienna', 'prague', 'sofia', 'bucharest',
  'bangalore', 'bengaluru', 'hyderabad', 'pune', 'mumbai', 'delhi', 'gurgaon', 'noida', 'chennai', 'tokyo',
  'sydney', 'melbourne', 'tel aviv', 'cairo', 'lagos', 'nairobi', 'rabat', 'casablanca',
];
/** Аргентина, LATAM и «откуда угодно» — при их наличии вакансия не «unlikely». */
const ALLOWED = [
  'argentina', 'buenos aires', 'caba', 'capital federal', 'la plata', 'mar del plata', 'amba',
  'latam', 'latin america', 'latinoamerica', 'latinoamérica', 'south america', 'americas', 'lat am',
  'anywhere', 'worldwide', 'global', 'globally', 'international', 'remote first', 'any country', 'world',
];
/** Прочие географические/форматные слова: годятся для «сегмента-локации» в заголовке, но не решают ничего сами. */
const NEUTRAL = [
  'remote', 'fully remote', 'hybrid', 'onsite', 'on-site', 'in office', 'office', 'europe', 'eu', 'emea', 'apac',
  'amer', 'east coast', 'west coast', 'us east coast', 'us west coast', 'western europe', 'eastern europe',
  'brazil', 'brasil', 'mexico', 'méxico', 'colombia', 'chile', 'peru', 'perú', 'uruguay', 'paraguay', 'bolivia',
  'ecuador', 'venezuela', 'costa rica', 'guatemala', 'panama', 'dominican republic', 'only', 'based', 'remoto',
  'remota', 'presencial', 'híbrido', 'hibrido', 'timezone', 'tz', 'est', 'pst', 'cet', 'utc',
];
/** Двухбуквенные коды стран LATAM (формат «City, Region, XX» у vuejobs и др.) */
const LATAM_CODES = new Set(['AR', 'BR', 'MX', 'CO', 'CL', 'PE', 'UY', 'PY', 'BO', 'EC', 'VE', 'CR', 'GT', 'PA', 'DO', 'SV', 'HN', 'NI', 'CU']);
const US_STATES = new Set(
  'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '),
);

const alt = (xs: string[]) => xs.map((x) => (/\\/.test(x) ? x : x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('|');
const word = (xs: string[]) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt(xs)})(?![\\p{L}\\p{N}])`, 'iu');
const wordG = (xs: string[]) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt(xs)})(?![\\p{L}\\p{N}])`, 'giu');

const FOREIGN_RE = word(FOREIGN);
const ALLOWED_RE = word(ALLOWED);
const ANY_PLACE_G = wordG([...FOREIGN, ...ALLOWED, ...NEUTRAL].sort((a, b) => b.length - a.length));
const OFFICE_RE = /(?<![\p{L}])(onsite|on-site|in office|hybrid)(?![\p{L}])/iu;
const REMOTE_RE = /remote|remoto|remota|удал[её]н/iu;

/** Сегмент заголовка («Poland», «Remote, Canada», «UK | Remote», «US East Coast») состоит только из гео/формат-слов. */
export function isLocationSegment(seg: string): boolean {
  const s = seg.trim();
  if (!s || !ANY_PLACE_G.test(s)) return false;
  ANY_PLACE_G.lastIndex = 0;
  return s.replace(ANY_PLACE_G, '').replace(/[\s,/&+;:|.\-–—]+|\band\b|\bor\b/giu, '') === '';
}

/** Убрать из заголовка сегменты-локации: в скобках и через разделители « | », « - », « – », « — », « / », «, ». */
export function stripLocationSegments(title: string): string {
  let t = title.replace(/[([]([^)\]]*)[)\]]/g, (m, inner: string) => (isLocationSegment(inner) ? ' ' : m));
  const parts = t.split(/(\s+[|–—-]\s+|\s*,\s*|\s+\/\s+)/);
  // parts: [seg, sep, seg, sep, ...]; первый сегмент — сама роль, его не трогаем
  const out = [parts[0]];
  for (let i = 1; i < parts.length; i += 2) if (!isLocationSegment(parts[i + 1] ?? '')) out.push(parts[i], parts[i + 1]);
  t = out.join('');
  return t.trim() || title;
}

/**
 * Поле location явно вне Аргентины/LATAM: иностранная страна/город/штат или офис/гибрид — и ни одного разрешающего слова.
 * Возвращает причину или null.
 */
export function regionUnlikely(location: string | null | undefined): string | null {
  const loc = String(location ?? '').trim();
  if (!loc || /[а-яё]/i.test(loc)) return null;
  if (ALLOWED_RE.test(loc)) return null;
  const m = loc.match(FOREIGN_RE);
  if (m) return m[0];
  // «City, Region, BE» / «Foster City, CA»
  const code = loc.match(/,\s*([A-Z]{2})\s*(?:[;)]|$)/);
  if (code && !LATAM_CODES.has(code[1])) return US_STATES.has(code[1]) ? `US-${code[1]}` : code[1];
  if (OFFICE_RE.test(loc) && !REMOTE_RE.test(loc)) return 'офис/гибрид';
  return null;
}
