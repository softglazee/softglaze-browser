'use strict';
// Boots the real Express app over HTTP with an in-memory Prisma, a recording email transport and a
// fake DNS resolver. Require it first in a test file (it sets the env before src/ loads).
const crypto = require('node:crypto');
const path = require('node:path');
const os = require('node:os');

process.env.MASTER_KEY = process.env.MASTER_KEY || crypto.randomBytes(32).toString('base64');
process.env.DATABASE_URL = 'mysql://test@127.0.0.1/test';
process.env.PUBLIC_BASE_URL = 'https://api.test';
process.env.LEASE_DAYS = '7';
// Every test request comes from 127.0.0.1; the per-IP limiter has its own test.
process.env.PUBLIC_RATE_PER_MIN = '100000';
process.env.VERIFY_RATE_PER_MIN = '100000';
process.env.AUTH_RATE_PER_MIN = '100000';
if (!process.env.CONFIG_ENV_FILE) process.env.CONFIG_ENV_FILE = path.join(os.tmpdir(), `sg-no-config-${process.pid}.env`);
for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_PORT', 'TRUST_PROXY_HOPS', 'EMAIL_DOMAIN_ALLOWLIST', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_API_VERSION']) delete process.env[k];

const { memoryPrisma } = require('./memoryPrisma');
const db = memoryPrisma();
const dbPath = require.resolve('../../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };

const transport = require('../../src/email/transport');
const mx = require('../../src/customers/mx');
const { generateTenantKeypair, sha256Hex } = require('../../src/crypto/keys');
const { seal } = require('../../src/crypto/secrets');

// Recording SMTP stand-in. mail.fail = (msg) => Error | null makes a send fail.
const mail = {
  sent: [],
  fail: null,
  async sendMail(msg) {
    const err = this.fail && this.fail(msg);
    if (err) throw err;
    this.sent.push(msg);
    return { messageId: `<m${this.sent.length}@test>` };
  },
  last() { return this.sent[this.sent.length - 1]; },
  codeFor(to) {
    const m = [...this.sent].reverse().find((x) => x.to === to);
    const hit = m && /\b(\d{6})\b/.exec(m.text);
    return hit ? hit[1] : null;
  }
};
transport.setTransportForTests(mail);

// DNS: domains in `dns.noMx` have no mail records, `dns.missing` do not exist, `dns.slow` time out.
const dns = { noMx: new Set(['nomail.example']), missing: new Set(['doesnotexist.example']), slow: new Set() };
mx.setResolverFactoryForTests(() => ({
  async resolveMx(d) {
    if (dns.slow.has(d)) { const e = new Error('timeout'); e.code = 'ETIMEOUT'; throw e; }
    if (dns.missing.has(d)) { const e = new Error('nx'); e.code = 'ENOTFOUND'; throw e; }
    if (dns.noMx.has(d)) { const e = new Error('nodata'); e.code = 'ENODATA'; throw e; }
    return [{ exchange: `mx.${d}`, priority: 10 }];
  },
  async resolve4(d) { if (dns.missing.has(d)) { const e = new Error('nx'); e.code = 'ENOTFOUND'; throw e; } const e = new Error('nodata'); e.code = 'ENODATA'; throw e; },
  async resolve6() { const e = new Error('nodata'); e.code = 'ENODATA'; throw e; }
}));

const app = require('../../src/server');

let server;
let base;
async function start() {
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  return base;
}
function stop() { return new Promise((r) => server.close(r)); }

async function call(method, url, { body, headers = {}, raw = false } = {}) {
  const h = { ...headers };
  let payload;
  if (body !== undefined) {
    if (typeof body === 'string') payload = body;
    else { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
  }
  const r = await fetch(base + url, { method, headers: h, body: payload });
  const text = await r.text();
  let json = null;
  if (!raw) { try { json = JSON.parse(text); } catch (_) { json = null; } }
  return { status: r.status, json, text, headers: r.headers };
}

const ADMIN_KEY = 'sgls_test_admin_key_value';
let tenantKeys = null;

// A tenant with real Ed25519 keys and the two live plans.
async function seedTenant(id = 'tenant1') {
  const { publicKeyPem, privateKeyPem } = generateTenantKeypair();
  tenantKeys = { publicKeyPem };
  await db.tenant.create({ data: { id, name: 'SoftGlaze', publicKeyPem, privateKeySealed: seal(privateKeyPem), apiKeyHash: sha256Hex(ADMIN_KEY), status: 'active' } });
  await db.plan.create({ data: { tenantId: id, key: 'pro', name: 'Pro', tier: 'pro', amount: 500, currency: 'USD', interval: 'month', months: 1, sortOrder: 1 } });
  await db.plan.create({ data: { tenantId: id, key: 'enterprise', name: 'Enterprise', tier: 'enterprise', amount: 2900, currency: 'USD', interval: 'month', months: 1, sortOrder: 2, highlight: true } });
  return { id, publicKeyPem };
}

const mh = (seed) => crypto.createHash('sha256').update(String(seed)).digest('hex');

// Registers an install and returns { installId, installSecret, machineHash }.
async function newInstall(tenantId, seed, extra = {}) {
  const machineHash = mh(`machine-${seed}`);
  const r = await call('POST', '/v1/register', { body: { tenantId, machineId: `mid-${seed}`, machineHash, ...extra } });
  if (r.status !== 200) throw new Error(`register failed ${r.status} ${r.text}`);
  return { installId: r.json.installId, installSecret: r.json.installSecret, machineHash };
}

// Verifies `email` on the install through the real endpoints.
async function verify(tenantId, inst, email, extra = {}, headers = {}) {
  const s = await call('POST', '/v1/account/verify/start', { body: { tenantId, ...inst, email, consentMarketing: false, lang: 'en', ...extra }, headers });
  if (s.status !== 200) return s;
  const code = mail.codeFor(email.trim().toLowerCase());
  return call('POST', '/v1/account/verify/check', { body: { tenantId, ...inst, email, code }, headers });
}

function decodeLease(token) {
  const [p, s] = token.split('.');
  return { payload: JSON.parse(Buffer.from(p, 'base64url').toString('utf8')), p, s };
}
function leaseVerifies(token, publicKeyPem) {
  const { p, s } = decodeLease(token);
  return crypto.verify(null, Buffer.from(p), crypto.createPublicKey(publicKeyPem), Buffer.from(s, 'base64url'));
}

const admin = (method, url, opts = {}) => call(method, `/v1/admin${url}`, { ...opts, headers: { authorization: `Bearer ${opts.key || ADMIN_KEY}`, 'x-admin-actor': 'azhar', ...(opts.headers || {}) } });

module.exports = { db, mail, dns, app, start, stop, call, admin, seedTenant, newInstall, verify, decodeLease, leaseVerifies, mh, ADMIN_KEY, getTenantKeys: () => tenantKeys };
