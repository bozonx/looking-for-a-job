import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyUiPatch, isMarked } from './uipatch.ts';

const now = '2026-11-17T10:00:00.000Z';

test('selected ставится и снимается', () => {
  assert.equal((applyUiPatch({ status: null }, { status: 'selected' }) as any).status, 'selected');
  assert.equal((applyUiPatch({ status: 'selected' }, { status: null }) as any).status, null);
});

test('статусы агента не затираются', () => {
  for (const s of ['applied', 'needs_attention', 'apply_failed']) {
    assert.equal(typeof applyUiPatch({ status: s }, { status: 'selected' }), 'string');
    assert.equal(typeof applyUiPatch({ status: s, applied_via: 'agent' }, { status: null }), 'string');
  }
});

test('ручной отклик ставится и снимается', () => {
  const a = applyUiPatch({ status: 'selected' }, { status: 'applied' }, now) as any;
  assert.deepEqual([a.status, a.applied_at, a.applied_via], ['applied', now, 'manual']);
  const b = applyUiPatch(a, { status: null }) as any;
  assert.deepEqual([b.status, b.applied_at, b.applied_via], [null, null, null]);
  assert.equal(typeof applyUiPatch({ status: 'needs_attention' }, { status: 'applied' }), 'string');
});

test('пометки без статуса', () => {
  const d = applyUiPatch({ status: 'applied' }, { starred: true, notes: 'x' }) as any;
  assert.deepEqual([d.status, d.starred, d.notes], ['applied', true, 'x']);
});

test('isMarked учитывает заметки', () => {
  assert.equal(isMarked({ status: null, notes: '  ' }), false);
  assert.equal(isMarked({ status: null, notes: 'важно' }), true);
  assert.equal(isMarked({ status: null, starred: true }), true);
  assert.equal(isMarked({ status: null, notes: '[агент 2026-11-17] не подходит' }), false);
});

test('результат отклика: только у applied, с датой; отмена отклика его сбрасывает', () => {
  assert.equal(typeof applyUiPatch({ status: 'selected' }, { outcome: 'rejected' }, now), 'string');
  const a = applyUiPatch({ status: 'applied', applied_via: 'agent' }, { outcome: 'interview' }, now) as any;
  assert.deepEqual([a.outcome, a.outcome_at], ['interview', '2026-11-17']);
  const b = applyUiPatch(a, { outcome: null }, now) as any;
  assert.deepEqual([b.outcome, b.outcome_at], [null, null]);
  const c = applyUiPatch({ status: 'applied', applied_via: 'manual', outcome: 'screen', outcome_at: '2026-11-10' }, { status: null }) as any;
  assert.deepEqual([c.status, c.outcome, c.outcome_at], [null, null, null]);
});
