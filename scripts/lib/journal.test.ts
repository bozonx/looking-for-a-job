import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkJournal } from './journal.ts';

test('журнал: нормальная запись проходит', () => {
  assert.deepEqual(checkJournal('## 2026-11-17\n- [filter] bumeran: PLC-вакансии проходят → exclude_title: plc\n- [analysis] проведён анализ'), []);
});

test('журнал: шум, повторы, теги', () => {
  const r = checkJournal(
    [
      '- [scoring] elevenlabs: получила высокий балл 91',
      '- [source] wwr: HTTP 403 → пропускать в resolve-urls',
      '- [source] wwr: HTTP 403 → пропускать в resolve-urls',
      '- [noise] x: y → z',
    ].join('\n'),
  );
  const probs = r.map((x) => `${x.line}:${x.problem.slice(0, 8)}`);
  assert.ok(probs.some((p) => p.startsWith('1:нет «→')));
  assert.ok(probs.some((p) => p.startsWith('1:похоже')));
  assert.ok(probs.some((p) => p.startsWith('3:повтор')));
  assert.ok(probs.some((p) => p.startsWith('4:тег')));
});
