/** Проверки повторов после сбоев и блокировки команд в изолированном каталоге. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-state-'));
process.env.JOB_ROOT = root;
after(() => fs.rmSync(root, { recursive: true, force: true }));
const { SeenStore, MAX_FAILURES } = await import('./seen.ts');
test('сбой повторяется до лимита, сохраняется между запусками и сбрасывается успехом', () => {
  let store = new SeenStore('test');
  for (let n = 1; n <= MAX_FAILURES; n++) {
    assert.equal(store.addFailure('x'), n);
    assert.equal(store.has('x'), n >= MAX_FAILURES);
    store.save();
    store = new SeenStore('test');
    assert.equal(store.failures('x'), n);
  }
  store.add('x');
  assert.equal(store.failures('x'), 0);
  assert.equal(store.addFailure('x'), 0);
  assert.equal(store.has('x'), true);
});
test('отсев отличается от успешной записи; сохранение удаляет старые идентификаторы', () => {
  const file = path.join(root, 'data/state/seen-old.json');
  fs.writeFileSync(file, JSON.stringify({ ancient: '2000-01-01' }));
  const store = new SeenStore('old');
  store.add('filtered', true);
  assert.equal(store.isPrefiltered('filtered'), true);
  store.add('filtered');
  assert.equal(store.isPrefiltered('filtered'), false);
  store.save();
  const reloaded = new SeenStore('old');
  assert.equal(reloaded.has('ancient'), false);
  assert.equal(reloaded.has('filtered'), true);
});
test('lock отказывает живому процессу, перехватывает повреждённый lock и снимается при выходе', () => {
  const file = path.join(root, 'data/state/test.lock');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const code = `import { acquireLock } from ${JSON.stringify(new URL('./lock.ts', import.meta.url).href)}; acquireLock('test');`;
  fs.writeFileSync(file, String(process.pid));
  assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', code], { env: process.env, stdio: 'pipe', timeout: 5000 }), /уже запущен/);
  assert.equal(fs.readFileSync(file, 'utf8'), String(process.pid));
  fs.writeFileSync(file, 'повреждён');
  execFileSync(process.execPath, ['--input-type=module', '-e', code], { env: process.env, stdio: 'pipe', timeout: 5000 });
  assert.equal(fs.existsSync(file), false);
});
