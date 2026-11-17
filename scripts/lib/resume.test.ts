/** Разбор резюме и профиля: `npm test`. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anachronisms, langSection, parseEducation, parseJobs, parseProjects, projectRefs } from './resume.ts';

const BODY = `## Summary
x

## Experience

### JBS — Senior Frontend Engineer
Apr 2024 — Present · https://x
Stack: Vue.js, Pinia, Claude Code
- Built a thing with Vue 3.

### TruckViewer — Software Engineer
Aug 2015 — Sep 2018
Stack: React, Redux, Pinia, Next.js
- Did Vue 3 work with Redux Toolkit.

## Skills
- Tauri
`;

test('места работы: год окончания и пункты', () => {
  const jobs = parseJobs(BODY, new Date('2026-11-17'));
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0]!.endYear, 2026);
  assert.equal(jobs[1]!.endYear, 2018);
  assert.deepEqual(jobs[1]!.bullets, ['Did Vue 3 work with Redux Toolkit.']);
});

test('анахронизмы: длинные ключи раньше коротких, вне опыта не считаются', () => {
  const dates = { 'Vue 3': 2020, 'Vue.js': 2014, Pinia: 2021, Redux: 2015, 'Redux Toolkit': 2019, 'Next.js': 2016, 'Claude Code': 2025, Tauri: 2022 };
  const [jbs, tv] = parseJobs(BODY, new Date('2026-11-17'));
  assert.deepEqual(anachronisms(jbs!, dates), []);
  assert.deepEqual(anachronisms(tv!, dates).map(([t]) => t).sort(), ['Pinia', 'Redux Toolkit', 'Vue 3']);
});

test('проекты: грани hl[...] и ссылки на проекты с описанием', () => {
  const p = parseProjects(`## fc\n- name: FastCat\n- links: a | b\n- en: desc\n- hl[mobile, graphics]: Ships on mobile.\n`).get('fc')!;
  assert.deepEqual(p.links, ['a', 'b']);
  assert.deepEqual(p.highlights, [{ tags: ['mobile', 'graphics'], text: 'Ships on mobile.' }]);
  assert.deepEqual(projectRefs(['a', { id: 'b', desc: 'd' }]), [{ id: 'a' }, { id: 'b', desc: 'd' }]);
});

test('soft skills и образование по языку', () => {
  assert.deepEqual(langSection('## en\n- A\n- B\n\n## ru\n- В\n', 'ru'), ['В']);
  assert.deepEqual(langSection('## en\n- A\n- B\n\n## ru\n- В\n', 'en'), ['A', 'B']);
  assert.deepEqual(parseEducation('## Образование\n- en: X\n- ru: Икс\n\n## Другое\n- en: no\n', 'en'), ['X']);
});
