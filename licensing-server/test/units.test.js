'use strict';
// Pure helpers: email normalisation and keys, the disposable list, the MX check, client IP behind
// proxies (with a live TRUST_PROXY_HOPS change), CSV, and email rendering.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const CONFIG = path.join(os.tmpdir(), `sg-units-${process.pid}.env`);
fs.writeFileSync(CONFIG, 'TRUST_PROXY_HOPS=1\n');
process.env.CONFIG_ENV_FILE = CONFIG;
process.env.MASTER_KEY = crypto.randomBytes(32).toString('base64');
process.env.DATABASE_URL = 'mysql://test@127.0.0.1/test';
delete process.env.TRUST_PROXY_HOPS;
delete process.env.EMAIL_DOMAIN_ALLOWLIST;

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEmail, emailKeyOf, parseEmail } = require('../src/customers/emailAddress');
const { isDisposableDomain, listInfo } = require('../src/customers/disposable');
const mx = require('../src/customers/mx');
const ipmod = require('../src/net/clientIp');
const { parseCsv, stringifyCsv, importCell } = require('../src/util/csv');
const { renderEmail, varsFor, unknownPlaceholders, unsafeHtml } = require('../src/email/render');
const { tokenFor, verifyToken } = require('../src/email/unsubscribe');
const { liveEnv } = require('../src/env');

test.after(() => { try { fs.unlinkSync(CONFIG); } catch (_) { /* gone */ } });

test('email normalisation: lowercase, trimmed, strict syntax, IDN domains to punycode', () => {
  assert.equal(normalizeEmail('  Ana.Lopez@Example.COM '), 'ana.lopez@example.com');
  assert.equal(normalizeEmail('user@münchen.de'), 'user@xn--mnchen-3ya.de');
  for (const bad of ['', 'a', 'a@', '@b.com', 'a@b', 'a@@b.com', 'a b@c.com', '"q"@c.com', 'a..b@c.com', '.a@c.com', 'a@-c.com', 'a@c.c', 'a@1.2.3.4', `${'x'.repeat(65)}@c.com`, null, 42]) {
    assert.equal(normalizeEmail(bad), null, String(bad));
  }
});

test('emailKey folds Gmail and Googlemail dots and +tags, and nothing else', () => {
  const k = (e) => emailKeyOf(normalizeEmail(e));
  assert.equal(k('John.Smith+promo@Gmail.com'), 'johnsmith@gmail.com');
  assert.equal(k('j.o.h.n.smith@googlemail.com'), 'johnsmith@gmail.com');
  assert.equal(k('johnsmith@gmail.com'), 'johnsmith@gmail.com');
  assert.equal(k('john.smith+x@outlook.com'), 'john.smith+x@outlook.com', 'other providers are kept as typed (spec)');
  assert.equal(parseEmail('+only@gmail.com'), null, 'nothing left before the +tag');
});

test('disposable list: vendored (CC0), parent domains match, allowlist and blocklist apply', () => {
  const info = listInfo();
  assert.ok(info.count > 5000);
  assert.match(info.licence, /CC0/);
  assert.match(info.upstreamCommit, /^[0-9a-f]{40}$/);
  assert.equal(isDisposableDomain('mailinator.com'), true);
  assert.equal(isDisposableDomain('a.b.mailinator.com'), true);
  assert.equal(isDisposableDomain('gmail.com'), false);
  assert.equal(isDisposableDomain('example.com'), false);
  assert.equal(isDisposableDomain('mailinator.com', { allow: ['mailinator.com'] }), false);
  assert.equal(isDisposableDomain('spammy.example', { block: ['spammy.example'] }), true);
  process.env.EMAIL_DOMAIN_ALLOWLIST = 'mailinator.com';
  assert.equal(isDisposableDomain('mailinator.com'), false, 'EMAIL_DOMAIN_ALLOWLIST overrides too');
  delete process.env.EMAIL_DOMAIN_ALLOWLIST;
});

test('MX check: MX, implicit A, null MX, no domain, and DNS failure fails open; results are cached', async () => {
  let calls = 0;
  const err = (code) => Object.assign(new Error(code), { code });
  mx.setResolverFactoryForTests(() => ({
    async resolveMx(d) {
      calls += 1;
      if (d === 'ok.example') return [{ exchange: 'mx.ok.example', priority: 5 }];
      if (d === 'nullmx.example') return [{ exchange: '', priority: 0 }];
      if (d === 'nx.example') throw err('ENOTFOUND');
      if (d === 'slow.example') return new Promise(() => {});
      throw err('ENODATA');
    },
    async resolve4(d) { if (d === 'aonly.example') return ['1.2.3.4']; throw err('ENODATA'); },
    async resolve6() { throw err('ENODATA'); }
  }));
  assert.deepEqual(await mx.checkMailDomain('ok.example'), { ok: true });
  assert.equal((await mx.checkMailDomain('ok.example')).cached, true);
  assert.equal(calls, 1);
  assert.deepEqual(await mx.checkMailDomain('aonly.example'), { ok: true });
  assert.equal((await mx.checkMailDomain('nullmx.example')).ok, false);
  assert.equal((await mx.checkMailDomain('nx.example')).reason, 'nxdomain');
  assert.equal((await mx.checkMailDomain('nothing.example')).reason, 'no_mx');
  const t0 = Date.now();
  const slow = await mx.checkMailDomain('slow.example', { timeoutMs: 100 });
  assert.deepEqual(slow, { ok: true, unknown: true });
  assert.ok(Date.now() - t0 < 2000, 'the timeout is short');
});

const req = (remote, xff) => ({ socket: { remoteAddress: remote }, headers: xff ? { 'x-forwarded-for': xff } : {} });

test('client IP: the rightmost proxy-added address, never a client-written one', () => {
  assert.equal(ipmod.clientIp(req('127.0.0.1', '6.6.6.6')), '6.6.6.6');
  assert.equal(ipmod.clientIp(req('127.0.0.1', '1.2.3.4, 6.6.6.6')), '6.6.6.6', 'a forged leftmost entry is ignored');
  assert.equal(ipmod.clientIp(req('::ffff:6.6.6.6')), '6.6.6.6', 'no proxy header: the socket address');
  assert.equal(ipmod.clientIp(req(undefined, '6.6.6.6')), '6.6.6.6', 'unix-socket proxies have no remote address');
  assert.equal(ipmod.clientIp(req('127.0.0.1', 'garbage')), '');
});

test('client IP: TRUST_PROXY_HOPS is re-read from config/.env without a restart', () => {
  const r = req('127.0.0.1', '9.9.9.9, 6.6.6.6, 20.0.0.1');
  assert.equal(ipmod.clientIp(r), '20.0.0.1');
  fs.writeFileSync(CONFIG, 'TRUST_PROXY_HOPS=2\n');
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(CONFIG, later, later);
  assert.equal(liveEnv('TRUST_PROXY_HOPS'), '2');
  assert.equal(ipmod.clientIp(r), '6.6.6.6', 'two proxies (edge + origin): one step further left');
  fs.writeFileSync(CONFIG, 'TRUST_PROXY_HOPS=1\n');
  const later2 = new Date(Date.now() + 10000);
  fs.utimesSync(CONFIG, later2, later2);
  assert.equal(ipmod.clientIp(r), '20.0.0.1');
});

test('IP hashes: HMAC only, IPv6 per /64, private ranges are not public', () => {
  const h = ipmod.ipHash('6.6.6.6');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h, crypto.createHash('sha256').update('6.6.6.6').digest('hex'), 'not a plain hash anyone could rebuild');
  assert.equal(ipmod.ipHash('2a00:1450:4001:81a::200e'), ipmod.ipHash('2a00:1450:4001:81a:ffff::1'));
  assert.notEqual(ipmod.ipHash('2a00:1450:4001:81a::1'), ipmod.ipHash('2a00:1450:4001:81b::1'));
  assert.equal(ipmod.ipHash('::ffff:6.6.6.6'), h);
  for (const p of ['10.0.0.1', '172.16.5.4', '192.168.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1', '::1', 'fe80::1', 'fd12::1']) assert.equal(ipmod.isPublicIp(p), false, p);
  for (const p of ['6.6.6.6', '8.8.8.8', '2a00:1450::1']) assert.equal(ipmod.isPublicIp(p), true, p);
});

test('CSV: quotes, commas, newlines, BOM, CRLF, and formula cells are neutralised and restored', () => {
  const rows = [['a', 'b,c', 'd "q"', 'line1\nline2', '=SUM(A1)', '+92 300', '-5', '@x', '']];
  const text = stringifyCsv(rows);
  assert.ok(text.includes(`"'=SUM(A1)"`) || text.includes(`'=SUM(A1)`));
  const back = parseCsv('﻿' + text);
  assert.equal(back.length, 1);
  assert.deepEqual(back[0].map(importCell), rows[0]);
  assert.deepEqual(parseCsv('x,y\r\n1,2\r\n'), [['x', 'y'], ['1', '2']]);
});

test('email rendering escapes values, refuses unknown placeholders and unsafe HTML', () => {
  const vars = varsFor({ customer: { name: '<b>Eve</b> Smith', email: 'eve@example.com', lang: 'en' }, settings: { email: { appName: 'SoftGlaze Browser', companyName: 'SoftGlaze' } }, unsubscribeUrl: 'https://api.test/u?t=x' });
  const out = renderEmail({ subject: 'Hi {{name}}\r\nBcc: x@y.z', html: '<p>{{greeting}}</p>', text: '{{greeting}}', category: 'lifecycle', lang: 'en' }, vars);
  assert.ok(!out.subject.includes('\n'), 'no header injection through the subject');
  assert.ok(out.html.includes('Hi &lt;b&gt;Eve&lt;/b&gt;,'));
  assert.ok(out.html.includes('https://api.test/u?t=x'), 'lifecycle mail carries the unsubscribe link');
  const essential = renderEmail({ subject: 's', html: '<p>x</p>', text: 'x', category: 'essential', lang: 'en' }, vars);
  assert.ok(!essential.html.includes('https://api.test/u?t=x'));
  assert.deepEqual(unknownPlaceholders('{{name}} {{oops}}'), ['oops']);
  assert.equal(unsafeHtml('<p onclick="x()">a</p>'), true);
  assert.equal(unsafeHtml('<a href="javascript:alert(1)">a</a>'), true);
  assert.equal(unsafeHtml('<script>x</script>'), true);
  assert.equal(unsafeHtml('<p><a href="https://x.y">ok</a></p>'), false);
  const es = varsFor({ customer: { lang: 'es' }, settings: { email: {} } });
  assert.equal(es.greeting, 'Hola:');
});

test('the rate limiter keys on the real client IP, not on the proxy', () => {
  const { rateLimit } = require('../src/middleware/rateLimit');
  const limit = rateLimit({ windowMs: 60000, max: 2 });
  const hit = (xff) => {
    let status = 200;
    const res = { set() {}, status(s) { status = s; return { json() {} }; } };
    limit(req('127.0.0.1', xff), res, () => {});
    return status;
  };
  assert.deepEqual([hit('6.6.6.6'), hit('6.6.6.6'), hit('6.6.6.6')], [200, 200, 429]);
  assert.equal(hit('7.7.7.7'), 200, 'another client behind the same proxy has its own budget');
  assert.equal(hit('1.2.3.4, 6.6.6.6'), 429, 'a forged left entry does not reset the budget');
});

test('unsubscribe tokens are signed and carry no email address', () => {
  const t = tokenFor('cust_12345678');
  assert.equal(verifyToken(t), 'cust_12345678');
  assert.equal(verifyToken(t.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))), null);
  assert.equal(verifyToken('cust_87654321.' + t.split('.')[1]), null);
  assert.ok(!t.includes('@'));
});
