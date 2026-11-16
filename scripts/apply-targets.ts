/**
 * Где откликаться (dev_docs/apply-plan.md §8.3): сколько вакансий ждёт отклика по каждому apply_target
 * и есть ли там аккаунт (profile/accounts.md). `npm run apply-targets -- [all|selected|scored|retry]`
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/env.ts';
import { loadAll } from './lib/vacancy.ts';
import { inMode, needsRealUrl, type Mode } from './lib/apply.ts';

const mode = (process.argv[2] ?? 'all') as Mode;
const accFile = path.join(ROOT, 'profile', 'accounts.md');
const accounts = new Map<string, string>();
if (fs.existsSync(accFile)) {
  for (const l of fs.readFileSync(accFile, 'utf8').split('\n')) {
    const c = l.split('|').map((s) => s.trim());
    if (c.length >= 4 && c[1] && !/^-+$|площадка/i.test(c[1])) accounts.set(c[1], [c[2], c[3]].filter(Boolean).join(' · '));
  }
}

const counts = new Map<string, { n: number; noUrl: number; selected: number }>();
for (const { data: d } of loadAll()) {
  if (!inMode(d, mode) || d.possibly_closed || d.flagged) continue;
  const t = d.apply_target ?? d.apply_method ?? '?';
  const c = counts.get(t) ?? { n: 0, noUrl: 0, selected: 0 };
  c.n++;
  if (needsRealUrl(d)) c.noUrl++;
  if (d.status === 'selected') c.selected++;
  counts.set(t, c);
}
const rows = [...counts].sort((a, b) => b[1].n - a[1].n);
console.log(`| apply_target | вакансий | из них selected | без real_url | аккаунт |\n|---|---|---|---|---|`);
for (const [t, c] of rows) console.log(`| ${t} | ${c.n} | ${c.selected} | ${c.noUrl || ''} | ${accounts.get(t) ?? 'нет в accounts.md'} |`);
console.log(`\nВсего: ${rows.reduce((s, [, c]) => s + c.n, 0)} (режим ${mode})`);
