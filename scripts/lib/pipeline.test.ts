/** Интеграционные проверки: только временный JOB_ROOT, без сети. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const repo = path.resolve(import.meta.dirname, '../..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-pipeline-'));
fs.cpSync(path.join(repo, 'config'), path.join(root, 'config'), { recursive: true });
process.env.JOB_ROOT = root;
process.env.APPLY_MAX_PER_RUN = '2';
process.env.LINKEDIN_APPLY_MAX_PER_DAY = '1';
process.env.SCORE_MAX_PER_RUN = '1';
after(() => fs.rmSync(root, { recursive: true, force: true }));
const { collect, collectContext, blankVacancy } = await import('./collect.ts');
const { writeVacancy, loadAll, parseVacancy } = await import('./vacancy.ts');
const put = (id: string, patch: Record<string, unknown> = {}) => {
  const file = path.join(root, 'data/vacancies', `${id}.md`);
  writeVacancy(file, { ...blankVacancy('remoteok', id), id, title: 'Vue Developer', company: id, source_url: `https://example.org/${id}`, ...patch }, 'Описание');
  return file;
};
const reset = () => fs.rmSync(path.join(root, 'data'), { recursive: true, force: true });
const cli = (name: string, args: string[] = []) => execFileSync(process.execPath, [path.join(repo, 'scripts', `${name}.ts`), ...args], { env: process.env, encoding: 'utf8' });

test('сбор повторяем; дубль сохраняет свежие решения пользователя и скоринг', async () => {
  reset();
  const job = { extId: '1', postedAt: null, title: 'Vue Developer', company: 'Acme', tags: [], build: () => ({ data: { source_url: 'https://example.org/1' }, body: 'Описание' }) };
  const provider = { source: 'remoteok', paginated: false, parse: () => [job], fetchPage: async () => [job] };
  assert.equal((await collect(provider, { dryRun: false, limit: 10 })).saved, 1);
  const ctx = collectContext();
  const v = loadAll()[0]!;
  writeVacancy(v.file, { ...v.data, status: 'selected', notes: 'Сохранить', scores: { overall: 85 } }, 'Новый текст');
  const duplicate = { ...job, extId: '2', build: () => ({ data: { source_url: 'https://example.org/2' }, body: 'Дубль' }) };
  await collect({ ...provider, source: 'other', fetchPage: async () => [duplicate] }, { dryRun: false, limit: 10 }, ctx);
  assert.equal(loadAll().length, 1);
  const fresh = parseVacancy(v.file);
  assert.equal(fresh.data.status, 'selected');
  assert.equal(fresh.data.notes, 'Сохранить');
  assert.equal(fresh.data.scores.overall, 85);
  assert.equal(fresh.body.trim(), 'Новый текст');
  assert.equal(fresh.data.duplicates.length, 1);
  assert.equal((await collect(provider, { dryRun: false, limit: 10 })).saved, 0);
});

test('неполный снимок ATS не закрывает компании вне covers; ошибка и пустой список не закрывают вакансии', async () => {
  reset();
  const a = put('ats-a', { source: 'ats' });
  const b = put('ats-b', { source: 'ats' });
  const job = { extId: 'live', postedAt: null, title: 'Vue Developer', company: 'Live', tags: [], build: () => ({ data: { source_url: 'https://example.org/live' }, body: '' }) };
  const p = { source: 'ats', snapshot: true, paginated: false, covers: (id: string) => id === 'a', parse: () => [], fetchPage: async () => [job] };
  await collect(p, { dryRun: false, limit: 10 });
  assert.equal(parseVacancy(a).data.possibly_closed, true);
  assert.equal(parseVacancy(b).data.possibly_closed, false);
  for (const fetchPage of [async () => { throw new Error('Сеть недоступна'); }, async () => []]) {
    writeVacancy(a, { ...parseVacancy(a).data, possibly_closed: false }, '');
    assert.equal((await collect({ ...p, fetchPage }, { dryRun: false, limit: 10 })).failed, true);
    assert.equal(parseVacancy(a).data.possibly_closed, false);
  }
});

test('набор откликов исключает закрытые, флаги и отправленные; применяет оба лимита', () => {
  reset();
  put('selected', { status: 'selected' });
  put('scored', { scores: { overall: 99 } });
  put('closed', { status: 'selected', possibly_closed: true });
  put('flagged', { status: 'selected', flagged: true });
  put('applied', { status: 'applied', scores: { overall: 100 } });
  put('li', { status: 'selected', apply_target: 'linkedin', real_url: 'https://linkedin.com/jobs/1' });
  put('li-sent', { status: 'applied', apply_target: 'linkedin', real_url: 'https://linkedin.com/jobs/2', applied_at: new Date().toISOString() });
  const rows = JSON.parse(cli('apply-set', ['all', '--json'])).rows;
  assert.deepEqual(rows.map((r: any) => r.id).sort(), ['scored', 'selected']);
  assert.equal(rows.find((r: any) => r.id === 'scored').confirm, true);
  put('retry', { status: 'apply_failed' });
  assert.deepEqual(JSON.parse(cli('apply-set', ['retry', '--json'])).rows.map((r: any) => r.id), ['retry']);
});

test('очередь ограничивает батч, исключает закрытые и несвежие; повтор не меняет файлы', () => {
  reset();
  put('new', { posted_at: new Date().toISOString().slice(0, 10) });
  put('old', { posted_at: '2000-01-01' });
  put('closed', { possibly_closed: true });
  put('filtered', { prefilter_reason: 'Отсев' });
  const first = cli('pending', ['--paths']);
  assert.match(first, /new\.md/);
  assert.doesNotMatch(first, /old\.md|closed\.md|filtered\.md/);
  assert.equal(cli('pending', ['--paths']), first);
  assert.match(cli('pending', ['--paths', '--stale', '--limit', '10']), /old\.md/);
});

test('предфильтр: жёсткое исключение, мягкое исключение и спасающее слово', async () => {
  const config = path.join(root, 'config/prefilter.yaml');
  const original = fs.readFileSync(config, 'utf8');
  try {
    fs.writeFileSync(config, 'include_title: [frontend]\ninclude_tags: [vue]\nexclude_title: [intern$]\nexclude_title_soft: [php]\nstrong_title: [vue]\nexclude_title_unless:\n  backend: [frontend]\n');
    const { loadPrefilter } = await import('./prefilter.ts');
    const pf = loadPrefilter();
    assert.equal(pf('Frontend Intern', ['vue']).ok, false);
    assert.equal(pf('Frontend Internal tools', []).ok, true);
    assert.equal(pf('PHP Developer', ['vue']).ok, false);
    assert.equal(pf('PHP Vue Developer', []).ok, true);
    assert.equal(pf('Backend Developer', ['vue']).ok, false);
    assert.equal(pf('Backend Frontend Developer', []).ok, true);
    assert.equal(pf('Developer', ['Vue']).ok, true);
  } finally { fs.writeFileSync(config, original); }
});

test('RemoteOK: метаданные пропускаются, HTML разбирается, зарплата сохраняет период', async () => {
  const { remoteok } = await import('../providers/remoteok.ts');
  assert.throws(() => remoteok.parse({ error: 'bad' }), /unexpected response/);
  assert.deepEqual(remoteok.parse([]), []);
  const jobs = remoteok.parse([{ legal: 'metadata' }, { id: '1', position: 'Vue &amp; TS', company: 'Acme', epoch: 1, date: '2026-01-01', description: '<p>Описание</p>', salary_min: 120000, apply_url: 'https://jobs.lever.co/acme/1', url: 'https://remoteok.com/1' }]);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.title, 'Vue & TS');
  const built = await jobs[0]!.build();
  assert.equal(built.data.real_url, 'https://jobs.lever.co/acme/1');
  assert.deepEqual(built.data.salary, { min: 120000, max: null, currency: 'USD', period: 'year' });
  assert.match(built.body, /Описание/);
  assert.doesNotMatch(built.body, /<p>/);
});
