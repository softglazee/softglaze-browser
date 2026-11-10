'use strict';
// Froxy: the first field of the dashboard "password" is the subscription's type word (wifi, mobile,
// shared for Datacenter, fast for the Fast product) or a real secret. Since 1.0.27 (backlog 26) it is
// kept as pasted: the Pool type no longer rewrites it, and fetchFroxyPool stops a Pool type that
// disagrees with it (test/connectorsVendors1.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');

test('froxyPassword keeps the pasted type word or secret and adds the geo fields', () => {
  const U2 = require('../src/main/proxyVendorUtils.js');
  assert.equal(U2.froxyPassword('mobile;;;;', { country: 'de' }), 'mobile;de;;;', 'a Mobile login stays mobile');
  assert.equal(U2.froxyPassword('wifi;;;;', { country: 'de', poolType: 'mobile' }), 'wifi;de;;;', 'the Pool type never rewrites the pasted word');
  assert.equal(U2.froxyPassword('shared', {}), 'shared;;;;');
  assert.equal(U2.froxyPassword('wifi;;;;', { country: 'gb' }), 'wifi;gb;;;');
  assert.equal(U2.froxyPassword('s3cret', { country: 'us', poolType: 'mobile' }), 's3cret;us;;;', 'a real secret is never replaced');
});

test('froxyPastedPool names the pool of a pasted type word, and nothing for a secret', () => {
  const U2 = require('../src/main/proxyVendorUtils.js');
  assert.equal(U2.froxyPastedPool('wifi;;;;'), 'residential');
  assert.equal(U2.froxyPastedPool('Mobile;us;;;'), 'mobile');
  assert.equal(U2.froxyPastedPool('shared;;;;'), 'datacenter');
  assert.equal(U2.froxyPastedPool('fast;;;;'), 'fast');
  assert.equal(U2.froxyPastedPool('qwerty;;;;'), '');
  assert.equal(U2.froxyType('datacenter'), 'shared', 'Datacenter plans use the shared type word, not fast');
  assert.equal(U2.froxyType('fast'), 'fast');
});
