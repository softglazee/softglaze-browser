'use strict';
// Regression tests for the 29 Sep 2026 CAPTCHA investigation.
//  1. Chrome launched with --remote-debugging-port=0 (puppeteer's default) runs in automation
//     mode: navigator.webdriver=true and Google Search serves a CAPTCHA on every IP. A fixed
//     free port does not. The launch must always pass debuggingPort.
//  2. Geo databases disagree on leased proxy ranges; the launch geo is a consensus of three
//     services, with the vendor's target country as the tie-breaker.
//  3. The launch geo cache must not hand one sticky session's location to another session on
//     the same gateway host:port.
//  4. Proxy checks race two HTTPS IP services, so IPv6-only exits no longer wait ~31 s.
//  5. A freshly pulled proxy answering 407 is retried briefly before it is marked dead.
//  6. Proxy-Seller per-IP orders honour the requested count and skip addresses already held.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../src/main/proxyVendorUtils');

const ROOT = path.join(__dirname, '..');
const ENGINE = fs.readFileSync(path.join(ROOT, 'src', 'main', 'browserEngine.js'), 'utf8');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');

test('1: every profile launch sets a fixed DevTools port, never port 0', () => {
  assert.ok(ENGINE.includes('function getFreeLocalPort'), 'free-port helper exists');
  assert.match(ENGINE, /launchOptions\.debuggingPort = await getFreeLocalPort\(\)/);
  const launchAt = ENGINE.indexOf('browser = await engine.launch(launchOptions)');
  const portAt = ENGINE.indexOf('launchOptions.debuggingPort = await getFreeLocalPort()');
  assert.ok(portAt > 0 && portAt < launchAt, 'the port is set before the launch call');
  assert.match(ENGINE, /ignoreDefaultArgs: \['--enable-automation'\]/, 'the automation flag stays stripped');
});

test('2: pickGeoConsensus takes the majority country and its timezone', () => {
  const ipinfo = { countryCode: 'PT', timezone: 'Europe/Lisbon', query: '169.128.195.52' };
  const ipapi = { countryCode: 'US', timezone: 'America/Denver', query: '169.128.195.52' };
  const geojs = { countryCode: 'US', timezone: 'America/Denver', query: '169.128.195.52' };
  const g = U.pickGeoConsensus([ipinfo, ipapi, geojs]);
  assert.equal(g.countryCode, 'US');
  assert.equal(g.timezone, 'America/Denver');
  assert.equal(g.geoVotes, '2/3');
});

test('2: a tie goes to the vendor target country, then to service order', () => {
  const a = { countryCode: 'PT', timezone: 'Europe/Lisbon' };
  const b = { countryCode: 'US', timezone: 'America/Denver' };
  assert.equal(U.pickGeoConsensus([a, b], { countryHint: 'us' }).countryCode, 'US');
  assert.equal(U.pickGeoConsensus([a, b]).countryCode, 'PT', 'no hint: first service wins the tie');
  assert.equal(U.pickGeoConsensus([null, b, null]).countryCode, 'US', 'failed services are ignored');
  assert.equal(U.pickGeoConsensus([null, { countryCode: '' }]), null, 'nothing valid -> null');
});

test('2: the launch lookup asks three services in parallel and passes the country hint', () => {
  assert.match(ENGINE, /Promise\.all\(\[\s*attempt\(targetUrl, mapResponse\),\s*attemptHttp\('http:\/\/ip-api\.com/);
  assert.match(ENGINE, /pickGeoConsensus\(answers, \{ countryHint: proxy\.country \}\)/);
  assert.match(ENGINE, /country: \(input\.country \|\| input\.lastCountry \|\| null\)/);
});

test('3: the geo cache key includes the credentials, hashed', () => {
  const body = ENGINE.slice(ENGINE.indexOf('function proxyGeoKey'), ENGINE.indexOf('async function lookupProxyGeoNodeCached'));
  assert.match(body, /proxy\.username/);
  assert.match(body, /createHash\('sha256'\)/, 'credentials never appear in the key in clear');
});

test('4: proxy checks race ipinfo and geojs', () => {
  assert.match(IPC, /await Promise\.any\(\[viaIpinfo, viaGeojs\]\)/);
});

test('5: a fresh proxy failing with 407 is retried, older ones are not', () => {
  const body = IPC.slice(IPC.indexOf('async function checkProxy(payload)'), IPC.indexOf('async function checkProxy(payload)') + 2600);
  assert.match(body, /\\b407\\b/);
  assert.match(body, /ageMs \+ attempt \* 8000 < 180000/, 'only within 3 minutes of creation');
});

test('6: Proxy-Seller per-IP pulls honour count and skip held addresses', () => {
  const body = IPC.slice(IPC.indexOf('async function fetchProxySellerOrderPool'), IPC.indexOf('async function fetchProxySellerPool'));
  assert.match(body, /existingPorts\(\{ host: r\.host, login: r\.username \}\)/);
  assert.match(body, /fresh\.slice\(0, wanted\)/);
  assert.match(IPC, /fetchProxySellerOrderPool\(key, \{ product, proxyType, orderId, count, existingPorts \}\)/);
});

test('7: visible profiles launch without the stealth plugin; only headless gets it', () => {
  assert.ok(ENGINE.includes('function useStealthFor'), 'the headless-only rule exists');
  assert.match(ENGINE, /const stealth = !usingAntidetect && useStealthFor\(\{ headless \}\)/);
  assert.match(ENGINE, /getRuntimeFixPuppeteer\(\{ stealth \}\)/, 'the minimize-CDP engine follows the same rule');
  assert.match(ENGINE, /if \(stealth\) engine\.use\(makeStealth\(\)\)/);
  // getNativeEngine (the clean driver) never registers the plugin.
  const native = ENGINE.slice(ENGINE.indexOf('function getNativeEngine'), ENGINE.indexOf('function getNativeEngine') + 300);
  assert.doesNotMatch(native, /makeStealth/);
});
