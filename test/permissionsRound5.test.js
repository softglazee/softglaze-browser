'use strict';
// 1.0.26 permission round 5 (the four gaps PR #66 listed as "found, not fixed", plus two fixes from the
// tutorial dry run):
//  1. A proxy's rotation link (it often carries the vendor's API key) is treated like its password:
//     only members with proxies.reveal receive it; everyone else gets a mask, and rotating stays by id.
//  2. Proxy usernames are masked without proxies.reveal on profiles the member can edit too (address,
//     editor, export); a masked username saved back keeps the stored one, and hidden credentials stay
//     with their host.
//  3. The Firefox autofill bridge knows which Firefox profile asks (one port per profile), so autofill
//     follows the member who launched that profile; the fail-closed rule is gone.
//  4. The first-run wizard has one "done" flag per member; steps a role cannot do are skipped.
//  A. The CAPTCHA score and the Leak check agree about WebRTC "Real" with no proxy.
//  B. Quick generate's preview names are the names main creates.
// Main-process functions run for real from ipcHandlers.js with the real permissions module and an
// in-memory database stand-in (test/helpers/fakePrisma.js), as in test/permissionsRound4.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const permissions = require('../src/main/permissions');
const rbacPolicy = require('../src/main/rbacPolicy');
const featureGate = require('../src/main/featureGate');
const profileOptions = require('../src/main/profileOptions');
const profileRedaction = require('../src/main/profileRedaction');
const { SECRET_MASK, redactProfileRow, redactPlatformAccounts, redactUseOnlyProxy, restoreMaskedSecrets } = profileRedaction;
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
// lastActiveAt: who has signed in before (item 4). Operator Y (4) never has.

const MEMBERS = [
  { id: 1, name: 'Owner', role: 'OWNER', parentMemberId: null, status: 'active', createdAt: new Date('2026-01-01T00:00:00Z'), lastActiveAt: new Date('2026-11-01T00:00:00Z') },
  { id: 2, name: 'Admin', role: 'ADMIN', parentMemberId: 1, status: 'active', createdAt: new Date('2026-02-01T00:00:00Z'), lastActiveAt: new Date('2026-10-01T00:00:00Z') },
  { id: 3, name: 'Operator X', role: 'OPERATOR', parentMemberId: 2, status: 'active', createdAt: new Date('2026-03-01T00:00:00Z'), lastActiveAt: new Date('2026-09-01T00:00:00Z') },
  { id: 4, name: 'Operator Y', role: 'OPERATOR', parentMemberId: 2, status: 'active', createdAt: new Date('2026-03-02T00:00:00Z'), lastActiveAt: null },
  { id: 5, name: 'Manager', role: 'MANAGER', parentMemberId: 2, status: 'active', createdAt: new Date('2026-04-01T00:00:00Z'), lastActiveAt: new Date('2026-10-15T00:00:00Z') }
];
const X_KEY_LINK = 'https://rotate.example/api?key=XSECRETKEY';

function seed() {
  return createFakePrisma({
    member: MEMBERS.map((m) => ({ ...m })),
    proxy: [
      // Operator X's own proxy, with a vendor rotation link that holds the account's key.
      { id: 22, name: 'x-gw', type: 'HTTP', host: 'gw.x.net', port: 7100, username: 'xuser', password: 'xpass', rotationUrl: X_KEY_LINK, ownerMemberId: 3 }
    ],
    profile: [
      // X's own profile on that proxy (editable), and one with a proxy address saved without a pool proxy.
      { id: 108, title: 'x-own', dataDirName: 'x-own', ownerMemberId: 3, assignedMemberId: 3, browserCore: 'Chromium', deletedAt: null,
        proxyId: 22, proxyInfoString: 'gw.x.net:7100:xuser:xpass', systemProxyBehavior: 'PROFILE_PROXY' },
      { id: 109, title: 'x-bare', dataDirName: 'x-bare', ownerMemberId: 3, assignedMemberId: 3, browserCore: 'Chromium', deletedAt: null,
        proxyId: null, proxyInfoString: 'bare.x.net:9100:bareuser:barepass', systemProxyBehavior: 'PROFILE_PROXY' }
    ]
  });
}

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
    scopedProfileWhere: async (base) => {
      const m = state.member;
      if (!m || m.role === 'SUPER_ADMIN') return base;
      const visible = permissions.visibleMemberIds(await db.member.findMany(), m);
      const ids = (await db.profile.findMany()).filter((r) => permissions.profileRowAccessible(visible, r, false)).map((r) => r.id);
      return { AND: [base || {}, { id: { in: ids } }] };
    }
  };
  const as = (who, patch) => {
    if (who == null) state.member = null;
    else if (who === 'super') state.member = { ...permissions.SUPER_ADMIN };
    else state.member = { ...MEMBERS.find((m) => m.id === who), ...(patch || {}) };
    return state.member;
  };
  return { state, deps, as };
}
const revoked = (action) => ({ permissionsJson: JSON.stringify({ actions: { [action]: false } }) });
const hidden = (feature) => ({ permissionsJson: JSON.stringify({ features: { [feature]: false } }) });

// The profile list as main builds it, with main's per-window reveal flag passed in (proxies.reveal:
// Manager and up, unless turned off for the member).
function loadList({ reveal }) {
  const db = seed();
  const ws = workspace(db);
  const fns = loadMain([...VALIDATORS, 'serializeProxy', 'deriveProvider', 'isDataImpulseSticky', 'apiRotationProvider', 'proxyCanRotate', 'serializeProfile',
    'withViewerEditFlags', 'proxyInVisiblePool', 'searchMatchesView', 'listProfiles'], {
    ...ws.deps, rbacPolicy, profileOptions, redactProfileRow, redactPlatformAccounts, redactUseOnlyProxy,
    currentMemberCanRevealProxy: reveal, proxyRevealAllowed: () => reveal
  });
  return { db, ws, fns, rows: async (search) => Object.fromEntries((await fns.listProfiles(search ? { search } : {})).map((r) => [r.id, r])) };
}

// ==== 1. Rotation links ====

test('1: the Proxy pool sends a rotation link only with proxies.reveal; everyone else gets a mask and can still rotate', async () => {
  const db = seed();
  const row = await db.proxy.findUnique({ where: { id: 22 } });
  const load = (reveal) => loadMain(['serializeProxy', 'deriveProvider', 'isDataImpulseSticky', 'apiRotationProvider', 'proxyCanRotate'], { rbacPolicy, currentMemberCanRevealProxy: reveal, proxyRevealAllowed: () => reveal });
  const op = load(false).serializeProxy(row); // an Operator (or a Manager with proxies.reveal turned off)
  assert.equal(op.rotationUrl, SECRET_MASK);
  assert.deepEqual([op.hasRotationUrl, op.canRotate], [true, true], 'the Rotate IP button still shows');
  assert.doesNotMatch(JSON.stringify(op), /XSECRETKEY|xuser|xpass/);
  assert.equal(load(true).serializeProxy(row).rotationUrl, X_KEY_LINK, 'with proxies.reveal: unchanged');
  assert.equal(load(false).serializeProxy({ ...row, rotationUrl: null }).rotationUrl, null, 'no link: nothing to mask');
  // The same rule covers every serializer built on it: the pool list, the rotation dialog's list, vendor
  // pulls, a created or updated proxy, and the proxy object of every profile row.
  for (const fn of ['listProxies', 'getProxyRotation', 'createProxy', 'updateProxy', 'serializeProfile']) {
    assert.match(extractFunction(IPC, fn), /serializeProxy/, fn);
  }
  // rbacPolicy blanks the link with the credentials, for any caller of the Operator redaction.
  const red = rbacPolicy.redactForRole('OPERATOR', 'proxyCredentials', { host: 'h', username: 'u', password: 'p', rotationUrl: X_KEY_LINK });
  assert.equal(red.rotationUrl, '••••••••');
  assert.equal(rbacPolicy.redactForRole('MANAGER', 'proxyCredentials', { rotationUrl: X_KEY_LINK }).rotationUrl, X_KEY_LINK);
});

test('1: rotating fires the stored link by proxy id; a mask sent back is never stored or fetched', async () => {
  const db = seed();
  const fetched = [];
  const axios = { get: async (url) => { fetched.push(url); return { status: 200, data: 'new ip 9.9.9.9' }; } };
  const { rotateProxyIp } = loadMain([...VALIDATORS, 'isDataImpulseSticky', 'apiRotationProvider', 'proxyCanRotate', 'assertCanRotateProxy', 'rotateProxyIp', 'rotationLinkTimeoutMs'], {
    getPrisma: () => db,
    requirePermission: async () => {},
    assertCanAccessProxy: async () => {},
    canRevealProxyCredentials: async () => true,
    rotateDataImpulseSticky: async () => { throw new Error('not used'); }, PROVIDER_ROTATORS: { dataimpulse: async () => { throw new Error('not used'); } }, ROTATION_LINK_TIMEOUT_MS: {},
    assertPublicHttpUrl: async () => {},
    assertPublicHttpUrlSync: () => {},
    publicOnlyLookup: () => {},
    SECRET_MASK,
    require: (m) => (m === 'axios' ? axios : require(m))
  });
  const r = await rotateProxyIp({ id: 22, rotationUrl: SECRET_MASK }); // a window that echoes what it was sent
  assert.equal(r.ok, true);
  assert.deepEqual(fetched, [X_KEY_LINK], 'main fetched the stored link');
  assert.equal((await db.proxy.findUnique({ where: { id: 22 } })).rotationUrl, X_KEY_LINK, 'the stored link is untouched');
  await rotateProxyIp({ id: 22 });
  assert.equal(fetched[1], X_KEY_LINK);
  // Every caller rotates by id: the Proxy pool page, the automatic block response, SoftGlaze AI and the
  // Local API (which runs the AI tools); none hands a link from the window.
  assert.match(read('src', 'renderer', 'pages', 'ProxyPoolPage.jsx'), /softglazeApi\.proxies\.rotateIp\(\{ id: proxy\.id \}\)/);
  assert.match(extractFunction(IPC, 'respondToBlock'), /await rotateProxyIp\(\{ id: proxy\.id, profileId: id \}\)/);
  assert.match(IPC, /rotateProxyIp: \(payload\) => rotateProxyIp\(\{ id: payload\.id \}\), \/\/ the stored rotation link only/);
  const tools = read('src', 'main', 'ai', 'tools.js');
  assert.match(tools, /ctx\.deps\.rotateProxyIp\(\{ id: a\.proxyId \}\)/);
  assert.doesNotMatch(extractFunction(tools, 'compactProxy'), /rotationUrl:/, 'AI and Local API views carry no link');
  assert.doesNotMatch(read('src', 'main', 'localApi.js'), /rotationUrl/);
});

test('1: the spreadsheet export blanks the rotation link and proxy username without proxies.reveal, editable rows included', async () => {
  const db = seed();
  const ws = workspace(db);
  const load = (reveal) => loadMain(['assertCanRevealKind', 'firstAccount', 'proxyInVisiblePool', 'gatherExport'], {
    ...ws.deps, rbacPolicy, currentMemberCanRevealProxy: reveal, proxyRevealAllowed: () => reveal,
    readSetting: async (k, d) => (k === 'profileRotationUrls' ? { 108: 'https://rotate.example/108?key=K108' } : d),
    doNotTrackChoice: require('../src/main/doNotTrack').doNotTrackChoice
  }, ['REVEAL_LABELS', 'EXPORT_COLUMNS']);
  ws.as(3); // Operator X, on their own (editable) profile
  const out = await load(false).gatherExport();
  const col = (name) => out.headers.indexOf(name);
  const row = out.rows.find((r) => r[col('Profile Title')] === 'x-own');
  assert.deepEqual(['Proxy Info', 'Proxy Username', 'Proxy Password', 'Proxy Rotation URL', 'Proxy Host'].map((c) => row[col(c)]),
    ['gw.x.net:7100::', '', '', '', 'gw.x.net']);
  ws.as(2); // the Admin (proxies.reveal) exporting the same profile: unchanged
  const adm = await load(true).gatherExport();
  const arow = adm.rows.find((r) => r[col('Profile Title')] === 'x-own');
  assert.deepEqual(['Proxy Username', 'Proxy Password', 'Proxy Rotation URL'].map((c) => arow[col(c)]), ['xuser', 'xpass', 'https://rotate.example/108?key=K108']);
});

test('1/2: a profile archive (.sgz) carries the proxy address only as the profile list shows it', async () => {
  const db = seed();
  let config = null;
  const run = (reveal) => loadMain([...VALIDATORS, 'exportProfileArchive'], {
    getPrisma: () => db, path,
    requirePermission: async () => {}, assertCanAccessProfile: async () => {}, assertCanRevealKind: async () => {},
    getRuntimeConfig: () => ({ profileRoot: 'C:/profiles' }),
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: 'C:/out/x.sgz' }) },
    profileArchive: { exportProfileArchive: async (o) => { config = o.config; return { plainBytes: 1 }; } },
    logAudit: async () => {},
    canRevealProxyCredentials: async () => reveal,
    maskProxyInfoString: profileRedaction.maskProxyInfoString
  }).exportProfileArchive({ id: 109, password: 'pw' });
  await run(false); // a Manager or Admin whose proxies.reveal was turned off
  assert.equal(config.profile.proxyInfoString, `bare.x.net:9100:${SECRET_MASK}:${SECRET_MASK}`);
  await run(true);
  assert.equal(config.profile.proxyInfoString, 'bare.x.net:9100:bareuser:barepass');
});

// ==== 2. Proxy usernames on editable profiles ====

test('2: without proxies.reveal the profile\'s proxy address and linked proxy mask the username on editable profiles too', async () => {
  const op = loadList({ reveal: false });
  op.ws.as(3);
  const r = await op.rows();
  assert.equal(r[108].canEdit, true);
  assert.equal(r[108].proxyInfoString, `gw.x.net:7100:${SECRET_MASK}:${SECRET_MASK}`, 'what the editor and Compare read');
  assert.deepEqual([r[108].proxy.username, r[108].proxy.password, r[108].proxy.rotationUrl, r[108].proxy.host], [SECRET_MASK, SECRET_MASK, SECRET_MASK, 'gw.x.net']);
  assert.equal(r[109].proxyInfoString, `bare.x.net:9100:${SECRET_MASK}:${SECRET_MASK}`);
  assert.doesNotMatch(JSON.stringify(Object.values(r)), /xuser|xpass|bareuser|barepass|XSECRETKEY/);
  // A search finds a profile only by what the member is shown (round 4's rule), now usernames too.
  assert.deepEqual(Object.keys(await op.rows('xuser')).map(Number), []);
  assert.deepEqual(Object.keys(await op.rows('gw.x.net')).map(Number), [108]);
  // With proxies.reveal (the Admin over X's profiles): unchanged.
  const adm = loadList({ reveal: true });
  adm.ws.as(2);
  const a = await adm.rows();
  assert.equal(a[108].proxyInfoString, 'gw.x.net:7100:xuser:xpass');
  assert.equal(a[108].proxy.username, 'xuser');
});

test('2: the editor saves a masked username back as the stored one, and a typed username replaces it', () => {
  const existing = { id: 108, proxy: { host: 'gw.x.net', port: 7100, username: 'xuser', password: 'xpass' }, proxyInfoString: 'gw.x.net:7100:xuser:xpass' };
  const save = (raw) => restoreMaskedSecrets({ proxyRaw: raw }, existing).proxyRaw;
  assert.equal(save(`gw.x.net:7100:${SECRET_MASK}:${SECRET_MASK}`), 'gw.x.net:7100:xuser:xpass', 'untouched: the stored username and password');
  assert.equal(save(`gw.x.net:7100:newuser:${SECRET_MASK}`), 'gw.x.net:7100:newuser:xpass', 'a typed username replaces the stored one');
  assert.equal(save(`gw.x.net:7100:${SECRET_MASK}:newpass`), 'gw.x.net:7100:xuser:newpass', 'a typed password replaces the stored one');
  assert.equal(save(`gw.x.net:7200:${SECRET_MASK}:${SECRET_MASK}`), 'gw.x.net:7200:xuser:xpass', 'another port on the same host keeps them');
  assert.equal(save(`GW.X.NET:7100:${SECRET_MASK}:${SECRET_MASK}`), 'GW.X.NET:7100:xuser:xpass', 'host names compare without case');
  assert.equal(save('gw.x.net:7100:typed:typedpass'), 'gw.x.net:7100:typed:typedpass', 'nothing masked: as typed');
  // A proxy address saved without a pool proxy is read from the stored string.
  const bare = { id: 109, proxy: null, proxyInfoString: 'bare.x.net:9100:bareuser:barepass' };
  assert.equal(restoreMaskedSecrets({ proxyRaw: `bare.x.net:9100:${SECRET_MASK}:${SECRET_MASK}` }, bare).proxyRaw, 'bare.x.net:9100:bareuser:barepass');
  // Hidden values stay with their host: moving them to another server is refused.
  assert.throws(() => save(`evil.example:7100:${SECRET_MASK}:${SECRET_MASK}`), (e) => e.code === 'FORBIDDEN' && /type the username and password again/.test(e.message));
  assert.throws(() => save(`evil.example:7100:newuser:${SECRET_MASK}`), /hidden for your account/);
  assert.equal(save('evil.example:7100:newuser:newpass'), 'evil.example:7100:newuser:newpass', 'retyped: allowed');
  // A new profile (nothing stored): masks become empty, never dots, as before.
  assert.equal(restoreMaskedSecrets({ proxyRaw: `h:1:${SECRET_MASK}:${SECRET_MASK}` }, null).proxyRaw, 'h:1::');
  assert.equal(restoreMaskedSecrets({ proxyRaw: `h:1:u:${SECRET_MASK}` }, null).proxyRaw, 'h:1:u:');
});

test('2: "Check network" in the editor puts masked fields back from the profile being edited', async () => {
  const db = seed();
  const seen = [];
  const checked = [];
  const { checkProxy } = loadMain([...VALIDATORS, 'proxyTypeHintFor', 'unmaskedEditorProxyRaw', 'checkProxy'], {
    ...profileRedaction,
    getPrisma: () => db,
    VALID_PROXY_TYPES: new Set(['HTTP', 'HTTPS', 'SOCKS5', 'SOCKS4']),
    parseProxyType: (v) => String(v).toUpperCase(),
    assertCanAccessProxy: async () => {},
    assertCanAccessProfile: async (id, opts) => { checked.push([id, opts]); },
    parseProxyInput: (raw) => { const [host, port, username, password] = String(raw).split(':'); return { type: 'HTTP', host, port: Number(port), username, password }; },
    testProxyConnectivity: async (p) => { seen.push(p); return { success: true }; },
    persistProxyHealth: async () => {}
  });
  await checkProxy({ raw: `gw.x.net:7100:${SECRET_MASK}:${SECRET_MASK}`, type: 'HTTP', profileId: 108 });
  assert.deepEqual([seen[0].username, seen[0].password], ['xuser', 'xpass']);
  assert.deepEqual(checked, [[108, { requireEdit: true }]], 'edit access to that profile is required');
  await checkProxy({ raw: `gw.x.net:7100:${SECRET_MASK}:${SECRET_MASK}`, type: 'HTTP' });
  assert.deepEqual([seen[1].username, seen[1].password], ['', ''], 'no profile: masks become empty, never dots');
  await assert.rejects(checkProxy({ raw: `evil.example:80:${SECRET_MASK}:${SECRET_MASK}`, profileId: 108 }), /hidden for your account/);
  assert.match(read('src', 'renderer', 'pages', 'ProfilesPage.jsx'), /raw: constructProxyString\(\), \.\.\.\(pd\.id \? \{ profileId: pd\.id \} : \{\}\)/);
});

test('2: the Proxy pool\'s edit dialog keeps a masked username, and hidden credentials stay with their host', async () => {
  const load = (reveal) => {
    const db = seed();
    const fns = loadMain([...VALIDATORS, 'assertHiddenCredentialsStayWithHost', 'updateProxy'], {
      getPrisma: () => db, SECRET_MASK,
      requirePermission: async () => {}, assertCanAccessProxy: async () => {},
      parseProxyType: (v) => String(v).toUpperCase(), parsePort: (v) => Number(v),
      canRevealProxyCredentials: async () => reveal,
      serializeProxy: (p) => p
    });
    return { db, fns };
  };
  const { db, fns } = load(false); // Operator X: the dialog shows the username as a mask and sends it back
  await fns.updateProxy({ id: 22, name: 'renamed', host: 'gw.x.net', port: 7100, username: SECRET_MASK });
  const after = await db.proxy.findUnique({ where: { id: 22 } });
  assert.deepEqual([after.name, after.username, after.password], ['renamed', 'xuser', 'xpass']);
  await assert.rejects(fns.updateProxy({ id: 22, host: 'evil.example', port: 7100, username: SECRET_MASK }), /hidden for your account/);
  await assert.rejects(fns.updateProxy({ id: 22, host: 'evil.example', port: 7100, username: 'mine' }), /hidden for your account/, 'the password would still go along');
  await fns.updateProxy({ id: 22, host: 'new.example', port: 7100, username: 'mine', password: 'minepw' });
  assert.equal((await db.proxy.findUnique({ where: { id: 22 } })).host, 'new.example', 'both retyped: allowed');
  const adm = load(true); // with proxies.reveal (the Owner, an Admin, a Manager): no host rule
  await adm.fns.updateProxy({ id: 22, host: 'moved.example', port: 7100, username: SECRET_MASK });
  assert.deepEqual(['host', 'username', 'password'].map((k) => adm.db._tables.proxy[0][k]), ['moved.example', 'xuser', 'xpass']);
});

// ==== 3. Firefox autofill per profile ====

const bridge = require('../src/main/autofillBridge');

function bridgeGet(port, p) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: p, headers: { 'X-SG-Autofill-Token': bridge.TOKEN } },
      (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    req.on('error', () => resolve({ status: 0 }));
    req.end();
  });
}

test('3: each Firefox profile gets its own bridge port, and a call is checked for the session that owns the port', async () => {
  const asked = [];
  bridge.configure({
    listForUrl: async () => ({ personas: [{ id: 'p1' }] }),
    isAvailable: async (ctx) => { asked.push(ctx && ctx.sessionId); return ctx && ctx.sessionId === '201'; }
  });
  const a = await bridge.acquire('201'); // launched by a member who may use the vault
  const b = await bridge.acquire('202'); // launched by one who may not
  try {
    assert.ok(a.port && b.port && a.port !== b.port, 'two ports');
    assert.ok(bridge.PORT_RANGE.includes(a.port) && bridge.PORT_RANGE.includes(b.port));
    assert.equal((await bridge.acquire('201')).port, a.port, 'the same session keeps its port');
    const url = '/sg-autofill/list?url=' + encodeURIComponent('https://shop.example/signup');
    assert.equal((await bridgeGet(a.port, url)).status, 200);
    assert.equal((await bridgeGet(b.port, url)).status, 423, 'the other profile gets nothing, while the first keeps it');
    assert.deepEqual(asked, ['201', '202']);
    await bridge.release('202');
    assert.equal((await bridgeGet(b.port, '/sg-autofill/ping')).status, 0, 'its port closes with it');
    assert.equal((await bridgeGet(a.port, '/sg-autofill/ping')).status, 200, 'the other stays open');
  } finally {
    await bridge.stop();
  }
});

test('3: a Firefox profile may reach only its own bridge port; one without autofill none of them', () => {
  const ff = require('../src/main/firefoxEngine');
  const banned = (js) => (/user_pref\("network\.security\.ports\.banned", "([0-9,]*)"\);/.exec(js) || [])[1];
  const own = banned(ff.buildUserJs({ autofill: true, autofillPort: 47803 }));
  assert.equal(own, '47800,47801,47802,47804,47805,47806,47807,47808,47809');
  assert.equal(banned(ff.buildUserJs({ autofill: false })), bridge.PORT_RANGE.join(','));
  assert.equal(banned(ff.buildUserJs({ autofill: true, autofillPort: null })), bridge.PORT_RANGE.join(','), 'no free port: no bridge for it');
  // The add-on's port list is the bridge's range (it is fixed by the Mozilla-signed .xpi).
  const bg = read('src', 'firefox-extension', 'sg-background.js');
  assert.match(bg, new RegExp(`var PORTS = \\[${bridge.PORT_RANGE.join(', ')}\\];`));
  // The engine takes a port for this profile's session before writing user.js, and gives it back on exit.
  const src = read('src', 'main', 'firefoxEngine.js');
  const launch = extractFunction(src, 'launchFirefoxProfileNow');
  assert.ok(launch.indexOf('autofillBridge.acquire(sessionId)') < launch.indexOf('buildUserJs({'));
  assert.match(launch, /autofillPort,\r?\n/);
  assert.match(launch, /autofillBridge\.release\(sessionId\)/);
});

test('3: the Firefox bridge asks the rule for that profile\'s launcher; the fail-closed rule is gone', () => {
  assert.doesNotMatch(IPC, /function firefoxAutofillAllowed\(/);
  assert.doesNotMatch(IPC, /firefoxAutofill:/);
  const reg = IPC.slice(IPC.indexOf('function registerIpcHandlers()'));
  const firefox = reg.slice(reg.indexOf('autofillBridge.configure({'));
  assert.match(firefox, /isAvailable: \(ctx\) => personaVaultAvailable\(\{ sessionId: ctx && ctx\.sessionId != null \? ctx\.sessionId : null \}\)/);
  assert.match(extractFunction(IPC, 'personaVaultAvailable'), /return sessionAutofillAllowed\(sessionId\);/);
  // No change to the add-on's files (it would need a new Mozilla signature).
  assert.equal(JSON.parse(read('src', 'firefox-extension', 'manifest.json')).version, '1.0.2');
});

// ==== 4. The first-run wizard, per member ====

function loadSettings({ stored = {}, onboarding } = {}) {
  const db = seed();
  const ws = workspace(db);
  const settings = new Map([['globalSettings', JSON.parse(JSON.stringify(stored))]]);
  if (onboarding) settings.set('memberOnboarding', onboarding);
  const state = { readFails: false };
  const fns = loadMain([...VALIDATORS, 'requirePermission', 'deepMergeSettings', 'getGlobalSettings', 'setGlobalSettings',
    'activeIsSuperAdmin', 'withoutSuperOnlyKeys', 'getGlobalSettingsForActor', 'changedGlobalSettingKeys',
    'assertCanWriteGlobalSettings', 'withoutWorkspaceSecrets', 'setGlobalSettingsForActor',
    'withMemberPageLists', 'pageListsOwnerKey', 'emptyPageLists', 'memberSinceStamp', 'copyJson', 'loadMemberPageLists',
    'ownPageListsIn', 'readOwnPageLists', 'writeOwnPageLists',
    'onboardingOwnerKey', 'withMemberOnboarding', 'loadMemberOnboarding', 'ensureMemberOnboardingStore', 'ownOnboardingDoneIn',
    'readOwnOnboardingDone', 'readOwnOnboardingDoneSafe', 'writeOwnOnboardingDone'], {
    ...ws.deps,
    readSetting: async (k, d) => (settings.has(k) ? JSON.parse(JSON.stringify(settings.get(k))) : d),
    readSettingStrict: async (k) => {
      if (state.readFails && k === 'memberOnboarding') throw new Error('SQLITE_BUSY');
      return settings.has(k) ? JSON.parse(JSON.stringify(settings.get(k))) : undefined;
    },
    writeSetting: async (k, v) => { settings.set(k, JSON.parse(JSON.stringify(v))); }
  }, ['GLOBAL_SETTINGS_DEFAULTS', 'SUPER_ONLY_GLOBAL_KEYS', 'GLOBAL_SETTING_WRITE_RULES', 'WORKSPACE_SETTING_RULE', 'SETTING_ROLE_PHRASE',
    'MEMBER_PAGE_LIST_KEYS', 'MEMBER_PAGE_LISTS_SETTING', 'memberPageListsLock', 'MEMBER_ONBOARDING_SETTING', 'memberOnboardingLock']);
  const done = async (who) => { ws.as(who); return (await fns.getGlobalSettingsForActor()).onboardingDone === true; };
  return { db, ws, fns, settings, state, done, shared: () => settings.get('globalSettings'), store: () => settings.get('memberOnboarding') };
}

test('4: at the update, members who signed in before are not shown the wizard, members who never did are', async () => {
  // The workspace flag was set (by whoever finished the wizard first): before 1.0.26 it hid it for all.
  const { fns, done, store, shared } = loadSettings({ stored: { onboardingDone: true } });
  await fns.ensureMemberOnboardingStore(); // first start of 1.0.26, before anyone signs in
  const s = store();
  assert.deepEqual(Object.fromEntries(Object.entries(s.members).map(([k, v]) => [k, v.done])), { 2: true, 3: true, 4: false, 5: true, [-1]: true });
  assert.equal(s.members['1'], undefined, 'the Owner keeps the workspace flag');
  assert.equal(s.members['4'].since, MEMBERS[3].createdAt.toISOString());
  assert.deepEqual([await done(1), await done(2), await done(3), await done(5), await done('super')], [true, true, true, true, true]);
  assert.equal(await done(4), false, 'Operator Y never signed in: they see it at their first sign-in');
  assert.equal(shared().onboardingDone, true, 'globalSettings is not changed');
});

test('4: the Owner finishing it no longer hides it for new members, and a member finishing it hides it only for them', async () => {
  const { db, ws, fns, done, shared } = loadSettings();
  await fns.ensureMemberOnboardingStore();
  assert.equal(await done(1), false, 'a fresh workspace: the Owner sees it');
  ws.as(1);
  await fns.setGlobalSettingsForActor({ onboardingDone: true });
  assert.equal(shared().onboardingDone, true, 'the Owner\'s flag is where it always was');
  assert.equal(await done(4), false, 'still shown to Operator Y');
  ws.as(4);
  const after = await fns.setGlobalSettingsForActor({ onboardingDone: true });
  assert.equal(after.onboardingDone, true);
  assert.equal(await done(4), true);
  // A member added after the update has their own, not done.
  await db.member.create({ data: { id: 6, name: 'New', role: 'MANAGER', parentMemberId: 2, status: 'active', createdAt: new Date('2026-11-09T00:00:00Z'), lastActiveAt: null } });
  MEMBERS.push({ id: 6, name: 'New', role: 'MANAGER', parentMemberId: 2, status: 'active', createdAt: new Date('2026-11-09T00:00:00Z'), lastActiveAt: null });
  try {
    assert.equal(await done(6), false);
    // And the other way round: with the workspace flag off, a member's finish does not hide it for the Owner.
    const fresh = loadSettings();
    await fresh.fns.ensureMemberOnboardingStore();
    fresh.ws.as(6);
    await fresh.fns.setGlobalSettingsForActor({ onboardingDone: true });
    assert.equal(fresh.shared().onboardingDone, undefined);
    assert.deepEqual([await fresh.done(6), await fresh.done(1), await fresh.done(4)], [true, false, false]);
  } finally {
    MEMBERS.pop();
  }
});

test('4: a reused id never inherits a flag; a store that cannot be read shows nobody the wizard', async () => {
  const onboarding = { version: 1, members: { 4: { since: '2025-01-01T00:00:00.000Z', done: true } } }; // left by a deleted member 4
  const { state, ws, fns, done } = loadSettings({ onboarding });
  assert.equal(await done(4), false);
  state.readFails = true;
  assert.equal(await done(4), true, 'a database hiccup never puts the wizard in front of anyone');
  ws.as(4);
  await assert.rejects(fns.setGlobalSettingsForActor({ onboardingDone: true }), /SQLITE_BUSY/, 'nor is a stored flag replaced');
  const other = await fns.setGlobalSettingsForActor({ profileFilters: [{ name: 'mine', filter: {} }] });
  assert.deepEqual([other.profileFilters.length, other.onboardingDone], [1, true], 'their other lists still save');
  ws.as(1);
  assert.equal((await fns.setGlobalSettingsForActor({ onboardingDone: true })).onboardingDone, true, 'the Owner\'s write is not held up');
});

test('4: the store is created at startup and before any sign-in records lastActiveAt', () => {
  for (const fn of ['memberLogin', 'acceptInvite', 'switchMember']) {
    const body = extractFunction(IPC, fn);
    const ensure = body.indexOf('await ensureMemberOnboardingStore()');
    assert.ok(ensure > 0 && ensure < body.indexOf('lastActiveAt: new Date()'), fn);
  }
  const reg = IPC.slice(IPC.indexOf('function registerIpcHandlers()'));
  assert.match(reg, /try \{ await ensureMemberOnboardingStore\(\); \} catch \(e\)/);
  assert.match(extractConst(IPC, 'GLOBAL_SETTING_WRITE_RULES'), /onboardingDone: Object\.freeze\(\{ anyMember: true \}\)/);
});

test('4: wizard steps a role cannot do are skipped, with the reason main would give', async () => {
  const { onboardingStepDenials, ONBOARDING_STEPS } = await importLib('memberPermissions.mjs');
  const me = (id, patch) => { const m = { ...MEMBERS.find((x) => x.id === id), ...(patch || {}) }; return { ...m, permissions: permissions.effectivePermissions(m) }; };
  assert.deepEqual(ONBOARDING_STEPS, ['smtp', 'proxy', 'profile']);
  assert.deepEqual(onboardingStepDenials(null), { smtp: null, proxy: null, profile: null }, 'single-user mode is the Owner');
  assert.deepEqual(onboardingStepDenials(me(1)), { smtp: null, proxy: null, profile: null });
  assert.deepEqual(onboardingStepDenials({ ...permissions.SUPER_ADMIN }), { smtp: null, proxy: null, profile: null });
  for (const id of [2, 5, 3]) {
    assert.deepEqual(onboardingStepDenials(me(id)), { smtp: { kind: 'role', role: 'OWNER' }, proxy: null, profile: null }, `member ${id}: SMTP is the Owner's (requireOwnerOrSuper)`);
  }
  assert.deepEqual(onboardingStepDenials(me(3, revoked('proxies.manage'))).proxy, { kind: 'revoked' });
  assert.deepEqual(onboardingStepDenials(me(3, hidden('profiles'))).profile, { kind: 'feature', feature: 'profiles' });
  assert.deepEqual(onboardingStepDenials(me(3, hidden('proxies'))).proxy, { kind: 'feature', feature: 'proxies' });
  assert.deepEqual(onboardingStepDenials(me(3, { status: 'suspended' })), { smtp: { kind: 'inactive' }, proxy: { kind: 'inactive' }, profile: { kind: 'inactive' } });
  // The wizard: denied steps are skipped and shown greyed out with the reason; the "existing workspace"
  // shortcut is the Owner's only; the reasons and new strings exist in English and Spanish.
  const W = read('src', 'renderer', 'components', 'OnboardingWizard.jsx');
  assert.match(W, /const order = ONBOARDING_STEPS\.filter\(\(k\) => !denied\[k\]\);/);
  assert.match(W, /if \(ONBOARDING_STEPS\.every\(\(k\) => d\[k\]\)\) \{ if \(live\) setPhase\('hidden'\); return; \}/);
  assert.match(W, /if \(me === null \|\| \(me && me\.role === 'OWNER'\)\) \{/);
  assert.match(W, /<li key=\{key\} className="flex items-center gap-2\.5 opacity-50" title=\{why\}>/);
  for (const lang of ['en', 'es']) {
    const common = JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, 'common.json'));
    assert.ok(common.perm.proxiesHidden && common.perm.profilesHidden, lang);
    const w = JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, 'cmpOverlays.json')).wizard;
    assert.ok(w.saveAndFinish && w.welcome.subtitleShort_one && w.welcome.subtitleShort_other && w.welcome.unavailable, lang);
  }
});

// ==== A. WebRTC "Real" with no proxy ====

test('A: WebRTC "Real" with no proxy is not called hidden, and the CAPTCHA score and the Leak check agree', () => {
  const { scoreProfile } = require('../src/main/captchaScore');
  const p = { id: 1, browserCore: 'Chromium', os: 'Windows', systemProxyBehavior: 'DIRECT', webrtc: 'Real', timezoneType: 'Based on IP', languageType: 'Based on IP', locationType: 'Based on IP', launchCount: 5 };
  const f = scoreProfile(p, { proxy: null, hostOs: 'win32' }).factors.find((x) => x.key === 'webrtc');
  assert.deepEqual([f.status, f.params.noProxy], ['pass', true]);
  const withProxy = scoreProfile({ ...p, systemProxyBehavior: 'PROFILE_PROXY' }, { proxy: { id: 1, host: 'h', lastStatus: 'ok', lastCountry: 'US' }, hostOs: 'win32' }).factors.find((x) => x.key === 'webrtc');
  assert.equal(withProxy.status, 'fail', 'Real behind a proxy still fails');
  assert.equal(scoreProfile({ ...p, webrtc: 'Forward' }, { proxy: null }).factors.find((x) => x.key === 'webrtc').params.noProxy, undefined, 'Forward keeps "pass"');
  assert.match(read('src', 'renderer', 'components', 'CaptchaScore.jsx'), /if \(f\.key === 'webrtc' && p\.noProxy\) return t\('factor\.webrtc\.realNoProxy'\);/);
  for (const lang of ['en', 'es']) {
    const c = JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, 'captcha.json'));
    assert.ok(c.factor.webrtc.realNoProxy, lang);
  }
  assert.match(JSON.parse(read('src', 'renderer', 'i18n', 'locales', 'en', 'captcha.json')).factor.webrtc.realNoProxy, /sites already see this computer's IP/);
  const leak = IPC.slice(IPC.indexOf("const webrtc = profile.webrtc || 'Forward';"), IPC.indexOf("const tzType = profile.timezoneType || 'Based on IP';"));
  assert.match(leak, /status: 'pass', detail: 'Set to "Real" with no proxy - sites already see this computer\\'s IP, so WebRTC shows them nothing new\.'/);
  assert.doesNotMatch(leak, /real IP visible via WebRTC/);
});

// ==== B. Quick generate's preview names ====

test('B: Quick generate\'s preview names are exactly the names main creates', async () => {
  const { quickGenNumber } = await importLib('quickGenProgress.mjs');
  const chromium = /const CHROMIUM_PROXY_TYPES = [^\n]+\n/.exec(IPC);
  const titles = [];
  const ctx = {
    proxyGate: require('../src/main/proxyGate'), proxyScope: require('../src/main/proxyScope'),
    requireObject: (v) => v, requirePermission: async () => {},
    optionalString: (v) => { if (v == null) return null; const s = String(v).trim(); return s || null; },
    parseId: (v) => Number(v), normCountryCode: (v) => v, scopedProxyWhere: async (w) => w, assertCanAccessGroup: async () => {},
    ownerStampId: () => null, shuffleInPlace: (a) => a, normalizeStartupUrls: () => '', CHROME_VERSIONS: ['131'],
    generateFingerprint: () => ({ userAgent: 'UA' }), fingerprintSignature: () => String(Math.random()), persistProxyHealth: async () => {},
    testProxyConnectivity: async () => ({ success: true }),
    getPrisma: () => ({ proxy: { count: async () => 0, findMany: async () => [] }, group: { create: async () => ({ id: 1 }), delete: async () => {} } }),
    createProfile: async (payload) => { titles.push(payload.title); return { id: titles.length, title: payload.title }; }
  };
  vm.createContext(ctx);
  vm.runInContext(`${chromium[0]}${extractFunction(IPC, 'batchGenerateProfiles')}\nthis.run = batchGenerateProfiles;`, ctx);
  for (const count of [1, 2, 3, 9, 10, 12, 99, 100, 101]) {
    titles.length = 0;
    await ctx.run({ count, proxyMode: 'direct', prefix: 'Etsy Shop' });
    const preview = titles.map((_, i) => `Etsy Shop-${quickGenNumber(1, i, count)}`);
    assert.deepEqual(titles, preview, `${count} profiles`);
  }
  assert.equal(quickGenNumber(1, 0, 3), '1', '3 profiles: Etsy Shop-1, not -001');
  assert.equal(quickGenNumber(1, 0, 12), '01');
  assert.equal(quickGenNumber(1, 0, 100), '001');

  // Round 7: fewer usable proxies than asked for. main pads to the number it creates (10 asked, 9 proxies:
  // -1 to -9), and the preview predicts that number: from the proxies the window lists (one per profile),
  // the pasted lines, and main's own 'create' frame. Main's naming is unchanged.
  const { quickGenPastedLines, quickGenUniqueCandidates, quickGenPlannedCount } = await importLib('quickGenProgress.mjs');
  const fresh = new Date().toISOString();
  const shortCases = [[10, 9], [12, 9], [100, 99], [101, 12], [3, 2], [10, 10]];
  for (const [count, have] of shortCases) {
    // The pool as the window lists it (serializeProxy: unused, working) and as main reads it.
    const pool = Array.from({ length: have }, (_, i) => ({ id: i + 1, type: i % 2 ? 'SOCKS5' : 'HTTP', host: `10.1.0.${i + 1}`, port: 8000, username: null, password: null,
      lastStatus: 'ok', lastCheckedAt: fresh, lastLatencyMs: 300, lastBlacklisted: false, profileCount: 0, proxyGroupId: null, provider: null }));
    const frames = [];
    titles.length = 0;
    ctx.getPrisma = () => ({ proxy: { count: async () => 0, findMany: async () => pool }, group: { create: async () => ({ id: 1 }), delete: async () => {} } });
    await ctx.run({ count, proxyMode: 'unique', prefix: 'Etsy Shop' }, { progress: (f) => frames.push(f) });
    assert.equal(titles.length, Math.min(count, have));
    const planned = quickGenPlannedCount({ count, available: quickGenUniqueCandidates(pool).length });
    assert.deepEqual(titles, titles.map((_, i) => `Etsy Shop-${quickGenNumber(1, i, planned)}`), `${count} asked, ${have} proxies (window's count)`);
    const create = frames.find((f) => f.phase === 'create');
    const reported = quickGenPlannedCount({ count, available: count, toCreate: create.toCreate });
    assert.deepEqual(titles, titles.map((_, i) => `Etsy Shop-${quickGenNumber(1, i, reported)}`), `${count} asked, ${have} proxies (main's frame)`);
    // Pasted proxies: the same, with a duplicate and a SOCKS4 line that main leaves out.
    const pasted = [...pool.map((p) => `${p.host}:${p.port}`), `${pool[0].host}:${pool[0].port}`, 'socks4://10.9.9.9:1080'].join('\n');
    titles.length = 0;
    await ctx.run({ count, proxyMode: 'paste', prefix: 'Etsy Shop', proxyList: pasted });
    const pastePlan = quickGenPlannedCount({ count, available: quickGenPastedLines(pasted).length });
    assert.deepEqual(titles, titles.map((_, i) => `Etsy Shop-${quickGenNumber(1, i, pastePlan)}`), `${count} asked, ${have} pasted`);
  }
  assert.equal(titles[0], 'Etsy Shop-01', 'the last case: 10 asked, 10 pasted');
  const modal = read('src', 'renderer', 'components', 'QuickGenerateModal.jsx');
  assert.match(modal, /const pad = \(index\) => quickGenNumber\(start, index, planned\);/);
  assert.doesNotMatch(modal, /padStart\(3, '0'\)/);
});
