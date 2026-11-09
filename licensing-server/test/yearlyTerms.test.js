'use strict';
// Licence terms by months (util/time termDays): 30 days a month, 365 days a whole year, so a yearly plan
// (interval 'year', months 12) lasts a year. Monthly terms are unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const { termDays, termMs, DAY } = require('../src/util/time');

test('a month is 30 days and a whole year is 365 days', () => {
  assert.deepEqual([1, 2, 3, 6, 11].map(termDays), [30, 60, 90, 180, 330], 'terms under a year are unchanged');
  assert.equal(termDays(12), 365);
  assert.equal(termDays(13), 395);
  assert.equal(termDays(24), 730);
  assert.equal(termDays(120), 3650);
  assert.equal(termMs(12), 365 * DAY);
});

test('longer terms never come out shorter, and junk is 0', () => {
  for (let m = 1; m <= 120; m++) assert.ok(termDays(m) > termDays(m - 1), `termDays(${m})`);
  for (const bad of [0, -3, null, undefined, 'x', NaN]) assert.equal(termDays(bad), 0, String(bad));
  assert.equal(termDays('12'), 365, 'a numeric string counts');
});
