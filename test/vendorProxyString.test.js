'use strict';
// parseVendorProxyString and collectVendorStrings, shared by the ResiProx and SimplyNode connectors.
// Neither vendor publishes the format of its generated proxy string, so the cases are the shapes their
// specs list, including the inferred ones from SimplyNode's help centre and FAQ (placeholders only).
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../src/main/proxyVendorUtils');

const ok = (raw) => {
  const r = U.parseVendorProxyString(raw);
  assert.equal(r.ok, true, `${raw} should parse`);
  return [r.host, r.port, r.username, r.password];
};

test('a URL: http, https, socks5 and socks5h, with an encoded login', () => {
  assert.deepEqual(ok('http://user1:pass1@go.resiprox.com:5000'), ['go.resiprox.com', 5000, 'user1', 'pass1']);
  assert.deepEqual(ok('socks5://user1:pass1@go.resiprox.com:5000/'), ['go.resiprox.com', 5000, 'user1', 'pass1']);
  assert.deepEqual(ok('https://us%40er:p%3Ass%40x@go.resiprox.com:5000'), ['go.resiprox.com', 5000, 'us@er', 'p:ss@x']);
  assert.equal(U.parseVendorProxyString('socks5h://u:p@ip.simplynode.io:9003').scheme, 'socks5h');
  // SimplyNode's flag format (FAQ and /locations examples): the flags ride in the password.
  assert.deepEqual(ok('http://login:country-de-city-berlin-session-abc-ttl-1800@ip.simplynode.io:9003'),
    ['ip.simplynode.io', 9003, 'login', 'country-de-city-berlin-session-abc-ttl-1800']);
});

test('user:pass@host:port, including SimplyNode\'s port format with a semicolon password', () => {
  assert.deepEqual(ok('m123qWerTy:wifi;us;;;@proxy.simplynode.io:9000'), ['proxy.simplynode.io', 9000, 'm123qWerTy', 'wifi;us;;;']);
  assert.deepEqual(ok('m123qWerTy:wifi;@proxy.simplynode.io:9001'), ['proxy.simplynode.io', 9001, 'm123qWerTy', 'wifi;']);
  assert.deepEqual(ok('user:pa:ss@go.resiprox.com:5000'), ['go.resiprox.com', 5000, 'user', 'pa:ss'], 'only the first colon splits the login');
  assert.deepEqual(ok('user:p@ss@go.resiprox.com:5000'), ['go.resiprox.com', 5000, 'user', 'p@ss'], 'the last @ splits the endpoint');
  assert.deepEqual(ok('user:pass@[2001:db8::1]:8080'), ['2001:db8::1', 8080, 'user', 'pass']);
});

test('host:port:user:pass, the password may hold colons', () => {
  assert.deepEqual(ok('go.resiprox.com:5000:user1:pass1'), ['go.resiprox.com', 5000, 'user1', 'pass1']);
  assert.deepEqual(ok('203.0.113.5:5000:user1:pa:ss:1'), ['203.0.113.5', 5000, 'user1', 'pa:ss:1']);
});

test('host:port alone is a proxy without a login, refused as noLogin', () => {
  for (const raw of ['go.resiprox.com:5000', 'http://go.resiprox.com:5000', '[2001:db8::1]:8080', 'user@go.resiprox.com:5000', 'go.resiprox.com:5000:user1:', 'http://:pass@go.resiprox.com:5000']) {
    assert.deepEqual(U.parseVendorProxyString(raw), { ok: false, reason: 'noLogin' }, raw);
  }
});

test('anything else fails clearly instead of becoming a half-parsed row', () => {
  for (const raw of ['', null, 'junk', 'ftp://u:p@h.example:21', 'u:p@host', 'u:p@host:0', 'u:p@host:65536', 'u:p@ho st:80', 'u:p@bad_host!:80',
    '{"proxy_string":"x"}', 'http://u:p@h.example:80/path', 'http://u:p@h.example:80?x=1', 'u:p@h.example:80 extra', 'host:port:user:pass']) {
    assert.deepEqual(U.parseVendorProxyString(raw), { ok: false, reason: 'unreadable' }, String(raw));
  }
});

test('collectVendorStrings keeps distinct strings, 3 calls at a time, and stops on a repeat', async () => {
  let inFlight = 0; let peak = 0; let n = 0;
  const fetchOne = async () => {
    inFlight += 1; peak = Math.max(peak, inFlight);
    await new Promise((r) => setImmediate(r));
    inFlight -= 1; n += 1;
    return `u-${n}:p@go.resiprox.com:5000`;
  };
  const r = await U.collectVendorStrings(7, fetchOne, { inFlight: 3 });
  assert.equal(r.strings.length, 7);
  assert.equal(peak, 3);
  const same = await U.collectVendorStrings(5, async () => 'u:p@go.resiprox.com:5000');
  assert.deepEqual([same.strings.length, same.repeated], [1, true], 'a rotating string repeats itself: the pull ends');
});

test('collectVendorStrings keeps what it made before an error or the deadline', async () => {
  let n = 0;
  const r = await U.collectVendorStrings(6, async () => { n += 1; if (n > 4) throw new Error('429'); return `s${n}`; }, { inFlight: 2 });
  assert.deepEqual(r.strings, ['s1', 's2', 's3', 's4']);
  assert.equal(r.error.message, '429');
  let t = 0;
  const late = await U.collectVendorStrings(5, async () => `x${t}`, { inFlight: 1, deadlineMs: 10, now: () => { t += 6; return t; } });
  assert.equal(late.timedOut, true);
  assert.ok(late.strings.length < 5);
});

test('vendorErrorText reads Laravel, error and message bodies, without links', () => {
  assert.equal(U.vendorErrorText('HTTP 422 {"message":"The given data was invalid.","errors":{"country_code":["The selected country code is invalid."]}}'), 'The selected country code is invalid');
  assert.equal(U.vendorErrorText('{"error":"Unknown city https://app.example/x?apiKey=abc"}'), 'Unknown city');
  assert.equal(U.vendorErrorText('{"error":{"code":"bad","message":"Bad request"}}'), 'Bad request');
  assert.equal(U.vendorErrorText('<html>'), '');
  assert.equal(U.retryAfterWait('45'), '45 seconds');
  assert.equal(U.retryAfterWait(undefined), 'a minute');
  assert.equal(U.retryAfterWait('Wed, 21 Oct 2026 07:28:00 GMT'), 'a minute');
});
