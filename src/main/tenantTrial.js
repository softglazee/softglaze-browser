'use strict';
// The free trial in tenant (sellable) builds. The licensing server's trial ledger (spec A3) allows one
// trial per computer and per email and returns a signed trial lease; only that lease grants a trial.
// A local licence row with a trialEndsAt no longer does, so wiping the app data and signing up again
// gets nothing. Trials that were already running before this version keep going until they end
// (recorded once, in Setting[CUTOVER_SETTING]). Base builds are untouched: ipcHandlers.js only calls
// this when tenantConfig().enabled. Pure apart from injected dependencies.
const licensePolicy = require('./licensePolicy');
const { coded, mapServerError } = require('./serverErrors');
const { normalizeEmail, installFor, startVerification, checkVerification } = require('./tenantSignup');

const CUTOVER_SETTING = 'tenantTrialCutover';

const toIso = (v) => {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// The local trials that existed when this version first ran: { v, at, legacy: { [licenseId]: endsAtIso } }.
function buildCutover(rows, atIso) {
  const legacy = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || String(r.type || '').toLowerCase() !== 'trial') continue;
    const ends = toIso(r.trialEndsAt);
    if (ends) legacy[String(r.id)] = ends;
  }
  return { v: 1, at: atIso || new Date().toISOString(), legacy };
}

// How a tenant build reads a local licence row when no verified lease applies:
//   { kind: 'local', lic }        run the usual state machine on lic (trial, grace, then locked)
//   { kind: 'none', trialUsed }   no plan: start the trial, buy or redeem a code
function localDecision(lic, cutover, nowMs) {
  if (!lic) return { kind: 'none', trialUsed: false };
  const type = String(lic.type || '').toLowerCase();
  if (type === 'paid') return { kind: 'local', lic };
  const legacyEnd = cutover && cutover.legacy ? cutover.legacy[String(lic.id)] : undefined;
  if (legacyEnd) {
    // A trial from before server trials: honoured to the end it had then, never extended.
    const cur = toIso(lic.trialEndsAt);
    const end = cur && new Date(cur).getTime() < new Date(legacyEnd).getTime() ? cur : legacyEnd;
    return { kind: 'local', lic: { ...lic, trialEndsAt: end }, legacy: true };
  }
  const ends = toIso(lic.trialEndsAt);
  if (!ends) return { kind: 'none', trialUsed: Boolean(lic.purchaseCode) };
  // A server trial recorded here: after its end the usual grace and lock apply. Before its end only the
  // signed lease grants it; without one (reset or revoked on the server) there is no plan.
  if (Number(nowMs) > new Date(ends).getTime()) return { kind: 'local', lic };
  return { kind: 'none', trialUsed: true };
}

// The licence view for "no plan yet". isBanned keeps profile launches refused in main; needsPlan tells
// the Gate to show the plan step (trial / buy / code) rather than the "subscription ended" screen.
function noPlanView({ trialUsed = false, adminBlocked = false, clockTamper = false, plan = null } = {}) {
  return {
    type: 'none',
    tier: 'pro',
    state: adminBlocked ? 'banned' : 'none',
    status: adminBlocked ? 'banned' : 'inactive',
    endsAt: null,
    graceEndsAt: null,
    daysLeft: null,
    daysLeftTrial: null,
    daysLeftGrace: null,
    isExpired: false,
    isTrial: false,
    isPaid: false,
    isGrace: false,
    isBanned: true,
    adminBlocked: Boolean(adminBlocked),
    needsPlan: !adminBlocked,
    clockTamper: Boolean(clockTamper),
    purchaseCode: null,
    trialUsed: Boolean(trialUsed),
    plan
  };
}

// The view for a verified trial lease: Trial (the tier the server signed, Enterprise), ending at the
// trial's end date.
function trialViewFromLease(ent, nowMs, plan = null) {
  const endsAt = toIso(ent.currentPeriodEnd) || (ent.exp ? new Date(ent.exp * 1000).toISOString() : null);
  const st = licensePolicy.computeLicenseState({ type: 'trial', trialEndsAt: endsAt, now: nowMs, graceDays: 0 });
  const days = st.isTrial ? st.daysLeftTrial : 0;
  return {
    type: 'trial',
    tier: ent.tier === 'enterprise' ? 'enterprise' : 'pro',
    state: 'trialing',
    status: 'active',
    endsAt,
    graceEndsAt: null,
    daysLeft: days,
    daysLeftTrial: days,
    daysLeftGrace: null,
    isExpired: false,
    isTrial: true,
    isPaid: false,
    isGrace: false,
    isBanned: false,
    isExempt: false,
    clockTamper: false,
    purchaseCode: null,
    trialUsed: true,
    plan,
    source: 'backend'
  };
}

// Starts the trial on the server. With `code`, first confirms the owner's email (an account made
// before server sign-up was never checked). Resolves { token, tier, endsAt }; throws a mapped error
// (TRIAL_USED, TRIAL_OFFLINE, TRIAL_VERIFY_EMAIL after emailing a code, ...).
async function startServerTrial({ ensureInstall, api, verifyLease, nowMs, email, code }) {
  const addr = normalizeEmail(email);
  if (!addr) throw coded('TRIAL_NO_EMAIL');
  const install = await installFor(ensureInstall, 'trial');
  const same = async () => install;
  if (code) await checkVerification({ ensureInstall: same, api, email: addr, code, context: 'trialVerifyCheck' });
  let res;
  try {
    res = await api.trialStart({ installId: install.installId, installSecret: install.installSecret, email: addr });
  } catch (e) {
    const mapped = mapServerError(e, 'trial');
    if (mapped.code === 'TRIAL_VERIFY_EMAIL') {
      if (code) throw coded('TRIAL_FAILED', { serverCode: mapped.serverCode }); // checked, yet still refused
      await startVerification({ ensureInstall: same, api, email: addr, context: 'trialVerify' });
      mapped.sentTo = addr;
    }
    throw mapped;
  }
  const ent = res && typeof res.lease === 'string' ? verifyLease(res.lease, { nowMs }) : null;
  if (!ent) throw coded('TRIAL_FAILED');
  const endsAt = toIso(res.trialEndsAt) || toIso(res.currentPeriodEnd) || new Date(ent.exp * 1000).toISOString();
  return { token: res.lease, tier: ent.tier === 'enterprise' ? 'enterprise' : 'pro', endsAt };
}

module.exports = {
  CUTOVER_SETTING,
  buildCutover,
  localDecision,
  noPlanView,
  trialViewFromLease,
  startServerTrial
};
