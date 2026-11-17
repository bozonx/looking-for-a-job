import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addToFunnel, emptyFunnel, versionOf } from './outcomes.ts';

test('воронка: молчание дольше порога — нет ответа', () => {
  const f = emptyFunnel();
  addToFunnel(f, { outcome: null, applied_at: '2026-11-01' }, '2026-11-30');
  addToFunnel(f, { outcome: null, applied_at: '2026-11-25T10:00:00Z' }, '2026-11-30');
  addToFunnel(f, { outcome: 'interview' }, '2026-11-30');
  addToFunnel(f, { outcome: 'rejected' }, '2026-11-30');
  assert.deepEqual(f, { applied: 4, waiting: 1, no_reply: 1, rejected: 1, positive: 1, interview: 1 });
});

test('версия заготовок по дате отклика', () => {
  const vs = ['2026-11-10', '2026-12-01'];
  assert.equal(versionOf('2026-11-05T00:00:00Z', vs), 'до 2026-11-10');
  assert.equal(versionOf('2026-11-10', vs), 'с 2026-11-10');
  assert.equal(versionOf('2026-12-05', vs), 'с 2026-12-01');
  assert.equal(versionOf('2026-12-05', []), 'текущие');
});
