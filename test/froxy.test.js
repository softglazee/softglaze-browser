'use strict';
// Froxy: the first field of the dashboard "password" is the pool type (wifi/mobile/fast).
const test = require('node:test');
const assert = require('node:assert/strict');

test('froxyPassword: the Pool type picks the first field when a type token was pasted', () => {
  const U2 = require('../src/main/proxyVendorUtils.js');
  assert.equal(U2.froxyPassword('wifi;;;;', { country: 'de', poolType: 'mobile' }), 'mobile;de;;;');
  assert.equal(U2.froxyPassword('wifi', { poolType: 'datacenter' }), 'fast;;;;');
  assert.equal(U2.froxyPassword('wifi;;;;', { country: 'gb' }), 'wifi;gb;;;', 'no pool type keeps the pasted type');
  assert.equal(U2.froxyPassword('s3cret', { country: 'us', poolType: 'mobile' }), 's3cret;us;;;', 'a real secret is never replaced');
});
