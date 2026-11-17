/** Вызываем настоящие обработчики, подменяя только окружение Nitro и хранилище. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
const runtime = globalThis as any;
runtime.defineEventHandler = (fn: unknown) => fn;
runtime.readBody = async (event: any) => event.body;
runtime.getRouterParam = (event: any) => event.id;
runtime.createError = (info: any) => Object.assign(new Error(info.message ?? info.statusMessage), info);
const patchHandler = (await import('../server/api/vacancies/[id].patch.ts')).default as any;
const batchHandler = (await import('../server/api/vacancies/batch.post.ts')).default as any;
const records = new Map<string, Record<string, any>>();
let writes = 0;
runtime.patchVacancy = (id: string, fn: (cur: any) => any) => {
  const cur = records.get(id);
  if (!cur) return undefined;
  const next = fn(cur);
  if (next !== cur) { writes++; records.set(id, next); }
  return { data: next };
};
const reset = () => { records.clear(); writes = 0; records.set('a', { status: null, scores: { overall: 90 } }); };

test('PATCH запрещает служебные поля и неверные типы до записи', async () => {
  reset();
  for (const body of [{ scores: { overall: 100 } }, { applied_via: 'agent' }, { notes: 1 }, { status: 'apply_failed' }, { starred: 'true' }, { outcome: 'wrong' }]) {
    await assert.rejects(patchHandler({ id: 'a', body }), { statusCode: 400 });
  }
  assert.equal(writes, 0);
  assert.equal(records.get('a')!.scores.overall, 90);
});
test('PATCH различает 404 и конфликт; отклонённая смешанная правка не меняет пометки', async () => {
  reset();
  await assert.rejects(patchHandler({ id: 'missing', body: { starred: true } }), { statusCode: 404 });
  records.set('a', { status: 'applied', applied_via: 'agent', starred: false });
  await assert.rejects(patchHandler({ id: 'a', body: { status: null, starred: true } }), { statusCode: 409 });
  assert.equal(records.get('a')!.starred, false);
  assert.equal(writes, 0);
  const result = await patchHandler({ id: 'a', body: { notes: 'Заметка' } });
  assert.equal(result.data.status, 'applied');
  assert.equal(result.data.notes, 'Заметка');
});
test('batch возвращает частичный успех и не затирает статусы агента', async () => {
  reset();
  records.set('b', { status: 'needs_attention' });
  const result = await batchHandler({ body: { ids: ['a', 'b', 'missing'], patch: { status: 'selected' } } });
  assert.equal(result.updated, 1);
  assert.deepEqual(result.failed.map((x: any) => x.id), ['b', 'missing']);
  assert.match(result.failed[0].error, /нельзя отметить на отклик/);
  assert.equal(records.get('a')!.status, 'selected');
  assert.equal(records.get('b')!.status, 'needs_attention');
  assert.equal(writes, 1);
});
test('batch отклоняет пустые, слишком большие и недопустимые запросы', async () => {
  reset();
  for (const body of [{ ids: [], patch: { status: null } }, { ids: Array(2001).fill('a'), patch: { status: null } }, { ids: ['a'], patch: { starred: true } }, { ids: ['a'], patch: { status: null }, extra: true }]) {
    await assert.rejects(batchHandler({ body }), { statusCode: 400 });
  }
  assert.equal(writes, 0);
});

test('analyzeResumeMatch сопоставляет навыки, обязанности, факты, написания и частотность', async () => {
  const { analyzeResumeMatch } = await import('../server/utils/resumegaps.ts');
  const rm = {
    resume: 'vue',
    required: ['Vue', 'TypeScript'],
    nice_to_have: ['GraphQL', 'Docker'],
    responsibilities: ['code review', 'mentor developers'],
    soft_requirements: ['mentoring', 'ownership'],
    keyword_spellings: { Vue: ['Vue.js', 'Vue 3'] },
  };
  const vacancies = [
    { data: { resume_match: rm } },
    { data: { resume_match: { required: ['GraphQL'], nice_to_have: [], responsibilities: ['mentor developers'] } } },
  ];
  const res = analyzeResumeMatch(rm, vacancies, {
    resume: 'Experienced with Vue 3, TypeScript, code review, and mentoring.',
    facts: 'Worked with GraphQL and mentored junior developers (mentor developers).',
  });
  assert.ok(res);
  assert.deepEqual(res.missing, ['GraphQL', 'Docker']);
  assert.ok(res.inFacts.includes('GraphQL'));
  assert.ok(res.inFacts.includes('mentor developers'));
  assert.ok(!res.inFacts.includes('Docker'));
  assert.deepEqual(res.responsibilitiesMatched, ['code review']);
  assert.deepEqual(res.responsibilitiesMissing, ['mentor developers']);
  assert.deepEqual(res.softMatched, ['mentoring']);
  assert.deepEqual(res.spellingDiffs, { Vue: ['Vue.js'] });
  assert.equal(res.frequencies['GraphQL'], 2);
  assert.equal(res.frequencies['mentor developers'], 2);
});
