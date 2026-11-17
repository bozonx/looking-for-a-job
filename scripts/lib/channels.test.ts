import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelFromUrl, extractChannels, mergeChannels } from './channels.ts';

test('каналы: адрес для резюме принимается, служебные адреса исключаются', () => {
  assert.deepEqual(extractChannels('Send your CV to jobs@acme.org'), [
    { type: 'email', value: 'jobs@acme.org', by: 'text' },
  ]);
  for (const text of [
    'Send your CV to support@acme.org',
    'For privacy questions email jobs@acme.org',
    'Contact accommodations@acme.org for adjustments',
    'Company news: https://t.me/acmenews',
    'Apply: https://facebook.com/sharer/example',
  ]) assert.deepEqual(extractChannels(text), [], text);
});

test('mailto сохраняет тему и не дублируется при извлечении', () => {
  const url = 'mailto:Jobs@acme.org?subject=Vue+Developer';
  assert.deepEqual(channelFromUrl(url), { type: 'email', value: 'jobs@acme.org', by: undefined, note: 'тема: Vue Developer' });
  assert.deepEqual(extractChannels('Apply: ' + url), [
    { type: 'email', value: 'jobs@acme.org', by: 'text', note: 'тема: Vue Developer' },
  ]);
});

test('повреждённое кодирование mailto пропускается без потери других каналов', () => {
  for (const url of ['mailto:jobs%ZZ@acme.org', 'mailto:jobs@acme.org?subject=%E0%A4']) {
    assert.equal(channelFromUrl(url), null);
  }
  assert.ok(extractChannels('Apply: mailto:bad%ZZ@acme.org\nSend CV to hiring@acme.org')
    .some((c) => c.value === 'hiring@acme.org'));
});

test('слияние сохраняет ручную заметку и не меняет исходный массив', () => {
  const base = [{ type: 'email' as const, value: 'jobs@acme.org', by: 'agent' as const, note: 'приложить портфолио' }];
  const before = structuredClone(base);
  assert.deepEqual(mergeChannels(base, [
    { type: 'email', value: 'JOBS@acme.org', by: 'text' }, null,
    { type: 'telegram', value: '@recruiter', by: 'text' },
  ]), [...base, { type: 'telegram', value: '@recruiter', by: 'text' }]);
  assert.deepEqual(base, before);
});
