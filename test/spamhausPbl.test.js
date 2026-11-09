'use strict';
// Spamhaus PBL is not a spam listing (9 Nov 2026).
//
// The proxy health check counted any Spamhaus ZEN answer as "listed", took 12 points off the
// score and showed the proxy as Blacklisted. ZEN answers 127.0.0.10 and .11 for the Policy Block
// List: dynamic, residential and mobile ranges that should not send mail straight to a mail
// server. Nearly every residential proxy is on it, so good residential proxies looked bad.
//
// Now: PBL alone costs no points, is not "listed", and is shown as a residential range.
// SBL (.2), CSS (.3), XBL (.4 to .7) and DROP (.9) still count. With several codes the worst
// wins. 127.255.255.x (resolver errors) still count as not listed. SpamCop and Barracuda are
// unchanged: any 127.0.0.x there is a listing.
//
// The DNS module is a stub; nothing here opens a socket.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const json = (...p) => JSON.parse(read(...p));

const dnsbl = require('../src/main/dnsbl');
const IPC = read('src', 'main', 'ipcHandlers.js');

const ZEN = 'zen.spamhaus.org';
const SPAMCOP = 'bl.spamcop.net';
const BARRACUDA = 'b.barracudacentral.org';

// Source of `function name(...) { ... }` (async or not), by brace matching from the body's
// opening brace (parameters may be destructured: `({ a, b }) {`).
function extractFunction(source, name) {
  const m = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(m, `could not find function ${name} in source`);
  let i = source.indexOf(') {', m.index) + 2;
  let depth = 0;
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(m.index, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}
function extractArrayConst(source, name) {
  const start = source.indexOf(`const ${name} = [`);
  assert.ok(start >= 0, `could not find const ${name} in source`);
  const end = source.indexOf('\n];', start);
  return source.slice(start, end + 3);
}

// The real checkBlacklist and computeProxyHealthScore from ipcHandlers.js, with a fake resolver:
// answers maps a zone to its A records, or to an Error to throw.
function loadCheck(answers) {
  const fakeDns = {
    promises: {
      async resolve4(name) {
        const zone = [ZEN, SPAMCOP, BARRACUDA].find((z) => name.endsWith(`.${z}`));
        const a = answers[zone];
        if (a instanceof Error) throw a;
        if (!a) { const e = new Error(`queryA ENOTFOUND ${name}`); e.code = 'ENOTFOUND'; throw e; }
        return a;
      }
    }
  };
  const ctx = {
    module: {},
    require: (id) => (id === 'node:dns' ? fakeDns : require(id)),
    dnsbl,
    setTimeout, clearTimeout, Promise
  };
  vm.createContext(ctx);
  vm.runInContext([
    extractArrayConst(IPC, 'DNSBL_ZONES'),
    extractFunction(IPC, 'expandIpv6'),
    extractFunction(IPC, 'withTimeout'),
    extractFunction(IPC, 'checkBlacklist'),
    extractFunction(IPC, 'computeProxyHealthScore'),
    'module.exports = { checkBlacklist, computeProxyHealthScore };'
  ].join('\n'), ctx);
  return ctx.module.exports;
}

// Plain copy out of the vm realm, so deepEqual compares values only.
const plain = (v) => JSON.parse(JSON.stringify(v));

// What deepCheckProxy does with the result: every site reached, 300 ms average.
async function scoreFor(answers, ip = '203.0.113.7') {
  const { checkBlacklist, computeProxyHealthScore } = loadCheck(answers);
  const bl = plain(await checkBlacklist(ip));
  const health = plain(computeProxyHealthScore({ okCount: 3, total: 3, avgMs: 300, listedCount: bl.sources.length }));
  return { bl, health };
}

// ---- each Spamhaus ZEN code ------------------------------------------------------------------

test('each Spamhaus ZEN code is read as the list it stands for', () => {
  const cases = [
    ['127.0.0.2', 'listed', ['SBL']],
    ['127.0.0.3', 'listed', ['CSS']],
    ['127.0.0.4', 'listed', ['XBL']],
    ['127.0.0.5', 'listed', ['XBL']],
    ['127.0.0.6', 'listed', ['XBL']],
    ['127.0.0.7', 'listed', ['XBL']],
    ['127.0.0.9', 'listed', ['DROP']],
    ['127.0.0.10', 'policy', ['PBL']],
    ['127.0.0.11', 'policy', ['PBL']]
  ];
  for (const [addr, outcome, lists] of cases) {
    assert.deepEqual(dnsbl.classifyAnswer(ZEN, [addr]), { outcome, lists }, addr);
  }
});

test('a Spamhaus code the table does not know still counts as listed, as before', () => {
  assert.deepEqual(dnsbl.classifyAnswer(ZEN, ['127.0.0.8']), { outcome: 'listed', lists: ['OTHER'] });
  assert.deepEqual(dnsbl.classifyAnswer(ZEN, ['127.0.0.10', '127.0.0.12']), { outcome: 'listed', lists: ['PBL', 'OTHER'] });
});

test('Spamhaus resolver errors (127.255.255.x) and empty answers are not listings', () => {
  for (const addr of ['127.255.255.252', '127.255.255.254', '127.255.255.255']) {
    assert.deepEqual(dnsbl.classifyAnswer(ZEN, [addr]), { outcome: 'clean', lists: [] }, addr);
  }
  assert.deepEqual(dnsbl.classifyAnswer(ZEN, []), { outcome: 'clean', lists: [] });
  assert.deepEqual(dnsbl.classifyAnswer(ZEN, undefined), { outcome: 'clean', lists: [] });
  assert.deepEqual(dnsbl.classifyAnswer(ZEN, ['10.0.0.1']), { outcome: 'clean', lists: [] }, 'not a 127.0.0.x answer');
});

test('several Spamhaus codes: the worst one wins', () => {
  assert.deepEqual(dnsbl.classifyAnswer(ZEN, ['127.0.0.10', '127.0.0.4']), { outcome: 'listed', lists: ['PBL', 'XBL'] });
  assert.deepEqual(dnsbl.classifyAnswer(ZEN, ['127.0.0.11', '127.0.0.2']), { outcome: 'listed', lists: ['PBL', 'SBL'] });
  assert.deepEqual(dnsbl.classifyAnswer(ZEN, ['127.0.0.9', '127.0.0.10']), { outcome: 'listed', lists: ['DROP', 'PBL'] });
  assert.deepEqual(dnsbl.classifyAnswer(ZEN, ['127.0.0.10', '127.0.0.11']), { outcome: 'policy', lists: ['PBL'] }, 'both PBL codes are still PBL only');
  assert.deepEqual(dnsbl.classifyAnswer(ZEN, ['127.0.0.10', '127.255.255.254']), { outcome: 'policy', lists: ['PBL'] }, 'an error code next to PBL changes nothing');
});

test('SpamCop and Barracuda are unchanged: any 127.0.0.x is a listing, 127.255.255.x is not', () => {
  for (const zone of [SPAMCOP, BARRACUDA]) {
    assert.deepEqual(dnsbl.classifyAnswer(zone, ['127.0.0.2']), { outcome: 'listed', lists: [] }, zone);
    assert.deepEqual(dnsbl.classifyAnswer(zone, ['127.0.0.10']), { outcome: 'listed', lists: [] }, `${zone} has no PBL`);
    assert.deepEqual(dnsbl.classifyAnswer(zone, ['127.255.255.254']), { outcome: 'clean', lists: [] }, zone);
  }
});

// ---- the check result, score and grade ---------------------------------------------------------

test('PBL only: not listed, shown as a residential range, and the score and grade do not drop', async () => {
  const clean = await scoreFor({});
  for (const code of ['127.0.0.10', '127.0.0.11']) {
    const pbl = await scoreFor({ [ZEN]: [code] });
    assert.equal(pbl.bl.checked, true);
    assert.equal(pbl.bl.listed, false, code);
    assert.deepEqual(pbl.bl.sources, [], code);
    assert.equal(pbl.bl.residential, true, code);
    assert.deepEqual(pbl.health, clean.health, `${code} costs no points`);
  }
  assert.equal(clean.health.grade, 'A');
  assert.equal(clean.bl.residential, false);
});

test('SBL, CSS, XBL and DROP still lower the score and grade', async () => {
  const clean = await scoreFor({});
  for (const [code, list] of [['127.0.0.2', 'SBL'], ['127.0.0.3', 'CSS'], ['127.0.0.4', 'XBL'], ['127.0.0.7', 'XBL'], ['127.0.0.9', 'DROP']]) {
    const r = await scoreFor({ [ZEN]: [code] });
    assert.equal(r.bl.listed, true, code);
    assert.deepEqual(r.bl.sources, ['Spamhaus'], code);
    assert.deepEqual(r.bl.details, { Spamhaus: [list] }, code);
    assert.equal(r.health.score, clean.health.score - 12, `${code} costs 12 points`);
    assert.notEqual(r.health.grade, clean.health.grade, `${code} lowers the grade`);
  }
});

test('PBL plus XBL counts as listed (the worst code wins), with the XBL as the reason', async () => {
  const r = await scoreFor({ [ZEN]: ['127.0.0.10', '127.0.0.4'] });
  assert.equal(r.bl.listed, true);
  assert.deepEqual(r.bl.sources, ['Spamhaus']);
  assert.deepEqual(r.bl.details, { Spamhaus: ['XBL'] }, 'PBL is not given as a reason');
  assert.equal(r.health.score, 88);
});

test('PBL on Spamhaus with a real SpamCop listing: SpamCop counts, Spamhaus does not', async () => {
  const r = await scoreFor({ [ZEN]: ['127.0.0.11'], [SPAMCOP]: ['127.0.0.2'] });
  assert.equal(r.bl.listed, true);
  assert.deepEqual(r.bl.sources, ['SpamCop']);
  assert.equal(r.bl.residential, true);
  assert.equal(r.health.score, 88, 'one listing, 12 points');
});

test('resolver errors, timeouts and failures still count as not listed', async () => {
  const sentinel = await scoreFor({ [ZEN]: ['127.255.255.254'], [SPAMCOP]: ['127.255.255.255'] });
  assert.equal(sentinel.bl.listed, false);
  assert.equal(sentinel.bl.residential, false);
  assert.deepEqual(sentinel.bl.sources, []);
  const failing = await scoreFor({ [ZEN]: new Error('ESERVFAIL'), [SPAMCOP]: new Error('ETIMEOUT'), [BARRACUDA]: new Error('ECONNREFUSED') });
  assert.equal(failing.bl.checked, true);
  assert.equal(failing.bl.listed, false);
  assert.equal(failing.health.grade, 'A');
});

test('all three lists listing the IP still cap the blocklist cost at 30 points', async () => {
  const r = await scoreFor({ [ZEN]: ['127.0.0.2'], [SPAMCOP]: ['127.0.0.2'], [BARRACUDA]: ['127.0.0.2'] });
  assert.deepEqual(r.bl.sources, ['Spamhaus', 'SpamCop', 'Barracuda'], 'in list order');
  assert.equal(r.health.score, 70);
});

test('IPv6 exits: Spamhaus PBL is a residential range there too', async () => {
  const r = await scoreFor({ [ZEN]: ['127.0.0.10'] }, '2001:db8::1');
  assert.equal(r.bl.listed, false);
  assert.equal(r.bl.residential, true);
});

// ---- what gets saved, logged and shown ---------------------------------------------------------

test('a PBL-only proxy is saved as not blocklisted, so filters, CAPTCHA score and AI tools agree', async () => {
  const src = extractFunction(IPC, 'persistProxyHealth');
  const updates = [];
  const db = {
    proxyHealthEvent: { findMany: async () => [], create: async () => ({}) },
    proxy: { findUnique: async () => ({ name: 'Res' }), update: async ({ data }) => { updates.push(data); } }
  };
  const ctx = { module: {}, medianMs: (xs) => xs[0], proxyGeoLabel: () => '', Promise, Date, String };
  vm.createContext(ctx);
  vm.runInContext(`${src}\nmodule.exports = persistProxyHealth;`, ctx);
  const { checkBlacklist } = loadCheck({ [ZEN]: ['127.0.0.10'] });
  const blacklist = await checkBlacklist('203.0.113.7');
  await ctx.module.exports(db, 1, { success: true, latencyMs: 300, blacklist });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].lastBlacklisted, false);
  // The AI tools and the CAPTCHA score read that saved verdict, not the raw DNS answer.
  assert.match(read('src', 'main', 'ai', 'tools.js'), /blocklisted: typeof p\.lastBlacklisted === 'boolean' \? p\.lastBlacklisted : null/);
  assert.match(read('src', 'main', 'captchaScore.js'), /proxy\.lastBlacklisted === true\) add\('blocklist', 'fail'/);
});

test('the check log says residential range for PBL, names the list for a real listing', () => {
  assert.equal(dnsbl.logSuffix({ checked: true, listed: false, sources: [], residential: true, details: {} }),
    'Residential range (Spamhaus PBL), not a spam listing');
  assert.equal(dnsbl.logSuffix({ checked: true, listed: false, sources: [], residential: false, details: {} }), 'clean');
  assert.equal(dnsbl.logSuffix({ checked: false, listed: false, sources: [] }), '');
  assert.equal(dnsbl.logSuffix(undefined), '');
  assert.equal(
    dnsbl.logSuffix({ checked: true, listed: true, sources: ['Spamhaus', 'SpamCop'], residential: true, details: { Spamhaus: ['XBL'] } }),
    '⚠ blacklisted (Spamhaus XBL: an infected or exploited computer, SpamCop)'
  );
  assert.equal(
    dnsbl.logSuffix({ checked: true, listed: true, sources: ['Spamhaus'], details: { Spamhaus: ['OTHER'] } }),
    '⚠ blacklisted (Spamhaus)', 'an unknown code just names the list'
  );
  // The stream uses it for every result line.
  assert.match(IPC, /const blText = dnsbl\.logSuffix\(result\.blacklist\)/);
  assert.doesNotMatch(IPC, /result\.blacklist\.sources\.join\(', '\)/, 'the old "any answer is listed" log text is gone');
});

test('the Proxy Pool badge shows a residential range as clean, with the plain reason', async () => {
  const { blacklistOf, residentialOf, countBuckets } = await import('../src/renderer/lib/proxyBuckets.mjs');
  const ok = (id, extra = {}) => ({ id, lastStatus: 'ok', lastLatencyMs: 500, ...extra });
  const pbl = { success: true, latencyMs: 500, blacklist: { checked: true, listed: false, sources: [], residential: true } };
  const worst = { success: true, latencyMs: 500, blacklist: { checked: true, listed: true, sources: ['Spamhaus'], residential: true } };
  const results = { 1: pbl, 2: worst };
  assert.equal(blacklistOf(ok(1), results), 'clean');
  assert.equal(residentialOf(ok(1), results), true);
  assert.equal(blacklistOf(ok(2), results), 'blacklisted', 'PBL plus a real listing is blacklisted');
  assert.equal(residentialOf(ok(2), results), false, 'the worst result is shown');
  assert.equal(residentialOf(ok(3, { lastBlacklisted: false })), false, 'a saved snapshot has no PBL detail');
  assert.equal(residentialOf({ id: 4, lastStatus: 'fail' }, { 4: { success: false } }), false);
  const counts = countBuckets([ok(1), ok(2)], results);
  assert.equal(counts.clean, 1);
  assert.equal(counts.blacklisted, 1);

  const page = read('src', 'renderer', 'pages', 'ProxyPoolPage.jsx');
  assert.match(page, /const residential = !listed && residentialOf\(proxy, checkResults\)/);
  assert.match(page, /t\('checker\.residential'\)/);
  assert.match(page, /t\('checker\.residentialTip'\)/);
  for (const lng of ['en', 'es']) {
    const checker = json('src', 'renderer', 'i18n', 'locales', lng, 'proxies.json').checker;
    assert.equal(typeof checker.residential, 'string', `${lng} checker.residential`);
    assert.match(checker.residentialTip, /Spamhaus PBL/, `${lng} checker.residentialTip names the list`);
  }
  assert.match(json('src', 'renderer', 'i18n', 'locales', 'en', 'proxies.json').checker.residentialTip, /not a spam listing/);
});
