'use strict';
// Tenant settings: built-in defaults below, overridden per section by Setting rows (the admin edits
// them with PATCH /v1/admin/settings). Every value has a range check, so a typo cannot switch a
// protection off by accident.
const { asJson } = require('./util/json');

const DEFAULTS = Object.freeze({
  trial: { days: 7, tier: 'enterprise', networkLimit: 2, networkWindowDays: 30 },
  verify: {
    codeTtlMinutes: 10, maxAttempts: 5, resendSeconds: 60,
    maxSendsPerHourPerEmail: 5, maxSendsPerHourPerInstall: 8, maxSendsPerHourPerNetwork: 20
  },
  email: {
    dailyCap: 300, // rolling 24 h; verification codes are always sent but count towards it
    catchUpHours: 48, // an automation is not sent more than this long after it was due
    replyTo: 'support@softglaze.com',
    supportEmail: 'support@softglaze.com',
    appName: 'SoftGlaze Browser',
    companyName: 'SoftGlaze',
    companyAddress: '', // postal address shown in marketing emails (needed for CAN-SPAM)
    downloadUrl: 'https://browser.softglaze.com/download',
    domainAllowlist: [],
    domainBlocklist: [],
    mxCheck: true
  },
  billing: { renewalGraceDays: 3, reportingCurrency: 'USD' },
  // Microsoft Store in-app subscriptions (src/store/). productPlans maps each add-on's Product ID
  // (Partner Center, = StoreProduct.InAppOfferToken) to a plan key. Until the Store collection and
  // purchase APIs are set up (POST /v1/tenant/payment-config provider microsoft_store), a purchase the
  // app reports is accepted UNVERIFIED for unverifiedDays at a time and shows as an alert in the admin;
  // acceptUnverified false records it for the owner to check by hand instead.
  // salesEnabled: the app offers "Microsoft Store" as a payment method only when this is true AND the
  // Store returns the add-ons' prices. Off by default, until the add-ons exist in Partner Center.
  store: {
    salesEnabled: false,
    productPlans: { pro_monthly: 'pro', enterprise_monthly: 'enterprise' },
    acceptUnverified: true,
    unverifiedDays: 7,
    renewalGraceDays: 3,
    maxMovesPer30Days: 2
  },
  // Website payment providers the app offers (GET /v1/checkout/methods, app 1.0.23+). providers null =
  // every provider whose keys are saved and enabled (POST /v1/tenant/payment-config); a list = only those
  // of them, in that order ([] offers none). labels renames a provider in the app, e.g. { "stripe": "Card" }.
  checkout: { providers: null, labels: {} },
  privacy: { unverifiedRetentionDays: 30, outboxBodyRetentionDays: 90, trialAttemptRetentionDays: 180 },
  automations: {
    welcome: { enabled: true, offsetHours: 0 },
    tips: { enabled: true, offsetHours: 48 },
    trial_ending: { enabled: true, offsetHours: -48 },
    trial_ended: { enabled: true, offsetHours: 0 },
    locks_tomorrow: { enabled: true, offsetHours: 48 },
    come_back: { enabled: true, offsetHours: 336 }
  }
});

const SECTIONS = Object.keys(DEFAULTS);

const int = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max;
const str = (max) => (v) => typeof v === 'string' && v.length <= max;
const bool = (v) => typeof v === 'boolean';
const domains = (v) => Array.isArray(v) && v.length <= 2000 && v.every((d) => typeof d === 'string' && /^[a-z0-9.-]{3,253}$/i.test(d.replace(/^@/, '')));
const emailish = (v) => typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const url = (v) => typeof v === 'string' && v.length <= 500 && /^https:\/\/\S+$/.test(v);
// { "<add-on Product ID>": "<plan key>" }: Partner Center allows letters, digits, '.', '_' and '-'.
// Payment provider ids: lower-case letters, digits, '_' and '-' (stripe, paypal, cryptomus, 2checkout, ...).
const PROVIDER_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const providerList = (v) => v === null || (Array.isArray(v) && v.length <= 20 && v.every((p) => typeof p === 'string' && PROVIDER_ID.test(p)));
const providerLabels = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length <= 20
  && Object.entries(v).every(([k, l]) => PROVIDER_ID.test(k) && typeof l === 'string' && l.trim().length > 0 && l.length <= 60 && !/[<>]/.test(l));
const productPlans = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length <= 20
  && Object.entries(v).every(([k, p]) => /^[A-Za-z0-9._-]{1,100}$/.test(k) && typeof p === 'string' && /^[A-Za-z0-9._-]{1,60}$/.test(p));

const RULES = {
  trial: { days: int(1, 60), tier: (v) => v === 'pro' || v === 'enterprise', networkLimit: int(0, 100), networkWindowDays: int(1, 365) },
  verify: {
    codeTtlMinutes: int(2, 60), maxAttempts: int(1, 10), resendSeconds: int(10, 600),
    maxSendsPerHourPerEmail: int(1, 50), maxSendsPerHourPerInstall: int(1, 50), maxSendsPerHourPerNetwork: int(1, 500)
  },
  email: {
    dailyCap: int(0, 100000), catchUpHours: int(1, 720), replyTo: emailish, supportEmail: emailish, appName: str(80),
    companyName: str(120), companyAddress: str(300), downloadUrl: url, domainAllowlist: domains, domainBlocklist: domains, mxCheck: bool
  },
  billing: { renewalGraceDays: int(0, 60), reportingCurrency: (v) => typeof v === 'string' && /^[A-Z]{3}$/.test(v) },
  store: { salesEnabled: bool, productPlans, acceptUnverified: bool, unverifiedDays: int(1, 35), renewalGraceDays: int(0, 30), maxMovesPer30Days: int(0, 20) },
  checkout: { providers: providerList, labels: providerLabels },
  privacy: { unverifiedRetentionDays: int(1, 3650), outboxBodyRetentionDays: int(1, 3650), trialAttemptRetentionDays: int(1, 3650) }
};

function merge(section, stored) {
  const base = DEFAULTS[section];
  const val = asJson(stored) || {};
  if (section === 'automations') {
    const out = {};
    for (const [k, def] of Object.entries(base)) out[k] = { ...def, ...(val[k] && typeof val[k] === 'object' ? val[k] : {}) };
    return out;
  }
  return { ...base, ...val };
}

async function getSettings(db, tenantId) {
  const rows = await db.setting.findMany({ where: { tenantId } });
  const out = {};
  for (const s of SECTIONS) {
    const row = rows.find((r) => r.key === s);
    out[s] = merge(s, row && row.value);
  }
  return out;
}

// patch: { section: { key: value } }. Returns { ok, settings } or { ok: false, errors }.
function validatePatch(patch) {
  const errors = {};
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { errors: { _: 'expected an object of sections' } };
  for (const [section, values] of Object.entries(patch)) {
    if (!SECTIONS.includes(section)) { errors[section] = 'unknown_section'; continue; }
    if (!values || typeof values !== 'object' || Array.isArray(values)) { errors[section] = 'expected_object'; continue; }
    for (const [k, v] of Object.entries(values)) {
      if (section === 'automations') {
        if (!DEFAULTS.automations[k]) { errors[`automations.${k}`] = 'unknown_automation'; continue; }
        if (!v || typeof v !== 'object') { errors[`automations.${k}`] = 'expected_object'; continue; }
        if (v.enabled !== undefined && !bool(v.enabled)) errors[`automations.${k}.enabled`] = 'expected_boolean';
        if (v.offsetHours !== undefined && !int(-720, 2160)(v.offsetHours)) errors[`automations.${k}.offsetHours`] = 'out_of_range';
        for (const extra of Object.keys(v)) if (!['enabled', 'offsetHours'].includes(extra)) errors[`automations.${k}.${extra}`] = 'unknown_field';
        continue;
      }
      const rule = RULES[section] && RULES[section][k];
      if (!rule) { errors[`${section}.${k}`] = 'unknown_field'; continue; }
      if (!rule(v)) errors[`${section}.${k}`] = 'invalid_value';
    }
  }
  return Object.keys(errors).length ? { errors } : { errors: null };
}

async function updateSettings(db, tenantId, patch, actor) {
  const { errors } = validatePatch(patch);
  if (errors) return { ok: false, errors };
  for (const [section, values] of Object.entries(patch)) {
    const row = await db.setting.findUnique({ where: { tenantId_key: { tenantId, key: section } } });
    const current = asJson(row && row.value) || {};
    let next;
    if (section === 'automations') {
      next = { ...current };
      for (const [k, v] of Object.entries(values)) next[k] = { ...(current[k] || {}), ...v };
    } else {
      next = { ...current, ...values };
    }
    if (section === 'email') {
      for (const k of ['domainAllowlist', 'domainBlocklist']) {
        if (next[k]) next[k] = [...new Set(next[k].map((d) => d.toLowerCase().replace(/^@/, '')))];
      }
    }
    await db.setting.upsert({
      where: { tenantId_key: { tenantId, key: section } },
      update: { value: next, updatedBy: actor || null },
      create: { tenantId, key: section, value: next, updatedBy: actor || null }
    });
  }
  return { ok: true, settings: await getSettings(db, tenantId) };
}

module.exports = { DEFAULTS, SECTIONS, getSettings, updateSettings, validatePatch };
