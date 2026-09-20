'use strict';
// Live Proxies connector.
//
// Spec: Live Proxies does not publish its programmatic API on the public site (it is
// documented inside the dashboard, and the B2B help-centre entry only confirms one
// exists). What IS published is the credential shape, in the help centre's own curl
// example:
//   curl -x LV3418547-dc1LU7SsG-33:AL7sj3xus1@172.148.150.38:7383 http://ipinfo.io/
// so the connector takes the plan's proxy list URL from the user's dashboard rather
// than calling a guessed endpoint. Rules these tests hold the code to:
//  1. The list URL is pinned to https + liveproxies.io. A pasted third-party or plain
//     http link must be refused, because that URL carries the account access code and
//     is fetched by the app.
//  2. Lines parse as username:password@host:port, including the documented example and
//     a password containing '@' or ':'.
//  3. A rotating plan lists one gateway endpoint repeatedly; that is ONE proxy, so rows
//     dedupe on host/port/username.
//  4. Plan type only labels the rows; an unknown value falls back to Residential rather
//     than inventing a plan name.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  liveProxiesListUrl, liveProxiesRows, liveProxiesPlanLabel
} = require('../src/main/proxyVendorUtils');

const ROOT = path.join(__dirname, '..');

test('list URL is pinned to https liveproxies.io', () => {
  assert.equal(
    liveProxiesListUrl('https://liveproxies.io/api/plan/123/list?code=abc'),
    'https://liveproxies.io/api/plan/123/list?code=abc'
  );
  // A sub-domain of the vendor is still the vendor.
  assert.ok(liveProxiesListUrl('https://dashboard.liveproxies.io/export/77'));

  // Everything else is refused: the app fetches this URL, and it carries the access code.
  assert.equal(liveProxiesListUrl('http://liveproxies.io/api/list'), null, 'plain http must be refused');
  assert.equal(liveProxiesListUrl('https://liveproxies.io.evil.com/list'), null, 'suffix lookalike must be refused');
  assert.equal(liveProxiesListUrl('https://notliveproxies.io/list'), null);
  assert.equal(liveProxiesListUrl('liveproxies.io/list'), null, 'a bare host is not a URL');
  assert.equal(liveProxiesListUrl(''), null);
  assert.equal(liveProxiesListUrl(null), null);
});

test('parses the credential shape Live Proxies documents', () => {
  // Verbatim from the help centre's "Test with Curl Query" article.
  const rows = liveProxiesRows('LV3418547-dc1LU7SsG-33:AL7sj3xus1@172.148.150.38:7383');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].host, '172.148.150.38');
  assert.equal(rows[0].port, 7383);
  assert.equal(rows[0].username, 'LV3418547-dc1LU7SsG-33');
  assert.equal(rows[0].password, 'AL7sj3xus1');
  assert.equal(rows[0].type, 'HTTP');
});

test('a password containing @ or : survives', () => {
  const rows = liveProxiesRows('user1:p@ss:word@gw.liveproxies.io:7383');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].host, 'gw.liveproxies.io');
  assert.equal(rows[0].port, 7383);
  assert.equal(rows[0].username, 'user1');
  assert.equal(rows[0].password, 'p@ss:word');
});

test('a rotating gateway listed repeatedly is one proxy', () => {
  const body = [
    'u1:pw@gw.liveproxies.io:7383',
    'u1:pw@gw.liveproxies.io:7383',
    'u1:pw@gw.liveproxies.io:7383'
  ].join('\n');
  assert.equal(liveProxiesRows(body).length, 1);
});

test('static plans keep one row per distinct endpoint', () => {
  const body = [
    'u1:pw@172.148.150.38:7383',
    'u1:pw@172.148.150.39:7383',
    '',
    'u1:pw@172.148.150.40:7383'
  ].join('\n');
  const rows = liveProxiesRows(body, { plan: 'static', socks: true, country: 'us' });
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.type === 'SOCKS5'), 'SOCKS5 must carry through');
  assert.ok(rows.every((r) => r.country === 'US'), 'country is normalised to upper case');
  assert.ok(rows[0].label.includes('Static residential'));
  assert.ok(rows[0].label.includes('US'));
});

test('plan label falls back instead of inventing a plan', () => {
  assert.equal(liveProxiesPlanLabel('mobile'), 'Mobile');
  assert.equal(liveProxiesPlanLabel('STATIC'), 'Static residential');
  assert.equal(liveProxiesPlanLabel('enterprise-gold'), 'Residential');
  assert.equal(liveProxiesPlanLabel(''), 'Residential');
});

test('an error body is not mistaken for a proxy list', () => {
  assert.equal(liveProxiesRows('{"error":"plan expired"}').length, 0);
  assert.equal(liveProxiesRows('<html><body>Not found</body></html>').length, 0);
  assert.equal(liveProxiesRows('').length, 0);
});

test('the connector is registered as a real adapter, not a simulation', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
  assert.ok(/liveproxies:\s*'Live Proxies'/.test(src), 'must appear in PROXY_VENDORS');
  assert.ok(/liveproxies:\s*fetchLiveProxiesPool/.test(src), 'must appear in REAL_VENDOR_ADAPTERS');
  // No invented endpoint: the adapter must build its request from the user's URL.
  assert.ok(/liveProxiesListUrl\(apiUrl\)/.test(src), 'the pull must come from the dashboard URL');
});

test('no hardcoded Live Proxies gateway was added', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
  const gw = /const VENDOR_GATEWAYS = Object\.freeze\(\{[\s\S]*?\}\);/.exec(src);
  assert.ok(gw, 'VENDOR_GATEWAYS block must still exist');
  assert.ok(!/liveproxies/i.test(gw[0]), 'the host must come from the pulled list, never a guessed constant');
});
