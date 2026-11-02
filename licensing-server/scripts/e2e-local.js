'use strict';
// End-to-end check against a local server: the lease it issues must verify with the app's own
// verifyLease() and only the baked public key. Mints and redeems a code, so no payment provider.
// Usage: node scripts/e2e-local.js <tenantId> <tenantApiKey> [baseUrl]; safe to re-run.
require('dotenv').config();
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const [tenantId, apiKey] = process.argv.slice(2);
const BASE = process.argv[4] || process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:8787';
if (!tenantId || !apiKey) {
  console.error('Usage: node scripts/e2e-local.js <tenantId> <tenantApiKey> [baseUrl]');
  process.exit(1);
}

// The desktop app's real verifier, imported from the app tree — not a copy.
const { verifyLease } = require(path.join(__dirname, '..', '..', 'src', 'main', 'licenseClient.js'));

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function call(pathName, body, headers) {
  const res = await fetch(BASE + pathName, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(headers || {}) },
    body: JSON.stringify(body || {})
  });
  let json = {};
  try { json = await res.json(); } catch (_) { /* empty body */ }
  return { status: res.status, json };
}

async function main() {
  const admin = { authorization: `Bearer ${apiKey}` };
  const machineId = randomUUID();
  // The build config provision-tenant.js emitted — the same file build-tenant.js bakes.
  const tenantCfg = require(path.join(__dirname, '..', 'tenants', `${tenantId}.config.json`));

  // The one paid plan the site sells.
  const plan = await call('/v1/tenant/plans', {
    key: 'pro', name: 'Pro', tier: 'pro', amount: 500, currency: 'USD',
    months: 1, interval: 'month', recurring: true
  }, admin);
  check('plan "pro" upserts at $5.00/month recurring',
    plan.status === 200 && plan.json.amount === 500 && plan.json.recurring === true,
    `status ${plan.status}, amount ${plan.json.amount}, recurring ${plan.json.recurring}`);

  const reg = await call('/v1/register', { tenantId, machineId });
  const { installId, installSecret } = reg.json || {};
  check('register returns an installId and a one-time install secret',
    reg.status === 200 && !!installId && !!installSecret, `status ${reg.status}`);

  const reReg = await call('/v1/register', { tenantId, machineId });
  check('re-registering a known machine without its secret is refused (403)',
    reReg.status === 403, `status ${reReg.status}`);

  const reRegOk = await call('/v1/register', { tenantId, machineId, installSecret });
  check('re-registering with the secret returns the same installId',
    reRegOk.status === 200 && reRegOk.json.installId === installId, `status ${reRegOk.status}`);

  const none = await call('/v1/license', { tenantId, installId, installSecret });
  check('an unlicensed install gets lease:null, not a lease',
    none.status === 200 && none.json.lease === null, `status ${none.status}, status field "${none.json.status}"`);

  const wrong = await call('/v1/license', { tenantId, installId, installSecret: 'not-the-secret' });
  check('a wrong install secret is rejected (401)', wrong.status === 401, `status ${wrong.status}`);

  const minted = await call('/v1/tenant/codes', { tier: 'pro', months: 1, count: 1 }, admin);
  const code = (minted.json.codes || [])[0];
  check('tenant admin mints an activation code', minted.status === 200 && !!code, `status ${minted.status}`);

  const redeemed = await call('/v1/redeem', { tenantId, code, installId, installSecret });
  check('the code redeems against this install', redeemed.status === 200, `status ${redeemed.status}`);

  const replay = await call('/v1/redeem', { tenantId, code, installId, installSecret });
  check('the same code cannot be redeemed twice', replay.status >= 400, `status ${replay.status}`);

  const lic = await call('/v1/license', { tenantId, installId, installSecret });
  const lease = lic.json.lease;
  check('a licensed install gets a signed lease', lic.status === 200 && typeof lease === 'string' && lease.includes('.'),
    `status ${lic.status}, tier ${lic.json.tier}`);

  const ent = verifyLease(lease, { publicKeyPem: tenantCfg.publicKeyPem });
  check('the app\'s verifyLease() accepts the lease with only the baked public key',
    !!ent && ent.tier === 'pro' && ent.tenant === tenantId,
    ent ? `tier ${ent.tier}, expires ${new Date(ent.exp * 1000).toISOString()}` : 'verifyLease returned null');

  const [payloadB64, sigB64] = String(lease).split('.');
  const flipped = Buffer.from(payloadB64, 'base64url').toString('utf8').replace('"pro"', '"enterprise"');
  const forged = `${Buffer.from(flipped).toString('base64url')}.${sigB64}`;
  check('a lease edited to claim a higher tier does not verify',
    verifyLease(forged, { publicKeyPem: tenantCfg.publicKeyPem }) === null);

  const other = require('node:crypto').generateKeyPairSync('ed25519');
  const otherPem = other.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  check('a genuine lease does not verify under another tenant\'s public key',
    verifyLease(lease, { publicKeyPem: otherPem }) === null);

  const co = await call('/v1/checkout', { tenantId, planKey: 'pro', installId });
  check('checkout with no payment provider configured fails cleanly (400)',
    co.status === 400, `status ${co.status}: ${co.json.error || ''}`);

  // Drive the same flow through the app's own transport (licenseClient.api + tenantConfig env
  // overrides), so the server sees the client's real request shapes.
  process.env.SG_TENANT_ID = tenantId;
  process.env.SG_API_BASE_URL = BASE;
  process.env.SG_TENANT_PUBLIC_KEY = tenantCfg.publicKeyPem;
  const { _reset } = require(path.join(__dirname, '..', '..', 'src', 'main', 'tenantConfig.js'));
  _reset(); // drop the memoized empty base config
  const licenseClient = require(path.join(__dirname, '..', '..', 'src', 'main', 'licenseClient.js'));

  const appMachineId = randomUUID();
  const appReg = await licenseClient.api.register(appMachineId, null, undefined);
  check('the app\'s api.register() registers an install',
    !!appReg.installId && !!appReg.installSecret);

  const appNone = await licenseClient.api.license({ installId: appReg.installId, installSecret: appReg.installSecret });
  check('the app\'s api.license() reports no lease before purchase', appNone.lease === null);

  const minted2 = await call('/v1/tenant/codes', { tier: 'pro', months: 1, count: 1 }, admin);
  await licenseClient.api.redeem({
    code: (minted2.json.codes || [])[0], installId: appReg.installId, installSecret: appReg.installSecret
  });
  const appLic = await licenseClient.api.license({ installId: appReg.installId, installSecret: appReg.installSecret });
  const appEnt = licenseClient.verifyLease(appLic.lease);
  check('the app redeems, fetches and verifies a lease end to end',
    !!appEnt && appEnt.tier === 'pro' && appEnt.tenant === tenantId,
    appEnt ? `tier ${appEnt.tier}, period ends ${appLic.currentPeriodEnd}` : 'verifyLease returned null');

  let rejected = false;
  try { await licenseClient.api.license({ installId: appReg.installId, installSecret: 'wrong' }); }
  catch (e) { rejected = /install secret|401/i.test(e.message); }
  check('the app\'s transport surfaces a rejected install secret as an error', rejected);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
