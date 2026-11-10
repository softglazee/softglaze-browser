'use strict';
// 1.0.26 permission follow-ups (the gaps PR #62 listed as "noticed, not fixed"):
//  1. Proxy groups had no permission checks and an unscoped list.
//  2. Templates were workspace-wide, and a profile made from one (or a copy of a shared profile)
//     could link another member's proxy or join a group the member cannot see.
//  3. setProxyPolicy (and the proxy check schedule next to it) had no permission or profile check.
//  4. Bulk tag and bulk rename had no permission check and accepted "use only" shares.
//  5. findOrCreateProxy reused another member's proxy row (their pool then listed this member's
//     profile title) and skipped the proxy limit.
//  6. A deleted proxy left its profiles with a cached proxy string that launch still used.
//  Siblings: Trash actions accepted "use only" shares and restore had no permission check.
// Main-process functions run for real from ipcHandlers.js with the real permissions module and an
// in-memory database stand-in (test/helpers/fakePrisma.js), as in test/permissionGaps.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const permissions = require('../src/main/permissions');
const proxyScope = require('../src/main/proxyScope');
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

// Runs main-process functions from ipcHandlers.js in this realm with the given stand-ins.
function loadMain(names, deps) {
  const src = names.map((n) => extractFunction(IPC, n)).join('\n');
  const keys = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  return new Function(...keys, `${src}\nreturn { ${names.join(', ')} };`)(...keys.map((k) => deps[k]));
}
const VALIDATORS = ['requireObject', 'optionalString', 'requiredString', 'parseId', 'parseIdArray'];
const SCOPE_FNS = ['scopedGroupWhere', 'assertCanAccessGroup', 'scopedProxyWhere', 'assertCanAccessProxy', 'partitionAccessibleProxyIds',
  'scopedProxyGroupWhere', 'assertCanAccessProxyGroup', 'scopedTemplateWhere', 'assertCanAccessTemplate', 'assertCanAccessProfile'];
const ids = (rows) => rows.map((r) => r.id).sort((a, b) => a - b);

// ---- The team: Owner 1 > Admin 2 > Operators 3 and 4 (siblings) and Manager 5 ----

const MEMBERS = [
  { id: 1, name: 'Owner', role: 'OWNER', parentMemberId: null, status: 'active' },
  { id: 2, name: 'Admin', role: 'ADMIN', parentMemberId: 1, status: 'active' },
  { id: 3, name: 'Operator X', role: 'OPERATOR', parentMemberId: 2, status: 'active' },
  { id: 4, name: 'Operator Y', role: 'OPERATOR', parentMemberId: 2, status: 'active' },
  { id: 5, name: 'Manager', role: 'MANAGER', parentMemberId: 2, status: 'active' }
];

function seed(extra = {}) {
  return createFakePrisma({
    member: MEMBERS.map((m) => ({ ...m })),
    group: [
      { id: 10, name: 'X own', ownerMemberId: 3 },
      { id: 11, name: 'Y own', ownerMemberId: 4 },
      { id: 13, name: 'Older, holds a Y profile', ownerMemberId: null }
    ],
    profile: [
      { id: 100, title: 'x-1', ownerMemberId: 3, assignedMemberId: 3, groupId: 10, proxyId: 20, proxyInfoString: 'x.example.net:8000', systemProxyBehavior: 'PROFILE_PROXY', tags: '["x"]', deletedAt: null },
      { id: 101, title: 'y-1', ownerMemberId: 4, assignedMemberId: 4, groupId: 13, proxyId: 21, proxyInfoString: 'y.example.net:8000', systemProxyBehavior: 'PROFILE_PROXY', tags: '["y"]', deletedAt: null },
      // The Owner's profiles shared with X: 104 for use only, 106 for editing (on the Owner's proxy, in an older group).
      { id: 104, title: 'shared-use', ownerMemberId: 1, assignedMemberId: 1, groupId: null, deletedAt: null, accesses: [{ memberId: 3, level: 'use' }] },
      { id: 105, title: 'x-2', ownerMemberId: 3, assignedMemberId: 3, groupId: null, deletedAt: null },
      { id: 106, title: 'shared-edit', ownerMemberId: 1, assignedMemberId: 1, groupId: 13, proxyId: 22, proxyInfoString: 'o.example.net:8000', systemProxyBehavior: 'PROFILE_PROXY', deletedAt: null, accesses: [{ memberId: 3, level: 'edit' }] }
    ],
    proxy: [
      { id: 20, name: 'X proxy', type: 'HTTP', host: 'x.example.net', port: 8000, ownerMemberId: 3, provider: null, proxyGroupId: 34, lastCountry: 'US' },
      { id: 21, name: 'Y proxy', type: 'HTTP', host: 'y.example.net', port: 8000, ownerMemberId: 4, provider: null, proxyGroupId: 31, lastCountry: 'US' },
      { id: 22, name: 'Owner proxy', type: 'HTTP', host: 'o.example.net', port: 8000, ownerMemberId: 1, provider: null, proxyGroupId: 32, lastCountry: 'US' },
      { id: 23, name: 'X second', type: 'HTTP', host: 'x2.example.net', port: 8000, ownerMemberId: 3, provider: null, proxyGroupId: 30, lastCountry: 'DE' },
      { id: 24, name: 'Y in the shared group', type: 'HTTP', host: 'y2.example.net', port: 8000, ownerMemberId: 4, provider: null, proxyGroupId: 34, lastCountry: 'US' },
      { id: 25, name: 'Y gateway', type: 'HTTP', host: 'gw.example.net', port: 7000, username: 'u', password: 'p', ownerMemberId: 4, provider: null, proxyGroupId: null }
    ],
    proxyGroup: [
      { id: 30, name: 'X own', ownerMemberId: 3, autoCreated: false },
      { id: 31, name: 'United States', ownerMemberId: 4, autoCreated: true },
      { id: 32, name: 'Older', ownerMemberId: null, autoCreated: false },
      { id: 34, name: 'Y group holding an X proxy', ownerMemberId: 4, autoCreated: false }
    ],
    template: [
      // Saved by X from a profile on Y's proxy in Y's group (possible through a share), and X's own.
      { id: 40, name: 'X, foreign refs', ownerMemberId: 3, dataJson: JSON.stringify({ os: 'Windows', proxyId: 21, proxyInfoString: 'y.example.net:8000', systemProxyBehavior: 'PROFILE_PROXY', groupId: 11 }) },
      { id: 41, name: 'Y template', ownerMemberId: 4, dataJson: JSON.stringify({ os: 'macOS' }) },
      { id: 42, name: 'Made before 1.0.26', ownerMemberId: null, dataJson: JSON.stringify({ os: 'Linux' }) },
      { id: 43, name: 'X, own refs', ownerMemberId: 3, dataJson: JSON.stringify({ os: 'Windows', proxyId: 20, proxyInfoString: 'x.example.net:8000', systemProxyBehavior: 'PROFILE_PROXY', groupId: 10 }) }
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
    // does not model; shares are covered by partitionAccessibleProfileIds and assertCanAccessProfile.
    scopedProfileWhere: async (base) => {
      const m = state.member;
      if (!m || m.role === 'SUPER_ADMIN') return base;
      const visible = [...visibleOf(m)];
      return { AND: [base, { OR: [{ assignedMemberId: { in: visible } }, { ownerMemberId: { in: visible } }] }] };
    },
    partitionAccessibleProfileIds: async (list, opts = {}) => {
      const m = state.member;
      if (!m || m.role === 'SUPER_ADMIN') return { allowed: list, denied: [] };
      const rows = await db.profile.findMany({ where: { id: { in: list } } });
      const allowed = []; const denied = [];
      for (const id of list) {
        const r = rows.find((x) => x.id === id);
        if (r && permissions.profileRowAccessible(visibleOf(m), r, Boolean(opts.requireEdit))) allowed.push(id); else denied.push(id);
      }
      return { allowed, denied };
    },
    PROFILE_ACCESS_SELECT: { id: true, ownerMemberId: true, assignedMemberId: true, accesses: true },
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

// A member with one action turned off by whoever manages them, for the duration of `fn`.
async function withRevoked(memberId, action, fn) {
  const m = MEMBERS.find((x) => x.id === memberId);
  m.permissionsJson = JSON.stringify({ actions: { [action]: false } });
  try { await fn(); } finally { delete m.permissionsJson; }
}

// ---- 1. Proxy groups ----

function loadProxyGroups(db = seed()) {
  const ws = workspace(db);
  const audit = [];
  const fns = loadMain([...VALIDATORS, 'requirePermission', 'ownedRowManageChecker', ...SCOPE_FNS, 'pruneEmptyAutoGroups', 'listProxyGroups', 'createProxyGroup', 'updateProxyGroup', 'deleteProxyGroup', 'assignProxiesToGroup', 'autoGroupProxies', 'autoGroupColor'], {
    ...ws.deps, proxyScope,
    logAudit: async (action, info) => { audit.push([action, info]); },
    normCountryCode: (v) => (v ? String(v).trim().toUpperCase() : null),
    AUTO_GROUP_COUNTRY_NAMES: { US: 'United States', DE: 'Germany' },
    AUTO_GROUP_COLORS: ['#3b82f6']
  });
  return { db, ws, fns, audit };
}

test('each member lists only the proxy groups of their subtree, older ones for Owner and Admins, and groups holding a proxy they use', async () => {
  const { ws, fns } = loadProxyGroups();
  ws.as(3); // X: own group, and Y's group that holds X's proxy; never Y's own group or the older one
  const x = await fns.listProxyGroups();
  assert.deepEqual(ids(x), [30, 34]);
  assert.equal(x.find((g) => g.id === 34).proxyCount, 1, 'Y\'s proxy in the same group is not counted for X');
  assert.deepEqual(x.map((g) => [g.id, g.canManage]), [[30, true], [34, false]], 'the page can disable rename and delete on Y\'s group');
  ws.as(4);
  assert.deepEqual(ids(await fns.listProxyGroups()), [31, 34]);
  for (const who of [2, 1, 'super', null]) {
    ws.as(who);
    const all = await fns.listProxyGroups();
    assert.deepEqual(ids(all), [30, 31, 32, 34], `member ${who}`);
    assert.equal(all.find((g) => g.id === 34).proxyCount, 2, `member ${who} counts both`);
  }
});

test('creating a proxy group needs proxies.manage and stamps the creator; a sibling never sees it', async () => {
  const { db, ws, fns } = loadProxyGroups();
  ws.as(3);
  const g = await fns.createProxyGroup({ name: 'X second' });
  assert.equal((await db.proxyGroup.findUnique({ where: { id: g.id } })).ownerMemberId, 3);
  ws.as(4);
  assert.ok(!ids(await fns.listProxyGroups()).includes(g.id));
  await withRevoked(4, 'proxies.manage', async () => {
    ws.as(4);
    await assert.rejects(fns.createProxyGroup({ name: 'Nope' }), /turned off for your account by an administrator/);
    await assert.rejects(fns.assignProxiesToGroup({ ids: [21], groupId: 31 }), /turned off for your account by an administrator/);
    await assert.rejects(fns.autoGroupProxies({ level: 'country' }), /turned off for your account by an administrator/);
  });
  ws.state.member = { id: 9, role: 'NONE', status: 'active' };
  await assert.rejects(fns.createProxyGroup({ name: 'Nope' }), /Your role does not permit this action\./);
  assert.equal((await db.proxyGroup.findMany({ where: { name: 'Nope' } })).length, 0);
});

test('only a proxy group of the member\'s subtree (or, for Owner and Admins, an older one) can be renamed or deleted', async () => {
  const { db, ws, fns } = loadProxyGroups();
  ws.as(3);
  assert.equal((await fns.updateProxyGroup({ id: 30, name: 'X renamed' })).name, 'X renamed');
  for (const id of [31, 32, 34]) {
    await assert.rejects(fns.updateProxyGroup({ id, name: 'hijack' }), /You do not have access to this proxy group\./, `rename ${id}`);
    await assert.rejects(fns.deleteProxyGroup({ id }), /You do not have access to this proxy group\./, `delete ${id}`);
  }
  await assert.rejects(fns.deleteProxyGroup({ id: 99 }), /Proxy group not found\./);
  assert.equal((await db.proxy.findUnique({ where: { id: 20 } })).proxyGroupId, 34, 'a refused delete detaches nothing');

  ws.as(2); // the Admin manages the older group and the operators' groups
  await fns.updateProxyGroup({ id: 32, name: 'Older, renamed' });
  await fns.deleteProxyGroup({ id: 34 });
  assert.equal(await db.proxyGroup.findUnique({ where: { id: 34 } }), null);
  assert.equal((await db.proxy.findUnique({ where: { id: 20 } })).proxyGroupId, null, 'its proxies are kept, ungrouped');
});

test('moving proxies into a group needs proxies.manage, moves only the member\'s proxies, into a group they can see', async () => {
  const { db, ws, fns } = loadProxyGroups();
  ws.as(3);
  assert.equal((await fns.assignProxiesToGroup({ ids: [23], groupId: 34 })).assigned, 1, 'a group X sees through their proxy can be used');
  const res = await fns.assignProxiesToGroup({ ids: [20, 21, 23], groupId: 30 });
  assert.equal(res.assigned, 2);
  assert.equal(res.skipped, 1, 'Y\'s proxy is skipped and counted');
  assert.equal((await db.proxy.findUnique({ where: { id: 21 } })).proxyGroupId, 31);
  await assert.rejects(fns.assignProxiesToGroup({ ids: [20], groupId: 31 }), /You do not have access to this proxy group\./);
  await assert.rejects(fns.assignProxiesToGroup({ ids: [20], groupId: 32 }), /You do not have access to this proxy group\./, 'an older group is Owner/Admin only');
  await assert.rejects(fns.assignProxiesToGroup({ ids: [20], groupId: 34 }), /You do not have access to this proxy group\./, 'with no X proxy left in it, Y\'s group is hidden again');
});

test('auto-grouping fills only groups the member can see: X gets their own "United States", never Y\'s', async () => {
  const { db, ws, fns } = loadProxyGroups();
  await db.proxy.update({ where: { id: 20 }, data: { proxyGroupId: null } }); // X's US proxy, ungrouped
  ws.as(3);
  const res = await fns.autoGroupProxies({ level: 'country', onlyUngrouped: true });
  assert.equal(res.createdGroups, 1);
  const mine = await db.proxyGroup.findMany({ where: { name: 'United States', ownerMemberId: 3 } });
  assert.equal(mine.length, 1);
  assert.equal((await db.proxy.findUnique({ where: { id: 20 } })).proxyGroupId, mine[0].id);
  assert.deepEqual((await db.proxy.findMany({ where: { proxyGroupId: 31 } })).map((p) => p.id), [21], 'Y\'s group gains nothing');
});

// ---- 2. Templates, and copies of shared profiles ----

function loadTemplates(db = seed()) {
  const ws = workspace(db);
  const fns = loadMain([...VALIDATORS, 'requirePermission', ...SCOPE_FNS, 'reconcileReferences', 'reconcileReferencesForMember', 'pickCloneableFields',
    'listTemplates', 'deleteTemplate', 'createProfileFromTemplate', 'saveProfileAsTemplate', 'cloneProfile', 'stripUseOnlySecrets', 'serializeTemplate'], {
    ...ws.deps,
    assertWithinLimit: async () => {}, ensureUniqueDataDirName: async (_db, n) => n,
    // Device name / MAC for the copy: test/profileOptions.test.js.
    claimDeviceIdentity: async (_db, _st, d) => { d.deviceName = 'DESKTOP-TEST'; d.macAddress = '00:11:22:33:44:55'; return d; }, toStoredBrowserCore: (v) => v,
    serializeProfile: (p) => p, generateFingerprint: () => ({}), CLONE_EXCLUDE: new Set(['id', 'createdAt', 'updatedAt', 'accesses'])
  });
  return { db, ws, fns };
}

test('each member lists only the templates of their subtree; older templates are Owner/Admin only', async () => {
  const { ws, fns } = loadTemplates();
  ws.as(3);
  assert.deepEqual(ids(await fns.listTemplates()), [40, 43]);
  ws.as(4);
  assert.deepEqual(ids(await fns.listTemplates()), [41]);
  ws.as(5); // the Manager sees their subtree and their Admin, none of these
  assert.deepEqual(ids(await fns.listTemplates()), []);
  for (const who of [2, 1, 'super', null]) {
    ws.as(who);
    assert.deepEqual(ids(await fns.listTemplates()), [40, 41, 42, 43], `member ${who}`);
  }
});

test('saving a template stamps its maker', async () => {
  const { db, ws, fns } = loadTemplates();
  ws.as(3);
  const tpl = await fns.saveProfileAsTemplate({ id: 105, name: 'From x-2' });
  assert.equal((await db.template.findUnique({ where: { id: tpl.id } })).ownerMemberId, 3);
  ws.as(4);
  assert.ok(!ids(await fns.listTemplates()).includes(tpl.id));
});

test('deleting a template needs profiles.create and a template the member can see', async () => {
  const { db, ws, fns } = loadTemplates();
  ws.as(3);
  await assert.rejects(fns.deleteTemplate({ id: 41 }), /You do not have access to this template\./);
  await assert.rejects(fns.deleteTemplate({ id: 42 }), /You do not have access to this template\./);
  await assert.rejects(fns.deleteTemplate({ id: 99 }), /Template not found\./);
  await withRevoked(3, 'profiles.create', async () => {
    ws.as(3);
    await assert.rejects(fns.deleteTemplate({ id: 43 }), /turned off for your account by an administrator/);
  });
  assert.equal((await db.template.findMany()).length, 4, 'nothing deleted');
  ws.as(3);
  await fns.deleteTemplate({ id: 43 });
  ws.as(2);
  await fns.deleteTemplate({ id: 42 });
  assert.deepEqual(ids(await db.template.findMany()), [40, 41]);
});

test('a profile made from a template never links a proxy or joins a group the member cannot use, and says so', async () => {
  const { db, ws, fns } = loadTemplates();
  ws.as(3);
  const p = await fns.createProfileFromTemplate({ templateId: 40, title: 'From foreign' });
  assert.equal(p.proxyId, null);
  assert.equal(p.proxyInfoString, null, 'the cached address of Y\'s proxy is not copied either');
  assert.equal(p.systemProxyBehavior, 'PROFILE_PROXY', 'still wants a proxy, so launch asks for one instead of using the real IP');
  assert.equal(p.groupId, null);
  assert.deepEqual(p.leftOut, { proxy: true, group: true });
  assert.equal(p.ownerMemberId, 3);

  const own = await fns.createProfileFromTemplate({ templateId: 43, title: 'From own' });
  assert.equal(own.proxyId, 20);
  assert.equal(own.groupId, 10);
  assert.deepEqual(own.leftOut, { proxy: false, group: false });

  await assert.rejects(fns.createProfileFromTemplate({ templateId: 41, title: 'Y\'s' }), /You do not have access to this template\./);
  assert.equal((await db.profile.findMany({ where: { title: 'Y\'s' } })).length, 0);

  ws.as(2); // the Admin may use Y's proxy and group: nothing is left out
  const admin = await fns.createProfileFromTemplate({ templateId: 40, title: 'Admin copy' });
  assert.deepEqual([admin.proxyId, admin.groupId, admin.leftOut], [21, 11, { proxy: false, group: false }]);
});

test('a copy of a profile shared with the member leaves out its owner\'s proxy and group the same way', async () => {
  const { ws, fns } = loadTemplates();
  ws.as(3);
  const copy = await fns.cloneProfile({ id: 106 });
  assert.equal(copy.ownerMemberId, 3);
  assert.deepEqual([copy.proxyId, copy.proxyInfoString, copy.groupId], [null, null, null]);
  assert.equal(copy.systemProxyBehavior, 'PROFILE_PROXY');
  assert.deepEqual(copy.leftOut, { proxy: true, group: true, twoFactor: false, logins: false });
  const ownCopy = await fns.cloneProfile({ id: 100 });
  assert.deepEqual([ownCopy.proxyId, ownCopy.groupId, ownCopy.leftOut], [20, 10, { proxy: false, group: false, twoFactor: false, logins: false }]);
});

test('a removed member\'s groups and templates are handed over or become Owner/Admin-managed', () => {
  const body = extractFunction(IPC, 'deleteMember');
  assert.match(body, /db\.group\.updateMany\(\{ where: \{ ownerMemberId: id \}, data: \{ ownerMemberId: toId \} \}\)/);
  assert.match(body, /db\.template\.updateMany\(\{ where: \{ ownerMemberId: id \}, data: \{ ownerMemberId: toId \} \}\)/);
  assert.match(body, /if \(dataAction !== 'reassign'\) \{[\s\S]*?db\.group\.updateMany\(\{ where: \{ ownerMemberId: id \}, data: \{ ownerMemberId: null \} \}\)[\s\S]*?db\.template\.updateMany\(\{ where: \{ ownerMemberId: id \}, data: \{ ownerMemberId: null \} \}\)/);
});

// ---- 3. Proxy policy and the check schedule ----

function loadPolicy(db = seed()) {
  const ws = workspace(db);
  const settings = new Map();
  const scheduler = [];
  const fns = loadMain(['requireObject', 'parseId', 'requirePermission', 'assertCanAccessProfile', 'requireWorkspaceProxySettings', 'getProxyPolicy', 'getProxyPolicyForActor', 'setProxyPolicy', 'setProxyScheduler'], {
    ...ws.deps,
    PROXY_POLICY_MODES: new Set(['each-launch', 'sticky', 'failover', 'latency-optimized']),
    readSetting: async (k, d) => (settings.has(k) ? JSON.parse(JSON.stringify(settings.get(k))) : d),
    writeSetting: async (k, v) => { settings.set(k, JSON.parse(JSON.stringify(v))); },
    startProxyScheduler: (m) => scheduler.push(['start', m]), stopProxyScheduler: () => scheduler.push(['stop']),
    proxySchedulerTimer: null
  });
  return { ws, fns, settings, scheduler };
}

test('the workspace rotation policy and check schedule need proxies.manage and the Owner or an Admin', async () => {
  const { ws, fns, settings, scheduler } = loadPolicy();
  for (const who of [3, 5]) {
    ws.as(who);
    await assert.rejects(fns.setProxyPolicy({ default: 'sticky' }), /only the Owner or an Admin can change the workspace rotation policy/, `member ${who}`);
    await assert.rejects(fns.setProxyPolicy({ failoverMaxLatencyMs: 900 }), /only the Owner or an Admin/);
    await assert.rejects(fns.setProxyScheduler({ enabled: true, minutes: 5 }), /only the Owner or an Admin can change the workspace proxy check schedule/);
  }
  assert.equal(settings.has('proxyPolicy'), false);
  assert.deepEqual(scheduler, []);
  ws.as(2);
  assert.equal((await fns.setProxyPolicy({ default: 'sticky' })).default, 'sticky');
  await fns.setProxyScheduler({ enabled: true, minutes: 5 });
  assert.deepEqual(scheduler, [['start', 5]]);
  await withRevoked(2, 'proxies.manage', async () => {
    ws.as(2);
    await assert.rejects(fns.setProxyPolicy({ default: 'failover' }), /turned off for your account by an administrator/);
  });
  ws.as(null);
  assert.equal((await fns.setProxyPolicy({ default: 'failover' })).default, 'failover', 'single-user mode is the owner');
});

test('a per-profile policy needs edit access to that profile', async () => {
  const { ws, fns, settings } = loadPolicy();
  ws.as(3);
  assert.equal((await fns.setProxyPolicy({ profileId: 100, mode: 'sticky' })).byProfile['100'], 'sticky', 'an Operator sets their own profile');
  await assert.rejects(fns.setProxyPolicy({ profileId: 104, mode: 'sticky' }), /You do not have access to this profile\./, 'a use-only share');
  await assert.rejects(fns.setProxyPolicy({ profileId: 101, mode: 'sticky' }), /You do not have access to this profile\./, 'a sibling\'s profile');
  await fns.setProxyPolicy({ profileId: 106, mode: 'failover' }); // shared for editing
  assert.deepEqual(settings.get('proxyPolicy').byProfile, { 100: 'sticky', 106: 'failover' });
  await assert.rejects(fns.setProxyPolicy({ profileId: 100, mode: 'sticky', default: 'sticky' }), /only the Owner or an Admin/, 'no default change hidden in a per-profile call');
});

// ---- 4. Bulk tag and bulk rename ----

function loadBulk(db = seed()) {
  const ws = workspace(db);
  const activity = [];
  const fns = loadMain([...VALIDATORS, 'requirePermission', 'assignTagToProfiles', 'bulkRenameProfiles'], {
    ...ws.deps, logActivity: async (_db, id, action) => { activity.push([id, action]); }
  });
  return { db, ws, fns, activity };
}

test('bulk tag needs profiles.edit, tags only profiles the member may edit, and reports the rest', async () => {
  const { db, ws, fns, activity } = loadBulk();
  ws.as(3);
  const res = await fns.assignTagToProfiles({ ids: [100, 104, 101, 106], tag: 'vip', mode: 'add' });
  assert.equal(res.updated, 2);
  assert.equal(res.skipped, 2, 'the use-only share and the sibling\'s profile');
  assert.deepEqual(JSON.parse((await db.profile.findUnique({ where: { id: 100 } })).tags), ['x', 'vip']);
  assert.equal((await db.profile.findUnique({ where: { id: 104 } })).tags, undefined);
  assert.deepEqual(JSON.parse((await db.profile.findUnique({ where: { id: 101 } })).tags), ['y']);
  assert.deepEqual(activity.map(([id]) => id).sort(), [100, 106]);
  await withRevoked(3, 'profiles.edit', async () => {
    ws.as(3);
    await assert.rejects(fns.assignTagToProfiles({ ids: [100], tag: 'nope' }), /turned off for your account by an administrator/);
  });
});

test('bulk rename needs profiles.edit, renames only editable profiles in order, and reports the rest', async () => {
  const { db, ws, fns } = loadBulk();
  ws.as(3);
  const res = await fns.bulkRenameProfiles({ ids: [104, 100, 101, 105], prefix: 'Batch', start: 1 });
  assert.deepEqual(res, { renamed: 2, skipped: 2 });
  assert.equal((await db.profile.findUnique({ where: { id: 100 } })).title, 'Batch 1');
  assert.equal((await db.profile.findUnique({ where: { id: 105 } })).title, 'Batch 2');
  assert.equal((await db.profile.findUnique({ where: { id: 104 } })).title, 'shared-use');
  assert.equal((await db.profile.findUnique({ where: { id: 101 } })).title, 'y-1');
  const list = await fns.bulkRenameProfiles({ ids: [104, 105], renames: [{ id: 104, title: 'hijack' }, { id: 105, title: 'mine' }] });
  assert.deepEqual(list, { renamed: 1, skipped: 1 });
  assert.equal((await db.profile.findUnique({ where: { id: 104 } })).title, 'shared-use');
  await withRevoked(3, 'profiles.edit', async () => {
    ws.as(3);
    await assert.rejects(fns.bulkRenameProfiles({ ids: [100], prefix: 'X' }), /turned off for your account by an administrator/);
  });
});

// ---- 5. Proxy reuse by credentials ----

// "host:port[:user:pass]" -> parsed proxy, like browserEngine.parseProxyInput for these inputs.
function parseProxyInput(raw) {
  if (raw && typeof raw === 'object') return { ...raw, port: Number(raw.port) };
  const [host, port, username = null, password = null] = String(raw || '').split(':');
  return host ? { type: 'HTTP', host, port: Number(port), username, password } : null;
}

function loadProxyAdd(db = seed()) {
  const ws = workspace(db);
  let memberReads = 0;
  const deps = {
    ...ws.deps, proxyScope, parseProxyInput,
    parseProxyType: (v) => String(v || 'HTTP').toUpperCase(),
    parsePort: (v) => Number(v),
    serializeProxy: (p) => p
  };
  const getActiveMember = deps.getActiveMember;
  deps.getActiveMember = async () => { memberReads += 1; return getActiveMember(); };
  const fns = loadMain([...VALIDATORS, 'requirePermission', 'limitError', 'assertWithinLimit', 'proxyIdentityWhere', 'proxyAddContext', 'assertProxyQuota',
    'findVisibleProxy', 'findOrCreateProxy', 'createProxy', 'parseColonProxyLine', 'batchAddProxies'], deps);
  return { db, ws, fns, reads: () => memberReads };
}

test('custom proxy credentials reuse only a proxy the member may use; otherwise the member gets their own row', async () => {
  const { db, ws, fns } = loadProxyAdd();
  ws.as(3); // X types the same gateway login Y saved (proxy 25)
  const mine = await fns.findOrCreateProxy(db, 'gw.example.net:7000:u:p', 'X Proxy');
  assert.notEqual(mine.id, 25, 'Y\'s row is never linked');
  assert.equal(mine.ownerMemberId, 3);
  assert.equal((await fns.findOrCreateProxy(db, 'gw.example.net:7000:u:p')).id, mine.id, 'the second time X reuses their own row');
  assert.equal((await db.proxy.findUnique({ where: { id: 25 } })).name, 'Y gateway', 'Y\'s row is untouched');

  ws.as(2); // the Admin may use both rows: one of them is reused, nothing new is made
  const before = (await db.proxy.findMany()).length;
  assert.ok([25, mine.id].includes((await fns.findOrCreateProxy(db, 'gw.example.net:7000:u:p')).id));
  assert.equal((await db.proxy.findMany()).length, before);

  ws.as(null); // single-user mode: every row is the workspace's own
  assert.ok([25, mine.id].includes((await fns.findOrCreateProxy(db, 'gw.example.net:7000:u:p')).id));
});

test('a new proxy made from custom credentials counts against the member\'s proxy limit', async () => {
  const { db, ws, fns } = loadProxyAdd();
  // X owns proxies 20 and 23; a limit of 2 leaves no room.
  MEMBERS[2].permissionsJson = JSON.stringify({ maxProxies: 2 });
  try {
    ws.as(3);
    await assert.rejects(fns.findOrCreateProxy(db, 'gw.example.net:7000:u:p'), (e) => e.code === 'LIMIT_REACHED' && e.limitKind === 'proxy' && /You've reached your proxy limit \(2\)/.test(e.message));
    assert.equal((await fns.findOrCreateProxy(db, 'x.example.net:8000')).id, 20, 'reusing a proxy the member already has needs no room');
  } finally { delete MEMBERS[2].permissionsJson; }
});

test('inside a transaction the member context is passed in, so no outer-client query runs', async () => {
  const { db, ws, fns, reads } = loadProxyAdd();
  ws.as(3);
  const ctx = await fns.proxyAddContext();
  const before = reads();
  const p = await fns.findOrCreateProxy(db, 'new.example.net:9000:a:b', null, null, ctx);
  assert.equal(p.ownerMemberId, 3);
  assert.equal(reads(), before, 'no getActiveMember (outer client) call');
});

test('manual add and batch add treat another member\'s proxy as not a duplicate, and never return it', async () => {
  const { db, ws, fns } = loadProxyAdd();
  ws.as(3);
  const created = await fns.createProxy({ type: 'HTTP', host: 'gw.example.net', port: 7000, username: 'u', password: 'p' });
  assert.equal(created.ownerMemberId, 3);
  await assert.rejects(fns.createProxy({ type: 'HTTP', host: 'gw.example.net', port: 7000, username: 'u', password: 'p' }), /already exists/, 'X\'s own copy is a duplicate');
  ws.as(4);
  const batch = await fns.batchAddProxies({ raw: 'x2.example.net:8000\ny.example.net:8000' });
  assert.equal(batch.created.length, 1, 'X\'s proxy is added as Y\'s own');
  assert.equal(batch.created[0].ownerMemberId, 4);
  assert.deepEqual(batch.skipped.map((s) => [s.reason, s.proxy.id]), [['DUPLICATE', 21]], 'only Y\'s own duplicate is reported');
});

test('the proxy pool names and counts only profiles the member can see', async () => {
  const db = seed();
  await db.profile.update({ where: { id: 101 }, data: { proxyId: 20 } }); // the Admin put X's proxy on Y's profile
  const ws = workspace(db);
  const { listProxies } = loadMain([...VALIDATORS, 'scopedProxyWhere', 'listProxies'], { ...ws.deps, proxyScope, serializeProxy: (p) => p });
  ws.as(3);
  const x20 = (await listProxies()).find((p) => p.id === 20);
  assert.deepEqual(x20.profiles.map((p) => p.title), ['x-1']);
  assert.equal(x20._count.profiles, 1);
  ws.as(2);
  const a20 = (await listProxies()).find((p) => p.id === 20);
  assert.deepEqual(a20.profiles.map((p) => p.title), ['x-1', 'y-1']);
});

test('every proxy add path checks the member\'s own pool, not the whole workspace', () => {
  for (const name of ['harvestFreeProxiesHandler', 'syncVendorPool']) {
    const body = extractFunction(IPC, name);
    assert.match(body, /const add = await proxyAddContext\(\);/, name);
    assert.match(body, /ownerMemberId: add\.ownerId/, name);
  }
  assert.match(extractFunction(IPC, 'harvestFreeProxiesHandler'), /const dup = await findVisibleProxy\(db, /);
  assert.match(extractFunction(IPC, 'syncVendorPool'), /where: proxyScope\.andWhere\(\{ type: row\.type, host: row\.host, port: row\.port, username: row\.username/);
  assert.match(extractFunction(IPC, 'commitProfileImport'), /findOrCreateProxy\(db, item\.rawProxy, `\$\{item\.title\} Proxy`, item\.proxyType \|\| null, proxyAdd\)/);
  assert.match(extractFunction(IPC, 'commitProfileImport'), /error\.code === 'LIMIT_REACHED' && error\.limitKind !== 'proxy'/, 'the proxy limit fails a row, it does not stop the import');
  assert.match(extractFunction(IPC, 'bulkAssignProxies'), /findOrCreateProxy\(db, line, null, typeHint, add\)/);
});

// ---- 6. Deleting a proxy, and launching a profile that has none ----

function loadProxyDelete(db = seed()) {
  const ws = workspace(db);
  const activity = [];
  const fns = loadMain(['requireObject', 'parseId', 'requirePermission', 'scopedProxyWhere', 'assertCanAccessProxy', 'partitionAccessibleProxyIds',
    'pruneEmptyAutoGroups', 'detachProfilesFromProxies', 'deleteProxy', 'bulkDeleteProxies', 'assertProfileHasLaunchProxy'], {
    ...ws.deps,
    logAudit: async () => {},
    logActivity: async (_db, id, action, detail) => { activity.push([id, action, detail]); }
  });
  return { db, ws, fns, activity };
}

test('deleting a proxy clears it and its cached address from its profiles, which keep asking for a proxy', async () => {
  const { db, ws, fns, activity } = loadProxyDelete();
  ws.as(3);
  const res = await fns.deleteProxy({ id: 20 });
  assert.equal(res.profilesNeedProxy, 1);
  const p = await db.profile.findUnique({ where: { id: 100 } });
  assert.deepEqual([p.proxyId, p.proxyInfoString, p.systemProxyBehavior], [null, null, 'PROFILE_PROXY']);
  assert.deepEqual(activity, [[100, 'proxy-reassign', 'proxy deleted; assign a proxy before launching']]);
  assert.throws(() => fns.assertProfileHasLaunchProxy({ ...p, proxy: null }, null), (e) => e.code === 'PROXY_MISSING' && /Assign a proxy in the profile editor/.test(e.message));

  ws.as(1); // the Owner (the Admin does not see the Owner's proxy 22)
  const bulk = await fns.bulkDeleteProxies({ ids: [21, 22] });
  assert.equal(bulk.profilesNeedProxy, 2);
  for (const id of [101, 106]) assert.equal((await db.profile.findUnique({ where: { id } })).proxyInfoString, null);
});

test('only a profile set to use a proxy and holding none is refused; a pool pick, no-proxy and a saved address still launch', () => {
  const { fns } = loadProxyDelete();
  const missing = { title: 'p', systemProxyBehavior: 'PROFILE_PROXY', proxy: null, proxyInfoString: null };
  assert.throws(() => fns.assertProfileHasLaunchProxy(missing, null), /set to use a proxy but has none/);
  fns.assertProfileHasLaunchProxy(missing, { id: 5 }); // the rotation pool picked one
  fns.assertProfileHasLaunchProxy({ ...missing, systemProxyBehavior: 'DIRECT' }, null);
  fns.assertProfileHasLaunchProxy({ ...missing, systemProxyBehavior: 'SYSTEM_PROXY' }, null);
  fns.assertProfileHasLaunchProxy({ ...missing, proxyInfoString: 'h.example.net:80' }, null); // an API profile with only an address
  fns.assertProfileHasLaunchProxy({ ...missing, proxy: { id: 1 } }, null);
  // Both engines check it right after the pool pick, before anything is spawned.
  const launch = extractFunction(IPC, 'launchProfileNow');
  assert.match(launch, /const ffRotated = await pickRotationProxy\(db, id\);\s*assertProfileHasLaunchProxy\(profile, ffRotated\);/);
  assert.match(launch, /const rotated = await pickRotationProxy\(db, id\);\s*assertProfileHasLaunchProxy\(profile, rotated\);/);
  // Removing a member with "delete all attached data" deletes their proxies the same way.
  assert.match(extractFunction(IPC, 'deleteMember'), /await detachProfilesFromProxies\(db, goneProxies\.map\(\(p\) => p\.id\)\)/);
});

// ---- Siblings: Trash actions and the per-row edit flag ----

function loadTrash(db = seed()) {
  const ws = workspace(db);
  const fns = loadMain([...VALIDATORS, 'requirePermission', 'assertCanAccessProfile', 'deleteProfile', 'restoreProfile', 'purgeProfile', 'bulkDeleteProfiles', 'bulkRestoreProfiles', 'withViewerEditFlags'], {
    ...ws.deps,
    closeAnySession: async () => {}, wipeProfileFolders: async () => 0, logActivity: async () => {}, logAudit: async () => {},
    serializeProfile: (p) => ({ ...p }),
    // A "use only" row's proxy fields (1.0.26 round 4, test/permissionsRound4.test.js).
    currentMemberCanRevealProxy: true, proxyRevealAllowed: () => true, redactUseOnlyProxy: () => ({}), proxyInVisiblePool: () => false
  });
  return { db, ws, fns };
}

test('Trash actions need edit access, and restoring needs the same right as moving to Trash', async () => {
  const { db, ws, fns } = loadTrash();
  ws.as(2); // the Admin may trash and restore
  await fns.deleteProfile({ id: 100 });
  assert.ok((await db.profile.findUnique({ where: { id: 100 } })).deletedAt);
  ws.as(3); // an Operator cannot restore (profiles.delete is Admin and up), not even their own profile
  await assert.rejects(fns.restoreProfile({ id: 100 }), /Your role does not permit this action\./);
  await assert.rejects(fns.bulkRestoreProfiles({ ids: [100] }), /Your role does not permit this action\./);
  ws.as(2);
  await fns.restoreProfile({ id: 100 });
  assert.equal((await db.profile.findUnique({ where: { id: 100 } })).deletedAt, null);

  // An Admin holding only a "use" share of the Owner's profile cannot trash it.
  await db.profile.update({ where: { id: 104 }, data: { accesses: [{ memberId: 2, level: 'use' }] } });
  await assert.rejects(fns.deleteProfile({ id: 104 }), /You do not have access to this profile\./);
  const bulk = await fns.bulkDeleteProfiles({ ids: [104, 105] });
  assert.deepEqual(bulk.trashed, [105]);
  assert.deepEqual(bulk.errors.map((e) => e.id), [104]);
  ws.as(1);
  await assert.rejects(fns.purgeProfile({ id: 9999 }), /Profile not found\./);
});

test('the profile lists tell the page which rows the member may edit, without sending the share list', async () => {
  const { db, ws, fns } = loadTrash();
  const rows = await db.profile.findMany();
  ws.as(3);
  const flags = Object.fromEntries((await fns.withViewerEditFlags(rows)).map((p) => [p.id, p.canEdit]));
  assert.deepEqual([flags[100], flags[104], flags[106], flags[101]], [true, false, true, false]);
  assert.ok((await fns.withViewerEditFlags(rows)).every((p) => !('accesses' in p)));
  ws.as(null);
  assert.ok((await fns.withViewerEditFlags(rows)).every((p) => p.canEdit === true));
  assert.match(extractFunction(IPC, 'listTrash'), /return withViewerEditFlags\(profiles\);/);
  // The list also drops rows a search matched only through a masked value (1.0.26 round 4).
  assert.match(extractFunction(IPC, 'listProfiles'), /const rows = await withViewerEditFlags\(profiles\);/);
});

// ---- Schema ----

test('a migration adds the template owner column; older templates keep NULL', (t) => {
  const model = /model Template \{[\s\S]*?\n\}/.exec(read('prisma', 'schema.prisma'))[0];
  assert.match(model, /ownerMemberId Int\?/);
  assert.match(model, /@@index\(\[ownerMemberId\]\)/);
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) { t.skip('node:sqlite is not available in this Node build'); return; }
  const dir = path.join(ROOT, 'prisma', 'migrations');
  const folders = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d{14}_/.test(d.name)).map((d) => d.name).sort();
  const TEMPLATE = '20261111000000_template_owner';
  const PROXY = '20261111000100_proxy_unique_per_owner';
  assert.ok(folders.includes(TEMPLATE) && folders.includes(PROXY));
  // Same comment stripping and statement split as database.js applyMigrations (no quotes in these files).
  const statements = (sql) => sql.split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
  const db = new DatabaseSync(':memory:');
  for (const folder of folders) {
    if (folder === TEMPLATE) db.exec(`INSERT INTO "Template" ("name", "dataJson") VALUES ('Made in 1.0.25', '{}')`);
    if (folder === PROXY) {
      db.exec(`INSERT INTO "Proxy" ("name", "type", "host", "port", "username", "passwordHash", "ownerMemberId") VALUES ('a', 'HTTP', 'h', 1, 'u', 'hash', 3)`);
    }
    const sql = fs.readFileSync(path.join(dir, folder, 'migration.sql'), 'utf8');
    if (folder === TEMPLATE || folder === PROXY) { for (const s of statements(sql)) db.exec(`${s};`); continue; }
    db.exec(sql);
  }
  assert.ok(db.prepare('PRAGMA table_info("Template")').all().some((c) => c.name === 'ownerMemberId'));
  assert.equal(db.prepare('SELECT "ownerMemberId" FROM "Template" WHERE "name" = ?').get('Made in 1.0.25').ownerMemberId, null);
  assert.ok(db.prepare('PRAGMA index_list("Template")').all().some((i) => i.name === 'Template_ownerMemberId_idx'));
  // The proxy key: the same proxy for another member is allowed, a second copy for one member or
  // for nobody is not.
  const add = (owner) => db.prepare('INSERT INTO "Proxy" ("name", "type", "host", "port", "username", "passwordHash", "ownerMemberId") VALUES (?, ?, ?, ?, ?, ?, ?)').run('b', 'HTTP', 'h', 1, 'u', 'hash', owner);
  add(4);
  assert.throws(() => add(3), /UNIQUE constraint failed/);
  add(null);
  assert.throws(() => add(null), /UNIQUE constraint failed/);
  const idx = db.prepare('PRAGMA index_list("Proxy")').all().map((i) => i.name);
  assert.ok(!idx.includes('Proxy_type_host_port_username_passwordHash_key'));
  assert.ok(idx.includes('Proxy_type_host_port_username_passwordHash_ownerMemberId_key'));
  assert.ok(idx.includes('Proxy_unowned_identity_key'));
});

// ---- 7 and 8. Role-aware UI: the renderer's rules are main's ----

const { pathToFileURL } = require('node:url');
const loadUiRules = () => import(pathToFileURL(path.join(ROOT, 'src', 'renderer', 'lib', 'memberPermissions.mjs')).href);
// What members.current() returns for a member (serializeMember: role, status, effective permissions).
const asRenderer = (m) => ({ id: m.id, role: m.role, status: m.status || 'active', permissions: permissions.effectivePermissions(m) });

test('the renderer\'s role table is main\'s', async () => {
  const ui = await loadUiRules();
  assert.deepEqual({ ...ui.ACTION_MIN_RANK }, { ...permissions.ACTION_MIN_RANK });
  assert.deepEqual({ ...ui.ROLE_RANK }, { ...permissions.ROLE_RANK });
});

test('every role gets exactly the actions main allows it, and the reason names the role needed', async () => {
  const ui = await loadUiRules();
  const roles = { OWNER: 1, ADMIN: 2, MANAGER: 5, OPERATOR: 3 };
  for (const [role, id] of Object.entries(roles)) {
    const me = asRenderer(MEMBERS.find((m) => m.id === id));
    for (const action of Object.keys(permissions.ACTION_MIN_RANK)) {
      const mainAllows = permissions.rankOf(role) >= permissions.ACTION_MIN_RANK[action];
      assert.equal(ui.can(me, action), mainAllows, `${role} ${action}`);
      const d = ui.denial(me, action);
      if (mainAllows) assert.equal(d, null);
      else assert.equal(d.role, ['', 'OPERATOR', 'MANAGER', 'ADMIN', 'OWNER'][permissions.ACTION_MIN_RANK[action]], `${role} ${action}`);
    }
  }
  // The issue-11 examples: Trash is Admin and up, Share is Manager and up, permanent delete is the Owner's.
  const op = asRenderer(MEMBERS[2]);
  assert.deepEqual([ui.denial(op, 'profiles.delete'), ui.denial(op, 'profiles.share'), ui.denial(op, 'profiles.purge')],
    [{ kind: 'role', role: 'ADMIN' }, { kind: 'role', role: 'MANAGER' }, { kind: 'role', role: 'OWNER' }]);
  // A per-member revoke is "turned off", not a role problem; a suspended member can do nothing.
  const revoked = asRenderer({ ...MEMBERS[2], permissionsJson: JSON.stringify({ actions: { 'profiles.edit': false } }) });
  assert.deepEqual(ui.denial(revoked, 'profiles.edit'), { kind: 'revoked' });
  assert.equal(ui.can({ ...asRenderer(MEMBERS[0]), status: 'suspended' }, 'profiles.launch'), false);
  // Not loaded yet: nothing enabled. Single-user mode: the Owner.
  assert.deepEqual(ui.denial(undefined, 'profiles.launch'), { kind: 'loading' });
  assert.equal(ui.can(null, 'profiles.purge'), true);
  // Workspace proxy settings: proxies.manage AND Owner/Admin (main's requireWorkspaceProxySettings).
  assert.equal(ui.workspaceProxyDenial(asRenderer(MEMBERS[1])), null);
  assert.deepEqual(ui.workspaceProxyDenial(asRenderer(MEMBERS[4])), { kind: 'role', role: 'ADMIN' });
  assert.deepEqual(ui.workspaceProxyDenial(asRenderer({ ...MEMBERS[1], permissionsJson: JSON.stringify({ actions: { 'proxies.manage': false } }) })), { kind: 'revoked' });
  // Data Vault: the Owner only (vault.manage), and single-user mode.
  assert.deepEqual([1, 2, 5, 3].map((id) => ui.canManageVault(asRenderer(MEMBERS.find((m) => m.id === id)))), [true, false, false, false]);
  assert.equal(ui.canManageVault(null), true);
});

test('the Groups list tells the page which groups the member may rename or delete', async () => {
  const db = createFakePrisma({
    member: MEMBERS.map((m) => ({ ...m })),
    group: [{ id: 10, name: 'X own', ownerMemberId: 3 }, { id: 12, name: 'Older', ownerMemberId: null }, { id: 14, name: 'Y with X profile', ownerMemberId: 4 }],
    profile: [
      { id: 100, title: 'x-1', ownerMemberId: 3, assignedMemberId: 3, groupId: 12, deletedAt: null },
      { id: 102, title: 'x-2', ownerMemberId: 3, assignedMemberId: 3, groupId: 14, deletedAt: null }
    ]
  });
  const ws = workspace(db);
  const { listGroups } = loadMain(['collectTags', 'ownedRowManageChecker', 'scopedGroupWhere', 'listGroups'], ws.deps);
  ws.as(3);
  assert.deepEqual((await listGroups()).map((g) => [g.id, g.canManage]).sort((a, b) => a[0] - b[0]), [[10, true], [12, false], [14, false]]);
  ws.as(2);
  assert.ok((await listGroups()).every((g) => g.canManage));
});

test('the pages disable what main refuses, with the role it needs, and Data Vault is hidden from other roles', () => {
  const src = (...p) => read('src', 'renderer', ...p);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const PROFILES = src('pages', 'ProfilesPage.jsx');
  // Profiles: bulk bar and row actions.
  for (const [action, label] of [['profiles.launch', 'bulk.launch'], ['profiles.edit', 'bulk.tag'], ['profiles.edit', 'bulk.rename'], ['profiles.edit', 'bulk.reassignProxy'], ['profiles.share', 'bulk.share'], ['profiles.delete', 'bulk.delete']]) {
    assert.match(PROFILES, new RegExp(`<GuardedButton deny=\\{perm\\.deny\\('${esc(action)}'\\)\\}[^\\n]*\\{t\\('${esc(label)}'\\)\\}`), label);
  }
  assert.match(PROFILES, /<GuardedButton deny=\{perm\.denyRow\('profiles\.edit', p\)\}[^\n]*onClick=\{\(\) => openEdit\(p\)\}/);
  assert.match(PROFILES, /<GuardedButton deny=\{perm\.denyRow\('proxies\.manage', p\)\}[^\n]*setRotationProfile/);
  assert.match(PROFILES, /<GuardedButton deny=\{perm\.denyRow\('profiles\.delete', p\)\}[^\n]*handleDelete\(p\.id, p\.title\)/);
  assert.match(PROFILES, /p\.systemProxyBehavior === 'PROFILE_PROXY' && !p\.proxyId\) \? \(/, 'a profile whose proxy is gone shows "No proxy", not "Direct"');
  // Trash, Groups, Members, Templates, Proxy pool.
  const TRASH = src('pages', 'TrashPage.jsx');
  assert.match(TRASH, /deny=\{perm\.denyRow\('profiles\.delete', item\)\}/);
  assert.match(TRASH, /deny=\{perm\.denyRow\('profiles\.purge', item\)\}/);
  assert.match(TRASH, /<GuardedButton\s+deny=\{denyPurge\}\s+onClick=\{handleEmptyTrash\}/);
  const GROUPS = src('pages', 'GroupsPage.jsx');
  assert.match(GROUPS, /const denyManage = perm\.denyGroup\('profiles\.edit', group\);/);
  assert.match(GROUPS, /const denyRow = perm\.denyRow\('profiles\.edit', p\);/);
  const MEMBERS_PAGE = src('pages', 'MembersPage.jsx');
  assert.match(MEMBERS_PAGE, /const canInvite = canCreate && !seatsFull && !denyManage;/, 'a Manager no longer gets an Invite button main refuses');
  assert.match(MEMBERS_PAGE, /const denyTab = tab2\.id === 'activity' \? denyManage : null;/);
  assert.match(MEMBERS_PAGE, /const denyStatus = perm\.denyOwner\(\);/);
  const TEMPLATES = src('components', 'TemplatesModal.jsx');
  assert.match(TEMPLATES, /const denyCreate = perm\.deny\('profiles\.create'\);/);
  assert.match(TEMPLATES, /left\.proxy \? t\('templates\.infoNoProxy'\) : ''/);
  const POOL = src('pages', 'ProxyPoolPage.jsx');
  assert.match(POOL, /const denyPolicy = perm\.denyWorkspaceProxy\(\);/);
  assert.match(POOL, /onChange=\{\(e\) => applyProxyPolicy\(e\.target\.value\)\}\s*disabled=\{Boolean\(denyPolicy\)\}/);
  assert.match(POOL, /\{!perm\.denyGroup\('proxies\.manage', g\) && <>/);
  assert.match(POOL, /noteProfilesNeedProxy\(res\)/);
  // Data Vault: sidebar, dashboard link and the page itself follow vault.manage.
  const SHELL = src('components', 'AppShell.jsx');
  assert.match(SHELL, /\{ path: '\/personas', labelKey: 'nav\.dataVault', icon: IdCard, featureKey: 'personas', vaultOnly: true \}/);
  assert.match(SHELL, /\.filter\(\(item\) => !item\.vaultOnly \|\| !meLoaded \|\| canManageVault\(me\)\)/);
  assert.match(src('pages', 'DashboardPage.jsx'), /\.\.\.\(canManageVault \? \[\{ to: '\/personas'/);
  const VAULT = src('pages', 'PersonasPage.jsx');
  assert.match(VAULT, /if \(!canManageVault\) \{[\s\S]*?<EmptyState title=\{t\('perm\.vaultTitle'\)\} description=\{t\('perm\.vaultBody'\)\} \/>/);
  assert.match(VAULT, /return <DataVault \/>;/, 'the vault (and its getAll call) mounts only for members who may manage it');
  // A disabled button keeps its reason: the tooltip sits on a wrapper because a disabled Button has
  // no pointer events, and screen readers get it through aria-describedby.
  const GUARD = src('components', 'ui', 'GuardedButton.jsx');
  // `relative` keeps the absolutely positioned sr-only reason inside a scrolling table (at 375 px it
  // otherwise widened the whole page).
  // The wrapper is inline-flex unless a full-width button asks for another layout (1.0.26 round 3).
  assert.match(GUARD, /wrapperClassName = 'inline-flex'/);
  assert.match(GUARD, /<span className=\{`relative \$\{wrapperClassName\}`\} title=\{deny\}>\s*<Button \{\.\.\.rest\} disabled aria-describedby=\{id\}>/);
  // Every string the pages use exists in both languages.
  for (const lang of ['en', 'es']) {
    const loc = (ns) => JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, `${ns}.json`));
    for (const k of ['needsRole', 'ownerOnly', 'turnedOff', 'inactive', 'checking', 'useOnly', 'notYourGroup', 'vaultTitle', 'vaultBody']) assert.ok(loc('common').perm[k], `${lang} common.perm.${k}`);
    for (const k of ['skipped', 'cloneNoProxy', 'cloneNoGroup', 'proxyMissing', 'proxyMissingTitle']) assert.ok(loc('profiles').permNotes[k], `${lang} profiles.permNotes.${k}`);
    for (const k of ['infoNoProxy', 'infoNoGroup', 'deleteLabel']) assert.ok(loc('cmpModalsB').templates[k], `${lang} cmpModalsB.templates.${k}`);
    for (const k of ['profilesNeedProxy', 'dismissNotice']) assert.ok(loc('proxies').delete[k], `${lang} proxies.delete.${k}`);
    for (const k of ['renameGroup', 'deleteGroup']) assert.ok(loc('groups').sidebar[k], `${lang} groups.sidebar.${k}`);
    assert.ok(loc('trash').bulkSkipped, `${lang} trash.bulkSkipped`);
  }
});
