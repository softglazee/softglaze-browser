'use strict';
// 1.0.26 permission and safety gaps noted in PR #61:
//  - Batch import had no permission check, no profile quota, and auto-bound proxies of other members.
//  - createProfile / updateProfile linked any proxy id, even another member's.
//  - The row's Proxy Rotation dialog could turn a pool on for a profile with no proxy of its own;
//    under the Sticky policy that profile then opened on the real IP.
//  - Groups had no permission check and no member scoping (list, create, rename, delete, move).
//  - At 375 px the profile editor footer clipped "Preview Environment".
// Main-process functions run for real from ipcHandlers.js, with the real permissions module and an
// in-memory database stand-in.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const permissions = require('../src/main/permissions');
const proxyScope = require('../src/main/proxyScope');
const { createFakePrisma } = require('./helpers/fakePrisma');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const IPC = read('src', 'main', 'ipcHandlers.js');
const PAGE = read('src', 'renderer', 'pages', 'ProfilesPage.jsx');
const ROTATION_MODAL = read('src', 'renderer', 'components', 'ProxyRotationModal.jsx');
const locale = (lang, ns) => JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, `${ns}.json`));

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

// Runs main-process functions from ipcHandlers.js in this realm with the given stand-ins.
function loadMain(names, deps) {
  const src = names.map((n) => extractFunction(IPC, n)).join('\n');
  const keys = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  return new Function(...keys, `${src}\nreturn { ${names.join(', ')} };`)(...keys.map((k) => deps[k]));
}
const VALIDATORS = ['requireObject', 'optionalString', 'requiredString', 'parseId', 'parseIdArray'];

// ---- A team: Owner 1 > Admin 2 > Operators 3 and 4 (siblings, who never see each other) ----

const MEMBERS = [
  { id: 1, name: 'Owner', role: 'OWNER', parentMemberId: null, status: 'active' },
  { id: 2, name: 'Admin', role: 'ADMIN', parentMemberId: 1, status: 'active' },
  { id: 3, name: 'Operator X', role: 'OPERATOR', parentMemberId: 2, status: 'active' },
  { id: 4, name: 'Operator Y', role: 'OPERATOR', parentMemberId: 2, status: 'active' }
];

function seed(extra = {}) {
  return createFakePrisma({
    member: MEMBERS.map((m) => ({ ...m })),
    group: [
      { id: 10, name: 'X own', ownerMemberId: 3 },
      { id: 11, name: 'Y own', ownerMemberId: 4 },
      { id: 12, name: 'Older, holds an X profile', ownerMemberId: null },
      { id: 13, name: 'Older, holds a Y profile', ownerMemberId: null },
      { id: 14, name: 'Y group with an X profile in it', ownerMemberId: 4 }
    ],
    profile: [
      { id: 100, title: 'x-1', ownerMemberId: 3, assignedMemberId: 3, groupId: 12, tags: '["x"]', deletedAt: null },
      { id: 101, title: 'y-1', ownerMemberId: 4, assignedMemberId: 4, groupId: 13, tags: '["y-secret"]', deletedAt: null },
      { id: 102, title: 'x-2', ownerMemberId: 3, assignedMemberId: 3, groupId: 14, tags: '["x2"]', deletedAt: null },
      { id: 103, title: 'y-2', ownerMemberId: 4, assignedMemberId: 4, groupId: 14, tags: '["y-hidden"]', deletedAt: null },
      // The Owner's profile shared with X: 104 for use only, 106 for edit (on the Owner's proxy, in an older group).
      { id: 104, title: 'shared-use', ownerMemberId: 1, assignedMemberId: 1, groupId: null, deletedAt: null, accesses: [{ memberId: 3, level: 'use' }] },
      { id: 105, title: 'x-3', ownerMemberId: 3, assignedMemberId: 3, groupId: null, deletedAt: null },
      { id: 106, title: 'shared-edit', ownerMemberId: 1, assignedMemberId: 1, groupId: 13, proxyId: 22, deletedAt: null, accesses: [{ memberId: 3, level: 'edit' }] }
    ],
    proxy: [
      { id: 20, name: 'X proxy', type: 'HTTP', host: 'x.example.net', port: 8000, ownerMemberId: 3, provider: null, lastCountry: 'US' },
      { id: 21, name: 'Y proxy', type: 'HTTP', host: 'y.example.net', port: 8000, ownerMemberId: 4, provider: null, lastCountry: 'US' },
      { id: 22, name: 'Owner proxy', type: 'HTTP', host: 'o.example.net', port: 8000, ownerMemberId: 1, provider: null, lastCountry: 'US' }
    ],
    ...extra
  });
}

// The acting member (null = single-user mode) and the scoping helpers that read it.
function workspace(db) {
  const state = { member: null };
  const visibleOf = (m) => permissions.visibleMemberIds(MEMBERS, m);
  const deps = {
    getPrisma: () => db,
    permissions,
    getActiveMember: async () => state.member,
    ownerStampId: () => (state.member && state.member.id >= 0 ? state.member.id : null),
    // Real rule (scopedProfileWhere) minus the ProfileAccess relation, which the stand-in database
    // does not model; shared profiles are covered by partitionAccessibleProfileIds below.
    scopedProfileWhere: async (base) => {
      const m = state.member;
      if (!m || m.role === 'SUPER_ADMIN') return base;
      const visible = [...visibleOf(m)];
      return { AND: [base, { OR: [{ assignedMemberId: { in: visible } }, { ownerMemberId: { in: visible } }] }] };
    },
    partitionAccessibleProfileIds: async (ids, opts = {}) => {
      deps.partitionCalls.push(opts);
      const m = state.member;
      if (!m || m.role === 'SUPER_ADMIN') return { allowed: ids, denied: [] };
      const rows = await db.profile.findMany({ where: { id: { in: ids } } });
      const allowed = []; const denied = [];
      for (const id of ids) {
        const r = rows.find((x) => x.id === id);
        if (r && permissions.profileRowAccessible(visibleOf(m), r, Boolean(opts.requireEdit))) allowed.push(id); else denied.push(id);
      }
      return { allowed, denied };
    },
    partitionCalls: [],
    PERMISSIONS: permissions.ACTION_MIN_RANK,
    rankOf: permissions.rankOf
  };
  const as = (who) => {
    if (who == null) state.member = null;
    else if (who === 'super') state.member = { ...permissions.SUPER_ADMIN };
    else state.member = MEMBERS.find((m) => m.id === who);
    return state.member;
  };
  return { state, deps, as };
}

const SCOPE_FNS = ['scopedGroupWhere', 'assertCanAccessGroup', 'scopedProxyWhere', 'assertCanAccessProxy'];
const ids = (rows) => rows.map((r) => r.id).sort((a, b) => a - b);

// ---- Groups ----

function loadGroups(db = seed()) {
  const ws = workspace(db);
  const activity = [];
  const fns = loadMain([...VALIDATORS, 'requirePermission', 'collectTags', 'ownedRowManageChecker', ...SCOPE_FNS, 'listGroups', 'createGroup', 'updateGroup', 'deleteGroup', 'assignProfilesToGroup'], {
    ...ws.deps,
    logActivity: async (_db, id, action) => { activity.push([id, action]); }
  });
  return { db, ws, fns, activity };
}

test('each member lists only the groups of their subtree, older groups for Owner and Admins, and groups holding a profile they see', async () => {
  const { ws, fns } = loadGroups();
  ws.as(3); // Operator X: own group, plus the two groups that hold an X profile
  assert.deepEqual(ids(await fns.listGroups()), [10, 12, 14]);
  ws.as(4); // Operator Y never sees X's group or the older group with only an X profile
  assert.deepEqual(ids(await fns.listGroups()), [11, 13, 14]);
  for (const who of [2, 1, 'super', null]) {
    ws.as(who);
    assert.deepEqual(ids(await fns.listGroups()), [10, 11, 12, 13, 14], `member ${who}`);
  }
});

test('the Groups list counts and tags only the profiles the member can see', async () => {
  const { ws, fns } = loadGroups();
  ws.as(3);
  const g14 = (await fns.listGroups()).find((g) => g.id === 14);
  assert.equal(g14.profileCount, 1, 'Y\'s profile in the same group is not counted');
  assert.deepEqual(g14.tags, ['x2'], 'and its tags are not shown');
  ws.as(2);
  const all14 = (await fns.listGroups()).find((g) => g.id === 14);
  assert.equal(all14.profileCount, 2);
});

test('creating a group needs profiles.edit and stamps the creator as its owner', async () => {
  const { db, ws, fns } = loadGroups();
  ws.as(3);
  const g = await fns.createGroup({ name: 'Mine' });
  assert.equal((await db.group.findUnique({ where: { id: g.id } })).ownerMemberId, 3);
  ws.as(4);
  assert.ok(!ids(await fns.listGroups()).includes(g.id), 'a sibling does not see it');
  ws.as(2);
  assert.ok(ids(await fns.listGroups()).includes(g.id), 'the Admin above does');

  // A member whose profiles.edit was turned off, and a suspended member, are refused.
  MEMBERS[2].permissionsJson = JSON.stringify({ actions: { 'profiles.edit': false } });
  try {
    ws.as(3);
    await assert.rejects(fns.createGroup({ name: 'Nope' }), /turned off for your account by an administrator/);
  } finally { delete MEMBERS[2].permissionsJson; }
  ws.state.member = { ...MEMBERS[2], status: 'suspended' };
  await assert.rejects(fns.createGroup({ name: 'Nope' }), /This member is suspended\./);
  ws.state.member = { id: 9, role: 'NONE', status: 'active' }; // no role rank at all
  await assert.rejects(fns.createGroup({ name: 'Nope' }), /Your role does not permit this action\./);
  assert.equal((await db.group.findMany({ where: { name: 'Nope' } })).length, 0);

  ws.as(null); // single-user mode: no owner to stamp, and everything is allowed
  const solo = await fns.createGroup({ name: 'Solo' });
  assert.equal((await db.group.findUnique({ where: { id: solo.id } })).ownerMemberId, null);
});

test('only a group of the member\'s subtree (or, for Owner and Admins, an older one) can be renamed or deleted', async () => {
  const { db, ws, fns } = loadGroups();
  ws.as(3);
  assert.equal((await fns.updateGroup({ id: 10, name: 'X renamed' })).name, 'X renamed');
  for (const id of [11, 12, 14]) {
    await assert.rejects(fns.updateGroup({ id, name: 'hijack' }), /You do not have access to this group\./, `rename ${id}`);
    await assert.rejects(fns.deleteGroup({ id }), /You do not have access to this group\./, `delete ${id}`);
  }
  await assert.rejects(fns.updateGroup({ id: 99, name: 'gone' }), /Group not found\./);
  assert.equal((await db.profile.findUnique({ where: { id: 102 } })).groupId, 14, 'a refused delete detaches nothing');
  assert.equal((await db.group.findUnique({ where: { id: 14 } })).name, 'Y group with an X profile in it');

  ws.as(2); // the Admin manages older groups and the operators' groups
  await fns.updateGroup({ id: 12, name: 'Older, renamed' });
  await fns.deleteGroup({ id: 14 });
  assert.equal(await db.group.findUnique({ where: { id: 14 } }), null);
  assert.equal((await db.profile.findUnique({ where: { id: 102 } })).groupId, null, 'its profiles are detached');
});

test('moving profiles into a group needs profiles.edit, edit access to each profile and a group the member can see', async () => {
  const { db, ws, fns, activity } = loadGroups();
  ws.as(3);
  const res = await fns.assignProfilesToGroup({ ids: [100, 104, 105, 101], groupId: 10 });
  assert.equal(res.assigned, 2, 'X\'s own two; not the use-only share, not Y\'s profile');
  assert.deepEqual(ws.deps.partitionCalls.at(-1), { requireEdit: true });
  assert.equal((await db.profile.findUnique({ where: { id: 104 } })).groupId, null);
  assert.equal((await db.profile.findUnique({ where: { id: 101 } })).groupId, 13);
  assert.deepEqual(activity.map(([id]) => id).sort(), [100, 105], 'only moved profiles get an activity line');

  await assert.rejects(fns.assignProfilesToGroup({ ids: [105], groupId: 11 }), /You do not have access to this group\./);
  await assert.rejects(fns.assignProfilesToGroup({ ids: [105], groupId: 99 }), /Selected group does not exist\./);
  // A group X sees through one of their profiles can be used, as in the editor.
  assert.equal((await fns.assignProfilesToGroup({ ids: [105], groupId: 14 })).assigned, 1);
});

test('the dashboard group count and the tag list follow the same scoping', async () => {
  assert.match(extractFunction(IPC, 'getDashboardStats'), /db\.group\.count\(\{ where: await scopedGroupWhere\(undefined\) \}\)/);
  const db = seed();
  const ws = workspace(db);
  const { listTags } = loadMain(['collectTags', 'listTags'], ws.deps);
  ws.as(3);
  assert.deepEqual(await listTags(), ['x', 'x2']);
  ws.as(2);
  assert.deepEqual(await listTags(), ['x', 'x2', 'y-hidden', 'y-secret']);
});

// ---- Profiles: proxy and group ids from an API caller ----

function loadProfileFns(db = seed()) {
  const ws = workspace(db);
  const fns = loadMain([...VALIDATORS, ...SCOPE_FNS, 'createProfile', 'updateProfile'], {
    ...ws.deps,
    requirePermission: async () => {}, restoreMaskedSecrets: (x) => x, assertWithinLimit: async () => {},
    findOrCreateProxy: async () => null, proxyTypeHintFor: () => null, ensureUniqueDataDirName: async (_db, n) => n,
    buildProxyInfoString: (p) => `${p.host}:${p.port}`, validateSystemProxyBehavior: (v) => v || 'DIRECT',
    buildFingerprintFields: () => ({}), logActivity: async () => {}, serializeProfile: (p) => p,
    assertCanAccessProfile: async () => {}, extractFingerprintData: () => ({}), sanitizeDataDirName: (v) => v, console,
    settleDeviceIdentity: async () => {} // device name / MAC: test/profileOptions.test.js
  });
  return { db, ws, fns };
}

test('createProfile refuses another member\'s proxy id and a group the member cannot see', async () => {
  const { db, ws, fns } = loadProfileFns();
  ws.as(3);
  await assert.rejects(fns.createProfile({ title: 'A', proxyId: 21, systemProxyBehavior: 'PROFILE_PROXY' }), /You do not have access to this proxy\./);
  await assert.rejects(fns.createProfile({ title: 'A', proxyId: 22 }), /You do not have access to this proxy\./, 'not even the Owner\'s');
  await assert.rejects(fns.createProfile({ title: 'A', groupId: 11 }), /You do not have access to this group\./);
  assert.equal((await db.profile.findMany({ where: { title: 'A' } })).length, 0, 'nothing is written');

  const ok = await fns.createProfile({ title: 'B', proxyId: 20, groupId: 14, systemProxyBehavior: 'PROFILE_PROXY' });
  assert.equal(ok.proxyId, 20);
  assert.equal(ok.groupId, 14);
  await assert.rejects(fns.createProfile({ title: 'C', proxyId: 99 }), /Selected proxy does not exist\./);

  ws.as(1); // the Owner may use proxies of the whole team
  assert.equal((await fns.createProfile({ title: 'D', proxyId: 21 })).proxyId, 21);
  ws.as(null);
  assert.equal((await fns.createProfile({ title: 'E', proxyId: 21, groupId: 11 })).groupId, 11, 'single-user mode is unrestricted');
});

test('updateProfile refuses a new proxy or group the member cannot use, and keeps the current ones', async () => {
  const { db, ws, fns } = loadProfileFns();
  ws.as(3);
  // 106 is the Owner's profile shared with X for editing; it runs on the Owner's proxy in an older group.
  await fns.updateProfile({ id: 106, title: 'renamed', proxyId: 22, groupId: 13 });
  assert.equal((await db.profile.findUnique({ where: { id: 106 } })).title, 'renamed', 'the unchanged proxy and group save');
  await assert.rejects(fns.updateProfile({ id: 106, proxyId: 21 }), /You do not have access to this proxy\./);
  await assert.rejects(fns.updateProfile({ id: 106, groupId: 11 }), /You do not have access to this group\./);
  const row = await db.profile.findUnique({ where: { id: 106 } });
  assert.equal(row.proxyId, 22);
  assert.equal(row.groupId, 13);
  await fns.updateProfile({ id: 106, proxyId: 20, groupId: 10 });
  const moved = await db.profile.findUnique({ where: { id: 106 } });
  assert.equal(moved.proxyId, 20);
  assert.equal(moved.groupId, 10);
});

test('Quick generate checks the chosen group once, before any proxy is checked, and owns a new group', () => {
  const body = extractFunction(IPC, 'batchGenerateProfiles');
  const check = body.indexOf('if (groupId !== null) await assertCanAccessGroup(groupId);');
  assert.ok(check > -1 && check < body.indexOf('proxyGate.collectWorkingProxies'));
  assert.match(body, /db\.group\.create\(\{ data: \{ name: newGroupName\.slice\(0, 80\), ownerMemberId: ownerStampId\(\) \} \}\)/);
});

// ---- Batch import ----

function loadImport(db, items, opts = {}) {
  const ws = workspace(db);
  const cache = new Map([['tok', { parsed: { fileName: 'p.xlsx', sheetName: 'S', headerRow: 1, totalRows: items.length, errors: [], items } }]]);
  const madeProxies = [];
  const sent = [];
  const fns = loadMain([...VALIDATORS, 'requirePermission', 'limitError', 'assertWithinLimit', 'proxyAddContext', ...SCOPE_FNS, 'commitProfileImport'], {
    ...ws.deps,
    importPreviewCache: cache, CHANNELS: { BATCH_IMPORT_PROGRESS: 'p' }, proxyScope,
    toCountryCode: (v) => String(v || '').trim().toUpperCase(), countryMatches: (a, b) => Boolean(a) && String(a).toUpperCase() === String(b || '').toUpperCase(),
    readSetting: async () => ({}), writeSetting: async () => {},
    findOrCreateProxy: async (_db, raw) => { madeProxies.push(raw); return db.proxy.create({ data: { name: raw, type: 'HTTP', host: raw, port: 1, ownerMemberId: ws.deps.ownerStampId() } }); },
    serializeProxy: (p) => p, parseSystemProxyBehavior: (_v, d) => d, doNotTrackChoice: (v) => v,
    ensureUniqueDataDirName: async (_db, n) => n, generateFingerprint: () => ({}), buildProxyInfoString: (p) => `${p.host}:${p.port}`,
    serializeProfile: (p) => p, logActivity: async () => {},
    claimDeviceIdentity: async (_db, _st, d) => d, // device name / MAC: test/profileOptions.test.js
    ...opts
  });
  const event = { sender: { send: (_c, data) => sent.push(data) } };
  return { ws, cache, madeProxies, sent, run: (payload = {}) => fns.commitProfileImport({ token: 'tok', ...payload }, event) };
}

test('batch import needs the profiles.create permission', async () => {
  const db = seed();
  const imp = loadImport(db, [{ row: 2, title: 'One' }]);
  MEMBERS[2].permissionsJson = JSON.stringify({ actions: { 'profiles.create': false } });
  try {
    imp.ws.as(3);
    await assert.rejects(imp.run(), /turned off for your account by an administrator/);
  } finally { delete MEMBERS[2].permissionsJson; }
  imp.ws.state.member = { id: 9, role: 'NONE', status: 'active' };
  await assert.rejects(imp.run(), /Your role does not permit this action\./);
  assert.equal((await db.profile.findMany({ where: { title: 'One' } })).length, 0);
  assert.equal(imp.sent.length, 0, 'refused before the import starts');
  assert.ok(imp.cache.has('tok'), 'the preview is kept');
});

test('batch import keeps to the member\'s profile limit: refused at the limit, stopped when it is reached', async () => {
  // Operator X may hold 3 profiles; the stand-in workspace gives X three already (100, 102, 105).
  MEMBERS[2].permissionsJson = JSON.stringify({ maxProfiles: 3 });
  try {
    const full = loadImport(seed(), [{ row: 2, title: 'One' }]);
    full.ws.as(3);
    await assert.rejects(full.run(), /You've reached your profile limit \(3\)/);
    assert.equal(full.sent.length, 0);

    // With one profile of their own, two of the four rows fit; the third stops the import, and no
    // proxy is made for it or for the row after it.
    const db = createFakePrisma({ member: MEMBERS.map((m) => ({ ...m })), profile: [{ id: 1, title: 'mine', ownerMemberId: 3, deletedAt: null }] });
    const rows = [1, 2, 3, 4].map((n) => ({ row: n + 1, title: `P${n}`, proxyMethod: 'CUSTOM', rawProxy: `p${n}.example.net:8000` }));
    const imp = loadImport(db, rows);
    imp.ws.as(3);
    const res = await imp.run();
    assert.deepEqual(res.createdProfiles.map((p) => p.title), ['P1', 'P2']);
    assert.deepEqual(imp.madeProxies, ['p1.example.net:8000', 'p2.example.net:8000']);
    assert.equal(res.errors.length, 1);
    assert.match(res.errors[0].message, /You've reached your profile limit \(3\)/);
    assert.deepEqual(res.stoppedAtLimit, { row: 4, notImported: 2 });
    assert.ok(imp.sent.some((f) => /Import stopped: the profile limit was reached, so 1 more row was not imported\./.test(f.message)));
    assert.equal(imp.sent.at(-1).phase, 'done');
  } finally { delete MEMBERS[2].permissionsJson; }
});

test('auto-bind by country uses only proxies the importing member may use', async () => {
  const db = seed();
  await db.proxy.create({ data: { id: 23, name: 'X free', type: 'HTTP', host: 'f.example.net', port: 80, ownerMemberId: 3, provider: 'free', lastStatus: 'ok', lastCountry: 'US' } });
  await db.proxy.create({ data: { id: 24, name: 'Y free', type: 'HTTP', host: 'g.example.net', port: 80, ownerMemberId: 4, provider: 'free', lastStatus: 'ok', lastCountry: 'US' } });
  const rows = [1, 2, 3].map((n) => ({ row: n + 1, title: `US-${n}`, country: 'US' }));
  const imp = loadImport(db, rows);
  imp.ws.as(3);
  const res = await imp.run({ autoBindByCountry: true });
  assert.deepEqual(res.autoBound.map((a) => a.proxy.id), [20, 20, 20], 'never Y\'s or the Owner\'s US proxy');

  imp.cache.set('tok', { parsed: { fileName: 'p.xlsx', sheetName: 'S', headerRow: 1, totalRows: 2, errors: [], items: rows.slice(0, 2) } });
  const free = await imp.run({ autoBindByCountry: true, autoBindSource: 'free' });
  assert.deepEqual(free.autoBound.map((a) => a.proxy.id), [23, 23]);

  imp.ws.as(1); // the Owner's pool is the whole team's
  imp.cache.set('tok', { parsed: { fileName: 'p.xlsx', sheetName: 'S', headerRow: 1, totalRows: 3, errors: [], items: rows } });
  assert.deepEqual((await imp.run({ autoBindByCountry: true })).autoBound.map((a) => a.proxy.id).sort(), [20, 21, 22]);
});

test('a group named in the file is reused only if the member can see it; otherwise the import makes its own', async () => {
  const db = seed();
  await db.group.create({ data: { id: 15, name: 'Lead Gen', ownerMemberId: 4 } }); // Y's group with the same name
  const imp = loadImport(db, [{ row: 2, title: 'A', group: 'Lead Gen' }, { row: 3, title: 'B', group: 'Lead Gen' }, { row: 4, title: 'C', group: 'X own' }]);
  imp.ws.as(3);
  const res = await imp.run();
  const made = await db.group.findMany({ where: { name: 'Lead Gen', ownerMemberId: 3 } });
  assert.equal(made.length, 1, 'one new group, owned by the importer, used for both rows');
  assert.deepEqual(res.createdProfiles.map((p) => p.groupId), [made[0].id, made[0].id, 10]);
  assert.equal((await db.profile.findMany({ where: { groupId: 15 } })).length, 0, 'Y\'s group is never joined');
});

// ---- Proxy rotation ----

function loadRotation(db, policy = 'each-launch') {
  const settings = new Map();
  const accessCalls = [];
  const activity = [];
  const fns = loadMain(['requireObject', 'parseId', 'setProxyRotation', 'pickRotationProxy'], {
    requirePermission: async () => {},
    assertCanAccessProfile: async (id, opts) => { accessCalls.push([id, opts]); },
    getPrisma: () => db,
    scopedProxyWhere: async (w) => w,
    proxyScope,
    readSetting: async (k, d) => (settings.has(k) ? JSON.parse(JSON.stringify(settings.get(k))) : d),
    writeSetting: async (k, v) => { settings.set(k, JSON.parse(JSON.stringify(v))); },
    buildProxyInfoString: (p) => `${p.host}:${p.port}`,
    logActivity: async (_db, id, action, detail) => { activity.push([id, action, detail]); },
    resolveProxyPolicyMode: async () => policy,
    withRotationCursorLock: (fn) => fn(),
    crypto
  });
  return { fns, settings, accessCalls, activity };
}

function rotationDb() {
  return createFakePrisma({
    profile: [
      { id: 1, title: 'direct', proxyId: null, proxyInfoString: null, systemProxyBehavior: 'DIRECT', deletedAt: null },
      { id: 2, title: 'own proxy', proxyId: 9, proxyInfoString: 'own.example.net:9', systemProxyBehavior: 'PROFILE_PROXY', deletedAt: null },
      { id: 3, title: 'proxy kept but off', proxyId: 9, proxyInfoString: 'own.example.net:9', systemProxyBehavior: 'DIRECT', deletedAt: null }
    ],
    proxy: [
      { id: 5, name: 'Pool A', type: 'HTTP', host: 'a.example.net', port: 1, provider: null },
      { id: 6, name: 'Pool B', type: 'HTTP', host: 'b.example.net', port: 2, provider: null },
      { id: 7, name: 'Free', type: 'HTTP', host: 'f.example.net', port: 3, provider: 'free' },
      { id: 9, name: 'Own', type: 'HTTP', host: 'own.example.net', port: 9, provider: null }
    ]
  });
}

test('turning a pool on for a profile with no proxy of its own makes the first pool proxy its proxy', async () => {
  const db = rotationDb();
  const { fns, settings, accessCalls, activity } = loadRotation(db);
  const res = await fns.setProxyRotation({ id: 1, enabled: true, mode: 'round-robin', proxyIds: [6, 5] });
  assert.deepEqual(res.assignedProxy, { id: 6, name: 'Pool B' });
  const p = await db.profile.findUnique({ where: { id: 1 } });
  assert.equal(p.proxyId, 6);
  assert.equal(p.systemProxyBehavior, 'PROFILE_PROXY');
  assert.equal(p.proxyInfoString, 'b.example.net:2');
  assert.deepEqual(settings.get('proxyRotation')[1], { enabled: true, mode: 'round-robin', proxyIds: [6, 5] });
  assert.deepEqual(activity.map(([id, action]) => [id, action]), [[1, 'proxy-reassign']]);
  assert.deepEqual(accessCalls[0], [1, { requireEdit: true }], 'a use-only share cannot change the pool');

  // A profile set to DIRECT with a proxy still stored also gets the pool's first proxy, switched on.
  const off = await fns.setProxyRotation({ id: 3, enabled: true, proxyIds: [5] });
  assert.deepEqual(off.assignedProxy, { id: 5, name: 'Pool A' });
  assert.equal((await db.profile.findUnique({ where: { id: 3 } })).systemProxyBehavior, 'PROFILE_PROXY');
});

test('a profile that already routes through its own proxy keeps it, and turning a pool off changes nothing', async () => {
  const db = rotationDb();
  const { fns } = loadRotation(db);
  assert.equal((await fns.setProxyRotation({ id: 2, enabled: true, proxyIds: [5, 6] })).assignedProxy, null);
  assert.equal((await db.profile.findUnique({ where: { id: 2 } })).proxyId, 9);
  assert.equal((await fns.setProxyRotation({ id: 1, enabled: false, proxyIds: [] })).assignedProxy, null);
  assert.equal((await db.profile.findUnique({ where: { id: 1 } })).proxyId, null);
  // A refused pool writes nothing to the profile either.
  await assert.rejects(fns.setProxyRotation({ id: 1, enabled: true, proxyIds: [7] }), /Free proxies cannot join a rotation pool\./);
  await assert.rejects(fns.setProxyRotation({ id: 1, enabled: true, proxyIds: [] }), /Select at least one proxy/);
  assert.equal((await db.profile.findUnique({ where: { id: 1 } })).proxyId, null);
});

test('Sticky never opens a pooled profile on the real IP, and still never rotates', async () => {
  const db = rotationDb();
  const { fns, settings } = loadRotation(db, 'sticky');
  settings.set('proxyRotation', {
    1: { enabled: true, mode: 'round-robin', proxyIds: [6, 5] }, // a pool turned on before this fix: no own proxy
    2: { enabled: true, mode: 'round-robin', proxyIds: [6, 5] }
  });
  assert.equal(await fns.pickRotationProxy(db, 2), null, 'own proxy: launch keeps it (unchanged)');
  for (let i = 0; i < 3; i += 1) assert.equal((await fns.pickRotationProxy(db, 1)).id, 6, 'no own proxy: the first pool proxy, every launch');
  assert.equal(settings.has('proxyRotationState'), false, 'the round-robin cursor does not move');
  assert.equal(await fns.pickRotationProxy(db, 3), null, 'no pool: nothing to fall back to (unchanged)');

  const each = loadRotation(db, 'each-launch');
  each.settings.set('proxyRotation', { 2: { enabled: true, mode: 'round-robin', proxyIds: [6, 5] } });
  assert.deepEqual([await each.fns.pickRotationProxy(db, 2), await each.fns.pickRotationProxy(db, 2)].map((p) => p.id), [6, 5], 'other policies rotate as before');
});

test('the row dialog sends the pool in list order and says when the profile got a proxy', () => {
  assert.match(ROTATION_MODAL, /proxyIds: rotationPoolIds\(proxies, Array\.from\(selected\)\)/);
  assert.match(ROTATION_MODAL, /t\('proxyRotation\.infoSavedOwnProxy', \{ name: assigned\.name \}\)/);
  assert.match(ROTATION_MODAL, /if \(assigned && onSaved\) onSaved\(\);/);
  assert.match(PAGE, /onClose=\{\(\) => setRotationProfile\(null\)\}\s*onSaved=\{loadData\}/, 'the list reloads to show the new proxy');
  for (const lang of ['en', 'es']) {
    const text = locale(lang, 'cmpModalsB').proxyRotation.infoSavedOwnProxy;
    assert.match(text, /\{\{name\}\}/, lang);
  }
});

// ---- SoftGlaze AI sees the same groups ----

test('the AI tools list, resolve and de-duplicate groups through the member\'s group scope', async () => {
  const reg = require('../src/main/ai/toolRegistry');
  const aiSettings = require('../src/main/ai/aiSettings');
  const { ApprovalManager } = require('../src/main/ai/approvals');
  const { createFakeApp } = require('./helpers/aiFakes');
  assert.ok(reg.ALLOWED_DEPS.includes('scopedGroupWhere'));
  assert.match(extractFunction(IPC, 'buildAiToolDeps'), /\n {4}scopedGroupWhere,\r?\n/);
  assert.match(read('src', 'main', 'ai', 'tools.js'), /ctx\.db\.group\.findMany\(\{ where: await ctx\.deps\.scopedGroupWhere\(undefined\), select: \{ id: true, name: true \} \}\)/);

  const app = createFakeApp();
  // The token's member sees group 1 only.
  app.toolDeps.scopedGroupWhere = async (w) => (w ? { AND: [w, { id: { in: [1] } }] } : { id: { in: [1] } });
  const settings = aiSettings.normalizeStored({ enabled: true });
  const services = {
    settings: () => settings, isEnabled: () => true, approvals: new ApprovalManager({ timeoutMs: 2000, emit: () => {} }),
    audit: { record: async () => {} }, memory: null, tracker: new reg.AiTracker(), jobs: new reg.JobStore({ inlineMs: 200 }), limiter: new reg.RateLimiter()
  };
  const registry = new reg.ToolRegistry({ deps: app.toolDeps, services, inlineWaitMs: 300 });
  const token = { id: 1, name: 'Test token', kind: 'ai', scope: 'read', groupIds: [], preApproved: null, memberId: 2 };
  const r = await registry.call('list_groups', {}, { token, clientName: 'Test client', transport: 'mcp' });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.data.groups.map((g) => g.name), ['QA']);
  const p = await registry.call('list_profiles', { group: 'Client Acme' }, { token, clientName: 'Test client', transport: 'mcp' });
  assert.equal(p.ok, false);
  assert.match(p.error, /There is no group "Client Acme"/);
});

// ---- Schema ----

test('a migration adds the group owner column; older groups keep NULL', (t) => {
  const model = /model Group \{[\s\S]*?\n\}/.exec(read('prisma', 'schema.prisma'))[0];
  assert.match(model, /ownerMemberId Int\?/);
  assert.match(model, /@@index\(\[ownerMemberId\]\)/);
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) { t.skip('node:sqlite is not available in this Node build'); return; }
  const MIGRATION = '20261110000000_group_owner';
  const dir = path.join(ROOT, 'prisma', 'migrations');
  const folders = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d{14}_/.test(d.name)).map((d) => d.name).sort();
  assert.ok(folders.includes(MIGRATION));
  // Same comment stripping and statement split as database.js applyMigrations (no quotes in this file).
  const statements = (sql) => sql.split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
  const db = new DatabaseSync(':memory:');
  for (const folder of folders) {
    if (folder === MIGRATION) db.exec(`INSERT INTO "Group" ("name") VALUES ('Made in 1.0.25')`);
    const sql = fs.readFileSync(path.join(dir, folder, 'migration.sql'), 'utf8');
    if (folder === MIGRATION) { for (const s of statements(sql)) db.exec(`${s};`); continue; }
    db.exec(sql);
  }
  const cols = db.prepare('PRAGMA table_info("Group")').all().map((c) => c.name);
  assert.ok(cols.includes('ownerMemberId'));
  assert.equal(db.prepare('SELECT "ownerMemberId" FROM "Group" WHERE "name" = ?').get('Made in 1.0.25').ownerMemberId, null);
  assert.ok(db.prepare('PRAGMA index_list("Group")').all().some((i) => i.name === 'Group_ownerMemberId_idx'));
});

// ---- Editor footer at 375 px ----

test('the editor footer wraps instead of clipping, with the same single row on a wide window', () => {
  const m = /\{\/\* Wraps instead of overflowing[\s\S]*?<div className="([^"]+)">\s*<Button variant="secondary" onClick=\{\(\) => setPreviewDraft\(pd\)\}>[\s\S]*?<div className="([^"]+)">\s*<Button variant="secondary" onClick=\{closeEditor\}>[\s\S]*?<Button variant="primary" onClick=\{handleSaveProfile\}/.exec(PAGE);
  assert.ok(m, 'footer markup');
  assert.match(m[1], /\bflex flex-wrap gap-3\b/);
  assert.doesNotMatch(m[1], /justify-end/);
  assert.equal(m[2], 'ml-auto flex gap-3', 'Cancel and Save stay together on the right');
  assert.doesNotMatch(PAGE, /<div className="flex-1" \/>\s*<Button variant="secondary" onClick=\{closeEditor\}>/, 'no spacer left');
});
