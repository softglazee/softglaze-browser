'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'lib', 'countries.mjs')).href);

test('the country list is complete, unique and named in every UI language', async () => {
  const { ALL_COUNTRY_CODES, countryName } = await load();
  assert.ok(ALL_COUNTRY_CODES.length > 200);
  assert.equal(new Set(ALL_COUNTRY_CODES).size, ALL_COUNTRY_CODES.length);
  for (const code of ALL_COUNTRY_CODES) {
    assert.match(code, /^[A-Z]{2}$/);
    assert.notEqual(countryName(code, 'en'), code, `${code} has an English name`);
  }
  assert.equal(countryName('DE', 'es'), 'Alemania');
});

test('a provider gets its API list, else its documented list, else every country', async () => {
  const { countryOptions, ALL_COUNTRY_CODES } = await load();
  assert.equal(countryOptions({ geoSync: {} }, 'en').length, ALL_COUNTRY_CODES.length);
  const documented = countryOptions({ geoSync: { countries: ['SG', 'US'] } }, 'en');
  assert.deepEqual(documented, [['SG', 'Singapore'], ['US', 'United States']], 'sorted by name');
  const fromApi = countryOptions({ geoSync: { countries: ['SG'] } }, 'en', [{ key: 'de', label: 'Germany' }]);
  assert.deepEqual(fromApi, [['DE', 'Germany']]);
});
