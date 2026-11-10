'use strict';
// One-click sign-in (1.0.26): "Continue with GitHub" and "Continue with email" (a 6-digit code, no password).
// What main does with a verified sign-in, for three purposes:
//
//   signup  a new workspace: the Owner is created from the verified name and email (no long form) and the
//           workspace opens; the free trial then starts from the plan step as before;
//   unlock  a workspace made by one-click sign-in, after Sign out: the same account opens it again (another
//           account is refused, by the server before anything is written and here again);
//   link    an existing workspace's Owner signs in from Settings > Account (the workspace is not changed).
//
// A workspace made by one-click sign-in has no password a person knows: its vault key is a random device key,
// sealed with safeStorage (accountSession.js) and kept as the "Keep me signed in" credential, so the workspace
// opens offline at every start like today's remembered password, and daily use never needs our server. Sign
// out forgets the remembered credential and the server session; signing in again with the same account opens
// it. The Owner can still add a password (Settings > Account), which then works offline too.
//
// Tenant builds sign in at our licensing server (licensing-server/src/auth/). Base builds (no server) have no
// GitHub button; "Continue with email" uses the local code (SMTP, or shown in the app as at today's sign-up).
// Every dependency is passed in, so tests run the real logic against fakes (test/oneClickSignIn.test.js).
const crypto = require('node:crypto');
const { mapServerError } = require('./serverErrors');

const PURPOSES = Object.freeze(['signup', 'unlock', 'link']);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PROVIDERS_TTL_MS = 5 * 60000;

const MESSAGES = Object.freeze({
  SIGNIN_OFFLINE: 'Connect to the internet to sign in.',
  SIGNIN_EXPIRED: 'This sign-in expired or was already used. Please try again.',
  SIGNIN_ACCOUNT_MISMATCH: 'This workspace belongs to a different SoftGlaze account. Sign in with the account you created it with.',
  SIGNIN_EMAIL_MISMATCH: 'Use the email address of this workspace.',
  SIGNIN_EMAIL_NOT_VERIFIED: 'Your GitHub account has no verified primary email. Verify it on GitHub, or continue with email.',
  SIGNIN_DISPOSABLE_EMAIL: 'Please use a permanent email address.',
  SIGNIN_UNAVAILABLE: 'This sign-in is not available yet. Continue with email, or use More options.',
  SIGNIN_FAILED: "The sign-in didn't finish. Try again in a minute.",
  SIGNIN_NOT_ALLOWED: 'This sign-in is not available for this workspace.',
  SIGNIN_KEY_LOST: 'This workspace could not be opened with your sign-in on this computer. Use your workspace password.',
  SIGNIN_SESSION_ENDED: 'Your sign-in has ended. Sign in again.',
  SIGNIN_BAD_INPUT: 'Enter a valid email address.',
  MOVE_LIMIT: 'This subscription has already been moved to another computer twice in the last 30 days.',
  MOVE_FAILED: "The licence couldn't be moved right now. Try again in a minute."
});

function coded(code, extra) {
  return Object.assign(new Error(MESSAGES[code] || String(code)), { code }, extra || {});
}

// Server failures of the sign-in calls as app codes. The email-code calls reuse the sign-up mapping
// (serverErrors.js: SIGNUP_BAD_CODE, RATE_LIMITED, SIGNUP_DISPOSABLE_EMAIL, ...).
function mapError(e, context = null) {
  if (e && typeof e.code === 'string' && (e.code in MESSAGES || /^SIGNIN_|^SIGNUP_|^RATE_LIMITED$|^SERVER_UNAVAILABLE$/.test(e.code))) return e;
  if (e && e.network) return coded('SIGNIN_OFFLINE');
  const code = e && e.code;
  if (code === 'invalid_grant') return coded('SIGNIN_EXPIRED');
  if (code === 'account_mismatch') return coded('SIGNIN_ACCOUNT_MISMATCH');
  if (code === 'email_not_verified') return coded('SIGNIN_EMAIL_NOT_VERIFIED');
  if (code === 'session_invalid') return coded('SIGNIN_SESSION_ENDED');
  if (code === 'move_limit') return coded('MOVE_LIMIT', { retryAt: e.retryAt || null });
  // A server without the /auth routes (deployed before this release) answers a plain 404.
  if (e && e.status === 404 && !code) return coded('SIGNIN_UNAVAILABLE');
  if (context) return mapServerError(e, context);
  if (e && e.status >= 500) return coded('SIGNIN_FAILED');
  return coded('SIGNIN_FAILED');
}

function normEmail(v) { return String(v || '').trim().toLowerCase(); }

// "Ada Lovelace" -> { firstName: 'Ada', lastName: 'Lovelace' }; no name -> the email's local part.
function splitName(name, email) {
  const clean = String(name || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (clean) {
    const parts = clean.split(' ');
    return { firstName: parts[0].slice(0, 80), lastName: parts.slice(1).join(' ').slice(0, 80) };
  }
  const local = String(email || '').split('@')[0].replace(/[._+-]+/g, ' ').trim();
  const first = local ? local.charAt(0).toUpperCase() + local.slice(1) : 'Owner';
  return { firstName: first.slice(0, 80), lastName: '' };
}

// deps (all functions unless noted):
//   tenantConfig() -> { enabled, tenantId, apiBaseUrl }; api: licenseClient.api; ensureInstall();
//   flow: signInFlow.js; accountSession: accountSession.js; rememberStore;
//   getPrisma(); readSetting(k, fallback); writeSetting(k, v); hashSecret(s); verifySecret(s, salt, hash);
//   initialsFrom(name); assertFirstRunSetup(); recordSignupVerified(); logAudit(action, opts);
//   isDbEncryptionEnabled(); requirePurchaser(action); refreshBackendLease(); deliverOtp(email, code);
//   gate: { state() -> { vaultLocked, currentMemberId }, authState() -> { vaultLocked, signedIn, memberCount },
//           unlock(source), setCurrentMember(id) };
//   normalizeLead(input, opts) (signupLead.js); now()
function createOneClickSignIn(d) {
  const now = () => (d.now ? d.now() : Date.now());
  const tenant = () => Boolean(d.tenantConfig().enabled);
  let providersCache = null; // { at, list }

  // The providers our server offers ([] in base builds, when the server does not answer, or before the owner
  // set the GitHub keys).
  async function providers({ fresh = false } = {}) {
    if (!tenant()) return [];
    if (!fresh && providersCache && now() - providersCache.at < PROVIDERS_TTL_MS) return providersCache.list;
    let list = [];
    try {
      const r = await d.api.authProviders();
      list = Array.isArray(r && r.providers) ? r.providers.filter((p) => p === 'github') : [];
    } catch (_) { list = []; }
    providersCache = { at: now(), list };
    return list;
  }

  async function vault() { return (await d.readSetting('vault', null)) || { enabled: false }; }

  // The SoftGlaze account this workspace belongs to: { customerId, email } (customerId only in tenant builds).
  async function workspaceAccount() {
    const tc = (await d.readSetting('tenantCustomer', null)) || {};
    const acct = (await d.readSetting('account', null)) || {};
    return { customerId: tc.customerId ? String(tc.customerId) : null, email: normEmail(acct.email || tc.email) };
  }

  function sameAccount(ws, customer) {
    if (!customer) return false;
    if (ws.customerId && customer.id) return ws.customerId === String(customer.id);
    return Boolean(ws.email) && ws.email === normEmail(customer.email);
  }

  async function ownerMember() {
    return d.getPrisma().member.findFirst({ where: { role: 'OWNER' }, orderBy: { createdAt: 'asc' } });
  }

  // Which sign-in the Gate offers now: 'signup' (a new workspace), 'unlock' (a one-click workspace that is
  // locked or signed out) or null.
  async function purposeNow() {
    try { await d.assertFirstRunSetup(); return 'signup'; } catch (_) { /* set up already */ }
    const v = await vault();
    const g = d.gate.state();
    if (v.enabled && v.signIn && (g.vaultLocked || g.currentMemberId == null)) return 'unlock';
    return null;
  }

  async function assertPurpose(purpose) {
    if (!PURPOSES.includes(purpose)) throw coded('SIGNIN_NOT_ALLOWED');
    if (purpose === 'signup') { await d.assertFirstRunSetup(); return; }
    if (purpose === 'unlock') {
      if ((await purposeNow()) !== 'unlock') throw coded('SIGNIN_NOT_ALLOWED');
      return;
    }
    // link: the signed-in Owner (or the Super Admin / single-user mode) of an open workspace. The sign-in
    // channels are callable before sign-in, so "nobody signed in on a workspace with members" is refused here.
    const st = await d.gate.authState();
    if (st.vaultLocked || (!st.signedIn && Number(st.memberCount) > 0)) throw coded('SIGNIN_NOT_ALLOWED');
    await d.requirePurchaser('sign in to the SoftGlaze account');
    if (!tenant()) throw coded('SIGNIN_UNAVAILABLE');
  }

  // What the Gate and Settings need to draw the buttons.
  async function info() {
    const purpose = await purposeNow();
    const acct = (await d.readSetting('account', null)) || {};
    return {
      tenant: tenant(),
      providers: await providers(),
      email: true,
      purpose,
      account: purpose === 'unlock' ? { email: normEmail(acct.email), firstName: String(acct.firstName || '') } : null,
      keychain: d.accountSession.available()
    };
  }

  async function install() {
    let inst;
    try { inst = await d.ensureInstall(); } catch (e) { throw mapError(e); }
    if (!inst || !inst.installId || !inst.installSecret) throw coded('SIGNIN_OFFLINE');
    return inst;
  }

  async function expectedCustomer(purpose) {
    if (purpose === 'signup') return null;
    return (await workspaceAccount()).customerId;
  }

  // --- Provider sign-in (GitHub) ---
  async function start({ provider, purpose, mode } = {}) {
    await assertPurpose(purpose);
    if (!tenant()) throw coded('SIGNIN_UNAVAILABLE');
    if (provider !== 'github') throw coded('SIGNIN_UNAVAILABLE');
    const inst = await install();
    const expectCustomerId = await expectedCustomer(purpose);
    const got = await d.flow.begin(provider, { mode: mode === 'loopback' ? 'loopback' : 'auto' });
    let body;
    try {
      body = await d.api.authExchange({ installId: inst.installId, installSecret: inst.installSecret, code: got.code, codeVerifier: got.codeVerifier, expectCustomerId });
    } catch (e) { throw mapError(e); }
    return apply(purpose, provider, body);
  }

  function cancel() { return { cancelled: d.flow.cancel() }; }
  function handleProtocolUrl(url) { return d.flow.handleProtocolUrl(url); }

  // --- Email code sign-in ---
  async function emailStart({ email, purpose, lang } = {}) {
    await assertPurpose(purpose);
    const addr = normEmail(email);
    if (!EMAIL_RE.test(addr)) throw coded('SIGNIN_BAD_INPUT');
    if (purpose === 'unlock') {
      const ws = await workspaceAccount();
      if (ws.email && ws.email !== addr) throw coded('SIGNIN_EMAIL_MISMATCH');
    }
    if (!tenant()) return localStart(addr);
    const inst = await install();
    try {
      await d.api.authEmailStart({ installId: inst.installId, installSecret: inst.installSecret, email: addr, lang: lang === 'es' ? 'es' : 'en' });
    } catch (e) { throw mapError(e, 'signup'); }
    return { sent: true, devMode: false };
  }

  async function emailVerify({ email, code, purpose } = {}) {
    await assertPurpose(purpose);
    const addr = normEmail(email);
    const c = String(code || '').replace(/\D/g, '');
    if (!EMAIL_RE.test(addr)) throw coded('SIGNIN_BAD_INPUT');
    if (c.length !== 6) throw coded('SIGNUP_BAD_CODE', { message: "That code isn't right or has expired. Check the email or ask for a new code." });
    if (!tenant()) {
      await localVerify(addr, c);
      return apply(purpose, 'email', { customer: { id: null, email: addr, name: null, useCase: null }, session: null, methods: [{ provider: 'email', email: addr }], licence: { state: 'none' }, isNew: purpose === 'signup' });
    }
    const inst = await install();
    let body;
    try {
      body = await d.api.authEmailVerify({ installId: inst.installId, installSecret: inst.installSecret, email: addr, code: c, expectCustomerId: await expectedCustomer(purpose) });
    } catch (e) { throw mapError(e, 'signupCheck'); }
    return apply(purpose, 'email', body);
  }

  // Base builds: the local code, as the base build's sign-up does today (SMTP, or shown in the app).
  const otpKey = (addr) => `otp:signin:${addr}`;
  async function localStart(addr) {
    const code = String(crypto.randomInt(100000, 1000000));
    const { salt, hash } = d.hashSecret(code);
    await d.writeSetting(otpKey(addr), { email: addr, salt, hash, expiresAt: now() + 10 * 60000, attempts: 0 });
    const r = await d.deliverOtp(addr, code);
    return { sent: true, devMode: Boolean(r && r.devMode), devCode: r && r.devMode ? code : undefined };
  }
  async function localVerify(addr, code) {
    const key = otpKey(addr);
    const rec = await d.readSetting(key, null);
    const bad = () => coded('SIGNUP_BAD_CODE', { message: "That code isn't right or has expired. Check the email or ask for a new code." });
    if (!rec || !rec.hash || rec.email !== addr) throw bad();
    if (now() > Number(rec.expiresAt || 0) || Number(rec.attempts || 0) >= 6) { await d.writeSetting(key, null); throw bad(); }
    if (!d.verifySecret(code, rec.salt, rec.hash)) {
      await d.writeSetting(key, { ...rec, attempts: Number(rec.attempts || 0) + 1 });
      throw bad();
    }
    await d.writeSetting(key, null);
  }

  // --- What a verified sign-in does ---
  async function apply(purpose, provider, body) {
    if (!body || !body.customer || !EMAIL_RE.test(normEmail(body.customer.email))) throw coded('SIGNIN_FAILED');
    if (purpose === 'signup') return createWorkspace(provider, body);
    if (purpose === 'unlock') return unlockWorkspace(provider, body);
    return linkWorkspace(provider, body);
  }

  function sessionFields(provider, body, inst) {
    return {
      installId: inst ? inst.installId : null,
      customerId: body.customer.id ? String(body.customer.id) : null,
      email: normEmail(body.customer.email),
      name: body.customer.name || null,
      provider,
      methods: Array.isArray(body.methods) ? body.methods : [],
      session: typeof body.session === 'string' ? body.session : null,
      sessionAt: new Date(now()).toISOString()
    };
  }

  async function currentInstall() {
    if (!tenant()) return null;
    try { return await d.ensureInstall(); } catch (_) { return null; }
  }

  async function createWorkspace(provider, body) {
    await d.assertFirstRunSetup(); // still a new workspace (another window may have finished first)
    const email = normEmail(body.customer.email);
    const { firstName, lastName } = splitName(body.customer.name, email);
    const name = `${firstName} ${lastName}`.trim();
    const db = d.getPrisma();
    const owner = await db.member.create({
      data: { name, email, role: 'OWNER', color: '#3DC6DA', initials: d.initialsFrom(name), status: 'active', lastActiveAt: new Date(now()) }
    });
    await d.gate.setCurrentMember(owner.id);

    // The workspace key: random, sealed on this computer, remembered so every start opens the workspace.
    // Saved before the vault is turned on, so a failed save never leaves a vault nobody can open.
    const inst = await currentInstall();
    const deviceKey = crypto.randomBytes(32).toString('base64url');
    const sealed = d.accountSession.write({ ...sessionFields(provider, body, inst), deviceKey });
    if (sealed) {
      const { salt, hash } = d.hashSecret(deviceKey);
      await d.writeSetting('vault', { enabled: true, hash, salt, autoLockMinutes: 0, signIn: true });
      d.rememberStore.write({ kind: 'vault', password: deviceKey });
      d.gate.unlock('vault');
    } else {
      d.gate.unlock('none'); // no OS keychain: the workspace opens without a lock, as a password-less one does
    }

    const at = new Date(now()).toISOString();
    await d.writeSetting('account', { firstName, lastName, email, phone: '', verified: true, createdAt: at, signIn: { provider, at } });
    if (tenant() && body.customer.id) {
      await d.writeSetting('tenantCustomer', { email, customerId: String(body.customer.id), verifiedAt: at }).catch(() => {});
      // The server verified this install's customer: no "Confirm your email" step.
      await d.recordSignupVerified().catch(() => {});
    }
    await d.logAudit('account.signin', { detail: { provider, purpose: 'signup', newAccount: Boolean(body.isNew) } }).catch(() => {});
    return {
      outcome: 'created',
      provider,
      email,
      askUseCase: !body.customer.useCase,
      licence: body.licence && typeof body.licence === 'object' ? body.licence : { state: 'none' },
      locked: Boolean(sealed)
    };
  }

  async function unlockWorkspace(provider, body) {
    const ws = await workspaceAccount();
    if (!sameAccount(ws, body.customer)) throw coded('SIGNIN_ACCOUNT_MISMATCH');
    const v = await vault();
    if (!v.enabled || !v.signIn) throw coded('SIGNIN_NOT_ALLOWED');
    const inst = await currentInstall();
    const stored = d.accountSession.read() || {};
    let key = stored.deviceKey;
    if (!key || !d.verifySecret(key, v.salt, v.hash)) {
      // The sealed key is gone (another Windows user, a restored workspace). The verified sign-in of the
      // workspace's own account is the credential, so the workspace gets a new key; not possible while the
      // database is encrypted with the old one.
      if (d.isDbEncryptionEnabled()) throw coded('SIGNIN_KEY_LOST');
      key = crypto.randomBytes(32).toString('base64url');
      if (!d.accountSession.write({ ...stored, ...sessionFields(provider, body, inst), deviceKey: key })) throw coded('SIGNIN_KEY_LOST');
      const { salt, hash } = d.hashSecret(key);
      await d.writeSetting('vault', { ...v, salt, hash, signIn: true });
    } else {
      d.accountSession.patch(sessionFields(provider, body, inst));
    }
    const owner = await ownerMember();
    d.gate.unlock('vault');
    if (owner) await d.gate.setCurrentMember(owner.id);
    d.rememberStore.write({ kind: 'vault', password: key });
    await d.logAudit('account.signin', { detail: { provider, purpose: 'unlock' } }).catch(() => {});
    return { outcome: 'unlocked', provider, email: normEmail(body.customer.email), licence: body.licence || { state: 'none' } };
  }

  async function linkWorkspace(provider, body) {
    const ws = await workspaceAccount();
    if (ws.customerId && !sameAccount(ws, body.customer)) throw coded('SIGNIN_ACCOUNT_MISMATCH');
    const inst = await currentInstall();
    const prev = d.accountSession.read() || {};
    if (!d.accountSession.write({ ...prev, ...sessionFields(provider, body, inst) })) throw coded('SIGNIN_FAILED');
    if (!ws.customerId && body.customer.id) {
      await d.writeSetting('tenantCustomer', { email: normEmail(body.customer.email), customerId: String(body.customer.id), verifiedAt: new Date(now()).toISOString() }).catch(() => {});
      await d.recordSignupVerified().catch(() => {});
    }
    await d.logAudit('account.signin', { detail: { provider, purpose: 'link' } }).catch(() => {});
    return { outcome: 'linked', provider, email: normEmail(body.customer.email), licence: body.licence || { state: 'none' } };
  }

  // --- Settings > Account ---
  // -> { tenant, signedIn, email, name, provider, methods, offline, signInWorkspace, providers }
  async function account() {
    const rec = d.accountSession.read();
    const v = await vault();
    const out = {
      tenant: tenant(),
      signInWorkspace: Boolean(v.enabled && v.signIn),
      signedIn: Boolean(rec && rec.session),
      email: rec ? rec.email || null : null,
      name: rec ? rec.name || null : null,
      provider: rec ? rec.provider || null : null,
      methods: rec && Array.isArray(rec.methods) ? rec.methods : [],
      offline: false,
      providers: await providers()
    };
    if (!out.signedIn || !tenant()) return out;
    const inst = await currentInstall();
    if (!inst) return { ...out, offline: true };
    try {
      const me = await d.api.authMe({ installId: inst.installId, installSecret: inst.installSecret, session: rec.session });
      const methods = Array.isArray(me && me.methods) ? me.methods : out.methods;
      d.accountSession.patch({ methods, email: normEmail(me.customer && me.customer.email) || rec.email, name: (me.customer && me.customer.name) || rec.name });
      return { ...out, methods, email: normEmail(me.customer && me.customer.email) || out.email, name: (me.customer && me.customer.name) || out.name, licence: me.licence || null };
    } catch (e) {
      if (e && e.code === 'session_invalid') { d.accountSession.signOut(); return { ...out, signedIn: false, methods: [] }; }
      return { ...out, offline: true };
    }
  }

  // Sign out of the SoftGlaze account on this computer: the server session ends (best effort), the remembered
  // credential is forgotten. The caller then signs the member out (memberLogout), which locks the workspace.
  async function signOut() {
    const rec = d.accountSession.read();
    if (rec && rec.session && tenant()) {
      const inst = await currentInstall();
      if (inst) await d.api.authLogout({ installId: inst.installId, installSecret: inst.installSecret, session: rec.session }).catch(() => {});
    }
    d.accountSession.signOut();
    await d.logAudit('account.signout', { detail: { provider: rec ? rec.provider || null : null } }).catch(() => {});
    return { ok: true };
  }

  // "What will you use SoftGlaze for?" (optional, once after a one-click sign-up).
  async function saveUseCase(input = {}) {
    const lead = d.normalizeLead({ useCase: input.useCase, useCaseOther: input.useCaseOther }, { requireUseCase: true });
    if (lead.error) throw Object.assign(new Error(MESSAGES.SIGNIN_BAD_INPUT), { code: lead.error });
    const acct = (await d.readSetting('account', null)) || {};
    await d.writeSetting('account', { ...acct, useCase: lead.lead.useCase, useCaseOther: lead.lead.useCaseOther || null });
    const rec = d.accountSession.read();
    let saved = false;
    if (tenant() && rec && rec.session) {
      const inst = await currentInstall();
      if (inst) {
        try {
          await d.api.authProfile({ installId: inst.installId, installSecret: inst.installSecret, session: rec.session, useCase: lead.lead.useCase, useCaseOther: lead.lead.useCaseOther || undefined });
          saved = true;
        } catch (_) { /* kept locally; the answer is optional */ }
      }
    }
    return { ok: true, savedOnServer: saved };
  }

  // Where this account's paid licence is (here | elsewhere | store | none), or null when it cannot be asked.
  async function licenceState() {
    const rec = d.accountSession.read();
    if (!tenant() || !rec || !rec.session) return null;
    const inst = await currentInstall();
    if (!inst) return null;
    try {
      const me = await d.api.authMe({ installId: inst.installId, installSecret: inst.installSecret, session: rec.session });
      return me && me.licence ? me.licence : null;
    } catch (_) { return null; }
  }

  // "Move it to this computer": the server moves the account's licence (at most twice per 30 days), then the
  // lease is fetched for this computer.
  async function moveLicence() {
    await d.requirePurchaser('move the licence to this computer');
    const rec = d.accountSession.read();
    if (!tenant() || !rec || !rec.session) throw coded('SIGNIN_SESSION_ENDED');
    const inst = await install();
    let r;
    try {
      r = await d.api.authMoveLicence({ installId: inst.installId, installSecret: inst.installSecret, session: rec.session, move: true });
    } catch (e) {
      const m = mapError(e);
      throw m.code === 'SIGNIN_FAILED' ? coded('MOVE_FAILED') : m;
    }
    await d.refreshBackendLease().catch(() => {});
    await d.logAudit('licence.move-signin', { detail: { moved: Boolean(r && r.moved) } }).catch(() => {});
    return { moved: Boolean(r && r.moved), remaining: r && Number.isFinite(r.remaining) ? r.remaining : null };
  }

  // The device key of a one-click workspace, for main's vault calls (set a password, turn the vault off).
  function deviceKey() {
    const rec = d.accountSession.read();
    return rec && typeof rec.deviceKey === 'string' ? rec.deviceKey : '';
  }

  return {
    providers, info, start, cancel, handleProtocolUrl, emailStart, emailVerify, account, signOut, saveUseCase,
    licenceState, moveLicence, deviceKey, purposeNow, workspaceAccount
  };
}

module.exports = { createOneClickSignIn, mapError, splitName, MESSAGES, PURPOSES };
