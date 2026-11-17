import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankFilters, matchQuery, matchRow, nextSorts, normFilters, sortRows, NONE } from '../utils/filters.ts';
import { fmtSalary, fmtSalaryUsdMonth } from '../utils/labels.ts';

const ctx = { lastRun: 'r2', now: new Date('2026-11-17T12:00:00') };
const row = (o: Record<string, any> = {}) => ({ id: 'x', title: 'Vue dev', company: 'Acme', status: null, scores: { overall: 70 }, stop_flags: [], ...o });
const f = (o: Record<string, any> = {}) => ({ ...blankFilters(), ...o });

test('закрытые скрыты по умолчанию и видны с «closed»', () => {
  assert.equal(matchRow(row({ possibly_closed: true }), f(), ctx), false);
  assert.equal(matchRow(row({ possibly_closed: true }), f({ statuses: ['closed'] }), ctx), true);
  assert.equal(matchRow(row(), f({ statuses: ['closed'] }), ctx), false);
});

test('регион и страна: null сопоставляется с NONE', () => {
  assert.equal(matchRow(row({ region: null }), f({ regions: [NONE] }), ctx), true);
  assert.equal(matchRow(row({ region: 'anglo' }), f({ regions: ['anglo'] }), ctx), true);
  assert.equal(matchRow(row({ region: 'anglo' }), f({ regions: [NONE] }), ctx), false);
  assert.equal(matchRow(row({ company_country: 'US' }), f({ countries: ['DE'] }), ctx), false);
});

test('отскорена / зарплата / занятость', () => {
  assert.equal(matchRow(row({ scores: null }), f({ scored: 'no' }), ctx), true);
  assert.equal(matchRow(row(), f({ scored: 'no' }), ctx), false);
  assert.equal(matchRow(row({ salary: { min: 1 } }), f({ salary: 'yes' }), ctx), true);
  assert.equal(matchRow(row(), f({ salary: 'yes' }), ctx), false);
  assert.equal(matchRow(row({ employment: undefined }), f({ employment: ['unknown'] }), ctx), true);
});

test('стоп-факторы', () => {
  assert.equal(matchRow(row(), f({ stopFlags: [NONE] }), ctx), true);
  assert.equal(matchRow(row({ stop_flags: ['scam'] }), f({ stopFlags: [NONE] }), ctx), false);
  assert.equal(matchRow(row({ stop_flags: ['scam'] }), f({ stopFlags: ['scam'] }), ctx), true);
});

test('период', () => {
  assert.equal(matchRow(row({ collected_run: 'r2' }), f({ period: 'last' }), ctx), true);
  assert.equal(matchRow(row({ collected_at: '2026-11-01' }), f({ period: 7 }), ctx), false);
  assert.equal(matchRow(row({ collected_at: '2026-11-15' }), f({ period: 7 }), ctx), true);
});

test('поиск по навыкам и тегам, все слова', () => {
  assert.equal(matchQuery(row({ _skills: ['typescript'] }), 'vue typescript'), true);
  assert.equal(matchQuery(row({ tags: ['fintech'] }), 'fintech'), true);
  assert.equal(matchQuery(row(), 'react'), false);
});

test('normFilters: мусор → значения по умолчанию', () => {
  assert.deepEqual(normFilters(null), blankFilters());
  const n = normFilters({ regions: ['anglo', 1], scored: 'bad', sorts: [{ key: 'x', dir: 'up' }] });
  assert.deepEqual(n.regions, ['anglo']);
  assert.equal(n.scored, 'any');
  assert.deepEqual(n.sorts, blankFilters().sorts);
});

test('сортировка: ★ сверху, пустые в конце; nextSorts', () => {
  const r = sortRows([row({ id: 'a', scores: null }), row({ id: 'b' }), row({ id: 'c', starred: true, scores: { overall: 10 } })], [{ key: 'overall', dir: 'desc' }]);
  assert.deepEqual(r.map((x) => x.id), ['c', 'b', 'a']);
  const s1 = nextSorts([{ key: 'overall', dir: 'desc' }], 'overall', false);
  assert.deepEqual(s1, [{ key: 'overall', dir: 'asc' }]);
  const s2 = nextSorts(s1, 'company', true);
  assert.equal(s2.length, 2);
  assert.deepEqual(nextSorts(nextSorts(s2, 'company', true), 'company', true), s1);
});

test('порог fit применяется к выбранному треку, а не к лучшему соседнему', () => {
  const v = row({ best_resume: 'react', role_tracks: ['vue', 'react'], scores: { overall: 80, fit: { vue: 30, react: 90 } } });
  assert.equal(matchRow(v, f({ tracks: ['vue'], minTrackFit: 60 }), ctx), false);
  assert.equal(matchRow(v, f({ tracks: ['react'], minTrackFit: 60 }), ctx), true);
});

test('порог overall сохраняет неотскоренные; явный фильтр скоринга скрывает их', () => {
  assert.equal(matchRow(row({ scores: null }), f({ minOverall: 70 }), ctx), true);
  assert.equal(matchRow(row({ scores: null }), f({ minOverall: 70, scored: 'yes' }), ctx), false);
});

test('результат и способ отклика фильтруются независимо', () => {
  const v = row({ status: 'applied', outcome: 'interview', applied_via: 'manual' });
  assert.equal(matchRow(v, f({ outcomes: ['interview'], appliedVia: ['manual'] }), ctx), true);
  assert.equal(matchRow(v, f({ outcomes: ['offer'] }), ctx), false);
  assert.equal(matchRow(v, f({ appliedVia: ['agent'] }), ctx), false);
});

test('фильтры найма и зарплаты сохраняют неизвестность и проверяют нижнюю границу', () => {
  assert.equal(matchRow(row(), f({ hireFromAr: ['unknown'] }), ctx), true);
  assert.equal(matchRow(row({ hire_from_ar: 'no' }), f({ hireFromAr: ['yes', 'likely'] }), ctx), false);
  assert.equal(matchRow(row({ salary_usd_month: { min: 4000, max: 9000 } }), f({ minSalary: 5000 }), ctx), false);
  assert.equal(matchRow(row({ salary_usd_month: { min: 5000, max: null } }), f({ minSalary: 5000 }), ctx), true);
  assert.equal(matchRow(row(), f({ minSalary: 5000 }), ctx), false);
  assert.deepEqual(normFilters({}).hireFromAr, []);
});

test('форматирование зарплаты в карточке и деталях', () => {
  assert.equal(fmtSalary({ min: 150, max: 150, currency: 'USD', period: 'hour' }), '150 USD/ч');
  assert.equal(fmtSalary({ min: 2200, max: 3500, currency: 'USD', period: 'month' }), '2.2k–3.5k USD/мес');
  assert.equal(fmtSalary({ min: null, max: 150000, currency: 'RUB', period: 'month' }), 'до 150k RUB/мес');
  assert.equal(fmtSalary({ min: 5000, max: null, currency: 'EUR', period: 'month' }), 'от 5k EUR/мес');
  assert.equal(fmtSalary(null), '');

  assert.equal(fmtSalaryUsdMonth({ min: 2200, max: 3500 }), '$2,200–$3,500');
  assert.equal(fmtSalaryUsdMonth({ min: 24000, max: 24000 }), '$24,000');
  assert.equal(fmtSalaryUsdMonth({ min: 5000, max: null }), 'от $5,000');
  assert.equal(fmtSalaryUsdMonth({ min: null, max: 1575 }), 'до $1,575');
  assert.equal(fmtSalaryUsdMonth(null), '');
});
