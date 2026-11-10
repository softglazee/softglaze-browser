'use strict';
// LumiProxy, Smartproxy.org, kookeey and ShopSocks5 were removed from the supported providers (ShopSocks5
// on 10 Nov 2026, the owner's decision). Do not add them back without a new provider review.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const SOURCES = [
  'src/main/ipcHandlers.js',
  'src/main/proxyVendorUtils.js',
  'src/main/providerAccount.js',
  'src/renderer/components/ProxyProviders.jsx',
  'src/renderer/components/QuickGenerateModal.jsx',
  'src/renderer/pages/ProxyPoolPage.jsx',
  'src/renderer/pages/ProxyProvidersPage.jsx',
  'src/renderer/pages/BatchImportPage.jsx',
  'src/renderer/i18n/locales/en/cmpSettingsC.json',
  'src/renderer/i18n/locales/es/cmpSettingsC.json',
  'src/renderer/i18n/locales/en/providersPage.json',
  'src/renderer/i18n/locales/es/providersPage.json'
];

for (const file of SOURCES) {
  test(`${file} has no removed provider`, () => {
    assert.doesNotMatch(read(file), /lumiproxy|smartproxyorg|smartproxy\.org|smartproxy\.net|kookeey|shopsocks/i);
  });
}

test('the ShopSocks5 logo is gone from the bundled provider logos', () => {
  const logos = fs.readdirSync(path.join(__dirname, '..', 'src', 'renderer', 'assets', 'providers'));
  assert.deepEqual(logos.filter((f) => /shopsocks/i.test(f)), []);
});

// The separate connector is Decodo, formerly Smartproxy; its key stays smartproxy (1.0.27 backlog 65).
test('the separate Decodo (Smartproxy) connector is unaffected', () => {
  assert.match(read('src/main/ipcHandlers.js'), /smartproxy: fetchSmartproxyPool/);
  assert.match(read('src/renderer/components/ProxyProviders.jsx'), /key: 'smartproxy', name: 'Decodo \(Smartproxy\)'/);
});

// ---- Proxies and saved keys left over from a removed provider ----

const IPC = read('src/main/ipcHandlers.js');
const fnSrc = (name) => {
  const m = new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\r?\\n\\}\\r?\\n`).exec(IPC);
  assert.ok(m, `${name} must exist`);
  return m[0];
};
const VENDORS_SRC = /const PROXY_VENDORS = Object\.freeze\(\{[\s\S]*?\n\}\);/.exec(IPC)[0];

test('a removed provider is no longer one main pulls from or tags a Batch Add with', () => {
  // eslint-disable-next-line no-new-func
  const PROXY_VENDORS = new Function(`${VENDORS_SRC}\nreturn PROXY_VENDORS;`)();
  for (const key of ['shopsocks5', 'kookeey', 'lumiproxy']) assert.equal(Object.prototype.hasOwnProperty.call(PROXY_VENDORS, key), false, key);
  // syncVendorPool and Batch Add refuse a key that is not in PROXY_VENDORS.
  assert.match(fnSrc('syncVendorPool'), /if \(!PROXY_VENDORS\[vendorKey\]\) throw new Error\('Unknown proxy provider\.'\);/);
  assert.match(fnSrc('batchAddProxies'), /if \(provider && !Object\.prototype\.hasOwnProperty\.call\(PROXY_VENDORS, provider\)\) throw new Error\('Unknown proxy provider\.'\);/);
});

test('a proxy pulled from a removed provider stays an ordinary proxy with a readable label', async () => {
  const { pulledVendorName, pulledProviderNames, providerTagLabel } = await import('../src/renderer/lib/providerTags.mjs');
  const pool = [
    { id: 1, provider: 'shopsocks5', name: 'ShopSocks5 • US Kirkland, Washington 98033' },
    { id: 2, provider: 'shopsocks5', name: 'renamed by hand' },
    { id: 3, provider: 'novada', name: 'NOVADA • Residential • US • rotating' },
    { id: 4, provider: 'gone', name: 'no separator' },
    { id: 5, provider: null, name: 'Mine • 1' }
  ];
  const names = { novada: 'NOVADA', smartproxy: 'Decodo (Smartproxy)' };
  const pulled = pulledProviderNames(pool);
  assert.equal(providerTagLabel('shopsocks5', names, pulled), 'ShopSocks5', 'the vendor name it was pulled with');
  assert.equal(providerTagLabel('novada', names, pulled), 'NOVADA', 'a live connector keeps its own name');
  assert.equal(providerTagLabel('smartproxy', names, pulled), 'Decodo (Smartproxy)');
  assert.equal(providerTagLabel('gone', names, pulled), 'gone', 'never blank: the tag itself');
  assert.equal(pulledVendorName(' • x'), '');
  assert.equal(pulledVendorName(null), '');
  assert.deepEqual(Object.keys(pulled).sort(), ['novada', 'shopsocks5'], 'an untagged proxy names no provider');
  // The pool page and Quick generate both use it.
  for (const file of ['src/renderer/pages/ProxyPoolPage.jsx', 'src/renderer/components/QuickGenerateModal.jsx']) {
    assert.match(read(file), /providerTagLabel\(/, file);
    assert.match(read(file), /pulledProviderNames\(proxies\)/, file);
  }
  // main: the stored tag stays the row's provider; an untagged old row is an ordinary proxy.
  // eslint-disable-next-line no-new-func
  const deriveProvider = new Function(`${fnSrc('deriveProvider')}\nreturn deriveProvider;`)();
  assert.equal(deriveProvider({ provider: 'shopsocks5', name: 'ShopSocks5 • US' }), 'shopsocks5');
  assert.equal(deriveProvider({ provider: null, name: 'ShopSocks5 • US' }), null);
  // The vendor scoreboard names its row the same way.
  const { buildScoreboard } = require('../src/main/vendorScoreboard');
  const board = buildScoreboard({ proxies: [{ id: 1, provider: 'shopsocks5', name: 'ShopSocks5 • US', lastStatus: 'ok' }], vendors: {} });
  assert.equal(board.rows[0].name, 'ShopSocks5');
});

function credStore(initial) {
  let map = JSON.parse(JSON.stringify(initial));
  const src = [
    VENDORS_SRC,
    /const PROXY_CRED_SECRET_FIELDS = [^\n]*/.exec(IPC)[0],
    /const PROXY_CRED_PLAIN_FIELDS = [^\n]*/.exec(IPC)[0],
    /const PROXY_CRED_KEY_FIELDS = [^\n]*/.exec(IPC)[0],
    ...['hasProxyProviderKey', 'readProxyProviderCredMap', 'readSavedProviderCreds', 'getProxyProviderCreds', 'saveProxyProviderCreds'].map(fnSrc)
  ].join('\n');
  const deps = {
    requireOwnerOrSuper: async () => {},
    requireObject: (v) => v,
    requiredString: (v) => String(v),
    readSetting: async () => JSON.parse(JSON.stringify(map)),
    writeSetting: async (_k, v) => { map = JSON.parse(JSON.stringify(v)); },
    secretStore: { seal: (v) => `sealed:${v}`, open: (v) => String(v).replace(/^sealed:/, '') }
  };
  // eslint-disable-next-line no-new-func
  const fns = new Function(...Object.keys(deps), `${src}\nreturn { readSavedProviderCreds, getProxyProviderCreds, saveProxyProviderCreds };`)(...Object.values(deps));
  return { ...fns, map: () => map };
}

test('saved ShopSocks5 credentials are ignored, and the next save cleans them up', async () => {
  const s = credStore({ shopsocks5: { username: 'me', token: 'sealed:t', proxyType: 'proxy_https' }, coronium: { token: 'sealed:k' } });
  assert.deepEqual(await s.getProxyProviderCreds({ provider: 'shopsocks5' }), { found: false });
  assert.equal(await s.readSavedProviderCreds('shopsocks5'), null);
  assert.equal((await s.getProxyProviderCreds({ provider: 'coronium' })).token, 'k', 'other providers are untouched');
  await assert.rejects(s.saveProxyProviderCreds({ provider: 'shopsocks5', username: 'me', token: 't' }), /Unknown proxy provider/);
  assert.ok(s.map().shopsocks5, 'a refused save writes nothing');
  await s.saveProxyProviderCreds({ provider: 'froxy', username: 'u', password: 'p' });
  assert.deepEqual(Object.keys(s.map()).sort(), ['coronium', 'froxy'], 'the removed provider\'s entry is gone');
});
