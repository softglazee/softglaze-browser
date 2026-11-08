'use strict';
// Runs the real licence, trial, plan and sign-up functions from src/main/ipcHandlers.js in a vm
// context with fakes for the database, settings, sealed storage and the licensing server, so tests
// can drive a tenant or a base build end to end without Electron. Callers set the SG_* env (tenant
// public key) before requiring this file, so licenseClient.verifyLease checks real signatures.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');

function extractFunction(name) {
  const start = IPC.search(new RegExp(`\\n(?:async )?function ${name}\\(`));
  if (start === -1) throw new Error(`could not find function ${name}`);
  let i = IPC.indexOf('{', IPC.indexOf(')', start));
  let depth = 0;
  for (; i < IPC.length; i++) {
    if (IPC[i] === '{') depth++;
    else if (IPC[i] === '}') { depth--; if (depth === 0) return IPC.slice(start + 1, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

function constLine(name, kind = 'const') {
  const m = new RegExp(`^${kind} ${name} = .*$`, 'm').exec(IPC);
  if (!m) throw new Error(`could not find ${kind} ${name}`);
  return m[0];
}

const FUNCTIONS = [
  'sanitizeAmount', 'normalizePlan', 'readBillingPlans', 'effectiveBillingPlans', 'findTenantPlanOrThrow',
  'ensureLicense', 'tenantTrialCutover', 'clampLicenseNow', 'syncOwnerBanState', 'licenseView',
  'licenseTrialUsed', 'getBackendEntitlement', 'refreshBackendLease', 'licenseViewFromLease',
  'withPlanLimits', 'getLicense', 'withLicenseReason', 'assertNotBanned', 'startTrial', 'startTenantTrial',
  'tenantTrialUsedError', 'optionalString', 'requiredString', 'requireObject', 'assertFirstRunSetup',
  'accountSendOtp', 'accountRegister', 'otpKey', 'hashSecret', 'verifySecret', 'initialsFrom', 'getBillingPlans',
  // Confirm your email (1.0.23) and payment methods from the server.
  'readSignupCache', 'writeSignupCache', 'signupInstallKey', 'hasPaidLease', 'signupDecide', 'recordSignupVerified',
  'signupDeferral', 'mayConfirmSignup', 'accountSignupStatus', 'requireTenantSignup', 'accountConfirmStart',
  'accountConfirmCheck', 'syncOwnerAccount', 'accountConfirmLater', 'requirePurchaser',
  'tenantCheckoutMethods', 'listPaymentMethods', 'startCheckout', 'storeSalesOpen', 'storeSubscriptionSeen', 'storeStatus', 'storePurchase'
];

function billingConstants() {
  const start = IPC.indexOf('const TRIAL_DAYS = ');
  const end = IPC.indexOf(']);', IPC.indexOf('const DEFAULT_BILLING_PLANS = ')) + 3;
  return IPC.slice(start, end);
}

const SOURCE = [
  billingConstants(),
  constLine('LICENSE_BAN_REASON'),
  constLine('serverPlanCatalog'),
  constLine('serverCheckoutCatalog'),
  constLine('STORE_METHOD_ID'),
  constLine('signupDecision', 'let'),
  constLine('signupFailedAt', 'let'),
  constLine('SIGNUP_RECHECK_MS'),
  constLine('SIGNUP_FAILURE_MS'),
  ...FUNCTIONS.map(extractFunction),
  'this.__fns = { ' + FUNCTIONS.join(', ') + ' };',
  'this.__state = () => ({ currentMemberId, vaultLocked, vaultUnlockSource, signupDecision, signupFailedAt });',
  'this.__setSignup = (o) => { if (o && "decision" in o) signupDecision = o.decision; if (o && "failedAt" in o) signupFailedAt = o.failedAt; };'
].join('\n\n');

// A tiny Prisma stand-in: just the calls the extracted functions make.
function fakeDb({ members = [], licenses = [], settings }) {
  let nextLicenseId = licenses.reduce((m, l) => Math.max(m, l.id), 0) + 1;
  let nextMemberId = members.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  const now = () => new Date();
  return {
    members,
    licenses,
    failCount: false,
    member: {
      count: async function () { if (this.failCount) throw new Error('db down'); return members.length; },
      findUnique: async ({ where }) => members.find((m) => m.id === where.id) || null,
      findFirst: async ({ where }) => members.filter((m) => !where
        || ((!where.role || m.role === where.role)
          && (where.email === undefined || String(m.email || '').toLowerCase() === where.email)
          && (!where.id || !('not' in where.id) || m.id !== where.id.not)))[0] || null,
      update: async ({ where, data }) => { const m = members.find((x) => x.id === where.id); Object.assign(m, data); return { ...m }; },
      create: async ({ data }) => { const m = { id: nextMemberId++, createdAt: now(), ...data }; members.push(m); return { ...m }; }
    },
    license: {
      findFirst: async ({ where }) => {
        const rows = licenses.filter((l) => (l.ownerMemberId ?? null) === (where.ownerMemberId ?? null));
        rows.sort((a, b) => b.createdAt - a.createdAt);
        return rows[0] ? { ...rows[0] } : null;
      },
      findMany: async ({ where }) => licenses.filter((l) => !where || !where.type || l.type === where.type).map((l) => ({ id: l.id, type: l.type, trialEndsAt: l.trialEndsAt })),
      create: async ({ data }) => { const l = { id: nextLicenseId++, createdAt: now(), purchaseCode: null, ...data }; licenses.push(l); return { ...l }; },
      update: async ({ where, data }) => { const l = licenses.find((x) => x.id === where.id); Object.assign(l, data); return { ...l }; }
    },
    setting: {
      findUnique: async ({ where }) => (settings.has(where.key) ? { key: where.key, value: JSON.stringify(settings.get(where.key)) } : null)
    }
  };
}

// opts: { tenant, members, licenses, settings: {k: v}, api, activeMemberId, verifyLease, licenseIssue,
//   checkoutProviders, store: { isStoreInstall, available, status } }
function buildMain(opts = {}) {
  const settings = new Map(Object.entries(opts.settings || {}));
  const db = fakeDb({ members: opts.members || [], licenses: opts.licenses || [], settings });
  const audits = [];
  const realClient = require(path.join(ROOT, 'src', 'main', 'licenseClient.js'));
  const calls = [];
  const api = new Proxy(opts.api || {}, {
    get(target, prop) {
      if (!(prop in target)) return async () => { throw new Error(`unexpected server call ${String(prop)}`); };
      return async (...args) => { calls.push({ method: String(prop), args }); return target[prop](...args); };
    }
  });
  const licenseClient = {
    verifyLease: opts.verifyLease || realClient.verifyLease,
    machineHash: realClient.machineHash,
    licenseIssue: opts.licenseIssue || (() => null),
    api
  };
  const install = { installId: 'inst_1', installSecret: 'secret_1' };
  const ctx = {
    console, Date, JSON, Math, Number, String, Boolean, Object, Array, Error, TypeError, Map, Set, Promise, Buffer, crypto,
    tenantConfig: () => ({ enabled: Boolean(opts.tenant), tenantId: opts.tenant ? 'tenant_test' : '', checkoutProviders: opts.checkoutProviders || [] }),
    signupLead: require(path.join(ROOT, 'src', 'main', 'signupLead.js')),
    signupConfirm: require(path.join(ROOT, 'src', 'main', 'signupConfirm.js')),
    serverErrors: require(path.join(ROOT, 'src', 'main', 'serverErrors.js')),
    checkoutMethods: require(path.join(ROOT, 'src', 'main', 'checkoutMethods.js')),
    payments: require(path.join(ROOT, 'src', 'main', 'payments.js')),
    storeCommerceLib: require(path.join(ROOT, 'src', 'main', 'storeCommerce.js')),
    storeBridge: {
      isStoreInstall: () => Boolean(opts.store && opts.store.isStoreInstall),
      available: () => Boolean(opts.store && opts.store.available)
    },
    getStoreCommerce: () => ({
      status: async () => (opts.store && opts.store.status ? opts.store.status() : { available: false }),
      purchase: async () => { calls.push({ method: 'storeCommerce.purchase', args: [] }); return { status: 'active', tier: 'pro' }; }
    }),
    storeWindowHandle: () => '1',
    storeResultWithLicense: async (r, extra = {}) => ({ ...r, ...extra }),
    readPaymentStore: async () => ({}),
    providerConfigured: () => false,
    tenantTrial: require(path.join(ROOT, 'src', 'main', 'tenantTrial.js')),
    tenantSignup: require(path.join(ROOT, 'src', 'main', 'tenantSignup.js')),
    planCatalog: require(path.join(ROOT, 'src', 'main', 'planCatalog.js')),
    licensePolicy: require(path.join(ROOT, 'src', 'main', 'licensePolicy.js')),
    tierPolicy: require(path.join(ROOT, 'src', 'main', 'tierPolicy.js')),
    licenseClient,
    secretStore: { seal: (s) => `sealed:${s}`, open: (s) => (String(s).startsWith('sealed:') ? String(s).slice(7) : '') },
    getPrisma: () => db,
    readSetting: async (k, fallback) => (settings.has(k) ? JSON.parse(JSON.stringify(settings.get(k))) : fallback),
    writeSetting: async (k, v) => { settings.set(k, v); },
    getActiveMember: async () => (opts.activeMemberId == null ? null : db.members.find((m) => m.id === opts.activeMemberId) || null),
    isCertifiedSuperAdmin: async () => false,
    resolveLicenseOwnerId: async () => (db.members.find((m) => m.role === 'OWNER') || {}).id ?? null,
    ensureBackendInstall: opts.ensureBackendInstall || (async () => install),
    logAudit: async (action, detail) => { audits.push({ action, detail }); },
    deliverOtp: opts.deliverOtp || (async () => ({ devMode: true })),
    parseId: (v) => Number(v),
    serializeMember: (m) => ({ id: m.id, name: m.name, role: m.role, email: m.email }),
    currentMemberId: null,
    vaultLocked: true,
    vaultUnlockSource: null
  };
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx, { filename: 'ipcHandlers-extract.js' });
  return { fns: ctx.__fns, state: ctx.__state, setSignup: ctx.__setSignup, settings, db, audits, calls, install };
}

module.exports = { buildMain, extractFunction, IPC };
