import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryAfterMs, fetchWithRetry, fetchJson, withHttpWarnings, eachTolerant, takePartialList, takeHttpWarnings, pool } from './http.ts';

test('Retry-After: секунды, дата, прошлое и мусор', () => {
  assert.equal(retryAfterMs('2'), 2000);
  assert.equal(retryAfterMs('Thu, 01 Jan 1970 00:00:03 GMT', 1000), 2000);
  assert.equal(retryAfterMs('Thu, 01 Jan 1970 00:00:00 GMT', 1000), 0);
  for (const value of [null, '', '-1', 'oops']) assert.equal(retryAfterMs(value), null);
});
test('HTTP повторяет 503, отвергает битый JSON и сетевую ошибку', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => new Response(++calls === 1 ? '' : '{"ok":true}', { status: calls === 1 ? 503 : 200, headers: { 'retry-after': '0' } }));
  assert.equal((await fetchWithRetry('https://retry.test', {}, 1, { gapMs: 0 })).status, 200);
  assert.equal(calls, 2);
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>captcha</html>'));
  await assert.rejects(fetchJson('https://json.test'), /ответ не JSON/);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('timeout'); });
  await assert.rejects(fetchWithRetry('https://timeout.test', {}, 0), /timeout/);
});
test('параллельные источники изолируют предупреждения и признак неполного списка', async () => {
  const results = await Promise.all([true, false].map((fail) => withHttpWarnings(async () => {
    await eachTolerant('источник', [1, 2], async (n) => { if (fail && n === 1) throw new Error('ошибка'); });
    return [takePartialList(), takeHttpWarnings().length, takePartialList()];
  })));
  assert.deepEqual(results, [[true, 1, false], [false, 0, false]]);
  await assert.rejects(withHttpWarnings(() => eachTolerant('все', [1], async () => { throw new Error('нет ответа'); })), /нет ответа/);
});
test('pool соблюдает лимит и не теряет элементы', async () => {
  let active = 0, max = 0;
  const seen: number[] = [];
  await pool([1, 2, 3, 4], 2, async (n) => {
    max = Math.max(max, ++active);
    await Promise.resolve();
    seen.push(n); active--;
  });
  assert.equal(max, 2);
  assert.deepEqual(seen.sort(), [1, 2, 3, 4]);
});
