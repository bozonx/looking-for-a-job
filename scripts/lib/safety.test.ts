/** Проверки сохранности данных: JOB_ROOT изолирован до загрузки модулей. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-test-'));
process.env.JOB_ROOT = root;
after(() => fs.rmSync(root, { recursive: true, force: true }));
const { writeVacancy, parseVacancy, listVacancyFiles } = await import('./vacancy.ts');
const { isDisposable, cleanup } = await import('./cleanup.ts');
const { buildIndex, findDuplicate } = await import('./dedupe.ts');
const file = path.join(root, 'data/vacancies/test.md');

test('чистка сохраняет все пользовательские решения и учитывает свежий дубль', () => {
  const old = { collected_at: '2020-01-01', status: null };
  for (const patch of [{ status: 'selected' }, { status: 'applied' }, { status: 'needs_attention' }, { status: 'apply_failed' }, { starred: true }, { flagged: true }, { notes: 'важно' }])
    assert.equal(isDisposable({ ...old, ...patch }, '2026-01-01'), false);
  assert.equal(isDisposable({ ...old, notes: '[агент 2020] текст', possibly_closed: true }, '2026-01-01'), true);
  assert.equal(isDisposable({ ...old, duplicates: [{ seen_at: '2026-01-01' }] }, '2026-01-01'), false);
  assert.equal(isDisposable({ collected_at: '2026-01-01' }, '2026-01-01'), false);
});
test('запись сохраняет YAML, русский текст и тело; dry-run ничего не удаляет', () => {
  const data = { id: 'x', notes: 'важно: да\nвторая строка', scores: null, starred: true };
  writeVacancy(file, data, 'Описание\n');
  assert.deepEqual(parseVacancy(file).data, data);
  assert.equal(parseVacancy(file).body.trim(), 'Описание');
  const before = fs.readFileSync(file, 'utf8');
  cleanup(1, true, () => {});
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(listVacancyFiles().length, 1);
});
test('дедуп распознаёт id, ссылки без tracking и компанию; скрытые компании не склеиваются', () => {
  const v = { file, body: '', data: { id: 'x', company: 'Acme Inc', title: 'Senior Vue Developer', source_url: 'https://example.com/job?utm_source=a' } };
  const idx = buildIndex([v]);
  const candidate = { id: 'y', urls: [], company: 'Acme', title: 'Vue Developer' };
  assert.equal(findDuplicate(idx, { ...candidate, id: 'x' })?.by, 'id');
  assert.equal(findDuplicate(idx, { ...candidate, urls: ['https://example.com/job#apply'] })?.by, 'url');
  assert.equal(findDuplicate(idx, candidate)?.by, 'company+title');
  const hidden = buildIndex([{ ...v, data: { ...v.data, company: 'Confidencial' } }]);
  assert.equal(findDuplicate(hidden, { ...candidate, company: 'Confidencial' }), null);
});
