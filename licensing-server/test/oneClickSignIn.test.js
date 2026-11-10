'use strict';
// One-click sign-in (app 1.0.26) over HTTP against the real routes, with GitHub replaced by a fake that checks
// what a real GitHub checks (client secret, redirect URI, PKCE verifier). No real GitHub call is made.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const H = require('./helpers/harness');
const github = require('../src/auth/providers/github');
const { checkAppRedirect } = require('../src/auth/tokens');
const { applyRetention } = require('../src/privacy/retention');
const { getSettings } = require('../src/settings');
const { eraseCustomer } = require('../src/customers/erase');

const { db, mail, call } = H;
let T;
let base;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const b64url = (b) => Buffer.from(b).toString('base64url');
function pkce() {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}
const appState = () => b64url(crypto.randomBytes(24));

// The fake GitHub: users by code. Each authorize URL's challenge is remembered by its state, and the token
// endpoint checks the verifier against it, like GitHub does.
const gh = {
  challenges: new Map(), // github code -> code_challenge
  users: new Map(), // github code -> { user, emails, tokenError }
  calls: [],
  reset() { this.challenges.clear(); this.users.clear(); this.calls = []; }
};
function fakeResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}
github.setFetchForTests(async (url, init = {}) => {
  gh.calls.push({ url: String(url), init });
  const u = new URL(String(url));
  if (u.href.startsWith(github.TOKEN_URL)) {
    const p = new URLSearchParams(init.body);
    if (p.get('client_id') !== 'gh-client-id' || p.get('client_secret') !== 'gh-client-secret') return fakeResponse(200, { error: 'incorrect_client_credentials' });
    if (p.get('redirect_uri') !== 'https://api.test/auth/callback/github') return fakeResponse(200, { error: 'redirect_uri_mismatch' });
    const code = p.get('code');
    const entry = gh.users.get(code);
    const challenge = gh.challenges.get(code);
    if (!entry || !challenge) return fakeResponse(200, { error: 'bad_verification_code' });
    const ok = crypto.createHash('sha256').update(p.get('code_verifier') || '').digest('base64url') === challenge;
    if (!ok) return fakeResponse(200, { error: 'bad_verification_code' });
    if (entry.tokenError) return fakeResponse(200, { error: entry.tokenError });
    gh.users.delete(code); // a GitHub code works once
    return fakeResponse(200, { access_token: `tok_${code}`, token_type: 'bearer', scope: 'read:user,user:email' });
  }
  const auth = (init.headers || {}).authorization || '';
  const code = auth.replace(/^Bearer tok_/, '');
  const entry = gh.lastByToken.get(code);
  if (!entry) return fakeResponse(401, { message: 'Bad credentials' });
  if (u.pathname === '/user') return fakeResponse(200, entry.user);
  if (u.pathname === '/user/emails') return fakeResponse(200, entry.emails);
  return fakeResponse(404, {});
});
gh.lastByToken = new Map();

function githubUser({ id = 4242, login = 'octo', name = 'Octo Cat', email = 'octo@example.com', verified = true, extra = [], tokenError = null } = {}) {
  return {
    user: { id, login, name, email: null },
    emails: [...extra, { email, primary: true, verified, visibility: 'private' }],
    tokenError
  };
}

async function startFlow({ redirect = 'http://127.0.0.1:53111/auth', provider = 'github', challenge, state, method = 'S256', headers = {} } = {}) {
  const q = new URLSearchParams({ provider, tenant: T, app_redirect: redirect, code_challenge: challenge, code_challenge_method: method, state });
  return fetch(`${base}/auth/start?${q}`, { redirect: 'manual', headers });
}

// The browser part: /auth/start, GitHub (fake), /auth/callback. Returns what the app receives.
async function browserSignIn(account, { redirect = 'http://127.0.0.1:53111/auth', cookie: useCookie = true } = {}) {
  const p = pkce();
  const st = appState();
  const s = await startFlow({ redirect, challenge: p.challenge, state: st });
  assert.equal(s.status, 302, await s.text());
  const loc = new URL(s.headers.get('location'));
  const setCookie = s.headers.getSetCookie().find((c) => c.startsWith('sg_auth_'));
  const ghCode = `ghc_${crypto.randomBytes(6).toString('hex')}`;
  gh.challenges.set(ghCode, loc.searchParams.get('code_challenge'));
  gh.users.set(ghCode, account);
  gh.lastByToken.set(ghCode, account);
  const cookie = setCookie.split(';')[0];
  const cb = await fetch(`${base}/auth/callback/github?code=${ghCode}&state=${encodeURIComponent(loc.searchParams.get('state'))}`, {
    redirect: 'manual', headers: useCookie ? { cookie } : {}
  });
  return { p, appState: st, start: s, authorize: loc, setCookie, cookie, callback: cb, serverState: loc.searchParams.get('state'), ghCode };
}

function appResult(cb) {
  const loc = cb.headers.get('location');
  return loc ? new URL(loc) : null;
}

const exchange = (inst, body) => call('POST', '/auth/exchange', { body: { tenantId: T, ...inst, ...body } });

test.before(async () => {
  base = await H.start();
  T = (await H.seedTenant()).id;
  process.env.GITHUB_CLIENT_ID = 'gh-client-id';
  process.env.GITHUB_CLIENT_SECRET = 'gh-client-secret';
});
test.after(() => H.stop());

test('redirect allow-list: only softglaze://auth and http://127.0.0.1:<port>/auth', () => {
  assert.deepEqual(checkAppRedirect('softglaze://auth'), { uri: 'softglaze://auth', kind: 'protocol' });
  assert.equal(checkAppRedirect('http://127.0.0.1:53111/auth').kind, 'loopback');
  for (const bad of ['softglaze://auth/', 'softglaze://other', 'SOFTGLAZE://auth', 'http://localhost:53111/auth', 'http://127.0.0.1/auth',
    'http://127.0.0.1:80/auth', 'http://127.0.0.1:053111/auth', 'http://127.0.0.1:53111/auth?x=1', 'http://127.0.0.1:53111/authx',
    'https://127.0.0.1:53111/auth', 'http://127.0.0.1:99999/auth', 'https://evil.example/auth', 'http://user@127.0.0.1:53111/auth', '', null]) {
    assert.equal(checkAppRedirect(bad), null, String(bad));
  }
});

test('GET /auth/providers lists GitHub only when its keys are set', async () => {
  const on = await call('GET', `/auth/providers?tenantId=${T}`);
  assert.deepEqual(on.json, { providers: ['github'], email: true });
  delete process.env.GITHUB_CLIENT_SECRET;
  const off = await call('GET', `/auth/providers?tenantId=${T}`);
  assert.deepEqual(off.json.providers, []);
  const p = pkce();
  const s = await startFlow({ challenge: p.challenge, state: appState() });
  assert.equal(s.status, 503, 'no keys: the sign-in is not available');
  assert.match(await s.text(), /not available yet/);
  process.env.GITHUB_CLIENT_SECRET = 'gh-client-secret';
  assert.equal((await call('GET', '/auth/providers?tenantId=nope')).status, 404);
});

test('the full GitHub flow: start, callback, exchange, account, trial', async () => {
  const inst = await H.newInstall(T, 'gh-full');
  const acct = githubUser({ id: 1001, login: 'ada', name: 'Ada Lovelace', email: 'Ada@Example.com', extra: [{ email: 'old@example.com', primary: false, verified: true }] });
  const f = await browserSignIn(acct);

  // /auth/start sent the browser to GitHub with our own state and PKCE, the exact callback and the two scopes.
  assert.equal(f.authorize.origin + f.authorize.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(f.authorize.searchParams.get('client_id'), 'gh-client-id');
  assert.equal(f.authorize.searchParams.get('redirect_uri'), 'https://api.test/auth/callback/github');
  assert.equal(f.authorize.searchParams.get('scope'), 'read:user user:email');
  assert.equal(f.authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.notEqual(f.serverState, f.appState, 'the provider gets the server state, never the app state');
  assert.notEqual(f.authorize.searchParams.get('code_challenge'), f.p.challenge, 'and its own PKCE challenge');
  assert.match(f.setCookie, /HttpOnly/i);
  assert.match(f.setCookie, /SameSite=Lax/i);
  assert.match(f.setCookie, /Path=\/auth\/callback/i);
  const stRow = db.tables.authState.find((r) => r.appState === f.appState);
  assert.equal(stRow.stateHash, sha(f.serverState), 'only the hash of the state is stored');
  assert.ok(!JSON.stringify(stRow).includes(f.serverState));

  // The callback hands the app a one-time code at the loopback redirect, with the app's own state.
  assert.equal(f.callback.status, 302);
  const back = appResult(f.callback);
  assert.equal(back.origin + back.pathname, 'http://127.0.0.1:53111/auth');
  assert.equal(back.searchParams.get('state'), f.appState);
  const code = back.searchParams.get('code');
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  const tokenCall = gh.calls.find((c) => c.url.startsWith(github.TOKEN_URL) && new URLSearchParams(c.init.body).get('code') === f.ghCode);
  assert.equal(tokenCall.init.headers.accept, 'application/json');
  const userCall = gh.calls.find((c) => c.url === 'https://api.github.com/user' && c.init.headers.authorization === `Bearer tok_${f.ghCode}`);
  assert.equal(userCall.init.headers.accept, 'application/vnd.github+json');
  assert.ok(userCall.init.headers['x-github-api-version']);
  assert.ok(!db.tables.authCode.some((r) => JSON.stringify(r).includes(code)), 'only the hash of the app code is stored');
  assert.ok(!JSON.stringify(db.tables).includes(`tok_${f.ghCode}`), 'the GitHub token is never stored');

  const r = await exchange(inst, { code, codeVerifier: f.p.verifier });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.provider, 'github');
  assert.equal(r.json.isNew, true);
  assert.equal(r.json.linked, 'new');
  assert.equal(r.json.customer.email, 'ada@example.com', 'the PRIMARY verified email, normalised');
  assert.equal(r.json.customer.name, 'Ada Lovelace');
  assert.match(r.json.session, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(r.json.licence, { state: 'none' });
  assert.deepEqual(r.json.methods.map((m) => m.provider).sort(), ['email', 'github']);
  const c = db.tables.customer.find((x) => x.id === r.json.customer.id);
  assert.ok(c.emailVerifiedAt, 'GitHub verified the email: no 6-digit code needed');
  const ident = db.tables.identity.find((i) => i.customerId === c.id);
  assert.equal(ident.provider, 'github');
  assert.equal(ident.providerUserId, '1001');
  assert.equal(ident.login, 'ada');
  const sess = db.tables.authSession.find((s) => s.customerId === c.id);
  assert.equal(sess.tokenHash, sha(r.json.session), 'only the session hash is stored');
  assert.equal(sess.installId, inst.installId);
  assert.equal(db.tables.install.find((i) => i.id === inst.installId).customerId, c.id, 'the install is linked');
  assert.ok(db.tables.customerEvent.some((e) => e.customerId === c.id && e.type === 'signed_in' && e.data.provider === 'github'), 'audit trail');

  // The server now treats the install like one whose email was verified by code.
  const st = await call('POST', '/v1/account/status', { body: { tenantId: T, ...inst } });
  assert.deepEqual(st.json, { verified: true, email: 'ada@example.com' });
  const trial = await call('POST', '/v1/trial/start', { body: { tenantId: T, ...inst, email: 'ada@example.com' } });
  assert.equal(trial.status, 200, trial.text);
  assert.equal(trial.json.type, 'trial');

  const me = await call('POST', '/auth/me', { body: { tenantId: T, ...inst, session: r.json.session } });
  assert.equal(me.status, 200);
  assert.equal(me.json.customer.email, 'ada@example.com');
  assert.ok(me.json.methods.some((m) => m.provider === 'github' && m.login === 'ada'));

  const prof = await call('POST', '/auth/profile', { body: { tenantId: T, ...inst, session: r.json.session, useCase: 'agency' } });
  assert.equal(prof.status, 200);
  assert.equal(db.tables.customer.find((x) => x.id === c.id).useCase, 'agency');
  const badProf = await call('POST', '/auth/profile', { body: { tenantId: T, ...inst, session: r.json.session, useCase: 'hacking' } });
  assert.equal(badProf.status, 400);
});

test('the protocol redirect gets a page with a button and a refresh to softglaze://auth', async () => {
  const f = await browserSignIn(githubUser({ id: 1002, email: 'proto@example.com' }), { redirect: 'softglaze://auth' });
  assert.equal(f.callback.status, 200);
  const html = await f.callback.text();
  const m = /href="(softglaze:\/\/auth\?[^"]+)"/.exec(html);
  assert.ok(m, 'a button to the app');
  const url = new URL(m[1].replace(/&amp;/g, '&'));
  assert.equal(url.searchParams.get('state'), f.appState);
  assert.match(url.searchParams.get('code'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(html, /http-equiv="refresh"/);
  assert.match(f.callback.headers.get('content-security-policy'), /default-src 'none'/);
  assert.ok(!/<script/i.test(html), 'no script on the page');
});

test('a primary email that is not verified is refused (no code, no customer)', async () => {
  const codesBefore = db.tables.authCode.length;
  const customersBefore = db.tables.customer.length;
  const f = await browserSignIn(githubUser({ id: 1003, email: 'unverified@example.com', verified: false, extra: [{ email: 'other@example.com', primary: false, verified: true }] }));
  const back = appResult(f.callback);
  assert.equal(back.searchParams.get('error'), 'email_not_verified', 'a verified non-primary address does not count');
  assert.equal(back.searchParams.get('state'), f.appState);
  assert.equal(back.searchParams.get('code'), null);
  // GitHub's own refusal at the token step counts the same.
  const g = await browserSignIn(githubUser({ id: 1004, email: 'x2@example.com', tokenError: 'unverified_user_email' }));
  assert.equal(appResult(g.callback).searchParams.get('error'), 'email_not_verified');
  assert.equal(db.tables.authCode.length, codesBefore);
  assert.equal(db.tables.customer.length, customersBefore);
  assert.ok(!db.tables.identity.some((i) => i.providerUserId === '1003' || i.providerUserId === '1004'));
});

test('a disposable GitHub email is refused like at sign-up', async () => {
  const f = await browserSignIn(githubUser({ id: 1005, email: 'temp@mailinator.com' }));
  assert.equal(appResult(f.callback).searchParams.get('error'), 'disposable_email');
});

test('cancelling at GitHub goes back to the app as cancelled', async () => {
  const p = pkce();
  const st = appState();
  const s = await startFlow({ challenge: p.challenge, state: st });
  const loc = new URL(s.headers.get('location'));
  const cookie = s.headers.getSetCookie().find((c) => c.startsWith('sg_auth_')).split(';')[0];
  const cb = await fetch(`${base}/auth/callback/github?error=access_denied&state=${encodeURIComponent(loc.searchParams.get('state'))}`, { redirect: 'manual', headers: { cookie } });
  const back = appResult(cb);
  assert.equal(back.searchParams.get('error'), 'cancelled');
  assert.equal(back.searchParams.get('state'), st);
});

test('an existing customer with the same verified email is linked, then found by the identity', async () => {
  // Someone who signed up with the 6-digit code before 1.0.26 (Gmail dots and case fold to the same key).
  const old = await H.newInstall(T, 'gh-old');
  const v = await H.verify(T, old, 'grace.hopper@gmail.com');
  assert.equal(v.status, 200);
  const cid = v.json.customerId;
  // A paid licence on the old computer.
  await db.license.create({ data: { tenantId: T, installId: old.installId, customerId: cid, tier: 'enterprise', status: 'active', currentPeriodEnd: new Date(Date.now() + 20 * 86400000), providerRef: 'inv-1' } });

  const pc2 = await H.newInstall(T, 'gh-pc2');
  const f = await browserSignIn(githubUser({ id: 2001, login: 'grace', email: 'GraceHopper@gmail.com' }));
  const r = await exchange(pc2, { code: appResult(f.callback).searchParams.get('code'), codeVerifier: f.p.verifier });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.customer.id, cid, 'the same customer');
  assert.equal(r.json.isNew, false);
  assert.equal(r.json.linked, 'email');
  assert.equal(r.json.customer.email, 'grace.hopper@gmail.com', 'the verified address stays as it is');
  assert.equal(r.json.licence.state, 'elsewhere', 'the licence is on the other computer');
  assert.equal(r.json.licence.movesLeft, 2);
  assert.equal(db.tables.customer.filter((x) => x.emailKey === 'gracehopper@gmail.com').length, 1, 'no second customer');

  // Move it here (the app shows billing.json store.result.inUse with "Move it to this computer").
  const noConfirm = await call('POST', '/auth/licence/move', { body: { tenantId: T, ...pc2, session: r.json.session } });
  assert.equal(noConfirm.status, 400);
  const mv = await call('POST', '/auth/licence/move', { body: { tenantId: T, ...pc2, session: r.json.session, move: true } });
  assert.equal(mv.status, 200, mv.text);
  assert.equal(mv.json.moved, true);
  assert.equal(mv.json.remaining, 1);
  const lease = await call('POST', '/v1/license', { body: { tenantId: T, ...pc2 } });
  assert.equal(lease.json.type, 'paid', 'the new computer gets the paid lease');
  const oldLease = await call('POST', '/v1/license', { body: { tenantId: T, ...old } });
  assert.equal(oldLease.json.lease, null, 'the old one does not');

  // Back and forth: the second move is the last in 30 days (store.result.moveLimit after that).
  const fb = await browserSignIn(githubUser({ id: 2001, login: 'grace', email: 'GraceHopper@gmail.com' }));
  const back = await exchange(old, { code: appResult(fb.callback).searchParams.get('code'), codeVerifier: fb.p.verifier });
  assert.equal(back.json.linked, 'identity', 'the second time the GitHub identity finds the customer');
  assert.equal(back.json.licence.state, 'elsewhere');
  assert.equal((await call('POST', '/auth/licence/move', { body: { tenantId: T, ...old, session: back.json.session, move: true } })).status, 200);
  const third = await call('POST', '/auth/licence/move', { body: { tenantId: T, ...pc2, session: r.json.session, move: true } });
  assert.equal(third.status, 429);
  assert.equal(third.json.error, 'move_limit');
  assert.ok(third.json.retryAt);
});

test('replayed and expired codes are refused', async () => {
  const inst = await H.newInstall(T, 'gh-replay');
  const f = await browserSignIn(githubUser({ id: 3001, email: 'replay@example.com' }));
  const code = appResult(f.callback).searchParams.get('code');
  assert.equal((await exchange(inst, { code, codeVerifier: f.p.verifier })).status, 200);
  const again = await exchange(inst, { code, codeVerifier: f.p.verifier });
  assert.equal(again.status, 400);
  assert.equal(again.json.error, 'invalid_grant');

  // A code older than 60 seconds.
  const g = await browserSignIn(githubUser({ id: 3002, email: 'late@example.com' }));
  const late = appResult(g.callback).searchParams.get('code');
  const row = db.tables.authCode.find((x) => x.codeHash === sha(late));
  row.expiresAt = new Date(Date.now() - 1000);
  const exp = await exchange(inst, { code: late, codeVerifier: g.p.verifier });
  assert.equal(exp.status, 400);
  assert.equal(exp.json.error, 'invalid_grant');

  // The callback itself works once, and the browser state expires after 10 minutes.
  const cbAgain = await fetch(`${base}/auth/callback/github?code=x&state=${encodeURIComponent(f.serverState)}`, { redirect: 'manual', headers: { cookie: f.cookie } });
  assert.equal(cbAgain.status, 400);
  assert.match(await cbAgain.text(), /expired/);
  const p = pkce();
  const s = await startFlow({ challenge: p.challenge, state: appState() });
  const loc = new URL(s.headers.get('location'));
  const cookie = s.headers.getSetCookie().find((c) => c.startsWith('sg_auth_')).split(';')[0];
  db.tables.authState.find((x) => x.stateHash === sha(loc.searchParams.get('state'))).expiresAt = new Date(Date.now() - 1);
  const old = await fetch(`${base}/auth/callback/github?code=x&state=${encodeURIComponent(loc.searchParams.get('state'))}`, { redirect: 'manual', headers: { cookie } });
  assert.equal(old.status, 400);
  // A made-up code never reaches the database lookup as valid.
  assert.equal((await exchange(inst, { code: 'A'.repeat(43), codeVerifier: f.p.verifier })).json.error, 'invalid_grant');
});

test('state and PKCE mismatches are refused', async () => {
  const inst = await H.newInstall(T, 'gh-mismatch');
  // Unknown state.
  const unknown = await fetch(`${base}/auth/callback/github?code=x&state=${b64url(crypto.randomBytes(32))}`, { redirect: 'manual' });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.headers.get('location'), null, 'nothing is sent to the app');
  // A callback in a browser that did not start the sign-in (no nonce cookie, or another flow's cookie).
  const noCookie = await browserSignIn(githubUser({ id: 4001, email: 'nocookie@example.com' }), { cookie: false });
  assert.equal(noCookie.callback.status, 400);
  assert.equal(noCookie.callback.headers.get('location'), null);
  const other = await browserSignIn(githubUser({ id: 4002, email: 'a1@example.com' }));
  const p = pkce();
  const s = await startFlow({ challenge: p.challenge, state: appState() });
  const loc = new URL(s.headers.get('location'));
  const swapped = await fetch(`${base}/auth/callback/github?code=x&state=${encodeURIComponent(loc.searchParams.get('state'))}`, {
    redirect: 'manual', headers: { cookie: `${s.headers.getSetCookie()[0].split('=')[0]}=${other.cookie.split('=')[1]}` }
  });
  assert.equal(swapped.status, 400, 'a nonce from another sign-in does not fit');

  // PKCE: the wrong verifier spends the code, so the right one cannot be tried after it.
  const f = await browserSignIn(githubUser({ id: 4003, email: 'pkce@example.com' }));
  const code = appResult(f.callback).searchParams.get('code');
  const wrong = await exchange(inst, { code, codeVerifier: pkce().verifier });
  assert.equal(wrong.json.error, 'invalid_grant');
  const right = await exchange(inst, { code, codeVerifier: f.p.verifier });
  assert.equal(right.json.error, 'invalid_grant');
  assert.equal(db.tables.install.find((i) => i.id === inst.installId).customerId, null, 'nothing was linked');
  // A code for another tenant's sign-in does not work here (same answer).
  await H.seedTenant('tenant2');
  const inst2 = await H.newInstall('tenant2', 'gh-t2');
  const g = await browserSignIn(githubUser({ id: 4004, email: 't2@example.com' }));
  const t2 = await call('POST', '/auth/exchange', { body: { tenantId: 'tenant2', ...inst2, code: appResult(g.callback).searchParams.get('code'), codeVerifier: g.p.verifier } });
  assert.equal(t2.json.error, 'invalid_grant');
});

test('/auth/start refuses bad redirects, plain PKCE, bad state and unknown providers', async () => {
  const p = pkce();
  const st = appState();
  for (const redirect of ['https://evil.example/auth', 'softglaze://auth/x', 'http://localhost:5000/auth', 'http://127.0.0.1:80/auth']) {
    const r = await startFlow({ redirect, challenge: p.challenge, state: st });
    assert.equal(r.status, 400, redirect);
    assert.equal(r.headers.get('location'), null);
  }
  assert.equal((await startFlow({ challenge: p.challenge, state: st, method: 'plain' })).status, 400);
  assert.equal((await startFlow({ challenge: 'short', state: st })).status, 400);
  assert.equal((await startFlow({ challenge: p.challenge, state: 'x' })).status, 400);
  assert.equal((await startFlow({ challenge: p.challenge, state: st, provider: 'facebook' })).status, 400);
  const noTenant = await fetch(`${base}/auth/start?provider=github&tenant=nope&app_redirect=softglaze://auth&code_challenge=${p.challenge}&code_challenge_method=S256&state=${st}`, { redirect: 'manual' });
  assert.equal(noTenant.status, 400);
  assert.equal((await fetch(`${base}/auth/callback/facebook?code=x&state=y`)).status, 404);
});

test('/auth/start is limited per network per hour', async () => {
  const p = pkce();
  const headers = { 'x-forwarded-for': '203.0.113.77' };
  let last;
  for (let i = 0; i < 31; i++) last = await startFlow({ challenge: p.challenge, state: appState(), headers });
  assert.equal(last.status, 429);
  assert.match(await last.text(), /Too many attempts/);
});

test('a workspace that expects its own account refuses another one before anything is written', async () => {
  const inst = await H.newInstall(T, 'gh-expect');
  const f = await browserSignIn(githubUser({ id: 5001, email: 'owner5@example.com' }));
  const first = await exchange(inst, { code: appResult(f.callback).searchParams.get('code'), codeVerifier: f.p.verifier });
  const ownerId = first.json.customer.id;
  const g = await browserSignIn(githubUser({ id: 5002, email: 'intruder@example.com' }));
  const r = await exchange(inst, { code: appResult(g.callback).searchParams.get('code'), codeVerifier: g.p.verifier, expectCustomerId: ownerId });
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'account_mismatch');
  assert.equal(db.tables.install.find((i) => i.id === inst.installId).customerId, ownerId, 'the install stays with its owner');
  assert.ok(!db.tables.customer.some((c) => c.email === 'intruder@example.com'), 'no customer was created');
  // The owner's own GitHub account unlocks it.
  const h = await browserSignIn(githubUser({ id: 5001, email: 'owner5@example.com' }));
  const ok = await exchange(inst, { code: appResult(h.callback).searchParams.get('code'), codeVerifier: h.p.verifier, expectCustomerId: ownerId });
  assert.equal(ok.status, 200);
});

test('continue with email: the 6-digit code is the sign-in, with the same limits', async () => {
  const inst = await H.newInstall(T, 'em-1');
  const startBody = (email) => ({ body: { tenantId: T, ...inst, email, lang: 'en' } });
  const s = await call('POST', '/auth/email/start', startBody('mia@example.com'));
  assert.equal(s.status, 200, s.text);
  assert.ok(!/\d{6}/.test(s.text));
  assert.equal(mail.last().to, 'mia@example.com');
  assert.equal(db.tables.emailOutbox.filter((o) => o.toEmail === 'mia@example.com')[0].templateKey, 'verify_code', 'the same template');
  const again = await call('POST', '/auth/email/start', startBody('mia@example.com'));
  assert.equal(again.status, 429, 'the resend throttle applies');
  assert.equal(again.json.error, 'rate_limited');
  assert.ok(Number(again.headers.get('retry-after')) > 0);
  assert.equal((await call('POST', '/auth/email/start', startBody('x@mailinator.com'))).json.error, 'disposable_email');
  assert.equal((await call('POST', '/auth/email/start', startBody('x@nomail.example'))).json.error, 'no_mx', 'MX check as today');

  const bad = await call('POST', '/auth/email/verify', { body: { tenantId: T, ...inst, email: 'mia@example.com', code: '000000' === mail.codeFor('mia@example.com') ? '111111' : '000000' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, 'invalid_code');
  assert.equal(bad.json.attemptsLeft, 4);
  const ok = await call('POST', '/auth/email/verify', { body: { tenantId: T, ...inst, email: 'mia@example.com', code: mail.codeFor('mia@example.com') } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.provider, 'email');
  assert.equal(ok.json.isNew, true);
  assert.match(ok.json.session, /^[A-Za-z0-9_-]{43}$/);
  const ident = db.tables.identity.find((i) => i.customerId === ok.json.customer.id);
  assert.equal(ident.provider, 'email');
  assert.equal(ident.providerUserId, 'mia@example.com');
  assert.equal((await call('POST', '/v1/account/status', { body: { tenantId: T, ...inst } })).json.verified, true);

  // Per-email hourly cap across installs (verify.maxSendsPerHourPerEmail), like the sign-up code.
  const settings = await getSettings(db, T);
  const cap = settings.verify.maxSendsPerHourPerEmail;
  let res;
  for (let i = 0; i <= cap; i++) {
    const other = await H.newInstall(T, `em-cap-${i}`);
    res = await call('POST', '/auth/email/start', { body: { tenantId: T, ...other, email: 'capped@example.com', lang: 'en' } });
  }
  assert.equal(res.status, 429);

  // expectCustomerId: another address is refused before the code is spent.
  const s2 = await call('POST', '/auth/email/start', startBody('someone-else@example.com'));
  assert.equal(s2.status, 200);
  const mm = await call('POST', '/auth/email/verify', { body: { tenantId: T, ...inst, email: 'someone-else@example.com', code: mail.codeFor('someone-else@example.com'), expectCustomerId: ok.json.customer.id } });
  assert.equal(mm.status, 409);
  assert.equal(mm.json.error, 'account_mismatch');
  assert.equal(db.tables.emailVerification.find((v) => v.emailKey === 'someone-else@example.com').attempts, 0, 'the code was not tried');
});

test('logout revokes the session; a bad token still answers ok', async () => {
  const inst = await H.newInstall(T, 'gh-logout');
  const f = await browserSignIn(githubUser({ id: 6001, email: 'bye@example.com' }));
  const r = await exchange(inst, { code: appResult(f.callback).searchParams.get('code'), codeVerifier: f.p.verifier });
  const out = await call('POST', '/auth/logout', { body: { tenantId: T, ...inst, session: r.json.session } });
  assert.deepEqual(out.json, { ok: true });
  assert.ok(db.tables.authSession.find((s) => s.tokenHash === sha(r.json.session)).revokedAt);
  const me = await call('POST', '/auth/me', { body: { tenantId: T, ...inst, session: r.json.session } });
  assert.equal(me.status, 401);
  assert.equal(me.json.error, 'session_invalid');
  assert.deepEqual((await call('POST', '/auth/logout', { body: { tenantId: T, ...inst, session: 'nope' } })).json, { ok: true });
  // Another install cannot use the token.
  const inst2 = await H.newInstall(T, 'gh-logout-2');
  const f2 = await browserSignIn(githubUser({ id: 6002, email: 'bye2@example.com' }));
  const r2 = await exchange(inst, { code: appResult(f2.callback).searchParams.get('code'), codeVerifier: f2.p.verifier });
  assert.equal((await call('POST', '/auth/me', { body: { tenantId: T, ...inst2, session: r2.json.session } })).status, 401);
  // The app's calls need the install secret.
  assert.equal((await call('POST', '/auth/me', { body: { tenantId: T, installId: inst.installId, installSecret: 'wrong', session: r2.json.session } })).status, 401);
});

test('the admin customer view shows the sign-in methods and sign-ins; erase and retention clean up', async () => {
  const inst = await H.newInstall(T, 'gh-admin');
  const f = await browserSignIn(githubUser({ id: 7001, login: 'linus', email: 'linus@example.com' }));
  const r = await exchange(inst, { code: appResult(f.callback).searchParams.get('code'), codeVerifier: f.p.verifier });
  const cid = r.json.customer.id;
  const d = await H.admin('GET', `/customers/${cid}`);
  assert.equal(d.status, 200, d.text);
  assert.deepEqual(d.json.signInMethods.map((m) => m.provider).sort(), ['email', 'github']);
  assert.equal(d.json.signInMethods.find((m) => m.provider === 'github').login, 'linus');
  assert.equal(d.json.signIns.length, 1);
  assert.equal(d.json.signIns[0].provider, 'github');
  assert.ok(!JSON.stringify(d.json).includes(sha(r.json.session)), 'no token hash in the admin');
  assert.ok(d.json.timeline.some((e) => e.type === 'signed_in'));

  // Retention: browser states and one-time codes older than a day go.
  for (const row of [...db.tables.authState, ...db.tables.authCode]) row.createdAt = new Date(Date.now() - 2 * 86400000);
  const out = await applyRetention(db, { id: T }, { settings: await getSettings(db, T) });
  assert.ok(out.signInRowsDeleted > 0);
  assert.equal(db.tables.authState.filter((x) => x.tenantId === T).length, 0);

  // Privacy erase: the methods and sessions go with the customer.
  await eraseCustomer(db, T, cid);
  assert.ok(!db.tables.identity.some((i) => i.customerId === cid));
  assert.ok(!db.tables.authSession.some((s) => s.customerId === cid));
});
