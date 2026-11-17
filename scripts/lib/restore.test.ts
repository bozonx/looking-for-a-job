import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoredBody } from './restore.ts';
import { makeJob } from './job.ts';
import { geoscreen } from './geoscreen.ts';
test('заглушка имеет ссылку без вызова ленивого построителя', () => {
 const j = makeJob({ extId: '1', title: 'PHP', company: 'X', postedAt: null, sourceName: 'X', sourceUrl: 'https://example.com/job' });
 j.build = () => { throw new Error('нельзя загружать страницу'); };
 assert.equal(j.preview?.source_url, 'https://example.com/job');
});
test('география: только явное ограничение, не адрес офиса', () => {
 assert.equal(geoscreen({ location: 'US only' }).hire_from_ar, 'no');
 assert.equal(geoscreen({ location: 'United States' }).hire_from_ar, 'unknown');
 assert.equal(geoscreen({ location: 'Europe; Argentina' }).hire_from_ar, 'unknown');
});
test('возврат блокирует пустые страницы и сохраняет описание', () => {
 assert.throws(() => restoredBody('<main>Access denied</main>', 'https://example.com'));
 assert.throws(() => restoredBody('<html>нет описания</html>', 'https://example.com'));
 assert.match(restoredBody('<main>' + 'Описание вакансии и требований. '.repeat(20) + '</main>', 'https://example.com'), /Описание вакансии/);
});

test('четыре мягких правила сохраняют фронтенд и отсекают чужой стек', async () => {
 const { loadPrefilter } = await import('./prefilter.ts');
 const filter = loadPrefilter();
 for (const title of ['Fullstack .NET & Vue.js — LATAM', 'Ruby/Vue.js Fullstack — GitLab', 'PHP/Laravel & Vue.js', 'Frontend Manager React'])
   assert.equal(filter(title, []).ok, true, title);
 for (const title of ['.NET Developer', 'PHP Developer', 'Ruby Developer', 'Account Manager'])
   assert.equal(filter(title, []).ok, false, title);
});
