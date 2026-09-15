'use strict';
// Rotate IP for pooled proxies.
//
// DataImpulse sticky proxies (ports 10000 and up) get a fresh exit IP from
// GET https://gw.dataimpulse.com:777/api/rotate_ip?port=N, authenticated with the plan login
// (the part of the stored username before "__"). Proxies with a vendor rotation link keep the
// existing link path. The pool only offers the action where a rotation can actually happen.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { proxySellerOrderRows } = require('../src/main/proxyVendorUtils');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const POOL = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'pages', 'ProxyPoolPage.jsx'), 'utf8');

function fnBody(name) {
  const m = new RegExp(`(?:async )?function ${name}\\(([\\s\\S]*?)\\n\\}`).exec(IPC);
  assert.ok(m, `${name} must exist in ipcHandlers.js`);
  return m[0];
}

test('a DataImpulse sticky proxy without a link rotates through the vendor API', () => {
  const rotate = fnBody('rotateProxyIp');
  const diAt = rotate.indexOf('isDataImpulseSticky(proxy)');
  const throwAt = rotate.indexOf('No IP rotation link is configured');
  assert.ok(diAt > -1 && throwAt > -1 && diAt < throwAt,
    'the DataImpulse branch must run before the "no link" refusal');
  assert.match(rotate, /await requirePermission\('proxies\.manage'\)/, 'the action stays gated');
  assert.match(rotate, /await assertCanAccessProxy\(id\)/, 'and scoped to proxies the caller can access');
});

test('only real DataImpulse sticky rows qualify', () => {
  const body = fnBody('isDataImpulseSticky');
  assert.match(body, /provider/);
  assert.match(body, /dataimpulse\\\.com\$/, 'the host must be DataImpulse, not whatever the provider tag says');
  assert.match(body, /Number\(proxy\.port\) >= 10000/, 'the rotating gateway (port 823) has no session to reset');
});

test('the reset call uses the port and the base plan login', () => {
  const body = fnBody('rotateDataImpulseSticky');
  assert.match(body, /\$\{DI_API\}\/rotate_ip\?port=/);
  assert.match(body, /String\(proxy\.username\)\.split\('__'\)\[0\]/, 'Basic Auth needs the login without the targeting suffix');
  assert.match(body, /status \|\| ''\)\.toLowerCase\(\) !== 'ok'/, 'a refused reset must surface as an error');
  assert.match(body, /30 seconds/, 'the vendor minimum interval is named in the error');
  assert.match(body, /"message"\\s\*:\\s\*"\(\[\^"\]\+\)"/, 'the vendor message is shown instead of raw JSON');
  assert.match(body, /scrubProxySecrets\(/, 'transport errors must not echo credentials');
});

test('the pool is told which rows can rotate', () => {
  assert.match(fnBody('serializeProxy'), /canRotate: Boolean\(proxy\.rotationUrl\) \|\| isDataImpulseSticky\(proxy\)/);
});

test('the Rotate IP buttons only render for rows that can rotate, then re-check the proxy', () => {
  const gated = POOL.match(/\{proxy\.canRotate && \(/g) || [];
  assert.ok(gated.length >= 2, 'both the hover icon and the action button must be gated on canRotate');
  const handler = /async function handleRotate\(proxy\) \{[\s\S]*?\n  \}/.exec(POOL);
  assert.ok(handler, 'handleRotate must exist');
  assert.match(handler[0], /softglazeApi\.proxies\.rotateIp\(\{ id: proxy\.id \}\)/);
  assert.match(handler[0], /await handleCheck\(proxy\)/, 'the new exit IP must be shown by re-checking');
});

test('rotation strings exist in every locale', () => {
  for (const locale of ['en', 'es']) {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', locale, 'proxies.json'), 'utf8'));
    for (const key of ['rotateIp', 'rotateIpTitle']) assert.ok(json.rowActions[key], `${locale} rowActions.${key}`);
    for (const key of ['rotate', 'rotateStatus']) assert.ok(json.errors[key], `${locale} errors.${key}`);
  }
});

test('a Proxy-Seller reboot link becomes the rotation link only when it is a real URL', () => {
  const base = { ip: '1.2.3.4', port_http: 8080, login: 'u', password: 'p', status_type: 'ACTIVE' };
  assert.equal(proxySellerOrderRows([{ ...base, link_reboot: 'https://proxy-seller.com/reboot/abc' }])[0].rotationUrl, 'https://proxy-seller.com/reboot/abc');
  assert.equal(proxySellerOrderRows([{ ...base, link_reboot: '#' }])[0].rotationUrl, null);
  assert.equal(proxySellerOrderRows([base])[0].rotationUrl, null);
});

test('pulled rows carry the rotation link into the pool', () => {
  const fn = /async function syncVendorPool\([\s\S]*?\n}\r?\n/.exec(IPC);
  assert.match(fn[0], /row\.rotationUrl \? \{ rotationUrl: row\.rotationUrl \} : \{\}/);
});
