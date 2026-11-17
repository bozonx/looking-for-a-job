import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestTrack, monthlyUsd } from './derived.ts';

test('трек учитывает веса, отключённые треки и отсутствие оценок', () => {
  assert.equal(bestTrack({ vue: 50, fullstack: 55 }, { vue: 1, fullstack: .9 }), 'vue');
  assert.equal(bestTrack({ vue: 100, react: 60 }, { vue: 0, react: 1 }), 'react');
  assert.equal(bestTrack({}, { vue: 1 }), null);
});
test('зарплата в месяц без неявных курсов и предположений о часах', () => {
  assert.deepEqual(monthlyUsd({ min: 120000, max: null, currency: 'USD', period: 'year' }), { min: 10000, max: null });
  assert.equal(monthlyUsd({ min: 50, max: 80, currency: 'USD', period: 'hour' }), null);
  assert.equal(monthlyUsd({ min: 5000, max: 8000, currency: 'CAD', period: 'month' }), null);
});
