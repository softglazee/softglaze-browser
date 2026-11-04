'use strict';
// Tenant builds sell through the licensing server. A customer's fresh install has no local payment
// gateway config, so the app must offer the providers baked into the tenant config, and checkout must
// only ever ask the server for one of those (never the server's 'stripe' fallback).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tc = require('../src/main/tenantConfig');

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
  tc._reset();
  try { return fn(); } finally {
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    tc._reset();
  }
}

test('checkoutProviders keeps known providers only, lower-cased and de-duplicated', () => {
  withEnv({ SG_CHECKOUT_PROVIDERS: ' Cryptomus, bogus ,stripe,cryptomus,PAYPAL' }, () => {
    assert.deepEqual(tc.tenantConfig().checkoutProviders, ['cryptomus', 'stripe', 'paypal']);
  });
});

test('checkoutProviders is empty when nothing is baked or set', () => {
  withEnv({ SG_CHECKOUT_PROVIDERS: null }, () => {
    // The committed base tenant.config.json carries no providers.
    assert.deepEqual(tc.tenantConfig().checkoutProviders, []);
  });
});

const handlers = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipcHandlers.js'), 'utf8');
const fnBody = (name) => {
  const start = handlers.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const next = handlers.indexOf('\nasync function ', start + 1);
  return handlers.slice(start, next === -1 ? undefined : next);
};

test('tenant builds list the baked providers, not the empty local store', () => {
  const body = fnBody('listPaymentMethods');
  const tenantAt = body.indexOf('tenantConfig().enabled');
  const storeAt = body.indexOf('readPaymentStore()');
  assert.ok(tenantAt >= 0 && storeAt > tenantAt, 'the tenant branch must come before the local store is read');
  assert.match(body, /checkoutProviders\.map/);
});

test('tenant checkout only sends a provider this tenant offers', () => {
  const body = fnBody('startCheckout');
  const tenantBranch = body.slice(body.indexOf('tenantConfig().enabled'), body.indexOf('const { provider, def } = await loadCheckoutProvider'));
  assert.ok(!/provider:\s*input\.provider/.test(tenantBranch), 'raw renderer provider must not reach the server');
  assert.match(tenantBranch, /offered\.includes\(provider\)/);
});

test('both tenant build scripts carry checkoutProviders into the baked config', () => {
  for (const f of ['build-tenant.js', 'build-store.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', f), 'utf8');
    assert.match(src, /baked\.checkoutProviders = cfg\.checkoutProviders/, f);
  }
});
