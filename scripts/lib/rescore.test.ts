import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rescoreVacancy, loadRescoreCtx } from './rescore.ts';
import { TRACKS } from './enums.ts';

test('пересчёт повторяем и сохраняет решения пользователя и ручные каналы', () => {
  const v = { file: 'test.md', body: 'Описание', data: {
    id: 'test-1', title: 'Разработчик', company: 'Компания', source: 'test',
    source_url: 'https://acme.org/jobs/1', real_url: 'https://acme.org/apply/1',
    collected_at: '2026-01-01', company_country: null, summary: 'Описание',
    best_resume: 'vue', score_reasoning: 'Совпадение стека', scoring_version: 1,
    status: 'selected', starred: true, flagged: true, notes: 'Моя заметка',
    apply_channels: [{ type: 'email', value: 'jobs@acme.org', by: 'agent', note: 'портфолио' }],
    scores: { remote: 90, startup: 50, corporate: 10, outsource: 0,
      legitimacy: 90, language: 80, fit: Object.fromEntries(TRACKS.map((t) => [t, 70])) },
  } };
  const ctx = loadRescoreCtx();
  rescoreVacancy(v, ctx);
  const once = structuredClone(v);
  rescoreVacancy(v, ctx);
  assert.deepEqual(v, once);
  assert.equal(v.data.status, 'selected');
  assert.equal(v.data.starred, true);
  assert.equal(v.data.flagged, true);
  assert.equal(v.data.notes, 'Моя заметка');
  assert.deepEqual(v.data.apply_channels[0], { type: 'email', value: 'jobs@acme.org', by: 'agent', note: 'портфолио' });
  assert.equal(v.data.apply_channels.length, 2);
});

test('пересчёт не меняет неотскоренную вакансию', () => {
  const v = { file: 'test.md', body: '', data: { scores: null, notes: 'Сохранить' } };
  const before = structuredClone(v);
  assert.equal(rescoreVacancy(v, loadRescoreCtx()), null);
  assert.deepEqual(v, before);
});
