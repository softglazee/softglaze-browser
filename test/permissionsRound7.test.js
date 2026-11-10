'use strict';
// 1.0.26 round 7: the five items PR #67 listed under "Noticed, not fixed".
//  1. Rotation links from a spreadsheet import are used: a row's link goes on the row's own proxy when
//     that proxy has none (a proxy's own link wins), so it rotates and hides exactly like a proxy's own
//     link. Links imported before 1.0.26 go on the proxy made for their row, once.
//  2. Firefox profiles always run with WebRTC off: the CAPTCHA score, the Leak check, the editor and
//     Compare show that state instead of grading or offering a setting that does nothing.
//  3. Quick generate's preview names follow the number main creates when fewer proxies are usable
//     (main's real batchGenerateProfiles is also run in test/permissionsRound5.test.js, case B).
//  4. A "use only" share may rotate its profile's proxy (Rotate IP on the profile row, and the automatic
//     block response), with every other gate kept, logged, and the proxy returned masked.
//  5. While an AI or Local API token acts, the proxy serializers follow the token's member's
//     proxies.reveal, not the window member's.
// Main-process functions run for real from ipcHandlers.js with the real permissions module and an
// in-memory database stand-in (test/helpers/fakePrisma.js), as in rounds 4 and 5.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const permissions = require('../src/main/permissions');
const rbacPolicy = require('../src/main/rbacPolicy');
const featureGate = require('../src/main/featureGate');
const proxyScope = require('../src/main/proxyScope');
const aiActor = require('../src/main/ai/actor');
const { compactProxy } = require('../src/main/ai/tools');
const { scoreProfile } = require('../src/main/captchaScore');
const { preLaunchIssues } = require('../src/main/launchCheck');
const { deviceGpuCoherence } = require('../src/main/fingerprintGenerator');
const { BROWSER_CORE, normalizeBrowserCore } = require('../src/main/importParser');
const profileOptions = require('../src/main/profileOptions');
const profileRedaction = require('../src/main/profileRedaction');
const { SECRET_MASK, redactForeignProxy, redactProfileRow, redactPlatformAccounts, redactUseOnlyProxy } = profileRedaction;
const { createFakePrisma } = require('./helpers/fakePrisma');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const IPC = read('src', 'main', 'ipcHandlers.js');
const importLib = (name) => import(pathToFileURL(path.join(ROOT, 'src', 'renderer', 'lib', name)).href);

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

// A top-level `const NAME = ...;` statement (brackets and string literals are skipped over).
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

// Runs main-process functions (and constants) from ipcHandlers.js in this realm with stand-ins.
function loadMain(names, deps, consts = []) {
  const src = [...consts.map((c) => extractConst(IPC, c)), ...names.map((n) => extractFunction(IPC, n))].join('\n');
  const keys = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  return new Function(...keys, `${src}\nreturn { ${names.join(', ')} };`)(...keys.map((k) => deps[k]));
}
const VALIDATORS = ['requireObject', 'optionalString', 'requiredString', 'parseId'];

// ---- The team: Owner 1 > Admin 2 > Operators 3 and 4 (siblings) and Manager 5 ----

const MEMBERS = [
  { id: 1, name: 'Owner', role: 'OWNER', parentMemberId: null, status: 'active', createdAt: new Date('2026-01-01T00:00:00Z') },
  { id: 2, name: 'Admin', role: 'ADMIN', parentMemberId: 1, status: 'active', createdAt: new Date('2026-02-01T00:00:00Z') },
  { id: 3, name: 'Operator X', role: 'OPERATOR', parentMemberId: 2, status: 'active', createdAt: new Date('2026-03-01T00:00:00Z') },
  { id: 4, name: 'Operator Y', role: 'OPERATOR', parentMemberId: 2, status: 'active', createdAt: new Date('2026-03-02T00:00:00Z') },
  { id: 5, name: 'Manager', role: 'MANAGER', parentMemberId: 2, status: 'active', createdAt: new Date('2026-04-01T00:00:00Z') }
];
const OWNER_LINK = 'https://rotate.example/api?key=OWNERKEY';
const POOL_LINK = 'https://rotate.example/pool?key=POOLKEY';
const X_LINK = 'https://rotate.example/x?key=XKEY';

function seed() {
  return createFakePrisma({
    member: MEMBERS.map((m) => ({ ...m })),
    proxy: [
      // The Owner's proxies (outside everyone else's pool): one with a link, one in a rotation pool, one without.
      { id: 20, name: 'owner-gw', type: 'HTTP', host: 'gw.owner.net', port: 7000, username: 'owneruser', password: 'ownerpass', rotationUrl: OWNER_LINK, ownerMemberId: 1 },
      { id: 23, name: 'owner-pool', type: 'HTTP', host: 'pool.owner.net', port: 7100, username: 'pooluser', password: 'poolpass', rotationUrl: POOL_LINK, ownerMemberId: 1 },
      { id: 24, name: 'owner-static', type: 'HTTP', host: 'static.owner.net', port: 7200, username: 'su', password: 'sp', rotationUrl: null, ownerMemberId: 1 },
      // The Manager's own proxy, and Operator X's own.
      { id: 21, name: 'mgr-gw', type: 'HTTP', host: 'mgr.example', port: 8000, username: 'mgruser', password: 'mgrpass', rotationUrl: 'https://rotate.example/mgr', ownerMemberId: 5 },
      { id: 22, name: 'x-gw', type: 'HTTP', host: 'gw.x.net', port: 7300, username: 'xuser', password: 'xpass', rotationUrl: X_LINK, ownerMemberId: 3 }
    ],
    profile: [
      // The Owner's profiles: 104 shared "use only" with X, 106 shared for editing with X, 110 "use only"
      // with X and a rotation pool, 111 not shared, 112 "use only" with X on a proxy that cannot rotate.
      { id: 104, title: 'shared-use', dataDirName: 'shared-use', ownerMemberId: 1, assignedMemberId: 1, browserCore: 'Chromium', deletedAt: null,
        proxyId: 20, proxyInfoString: 'gw.owner.net:7000:owneruser:ownerpass', systemProxyBehavior: 'PROFILE_PROXY', accesses: [{ memberId: 3, level: 'use' }] },
      { id: 106, title: 'shared-edit', dataDirName: 'shared-edit', ownerMemberId: 1, assignedMemberId: 1, browserCore: 'Chromium', deletedAt: null,
        proxyId: 20, proxyInfoString: 'gw.owner.net:7000:owneruser:ownerpass', systemProxyBehavior: 'PROFILE_PROXY', accesses: [{ memberId: 3, level: 'edit' }] },
      { id: 110, title: 'shared-pool', dataDirName: 'shared-pool', ownerMemberId: 1, assignedMemberId: 1, browserCore: 'Chromium', deletedAt: null,
        proxyId: 24, proxyInfoString: 'static.owner.net:7200:su:sp', systemProxyBehavior: 'PROFILE_PROXY', accesses: [{ memberId: 3, level: 'use' }] },
      { id: 111, title: 'owner-only', dataDirName: 'owner-only', ownerMemberId: 1, assignedMemberId: 1, browserCore: 'Chromium', deletedAt: null,
        proxyId: 20, proxyInfoString: 'gw.owner.net:7000:owneruser:ownerpass', systemProxyBehavior: 'PROFILE_PROXY', accesses: [] },
      { id: 112, title: 'shared-static', dataDirName: 'shared-static', ownerMemberId: 1, assignedMemberId: 1, browserCore: 'Chromium', deletedAt: null,
        proxyId: 24, proxyInfoString: 'static.owner.net:7200:su:sp', systemProxyBehavior: 'PROFILE_PROXY', accesses: [{ memberId: 3, level: 'use' }] },
      // X's own profile on X's own proxy.
      { id: 120, title: 'x-own', dataDirName: 'x-own', ownerMemberId: 3, assignedMemberId: 3, browserCore: 'Chromium', deletedAt: null,
        proxyId: 22, proxyInfoString: 'gw.x.net:7300:xuser:xpass', systemProxyBehavior: 'PROFILE_PROXY', accesses: [] }
    ]
  });
}
// Profile 110's rotation pool (Setting proxyRotation) holds the Owner's proxy 23.
const ROTATION_SETTING = { 110: { enabled: true, proxyIds: [23], mode: 'round-robin' } };

// The acting member (null = single-user mode) and the real access rules that read it.
function workspace(db) {
  const state = { member: null };
  const deps = {
    getPrisma: () => db,
    permissions,
    featureGate,
    getActiveMember: async () => state.member,
    PROFILE_ACCESS_SELECT: { id: true, ownerMemberId: true, assignedMemberId: true, accesses: { select: { memberId: true, level: true } } },
    PERMISSIONS: permissions.ACTION_MIN_RANK,
    rankOf: permissions.rankOf,
    // main's per-window reveal flag for the member signed in (Manager and up unless turned off).
    proxyRevealAllowed: () => !state.member || permissions.effectivePermissions(state.member).actions['proxies.reveal'] !== false
  };
  const as = (who, patch) => {
    if (who == null) state.member = null;
    else state.member = { ...MEMBERS.find((m) => m.id === who), ...(patch || {}) };
    return state.member;
  };
  return { state, deps, as };
}
const revoked = (...actions) => ({ permissionsJson: JSON.stringify({ actions: Object.fromEntries(actions.map((a) => [a, false])) }) });

// main's rotation path for real: the permission and access checks, rotateProxyIp, the Profiles page's
// rotateProfileProxyIp and the proxy view it returns. Fetches go to a stand-in axios.
function loadRotation(db, { settings = { proxyRotation: ROTATION_SETTING } } = {}) {
  const ws = workspace(db);
  const fetched = [];
  const activity = [];
  const axios = { get: async (url) => { fetched.push(url); return { status: 200, data: `ok new ip 9.9.9.9 ${url}` }; } };
  const fns = loadMain([...VALIDATORS, 'requirePermission', 'canRevealProxyCredentials', 'assertCanAccessProxy', 'assertCanAccessProfile',
    'profileLaunchProxyIds', 'assertCanRotateProxy', 'isDataImpulseSticky', 'apiRotationProvider', 'proxyCanRotate', 'rotateProxyIp', 'rotationLinkTimeoutMs', 'serializeProxy', 'deriveProvider',
    'launchedProxyView', 'rotateProfileProxyIp'], {
    ...ws.deps, rbacPolicy, redactForeignProxy, SECRET_MASK,
    readSetting: async (k, d) => (k in settings ? settings[k] : d),
    rotateDataImpulseSticky: async () => { throw new Error('not used'); }, PROVIDER_ROTATORS: { dataimpulse: async () => { throw new Error('not used'); } }, ROTATION_LINK_TIMEOUT_MS: {},
    assertPublicHttpUrl: async () => {},
    assertPublicHttpUrlSync: () => {},
    publicOnlyLookup: () => {},
    logActivity: async (_db, profileId, action, detail) => { activity.push({ profileId, action, detail, memberId: ws.state.member ? ws.state.member.id : null }); },
    require: (m) => (m === 'axios' ? axios : require(m))
  });
  return { ws, fns, fetched, activity };
}

// ==== 1. Rotation links from a spreadsheet import ====

// commitProfileImport for real, with a findOrCreateProxy stand-in that reuses a matching row of the
// importer's pool or creates one named "<title> Proxy" (as main does).
function loadImport(db, items, member = 3) {
  const ws = workspace(db);
  ws.as(member);
  const settings = new Map();
  const cache = new Map([['tok', { parsed: { fileName: 'rows.xlsx', sheetName: 'S', headerRow: 1, totalRows: items.length, errors: [], items } }]]);
  const sent = [];
  const fns = loadMain([...VALIDATORS, 'importedRotationUrl', 'attachImportedRotationUrl', 'commitProfileImport'], {
    ...ws.deps, proxyScope,
    requirePermission: async () => {}, assertWithinLimit: async () => {},
    importPreviewCache: cache, CHANNELS: { BATCH_IMPORT_PROGRESS: 'p' },
    scopedProxyWhere: async (w) => w, scopedGroupWhere: async (w) => w,
    toCountryCode: (v) => String(v || '').trim().toUpperCase(),
    countryMatches: (a, b) => Boolean(a) && String(a).toUpperCase() === String(b || '').toUpperCase(),
    readSetting: async (k, d) => (settings.has(k) ? settings.get(k) : d),
    writeSetting: async (k, v) => { settings.set(k, JSON.parse(JSON.stringify(v))); },
    ownerStampId: () => member,
    proxyAddContext: async () => ({ visible: undefined, ownerId: member, max: -1 }),
    findOrCreateProxy: async (_db, raw, name) => {
      const [host, port, username = null, password = null] = String(raw).split(':');
      const found = (await db.proxy.findMany()).find((p) => p.host === host && String(p.port) === String(port) && (p.username || null) === username && (p.password || null) === password && p.ownerMemberId === member);
      return found || db.proxy.create({ data: { name, type: 'HTTP', host, port: Number(port), username, password, rotationUrl: null, ownerMemberId: member } });
    },
    serializeProxy: (p) => ({ id: p.id, rotationUrl: p.rotationUrl ? SECRET_MASK : null, canRotate: Boolean(p.rotationUrl) }),
    parseSystemProxyBehavior: (_v, d) => d, doNotTrackChoice: (v) => v,
    ensureUniqueDataDirName: async (_db, n) => n, generateFingerprint: () => ({}), claimDeviceIdentity: async (_db, _st, d) => d,
    buildProxyInfoString: (p) => `${p.host}:${p.port}`, serializeProfile: (p) => p, logActivity: async () => {}
  });
  const event = { sender: { send: (_c, data) => sent.push(data) } };
  return { ws, settings, sent, run: () => fns.commitProfileImport({ token: 'tok', autoBindByCountry: true }, event) };
}

test('1: an imported row puts its rotation link on its own proxy when the proxy has none; a proxy\'s own link wins; a row without its own proxy keeps the link for the export only', async () => {
  const db = seed();
  // X's own proxy already has a vendor link; a pool proxy in the US for auto-bind, without a link.
  await db.proxy.create({ data: { id: 30, name: 'x-us', type: 'HTTP', host: 'us.x.net', port: 9000, username: null, password: null, rotationUrl: null, ownerMemberId: 3, lastCountry: 'US' } });
  const items = [
    { row: 2, title: 'Mob 1', proxyMethod: 'CUSTOM', rawProxy: 'mob1.example:1000:u1:p1', proxyRotationUrl: ' https://rot.example/1?key=K1 ' },
    { row: 3, title: 'Reuse X', proxyMethod: 'CUSTOM', rawProxy: 'gw.x.net:7300:xuser:xpass', proxyRotationUrl: 'https://rot.example/2?key=K2' },
    { row: 4, title: 'Auto US', country: 'US', proxyRotationUrl: 'https://rot.example/3?key=K3' },
    { row: 5, title: 'Bad link', proxyMethod: 'CUSTOM', rawProxy: 'mob4.example:1000', proxyRotationUrl: 'not a link' },
    { row: 6, title: 'Mob 1 again', proxyMethod: 'CUSTOM', rawProxy: 'mob1.example:1000:u1:p1', proxyRotationUrl: 'https://rot.example/5?key=K5' }
  ];
  const imp = loadImport(db, items);
  const res = await imp.run();
  assert.equal(res.createdProfiles.length, 5);
  const proxyOf = async (title) => db.proxy.findUnique({ where: { id: (await db.profile.findFirst({ where: { title } })).proxyId } });
  assert.equal((await proxyOf('Mob 1')).rotationUrl, 'https://rot.example/1?key=K1', 'the row\'s own new proxy takes its link');
  assert.equal((await proxyOf('Reuse X')).rotationUrl, X_LINK, 'a proxy\'s own link is never replaced');
  assert.equal((await proxyOf('Auto US')).id, 30);
  assert.equal((await proxyOf('Auto US')).rotationUrl, null, 'an auto-bound pool proxy is not given the row\'s link');
  assert.equal((await proxyOf('Bad link')).rotationUrl, null, 'only an http(s) link');
  assert.equal((await proxyOf('Mob 1 again')).rotationUrl, 'https://rot.example/1?key=K1', 'two rows on one proxy: the first link stays');
  // Every link is still kept per profile for the export, as before.
  const stored = imp.settings.get('profileRotationUrls');
  assert.equal(Object.keys(stored).length, 5);
  assert.equal(stored[res.createdProfiles[2].id], 'https://rot.example/3?key=K3');
  // The import log says what happened, and the created proxy goes out masked.
  const log = imp.sent.map((f) => f.message).join('\n');
  assert.match(log, /\[INFO\] Rotation link saved on proxy mob1\.example:1000\./);
  assert.match(log, /\[INFO\] Proxy gw\.x\.net:7300 keeps its own rotation link\./);
  assert.doesNotMatch(log, /K1|K2|K3|K5/, 'the import log never prints a link');
  assert.deepEqual([res.createdProxies[0].rotationUrl, res.createdProxies[0].canRotate], [SECRET_MASK, true]);
});

test('1: an imported link then works and hides exactly like a proxy\'s own link (lists, export, Rotate IP, the block response, SoftGlaze AI and the Local API)', async () => {
  const db = seed();
  const imp = loadImport(db, [{ row: 2, title: 'Mob 1', proxyMethod: 'CUSTOM', rawProxy: 'mob1.example:1000:u1:p1', proxyRotationUrl: 'https://rot.example/1?key=K1' }]);
  await imp.run();
  const row = await db.proxy.findFirst({ where: { host: 'mob1.example' } });
  // The Proxy pool, the profile list's linked proxy and every other serializeProxy caller.
  const view = (reveal) => loadMain(['serializeProxy', 'deriveProvider', 'isDataImpulseSticky', 'apiRotationProvider', 'proxyCanRotate'], { rbacPolicy, proxyRevealAllowed: () => reveal }).serializeProxy(row);
  assert.deepEqual([view(false).rotationUrl, view(false).canRotate, view(false).hasRotationUrl], [SECRET_MASK, true, true], 'an Operator gets the mask and the Rotate IP button');
  assert.doesNotMatch(JSON.stringify(view(false)), /K1/);
  assert.equal(view(true).rotationUrl, 'https://rot.example/1?key=K1', 'proxies.reveal: shown');
  // Rotate IP by id (the Proxy pool, SoftGlaze AI, the Local API) fires it from main.
  const rot = loadRotation(db);
  rot.ws.as(3);
  const r = await rot.fns.rotateProxyIp({ id: row.id });
  assert.equal(r.ok, true);
  assert.deepEqual(rot.fetched, ['https://rot.example/1?key=K1']);
  // SoftGlaze AI's proxy view offers rotate_proxy_ip and never carries the link.
  const ai = compactProxy(row);
  assert.equal(ai.canRotate, true);
  assert.doesNotMatch(JSON.stringify(ai), /K1/);
  assert.match(read('src', 'main', 'ai', 'tools.js'), /ctx\.deps\.rotateProxyIp\(\{ id: a\.proxyId \}\)/);
  assert.doesNotMatch(read('src', 'main', 'localApi.js'), /rotationUrl/, 'the Local API runs the AI tools');
  // The automatic block response decides "can rotate" from the proxy's link.
  assert.match(extractFunction(IPC, 'respondToBlock'), /canRotate: proxyCanRotate\(proxy\)/);
  // The export's column is still blank without proxies.reveal (round 5), from the same Setting.
  assert.match(extractFunction(IPC, 'gatherExport'), /c\[0\] === 'Proxy Rotation URL'\)\) return '';/);
});

// The start-up pass for links imported before 1.0.26, with a Setting store that survives "restarts".
function loadAdoption(db, store) {
  const audit = [];
  const writes = [];
  const fns = loadMain(['importedRotationUrl', 'attachImportedRotationUrl', 'proxyMadeForImportedRow', 'adoptImportedRotationLinks'], {
    getPrisma: () => db,
    readSetting: async (k, d) => (store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : d),
    writeSetting: async (k, v) => { writes.push(k); store.set(k, JSON.parse(JSON.stringify(v))); },
    logAudit: async (action, opts) => { audit.push({ action, ...opts }); },
    rotationLinksAdoptedThisRun: false
  }, ['ROTATION_LINKS_ADOPTED_SETTING']);
  return { ...fns, audit, writes };
}

test('1: links imported before 1.0.26 go on the proxy made for their row, once, and on no other proxy', async () => {
  const t0 = new Date('2026-10-20T10:00:00Z').getTime();
  const at = (ms) => new Date(t0 + ms);
  const db = createFakePrisma({
    member: MEMBERS.map((m) => ({ ...m })),
    proxy: [
      { id: 41, name: 'Mob A Proxy', host: 'a.example', port: 1, rotationUrl: null, ownerMemberId: 3, createdAt: at(-800) },
      { id: 42, name: 'Mob B Proxy', host: 'b.example', port: 1, rotationUrl: null, ownerMemberId: 3, createdAt: at(-500) },
      { id: 43, name: 'Mob C Proxy', host: 'c.example', port: 1, rotationUrl: 'https://own.example/c', ownerMemberId: 3, createdAt: at(-500) },
      { id: 44, name: 'Pool US 1', host: 'us.example', port: 1, rotationUrl: null, ownerMemberId: 3, createdAt: at(-5 * 86400000) },
      { id: 46, name: 'Mob F Proxy', host: 'f.example', port: 1, rotationUrl: null, ownerMemberId: 3, createdAt: at(-500) },
      { id: 47, name: 'Mob G Proxy', host: 'g.example', port: 1, rotationUrl: null, ownerMemberId: 3, createdAt: at(-120000) },
      { id: 48, name: 'Mob H Proxy', host: 'h.example', port: 1, rotationUrl: null, ownerMemberId: 2, createdAt: at(-500) },
      { id: 49, name: 'Mob I Proxy', host: 'i.example', port: 1, rotationUrl: '', ownerMemberId: null, createdAt: at(-300) }
    ],
    profile: [
      { id: 201, title: 'Mob A', proxyId: 41, ownerMemberId: 3, createdAt: at(0) }, // made for the row: attached
      { id: 202, title: 'Renamed B', proxyId: 42, ownerMemberId: 3, createdAt: at(0) }, // renamed since: left alone
      { id: 203, title: 'Mob C', proxyId: 43, ownerMemberId: 3, createdAt: at(0) }, // the proxy's own link wins
      { id: 204, title: 'Mob D', proxyId: 44, ownerMemberId: 3, createdAt: at(0) }, // auto-bound pool proxy
      { id: 206, title: 'Mob F', proxyId: 46, ownerMemberId: 3, createdAt: at(0) }, // not a link
      { id: 207, title: 'Mob G', proxyId: 47, ownerMemberId: 3, createdAt: at(0) }, // proxy older than the row
      { id: 208, title: 'Mob H', proxyId: 48, ownerMemberId: 3, createdAt: at(0) }, // another member's proxy
      { id: 209, title: 'Mob I', proxyId: 49, ownerMemberId: null, createdAt: at(0) }, // single-user mode, empty link
      { id: 210, title: 'Mob J', proxyId: null, ownerMemberId: 3, createdAt: at(0) } // no proxy any more
    ]
  });
  const LINKS = {
    201: 'https://rot.example/a?key=A', 202: 'https://rot.example/b', 203: 'https://rot.example/c', 204: 'https://rot.example/d',
    205: 'https://rot.example/purged', 206: 'javascript:alert(1)', 207: 'https://rot.example/g', 208: 'https://rot.example/h',
    209: 'https://rot.example/i', 210: 'https://rot.example/j'
  };
  const store = new Map([['profileRotationUrls', LINKS]]);
  const links = async () => Object.fromEntries((await db.proxy.findMany()).map((p) => [p.id, p.rotationUrl]));
  const before = await links();

  const run1 = loadAdoption(db, store);
  assert.deepEqual(await run1.adoptImportedRotationLinks(), { attached: 2, skipped: 8 });
  const after = await links();
  assert.equal(after[41], 'https://rot.example/a?key=A');
  assert.equal(after[49], 'https://rot.example/i', 'an empty link counts as none');
  for (const id of [42, 43, 44, 46, 47, 48]) assert.equal(after[id], before[id], `proxy ${id} untouched`);
  assert.deepEqual(store.get('profileRotationUrls'), LINKS, 'the imported links themselves are never rewritten');
  assert.deepEqual(Object.keys(store.get('profileRotationUrlsAdopted').done).sort(), Object.keys(LINKS).sort());
  assert.equal(store.get('profileRotationUrlsAdopted').done[201], 'attached');
  assert.equal(store.get('profileRotationUrlsAdopted').done[202], 'skipped');
  assert.deepEqual(run1.audit.map((a) => [a.action, a.detail]), [['proxy.rotation-links-adopted', { attached: 2, skipped: 8 }]]);
  // Idempotent: the same run does nothing again, and neither does the next start.
  assert.deepEqual(await run1.adoptImportedRotationLinks(), { attached: 0, skipped: 0 });
  const run2 = loadAdoption(db, store);
  assert.deepEqual(await run2.adoptImportedRotationLinks(), { attached: 0, skipped: 0 });
  assert.deepEqual(run2.writes, [], 'nothing is written when there is nothing new');
  assert.deepEqual(await links(), after);
  // A link taken off its proxy later is not put back at the next start.
  await db.proxy.update({ where: { id: 41 }, data: { rotationUrl: null } });
  await loadAdoption(db, store).adoptImportedRotationLinks();
  assert.equal((await db.proxy.findUnique({ where: { id: 41 } })).rotationUrl, null);
  // It runs whenever the database becomes ready (start-up, or unlock of an encrypted database).
  assert.match(extractFunction(IPC, 'afterDbReady'), /adoptImportedRotationLinks\(\)\.catch\(/);
});

// ==== 2. Firefox profiles run with WebRTC off ====

const BASE_PROFILE = { id: 1, os: 'Windows', timezoneType: 'Based on IP', languageType: 'Based on IP', locationType: 'Based on IP', launchCount: 5, systemProxyBehavior: 'PROFILE_PROXY' };
const OK_PROXY = { id: 9, host: 'h', port: 1, name: 'res', lastStatus: 'ok', lastCountry: 'US', lastCheckedAt: new Date().toISOString(), lastBlacklisted: false };

test('2: the CAPTCHA score shows WebRTC off for Firefox profiles, with the warning "Disabled" gets and no fix, whatever the setting', () => {
  const webrtcOf = (p, ctx = { proxy: OK_PROXY, hostOs: 'win32' }) => scoreProfile(p, ctx);
  for (const mode of ['Real', 'Forward', 'Replace', 'Disabled', undefined]) {
    for (const ctx of [{ proxy: OK_PROXY, hostOs: 'win32' }, { proxy: null, hostOs: 'win32' }]) {
      const s = webrtcOf({ ...BASE_PROFILE, browserCore: 'Firefox', webrtc: mode }, ctx);
      const f = s.factors.find((x) => x.key === 'webrtc');
      assert.deepEqual([f.status, f.impact, f.fix, f.params.firefox], ['warn', 5, null, true], `Firefox, WebRTC ${mode}`);
      assert.ok(!s.fixes.includes('webrtc-safe'), 'no fix is offered: no setting turns it on');
    }
  }
  // The same status and weight as "Disabled" on Chromium.
  const disabled = webrtcOf({ ...BASE_PROFILE, browserCore: 'Chromium', webrtc: 'Disabled' }).factors.find((x) => x.key === 'webrtc');
  assert.deepEqual([disabled.status, disabled.impact], ['warn', 5]);
  // Chromium is unchanged: Real behind a proxy still fails, Forward passes.
  assert.equal(webrtcOf({ ...BASE_PROFILE, browserCore: 'Chromium', webrtc: 'Real' }).factors.find((x) => x.key === 'webrtc').status, 'fail');
  assert.equal(webrtcOf({ ...BASE_PROFILE, browserCore: 'Chromium', webrtc: 'Forward' }).factors.find((x) => x.key === 'webrtc').status, 'pass');
  // The pre-launch check no longer stops a Firefox profile over a WebRTC setting that does nothing.
  const issues = preLaunchIssues({ ...BASE_PROFILE, browserCore: 'Firefox', webrtc: 'Real', userAgent: '' }, { proxy: OK_PROXY, hostOs: 'win32' });
  assert.ok(!issues.some((i) => i.key === 'webrtc'));
  assert.ok(preLaunchIssues({ ...BASE_PROFILE, browserCore: 'Chromium', webrtc: 'Real', userAgent: '' }, { proxy: OK_PROXY, hostOs: 'win32' }).some((i) => i.key === 'webrtc'));
});

test('2: the Leak check passes WebRTC for Firefox profiles with the real state, as it passes "Disabled"', async () => {
  const run = async (profile) => {
    const db = createFakePrisma({ proxy: [{ ...OK_PROXY, type: 'HTTP', username: null, password: null }], profile: [{ ...profile, id: 7, proxyId: 9 }] });
    const { analyzeProfileLeaks } = loadMain([...VALIDATORS, 'computeTrustScore', 'analyzeProfileLeaks'], {
      getPrisma: () => db, assertCanAccessProfile: async () => {}, normalizeBrowserCore, BROWSER_CORE, deviceGpuCoherence,
      testProxyConnectivity: async () => ({ success: true, ip: '1.2.3.4', country: 'US', latencyMs: 100, timezone: 'America/New_York' })
    });
    return (await analyzeProfileLeaks({ id: 7 })).checks.find((c) => c.key === 'webrtc');
  };
  for (const mode of ['Real', 'Forward', 'Disabled']) {
    const c = await run({ ...BASE_PROFILE, browserCore: 'Firefox', webrtc: mode });
    assert.deepEqual([c.status, c.detail], ['pass', 'WebRTC is off in Firefox profiles - real IP not leaked via WebRTC.'], mode);
  }
  assert.equal((await run({ ...BASE_PROFILE, browserCore: 'Chromium', webrtc: 'Disabled' })).status, 'pass', '"Disabled" passes too');
  assert.equal((await run({ ...BASE_PROFILE, browserCore: 'Chromium', webrtc: 'Real' })).status, 'fail', 'Chromium unchanged');
});

test('2: the editor shows a note instead of a WebRTC choice for Firefox profiles and keeps the saved value; the score window and Compare say "off"', () => {
  const page = read('src', 'renderer', 'pages', 'ProfilesPage.jsx');
  const field = page.slice(page.indexOf("<FpRow label={t('fp.webrtc')}"), page.indexOf("<FpRow label={t('fp.timezone')}"));
  const firefoxAt = field.indexOf("pd.browserCore === 'Firefox' ? (");
  const tabsAt = field.indexOf('<ButtonTabs value={webrtcModeOf(pd.webrtc)}');
  assert.ok(firefoxAt > -1 && tabsAt > firefoxAt, 'the choice is only in the Chromium branch');
  assert.match(field.slice(firefoxAt, tabsAt), /<p role="note"[^>]*>\{t\('fp\.webrtcFirefox'\)\} \{t\('fp\.webrtcFirefoxKept', \{ mode: webrtcModeOf\(pd\.webrtc\) \}\)\}<\/p>/);
  assert.doesNotMatch(field.slice(firefoxAt, tabsAt), /updatePd\(/, 'nothing changes the saved value');
  assert.match(read('src', 'renderer', 'components', 'CaptchaScore.jsx'), /if \(f\.key === 'webrtc' && p\.firefox\) return t\('factor\.webrtc\.firefoxOff'\);/);
  assert.match(read('src', 'renderer', 'components', 'CompareProfilesModal.jsx'), /p\.browserCore === 'Firefox' \? t\('compare\.webrtcFirefoxOff'\)/);
  for (const lang of ['en', 'es']) {
    const loc = (ns) => JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, `${ns}.json`));
    assert.ok(loc('captcha').factor.webrtc.firefoxOff, lang);
    assert.ok(loc('profiles').fp.webrtcFirefox && loc('profiles').fp.webrtcFirefoxKept.includes('{{mode}}'), lang);
    assert.ok(loc('cmpModalsA').compare.webrtcFirefoxOff, lang);
  }
  assert.match(JSON.parse(read('src', 'renderer', 'i18n', 'locales', 'en', 'captcha.json')).factor.webrtc.firefoxOff, /^WebRTC is off in Firefox profiles/);
});

// ==== 3. Quick generate preview with fewer usable proxies ====

test('3: the preview numbers the names by what main will create: usable pasted lines, unused proxies, then main\'s own number', async () => {
  const { quickGenNumber, quickGenPastedLines, quickGenUniqueCandidates, quickGenPlannedCount } = await importLib('quickGenProgress.mjs');
  const names = (count, available, toCreate) => {
    const n = quickGenPlannedCount({ count, available, toCreate });
    return Array.from({ length: n }, (_, i) => `Shop-${quickGenNumber(1, i, n)}`);
  };
  assert.deepEqual(names(10, 9).slice(0, 2), ['Shop-1', 'Shop-2'], '10 asked, 9 usable: -1, not -01');
  assert.equal(names(10, 9).length, 9);
  assert.deepEqual(names(10, 12).slice(0, 1), ['Shop-01'], 'enough proxies: the 10 asked for');
  assert.deepEqual(names(10, null).slice(0, 1), ['Shop-01'], 'no proxy limit (direct, or shared pool proxies)');
  assert.deepEqual(names(10, 0).slice(0, 1), ['Shop-01'], 'nothing usable: main creates nothing and says why; the names asked for stay');
  assert.deepEqual(names(10, 12, 9).slice(0, 1), ['Shop-1'], 'main\'s own number wins once it reports it');
  // Pasted lines: distinct, non-empty, without SOCKS4 (main's paste rule).
  assert.deepEqual(quickGenPastedLines('a:1\r\na:1\n\n  b:2  \nsocks4://c:3\nSOCKS4A://d:4\nsocks5://e:5'), ['a:1', 'b:2', 'socks5://e:5']);
  // Unused HTTP/SOCKS5 proxies of the chosen source, with the speed and blocklist filters on stored results.
  const now = new Date().toISOString();
  const list = [
    { id: 1, type: 'HTTP', profileCount: 0, lastStatus: 'ok', lastLatencyMs: 500, lastBlacklisted: false, proxyGroupId: 7, provider: 'iproyal', lastCheckedAt: now },
    { id: 2, type: 'SOCKS5', profileCount: 0, lastStatus: 'ok', lastLatencyMs: 3000, lastBlacklisted: true, proxyGroupId: null, provider: null },
    { id: 3, type: 'SOCKS4', profileCount: 0, lastStatus: 'ok' },
    { id: 4, type: 'HTTPS', profileCount: 0, lastStatus: 'ok' },
    { id: 5, type: 'HTTP', profileCount: 2, lastStatus: 'ok' },
    { id: 6, type: 'HTTP', profileCount: 0, lastStatus: null, lastBlacklisted: false, proxyGroupId: 7 }
  ];
  const ids = (opts) => quickGenUniqueCandidates(list, opts).map((p) => p.id);
  assert.deepEqual(ids({}), [1, 2, 6]);
  assert.deepEqual(ids({ source: 'group:7' }), [1, 6]);
  assert.deepEqual(ids({ source: 'provider:IPRoyal' }), [1]);
  assert.deepEqual(ids({ speed: 'fast' }), [1]);
  assert.deepEqual(ids({ speed: 'slow' }), [2]);
  assert.deepEqual(ids({ blacklist: 'clean' }), [1], 'an unchecked proxy is not "clean"');
  assert.deepEqual(ids({ free: true }), [1, 2], 'free proxies: only those that passed their last check');
  // The modal uses them, and main's 'create' frame, for the preview.
  const modal = read('src', 'renderer', 'components', 'QuickGenerateModal.jsx');
  assert.match(modal, /const planned = quickGenPlannedCount\(\{ count, available: availableProxies, toCreate: mainToCreate \}\);/);
  assert.match(modal, /const pad = \(index\) => quickGenNumber\(start, index, planned\);/);
  assert.match(modal, /if \(f\.phase === 'create' && Number\(f\.toCreate\) >= 1\) setMainToCreate\(Number\(f\.toCreate\)\);/);
  assert.match(modal, /\{planned > 1 && <>/);
  assert.match(modal, /proxyMode === 'paste'\s*\? quickGenPastedLines\(pasted\)\.length/);
});

// ==== 4. A "use only" share can rotate its profile's proxy ====

test('4: a "use only" share may rotate its profile\'s proxy by profile; every other gate still applies', async () => {
  const db = seed();
  const rot = loadRotation(db);
  rot.ws.as(3); // Operator X: 104 is shared with them "use only"; proxy 20 is the Owner's
  // By proxy id alone (the Proxy pool's way), the Owner's proxy stays out of reach, as before.
  await assert.rejects(rot.fns.rotateProxyIp({ id: 20 }), (e) => e.code === 'FORBIDDEN' && /access to this proxy/.test(e.message));
  // By profile: main fires the stored link; nothing about it comes back.
  const r = await rot.fns.rotateProxyIp({ id: 20, profileId: 104 });
  assert.deepEqual([r.ok, r.status, r.response], [true, 200, undefined], 'no vendor reply for a proxy outside the member\'s pool');
  assert.deepEqual(rot.fetched, [OWNER_LINK]);
  // A proxy of the profile's rotation pool is one it opens on, so it may rotate too.
  await rot.fns.rotateProxyIp({ id: 23, profileId: 110 });
  assert.equal(rot.fetched.at(-1), POOL_LINK);
  // Not a proxy that profile opens on, or a profile not shared with them: refused.
  await assert.rejects(rot.fns.rotateProxyIp({ id: 21, profileId: 104 }), (e) => e.code === 'FORBIDDEN');
  await assert.rejects(rot.fns.rotateProxyIp({ id: 20, profileId: 111 }), /You do not have access to this profile\./);
  // A new link can be saved only on the member's own pool's proxy.
  await assert.rejects(rot.fns.rotateProxyIp({ id: 20, profileId: 104, rotationUrl: 'https://evil.example/' }), /only be saved on a proxy of your own Proxy pool/);
  assert.equal((await db.proxy.findUnique({ where: { id: 20 } })).rotationUrl, OWNER_LINK);
  // canRotate: a proxy without a link cannot rotate, by profile either.
  await assert.rejects(rot.fns.rotateProxyIp({ id: 24, profileId: 112 }), /No IP rotation link is configured for this proxy\./);
  // profiles.launch and proxies.manage are both needed.
  rot.ws.as(3, revoked('profiles.launch'));
  await assert.rejects(rot.fns.rotateProxyIp({ id: 20, profileId: 104 }), /turned off for your account/);
  rot.ws.as(3, revoked('proxies.manage'));
  await assert.rejects(rot.fns.rotateProxyIp({ id: 20, profileId: 104 }), /turned off for your account/);
  assert.equal(rot.fetched.length, 2, 'nothing else was fetched');
  // The member's own pool is unchanged: X rotates their own proxy by id. The vendor's reply goes only
  // to a member who may see the link (an Operator has no proxies.reveal; the Owner does).
  rot.ws.as(3);
  assert.equal((await rot.fns.rotateProxyIp({ id: 22 })).response, undefined);
  rot.ws.as(1);
  assert.match((await rot.fns.rotateProxyIp({ id: 20 })).response, /new ip 9\.9\.9\.9/);
});

test('4: Rotate IP on a profile row is logged in its activity and returns the proxy masked as the profile list shows it', async () => {
  const db = seed();
  const rot = loadRotation(db);
  rot.ws.as(3);
  const r = await rot.fns.rotateProfileProxyIp({ id: 104 });
  assert.deepEqual([r.ok, r.status], [true, 200]);
  assert.deepEqual(rot.fetched, [OWNER_LINK]);
  assert.deepEqual([r.proxy.name, r.proxy.host, r.proxy.username, r.proxy.password, r.proxy.rotationUrl, r.proxy.canRotate],
    ['owner-gw', 'gw.owner.net', SECRET_MASK, SECRET_MASK, null, true], 'outside their pool: no username, password or link (#66)');
  assert.doesNotMatch(JSON.stringify(r), /OWNERKEY|owneruser|ownerpass/);
  assert.deepEqual(rot.activity, [{ profileId: 104, action: 'proxy-rotate', detail: 'new IP from proxy owner-gw', memberId: 3 }]);
  // Their own profile on their own proxy: masked as their Proxy pool shows it without proxies.reveal (#67).
  const own = await rot.fns.rotateProfileProxyIp({ id: 120 });
  assert.deepEqual([own.proxy.username, own.proxy.rotationUrl, own.proxy.canRotate], [SECRET_MASK, SECRET_MASK, true]);
  // The Owner sees their own proxy in full.
  rot.ws.as(1);
  const mine = await rot.fns.rotateProfileProxyIp({ id: 104 });
  assert.deepEqual([mine.proxy.username, mine.proxy.rotationUrl], ['owneruser', OWNER_LINK]);
  // A refusal by the vendor is logged as one.
  const refusing = loadRotation(db);
  refusing.ws.as(3);
  const axiosRefuse = { get: async () => ({ status: 429, data: 'slow down' }) };
  const { rotateProfileProxyIp } = loadMain([...VALIDATORS, 'requirePermission', 'canRevealProxyCredentials', 'assertCanAccessProxy', 'assertCanAccessProfile',
    'profileLaunchProxyIds', 'assertCanRotateProxy', 'isDataImpulseSticky', 'apiRotationProvider', 'proxyCanRotate', 'rotateProxyIp', 'rotationLinkTimeoutMs', 'serializeProxy', 'deriveProvider', 'launchedProxyView', 'rotateProfileProxyIp'], {
    ...refusing.ws.deps, rbacPolicy, redactForeignProxy, SECRET_MASK, readSetting: async (_k, d) => d,
    rotateDataImpulseSticky: async () => { throw new Error('not used'); }, PROVIDER_ROTATORS: { dataimpulse: async () => { throw new Error('not used'); } }, ROTATION_LINK_TIMEOUT_MS: {}, assertPublicHttpUrl: async () => {}, assertPublicHttpUrlSync: () => {}, publicOnlyLookup: () => {},
    logActivity: async (_db, profileId, action, detail) => { refusing.activity.push({ profileId, action, detail }); },
    require: (m) => (m === 'axios' ? axiosRefuse : require(m))
  });
  const no = await rotateProfileProxyIp({ id: 104 });
  assert.deepEqual([no.ok, no.status], [false, 429]);
  assert.deepEqual(refusing.activity, [{ profileId: 104, action: 'proxy-rotate', detail: 'new IP refused by proxy owner-gw (HTTP 429)' }]);
  // Not for a profile they cannot use, or one without a proxy.
  rot.ws.as(3);
  await assert.rejects(rot.fns.rotateProfileProxyIp({ id: 111 }), /You do not have access to this profile\./);
  await db.profile.update({ where: { id: 104 }, data: { proxyId: null } });
  await assert.rejects(rot.fns.rotateProfileProxyIp({ id: 104 }), /This profile has no proxy to rotate\./);
});

test('4: the automatic block response rotates the proxy of a "use only" profile for its member, within the switch budget', async () => {
  const blockDetect = require('../src/main/blockDetect');
  const load = (db) => {
    const rot = loadRotation(db);
    const retried = [];
    const swapped = [];
    const fns = loadMain(['respondToBlock'], {
      getGlobalSettings: async () => ({ browser: {} }),
      authGate: { decide: () => null }, ipcAuthState: async () => ({}), CHANNELS: { PROFILE_LAUNCH: 'profile:launch' },
      blockDetect: { ...blockDetect, ROTATE_SETTLE_MS: 0 }, blockSwitchTimes: new Map(),
      profileDrivenByAutomation: () => false, profileUsesRotationPool: async () => false,
      isDataImpulseSticky: () => false,
      proxyCanRotate: (p) => Boolean(p) && Boolean(p.rotationUrl),
      rotateProxyIp: rot.fns.rotateProxyIp,
      sleepMs: async () => {}, retryBlockedPage: async (sid, url) => { retried.push([sid, url]); },
      swapProxyAfterBlock: async () => { swapped.push(true); return null; }
    });
    return { ...rot, ...fns, retried, swapped };
  };
  const db = seed();
  const blk = load(db);
  blk.ws.as(3); // X launched the shared profile and is signed in to the window
  const profile = await db.profile.findUnique({ where: { id: 104 } });
  const proxy = await db.proxy.findUnique({ where: { id: 20 } });
  const evt = { profileId: 104, proxyId: 20, sessionId: '104', url: 'https://shop.example/item', kind: 'cloudflare' };
  assert.deepEqual(await blk.respondToBlock(evt, profile, proxy), { action: 'rotated' });
  assert.deepEqual(blk.fetched, [OWNER_LINK]);
  assert.deepEqual(blk.retried, [['104', 'https://shop.example/item']]);
  assert.deepEqual(blk.swapped, [], 'no swap needed');
  // The loop guard still applies: at most SWITCH_LIMIT automatic changes per window.
  for (let i = 1; i < blockDetect.SWITCH_LIMIT; i++) await blk.respondToBlock(evt, profile, proxy);
  assert.deepEqual(await blk.respondToBlock(evt, profile, proxy), { action: 'none', reason: 'limit' });
  // Without profiles.launch the rotation is refused (and a "use only" share cannot be swapped either).
  const off = load(seed());
  off.ws.as(3, revoked('profiles.launch'));
  const res = await off.respondToBlock(evt, profile, proxy);
  assert.equal(res.action, 'none');
  assert.deepEqual(off.fetched, []);
});

test('4: the Profiles page offers Rotate IP where the profile\'s proxy can rotate, "use only" rows included; main serves it under Profiles', () => {
  const page = read('src', 'renderer', 'pages', 'ProfilesPage.jsx');
  const btn = page.slice(page.indexOf('{p.proxy && p.proxy.canRotate && ('), page.indexOf('</GuardedButton>', page.indexOf('{p.proxy && p.proxy.canRotate && (')));
  assert.match(btn, /deny=\{perm\.deny\('proxies\.manage'\) \|\| perm\.deny\('profiles\.launch'\)\}/);
  assert.doesNotMatch(btn, /denyRow/, 'not refused for a "use only" share');
  assert.match(btn, /onClick=\{\(\) => handleRotateIp\(p\)\}/);
  assert.match(btn, /aria-label=\{t\('row\.rotateIp'\)\}/);
  assert.match(extractFunction(page, 'handleRotateIp'), /await softglazeApi\.profiles\.rotateIp\(p\.id\)/);
  assert.match(read('src', 'preload', 'preload.js'), /rotateIp: \(id\) => invoke\(CHANNELS\.PROFILE_ROTATE_IP, \{ id \}\)/);
  assert.match(read('src', 'renderer', 'lib', 'softglazeApi.js'), /rotateIp: \(id\) => getSoftglazeApi\(\)\.profiles\.rotateIp\(id\)/);
  assert.match(IPC, /registerHandler\(CHANNELS\.PROFILE_ROTATE_IP, rotateProfileProxyIp\);/);
  assert.equal(featureGate.featureForChannel('profile:rotate-ip'), 'profiles', 'hidden with the Profiles page');
  assert.equal(featureGate.featureForChannel('proxy:rotate-ip'), 'proxies', 'the Proxy pool\'s stays under Proxies');
  for (const lang of ['en', 'es']) {
    const row = JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, 'profiles.json')).row;
    for (const k of ['rotateIp', 'rotateIpTitle', 'rotateIpDone', 'rotateIpRefused']) assert.ok(row[k], `${lang} row.${k}`);
  }
});

// ==== 5. AI and Local API tokens: the serializers follow the token's member ====

test('5: while an AI or Local API token acts, serializeProxy and the profile list follow the token\'s member\'s proxies.reveal, not the window\'s', async () => {
  const db = seed();
  const load = (windowMemberId) => loadMain(['actingMemberId', 'proxyRevealAllowed', 'getActiveMember', 'serializeProxy', 'deriveProvider', 'isDataImpulseSticky', 'apiRotationProvider', 'proxyCanRotate',
    'serializeProfile'], {
    aiActor, permissions, rbacPolicy, profileOptions, redactProfileRow, redactPlatformAccounts,
    getPrisma: () => db, currentMemberId: windowMemberId, currentMemberCanRevealProxy: true
  }, ['actorCanRevealProxy']);
  const row = await db.proxy.findUnique({ where: { id: 22 } }); // X's proxy, with a link that holds a key
  const profileRow = await db.profile.findUnique({ where: { id: 120 }, include: { proxy: true } });

  // The Owner is signed in to the window (reveal); an Operator's token acts.
  const w = load(1);
  await w.getActiveMember();
  assert.equal(w.serializeProxy(row).rotationUrl, X_LINK, 'the window\'s own calls: the Owner\'s reveal');
  const viaToken = await aiActor.run({ memberId: 3, tokenId: 1, tokenName: 't', via: 'api' }, async () => {
    await w.getActiveMember(); // every tool checks a permission first
    return { proxy: w.serializeProxy(row), profile: w.serializeProfile(profileRow) };
  });
  assert.deepEqual([viaToken.proxy.username, viaToken.proxy.rotationUrl], [SECRET_MASK, SECRET_MASK]);
  assert.equal(viaToken.profile.proxyInfoString, `gw.x.net:7300:${SECRET_MASK}:${SECRET_MASK}`);
  assert.doesNotMatch(JSON.stringify(viaToken), /XKEY|xuser|xpass/);
  assert.equal(w.serializeProxy(row).rotationUrl, X_LINK, 'the window\'s flag was left alone');

  // The reverse: an Operator in the window, an Admin's token (reveal).
  const o = load(3);
  await o.getActiveMember();
  assert.equal(o.serializeProxy(row).rotationUrl, SECRET_MASK);
  const adminToken = await aiActor.run({ memberId: 2, tokenId: 2, tokenName: 'a', via: 'ai' }, async () => { await o.getActiveMember(); return o.serializeProxy(row); });
  assert.deepEqual([adminToken.username, adminToken.rotationUrl], ['xuser', X_LINK]);
  // A token whose member was not read yet gets no reveal (fails closed), and neither does a token whose
  // member had proxies.reveal turned off.
  assert.equal(await aiActor.run({ memberId: 2, tokenId: 3, via: 'ai' }, async () => o.serializeProxy(row).rotationUrl), SECRET_MASK);
  await db.member.update({ where: { id: 2 }, data: { permissionsJson: JSON.stringify({ actions: { 'proxies.reveal': false } }) } });
  assert.equal(await aiActor.run({ memberId: 2, tokenId: 4, via: 'ai' }, async () => { await o.getActiveMember(); return o.serializeProxy(row).rotationUrl; }), SECRET_MASK);
  // Single-user mode through a token: the owner's reveal.
  const single = load(null);
  assert.equal(await aiActor.run({ memberId: null, tokenId: 5, via: 'api' }, async () => { await single.getActiveMember(); return single.serializeProxy(row).rotationUrl; }), X_LINK);
  // Every synchronous reader of the flag goes through the acting identity.
  for (const fn of ['serializeProxy', 'serializeProfile', 'withViewerEditFlags', 'gatherExport']) {
    const body = extractFunction(IPC, fn);
    assert.match(body, /proxyRevealAllowed\(\)/, fn);
    assert.doesNotMatch(body, /currentMemberCanRevealProxy/, fn);
  }
});
