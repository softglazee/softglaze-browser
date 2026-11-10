'use strict';
// 1.0.26 permission round 4 (the gaps PR #65 listed as "noticed, not fixed", decided by the owner):
//  1. Live 2FA codes on a "use only" share stay; nothing else hands over the 2FA seed.
//  2. The proxy password (and the username, as the Proxy pool shows it) of a "use only" share is not
//     sent to the window: profile list, Trash, Compare, the editor, the spreadsheet export, search,
//     templates and the proxy a launch rotated to.
//  3. Saved Profiles filters and warm-up lists are each member's own.
//  4. The CAPTCHA score's "Allow third-party cookies" follows settings.manage, as in Settings.
//  5. Data Vault autofill follows the member who launched the browser, not the window's member.
//  6. Start links, "Start transfer" and "Generate New API Key" fit a 375 px window.
// Main-process functions run for real from ipcHandlers.js with the real permissions module and an
// in-memory database stand-in (test/helpers/fakePrisma.js), as in test/permissionsRound3.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const permissions = require('../src/main/permissions');
const rbacPolicy = require('../src/main/rbacPolicy');
const featureGate = require('../src/main/featureGate');
const profileOptions = require('../src/main/profileOptions');
const captchaScore = require('../src/main/captchaScore');
const {
  SECRET_MASK, maskProxyInfoString, redactForeignProxy, redactUseOnlyProxy, redactPlatformAccounts, redactProfileRow
} = require('../src/main/profileRedaction');
const { createFakePrisma } = require('./helpers/fakePrisma');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const IPC = read('src', 'main', 'ipcHandlers.js');

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
const ACCOUNTS = JSON.stringify([{ platform: 'Facebook', username: 'owner@example.com', password: 'hunter2', twoFa: 'JBSWY3DPEHPK3PXP' }]);
const OWNER_PROXY_STRING = 'gw.owner.net:7000:owneruser:ownerpass';

function seed() {
  return createFakePrisma({
    member: MEMBERS.map((m) => ({ ...m })),
    proxy: [
      // The Owner's proxy (outside everyone else's pool) and the Manager's own proxy.
      { id: 20, name: 'owner-gw', type: 'HTTP', host: 'gw.owner.net', port: 7000, username: 'owneruser', password: 'ownerpass', rotationUrl: 'https://rotate.example/api?key=OWNERKEY', ownerMemberId: 1 },
      { id: 21, name: 'mgr-gw', type: 'HTTP', host: 'mgr.example', port: 8000, username: 'mgruser', password: 'mgrpass', rotationUrl: null, ownerMemberId: 5 }
    ],
    profile: [
      { id: 100, title: 'x-1', dataDirName: 'x-1', ownerMemberId: 3, assignedMemberId: 3, browserCore: 'Chromium', deletedAt: null, systemProxyBehavior: 'DIRECT' },
      // The Owner's profiles: 104 shared "use only" with X and the Manager, 105 "use only" with the Manager
      // on the Manager's own proxy, 106 shared for editing, 107 "use only" with a bare proxy address.
      { id: 104, title: 'shared-use', dataDirName: 'shared-use', ownerMemberId: 1, assignedMemberId: 1, browserCore: 'Chromium', deletedAt: null,
        twoFactorSeed: 'enc:v1:seed', platformAccounts: ACCOUNTS, proxyId: 20, proxyInfoString: OWNER_PROXY_STRING, systemProxyBehavior: 'PROFILE_PROXY',
        accesses: [{ memberId: 3, level: 'use' }, { memberId: 5, level: 'use' }] },
      { id: 105, title: 'shared-use-mgr-proxy', dataDirName: 'shared-use-mgr-proxy', ownerMemberId: 1, assignedMemberId: 1, browserCore: 'Chromium', deletedAt: null,
        proxyId: 21, proxyInfoString: 'mgr.example:8000:mgruser:mgrpass', systemProxyBehavior: 'PROFILE_PROXY',
        accesses: [{ memberId: 5, level: 'use' }] },
      { id: 106, title: 'shared-edit', dataDirName: 'shared-edit', ownerMemberId: 1, assignedMemberId: 1, browserCore: 'Chromium', deletedAt: null,
        twoFactorSeed: 'enc:v1:seed2', platformAccounts: ACCOUNTS, proxyId: 20, proxyInfoString: OWNER_PROXY_STRING, systemProxyBehavior: 'PROFILE_PROXY',
        accesses: [{ memberId: 3, level: 'edit' }, { memberId: 5, level: 'edit' }] },
      { id: 107, title: 'bare-use', dataDirName: 'bare-use', ownerMemberId: 1, assignedMemberId: 1, browserCore: 'Chromium', deletedAt: null,
        proxyId: null, proxyInfoString: 'bare.example:9000:bareuser:barepass', systemProxyBehavior: 'PROFILE_PROXY',
        accesses: [{ memberId: 5, level: 'use' }] }
    ]
  });
}

// The acting member (null = single-user mode) and the helpers that read it.
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
    // The real rule, shares included (the stand-in database does not model the ProfileAccess relation).
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

// The profile list as main builds it: the real serializers, the real reveal flag passed in (main
// caches it per window member: Manager and up, unless proxies.reveal is turned off).
function loadList({ reveal = true } = {}) {
  const db = seed();
  const ws = workspace(db);
  const fns = loadMain([...VALIDATORS, 'serializeProxy', 'deriveProvider', 'isDataImpulseSticky', 'apiRotationProvider', 'proxyCanRotate', 'serializeProfile',
    'withViewerEditFlags', 'proxyInVisiblePool', 'searchMatchesView', 'listProfiles', 'listTrash'], {
    ...ws.deps, rbacPolicy, profileOptions, redactProfileRow, redactPlatformAccounts, redactUseOnlyProxy,
    currentMemberCanRevealProxy: reveal, proxyRevealAllowed: () => reveal
  });
  const rows = async (search) => Object.fromEntries((await fns.listProfiles(search ? { search } : {})).map((r) => [r.id, r]));
  return { db, ws, fns, rows };
}

// ---- 1. The 2FA seed of a "use only" share ----

test('a "use only" share: live 2FA codes stay (owner\'s decision), the seed never leaves main', async () => {
  const db = seed();
  const ws = workspace(db);
  const { getProfile2faToken } = loadMain([...VALIDATORS, 'assertCanAccessProfile', 'assertCanRevealKind', 'getProfile2faToken'], {
    ...ws.deps, rbacPolicy, totp: require('../src/main/totp'), logAudit: async () => {},
    secretStore: { open: (s) => (s === 'enc:v1:seed' ? 'JBSWY3DPEHPK3PXP' : s) }
  }, ['REVEAL_LABELS']);
  ws.as(5); // the Manager, who holds 104 "use only"
  const code = await getProfile2faToken({ id: 104 });
  assert.match(String(code.token), /^\d{6}$/, 'a live code, as before');
  assert.doesNotMatch(JSON.stringify(code), /JBSWY3DPEHPK3PXP|enc:v1/);
  ws.as(3); // an Operator: below the reveal rank, unchanged
  await assert.rejects(getProfile2faToken({ id: 104 }), /Your role cannot read 2FA codes/);

  // The list, the export and a template of it carry no seed.
  const list = loadList();
  list.ws.as(5);
  const r = await list.rows();
  assert.equal(r[104].twoFactorSeed, SECRET_MASK);
  assert.doesNotMatch(JSON.stringify(Object.values(r)), /enc:v1:seed/);
  assert.ok(!extractConst(IPC, 'EXPORT_COLUMNS').match(/twoFactorSeed/), 'the spreadsheet has no seed column');
  assert.match(extractFunction(IPC, 'saveProfileAsTemplate'), /delete fields\.twoFactorSeed;/);
  assert.match(extractFunction(IPC, 'stripUseOnlySecrets'), /fields\.twoFactorSeed = null;/, 'a copy of it leaves the seed out (round 3)');
  // Cloud sync and workspace backups, which do carry seeds, are the Owner's.
  assert.match(extractFunction(IPC, 'syncRun'), /await requireOwnerOrSuper\('run cloud sync'\)/);
  assert.match(IPC, /await requireOwnerOrSuper\('back up the workspace'\)/);
});

// ---- 2. The proxy of a "use only" share ----

test('maskProxyInfoString masks the username on request; the default stays as before', () => {
  assert.equal(maskProxyInfoString('h.example:1080:u:p', null), `h.example:1080:u:${SECRET_MASK}`);
  assert.equal(maskProxyInfoString('h.example:1080:u:p', null, { maskUsername: true }), `h.example:1080:${SECRET_MASK}:${SECRET_MASK}`);
  assert.equal(maskProxyInfoString('h.example:1080:u', null, { maskUsername: true }), `h.example:1080:${SECRET_MASK}`);
  assert.equal(maskProxyInfoString('h.example:1080:u', null), 'h.example:1080:u');
  assert.equal(maskProxyInfoString('h.example:1080', null, { maskUsername: true }), 'h.example:1080');
  const linked = { host: 'gw.example', port: 7000, username: 'user', password: 'pw' };
  assert.equal(maskProxyInfoString('ignored', linked, { maskUsername: true }), `gw.example:7000:${SECRET_MASK}:${SECRET_MASK}`);
  assert.equal(maskProxyInfoString('ignored', linked), `gw.example:7000:user:${SECRET_MASK}`);
  const view = { id: 1, host: 'gw.example', port: 7000, username: 'user', password: SECRET_MASK, rotationUrl: 'https://r.example/?key=1' };
  assert.deepEqual(
    [redactForeignProxy(view).username, redactForeignProxy(view).password, redactForeignProxy(view).rotationUrl, redactForeignProxy(view).hasUsername],
    [SECRET_MASK, SECRET_MASK, null, true]
  );
  assert.equal(view.username, 'user', 'never mutates');
});

test('the profile list never sends a "use only" share\'s proxy password or rotation link; the username follows the Proxy pool', async () => {
  const { ws, rows } = loadList({ reveal: true });
  for (const who of [5, 2]) { // the Manager ("use only" on 104, 105, 107) and the Admin (104 is in the Admin's view through the shares)
    ws.as(who);
    const r = await rows();
    if (who === 5) {
      // 104: the Owner's proxy, not in the Manager's pool: username and password masked, no rotation link.
      assert.equal(r[104].proxyInfoString, `gw.owner.net:7000:${SECRET_MASK}:${SECRET_MASK}`);
      assert.deepEqual([r[104].proxy.username, r[104].proxy.password, r[104].proxy.rotationUrl, r[104].proxy.host], [SECRET_MASK, SECRET_MASK, null, 'gw.owner.net']);
      // 105: the Manager's own proxy, which their pool lists with its username: the username shows, the password does not.
      assert.equal(r[105].proxyInfoString, `mgr.example:8000:mgruser:${SECRET_MASK}`);
      assert.equal(r[105].proxy.username, 'mgruser');
      // 107: a bare address saved on the Owner's profile: both masked.
      assert.equal(r[107].proxyInfoString, `bare.example:9000:${SECRET_MASK}:${SECRET_MASK}`);
      // 106: shared for editing: unchanged (the raw string, as an editor gets it with proxies.reveal).
      assert.equal(r[106].proxyInfoString, OWNER_PROXY_STRING);
      assert.equal(r[106].canEdit, true);
    }
    assert.doesNotMatch(JSON.stringify(Object.values(r).filter((p) => p.canEdit === false)), /ownerpass|barepass|mgrpass|OWNERKEY|owneruser|bareuser/, `member ${who}`);
  }
  ws.as(3); // an Operator without proxies.reveal: the same, usernames masked as their pool masks them
  const op = loadList({ reveal: false });
  op.ws.as(3);
  const r3 = await op.rows();
  assert.equal(r3[104].proxyInfoString, `gw.owner.net:7000:${SECRET_MASK}:${SECRET_MASK}`);
  assert.equal(r3[100].canEdit, true);
  ws.as(1); // the Owner: their own profiles, unchanged
  const owner = await rows();
  assert.equal(owner[104].proxyInfoString, OWNER_PROXY_STRING);
  assert.equal(owner[104].proxy.rotationUrl, 'https://rotate.example/api?key=OWNERKEY');
});

test('Trash and Compare use the same rows: a "use only" share\'s proxy is masked there too', async () => {
  const { db, ws, fns } = loadList({ reveal: true });
  await db.profile.update({ where: { id: 104 }, data: { deletedAt: new Date() } });
  ws.as(5);
  const trash = await fns.listTrash();
  assert.equal(trash.find((p) => p.id === 104).proxyInfoString, `gw.owner.net:7000:${SECRET_MASK}:${SECRET_MASK}`);
  // Compare shows the row's proxyInfoString; the editor fills its fields from it (no other source).
  assert.match(read('src', 'renderer', 'components', 'CompareProfilesModal.jsx'), /\(p\) => p\.proxyInfoString \|\| \(p\.proxy && p\.proxy\.name\)/);
  assert.match(read('src', 'renderer', 'pages', 'ProfilesPage.jsx'), /const parts = profile\.proxyInfoString\.split\(':'\);/);
  assert.equal(IPC.match(/function withViewerEditFlags\(/g).length, 1);
  for (const name of ['listProfiles', 'listTrash']) assert.match(extractFunction(IPC, name), /withViewerEditFlags\(profiles\)/, name);
});

test('a search finds a profile only by what the member is shown of it', async () => {
  const { ws, rows } = loadList({ reveal: true });
  ws.as(5);
  // 104 and 106 use the same proxy: the Manager is shown its address on 106 (shared for editing), not on 104.
  assert.deepEqual(Object.keys(await rows('ownerpass')).map(Number), [106], 'a "use only" share\'s proxy password cannot be guessed through search');
  assert.deepEqual(Object.keys(await rows('owneruser')).map(Number), [106]);
  assert.deepEqual(Object.keys(await rows('barepass')).map(Number), [], 'nor a bare address saved on it');
  assert.deepEqual(Object.keys(await rows('gw.owner')).map(Number).sort(), [104, 106], 'the host is shown, so it is found');
  assert.deepEqual(Object.keys(await rows('shared-use')).map(Number).sort(), [104, 105]);
  ws.as(1);
  assert.deepEqual(Object.keys(await rows('ownerpass')).map(Number).sort(), [104, 106], 'the Owner, who sees it, still finds it');
});

test('the spreadsheet export blanks a "use only" share\'s proxy password, rotation link and foreign username', async () => {
  const db = seed();
  const ws = workspace(db);
  const load = (reveal) => loadMain(['assertCanRevealKind', 'firstAccount', 'proxyInVisiblePool', 'gatherExport'], {
    ...ws.deps, rbacPolicy, currentMemberCanRevealProxy: reveal, proxyRevealAllowed: () => reveal,
    readSetting: async (k, d) => (k === 'profileRotationUrls' ? { 104: 'https://rotate.example/104?key=K', 105: 'https://rotate.example/105', 106: 'https://rotate.example/106' } : d),
    doNotTrackChoice: require('../src/main/doNotTrack').doNotTrackChoice
  }, ['REVEAL_LABELS', 'EXPORT_COLUMNS']);
  ws.as(5);
  const out = await load(true).gatherExport();
  const col = (name) => out.headers.indexOf(name);
  const row = (title) => out.rows.find((r) => r[col('Profile Title')] === title);
  const pick = (title) => ['Proxy Info', 'Proxy Username', 'Proxy Password', 'Proxy Rotation URL', 'Proxy Host'].map((c) => row(title)[col(c)]);
  assert.deepEqual(pick('shared-use'), ['gw.owner.net:7000::', '', '', '', 'gw.owner.net']);
  assert.deepEqual(pick('shared-use-mgr-proxy'), ['mgr.example:8000:mgruser:', 'mgruser', '', '', 'mgr.example'], 'their own pool\'s proxy keeps its username');
  assert.deepEqual(pick('shared-edit'), [OWNER_PROXY_STRING, 'owneruser', 'ownerpass', 'https://rotate.example/106', 'gw.owner.net'], 'shared for editing: unchanged');
  ws.as(3); // an Operator (no proxies.reveal): the use-only row loses the username too
  const op = await load(false).gatherExport();
  const opRow = op.rows.find((r) => r[col('Profile Title')] === 'shared-use');
  assert.deepEqual(['Proxy Info', 'Proxy Username', 'Proxy Password'].map((c) => opRow[col(c)]), ['gw.owner.net:7000::', '', '']);
  ws.as(1);
  const own = await load(true).gatherExport();
  assert.equal(own.rows.find((r) => r[col('Profile Title')] === 'shared-use')[col('Proxy Password')], 'ownerpass', 'the Owner\'s own export is unchanged');
});

test('a template of a "use only" share keeps no proxy, and says so', async () => {
  const db = seed();
  const ws = workspace(db);
  const { saveProfileAsTemplate } = loadMain([...VALIDATORS, 'requirePermission', 'assertCanAccessProfile', 'pickCloneableFields', 'saveProfileAsTemplate', 'serializeTemplate'], {
    ...ws.deps, ownerStampId: () => (ws.state.member ? ws.state.member.id : null)
  }, ['CLONE_EXCLUDE']);
  const stored = async (id) => JSON.parse((await db.template.findUnique({ where: { id } })).dataJson);
  ws.as(5);
  for (const pid of [104, 107]) {
    const t = await saveProfileAsTemplate({ id: pid, name: `from ${pid}` });
    assert.deepEqual(t.leftOut, { proxy: true });
    const data = await stored(t.id);
    assert.deepEqual([data.proxyId, data.proxyInfoString, data.systemProxyBehavior], [null, null, 'PROFILE_PROXY'], `profile ${pid}`);
    assert.equal(data.twoFactorSeed, undefined);
  }
  const edit = await saveProfileAsTemplate({ id: 106, name: 'from 106' });
  assert.deepEqual(edit.leftOut, { proxy: false });
  assert.equal((await stored(edit.id)).proxyInfoString, OWNER_PROXY_STRING, 'shared for editing: kept, as before');
  // The window says what was left out.
  const modal = read('src', 'renderer', 'components', 'TemplatesModal.jsx');
  assert.match(modal, /saved && saved\.leftOut && saved\.leftOut\.proxy \? 'templates\.infoSavedNoProxy' : 'templates\.infoSaved'/);
});

test('the proxy a launch rotated to arrives without the username and rotation link when it is not in the launcher\'s pool', async () => {
  const db = seed();
  const ws = workspace(db);
  const { launchedProxyView } = loadMain(['serializeProxy', 'deriveProvider', 'isDataImpulseSticky', 'apiRotationProvider', 'proxyCanRotate', 'launchedProxyView'], {
    ...ws.deps, rbacPolicy, redactForeignProxy, currentMemberCanRevealProxy: true, proxyRevealAllowed: () => true,
    assertCanAccessProxy: async (id) => {
      const m = ws.state.member;
      if (!m) return;
      const visible = permissions.visibleMemberIds(await db.member.findMany(), m);
      const p = await db.proxy.findUnique({ where: { id } });
      if (!visible.has(p.ownerMemberId)) { const e = new Error('You do not have access to this proxy.'); e.code = 'FORBIDDEN'; throw e; }
    }
  });
  const owners = await db.proxy.findUnique({ where: { id: 20 } });
  ws.as(5);
  const v = await launchedProxyView(owners);
  assert.deepEqual([v.name, v.username, v.password, v.rotationUrl], ['owner-gw', SECRET_MASK, SECRET_MASK, null]);
  assert.equal((await launchedProxyView(await db.proxy.findUnique({ where: { id: 21 } }))).username, 'mgruser');
  assert.equal(await launchedProxyView(null), null);
  ws.as(1);
  assert.equal((await launchedProxyView(owners)).rotationUrl, 'https://rotate.example/api?key=OWNERKEY');
  const body = extractFunction(IPC, 'launchProfileNow');
  assert.equal((body.match(/rotatedProxy: await launchedProxyView\(/g) || []).length, 2, 'Chromium and Firefox');
});

// ---- 3. Saved Profiles filters and warm-up lists, per member ----

function loadSettings(stored = {}, { memberPageLists } = {}) {
  const db = seed();
  const ws = workspace(db);
  const settings = new Map([['globalSettings', JSON.parse(JSON.stringify(stored))]]);
  if (memberPageLists) settings.set('memberPageLists', memberPageLists);
  const state = { readFails: false };
  const fns = loadMain([...VALIDATORS, 'requirePermission', 'deepMergeSettings', 'getGlobalSettings', 'setGlobalSettings',
    'activeIsSuperAdmin', 'withoutSuperOnlyKeys', 'getGlobalSettingsForActor', 'changedGlobalSettingKeys',
    'assertCanWriteGlobalSettings', 'withoutWorkspaceSecrets', 'setGlobalSettingsForActor',
    'withMemberPageLists', 'pageListsOwnerKey', 'emptyPageLists', 'memberSinceStamp', 'copyJson', 'loadMemberPageLists',
    'ownPageListsIn', 'readOwnPageLists', 'writeOwnPageLists',
    // The first-run flag is each member's own since round 5 (test/permissionsRound5.test.js).
    'onboardingOwnerKey', 'withMemberOnboarding', 'loadMemberOnboarding', 'ownOnboardingDoneIn', 'readOwnOnboardingDone',
    'readOwnOnboardingDoneSafe', 'writeOwnOnboardingDone'], {
    ...ws.deps,
    readSetting: async (k, d) => (settings.has(k) ? JSON.parse(JSON.stringify(settings.get(k))) : d),
    readSettingStrict: async (k) => {
      if (state.readFails) throw new Error('SQLITE_BUSY');
      return settings.has(k) ? JSON.parse(JSON.stringify(settings.get(k))) : undefined;
    },
    writeSetting: async (k, v) => { settings.set(k, JSON.parse(JSON.stringify(v))); }
  }, ['GLOBAL_SETTINGS_DEFAULTS', 'SUPER_ONLY_GLOBAL_KEYS', 'GLOBAL_SETTING_WRITE_RULES', 'WORKSPACE_SETTING_RULE', 'SETTING_ROLE_PHRASE',
    'MEMBER_PAGE_LIST_KEYS', 'MEMBER_PAGE_LISTS_SETTING', 'memberPageListsLock', 'MEMBER_ONBOARDING_SETTING', 'memberOnboardingLock']);
  return { db, ws, fns, settings, state, shared: () => settings.get('globalSettings'), store: () => settings.get('memberPageLists') };
}
const SHARED = {
  profileFilters: [{ name: 'Team US', group: 'all', tag: 'us', proxy: '', status: 'all', search: '' }],
  warmer: { sites: [{ url: 'https://news.example', seconds: 30 }], loop: false, lists: [{ id: 'wl-1', name: 'News', sites: [{ url: 'https://news.example' }] }] }
};
const names = (list) => (list || []).map((p) => p.name);

test('saved filters and warm-up lists: members who exist at the update start with a copy; the Owner keeps the original', async () => {
  const { ws, fns, shared, store } = loadSettings(SHARED);
  ws.as(1);
  const owner = await fns.getGlobalSettingsForActor();
  assert.deepEqual([names(owner.profileFilters), names(owner.warmer.lists)], [['Team US'], ['News']]);
  // The store was created on that first read: a copy for every member but the Owner.
  assert.deepEqual(Object.keys(store().members).sort(), ['2', '3', '4', '5']);
  assert.equal(store().members['5'].since, '2026-04-01T00:00:00.000Z');
  for (const who of [2, 3, 4, 5]) {
    ws.as(who);
    const view = await fns.getGlobalSettingsForActor();
    assert.deepEqual([names(view.profileFilters), names(view.warmer.lists), view.warmer.sites.length], [['Team US'], ['News'], 1], `member ${who}`);
  }
  assert.deepEqual(shared(), SHARED, 'the stored workspace settings did not change shape or content');
});

test('one member\'s save no longer replaces anyone else\'s lists', async () => {
  const { ws, fns, shared } = loadSettings(SHARED);
  ws.as(3); // Operator X saves a filter and a warm-up list
  await fns.setGlobalSettingsForActor({ profileFilters: [...SHARED.profileFilters, { name: 'Mine', group: 'all' }] });
  await fns.setGlobalSettingsForActor({ warmer: { lists: [{ id: 'wl-2', name: 'X list', sites: [] }] } });
  await fns.setGlobalSettingsForActor({ warmer: { sites: [{ url: 'https://x.example', seconds: 10 }], loop: true } });
  const x = await fns.getGlobalSettingsForActor();
  assert.deepEqual([names(x.profileFilters), names(x.warmer.lists), x.warmer.sites[0].url, x.warmer.loop], [['Team US', 'Mine'], ['X list'], 'https://x.example', true],
    'the warm-up plan is merged key by key, as in globalSettings');
  ws.as(4); // Operator Y, X's sibling, still has the copy
  const y = await fns.getGlobalSettingsForActor();
  assert.deepEqual([names(y.profileFilters), names(y.warmer.lists)], [['Team US'], ['News']]);
  ws.as(1); // the Owner's lists are untouched, and the Owner's save stays theirs
  assert.deepEqual(names((await fns.getGlobalSettingsForActor()).profileFilters), ['Team US']);
  await fns.setGlobalSettingsForActor({ profileFilters: [] });
  assert.deepEqual(shared().profileFilters, []);
  ws.as(3);
  assert.deepEqual(names((await fns.getGlobalSettingsForActor()).profileFilters), ['Team US', 'Mine']);
  ws.as(null); // single-user mode is the Owner
  assert.deepEqual((await fns.getGlobalSettingsForActor()).profileFilters, []);
});

test('a member added after the update starts empty, and a reused member id does not inherit a deleted member\'s lists', async () => {
  const { db, ws, fns } = loadSettings(SHARED);
  ws.as(1);
  await fns.getGlobalSettingsForActor(); // the first start of 1.0.26 creates the store
  const late = { id: 6, name: 'New Operator', role: 'OPERATOR', parentMemberId: 2, status: 'active', createdAt: new Date('2026-12-01T00:00:00Z') };
  await db.member.create({ data: late });
  ws.state.member = { ...late };
  const view = await fns.getGlobalSettingsForActor();
  assert.deepEqual([view.profileFilters, view.warmer], [[], {}]);
  // Operator Y is deleted and someone new gets id 4: their createdAt differs, so the old entry is ignored.
  ws.state.member = { id: 4, name: 'Reused id', role: 'OPERATOR', parentMemberId: 2, status: 'active', createdAt: new Date('2027-01-01T00:00:00Z') };
  assert.deepEqual((await fns.getGlobalSettingsForActor()).profileFilters, []);
  await fns.setGlobalSettingsForActor({ profileFilters: [{ name: 'Fresh' }] });
  assert.deepEqual(names((await fns.getGlobalSettingsForActor()).profileFilters), ['Fresh']);
});

test('the warm-up lists still need automation.run; the Super Admin has their own lists; a failed read never replaces saved lists', async () => {
  const { ws, fns, state, store } = loadSettings(SHARED, { memberPageLists: { version: 1, members: { 3: { since: '2026-03-01T00:00:00.000Z', profileFilters: [{ name: 'Kept' }], warmer: {} } } } });
  ws.as(3, revoked('automation.run'));
  await assert.rejects(fns.setGlobalSettingsForActor({ warmer: { loop: true } }), /turned off for your account by an administrator/);
  ws.as(3);
  assert.deepEqual(names((await fns.getGlobalSettingsForActor()).profileFilters), ['Kept'], 'an existing store is read, never seeded again');
  ws.as('super');
  await fns.setGlobalSettingsForActor({ profileFilters: [{ name: 'Support' }] });
  assert.deepEqual(names(store().members['-1'].profileFilters), ['Support']);
  ws.as(3);
  state.readFails = true;
  await assert.rejects(fns.setGlobalSettingsForActor({ profileFilters: [] }), /SQLITE_BUSY/, 'a write fails rather than writing over what it could not read');
  assert.deepEqual((await fns.getGlobalSettingsForActor()).profileFilters, [], 'a read shows empty lists for the moment');
  ws.as(1); // the Owner's lists are globalSettings' own: their write is not held up
  assert.deepEqual(names((await fns.setGlobalSettingsForActor({ profileFilters: [{ name: 'Owner list' }] })).profileFilters), ['Owner list']);
  ws.as(3);
  state.readFails = false;
  assert.deepEqual(names((await fns.getGlobalSettingsForActor()).profileFilters), ['Kept'], 'and nothing was lost');
});

test('the store is created at start-up and the pages keep using settings:get-global / set-global', () => {
  const reg = extractFunction(IPC, 'registerIpcHandlers');
  assert.match(reg, /try \{ await withMemberPageLists\(loadMemberPageLists\); \} catch \(e\)/);
  assert.match(extractConst(IPC, 'MEMBER_PAGE_LIST_KEYS'), /\['profileFilters', 'warmer'\]/);
  assert.match(read('src', 'renderer', 'pages', 'ProfilesPage.jsx'), /softglazeApi\.settings\.setGlobal\(\{ profileFilters: next \}\)/);
  assert.match(read('src', 'renderer', 'pages', 'AutomationPage.jsx'), /softglazeApi\.settings\.setGlobal\(\{ warmer: \{ lists: next \} \}\)/);
  // Loading the store reads strictly (an error is not "no store yet").
  assert.match(extractFunction(IPC, 'readSettingStrict'), /const row = await getPrisma\(\)\.setting\.findUnique\(\{ where: \{ key \} \}\);/);
  assert.doesNotMatch(extractFunction(IPC, 'readSettingStrict'), /catch \(e\) \{ return undefined/);
});

// ---- 4. The CAPTCHA score's third-party cookie switch ----

function loadCaptchaFix() {
  const db = seed();
  const ws = workspace(db);
  const settings = new Map([['globalSettings', { browser: { blockThirdPartyCookies: true } }]]);
  const audit = [];
  const fns = loadMain([...VALIDATORS, 'requirePermission', 'deepMergeSettings', 'getGlobalSettings', 'setGlobalSettings',
    'changedGlobalSettingKeys', 'assertCanWriteGlobalSettings', 'captchaFix'], {
    ...ws.deps, captchaScore,
    readSetting: async (k, d) => (settings.has(k) ? JSON.parse(JSON.stringify(settings.get(k))) : d),
    writeSetting: async (k, v) => { settings.set(k, JSON.parse(JSON.stringify(v))); },
    logAudit: async (kind) => { audit.push(kind); }
  }, ['GLOBAL_SETTINGS_DEFAULTS', 'GLOBAL_SETTING_WRITE_RULES', 'WORKSPACE_SETTING_RULE', 'SETTING_ROLE_PHRASE']);
  const blocked = () => settings.get('globalSettings').browser.blockThirdPartyCookies;
  const reset = () => settings.set('globalSettings', { browser: { blockThirdPartyCookies: true } });
  return { ws, fns, blocked, reset, audit };
}

test('"Allow third-party cookies" from the CAPTCHA score follows settings.manage, as the switch in Settings', async () => {
  const { ws, fns, blocked, reset, audit } = loadCaptchaFix();
  for (const who of [5, 3]) {
    ws.as(who);
    await assert.rejects(fns.captchaFix({ id: 100, action: 'allow-3p-cookies' }),
      /Your role does not permit this action: only the Owner or an Admin can change the workspace settings\./, `member ${who}`);
  }
  ws.as(2, revoked('settings.manage'));
  await assert.rejects(fns.captchaFix({ action: 'allow-3p-cookies' }), /turned off for your account by an administrator/);
  ws.as(2, hidden('settings'));
  await assert.rejects(fns.captchaFix({ action: 'allow-3p-cookies' }), /Settings is turned off for your account by an administrator\./);
  assert.equal(blocked(), true, 'nothing was written');
  ws.as(2); // an Admin: allowed now (was Owner only)
  assert.deepEqual(await fns.captchaFix({ action: 'allow-3p-cookies' }), { ok: true, scope: 'workspace' });
  assert.equal(blocked(), false);
  assert.deepEqual(audit, ['settings.third-party-cookies']);
  for (const who of [1, null]) { reset(); ws.as(who); await fns.captchaFix({ action: 'allow-3p-cookies' }); assert.equal(blocked(), false); }
  assert.doesNotMatch(extractFunction(IPC, 'captchaFix'), /requireOwnerOrSuper/);
});

test('the CAPTCHA window and the pre-launch check disable the fixes main refuses, with the reason', () => {
  const CAPTCHA = read('src', 'renderer', 'components', 'CaptchaScore.jsx');
  assert.match(CAPTCHA, /const denyFix = \(action\) => \(action === 'allow-3p-cookies' \? denyWorkspace : action === 'warm-up' \? denyWarmUp : denyProfileFix\);/);
  assert.match(CAPTCHA, /<GuardedButton deny=\{denyFix\(f\.fix\)\}[^\n]*onClick=\{\(\) => apply\(\[f\.fix\]\)\}/);
  assert.match(CAPTCHA, /<GuardedButton deny=\{denyProfileFix\}[^\n]*onClick=\{\(\) => apply\(fixable\)\}/);
  const PROFILES = read('src', 'renderer', 'pages', 'ProfilesPage.jsx');
  assert.match(PROFILES, /setCaptchaProfile\(\{ id: p\.id, title: p\.title, canEdit: p\.canEdit \}\)/);
  assert.match(PROFILES, /denyProfileFix=\{perm\.denyRow\('profiles\.edit', captchaProfile\)\}/);
  assert.match(PROFILES, /denyWorkspace=\{perm\.denyWorkspaceSettings\(\)\}/);
  assert.match(PROFILES, /denyWarmUp=\{perm\.deny\('automation\.run'\)\}/);
  assert.match(PROFILES, /denyFix=\{perm\.denyRow\('profiles\.edit', \{ canEdit: preLaunch\.items\.some\(\(it\) => it\.profile\.canEdit !== false\) \}\)\}/);
  assert.match(PROFILES, /return \{ profile: \{ id, title: row\.title \|\| `#\$\{id\}`, canEdit: row\.canEdit \}, issues: issues\[id\] \};/);
  assert.match(read('src', 'renderer', 'components', 'PreLaunchCheck.jsx'), /<GuardedButton deny=\{denyFix\}[^\n]*onClick=\{\(\) => decide\(true\)\}/);
  // The helper is settings.manage plus the Settings page under Visible features, as main.
  const HOOK = read('src', 'renderer', 'lib', 'usePermissions.js');
  assert.match(HOOK, /denyWorkspaceSettings: \(\) => text\(denial\(me, 'settings\.manage'\)\)\s*\|\| \(me && me\.role !== 'SUPER_ADMIN' && !featureVisible\(me, 'settings'\) \? t\('perm\.settingsHidden'\) : null\),/);
  assert.match(read('src', 'renderer', 'pages', 'StartLinksPage.jsx'), /const deny = perm\.denyWorkspaceSettings\(\);/);
  assert.match(PROFILES, /canStopAsking=\{!perm\.denyWorkspaceSettings\(\)\}/);
});

// ---- 5. Autofill follows the member who launched the browser ----

function loadLaunchers(globals = { smartAutofill: { enabled: true, members: false } }) {
  const db = seed();
  const window = { id: null, signedIn: true };
  const sessionLaunchers = new Map();
  const ffSessions = new Set();
  // Round 5: firefoxAutofillAllowed is gone; a Firefox session is asked like a Chromium one.
  const fns = loadMain(['recordSessionLauncher', 'vaultAutofillAllowed', 'personaVaultAvailable', 'sessionAutofillAllowed'], {
    permissions,
    sessionLaunchers,
    // The member signed in to the window; the rule must not read it any more.
    actingMemberId: () => window.id,
    firefoxEngine: { isFirefoxSession: (sid) => ffSessions.has(String(sid)) },
    getPrisma: () => db,
    getGlobalSettings: async () => globals,
    ipcAuthState: async () => ({ vaultLocked: false, signedIn: window.signedIn, memberCount: 5 })
  });
  return { db, window, fns, sessionLaunchers, ffSessions, globals };
}

test('a running browser keeps the autofill of the member who launched it, whoever signs in to the window later', async () => {
  const { window, fns, globals } = loadLaunchers();
  window.id = 1;
  fns.recordSessionLauncher(104, 1); // the Owner opens 104
  window.id = 3;
  fns.recordSessionLauncher(100, 3); // Operator X opens 100
  for (const who of [1, 3, 2]) { // members switch in the window
    window.id = who;
    assert.equal(await fns.personaVaultAvailable({ sessionId: '104' }), true, `the Owner's browser, window member ${who}`);
    assert.equal(await fns.sessionAutofillAllowed('100'), false, `X's browser, window member ${who}`);
  }
  assert.equal(await fns.sessionAutofillAllowed('999'), false, 'a session with no recorded launcher gets nothing');
  assert.equal(await fns.sessionAutofillAllowed(null), false);
  // The rule is still asked at fill time: the Owner's switch reaches browsers already open.
  globals.smartAutofill.members = true;
  assert.equal(await fns.sessionAutofillAllowed('100'), true);
  window.signedIn = false; // signed out / locked: nothing, as before
  assert.equal(await fns.personaVaultAvailable({ sessionId: '104' }), false);
});

test('single-user launches count as the Owner; a failed launch puts the previous launcher back', async () => {
  const { fns, sessionLaunchers } = loadLaunchers();
  fns.recordSessionLauncher(104, null);
  assert.equal(await fns.sessionAutofillAllowed('104'), true, 'single-user mode is the Owner');
  const undo = fns.recordSessionLauncher(104, 3);
  assert.equal(await fns.sessionAutofillAllowed('104'), false);
  undo();
  assert.deepEqual(sessionLaunchers.get('104'), { memberId: null });
  undo(); // twice is harmless
  const undoNew = fns.recordSessionLauncher(105, 2);
  undoNew();
  assert.equal(sessionLaunchers.has('105'), false);
  assert.equal(await fns.vaultAutofillAllowed(undefined), false, 'no launcher known: nothing');
});

// Round 5 replaced the fail-closed rule (every running Firefox profile had to be allowed): each Firefox
// profile has its own bridge port, so the bridge names the session (test/permissionsRound5.test.js).
test('the Firefox bridge follows the launcher of the profile asking, not the other Firefox profiles', async () => {
  const { fns, ffSessions, globals } = loadLaunchers();
  fns.recordSessionLauncher(104, 1); // the Owner's Firefox
  ffSessions.add('104');
  globals.smartAutofill.members = true;
  fns.recordSessionLauncher(101, 4); // Y's, while members were allowed
  ffSessions.add('101');
  assert.equal(await fns.personaVaultAvailable({ sessionId: '101' }), true);
  globals.smartAutofill.members = false; // the Owner turns it off
  assert.equal(await fns.personaVaultAvailable({ sessionId: '101' }), false, 'Y\'s Firefox gets nothing');
  assert.equal(await fns.personaVaultAvailable({ sessionId: '104' }), true, 'the Owner\'s Firefox keeps it');
});

test('launch records the launcher before the engine starts, and session ends drop it', () => {
  const body = extractFunction(IPC, 'launchProfileNow');
  assert.match(body, /const launchedBy = actingMemberId\(\) == null \? null : actingMemberId\(\);/);
  const chrome = body.indexOf('undoLauncher = recordSessionLauncher(profile.id, launchedBy);');
  assert.ok(chrome > 0 && chrome < body.indexOf('const session = await launchProfileSession({'), 'Chromium: recorded before the engine call');
  const ff = body.indexOf('undoLauncher = recordSessionLauncher(profile.id, launchedBy);', body.indexOf('if (isFirefox) {'));
  assert.ok(ff > 0 && ff < body.indexOf('await firefoxEngine.launchFirefoxProfile({'), 'Firefox: recorded before the engine call');
  assert.match(body, /&& \(await vaultAutofillAllowed\(launchedBy\)\);/);
  assert.match(body, /if \(ffSession && ffSession\.alreadyRunning\) undoLauncher\(\);/);
  assert.match(body, /if \(session && session\.alreadyRunning\) undoLauncher\(\);/);
  assert.match(body, /releaseReservedLock\(id, reservation\);[^\n]*\n\s*if \(undoLauncher\) undoLauncher\(\);/);
  assert.match(extractFunction(IPC, 'handleSessionEvent'), /if \(evt\.type === 'closed' \|\| evt\.type === 'crashed'\) sessionLaunchers\.delete\(/);
  // The Chromium bridge passes the page's session to main.
  const ENGINE = read('src', 'main', 'browserEngine.js');
  assert.match(ENGINE, /await attachPersonaAutofill\(targetPage, \{ sessionId: profileId != null && profileId !== '' \? profileId : null \}\);/);
  assert.match(ENGINE, /personaBridge\.isEnabled\(bridgeCtx\)/);
  assert.match(ENGINE, /personaBridge\.isAvailable\(bridgeCtx\)/);
});

test('a Firefox profile launched without autofill loses a copy of the add-on an earlier launch installed', async () => {
  const ff = require('../src/main/firefoxEngine');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-ff-autofill-'));
  try {
    const ext = path.join(dir, 'extensions');
    fs.mkdirSync(path.join(ext, 'autofill@softglaze.app'), { recursive: true });
    fs.writeFileSync(path.join(ext, 'autofill@softglaze.app', 'manifest.json'), '{}');
    fs.writeFileSync(path.join(ext, 'autofill@softglaze.app.xpi'), 'x');
    fs.writeFileSync(path.join(ext, 'other@example.org.xpi'), 'y');
    await ff.removeAutofillExtension(dir);
    assert.deepEqual(fs.readdirSync(ext), ['other@example.org.xpi'], 'only our add-on is taken out');
    await ff.removeAutofillExtension(path.join(dir, 'missing')); // nothing there: no error
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const src = read('src', 'main', 'firefoxEngine.js');
  assert.match(src, /\} else \{\s*await removeAutofillExtension\(userDataDir\)\.catch\(\(\) => \{\}\);\s*\}/);
});

// ---- 6. Narrow windows ----

test('Start links, "Start transfer" and "Generate New API Key" stack below the sm breakpoint and keep their desktop layout', () => {
  const LINKS = read('src', 'renderer', 'pages', 'StartLinksPage.jsx');
  assert.match(LINKS, /<div className="sm:p-7">/, 'the page adds its own gutter only from sm (the window has one)');
  assert.match(LINKS, /grid grid-cols-1 gap-5 lg:grid-cols-\[minmax\(0,1fr\)_340px\]/, 'one shrinkable column until lg');
  assert.match(LINKS, /<div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">/);
  assert.match(LINKS, /className=\{`\$\{inputCls\} w-full sm:w-44 sm:shrink-0`\}/);
  assert.match(LINKS, /className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-border"/);
  for (const file of ['MigrationSettings.jsx', 'DeveloperApiSettings.jsx']) {
    const src = read('src', 'renderer', 'components', file);
    assert.match(src, /<div className="flex flex-col gap-2 sm:flex-row sm:items-center">\s*<input/, file);
    assert.match(src, /className="w-full min-w-0 sm:w-auto sm:flex-1 h-9 /, file);
  }
  assert.match(read('src', 'renderer', 'components', 'DeveloperApiSettings.jsx'), /overflow-x-auto whitespace-pre-wrap break-words sm:whitespace-pre/);
});

// ---- Strings ----

test('every new string exists in both languages', () => {
  for (const lang of ['en', 'es']) {
    const loc = (ns) => JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, `${ns}.json`));
    assert.ok(loc('common').perm.settingsHidden, `${lang} common.perm.settingsHidden`);
    assert.ok(loc('cmpModalsB').templates.infoSavedNoProxy, `${lang} cmpModalsB.templates.infoSavedNoProxy`);
  }
  assert.equal(JSON.parse(read('src', 'renderer', 'i18n', 'locales', 'en', 'common.json')).perm.settingsHidden, featureGate.featureOffError('settings').message, 'the same words as main');
});
