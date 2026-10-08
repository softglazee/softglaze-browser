'use strict';
// 7 Oct 2026 audit fixes: S2 (2FA keys masked), S3 (export secrets gated), S4 (SMTP
// password theft), S5 (restore reports unreadable sealed secrets), S6 (packaged build
// ignores NODE_ENV), L4 (tenant env overrides ignored when packaged), S8 (SSRF guard
// resolves names and knows CGNAT / IPv4-mapped IPv6), S9 (vendor sync honours the
// proxy quota) and L13 (extension unzip refuses symlinks and escaping paths).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const IPC = read('src', 'main', 'ipcHandlers.js');

function fnBody(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);
  const next = src.indexOf('\nasync function ', start + signature.length);
  const next2 = src.indexOf('\nfunction ', start + signature.length);
  const ends = [next, next2].filter((i) => i > 0);
  return src.slice(start, ends.length ? Math.min(...ends) : undefined);
}

// ---- S2 ----
const { SECRET_MASK, redactPlatformAccounts, restoreMaskedSecrets } = require('../src/main/profileRedaction');

test('S2: a restricted viewer gets platform account 2FA keys masked', () => {
  const accs = [{ platform: 'Other', username: 'u', password: 'p', twoFa: 'JBSWY3DPEHPK3PXP' }, { platform: 'Other', username: 'v', password: '', twoFa: '' }];
  const red = redactPlatformAccounts(accs, false);
  assert.equal(red[0].twoFa, SECRET_MASK);
  assert.equal(red[1].twoFa, '');
  assert.ok(!JSON.stringify(red).includes('JBSWY3DPEHPK3PXP'));
  assert.equal(redactPlatformAccounts(accs, true)[0].twoFa, 'JBSWY3DPEHPK3PXP');
});

test('S2: saving a masked 2FA key back keeps the stored one', () => {
  const existing = { platformAccounts: JSON.stringify([{ platform: 'Other', username: 'u', password: 'p', twoFa: 'SEED' }]) };
  const out = restoreMaskedSecrets({ platformAccounts: [{ platform: 'Other', username: 'u', password: SECRET_MASK, twoFa: SECRET_MASK }] }, existing);
  assert.equal(out.platformAccounts[0].twoFa, 'SEED');
  assert.equal(out.platformAccounts[0].password, 'p');
  const onlyTwoFa = restoreMaskedSecrets({ platformAccounts: [{ platform: 'Other', username: 'u', password: 'new', twoFa: SECRET_MASK }] }, existing);
  assert.equal(onlyTwoFa.platformAccounts[0].twoFa, 'SEED');
  assert.equal(onlyTwoFa.platformAccounts[0].password, 'new');
  const noMatch = restoreMaskedSecrets({ platformAccounts: [{ platform: 'X', username: 'z', password: 'a', twoFa: SECRET_MASK }] }, existing);
  assert.equal(noMatch.platformAccounts[0].twoFa, '', 'a mask with no stored match never survives as a literal');
});

// ---- S3 ----
test('S3: profile export blanks secret columns unless the member may reveal them', () => {
  const body = fnBody(IPC, 'async function gatherExport()');
  assert.match(body, /currentMemberCanRevealProxy/);
  assert.match(body, /assertCanRevealKind\('twoFactorCode'\)/);
  for (const col of ['Proxy Password', 'Account Password', '2FA Key', 'Proxy Info']) assert.ok(body.includes(`'${col}'`), col);
});

// ---- S4 ----
test('S4: SMTP config is Owner-only and a new target drops the kept password', () => {
  const body = fnBody(IPC, 'async function setEmailConfig(payload)');
  assert.match(body, /await requireOwnerOrSuper\(/);
  assert.doesNotMatch(body, /requirePermission\('members\.manage'\)/);
  assert.match(body, /if \(!newPass && targetChanged\) next\.pass = ''/);
  for (const f of ['next.host', 'next.port', 'next.user']) assert.ok(body.includes(f), f);
});

// ---- S5 ----
test('S5: restore reports sealed secrets that no longer open, and the UI says so', () => {
  const restore = fnBody(IPC, 'async function workspaceRestore(payload)');
  assert.match(restore, /unreadableSecrets/);
  const finder = fnBody(IPC, 'async function findUnreadableSealedSecrets()');
  assert.match(finder, /secretStore\.isSealed\(v\) && secretStore\.open\(v\) === ''/);
  assert.match(finder, /twoFactorSeed/);
  const ui = read('src', 'renderer', 'components', 'WorkspaceBackupSettings.jsx');
  assert.match(ui, /r\.unreadableSecrets/);
  assert.match(ui, /workspaceBackup\.warnSecretsLost/);
  for (const lang of ['en', 'es']) {
    const j = JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, 'cmpSettingsB.json')).workspaceBackup;
    assert.ok(j.warnSecretsLost_one && j.warnSecretsLost_other, `${lang} warning keys`);
    assert.match(j.footerNote, /Windows/, `${lang} footer is honest about keychain-sealed secrets`);
  }
});

// ---- S6 ----
test('S6: a packaged build never takes the dev path', () => {
  const main = read('src', 'main', 'main.js');
  assert.match(main, /const isDev = !app\.isPackaged && process\.env\.NODE_ENV === 'development';/);
});

// ---- L4 ----
test('L4: tenant env overrides apply unpackaged and are ignored when packaged', () => {
  const tcPath = require.resolve('../src/main/tenantConfig');
  const elPath = require.resolve('electron');
  const saved = { ...process.env };
  process.env.SG_TENANT_ID = 'evil-tenant';
  process.env.SG_API_BASE_URL = 'https://evil.example';
  process.env.SG_TENANT_PUBLIC_KEY = 'EVILKEY';
  try {
    delete require.cache[tcPath];
    let tc = require('../src/main/tenantConfig');
    assert.equal(tc.tenantConfig().tenantId, 'evil-tenant', 'dev runs keep the override');

    const prev = require.cache[elPath];
    require.cache[elPath] = { id: elPath, filename: elPath, loaded: true, exports: { app: { isPackaged: true } } };
    try {
      delete require.cache[tcPath];
      tc = require('../src/main/tenantConfig');
      const cfg = tc.tenantConfig();
      assert.notEqual(cfg.tenantId, 'evil-tenant');
      assert.notEqual(cfg.apiBaseUrl, 'https://evil.example');
      assert.notEqual(cfg.publicKeyPem, 'EVILKEY');
    } finally {
      if (prev) require.cache[elPath] = prev; else delete require.cache[elPath];
      delete require.cache[tcPath];
    }
  } finally {
    for (const k of ['SG_TENANT_ID', 'SG_API_BASE_URL', 'SG_TENANT_PUBLIC_KEY']) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
});

// ---- S8 ----
function loadSsrfGuard(lookupResult) {
  const start = IPC.indexOf('// Reject internal / loopback / link-local targets');
  const end = IPC.indexOf('function buildProxyInfoString(proxy)');
  assert.ok(start >= 0 && end > start);
  const fakeDns = {
    promises: { lookup: async () => lookupResult },
    lookup: (host, opts, cb) => cb(null, lookupResult)
  };
  const ctx = {
    URL,
    require: (m) => (m === 'node:dns' ? fakeDns : require(m)),
    module: { exports: {} }
  };
  vm.runInNewContext(`${IPC.slice(start, end)}\nmodule.exports = { isInternalIp, assertPublicHttpUrl, assertPublicHttpUrlSync, publicOnlyLookup };`, ctx);
  return ctx.module.exports;
}

test('S8: internal address classes are recognised', () => {
  const { isInternalIp } = loadSsrfGuard([]);
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '100.127.255.255', '0.0.0.0',
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::a00:1']) {
    assert.equal(isInternalIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '100.63.0.1', '100.128.0.1', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isInternalIp(ip), false, ip);
  }
});

test('S8: literals, mapped IPv6 and names resolving inward are refused', async () => {
  const pub = loadSsrfGuard([{ address: '93.184.216.34', family: 4 }]);
  await pub.assertPublicHttpUrl('https://rotate.example.com/x');
  await pub.assertPublicHttpUrl('https://fcbarcelona.com/', 'link'); // a public name starting with "fc"
  for (const u of ['http://localhost/', 'http://[::ffff:127.0.0.1]/', 'http://100.64.1.1/', 'http://0x7f.1/', 'http://metadata.google.internal/']) {
    await assert.rejects(pub.assertPublicHttpUrl(u), /internal or loopback/, u);
  }
  const inward = loadSsrfGuard([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }]);
  await assert.rejects(inward.assertPublicHttpUrl('https://rebind.example.com/'), /internal or loopback/);
  await new Promise((resolve) => inward.publicOnlyLookup('rebind.example.com', {}, (err) => { assert.equal(err && err.code, 'ESSRF'); resolve(); }));
});

test('S8: rotateProxyIp awaits the guard and checks resolved addresses at connect time', () => {
  const body = fnBody(IPC, 'async function rotateProxyIp(payload)');
  assert.match(body, /await assertPublicHttpUrl\(rotationUrl/);
  assert.match(body, /lookup: publicOnlyLookup/);
  assert.match(body, /assertPublicHttpUrlSync\(/);
});

// ---- S9 ----
test('S9: vendor sync checks the proxy quota up front and per created row', () => {
  const body = fnBody(IPC, 'async function syncVendorPool(payload)');
  const checks = body.match(/await assertWithinLimit\('proxies'\)/g) || [];
  assert.ok(checks.length >= 2, 'one up-front check and one per row');
  assert.ok(body.indexOf("await assertWithinLimit('proxies')") < body.indexOf('await adapter('), 'no vendor call when already at the limit');
  assert.match(body, /result\.limitReached = true/);
});

// ---- L13 ----
const { assertSafeZipEntry, assertNoLinksUnder } = require('../src/main/extensionManager');

test('L13: zip entries that are symlinks or escape the folder are refused', () => {
  const dest = path.join(os.tmpdir(), 'sg-ext-dest');
  const S_IFLNK = 0o120777;
  const S_IFREG = 0o100644;
  assert.doesNotThrow(() => assertSafeZipEntry({ fileName: 'manifest.json', externalFileAttributes: S_IFREG << 16 }, dest));
  assert.doesNotThrow(() => assertSafeZipEntry({ fileName: 'js/app.js', externalFileAttributes: 0 }, dest));
  assert.throws(() => assertSafeZipEntry({ fileName: 'evil', externalFileAttributes: S_IFLNK << 16 }, dest), /symlink/);
  assert.throws(() => assertSafeZipEntry({ fileName: '../outside.js', externalFileAttributes: 0 }, dest), /escapes/);
  assert.throws(() => assertSafeZipEntry({ fileName: 'a/../../outside.js', externalFileAttributes: 0 }, dest), /escapes/);
  assert.throws(() => assertSafeZipEntry({ fileName: path.resolve(os.tmpdir(), 'abs.js'), externalFileAttributes: 0 }, dest), /escapes/);
});

test('L13: a link left inside the extracted folder fails the install', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-ext-'));
  try {
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'ok.js'), '1');
    await assertNoLinksUnder(dir);
    fs.symlinkSync(os.tmpdir(), path.join(dir, 'sub', 'link'), 'junction');
    await assert.rejects(assertNoLinksUnder(dir), /linked path/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('L13: the extractor wires both checks', () => {
  const src = read('src', 'main', 'extensionManager.js');
  assert.match(src, /onEntry: \(entry\) => assertSafeZipEntry\(entry, destDir\)/);
  assert.match(src, /await assertNoLinksUnder\(destDir\);/);
});
