import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normUrl } from './dedupe.ts';

test('URL: tracking и якорь не различают вакансии', () => {
  assert.equal(normUrl('https://www.acme.org/jobs/AbC/?utm_source=x&gh_src=y#apply'), normUrl('https://acme.org/jobs/AbC'));
});

test('URL: значимые параметры и регистр пути различают вакансии', () => {
  assert.notEqual(normUrl('https://acme.org/jobs/AbC'), normUrl('https://acme.org/jobs/abc'));
  assert.notEqual(normUrl('https://acme.org/jobs?id=AbC'), normUrl('https://acme.org/jobs?id=abc'));
  assert.notEqual(normUrl('https://acme.org/jobs?id=1'), normUrl('https://acme.org/jobs?id=2'));
});
