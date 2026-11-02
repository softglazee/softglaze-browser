'use strict';
// Audit 2 Nov 2026 #3: three things a website could use to spot or link profiles.
//   a) puppeteer's page-observable default switches (popup blocking off, IPC flood
//      protection off, forced sRGB, component extensions off) reached every profile;
//   b) Firefox on Windows ignored TZ=<IANA name>, so a proxied Firefox profile showed
//      the PC's time zone with no warning (verified live: Firefox 157 reported
//      Asia/Karachi for TZ=America/New_York, and America/New_York for TZ=EST5EDT);
//   c) Firefox kept old proxy prefs after a profile changed proxy type or went direct.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const engine = require('../src/main/browserEngine');
const ff = require('../src/main/firefoxEngine');
const ENGINE_SRC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'browserEngine.js'), 'utf8');
const FF_SRC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'firefoxEngine.js'), 'utf8');

test('a) every dropped switch is a real puppeteer default, and the throttling ones stay', () => {
  const defaults = require('puppeteer-core').defaultArgs();
  for (const arg of engine.PUPPETEER_DEFAULT_ARGS_TO_DROP) {
    assert.ok(defaults.includes(arg), `${arg} must exactly match a puppeteer default, or dropping it does nothing`);
  }
  for (const keep of ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']) {
    assert.ok(!engine.PUPPETEER_DEFAULT_ARGS_TO_DROP.includes(keep), `${keep} must stay (macros stall in covered windows without it)`);
  }
  assert.ok(engine.PUPPETEER_DEFAULT_ARGS_TO_DROP.includes('--enable-automation'));
  assert.ok(engine.PUPPETEER_DEFAULT_ARGS_TO_DROP.includes('--disable-popup-blocking'));
});

test('a) the launch passes a fresh copy (stealth pushes into it; the constant is frozen)', () => {
  assert.ok(Object.isFrozen(engine.PUPPETEER_DEFAULT_ARGS_TO_DROP));
  assert.match(ENGINE_SRC, /ignoreDefaultArgs: \[\.\.\.PUPPETEER_DEFAULT_ARGS_TO_DROP\],/);
  const copy = [...engine.PUPPETEER_DEFAULT_ARGS_TO_DROP];
  const stealth = require('puppeteer-extra-plugin-stealth/evasions/defaultArgs')();
  const opts = { ignoreDefaultArgs: copy };
  return stealth.beforeLaunch(opts).then(() => {
    assert.ok(opts.ignoreDefaultArgs.includes('--disable-extensions'), 'stealth could add its own entries');
    assert.ok(opts.ignoreDefaultArgs.includes('--disable-popup-blocking'));
  });
});

test('b) Windows: IANA zones map to the TZ ids Firefox accepts, with the same rules', () => {
  const w = (tz) => ff.firefoxTzEnv(tz, 'win32');
  assert.equal(w('America/New_York'), 'EST5EDT');
  assert.equal(w('America/Toronto'), 'EST5EDT');
  assert.equal(w('America/Indiana/Indianapolis'), 'EST5EDT');
  assert.equal(w('America/Chicago'), 'CST6CDT');
  assert.equal(w('America/Denver'), 'MST7MDT');
  assert.equal(w('America/Los_Angeles'), 'PST8PDT');
  assert.equal(w('Etc/UTC'), 'UTC');
  assert.equal(w('Africa/Accra'), 'UTC');
  assert.equal(w('EST5EDT'), 'EST5EDT');
});

test('b) Windows: zones Firefox cannot apply return null (never a wrong zone)', () => {
  const w = (tz) => ff.firefoxTzEnv(tz, 'win32');
  assert.equal(w('Europe/Berlin'), null);
  assert.equal(w('Asia/Tokyo'), null);
  assert.equal(w('America/Phoenix'), null, 'no DST: MST7MDT would be wrong half the year');
  assert.equal(w('Europe/London'), null, 'has DST: UTC would be wrong half the year');
  assert.equal(w(''), null);
});

test('b) Linux and macOS keep the IANA name (TZ works there)', () => {
  assert.equal(ff.firefoxTzEnv('Europe/Berlin', 'linux'), 'Europe/Berlin');
  assert.equal(ff.firefoxTzEnv('Asia/Tokyo', 'darwin'), 'Asia/Tokyo');
});

test('b) an unsupported zone produces a warning instead of a silent host zone', () => {
  assert.match(FF_SRC, /const tzEnv = timezoneId \? firefoxTzEnv\(timezoneId\) : null;/);
  assert.match(FF_SRC, /if \(timezoneId && !tzEnv && !geoWarning\) geoWarning = firefoxTzUnsupportedWarning\(timezoneId\);/);
  assert.match(FF_SRC, /if \(tzEnv\) env\.TZ = tzEnv;/);
  assert.ok(!/env\.TZ = timezoneId/.test(FF_SRC));
});

const prefsOf = (userJs) => {
  const out = {};
  for (const m of userJs.matchAll(/user_pref\("([^"]+)", (.*)\);/g)) out[m[1]] = JSON.parse(m[2]);
  return out;
};

test('c) no proxy resets every proxy pref (no stale relay from an earlier launch)', () => {
  const p = prefsOf(ff.buildUserJs({}));
  assert.equal(p['network.proxy.type'], 5);
  assert.equal(p['network.proxy.http'], '');
  assert.equal(p['network.proxy.http_port'], 0);
  assert.equal(p['network.proxy.ssl'], '');
  assert.equal(p['network.proxy.socks'], '');
  assert.equal(p['network.proxy.socks_port'], 0);
});

test('c) SOCKS clears the HTTP/SSL fields that would otherwise win for http/https', () => {
  const p = prefsOf(ff.buildUserJs({ proxy: { type: 'SOCKS5', host: '127.0.0.1', port: 50111 } }));
  assert.equal(p['network.proxy.type'], 1);
  assert.equal(p['network.proxy.socks'], '127.0.0.1');
  assert.equal(p['network.proxy.socks_port'], 50111);
  assert.equal(p['network.proxy.socks_version'], 5);
  assert.equal(p['network.proxy.socks_remote_dns'], true);
  assert.equal(p['network.proxy.http'], '');
  assert.equal(p['network.proxy.ssl'], '');
  assert.equal(p['network.proxy.share_proxy_settings'], false);
});

test('c) HTTP clears the SOCKS fields and shares the HTTP proxy for SSL', () => {
  const p = prefsOf(ff.buildUserJs({ proxy: { type: 'HTTP', host: '127.0.0.1', port: 50222 } }));
  assert.equal(p['network.proxy.http'], '127.0.0.1');
  assert.equal(p['network.proxy.http_port'], 50222);
  assert.equal(p['network.proxy.ssl'], '127.0.0.1');
  assert.equal(p['network.proxy.ssl_port'], 50222);
  assert.equal(p['network.proxy.socks'], '');
  assert.equal(p['network.proxy.socks_port'], 0);
  assert.equal(p['network.proxy.share_proxy_settings'], true);
});
