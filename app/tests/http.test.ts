/** Настоящий Nitro, HTTP и файловая система; личные данные не используются. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const repo = path.resolve(import.meta.dirname, '../..');

test('HTTP сохраняет правки, защищает поля и видит внешние изменения файлов', { timeout: 90000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-http-'));
  const dir = path.join(root, 'data/vacancies');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'remoteok-http.md');
  const contents = (notes: string) => `---\nid: remoteok-http\ntitle: Тестовая вакансия\ncompany: Компания\nstatus: null\nnotes: ${notes}\nscores:\n  overall: 91\n---\nОписание вакансии\n`;
  fs.writeFileSync(file, contents('Исходная'));
  // Отдельные сборочные файлы и lock: работающий UI проекта не затрагивается.
  fs.cpSync(path.join(repo, 'app'), path.join(root, 'app'), {
    recursive: true, filter: source => !['.nuxt', '.output', 'node_modules'].includes(path.basename(source)),
  });
  for (const name of ['scripts', 'config', 'node_modules'])
    fs.symlinkSync(path.join(repo, name), path.join(root, name), 'dir');
  let output = '';
  const server = spawn(process.execPath, [path.join(repo, 'node_modules/nuxt/bin/nuxt.mjs'), 'dev', 'app', '--port', '0', '--host', '127.0.0.1', '--no-fork'], {
    detached: true, cwd: root, env: { ...process.env, JOB_ROOT: root, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  async function until<T>(fn: () => Promise<T>, accept: (value: T) => boolean, timeout = 15000): Promise<T> {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (server.exitCode !== null) throw new Error(output);
      try { const result = await fn(); if (accept(result)) return result; } catch (e) {
        if (Date.now() + 100 >= end) throw e;
      }
      await delay(100);
    }
    throw new Error(`Истекло ожидание: ${output}`);
  }
  try {
    const base = await until(async () => output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0] ?? '', Boolean, 60000);
    const get = async () => {
      const response = await fetch(`${base}/api/vacancies`);
      assert.equal(response.status, 200);
      return response.json();
    };
    const initial = await until(get, v => v.items?.length === 1, 60000);
    const patch = (body: unknown) => fetch(`${base}/api/vacancies/remoteok-http`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal((await patch({ status: 'selected', notes: 'Моя заметка' })).status, 200);
    const saved = await get();
    assert.equal(saved.items[0].status, 'selected');
    assert.equal(saved.items[0].notes, 'Моя заметка');
    assert.match(fs.readFileSync(file, 'utf8'), /Моя заметка/);
    assert.match(fs.readFileSync(file, 'utf8'), /Описание вакансии/);
    const before = fs.readFileSync(file, 'utf8');
    assert.equal((await patch({ scores: { overall: 100 } })).status, 400);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    fs.writeFileSync(file, contents('Внешняя'));
    const changed = await until(get, v => v.items?.[0]?.notes === 'Внешняя');
    assert.ok(changed.version > initial.version);
    const unchanged = await fetch(`${base}/api/vacancies?since=${changed.version}`).then(r => r.json());
    assert.equal(unchanged.unchanged, true);
    const added = path.join(dir, 'remoteok-added.md');
    fs.writeFileSync(added, contents('Добавлена').replace('remoteok-http', 'remoteok-added'));
    await until(get, v => v.items?.length === 2);
    fs.writeFileSync(file, 'битый YAML');
    await until(get, v => v.items?.length === 1 && v.errors?.length === 1);
    fs.writeFileSync(file, contents('Исправлена'));
    await until(get, v => v.items?.length === 2 && v.errors?.length === 0);
    fs.unlinkSync(added);
    await until(get, v => v.items?.length === 1 && v.items[0].id === 'remoteok-http');
  } finally {
    if (server.pid) process.kill(-server.pid, 'SIGTERM');
    await Promise.race([new Promise<void>(resolve => server.once('exit', () => resolve())), delay(5000)]);
    if (server.exitCode === null) { server.kill('SIGKILL'); await new Promise<void>(resolve => server.once('exit', () => resolve())); }
    server.stdout.destroy();
    server.stderr.destroy();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
