'use strict';
// Regression tests for SOCKS4/SOCKS5/HTTP proxy classification + scheme mapping.
//
// audit finding (LOW): parseProxyString classified any socks*:// as SOCKS5 (so a
// socks4:// proxy was dialed with the SOCKS5 handshake) AND its strip regex did not
// cover `socks4://`, leaving the scheme in the string and mangling host:port. Meanwhile
// buildProxyServerArgument turned a stored SOCKS4 type (which the import path already
// creates in the DB) into `http://` — a total mis-dial. SOCKS4 is now a first-class
// passthrough type: correct wire scheme, no username/password auth (SOCKS4 has none).

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseProxyInput, buildProxyServerArgument } = require('../src/main/browserEngine');

test('parseProxyInput classifies socks4:// as SOCKS4 (not SOCKS5) and keeps host:port', () => {
  const p = parseProxyInput('socks4://1.2.3.4:1080');
  assert.equal(p.type, 'SOCKS4');
  assert.equal(p.host, '1.2.3.4', 'host must not be mangled by an unstripped socks4:// prefix');
  assert.equal(p.port, 1080);
});

test('parseProxyInput classifies socks4a:// as SOCKS4', () => {
  assert.equal(parseProxyInput('socks4a://1.2.3.4:1080').type, 'SOCKS4');
});

test('parseProxyInput classifies socks5:// and bare socks:// as SOCKS5', () => {
  assert.equal(parseProxyInput('socks5://1.2.3.4:1080').type, 'SOCKS5');
  assert.equal(parseProxyInput('socks://1.2.3.4:1080').type, 'SOCKS5');
});

test('parseProxyInput classifies http/https/scheme-less as HTTP', () => {
  assert.equal(parseProxyInput('http://1.2.3.4:8080').type, 'HTTP');
  assert.equal(parseProxyInput('https://1.2.3.4:8080').type, 'HTTP');
  assert.equal(parseProxyInput('1.2.3.4:8080').type, 'HTTP');
});

test('parseProxyInput keeps credentials on a socks4 string', () => {
  const p = parseProxyInput('socks4://user:pass@1.2.3.4:1080');
  // userinfo@host form is handled upstream; the host:port:user:pass form is the parser's
  // job. Here we assert the scheme classification survives the presence of credentials.
  assert.equal(p.type, 'SOCKS4');
});

test('parseProxyInput object form preserves an explicit SOCKS4 type', () => {
  const p = parseProxyInput({ type: 'socks4', host: '1.2.3.4', port: 1080 });
  assert.equal(p.type, 'SOCKS4');
});

test('buildProxyServerArgument emits socks4:// for a SOCKS4 proxy (NOT http://)', () => {
  const arg = buildProxyServerArgument({ type: 'SOCKS4', host: '1.2.3.4', port: 1080 });
  assert.equal(arg, 'socks4://1.2.3.4:1080');
  assert.doesNotMatch(arg, /^http:/, 'a SOCKS4 proxy must never be dialed as http://');
});

test('buildProxyServerArgument emits the right scheme for socks5 and http', () => {
  assert.equal(buildProxyServerArgument({ type: 'SOCKS5', host: 'h', port: 1 }), 'socks5://h:1');
  assert.equal(buildProxyServerArgument({ type: 'HTTP', host: 'h', port: 2 }), 'http://h:2');
  // Unknown/HTTPS types fall back to http:// (Chromium tunnels HTTPS proxies via CONNECT).
  assert.equal(buildProxyServerArgument({ type: 'HTTPS', host: 'h', port: 3 }), 'http://h:3');
});

test('a full socks4 round-trip: parse then build yields socks4://', () => {
  const p = parseProxyInput('socks4://1.2.3.4:1080');
  assert.equal(buildProxyServerArgument(p), 'socks4://1.2.3.4:1080');
});
