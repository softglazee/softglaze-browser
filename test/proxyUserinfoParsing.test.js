'use strict';
// Regression tests for proxy connection-string parsing.
//
// Background: the README documents `http://username:password@host:port` and
// `socks5://username:password@host:port` as supported batch formats, and
// parseColonProxyLine routes any '@'-bearing line straight to parseProxyString. But
// parseProxyString only ever split on ':', so `http://user:pass@1.2.3.4:8080` parsed
// to host='user', port=NaN, username='8080' -- and it did NOT throw, so a silently
// broken proxy row reached the database and every launch through it failed.
//
// A bracketed IPv6 literal had the same shape of bug: its own colons were read as the
// port separator. And once IPv6 parses, every place that rebuilds a proxy URL has to
// bracket it again or the authority is malformed.

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseProxyInput, buildProxyServerArgument, formatProxyHost } = require('../src/main/browserEngine');

// --- 1) the userinfo form the README promises ------------------------------

test('userinfo form parses host, port, username and password correctly', () => {
  for (const raw of ['http://user:pass@1.2.3.4:8080', 'user:pass@1.2.3.4:8080']) {
    const p = parseProxyInput(raw);
    assert.equal(p.host, '1.2.3.4', `host must be the real host, not the username (${raw})`);
    assert.equal(p.port, 8080, `port must be the real port, not NaN (${raw})`);
    assert.equal(p.username, 'user');
    assert.equal(p.password, 'pass');
  }
});

test('userinfo form keeps the scheme classification', () => {
  assert.equal(parseProxyInput('socks5://user:pass@1.2.3.4:1080').type, 'SOCKS5');
  assert.equal(parseProxyInput('socks4://user:pass@1.2.3.4:1080').type, 'SOCKS4');
  assert.equal(parseProxyInput('http://user:pass@1.2.3.4:8080').type, 'HTTP');
});

test('a password containing @ splits at the LAST @, not the first', () => {
  const p = parseProxyInput('http://user:p@ss@1.2.3.4:8080');
  assert.equal(p.host, '1.2.3.4', 'a host never contains @, so the last one is the delimiter');
  assert.equal(p.password, 'p@ss');
});

test('a password containing : keeps everything after the first colon', () => {
  const p = parseProxyInput('http://user:pa:ss@1.2.3.4:8080');
  assert.equal(p.username, 'user');
  assert.equal(p.password, 'pa:ss');
});

test('percent-encoded userinfo is decoded, a bare % is left alone', () => {
  const enc = parseProxyInput('http://us%40er:p%3Ass@1.2.3.4:8080');
  assert.equal(enc.username, 'us@er');
  assert.equal(enc.password, 'p:ss');

  const bare = parseProxyInput('http://user:100%pass@1.2.3.4:8080');
  assert.equal(bare.password, '100%pass', 'a literal % is not an escape and must survive');
});

test('a username with no password is accepted', () => {
  const p = parseProxyInput('http://user@1.2.3.4:8080');
  assert.equal(p.username, 'user');
  assert.equal(p.password, null);
});

// --- 2) invalid input fails loudly instead of creating a broken row --------

test('a missing or out-of-range port throws instead of yielding NaN', () => {
  assert.throws(() => parseProxyInput('user:pass@1.2.3.4'), /Invalid proxy connection string/);
  assert.throws(() => parseProxyInput('user:pass@1.2.3.4:99999'), /Invalid proxy connection string/);
  assert.throws(() => parseProxyInput('user:pass@1.2.3.4:0'), /Invalid proxy connection string/);
});

// --- 3) bracketed IPv6, with and without userinfo -------------------------

test('a bracketed IPv6 literal is not shredded by the colon split', () => {
  const bare = parseProxyInput('[2001:db8::1]:8080');
  assert.equal(bare.host, '2001:db8::1');
  assert.equal(bare.port, 8080);

  const withCreds = parseProxyInput('[2001:db8::1]:8080:user:pass');
  assert.equal(withCreds.host, '2001:db8::1');
  assert.equal(withCreds.port, 8080);
  assert.equal(withCreds.username, 'user');
  assert.equal(withCreds.password, 'pass');

  const viaUserinfo = parseProxyInput('user:pass@[2001:db8::1]:1080');
  assert.equal(viaUserinfo.host, '2001:db8::1');
  assert.equal(viaUserinfo.port, 1080);
});

test('a malformed bracket throws', () => {
  assert.throws(() => parseProxyInput('[bad'), /Invalid proxy connection string/);
  assert.throws(() => parseProxyInput('[2001:db8::1]'), /Invalid proxy connection string/);
});

// --- 4) an IPv6 host is re-bracketed everywhere a URL is rebuilt -----------

test('formatProxyHost brackets IPv6 and leaves everything else alone', () => {
  assert.equal(formatProxyHost('2001:db8::1'), '[2001:db8::1]');
  assert.equal(formatProxyHost('[2001:db8::1]'), '[2001:db8::1]', 'must not double-bracket');
  assert.equal(formatProxyHost('1.2.3.4'), '1.2.3.4');
  assert.equal(formatProxyHost('proxy.apify.com'), 'proxy.apify.com');
});

test('buildProxyServerArgument emits a valid authority for an IPv6 proxy', () => {
  assert.equal(buildProxyServerArgument({ type: 'SOCKS5', host: '2001:db8::1', port: 1080 }),
    'socks5://[2001:db8::1]:1080',
    'an unbracketed IPv6 host makes Chromium read the address as host:port garbage');
  assert.equal(buildProxyServerArgument({ type: 'HTTP', host: '1.2.3.4', port: 8080 }),
    'http://1.2.3.4:8080', 'IPv4 must be untouched');
});

// --- 5) the formats that already worked must keep working -----------------

test('legacy colon formats are unchanged', () => {
  const four = parseProxyInput('1.2.3.4:8080:user:pass');
  assert.deepEqual([four.host, four.port, four.username, four.password], ['1.2.3.4', 8080, 'user', 'pass']);

  const three = parseProxyInput('1.2.3.4:8080:user');
  assert.deepEqual([three.host, three.port, three.username, three.password], ['1.2.3.4', 8080, 'user', null]);

  const two = parseProxyInput('1.2.3.4:8080');
  assert.deepEqual([two.host, two.port, two.username, two.password], ['1.2.3.4', 8080, null, null]);

  assert.equal(parseProxyInput('socks4://1.2.3.4:1080').type, 'SOCKS4');
  assert.equal(parseProxyInput('socks://1.2.3.4:1080').type, 'SOCKS5');
});

test('object form is unchanged', () => {
  const p = parseProxyInput({ type: 'socks5', host: '1.2.3.4', port: '1080', username: 'u', password: 'p' });
  assert.deepEqual([p.type, p.host, p.port, p.username, p.password], ['SOCKS5', '1.2.3.4', 1080, 'u', 'p']);
});
