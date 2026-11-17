/** Поиск навыков в тексте резюме: `npm test`. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasSpelling, skillsInText } from './resumeskills.ts';
import type { SkillDict } from './skills.ts';

const dict = (raw: Record<string, string[]>): SkillDict => {
  const alias = new Map<string, string>();
  for (const [k, syn] of Object.entries(raw)) for (const s of [k, ...syn]) alias.set(s, k);
  return { alias, canonical: new Set(Object.keys(raw)), conflicts: [] };
};
const D = dict({ 'next.js': ['nextjs', 'next'], go: ['golang'], vue: ['vue.js', 'vue 3'], c: [], rest: [], kubernetes: ['k8s'] });

test('синонимы и границы слов', () => {
  const s = skillsInText('Skills: Vue.js, Next.js, K8s', D);
  assert.deepEqual([...s].sort(), ['kubernetes', 'next.js', 'vue']);
});

test('короткие слова английского текста не считаются навыком', () => {
  const s = skillsInText('ready to go to the next level, see section c', D);
  assert.equal(s.size, 0);
  assert.ok(skillsInText('Backend: Go, C', D).has('go'));
  assert.ok(skillsInText('REST APIs', D).has('rest'));
  assert.ok(!skillsInText('C# only', D).has('c'));
});

test('HTML-комментарии игнорируются', () => {
  assert.equal(skillsInText('<!-- Golang --> text', D).size, 0);
});

test('hasSpelling', () => {
  assert.ok(hasSpelling('Built with Node.js and Vue', 'node.js'));
  assert.ok(!hasSpelling('Nodejs', 'Node.js'));
});
