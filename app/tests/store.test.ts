/** Store проверяется в отдельном процессе: watcher не остаётся после теста. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('store перечитывает свежие данные и не пишет отклонённую правку или битый YAML', () => {
  const code = `
    import fs from 'node:fs';
    import os from 'node:os';
    import path from 'node:path';
    import assert from 'node:assert/strict';
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-store-'));
    process.env.JOB_ROOT = root;
    try {
      const { writeVacancy, parseVacancy } = await import('./scripts/lib/vacancy.ts');
      const file = path.join(root, 'data/vacancies/a.md');
      writeVacancy(file, { id: 'a', status: null }, 'Текст');
      const store = await import('./app/server/utils/store.ts');
      store.allVacancies();
      writeVacancy(file, { id: 'a', status: null, scores: { overall: 91 } }, 'Свежий текст');
      store.patchVacancy('a', { starred: true });
      assert.equal(parseVacancy(file).data.scores.overall, 91);
      assert.equal(parseVacancy(file).body.trim(), 'Свежий текст');
      const before = fs.readFileSync(file, 'utf8');
      store.patchVacancy('a', cur => cur);
      assert.equal(fs.readFileSync(file, 'utf8'), before);
      assert.equal(store.patchVacancy('missing', {}), undefined);
      fs.writeFileSync(file, 'битый YAML');
      assert.throws(() => store.patchVacancy('a', { starred: false }));
      assert.equal(fs.readFileSync(file, 'utf8'), 'битый YAML');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
    process.exit(0);
  `;
  assert.doesNotThrow(() => execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: new URL('../..', import.meta.url), timeout: 10000, stdio: 'pipe' }));
});
