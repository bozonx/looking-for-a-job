/**
 * Согласованность источников: id провайдеров ↔ config/apply-priority.yaml ↔ BOARDS (target.ts) ↔ freshness_days
 * ↔ таблица config/sources.md. Падает, если новый источник добавлен не во все места. `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { providers } from '../providers/index.ts';
import { BOARDS, applyMethodFromUrl, loadPriority, targetFromUrl } from './target.ts';
import { sourceConfig } from './job.ts';
import { CONFIG_DIR } from './env.ts';
import { feedProvider, parseSalaryText } from '../providers/feed.ts';

const ids = Object.keys(providers);

test('каждый источник есть в apply-priority.yaml', () => {
  const p = loadPriority();
  assert.deepEqual(ids.filter((id) => !p.includes(id)), []);
});

test('каждый источник-агрегатор узнаётся по домену (BOARDS)', () => {
  // ats — первоисточник: его ссылки — домены ATS, а не площадки
  const boards = new Set(Object.values(BOARDS));
  assert.deepEqual(ids.filter((id) => id !== 'ats' && !boards.has(id)), []);
});

test('freshness_days: ключи — известные источники, у каждого источника есть срок', () => {
  const f = sourceConfig<Record<string, number | null>>('freshness_days') ?? {};
  assert.deepEqual(Object.keys(f).filter((k) => k !== 'default' && !ids.includes(k)), [], 'лишние ключи (опечатка?)');
  assert.deepEqual(ids.filter((id) => !(id in f)), [], 'нет явного срока');
});

test('каждый источник описан в таблице config/sources.md', () => {
  const md = fs.readFileSync(path.join(CONFIG_DIR, 'sources.md'), 'utf8');
  assert.deepEqual(ids.filter((id) => !new RegExp(`^\\| ${id} \\|`, 'm').test(md)), []);
});

test('ATS — по домену, не по подстроке', () => {
  assert.equal(applyMethodFromUrl('https://jobs.lever.co/acme/1'), 'ats-lever');
  assert.equal(applyMethodFromUrl('https://job-boards.greenhouse.io/acme/jobs/1'), 'ats-greenhouse');
  assert.equal(applyMethodFromUrl('https://acme.wd5.myworkdayjobs.com/x'), 'ats-workday');
  assert.equal(applyMethodFromUrl('https://cleverbridge.com/careers'), 'external');
  assert.equal(targetFromUrl('https://hh.kz/vacancy/1'), 'hh');
});

test('зарплата из текста', () => {
  assert.deepEqual(parseSalaryText('от 60 000 до 90 000 ₽'), { min: 60000, max: 90000, currency: 'RUB', period: 'month' });
  assert.deepEqual(parseSalaryText('до 250 000 ₽'), { min: null, max: 250000, currency: 'RUB', period: 'month' });
  assert.deepEqual(parseSalaryText('от 3 000 $'), { min: 3000, max: null, currency: 'USD', period: 'month' });
  assert.equal(parseSalaryText('Москва'), null);
});

test('Хабр: город и зарплата из заголовка разделяются', async () => {
  const cfg = (sourceConfig<any[]>('feeds') ?? []).find((f) => f.id === 'habr');
  const p = feedProvider({ ...cfg, full_page: false });
  const item = (t: string) => `<item><title>${t}</title><link>https://career.habr.com/vacancies/${t.length}</link><author>Acme</author><description>x</description><pubDate>Mon, 16 Nov 2026 10:00:00 +0000</pubDate></item>`;
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel>${[
    'Требуется «Frontend-разработчик» (Москва, от 170 000 ₽)',
    'Требуется «Vue-разработчик» (от 60 000 до 90 000 ₽)',
    'Требуется «Fullstack» (Ульяновск)',
    'Требуется «Node.js-разработчик»',
  ].map(item).join('')}</channel></rss>`;
  const raws = p.parse(rss);
  const built = await Promise.all(raws.map((j) => j.build()));
  const got = raws.map((r, i) => [r.title, built[i]!.data.location, built[i]!.data.salary?.min ?? null, built[i]!.data.salary?.max ?? null]);
  assert.deepEqual(got, [
    ['Frontend-разработчик', 'Москва', 170000, null],
    ['Vue-разработчик', null, 60000, 90000],
    ['Fullstack', 'Ульяновск', null, null],
    ['Node.js-разработчик', null, null, null],
  ]);
});
