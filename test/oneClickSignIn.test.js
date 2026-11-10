'use strict';
// One-click sign-in in the app (1.0.26): "Continue with GitHub" (system browser, softglaze://auth or the loopback
// fallback, PKCE) and "Continue with email" (6-digit code). The licensing server is a fake that checks what the
// real one checks (PKCE verifier, expected account); no real GitHub or server call is made. Covers the pure
// helpers, the loopback listener, the browser flow, main's sign-in service (new workspace, unlock after Sign out,
// link, email, base build), an offline start after sign-in with the real restore code from ipcHandlers.js,
// old workspaces, the Store manifest protocol, the NSIS registration and the texts.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const auth = require('../src/main/oneClickAuth');
const { startLoopback } = require('../src/main/authLoopback');
const { createSignInFlow } = require('../src/main/signInFlow');
const { createOneClickSignIn, splitName } = require('../src/main/oneClickSignIn');
const { createAccountSession } = require('../src/main/accountSession');
const signupLead = require('../src/main/signupLead');

const b64 = (n = 32) => crypto.randomBytes(n).toString('base64url');
const challengeOf = (v) => crypto.createHash('sha256').update(v).digest('base64url');
const hashSecret = (secret) => { const salt = crypto.randomBytes(16).toString('hex'); return { salt, hash: crypto.scryptSync(String(secret), salt, 64).toString('hex') }; };
const verifySecret = (secret, salt, hash) => Boolean(salt && hash) && crypto.timingSafeEqual(crypto.scryptSync(String(secret), salt, 64), Buffer.from(hash, 'hex'));
const httpGet = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => { let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, body })); }).on('error', reject);
});
const httpErr = (status, code, extra = {}) => Object.assign(new Error(code || `HTTP ${status}`), { status, ...(code ? { code } : {}), ...extra });

// ---- pure helpers ----------------------------------------------------------------------------------
test('PKCE, the start URL and the protocol result are built and read exactly', () => {
  const p = auth.newPkce();
  assert.match(p.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(p.challenge, challengeOf(p.verifier), 'S256 of the verifier');
  const st = auth.newState();
  assert.match(st, /^[A-Za-z0-9_-]{32}$/);
  const url = new URL(auth.startUrl({ apiBaseUrl: 'https://api.softglaze.com/', tenantId: 't1', provider: 'github', appRedirect: 'softglaze://auth', codeChallenge: p.challenge, state: st }));
  assert.equal(url.origin + url.pathname, 'https://api.softglaze.com/auth/start');
  assert.deepEqual(Object.fromEntries(url.searchParams), { provider: 'github', tenant: 't1', app_redirect: 'softglaze://auth', code_challenge: p.challenge, code_challenge_method: 'S256', state: st });
  assert.throws(() => auth.startUrl({ apiBaseUrl: 'http://evil.example', tenantId: 't', provider: 'github', appRedirect: 'softglaze://auth', codeChallenge: p.challenge, state: st }));
  assert.throws(() => auth.startUrl({ apiBaseUrl: 'https://api.softglaze.com', tenantId: 't', provider: 'facebook', appRedirect: 'softglaze://auth', codeChallenge: p.challenge, state: st }));

  const code = b64();
  assert.deepEqual(auth.parseProtocolUrl(`softglaze://auth?code=${code}&state=${st}`), { code, state: st });
  assert.deepEqual(auth.parseProtocolUrl(`softglaze://auth/?code=${code}&state=${st}`), { code, state: st }, 'a browser may add a slash');
  assert.deepEqual(auth.parseProtocolUrl(`SoftGlaze://AUTH?code=${code}&state=${st}`), { code, state: st });
  assert.deepEqual(auth.parseProtocolUrl(`softglaze://auth?error=email_not_verified&state=${st}`), { error: 'email_not_verified', state: st });
  assert.deepEqual(auth.parseProtocolUrl(`softglaze://auth?error=whatever&state=${st}`), { error: 'failed', state: st });
  for (const bad of [`softglaze://invite/ABC123`, `softglaze://auth/x?code=${code}&state=${st}`, `softglaze://auth?code=short&state=${st}`,
    `softglaze://auth?code=${code}`, `softglaze://auth?code=${code}&state=x`, `https://auth?code=${code}&state=${st}`, 'not a url', null, `softglaze://auth?code=${code}&state=${st}&x=${'a'.repeat(2100)}`]) {
    assert.equal(auth.parseProtocolUrl(bad), null, String(bad).slice(0, 60));
  }
  // Windows passes the URL as the last argument of the second instance.
  assert.equal(auth.findProtocolUrl(['C:\\Program Files\\SoftGlaze Browser\\SoftGlaze Browser.exe', '--allow-file-access-from-files', `softglaze://auth?code=${code}&state=${st}`]), `softglaze://auth?code=${code}&state=${st}`);
  assert.equal(auth.findProtocolUrl(['app.exe', '--flag']), null);
  assert.ok(auth.sameState(st, st) && !auth.sameState(st, `${st}x`) && !auth.sameState('', ''));
  assert.deepEqual(splitName('Ada  King Lovelace', 'a@x.com'), { firstName: 'Ada', lastName: 'King Lovelace' });
  assert.deepEqual(splitName('', 'mia.lopez@x.com'), { firstName: 'Mia lopez', lastName: '' });
});

// ---- loopback ---------------------------------------------------------------------------------------
test('the loopback fallback: 127.0.0.1, a random port, only its own state, one shot', async () => {
  const st = auth.newState();
  const lb = await startLoopback({ expectState: st, timeoutMs: 5000 });
  assert.match(lb.redirectUri, /^http:\/\/127\.0\.0\.1:\d{4,5}\/auth$/);
  assert.ok(lb.port >= 1024);
  const base = `http://127.0.0.1:${lb.port}`;
  assert.equal((await httpGet(`${base}/other?code=${b64()}&state=${st}`)).status, 404);
  assert.equal((await httpGet(`${base}/auth?code=${b64()}&state=${auth.newState()}`)).status, 400, 'another state is refused');
  assert.equal((await httpGet(`${base}/auth?state=${st}`)).status, 400, 'no code');
  const code = b64();
  const ok = await httpGet(`${base}/auth?code=${code}&state=${st}`);
  assert.equal(ok.status, 200);
  assert.match(ok.body, /close this tab/);
  assert.deepEqual(await lb.result, { code, state: st });
  await new Promise((r) => setTimeout(r, 50));
  await assert.rejects(httpGet(`${base}/auth?code=${code}&state=${st}`), 'the listener is closed after one result');

  const lb2 = await startLoopback({ expectState: st, timeoutMs: 5000 });
  lb2.close();
  await assert.rejects(lb2.result, (e) => e.code === 'SIGNIN_CANCELLED');
  const lb3 = await startLoopback({ expectState: st, timeoutMs: 30 });
  await assert.rejects(lb3.result, (e) => e.code === 'SIGNIN_TIMEOUT');
});

// ---- the browser leg --------------------------------------------------------------------------------
function flowWith({ protocolReady = true, onOpen } = {}) {
  const opened = [];
  const flow = createSignInFlow({
    tenantConfig: () => ({ enabled: true, tenantId: 't1', apiBaseUrl: 'https://api.softglaze.com' }),
    openExternal: async (url) => { opened.push(url); if (onOpen) setImmediate(() => onOpen(new URL(url), flow)); },
    startLoopback,
    protocolReady: () => protocolReady,
    timeoutMs: 5000
  });
  return { flow, opened };
}

test('the browser flow: softglaze://auth with its own state, errors, cancel and a second start', async () => {
  const code = b64();
  const { flow, opened } = flowWith({
    onOpen: (u, f) => {
      assert.equal(f.handleProtocolUrl(`softglaze://auth?code=${code}&state=${auth.newState()}`), false, 'another state is ignored');
      assert.equal(f.isPending(), true);
      assert.equal(f.handleProtocolUrl(`softglaze://auth?code=${code}&state=${u.searchParams.get('state')}`), true);
    }
  });
  const r = await flow.begin('github');
  const u = new URL(opened[0]);
  assert.equal(u.searchParams.get('app_redirect'), 'softglaze://auth');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(challengeOf(r.codeVerifier), u.searchParams.get('code_challenge'), 'the verifier belongs to the challenge sent');
  assert.equal(r.code, code);
  assert.equal(flow.handleProtocolUrl(`softglaze://auth?code=${code}&state=${u.searchParams.get('state')}`), false, 'used once');

  const e = flowWith({ onOpen: (url, f) => f.handleProtocolUrl(`softglaze://auth?error=email_not_verified&state=${url.searchParams.get('state')}`) });
  await assert.rejects(e.flow.begin('github'), (x) => x.code === 'SIGNIN_EMAIL_NOT_VERIFIED');

  const c = flowWith();
  const first = c.flow.begin('github');
  await new Promise((r2) => setImmediate(r2));
  const second = c.flow.begin('github'); // "Open the page again"
  await assert.rejects(first, (x) => x.code === 'SIGNIN_CANCELLED');
  assert.equal(c.flow.cancel(), true);
  await assert.rejects(second, (x) => x.code === 'SIGNIN_CANCELLED');
  assert.equal(c.opened.length, 2);
});

test('the loopback fallback when the protocol is not registered, and "Try another way"', async () => {
  const code = b64();
  const deliver = async (u) => {
    const back = new URL(u.searchParams.get('app_redirect'));
    back.searchParams.set('code', code);
    back.searchParams.set('state', u.searchParams.get('state'));
    await httpGet(back.href); // what the server's 302 makes the browser do
  };
  const { flow, opened } = flowWith({ protocolReady: false, onOpen: deliver });
  const r = await flow.begin('github');
  assert.match(new URL(opened[0]).searchParams.get('app_redirect'), /^http:\/\/127\.0\.0\.1:\d+\/auth$/);
  assert.equal(r.code, code);
  const again = flowWith({ protocolReady: true, onOpen: deliver });
  const r2 = await again.flow.begin('github', { mode: 'loopback' });
  assert.match(new URL(again.opened[0]).searchParams.get('app_redirect'), /^http:\/\/127\.0\.0\.1:/, 'Try another way uses loopback');
  assert.equal(r2.code, code);
});

// ---- main's sign-in service against fakes ----------------------------------------------------------
// A fake licensing server that does what the real one does with the app's calls.
function fakeServer() {
  const s = {
    customers: [{ id: 'cust_existing', email: 'grace@example.com', name: 'Grace Hopper', useCase: 'agency' }],
    pending: new Map(), // app code -> { challenge, profile }
    calls: [],
    githubProfile: { email: 'ada@example.com', name: 'Ada Lovelace' },
    online: true
  };
  const customerFor = (email, name) => {
    let c = s.customers.find((x) => x.email === email);
    if (!c) { c = { id: `cust_${s.customers.length + 1}`, email, name: name || null, useCase: null }; s.customers.push(c); }
    return c;
  };
  const signIn = (c, provider, expectCustomerId, isNew) => {
    if (expectCustomerId && c.id !== expectCustomerId) throw httpErr(409, 'account_mismatch');
    return { ok: true, session: b64(), provider, isNew, customer: { id: c.id, email: c.email, name: c.name, useCase: c.useCase }, methods: [{ provider }, { provider: 'email', email: c.email }], licence: { state: c.id === 'cust_existing' ? 'elsewhere' : 'none' } };
  };
  const guard = (name, args) => { s.calls.push({ name, args }); if (!s.online) throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { network: true }); };
  s.api = {
    authProviders: async () => { guard('providers'); return { providers: ['github'], email: true }; },
    authExchange: async (a) => {
      guard('exchange', a);
      const p = s.pending.get(a.code);
      s.pending.delete(a.code);
      if (!p || challengeOf(a.codeVerifier) !== p.challenge) throw httpErr(400, 'invalid_grant');
      // The expected account is checked before anything is written.
      const existing = s.customers.find((x) => x.email === p.profile.email);
      if (a.expectCustomerId && (!existing || existing.id !== a.expectCustomerId)) throw httpErr(409, 'account_mismatch');
      return signIn(customerFor(p.profile.email, p.profile.name), 'github', a.expectCustomerId, !existing);
    },
    authEmailStart: async (a) => { guard('emailStart', a); s.lastCode = '123456'; return { ok: true, sent: true }; },
    authEmailVerify: async (a) => {
      guard('emailVerify', a);
      if (a.code !== s.lastCode) throw httpErr(400, 'invalid_code');
      const existing = s.customers.find((x) => x.email === a.email);
      if (a.expectCustomerId && (!existing || existing.id !== a.expectCustomerId)) throw httpErr(409, 'account_mismatch');
      return signIn(customerFor(a.email, null), 'email', a.expectCustomerId, !existing);
    },
    authMe: async (a) => { guard('me', a); return { signedIn: true, customer: s.customers[1] || s.customers[0], methods: [{ provider: 'github', login: 'ada' }], licence: { state: 'elsewhere' } }; },
    authLogout: async (a) => { guard('logout', a); return { ok: true }; },
    authProfile: async (a) => { guard('profile', a); return { ok: true, saved: true }; },
    authMoveLicence: async (a) => { guard('move', a); if (s.moveLimit) throw httpErr(429, 'move_limit', { retryAt: '2026-12-01T00:00:00.000Z' }); return { ok: true, moved: true, remaining: 1 }; }
  };
  // What the server does in the browser: GitHub signs the person in, a one-time code goes to the app.
  s.browser = (url, flowRef) => {
    const code = b64();
    s.pending.set(code, { challenge: url.searchParams.get('code_challenge'), profile: { ...s.githubProfile } });
    flowRef.handleProtocolUrl(`${url.searchParams.get('app_redirect')}?code=${code}&state=${url.searchParams.get('state')}`);
  };
  return s;
}

function memoryKeychain() {
  const store = { blob: null };
  return {
    store,
    available: () => true,
    read: () => (store.blob ? JSON.parse(store.blob) : null),
    write: (rec) => { store.blob = JSON.stringify({ ...rec, v: 1 }); return true; },
    patch(fields) { return this.write({ ...(this.read() || {}), ...fields }); },
    signOut() { const r = this.read(); if (r) this.write({ ...r, session: null, sessionAt: null, methods: [] }); },
    clear: () => { store.blob = null; }
  };
}

// Main's state and stores, with the sign-in service on top.
function harness({ tenant = true, members = [], settings = {}, server = fakeServer(), dbEncrypted = false, keychain = memoryKeychain() } = {}) {
  const S = new Map(Object.entries(settings));
  const remembered = { blob: null };
  const st = { vaultLocked: false, vaultUnlockSource: null, currentMemberId: null };
  const audits = [];
  const otps = [];
  let nextId = members.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  const db = {
    member: {
      count: async () => members.length,
      create: async ({ data }) => { const m = { id: nextId++, createdAt: new Date(), ...data }; members.push(m); return { ...m }; },
      findFirst: async ({ where }) => members.filter((m) => !where || !where.role || m.role === where.role)[0] || null
    }
  };
  const flowRef = {};
  const flow = createSignInFlow({
    tenantConfig: () => ({ enabled: tenant, tenantId: 't1', apiBaseUrl: 'https://api.softglaze.com' }),
    openExternal: async (url) => { setImmediate(() => server.browser(new URL(url), flowRef)); },
    startLoopback,
    protocolReady: () => true,
    timeoutMs: 5000
  });
  flowRef.handleProtocolUrl = (u) => flow.handleProtocolUrl(u);
  const h = {
    S, st, members, audits, remembered, keychain, server, otps, recorded: 0, leases: 0,
    svc: createOneClickSignIn({
      tenantConfig: () => ({ enabled: tenant, tenantId: 't1', apiBaseUrl: 'https://api.softglaze.com' }),
      api: server.api,
      ensureInstall: async () => { if (!server.online) throw Object.assign(new Error('offline'), { network: true }); return { installId: 'inst_1', installSecret: 'sec_1' }; },
      flow,
      accountSession: keychain,
      rememberStore: { write: (b) => { remembered.blob = b; return { ok: true }; }, read: () => remembered.blob, clear: () => { remembered.blob = null; } },
      getPrisma: () => db,
      readSetting: async (k, fb) => (S.has(k) ? S.get(k) : fb),
      writeSetting: async (k, v) => { S.set(k, v); },
      hashSecret,
      verifySecret,
      initialsFrom: (n) => String(n).split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase(),
      assertFirstRunSetup: async () => {
        if (members.length > 0 || (S.get('vault') && S.get('vault').enabled)) throw Object.assign(new Error('already set up'), { code: 'ALREADY_SETUP' });
      },
      recordSignupVerified: async () => { h.recorded += 1; },
      logAudit: async (action, opts) => { audits.push({ action, ...opts }); },
      isDbEncryptionEnabled: () => dbEncrypted,
      requirePurchaser: async () => {},
      refreshBackendLease: async () => { h.leases += 1; },
      deliverOtp: async (email, code) => { otps.push({ email, code }); return { devMode: true }; },
      normalizeLead: signupLead.normalizeLead,
      gate: {
        state: () => ({ vaultLocked: st.vaultLocked, currentMemberId: st.currentMemberId }),
        authState: async () => ({ vaultLocked: st.vaultLocked, signedIn: st.currentMemberId != null, memberCount: members.length }),
        unlock: (source) => { st.vaultLocked = false; st.vaultUnlockSource = source; },
        setCurrentMember: async (id) => { st.currentMemberId = id; S.set('currentMemberId', id); }
      }
    })
  };
  // memberLogout as main does it: nobody signed in, the vault locks, the remembered credential goes.
  h.memberLogout = () => { st.currentMemberId = null; S.set('currentMemberId', null); if (S.get('vault') && S.get('vault').enabled) { st.vaultLocked = true; st.vaultUnlockSource = null; } remembered.blob = null; };
  return h;
}

test('Continue with GitHub on a new workspace: the Owner from the verified name and email, opened with a sealed key', async () => {
  const h = harness();
  assert.deepEqual((await h.svc.info()).providers, ['github']);
  assert.equal((await h.svc.info()).purpose, 'signup');
  const r = await h.svc.start({ provider: 'github', purpose: 'signup' });
  assert.equal(r.outcome, 'created');
  assert.equal(r.askUseCase, true, 'the one optional question comes next');
  assert.deepEqual(r.licence, { state: 'none' });
  const owner = h.members[0];
  assert.equal(owner.role, 'OWNER');
  assert.equal(owner.name, 'Ada Lovelace');
  assert.equal(owner.email, 'ada@example.com');
  assert.equal(owner.passwordHash, undefined, 'no password');
  assert.equal(h.st.currentMemberId, owner.id);
  const vault = h.S.get('vault');
  assert.equal(vault.enabled, true);
  assert.equal(vault.signIn, true);
  const rec = h.keychain.read();
  assert.ok(verifySecret(rec.deviceKey, vault.salt, vault.hash), 'the sealed device key opens the vault');
  assert.deepEqual(h.remembered.blob, { kind: 'vault', password: rec.deviceKey }, 'kept signed in on this computer');
  assert.match(rec.session, /^[A-Za-z0-9_-]{43}$/, 'the session token stays in main, sealed');
  assert.equal(rec.customerId, 'cust_2');
  assert.deepEqual(h.S.get('tenantCustomer').customerId, 'cust_2');
  assert.equal(h.S.get('account').email, 'ada@example.com');
  assert.equal(h.S.get('account').firstName, 'Ada');
  assert.equal(h.recorded, 1, 'no "Confirm your email" step: the server verified the email');
  assert.equal(h.st.vaultUnlockSource, 'vault');
  const ex = h.server.calls.find((c) => c.name === 'exchange');
  assert.equal(ex.args.expectCustomerId, null, 'a new workspace takes whichever account signs in');
  assert.ok(h.audits.some((a) => a.action === 'account.signin' && a.detail.purpose === 'signup'));

  // The optional question goes to the server with the session.
  await h.svc.saveUseCase({ useCase: 'agency' });
  assert.equal(h.S.get('account').useCase, 'agency');
  assert.equal(h.server.calls.find((c) => c.name === 'profile').args.useCase, 'agency');
  await assert.rejects(h.svc.saveUseCase({ useCase: 'nope' }), (e) => e.code === 'SIGNUP_USE_CASE');

  // A second sign-up on the same workspace is refused.
  await assert.rejects(h.svc.start({ provider: 'github', purpose: 'signup' }), (e) => e.code === 'ALREADY_SETUP');
});

test('an offline start after sign-in opens the workspace with the real restore code (no server needed)', async () => {
  const h = harness();
  await h.svc.start({ provider: 'github', purpose: 'signup' });
  h.server.online = false;
  const IPC = read('src', 'main', 'ipcHandlers.js');
  const fn = (name) => {
    const start = IPC.search(new RegExp(`\\n(?:async )?function ${name}\\(`));
    let i = IPC.indexOf('{', IPC.indexOf(')', start));
    for (let depth = 0; i < IPC.length; i++) {
      if (IPC[i] === '{') depth++;
      else if (IPC[i] === '}' && --depth === 0) return IPC.slice(start + 1, i + 1);
    }
    throw new Error(name);
  };
  const ctx = {
    console, Object, String, Number, Boolean, Buffer, crypto, JSON, Error,
    readSetting: async (k, fb) => (h.S.has(k) ? h.S.get(k) : fb),
    verifySecret,
    rememberStore: { read: () => h.remembered.blob, clear: () => { h.remembered.blob = null; } },
    database: { isDbEncryptionEnabled: () => false, isDbUnlocked: () => true },
    superLogin: async () => { throw new Error('not used'); },
    memberLogin: async () => { throw new Error('not used'); },
    permissions: { isSuperAdminId: () => false },
    getPrisma: () => ({ member: { findUnique: async ({ where }) => h.members.find((m) => m.id === where.id) || null, count: async () => h.members.length } }),
    licenseClient: { api: new Proxy({}, { get: () => async () => { throw Object.assign(new Error('offline'), { network: true }); } }) }
  };
  vm.createContext(ctx);
  vm.runInContext(`let currentMemberId = null; let vaultLocked = false; let vaultUnlockSource = null;
    ${fn('readVault')}\n${fn('restoreSession')}\n${fn('attemptRememberedUnlock')}\n${fn('ipcAuthState')}\n${fn('vaultStatus')}
    this.run = async () => { await restoreSession(); const locked = vaultLocked; const r = await attemptRememberedUnlock(); return { locked, r, vaultLocked, vaultUnlockSource, currentMemberId, auth: await ipcAuthState(), status: await vaultStatus() }; };`, ctx);
  const callsBefore = h.server.calls.length;
  const out = await ctx.run();
  assert.equal(out.locked, true, 'the one-click workspace has a vault, locked at start');
  assert.equal(out.r.unlocked, true, 'the remembered device key opens it');
  assert.equal(out.vaultLocked, false);
  assert.equal(out.vaultUnlockSource, 'vault');
  assert.equal(out.currentMemberId, h.members[0].id, 'the Owner is signed in again');
  assert.deepEqual({ ...out.auth }, { vaultLocked: false, signedIn: true, memberCount: 0 });
  assert.equal(out.status.signIn, true);
  assert.equal(h.server.calls.length, callsBefore, 'the start never asked the server');
});

test('Sign out, then the same account opens the workspace again; another account is refused', async () => {
  const h = harness();
  await h.svc.start({ provider: 'github', purpose: 'signup' });
  const ownerId = h.members[0].id;
  const keyBefore = h.keychain.read().deviceKey;
  await h.svc.signOut();
  h.memberLogout();
  assert.equal(h.server.calls.find((c) => c.name === 'logout').args.session.length, 43, 'the server session is ended');
  assert.equal(h.keychain.read().session, null);
  assert.equal(h.keychain.read().deviceKey, keyBefore, 'the workspace key stays on this computer');
  assert.equal(h.remembered.blob, null);
  assert.equal(h.st.vaultLocked, true);
  const info = await h.svc.info();
  assert.equal(info.purpose, 'unlock');
  assert.equal(info.account.email, 'ada@example.com');

  // Another GitHub account: refused by the server (expectCustomerId) and the workspace stays locked.
  h.server.githubProfile = { email: 'mallory@example.com', name: 'Mallory' };
  await assert.rejects(h.svc.start({ provider: 'github', purpose: 'unlock' }), (e) => e.code === 'SIGNIN_ACCOUNT_MISMATCH');
  assert.equal(h.server.calls.filter((c) => c.name === 'exchange').pop().args.expectCustomerId, 'cust_2');
  assert.equal(h.st.vaultLocked, true);
  assert.equal(h.st.currentMemberId, null);
  // The email path refuses another address before asking the server.
  const before = h.server.calls.length;
  await assert.rejects(h.svc.emailStart({ email: 'mallory@example.com', purpose: 'unlock' }), (e) => e.code === 'SIGNIN_EMAIL_MISMATCH');
  assert.equal(h.server.calls.length, before);

  // The owner's own account opens it.
  h.server.githubProfile = { email: 'ada@example.com', name: 'Ada Lovelace' };
  const r = await h.svc.start({ provider: 'github', purpose: 'unlock' });
  assert.equal(r.outcome, 'unlocked');
  assert.equal(h.st.vaultLocked, false);
  assert.equal(h.st.vaultUnlockSource, 'vault');
  assert.equal(h.st.currentMemberId, ownerId);
  assert.deepEqual(h.remembered.blob, { kind: 'vault', password: keyBefore });
  assert.ok(h.keychain.read().session);

  // And by email code.
  await h.svc.signOut(); h.memberLogout();
  await h.svc.emailStart({ email: 'ada@example.com', purpose: 'unlock', lang: 'es' });
  assert.equal(h.server.calls.filter((c) => c.name === 'emailStart').pop().args.lang, 'es');
  await assert.rejects(h.svc.emailVerify({ email: 'ada@example.com', code: '000000', purpose: 'unlock' }), (e) => e.code === 'SIGNUP_BAD_CODE');
  const r2 = await h.svc.emailVerify({ email: 'ada@example.com', code: '123456', purpose: 'unlock' });
  assert.equal(r2.outcome, 'unlocked');
  assert.equal(h.server.calls.filter((c) => c.name === 'emailVerify').pop().args.expectCustomerId, 'cust_2');
});

test('a lost workspace key is replaced after a verified sign-in, unless the database is encrypted with it', async () => {
  const h = harness();
  await h.svc.start({ provider: 'github', purpose: 'signup' });
  await h.svc.signOut(); h.memberLogout();
  h.keychain.write({ ...h.keychain.read(), deviceKey: null }); // e.g. another Windows user
  const oldHash = h.S.get('vault').hash;
  await h.svc.start({ provider: 'github', purpose: 'unlock' });
  const v = h.S.get('vault');
  assert.notEqual(v.hash, oldHash);
  assert.ok(verifySecret(h.keychain.read().deviceKey, v.salt, v.hash));
  assert.equal(h.st.vaultLocked, false);

  const enc = harness({ dbEncrypted: true });
  await enc.svc.start({ provider: 'github', purpose: 'signup' });
  await enc.svc.signOut(); enc.memberLogout();
  enc.keychain.write({ ...enc.keychain.read(), deviceKey: 'wrong' });
  await assert.rejects(enc.svc.start({ provider: 'github', purpose: 'unlock' }), (e) => e.code === 'SIGNIN_KEY_LOST');
  assert.equal(enc.st.vaultLocked, true);
});

test('sign-in on another PC: the existing account is found and its licence can be moved here', async () => {
  const h = harness();
  h.server.githubProfile = { email: 'grace@example.com', name: 'Grace Hopper' };
  const r = await h.svc.start({ provider: 'github', purpose: 'signup' });
  assert.equal(r.outcome, 'created');
  assert.equal(r.askUseCase, false, 'the account already answered the question');
  assert.deepEqual(r.licence, { state: 'elsewhere' });
  assert.equal(h.S.get('tenantCustomer').customerId, 'cust_existing');
  assert.deepEqual(await h.svc.licenceState(), { state: 'elsewhere' });
  const m = await h.svc.moveLicence();
  assert.deepEqual(m, { moved: true, remaining: 1 });
  assert.equal(h.leases, 1, 'the lease is fetched for this computer');
  h.server.moveLimit = true;
  await assert.rejects(h.svc.moveLicence(), (e) => e.code === 'MOVE_LIMIT' && Boolean(e.retryAt));
});

test('Continue with email on a new workspace (tenant build)', async () => {
  const h = harness();
  const s = await h.svc.emailStart({ email: ' Mia@Example.com ', purpose: 'signup', lang: 'en' });
  assert.deepEqual(s, { sent: true, devMode: false });
  assert.equal(h.server.calls.find((c) => c.name === 'emailStart').args.email, 'mia@example.com');
  await assert.rejects(h.svc.emailStart({ email: 'nope', purpose: 'signup' }), (e) => e.code === 'SIGNIN_BAD_INPUT');
  await assert.rejects(h.svc.emailVerify({ email: 'mia@example.com', code: '12', purpose: 'signup' }), (e) => e.code === 'SIGNUP_BAD_CODE');
  const r = await h.svc.emailVerify({ email: 'mia@example.com', code: '123456', purpose: 'signup' });
  assert.equal(r.outcome, 'created');
  assert.equal(h.members[0].name, 'Mia', 'no name from an email sign-in: the address gives one');
  assert.equal(h.keychain.read().provider, 'email');
  // Rate limits and the other email rules come back as the sign-up texts.
  const h2 = harness();
  h2.server.api.authEmailStart = async () => { throw httpErr(429, 'rate_limited'); };
  await assert.rejects(h2.svc.emailStart({ email: 'a@example.com', purpose: 'signup' }), (e) => e.code === 'RATE_LIMITED');
  h2.server.api.authEmailStart = async () => { throw httpErr(400, 'disposable_email'); };
  await assert.rejects(h2.svc.emailStart({ email: 'a@mailinator.com', purpose: 'signup' }), (e) => e.code === 'SIGNUP_DISPOSABLE_EMAIL');
});

test('server and network failures become plain app codes', async () => {
  const h = harness();
  h.server.online = false;
  await assert.rejects(h.svc.start({ provider: 'github', purpose: 'signup' }), (e) => e.code === 'SIGNIN_OFFLINE');
  assert.deepEqual(await h.svc.providers({ fresh: true }), [], 'no server: no GitHub button');
  h.server.online = true;
  h.server.api.authExchange = async () => { throw httpErr(400, 'invalid_grant'); };
  await assert.rejects(h.svc.start({ provider: 'github', purpose: 'signup' }), (e) => e.code === 'SIGNIN_EXPIRED');
  h.server.api.authExchange = async () => { throw httpErr(404); };
  await assert.rejects(h.svc.start({ provider: 'github', purpose: 'signup' }), (e) => e.code === 'SIGNIN_UNAVAILABLE', 'a server without /auth');
  h.server.api.authExchange = async () => { throw httpErr(403, 'email_not_verified'); };
  await assert.rejects(h.svc.start({ provider: 'github', purpose: 'signup' }), (e) => e.code === 'SIGNIN_EMAIL_NOT_VERIFIED');
  assert.equal(h.members.length, 0, 'nothing was created by a failed sign-in');
  assert.equal(h.S.get('vault'), undefined);
});

test('base build: no GitHub; Continue with email uses the local code', async () => {
  const h = harness({ tenant: false });
  const info = await h.svc.info();
  assert.deepEqual(info.providers, []);
  assert.equal(info.tenant, false);
  await assert.rejects(h.svc.start({ provider: 'github', purpose: 'signup' }), (e) => e.code === 'SIGNIN_UNAVAILABLE');
  const s = await h.svc.emailStart({ email: 'local@example.com', purpose: 'signup' });
  assert.equal(s.devMode, true);
  assert.equal(s.devCode, h.otps[0].code);
  assert.equal(h.server.calls.length, 0, 'the base build never calls a server');
  await assert.rejects(h.svc.emailVerify({ email: 'local@example.com', code: '000000' === s.devCode ? '111111' : '000000', purpose: 'signup' }), (e) => e.code === 'SIGNUP_BAD_CODE');
  const r = await h.svc.emailVerify({ email: 'local@example.com', code: s.devCode, purpose: 'signup' });
  assert.equal(r.outcome, 'created');
  assert.equal(h.S.get('tenantCustomer'), undefined);
  assert.equal(h.recorded, 0);
});

test('old workspaces are not affected', async () => {
  // A password workspace from before 1.0.26: Owner + password vault, locked.
  const pw = hashSecret('owner-password');
  const owner = { id: 1, name: 'Old Owner', email: 'old@example.com', role: 'OWNER', createdAt: new Date() };
  const h = harness({ members: [owner], settings: { vault: { enabled: true, ...pw, autoLockMinutes: 0 }, account: { email: 'old@example.com', firstName: 'Old' }, tenantCustomer: { customerId: 'cust_old', email: 'old@example.com' } } });
  h.st.vaultLocked = true;
  assert.equal((await h.svc.info()).purpose, null, 'no sign-in screen: the password screen stays');
  await assert.rejects(h.svc.start({ provider: 'github', purpose: 'unlock' }), (e) => e.code === 'SIGNIN_NOT_ALLOWED');
  await assert.rejects(h.svc.start({ provider: 'github', purpose: 'signup' }), (e) => e.code === 'ALREADY_SETUP');
  await assert.rejects(h.svc.emailStart({ email: 'old@example.com', purpose: 'unlock' }), (e) => e.code === 'SIGNIN_NOT_ALLOWED');
  await assert.rejects(h.svc.start({ provider: 'github', purpose: 'link' }), (e) => e.code === 'SIGNIN_NOT_ALLOWED', 'locked: no link either');
  assert.equal(h.server.calls.filter((c) => c.name !== 'providers').length, 0);
  assert.deepEqual(h.S.get('vault').hash, pw.hash, 'the vault is untouched');
  // Signed in with the password, the Owner may add GitHub from Settings (link); the vault does not change.
  h.st.vaultLocked = false; h.st.currentMemberId = 1;
  h.server.customers.push({ id: 'cust_old', email: 'old@example.com', name: 'Old Owner', useCase: null });
  h.server.githubProfile = { email: 'old@example.com', name: 'Old Owner' };
  const r = await h.svc.start({ provider: 'github', purpose: 'link' });
  assert.equal(r.outcome, 'linked');
  assert.equal(h.server.calls.find((c) => c.name === 'exchange').args.expectCustomerId, 'cust_old');
  assert.deepEqual(h.S.get('vault').hash, pw.hash);
  assert.equal(h.remembered.blob, null, 'no remembered credential is added');
  assert.equal((await h.svc.account()).signedIn, true);
  // Nobody signed in on a workspace with members: link refused (the channel is callable before sign-in).
  h.st.currentMemberId = null;
  await assert.rejects(h.svc.start({ provider: 'github', purpose: 'link' }), (e) => e.code === 'SIGNIN_NOT_ALLOWED');
  // The old sign-up form and password unlock are still in the Gate, under More options / the password screen.
  const gate = read('src', 'renderer', 'components', 'Gate.jsx');
  assert.match(gate, /phase === 'register' && step === 'details'/);
  assert.match(gate, /phase === 'login' && !vaultSignIn/);
  assert.match(gate, /await softglazeApi\.account\.register\(\{/);
  // vaultStatus / vault calls treat only a one-click vault differently.
  const IPC = read('src', 'main', 'ipcHandlers.js');
  assert.match(IPC, /signIn: Boolean\(v\.enabled && v\.signIn\)/);
  assert.match(IPC, /if \(t \|\| !v \|\| !v\.signIn \|\| vaultLocked\) return t;/, 'a typed password is always used; the device key only for an open one-click workspace');
  assert.match(IPC, /if \(!v\.enabled \|\| !v\.hash \|\| v\.signIn\) \{/, 'database encryption needs a password a person knows');
});

test('Settings > Account: methods, offline, sign out', async () => {
  const h = harness();
  await h.svc.start({ provider: 'github', purpose: 'signup' });
  const a = await h.svc.account();
  assert.equal(a.signedIn, true);
  assert.equal(a.signInWorkspace, true);
  assert.deepEqual(a.methods, [{ provider: 'github', login: 'ada' }]);
  h.server.online = false;
  const off = await h.svc.account();
  assert.equal(off.offline, true);
  assert.deepEqual(off.methods, [{ provider: 'github', login: 'ada' }], 'what this computer saved');
  h.server.online = true;
  h.server.api.authMe = async () => { throw httpErr(401, 'session_invalid'); };
  const ended = await h.svc.account();
  assert.equal(ended.signedIn, false);
  assert.equal(h.keychain.read().deviceKey.length, 43, 'an ended session never removes the workspace key');
});

test('the sealed account record uses safeStorage and is never written in clear', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sg-acct-'));
  try {
    const fake = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s, 'utf8').reverse(), decryptString: (b) => Buffer.from(b).reverse().toString('utf8') };
    const store = createAccountSession({ safeStorage: fake, dir: () => dir });
    assert.equal(store.write({ email: 'a@example.com', session: 'tok', deviceKey: 'key' }), true);
    const raw = fs.readFileSync(path.join(dir, 'softglaze-account.bin'));
    assert.ok(!raw.toString('utf8').includes('tok') && !raw.toString('utf8').includes('a@example.com'));
    store.signOut();
    assert.deepEqual({ ...store.read(), sessionAt: undefined }, { v: 1, email: 'a@example.com', session: null, sessionAt: undefined, methods: [], deviceKey: 'key' });
    const off = createAccountSession({ safeStorage: { isEncryptionAvailable: () => false }, dir: () => dir });
    assert.equal(off.write({ session: 'x' }), false, 'no OS encryption: nothing is written');
    assert.equal(off.read(), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- packaging --------------------------------------------------------------------------------------
test('the Store manifest and the installer register softglaze://', async () => {
  const pkg = require('../package.json');
  assert.deepEqual(pkg.build.protocols, [{ name: 'SoftGlaze Browser', schemes: ['softglaze'] }]);
  const cfgPath = require.resolve('../electron-builder.store.js');
  const old = process.env.SG_STORE_COMMERCE;
  process.env.SG_STORE_COMMERCE = '0';
  let cfg;
  try { delete require.cache[cfgPath]; cfg = require(cfgPath); } finally {
    if (old === undefined) delete process.env.SG_STORE_COMMERCE; else process.env.SG_STORE_COMMERCE = old;
    delete require.cache[cfgPath];
  }
  assert.deepEqual(cfg.protocols, pkg.build.protocols, 'the Store config inherits the protocol');
  // electron-builder's own AppX code writes the manifest extension from it.
  const AppXTarget = require('app-builder-lib/out/targets/AppxTarget').default;
  const fakeThis = { packager: { config: cfg, platformSpecificBuildOptions: cfg.win, info: { metadata: { dependencies: pkg.dependencies } } }, options: cfg.appx };
  const ext = await AppXTarget.prototype.getExtensions.call(fakeThis, 'app\\SoftGlaze Browser.exe', 'SoftGlaze Browser');
  assert.match(ext, /<uap:Extension Category="windows\.protocol">\s*<uap:Protocol Name="softglaze">\s*<uap:DisplayName>SoftGlaze Browser<\/uap:DisplayName>/);
  assert.match(read('node_modules', 'app-builder-lib', 'templates', 'appx', 'appxmanifest.xml'), /\$\{extensions\}/, 'the template places it');
  // scripts/build-store.js rewrites only the version floor, so the extension survives.
  const bs = read('scripts', 'build-store.js');
  assert.ok(!/Extensions|uap:Protocol/.test(bs.slice(bs.indexOf('async function fixManifest'), bs.indexOf('(async () =>'))));

  const nsh = read('build', 'installer.nsh');
  assert.match(nsh, /!macro customInstall[\s\S]*WriteRegStr SHCTX "Software\\Classes\\softglaze" "URL Protocol" ""[\s\S]*WriteRegStr SHCTX "Software\\Classes\\softglaze\\shell\\open\\command" "" '"\$appExe" "%1"'[\s\S]*!macroend/);
  assert.match(nsh, /!macro customUnInstall[\s\S]*DeleteRegKey SHCTX "Software\\Classes\\softglaze"[\s\S]*!macroend/);
  const main = read('src', 'main', 'main.js');
  assert.match(main, /app\.setAsDefaultProtocolClient\(AUTH_SCHEME\)/);
  assert.match(main, /if \(!process\.windowsStore\)/, 'the Store package is registered by its manifest');
  assert.match(main, /app\.on\('second-instance', \(_event, argv\) => \{\s*\/\/[^\n]*\n\s*deliverAuthUrl\(argv\);/);
});

test('IPC: the sign-in channels callable before sign-in, preload and the renderer API match', () => {
  const gate = require('../src/main/authGate');
  for (const ch of ['signin:info', 'signin:start', 'signin:cancel', 'signin:email-start', 'signin:email-verify']) assert.ok(gate.isPreAuthChannel(ch), ch);
  for (const ch of ['signin:account', 'signin:sign-out', 'signin:use-case', 'signin:licence-state', 'signin:move-licence']) {
    assert.ok(!gate.isPreAuthChannel(ch), `${ch} needs a signed-in member`);
    assert.deepEqual(gate.decide(ch, { vaultLocked: true }).code, 'VAULT_LOCKED');
  }
  const IPC = read('src', 'main', 'ipcHandlers.js');
  const pre = read('src', 'preload', 'preload.js');
  for (const m of IPC.matchAll(/(SIGNIN_[A-Z_]+): '(signin:[a-z-]+)'/g)) {
    assert.ok(pre.includes(`${m[1]}: '${m[2]}'`), `preload has ${m[1]}`);
    assert.ok(IPC.includes(`registerHandler(CHANNELS.${m[1]},`), `${m[1]} is registered`);
  }
  const api = read('src', 'renderer', 'lib', 'softglazeApi.js');
  for (const k of ['info', 'start', 'cancel', 'emailStart', 'emailVerify', 'account', 'signOut', 'saveUseCase', 'licenceState', 'moveLicence']) assert.match(api, new RegExp(`\\n\\s+${k}: `), k);
  // The session token and the device key never reach the renderer.
  const svc = read('src', 'main', 'oneClickSignIn.js');
  for (const fnName of ['createWorkspace', 'unlockWorkspace', 'linkWorkspace']) {
    const body = svc.slice(svc.indexOf(`async function ${fnName}(`));
    const ret = body.slice(body.indexOf('return {'), body.indexOf('};', body.indexOf('return {')));
    assert.ok(!/session|deviceKey|key\b/.test(ret), `${fnName} returns no secret`);
  }
});

// ---- renderer --------------------------------------------------------------------------------------
test('renderer rules and texts (en and es)', async () => {
  const f = await import(pathToFileURL(path.join(ROOT, 'src', 'renderer', 'lib', 'signInFlow.mjs')).href);
  const t = (k) => `signin:${k}`;
  const tg = (k) => `gate:${k}`;
  assert.equal(f.signInErrorText(t, tg, { code: 'SIGNIN_CANCELLED' }), null, 'cancelling shows nothing');
  assert.equal(f.signInErrorText(t, tg, { code: 'SIGNIN_OFFLINE' }), 'signin:errors.SIGNIN_OFFLINE');
  assert.equal(f.signInErrorText(t, tg, { code: 'SIGNUP_BAD_CODE' }), 'gate:serverErrors.SIGNUP_BAD_CODE');
  assert.equal(f.signInErrorText(t, tg, { code: 'RATE_LIMITED' }), 'gate:serverErrors.RATE_LIMITED');
  assert.equal(f.signInErrorText(t, tg, { message: 'x' }), 'x');
  assert.equal(f.showGithub({ tenant: true, providers: ['github'] }), true);
  assert.equal(f.showGithub({ tenant: false, providers: ['github'] }), false, 'base build: hidden');
  assert.equal(f.showGithub({ tenant: true, providers: [] }), false, 'server without GitHub keys: hidden');
  assert.equal(f.showGithub(null), false);
  assert.equal(f.phaseAfterSignIn({ outcome: 'created', askUseCase: true }), 'usecase');
  assert.equal(f.phaseAfterSignIn({ outcome: 'created', askUseCase: false }), 'licensing');
  assert.equal(f.phaseAfterSignIn({ outcome: 'unlocked' }), 'licensing');
  assert.equal(f.canOfferMove({ state: 'elsewhere' }), true);
  assert.equal(f.canOfferMove({ state: 'store' }), false);
  assert.equal(f.moveErrorKey({ code: 'MOVE_LIMIT' }), 'store.result.moveLimit');
  assert.deepEqual(f.methodRows([{ provider: 'email', email: 'a@x' }, { provider: 'google' }, { provider: 'github', login: 'a' }]).map((m) => m.provider), ['github', 'email']);
  assert.equal(f.sixDigits(' 12-34 567 '), '123456');

  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
  const en = JSON.parse(read('src', 'renderer', 'i18n', 'locales', 'en', 'signin.json'));
  const es = JSON.parse(read('src', 'renderer', 'i18n', 'locales', 'es', 'signin.json'));
  assert.deepEqual(keys(es), keys(en), 'Spanish has every English text');
  for (const code of f.SIGNIN_ERROR_CODES) assert.ok(en.errors[code] && es.errors[code], code);
  for (const s of [JSON.stringify(en), JSON.stringify(es)]) assert.ok(!/[–—]/.test(s), 'no em or en dashes');
  const idx = read('src', 'renderer', 'i18n', 'index.js');
  assert.match(idx, /signin: signinEn/);
  assert.match(idx, /signin: signinEs/);
  assert.match(idx, /'signin',/);
  // The billing texts the move uses exist in both languages.
  for (const lang of ['en', 'es']) {
    const b = JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, 'billing.json'));
    assert.ok(b.store.result.inUse && b.store.result.moveLimit && b.store.moveHere, lang);
  }
  // Every key the components use exists.
  const used = [...read('src', 'renderer', 'components', 'SignInPanel.jsx').matchAll(/\bt\('([a-zA-Z.]+)'/g), ...read('src', 'renderer', 'components', 'SignInMethodsCard.jsx').matchAll(/\bt\('([a-zA-Z.]+)'/g), ...read('src', 'renderer', 'components', 'Gate.jsx').matchAll(/\bts\('([a-zA-Z.]+)'/g)].map((m) => m[1]);
  const get = (o, k) => k.split('.').reduce((c, p) => (c == null ? c : c[p]), o);
  for (const k of used) assert.ok(typeof get(en, k) === 'string', `signin.json has ${k}`);
});
