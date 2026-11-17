import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geoscreen } from './geoscreen.ts';
test('явные ограничения стран исключают AR, неизвестные регионы не исключают', () => {
  assert.equal(geoscreen({allowedCountries: ['United States', 'Canada']}).hire_from_ar, 'no');
  assert.equal(geoscreen({allowedCountries: ['US', 'Argentina']}).hire_from_ar, 'yes');
  assert.equal(geoscreen({allowedCountries: ['Europe', 'Worldwide']}).hire_from_ar, 'unknown');
  assert.equal(geoscreen({allowedCountries: []}).hire_from_ar, 'unknown');
});
test('страна офиса блокирует только обязательный офис', () => {
  assert.deepEqual(geoscreen({workplace: 'hybrid', officeCountry: 'US'}).stop_flags, ['office_outside_ar']);
  assert.equal(geoscreen({workplace: 'remote', officeCountry: 'US'}).hire_from_ar, 'unknown');
  assert.equal(geoscreen({workplace: 'onsite', officeCountry: 'AR'}).hire_from_ar, 'unknown');
});
