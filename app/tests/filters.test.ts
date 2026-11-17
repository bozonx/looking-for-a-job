import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankFilters, matchQuery, matchRow, nextSorts, normFilters, sortRows, NONE } from '../utils/filters.ts';

const ctx = { lastRun: 'r2', now: new Date('2026-11-17T12:00:00') };
const row = (o: Record<string, any> = {}) => ({ id: 'x', title: 'Vue dev', company: 'Acme', status: null, scores: { overall: 70 }, stop_flags: [], ...o });
const f = (o: Record<string, any> = {}) => ({ ...blankFilters(), ...o });

test('закрытые скрыты по умолчанию и видны с «closed»', () => {
  assert.equal(matchRow(row({ possibly_closed: true }), f(), ctx), false);
  assert.equal(matchRow(row({ possibly_closed: true }), f({ statuses: ['closed'] }), ctx), true);
  assert.equal(matchRow(row(), f({ statuses: ['closed'] }), ctx), false);
});

test('регион и страна: null сопоставляется с NONE', () => {
  assert.equal(matchRow(row({ region: null }), f({ regions: [NONE] }), ctx), true);
  assert.equal(matchRow(row({ region: 'anglo' }), f({ regions: ['anglo'] }), ctx), true);
  assert.equal(matchRow(row({ region: 'anglo' }), f({ regions: [NONE] }), ctx), false);
  assert.equal(matchRow(row({ company_country: 'US' }), f({ countries: ['DE'] }), ctx), false);
});

test('отскорена / зарплата / занятость', () => {
  assert.equal(matchRow(row({ scores: null }), f({ scored: 'no' }), ctx), true);
  assert.equal(matchRow(row(), f({ scored: 'no' }), ctx), false);
  assert.equal(matchRow(row({ salary: { min: 1 } }), f({ salary: 'yes' }), ctx), true);
  assert.equal(matchRow(row(), f({ salary: 'yes' }), ctx), false);
  assert.equal(matchRow(row({ employment: undefined }), f({ employment: ['unknown'] }), ctx), true);
});

test('стоп-факторы', () => {
  assert.equal(matchRow(row(), f({ stopFlags: [NONE] }), ctx), true);
  assert.equal(matchRow(row({ stop_flags: ['scam'] }), f({ stopFlags: [NONE] }), ctx), false);
  assert.equal(matchRow(row({ stop_flags: ['scam'] }), f({ stopFlags: ['scam'] }), ctx), true);
});

test('период', () => {
  assert.equal(matchRow(row({ collected_run: 'r2' }), f({ period: 'last' }), ctx), true);
  assert.equal(matchRow(row({ collected_at: '2026-11-01' }), f({ period: 7 }), ctx), false);
  assert.equal(matchRow(row({ collected_at: '2026-11-15' }), f({ period: 7 }), ctx), true);
});

test('поиск по навыкам и тегам, все слова', () => {
  assert.equal(matchQuery(row({ _skills: ['typescript'] }), 'vue typescript'), true);
  assert.equal(matchQuery(row({ tags: ['fintech'] }), 'fintech'), true);
  assert.equal(matchQuery(row(), 'react'), false);
});

test('normFilters: мусор → значения по умолчанию', () => {
  assert.deepEqual(normFilters(null), blankFilters());
  const n = normFilters({ regions: ['anglo', 1], scored: 'bad', sorts: [{ key: 'x', dir: 'up' }] });
  assert.deepEqual(n.regions, ['anglo']);
  assert.equal(n.scored, 'any');
  assert.deepEqual(n.sorts, blankFilters().sorts);
});

test('сортировка: ★ сверху, пустые в конце; nextSorts', () => {
  const r = sortRows([row({ id: 'a', scores: null }), row({ id: 'b' }), row({ id: 'c', starred: true, scores: { overall: 10 } })], [{ key: 'overall', dir: 'desc' }]);
  assert.deepEqual(r.map((x) => x.id), ['c', 'b', 'a']);
  const s1 = nextSorts([{ key: 'overall', dir: 'desc' }], 'overall', false);
  assert.deepEqual(s1, [{ key: 'overall', dir: 'asc' }]);
  const s2 = nextSorts(s1, 'company', true);
  assert.equal(s2.length, 2);
  assert.deepEqual(nextSorts(nextSorts(s2, 'company', true), 'company', true), s1);
});
