'use strict';
// Batch Add's optional Provider tag (ARNPROXY Part A): pasted proxies are tagged with a provider, so
// the pool groups them and the Proxy providers page counts them. No Prisma change: Proxy already has
// a provider column.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const IPC = read('src', 'main', 'ipcHandlers.js');
const UI = read('src', 'renderer', 'components', 'ProxyProviders.jsx');
const POOL = read('src', 'renderer', 'pages', 'ProxyPoolPage.jsx');
const STATES = read('src', 'renderer', 'lib', 'providerStates.js');
const SCHEMA = read('prisma', 'schema.prisma');
const json = (lang, ns) => JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, `${ns}.json`));

const fnSrc = (name) => {
  const m = new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\r?\\n\\}\\r?\\n`).exec(IPC);
  assert.ok(m, `${name} must exist`);
  return m[0];
};

// batchAddProxies against an in-memory pool.
function load() {
  const created = [];
  const db = { proxy: { create: async ({ data }) => { const row = { id: created.length + 1, ...data }; created.push(row); return row; } } };
  const deps = {
    requirePermission: async () => {},
    getPrisma: () => db,
    assertWithinLimit: async () => {},
    ownerStampId: () => 7,
    proxyAddContext: async () => ({ ownerId: 7 }),
    findVisibleProxy: async () => null,
    serializeProxy: (p) => p,
    parseProxyType: (v) => String(v || 'HTTP').toUpperCase(),
    parseColonProxyLine: (line, type) => { const [host, port, username = null, password = null] = line.split(':'); return { type, host, port: Number(port), username, password }; },
    PROXY_VENDORS: Object.freeze({ proxy6: 'PROXY6', arnproxy: 'ARNPROXY' })
  };
  const src = ['requireObject', 'optionalString', 'requiredString', 'batchAddProxies'].map(fnSrc).join('\n');
  // eslint-disable-next-line no-new-func
  const { batchAddProxies } = new Function(...Object.keys(deps), `${src}\nreturn { batchAddProxies };`)(...Object.values(deps));
  return { batchAddProxies, created };
}

test('a chosen provider tags each pasted proxy and names it like a pulled one', async () => {
  const a = load();
  const r = await a.batchAddProxies({ raw: '198.51.100.1:8000:u1:p1\n198.51.100.2:8000:u2:p2', type: 'HTTP', provider: 'ARNPROXY', namePrefix: 'ARNPROXY' });
  assert.equal(r.created.length, 2);
  assert.deepEqual(a.created.map((c) => [c.provider, c.name]), [['arnproxy', 'ARNPROXY • 198.51.100.1:8000'], ['arnproxy', 'ARNPROXY • 198.51.100.2:8000']]);
});

test('no provider stays untagged; an unknown provider is refused before anything is added', async () => {
  const a = load();
  await a.batchAddProxies({ raw: '198.51.100.3:8000', type: 'SOCKS5', provider: '' });
  assert.deepEqual([a.created[0].provider, a.created[0].name], [null, 'SOCKS5 198.51.100.3:8000']);
  const b = load();
  await assert.rejects(b.batchAddProxies({ raw: '198.51.100.4:8000', provider: 'madeup' }), /Unknown proxy provider/);
  await assert.rejects(b.batchAddProxies({ raw: '198.51.100.4:8000', provider: 'toString' }), /Unknown proxy provider/, 'only the vendor table\'s own keys');
  assert.equal(b.created.length, 0);
});

test('ARNPROXY is a provider without a connector: the pull refuses, the page lists and counts it', () => {
  assert.match(IPC, /arnproxy: 'ARNPROXY'/, 'in PROXY_VENDORS, so Batch Add accepts it');
  assert.doesNotMatch(IPC, /arnproxy: fetch/, 'no adapter (Part B waits on ARNPROXY)');
  const line = UI.split(/\r?\n/).find((l) => l.includes("{ key: 'arnproxy',"));
  assert.ok(line, 'PROVIDERS entry');
  assert.match(line, /referral: 'https:\/\/www\.arnproxy\.com\/', gateway: null, unavailable: true \}/);
  assert.doesNotMatch(line, /geoSync|tokenSync|apiSync/, 'it offers no pull');
  // The page counts the pool by each proxy's provider tag.
  assert.match(STATES, /const k = px && px\.provider \? String\(px\.provider\)\.toLowerCase\(\) : null;/);
  // Its detail card says where its proxies come from, not "read from your key".
  assert.match(read('src', 'renderer', 'pages', 'ProxyProvidersPage.jsx'), /t\(p\.unavailable \? 'detail\.gatewayManual' : 'detail\.gatewayFromKey'\)/);
  for (const lang of ['en', 'es']) assert.equal(typeof json(lang, 'providersPage').detail.gatewayManual, 'string', lang);
  // Proxy already has the column: no schema change.
  assert.match(SCHEMA, /model Proxy \{[\s\S]*?\n {2}provider\s+String\?/);
});

test('the Batch Add dialog has an optional Provider select, ARNPROXY first, and sends the tag', () => {
  assert.match(POOL, /import \{ PROVIDERS \} from '@\/components\/ProxyProviders\.jsx';/);
  assert.match(POOL, /const BATCH_PROVIDERS = \[\.\.\.PROVIDERS\]\.sort\(\(a, b\) => \(a\.key === 'arnproxy' \? -1 : b\.key === 'arnproxy' \? 1 : a\.name\.localeCompare\(b\.name\)\)\);/);
  assert.match(POOL, /const \[batchProvider, setBatchProvider\] = useState\(''\);/);
  assert.match(POOL, /softglazeApi\.proxies\.batchAdd\(\{ raw: batchRaw, type: batchType, \.\.\.\(tag \? \{ provider: tag\.key, namePrefix: tag\.name \} : \{\}\) \}\)/);
  assert.match(POOL, /<Field label=\{t\('batch\.providerLabel'\)\}>/);
  assert.match(POOL, /<option value="">\{t\('batch\.providerNone'\)\}<\/option>/);
  // A provider-tag chip shows the provider's name, not its key (a removed provider: the name its proxies
  // were pulled with; removed-vendors.test.js).
  assert.match(POOL, /const PROVIDER_NAMES = \{ \.\.\.Object\.fromEntries\(PROVIDERS\.map\(\(p\) => \[p\.key, p\.name\]\)\), apify: 'Apify', custom: 'Custom' \};/);
  assert.match(POOL, /const providerLabel = \(key\) => providerTagLabel\(key, PROVIDER_NAMES, pulledNames\);/);
  assert.doesNotMatch(POOL, /PROVIDER_LABELS/);
});

test('the Batch Add strings exist in English and Spanish, without dashes', () => {
  const en = json('en', 'proxies').batch;
  const es = json('es', 'proxies').batch;
  assert.equal(en.providerLabel, 'Provider (optional)');
  assert.equal(es.providerLabel, 'Proveedor (opcional)');
  for (const k of ['providerLabel', 'providerNone', 'providerHint']) {
    for (const [lang, b] of [['en', en], ['es', es]]) {
      assert.equal(typeof b[k], 'string', `${lang} ${k}`);
      assert.doesNotMatch(b[k], /[–—]/, `${lang} ${k}`);
    }
  }
});
