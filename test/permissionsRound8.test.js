'use strict';
// 1.0.26 round 8, team items:
//  82. A Manager saw (and could open) every profile of their parent, and the parent on Members:
//      permissions.visibleMemberIds added a Manager's parent to the Manager's visible set. Now every
//      role sees its own subtree only; a parent's profile reaches a Manager only through a share.
//   3. Suspending a member from the member dialog was logged as "member edited", not "status changed".
//   4. The Owner card said "Never active" right after sign-up, until the next sign-in.
//   2. With "Keep me signed in" the encrypted database opens by itself at launch, while the
//      Database Encryption card said the password would be asked.
// Main-process functions run for real from ipcHandlers.js with the real permissions module and an
// in-memory database stand-in (test/helpers/fakePrisma.js), as in rounds 4 to 7.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const permissions = require('../src/main/permissions');
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
const VALIDATORS = ['requireObject', 'optionalString', 'requiredString', 'parseId', 'parseIdArray'];

// ---- The team ----
// Owner 1 > Admin 2 > (Operator 3, Manager 5 > Operator 8)
// Owner 1 > Manager 6 > Operator 7          <- the Manager whose parent is the Owner (the reported case)

const MEMBERS = [
  { id: 1, name: 'Owner', role: 'OWNER', parentMemberId: null, status: 'active', createdAt: new Date('2026-01-01T00:00:00Z') },
  { id: 2, name: 'Admin', role: 'ADMIN', parentMemberId: 1, status: 'active', createdAt: new Date('2026-02-01T00:00:00Z'), passwordHash: 'h', passwordSalt: 's' },
  { id: 3, name: 'Operator X', role: 'OPERATOR', parentMemberId: 2, status: 'active', createdAt: new Date('2026-03-01T00:00:00Z') },
  { id: 5, name: 'Manager A', role: 'MANAGER', parentMemberId: 2, status: 'active', createdAt: new Date('2026-04-01T00:00:00Z') },
  { id: 6, name: 'Manager B', role: 'MANAGER', parentMemberId: 1, status: 'active', createdAt: new Date('2026-04-02T00:00:00Z') },
  { id: 7, name: 'Operator B1', role: 'OPERATOR', parentMemberId: 6, status: 'active', createdAt: new Date('2026-05-01T00:00:00Z') },
  { id: 8, name: 'Operator A1', role: 'OPERATOR', parentMemberId: 5, status: 'active', createdAt: new Date('2026-05-02T00:00:00Z') }
];

function seed() {
  return createFakePrisma({
    member: MEMBERS.map((m) => ({ ...m })),
    profile: [
      // The Owner's: 100 private, 101 shared "use only" with Manager B, 109 shared for editing with Manager B.
      { id: 100, title: 'owner-private', ownerMemberId: 1, assignedMemberId: 1, deletedAt: null, accesses: [] },
      { id: 101, title: 'owner-shared-use', ownerMemberId: 1, assignedMemberId: 1, deletedAt: null, accesses: [{ memberId: 6, level: 'use' }] },
      { id: 109, title: 'owner-shared-edit', ownerMemberId: 1, assignedMemberId: 1, deletedAt: null, accesses: [{ memberId: 6, level: 'edit' }] },
      // The Admin's private one (Manager A's parent).
      { id: 102, title: 'admin-private', ownerMemberId: 2, assignedMemberId: 2, deletedAt: null, accesses: [] },
      { id: 103, title: 'manager-b', ownerMemberId: 6, assignedMemberId: 6, deletedAt: null, accesses: [] },
      { id: 104, title: 'operator-b1', ownerMemberId: 7, assignedMemberId: 7, deletedAt: null, accesses: [] },
      { id: 105, title: 'manager-a', ownerMemberId: 5, assignedMemberId: 5, deletedAt: null, accesses: [] },
      { id: 108, title: 'operator-a1', ownerMemberId: 8, assignedMemberId: 8, deletedAt: null, accesses: [] },
      { id: 110, title: 'operator-x', ownerMemberId: 3, assignedMemberId: 3, deletedAt: null, accesses: [] }
    ],
    proxy: [
      { id: 20, name: 'owner-gw', host: 'gw.owner.net', port: 7000, ownerMemberId: 1 },
      { id: 21, name: 'mgr-b-gw', host: 'mgr-b.example', port: 8000, ownerMemberId: 6 },
      { id: 22, name: 'admin-gw', host: 'admin.example', port: 8100, ownerMemberId: 2 },
      { id: 23, name: 'mgr-a-gw', host: 'mgr-a.example', port: 8200, ownerMemberId: 5 }
    ],
    template: [
      { id: 40, name: 'owner-tpl', ownerMemberId: 1, dataJson: '{}' },
      { id: 41, name: 'mgr-b-tpl', ownerMemberId: 6, dataJson: '{}' },
      { id: 42, name: 'admin-tpl', ownerMemberId: 2, dataJson: '{}' }
    ],
    macro: [
      // Recorded macros keep typed values, passwords included.
      { id: 50, name: 'owner-login', ownerMemberId: 1, stepsJson: JSON.stringify([{ type: 'type', selector: '#pw', value: 'owner-secret' }]) },
      { id: 51, name: 'mgr-b-macro', ownerMemberId: 6, stepsJson: '[]' },
      { id: 52, name: 'admin-macro', ownerMemberId: 2, stepsJson: '[]' }
    ]
  });
}

// The acting member (null = single-user mode) and the helpers that read it.
function workspace(db) {
  const state = { member: null };
  const as = (who) => {
    if (who == null) state.member = null;
    else if (who === 'super') state.member = { ...permissions.SUPER_ADMIN };
    else state.member = { ...MEMBERS.find((m) => m.id === who) };
    return state.member;
  };
  const deps = {
    getPrisma: () => db,
    permissions,
    rankOf: permissions.rankOf,
    getActiveMember: async () => state.member,
    PROFILE_ACCESS_SELECT: { id: true, ownerMemberId: true, assignedMemberId: true, accesses: { select: { memberId: true, level: true } } }
  };
  return { state, as, deps };
}

const ids = (rows) => rows.map((r) => r.id).sort((a, b) => a - b);
const ROLES = [
  // [who, visible members, profiles they can open, profiles they can edit]
  ['Owner', 1, [1, 2, 3, 5, 6, 7, 8], [100, 101, 102, 103, 104, 105, 108, 109, 110], [100, 101, 102, 103, 104, 105, 108, 109, 110]],
  ['Admin', 2, [2, 3, 5, 8], [102, 105, 108, 110], [102, 105, 108, 110]],
  ['Manager under the Admin', 5, [5, 8], [105, 108], [105, 108]],
  ['Manager under the Owner', 6, [6, 7], [101, 103, 104, 109], [103, 104, 109]],
  ['Operator under Manager B', 7, [7], [104], [104]],
  ['Operator under Manager A', 8, [8], [108], [108]]
];

// ---- 82. Visibility per role ----

test('82: every role sees its own subtree only; a Manager never gets their parent', () => {
  for (const [label, id, visible] of ROLES) {
    const me = MEMBERS.find((m) => m.id === id);
    assert.deepEqual([...permissions.visibleMemberIds(MEMBERS, me)].sort((a, b) => a - b), visible, label);
  }
  assert.equal(permissions.visibleMemberIds(MEMBERS, permissions.SUPER_ADMIN).size, MEMBERS.length, 'the Super Admin sees everyone');
  // The reported case and its sibling: neither Manager has their parent in the set.
  assert.ok(!permissions.visibleMemberIds(MEMBERS, MEMBERS.find((m) => m.id === 6)).has(1), 'Manager B does not see the Owner');
  assert.ok(!permissions.visibleMemberIds(MEMBERS, MEMBERS.find((m) => m.id === 5)).has(2), 'Manager A does not see their Admin');
});

test('82: profiles per role, through main\'s real access checks (list, open, edit)', async () => {
  const db = seed();
  const ws = workspace(db);
  const fns = loadMain(['profileAccessChecker', 'assertCanAccessProfile', 'partitionAccessibleProfileIds'], ws.deps);
  const allIds = (await db.profile.findMany()).map((p) => p.id);
  for (const [label, id, , canOpen, canEdit] of ROLES) {
    ws.as(id);
    const check = await fns.profileAccessChecker();
    const rows = await db.profile.findMany({ select: ws.deps.PROFILE_ACCESS_SELECT });
    assert.deepEqual(ids(rows.filter(check)), canOpen, `${label}: listed`);
    const { allowed } = await fns.partitionAccessibleProfileIds(allIds, { requireEdit: true });
    assert.deepEqual([...allowed].sort((a, b) => a - b), canEdit, `${label}: editable`);
  }
  // The reported case: the Owner's private profile cannot be opened by Manager B, by id either.
  ws.as(6);
  await assert.rejects(fns.assertCanAccessProfile(100), /You do not have access to this profile\./);
  await fns.assertCanAccessProfile(101); // shared "use only": opens
  await assert.rejects(fns.assertCanAccessProfile(101, { requireEdit: true }), /You do not have access to this profile\./);
  ws.as(5);
  await assert.rejects(fns.assertCanAccessProfile(102), /You do not have access to this profile\./, 'Manager A: the Admin\'s private profile');
  // Parents keep their subtree.
  ws.as(1); await fns.assertCanAccessProfile(104, { requireEdit: true });
  ws.as(2); await fns.assertCanAccessProfile(108, { requireEdit: true });
});

test('82: Members lists only the viewer\'s subtree (the Owner is not on a Manager\'s page)', async () => {
  const db = seed();
  const ws = workspace(db);
  const scoped = loadMain(['scopedProxyWhere'], ws.deps);
  const { listMembers } = loadMain(['listMembers', 'serializeMember', 'initialsFrom'], {
    ...ws.deps,
    readSetting: async (_k, def) => def,
    // The fake database has no ProfileAccess relation filter; the workspace totals are best-effort.
    scopedProfileWhere: async (base) => base,
    scopedProxyWhere: scoped.scopedProxyWhere,
    currentMemberId: null
  });
  for (const [label, id, visible] of ROLES) {
    ws.as(id);
    assert.deepEqual(ids(await listMembers()), visible, label);
  }
  ws.as(null); // single-user mode and the sign-in picker list everyone, as before
  assert.equal((await listMembers()).length, MEMBERS.length);
});

test('82: proxies, templates, macros and groups of the parent stay out of a Manager\'s scope', async () => {
  const db = seed();
  const ws = workspace(db);
  const fns = loadMain(['scopedProxyWhere', 'assertCanAccessProxy', 'partitionAccessibleProxyIds', 'scopedTemplateWhere',
    'macroScope', 'macroVisible', 'loadAccessibleMacro', 'ownedRowManageChecker'], ws.deps);
  const expect = {
    1: { proxies: [20, 21, 22, 23], templates: [40, 41, 42], macros: [50, 51, 52] },
    2: { proxies: [22, 23], templates: [42], macros: [52] },
    5: { proxies: [23], templates: [], macros: [] },
    6: { proxies: [21], templates: [41], macros: [51] },
    7: { proxies: [], templates: [], macros: [] }
  };
  for (const [who, want] of Object.entries(expect)) {
    ws.as(Number(who));
    assert.deepEqual(ids(await db.proxy.findMany({ where: await fns.scopedProxyWhere(undefined) })), want.proxies, `member ${who}: proxies`);
    assert.deepEqual(ids(await db.template.findMany({ where: await fns.scopedTemplateWhere(undefined) })), want.templates, `member ${who}: templates`);
    const scope = await fns.macroScope();
    assert.deepEqual(ids((await db.macro.findMany()).filter((m) => fns.macroVisible(scope, m))), want.macros, `member ${who}: macros`);
  }
  ws.as(6);
  await assert.rejects(fns.assertCanAccessProxy(20), /You do not have access to this proxy\./);
  assert.deepEqual((await fns.partitionAccessibleProxyIds([20, 21])).denied, [20]);
  await assert.rejects(fns.loadAccessibleMacro(50), /You do not have access to this macro\./, 'the Owner\'s recorded password stays with the Owner');
  const canManage = await fns.ownedRowManageChecker();
  assert.equal(canManage({ ownerMemberId: 1 }), false, 'a group or proxy group of the Owner');
  assert.equal(canManage({ ownerMemberId: 7 }), true, 'one of their Operator');
});

test('82: a Manager cannot share to, switch to or stop the runs of their parent', async () => {
  const db = seed();
  const ws = workspace(db);
  const fns = loadMain([...VALIDATORS, 'grantProfileAccess', 'switchMember', 'assertCanControlRun', 'serializeMember', 'initialsFrom'], {
    ...ws.deps,
    requirePermission: async () => {},
    partitionAccessibleProfileIds: async (list) => ({ allowed: list, denied: [] }),
    verifySecret: () => true, // even with the parent's password
    readVault: async () => ({ enabled: false }),
    vaultUnlockSource: null,
    currentMemberId: null,
    writeSetting: async () => {},
    ensureMemberOnboardingStore: async () => {},
    logAudit: async () => {}
  });
  ws.as(6);
  await assert.rejects(fns.grantProfileAccess({ profileIds: [103], memberId: 1, level: 'use' }), /You can only share profiles with members you manage\./);
  await assert.rejects(fns.switchMember({ id: 1, password: 'x' }), /You can only switch to members you manage\./);
  await assert.rejects(fns.assertCanControlRun(1), /This run was started by another member\./);
  await fns.assertCanControlRun(7); // their own Operator's run
  ws.as(5);
  await assert.rejects(fns.switchMember({ id: 2, password: 'right' }), /You can only switch to members you manage\./, 'Manager A into their Admin');
  await assert.rejects(fns.assertCanControlRun(2), /This run was started by another member\./);
  ws.as(1);
  await fns.assertCanControlRun(6); // the Owner still controls the Manager's runs
});

test('82: every caller of visibleMemberIds goes through the one rule (no caller adds the parent back)', () => {
  const callers = IPC.match(/permissions\.visibleMemberIds\(/g) || [];
  assert.ok(callers.length >= 25, `expected the known callers, found ${callers.length}`);
  assert.doesNotMatch(IPC, /parentMemberId\)\);?\s*\/\/ their parent/);
  assert.doesNotMatch(read('src', 'main', 'permissions.js'), /ids\.add\(Number\(viewer\.parentMemberId\)\)/);
  // SoftGlaze AI and the Local API use the same function through their host.
  assert.match(IPC, /visibleMemberIds: async \(member\) => permissions\.visibleMemberIds\(await getPrisma\(\)\.member\.findMany\(\), member\)/);
});

// ---- 3. The member dialog's status change ----

function loadUpdateMember(db, ws) {
  const audits = [];
  const fns = loadMain([...VALIDATORS, 'updateMember', 'serializeMember', 'initialsFrom'], {
    ...ws.deps,
    requirePermission: async () => {},
    assertCanManageMember: async () => {},
    assertSeatAvailable: async () => {},
    logAudit: async (action, opts) => { audits.push({ action, detail: opts && opts.detail }); }
  }, ['VALID_ROLES']);
  return { ...fns, audits };
}

test('3: suspending from the member dialog is logged as a status change, not an edit', async () => {
  const db = seed();
  const ws = workspace(db);
  ws.as(1);
  const { updateMember, audits } = loadUpdateMember(db, ws);
  // What the dialog sends: every field, unchanged, plus the new status.
  await updateMember({ id: 7, name: 'Operator B1', email: null, color: '#3DC6DA', status: 'suspended' });
  assert.deepEqual(audits, [{ action: 'member.status', detail: { target: 7, name: 'Operator B1', status: 'suspended', reason: null } }]);
  assert.equal((await db.member.findUnique({ where: { id: 7 } })).status, 'suspended');

  audits.length = 0;
  await updateMember({ id: 7, name: 'Operator B1 (night)', email: null, color: '#3DC6DA', status: 'active' });
  assert.deepEqual(audits.map((a) => a.action), ['member.status', 'member.update']);
  assert.equal(audits[0].detail.status, 'active');
  assert.deepEqual(audits[1].detail.changed, ['name'], 'only the fields that changed');

  audits.length = 0;
  await updateMember({ id: 7, name: 'Operator B1 (night)', email: null, color: '#3DC6DA', status: 'active' });
  assert.deepEqual(audits, [], 'a save that changes nothing logs nothing');
  // The Members page labels these two actions as before.
  const page = read('src', 'renderer', 'pages', 'MembersPage.jsx');
  assert.match(page, /'member\.status': 'status changed'/);
  assert.match(page, /'member\.update': 'member edited'/);
});

// ---- 4. The Owner's first sign-in ----

test('4: registering the workspace counts as the Owner\'s first sign-in', async () => {
  const db = createFakePrisma({});
  const settings = new Map();
  const fns = loadMain([...VALIDATORS, 'accountRegister', 'serializeMember', 'initialsFrom'], {
    getPrisma: () => db,
    permissions,
    assertFirstRunSetup: async () => {},
    tenantConfig: () => ({ enabled: false }),
    tenantSignup: null,
    ensureBackendInstall: null,
    licenseClient: null,
    otpKey: (k) => `otp:${k}`,
    readSetting: async (k, def) => (settings.has(k) ? settings.get(k) : def),
    writeSetting: async (k, v) => { settings.set(k, v); },
    verifySecret: () => true,
    hashSecret: () => ({ salt: 's', hash: 'h' }),
    recordSignupVerified: async () => {},
    currentMemberId: null,
    vaultLocked: true,
    vaultUnlockSource: null
  });
  settings.set('otp:reg:ann@example.com', { hash: 'x', salt: 'y', email: 'ann@example.com', expiresAt: Date.now() + 60000, attempts: 0 });
  const before = Date.now();
  const res = await fns.accountRegister({ firstName: 'Ann', lastName: 'Lee', email: 'ann@example.com', password: 'correct horse', code: '123456' });
  const owner = await db.member.findFirst({ where: { role: 'OWNER' } });
  assert.ok(owner.lastActiveAt instanceof Date && owner.lastActiveAt.getTime() >= before, 'stamped at registration');
  assert.ok(res.member.lastActiveAt, 'the Owner card has a last-active time (not "Never active")');
});

// ---- 2. Database encryption notice ----

test('2: the encryption card says the database opens by itself when "Keep me signed in" holds the workspace password', async () => {
  const { dbEncryptionNoticeKey } = await importLib('dbEncryptionNotice.mjs');
  assert.equal(dbEncryptionNoticeKey(null), 'dbEncryption.enabledNotice');
  assert.equal(dbEncryptionNoticeKey({ enabled: false, kind: null }), 'dbEncryption.enabledNotice');
  assert.equal(dbEncryptionNoticeKey({ enabled: true, kind: 'vault' }), 'dbEncryption.enabledNoticeRemembered');
  // A remembered member or Super Admin sign-in cannot open the database (attemptRememberedUnlock only
  // replays a 'vault' credential through dbUnlock), so the password is asked: the default notice.
  assert.equal(dbEncryptionNoticeKey({ enabled: true, kind: 'member' }), 'dbEncryption.enabledNotice');
  assert.equal(dbEncryptionNoticeKey({ enabled: true, kind: 'super' }), 'dbEncryption.enabledNotice');
  assert.match(extractFunction(IPC, 'attemptRememberedUnlock'), /if \(blob\.kind === 'vault'\) \{[\s\S]*database\.unlockEncryptedDb\(password\)/);

  const card = read('src', 'renderer', 'components', 'DbEncryptionSettings.jsx');
  assert.match(card, /t\(dbEncryptionNoticeKey\(remember\)\)/);
  assert.match(card, /softglazeApi\.auth\.rememberStatus\(\)/);
  const keys = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${pre}${k}.`) : [`${pre}${k}`]));
  const loc = (lang) => JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, 'cmpSettingsB.json'));
  assert.deepEqual(keys(loc('es')).sort(), keys(loc('en')).sort());
  assert.match(loc('en').dbEncryption.enabledNoticeRemembered, /unlocks the database by itself at launch/);
  assert.match(loc('en').dbEncryption.enabledNoticeRemembered, /Forget this device/);
  assert.match(loc('es').dbEncryption.enabledNoticeRemembered, /Olvidar este dispositivo/);
});
