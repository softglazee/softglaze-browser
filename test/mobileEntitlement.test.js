'use strict';
// Relay entitlement token of the PC companion: the cache rules (src/main/mobile/entitlement.js), the
// relay client putting the token in `auth` (src/main/mobile/relayClient.js), and the licensing client
// sending the account session as a Bearer token (src/main/licenseClient.js relayEntitlement).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { WebSocketServer } = require('ws');

const { P } = require('../src/main/mobile/protocol');
const { RelayClient } = require('../src/main/mobile/relayClient');
const { createEntitlementSource } = require('../src/main/mobile/entitlement');

const H = 3_600_000;

function source(answers, clock) {
  const calls = [];
  const fetchToken = async (mailbox) => {
    calls.push(mailbox);
    const a = typeof answers === 'function' ? answers(calls.length) : answers[Math.min(calls.length, answers.length) - 1];
    if (a instanceof Error) throw a;
    return a;
  };
  return { calls, src: createEntitlementSource({ fetchToken, now: () => clock.t }) };
}
const httpErr = (status, code) => Object.assign(new Error(code || 'http'), { status, ...(code ? { code } : {}) });

test('entitlement source: caches until the last 24 h, refetches, keeps a valid token while offline', async () => {
  const clock = { t: 1_800_000_000_000 };
  let n = 0;
  const { calls, src } = source(() => (++n === 1 ? { token: 'a', exp: Math.floor((clock.t + 30 * H) / 1000) } : new Error('offline')), clock);
  assert.equal(await src.get('pcmb'), 'a');
  assert.deepEqual(calls, ['pcmb']);
  clock.t += 5 * H;
  assert.equal(await src.get('pcmb'), 'a');
  assert.equal(calls.length, 1, '25 h left: no refetch');
  clock.t += 2 * H;
  assert.equal(await src.get('pcmb'), 'a', 'refetch failed: the old token is still valid');
  assert.equal(calls.length, 2);
  clock.t += 60_000;
  assert.equal(await src.get('pcmb'), 'a');
  assert.equal(calls.length, 2, 'waits 5 minutes after a failure');
  clock.t += 30 * H;
  assert.equal(await src.get('pcmb'), undefined, 'expired and the server is still down');
});

test('entitlement source: signed out, 403 and 401 drop the token and back off', async () => {
  const clock = { t: 1_800_000_000_000 };
  const out = source((n) => (n === 1 ? httpErr(undefined, 'signed_out') : { token: 'x', exp: Math.floor(clock.t / 1000) + 3600 }), clock);
  assert.equal(await out.src.get('m'), undefined);
  clock.t += 30 * 60_000;
  assert.equal(await out.src.get('m'), undefined);
  assert.equal(out.calls.length, 1, 'signed out: try again after an hour');
  clock.t += 31 * 60_000;
  assert.equal(await out.src.get('m'), 'x');

  const denied = source((n) => (n === 1 ? httpErr(403, 'no_entitlement') : { token: 'y', exp: Math.floor(clock.t / 1000) + 48 * 3600 }), clock);
  assert.equal(await denied.src.get('m'), undefined);
  clock.t += 10 * 60_000;
  assert.equal(await denied.src.get('m'), undefined);
  assert.equal(denied.calls.length, 1);
  denied.src.invalidate();
  assert.equal(await denied.src.get('m'), 'y', 'invalidate() also clears the back-off');
});

test('entitlement source: one fetch at a time, and a token is bound to its mailbox', async () => {
  const clock = { t: 1_800_000_000_000 };
  let n = 0;
  const { calls, src } = source(() => ({ token: `t${++n}`, exp: Math.floor(clock.t / 1000) + 100 * 3600 }), clock);
  const [a, b] = await Promise.all([src.get('m1'), src.get('m1')]);
  assert.equal(a, 't1');
  assert.equal(b, 't1');
  assert.equal(await src.get('m2'), 't2');
  assert.deepEqual(calls, ['m1', 'm2']);
});

// ---- relay client with a token ----
function startStub(t, { refuse } = {}) {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  const state = { auths: [], closes: 0 };
  wss.on('connection', (ws) => {
    const nonce = crypto.randomBytes(16).toString('base64url');
    ws.send(JSON.stringify({ t: 'challenge', v: 1, nonce }));
    ws.on('message', (d) => {
      const f = JSON.parse(String(d));
      if (f.t !== 'auth') return;
      assert.ok(P.verify(P.fromBase64Url(f.sig), P.authPayload(nonce, f.mailbox, f.role, '127.0.0.1'), P.fromBase64Url(f.pub)));
      state.auths.push(f);
      if (refuse && state.auths.length === 1) {
        ws.send(JSON.stringify({ t: 'error', code: 'entitlement', message: 'no plan' }));
        ws.close(4001, 'entitlement');
        return;
      }
      ws.send(JSON.stringify({ t: 'ready', mailbox: f.mailbox, queued: 0 }));
    });
  });
  t.after(() => new Promise((r) => wss.close(r)));
  return new Promise((resolve) => wss.on('listening', () => resolve({ state, url: `ws://127.0.0.1:${wss.address().port}/v1` })));
}
function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => { if (fn()) return resolve(); if (Date.now() > end) return reject(new Error('timed out')); setTimeout(tick, 10); };
    tick();
  });
}

test('relay client: asks for a token for its own mailbox and sends it in auth', async (t) => {
  const stub = await startStub(t);
  const identity = P.generateIdentity();
  const asked = [];
  const client = new RelayClient({ url: stub.url, host: '127.0.0.1', identity, entitlement: async (mb) => { asked.push(mb); return 'ENT.TOKEN'; } });
  client.start();
  await until(() => client.ready);
  client.stop();
  assert.deepEqual(asked, [identity.mailboxId]);
  assert.equal(stub.state.auths[0].entitlement, 'ENT.TOKEN');
});

test('relay client: no token, a failing or a slow token source still signs in (without the field)', async (t) => {
  const stub = await startStub(t);
  for (const entitlement of [async () => undefined, async () => { throw new Error('boom'); }, () => new Promise(() => {})]) {
    const client = new RelayClient({ url: stub.url, host: '127.0.0.1', identity: P.generateIdentity(), entitlement, entitlementWaitMs: 100 });
    client.start();
    await until(() => client.ready);
    client.stop();
  }
  assert.equal(stub.state.auths.length, 3);
  for (const a of stub.state.auths) assert.equal('entitlement' in a, false);
  // Without the option nothing changes: auth goes out at once.
  const plain = new RelayClient({ url: stub.url, host: '127.0.0.1', identity: P.generateIdentity() });
  plain.start();
  await until(() => plain.ready);
  plain.stop();
});

test('relay client: a refused token is dropped so the next connect fetches a new one', async (t) => {
  const stub = await startStub(t, { refuse: true });
  const clock = { t: Date.now() };
  let n = 0;
  const src = createEntitlementSource({ fetchToken: async () => ({ token: `tok${++n}`, exp: Math.floor(clock.t / 1000) + 7 * 24 * 3600 }), now: () => clock.t });
  const client = new RelayClient({
    url: stub.url, host: '127.0.0.1', identity: P.generateIdentity(), backoffMinMs: 20, backoffMaxMs: 50,
    entitlement: (mb) => src.get(mb), onEntitlementRejected: () => src.invalidate()
  });
  client.start();
  await until(() => client.ready);
  client.stop();
  assert.deepEqual(stub.state.auths.map((a) => a.entitlement), ['tok1', 'tok2']);
});

test('licence client: relayEntitlement posts the mailbox with the account session as Bearer', async (t) => {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: JSON.parse(body || '{}') });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ token: 'abc.def', exp: 2_000_000_000, payload: {} }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const tenant = require('../src/main/tenantConfig');
  const orig = tenant.tenantConfig;
  const cfg = { ...orig(), enabled: true, apiBaseUrl: `http://127.0.0.1:${server.address().port}` };
  tenant.tenantConfig = () => cfg;
  t.after(() => { tenant.tenantConfig = orig; });
  delete require.cache[require.resolve('../src/main/licenseClient')];
  const { api } = require('../src/main/licenseClient');
  const r = await api.relayEntitlement({ session: 'S'.repeat(43), mailbox: 'pcmailbox_1' });
  assert.equal(r.token, 'abc.def');
  assert.deepEqual(seen, [{ method: 'POST', url: '/v1/mobile/entitlement', auth: `Bearer ${'S'.repeat(43)}`, body: { mailbox: 'pcmailbox_1' } }]);
  delete require.cache[require.resolve('../src/main/licenseClient')];
});
