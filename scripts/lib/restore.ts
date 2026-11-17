import { jobPosting } from './jsonld.ts';
import { htmlToMarkdown } from './html.ts';
/** Заглушку разрешено вернуть только после получения содержательного описания. */
export function restoredBody(html: string, sourceUrl: string): string {
  const jp = jobPosting(html);
  const main = jp?.description ?? /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1];
  if (!main || /captcha|just a moment|access denied/i.test(main)) throw new Error('Страница не содержит доступного описания вакансии');
  const text = htmlToMarkdown(main).trim();
  if (text.length < 200) throw new Error('Описание слишком короткое; вакансия оставлена в отсеянных');
  return `Source: ${sourceUrl}\n\n${text}\n`;
}
