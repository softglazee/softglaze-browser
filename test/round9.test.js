'use strict';
// 1.0.26 round 9, the last app items of the 1.0.27 backlog before the rebuild:
//  - "Smartproxy" labels outside the connector say "Decodo (Smartproxy)", as the connector does;
//  - 14. SoftGlaze AI tools: canRotate from main's rule, Firefox WebRTC fixes, rotate_proxy_ip and
//    "use only" shares within a token's groups, the legacy rotation-link pass;
//  - MarsProxies 404 and 409 replies, CatProxies ISP and Datacenter, the How many placeholder,
//    Airproxy's paid-until date, the AnyIP note, the Proxy pool at 375 px;
//  - 17 and 18 (Spanish) leftovers.
// ShopSocks5's removal is in removed-vendors.test.js, the affiliate links in connectorsShared.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { createFakePrisma } = require('./helpers/fakePrisma');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const IPC = read('src', 'main', 'ipcHandlers.js');
const UI = read('src', 'renderer', 'components', 'ProxyProviders.jsx');
const importLib = (name) => import(pathToFileURL(path.join(ROOT, 'src', 'renderer', 'lib', name)).href);
const loc = (lang, ns) => JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, `${ns}.json`));

function extractFunction(source, name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.notEqual(start, -1, `could not find function ${name}`);
  let i = source.indexOf(') {', start) + 2;
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}
function extractConst(source, name) {
  const start = source.indexOf(`\nconst ${name} = `);
  assert.notEqual(start, -1, `could not find const ${name}`);
  let depth = 0;
  let quote = null;
  for (let i = start + 1; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') { quote = c; continue; }
    if (c === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); continue; }
    if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) depth--;
    else if (c === ';' && depth === 0) return source.slice(start + 1, i + 1);
  }
  throw new Error(`unterminated const ${name}`);
}
function loadMain(names, deps, consts = []) {
  const src = [...consts.map((c) => extractConst(IPC, c)), ...names.map((n) => extractFunction(IPC, n))].join('\n');
  const k = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  return new Function(...k, `${src}\nreturn { ${names.join(', ')} };`)(...k.map((x) => deps[x]));
}

// ---- Decodo (Smartproxy) ----

test('Decodo: the pool, Quick generate and the editor no longer call it "Smartproxy"', () => {
  const pool = read('src', 'renderer', 'pages', 'ProxyPoolPage.jsx');
  const quick = read('src', 'renderer', 'components', 'QuickGenerateModal.jsx');
  const profiles = read('src', 'renderer', 'pages', 'ProfilesPage.jsx');
  for (const [name, src] of [['ProxyPoolPage', pool], ['QuickGenerateModal', quick], ['ProfilesPage', profiles]]) {
    // A comment may name the old brand next to the new one; a label may not stand alone.
    assert.doesNotMatch(src.replace(/Decodo \(Smartproxy\)/g, ''), /'Smartproxy'/, name);
  }
  // Both name a provider tag from the connector catalog, where smartproxy is "Decodo (Smartproxy)".
  for (const src of [pool, quick]) assert.match(src, /const PROVIDER_NAMES = \{ \.\.\.Object\.fromEntries\(PROVIDERS\.map\(\(p\) => \[p\.key, p\.name\]\)\), apify: 'Apify', custom: 'Custom' \};/);
  assert.match(UI, /key: 'smartproxy', name: 'Decodo \(Smartproxy\)'/);
  // The editor's unused proxyProvider default ('Smartproxy') is gone; main never read it.
  assert.doesNotMatch(profiles, /proxyProvider:|proxyApiKey:/);
});

test('Decodo: the Super Admin\'s IP providers keep the stored row, show Decodo (Smartproxy) and Decodo\'s dashboard', async () => {
  const db = { rows: [{ id: 3, name: 'Smartproxy', referralLink: 'https://dashboard.smartproxy.com/', apiKey: 'enc', secretKey: null, status: 'ENABLED' }, { id: 4, name: 'Oxylabs', referralLink: 'https://my.example/oxy', status: 'DISABLED' }] };
  const fake = {
    ipProvider: {
      findUnique: async ({ where }) => db.rows.find((r) => r.name === where.name) || null,
      create: async ({ data }) => { const row = { id: db.rows.length + 10, ...data }; db.rows.push(row); return row; },
      update: async ({ where, data }) => { const row = db.rows.find((r) => r.id === where.id); Object.assign(row, data); return row; }
    }
  };
  const fns = loadMain(['ensureIpProviders', 'ipProviderLabel', 'serializeIpProvider', 'maskSecret'], {
    secretStore: { open: (v) => `opened-${v}` }
  }, ['DEFAULT_IP_PROVIDERS']);
  await fns.ensureIpProviders(fake);
  const smart = db.rows.find((r) => r.name === 'Smartproxy');
  assert.equal(smart.referralLink, 'https://dashboard.decodo.com/', 'the old default link moved to Decodo');
  assert.equal(smart.status, 'ENABLED', 'the row and its keys stay');
  assert.equal(db.rows.filter((r) => /smartproxy|decodo/i.test(r.name)).length, 1, 'no second row');
  assert.equal(db.rows.find((r) => r.name === 'Oxylabs').referralLink, 'https://my.example/oxy', 'a link someone set is kept');
  const view = fns.serializeIpProvider(smart);
  assert.equal(view.name, 'Smartproxy');
  assert.equal(view.label, 'Decodo (Smartproxy)');
  assert.equal(fns.serializeIpProvider(db.rows.find((r) => r.name === 'Oxylabs')).label, 'Oxylabs');
  await fns.ensureIpProviders(fake);
  assert.equal(smart.referralLink, 'https://dashboard.decodo.com/', 'idempotent');
  const card = read('src', 'renderer', 'components', 'IpProvidersSettings.jsx');
  assert.match(card, /const shownName = provider\.label \|\| provider\.name;/);
  assert.doesNotMatch(card, /\{provider\.name\}|provider: provider\.name/);
});
