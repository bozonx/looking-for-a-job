/**
 * Страница вакансии → markdown (для HTML-площадок и поиска real_url агентом).
 * `npm run fetch-page -- <url | file.html> [--out file.md]`
 * Для страниц за авторизацией (LinkedIn) сохрани HTML из браузера Orca в файл и передай путь.
 */
import fs from 'node:fs';
import { htmlToMarkdown } from './lib/html.ts';
import { fetchText } from './lib/http.ts';

async function main() {
  const args = process.argv.slice(2);
  const oi = args.indexOf('--out');
  const out = oi >= 0 ? args.splice(oi, 2)[1] : undefined;
  const src = args[0];
  if (!src) throw new Error('usage: fetch-page <url | file.html> [--out file.md]');
  const html = /^https?:\/\//.test(src) ? await fetchText(src) : fs.readFileSync(src, 'utf8');
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  const main = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<body[\s\S]*<\/body>/i.exec(html)?.[0] ?? html;
  const md = `${title ? `# ${title}\n\nSource: ${src}\n\n` : ''}${htmlToMarkdown(main)}\n`;
  if (out) fs.writeFileSync(out, md);
  else process.stdout.write(md);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
