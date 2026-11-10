'use strict';
// 1.0.26 permission round 3 (the gaps PR #63 listed as "noticed, not fixed"):
//  1. Workspace settings (setGlobalSettings) had no permission check.
//  2. Cookie import and export accepted a profile shared "use only".
//  3. A copy of a "use only" share took its 2FA seed and saved platform logins.
//  4. In-browser Autofill offered the Owner's whole Data Vault to every member.
//  5. The Proxy providers and Free proxies pages were not role-gated in the UI.
//  6. "Visible features" only hid sidebar items; main did not enforce them.
//  7. getProxyPolicy returned every profile's override to any member.
// Main-process functions run for real from ipcHandlers.js with the real permissions module and an
// in-memory database stand-in (test/helpers/fakePrisma.js), as in test/permissionsFollowup.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const permissions = require('../src/main/permissions');
const rbacPolicy = require('../src/main/rbacPolicy');
const featureGate = require('../src/main/featureGate');
const { redactPlatformAccounts, redactUseOnlyProxy } = require('../src/main/profileRedaction');
const { BROWSER_CORE, normalizeBrowserCore } = require('../src/main/importParser');
const { createFakePrisma } = require('./helpers/fakePrisma');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const IPC = read('src', 'main', 'ipcHandlers.js');
const PRELOAD = read('src', 'preload', 'preload.js');

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
  { id: 1, name: 'Owner', role: 'OWNER', parentMemberId: null, status: 'active' },
  { id: 2, name: 'Admin', role: 'ADMIN', parentMemberId: 1, status: 'active' },
  { id: 3, name: 'Operator X', role: 'OPERATOR', parentMemberId: 2, status: 'active' },
  { id: 4, name: 'Operator Y', role: 'OPERATOR', parentMemberId: 2, status: 'active' },
  { id: 5, name: 'Manager', role: 'MANAGER', parentMemberId: 2, status: 'active' }
];
const ACCOUNTS = JSON.stringify([{ platform: 'Facebook', username: 'owner@example.com', password: 'hunter2', twoFa: 'JBSWY3DPEHPK3PXP' }]);

function seed() {
  return createFakePrisma({
    member: MEMBERS.map((m) => ({ ...m })),
    profile: [
      { id: 100, title: 'x-1', dataDirName: 'x-1', ownerMemberId: 3, assignedMemberId: 3, browserCore: 'Chromium', deletedAt: null },
      { id: 101, title: 'y-1', dataDirName: 'y-1', ownerMemberId: 4, assignedMemberId: 4, browserCore: 'Chromium', deletedAt: null },
      // The Owner's profiles: 104 shared with X and the Manager "use only", 106 shared with both for editing.
      { id: 104, title: 'shared-use', dataDirName: 'shared-use', ownerMemberId: 1, assignedMemberId: 1, browserCore: 'Chromium', deletedAt: null,
        twoFactorSeed: 'enc:v1:seed', platformAccounts: ACCOUNTS, proxyId: null, proxyInfoString: 'gw.example.net:7000:owner:secret', systemProxyBehavior: 'PROFILE_PROXY',
        accesses: [{ memberId: 3, level: 'use' }, { memberId: 5, level: 'use' }] },
      { id: 106, title: 'shared-edit', dataDirName: 'shared-edit', ownerMemberId: 1, assignedMemberId: 1, browserCore: 'Chromium', deletedAt: null,
        twoFactorSeed: 'enc:v1:seed2', platformAccounts: ACCOUNTS, systemProxyBehavior: 'DIRECT',
        accesses: [{ memberId: 3, level: 'edit' }, { memberId: 5, level: 'edit' }] }
    ]
  });
}

// The acting member (null = single-user mode) and the helpers that read it.
function workspace(db) {
  const state = { member: null };
  const visibleOf = (m) => permissions.visibleMemberIds(MEMBERS, m);
  const deps = {
    getPrisma: () => db,
    permissions,
    featureGate,
    getActiveMember: async () => state.member,
    PROFILE_ACCESS_SELECT: { id: true, ownerMemberId: true, assignedMemberId: true, accesses: { select: { memberId: true, level: true } } },
    PERMISSIONS: permissions.ACTION_MIN_RANK,
    rankOf: permissions.rankOf,
    // The real rule, shares included: the stand-in database does not model the ProfileAccess relation,
    // so the visible ids are worked out here and passed as an id list.
    scopedProfileWhere: async (base) => {
      const m = state.member;
      if (!m || m.role === 'SUPER_ADMIN') return base;
      const visible = visibleOf(m);
      const rows = await db.profile.findMany();
      const ids = rows.filter((r) => permissions.profileRowAccessible(visible, r, false)).map((r) => r.id);
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

// ---- 1. Workspace settings ----

function loadSettings(stored = {}) {
  const db = seed();
  const ws = workspace(db);
  const settings = new Map([['globalSettings', JSON.parse(JSON.stringify(stored))]]);
  const fns = loadMain([...VALIDATORS, 'requirePermission', 'deepMergeSettings', 'getGlobalSettings', 'setGlobalSettings',
    'activeIsSuperAdmin', 'withoutSuperOnlyKeys', 'getGlobalSettingsForActor', 'changedGlobalSettingKeys',
    'assertCanWriteGlobalSettings', 'withoutWorkspaceSecrets', 'setGlobalSettingsForActor',
    // Saved filters and warm-up lists are each member's own since round 4 (test/permissionsRound4.test.js).
    'withMemberPageLists', 'pageListsOwnerKey', 'emptyPageLists', 'memberSinceStamp', 'copyJson', 'loadMemberPageLists',
    'ownPageListsIn', 'readOwnPageLists', 'writeOwnPageLists',
    // The first-run flag is each member's own since round 5 (test/permissionsRound5.test.js).
    'onboardingOwnerKey', 'withMemberOnboarding', 'loadMemberOnboarding', 'ownOnboardingDoneIn', 'readOwnOnboardingDone',
    'readOwnOnboardingDoneSafe', 'writeOwnOnboardingDone'], {
    ...ws.deps,
    readSetting: async (k, d) => (settings.has(k) ? JSON.parse(JSON.stringify(settings.get(k))) : d),
    readSettingStrict: async (k) => (settings.has(k) ? JSON.parse(JSON.stringify(settings.get(k))) : undefined),
    writeSetting: async (k, v) => { settings.set(k, JSON.parse(JSON.stringify(v))); }
  }, ['GLOBAL_SETTINGS_DEFAULTS', 'SUPER_ONLY_GLOBAL_KEYS', 'GLOBAL_SETTING_WRITE_RULES', 'WORKSPACE_SETTING_RULE', 'SETTING_ROLE_PHRASE',
    'MEMBER_PAGE_LIST_KEYS', 'MEMBER_PAGE_LISTS_SETTING', 'memberPageListsLock', 'MEMBER_ONBOARDING_SETTING', 'memberOnboardingLock']);
  return { ws, fns, settings, stored: () => settings.get('globalSettings') };
}

test('workspace settings: the Owner and Admins change them, Managers and Operators are refused with the role needed', async () => {
  const { ws, fns, stored } = loadSettings();
  for (const who of [3, 5]) {
    ws.as(who);
    await assert.rejects(fns.setGlobalSettingsForActor({ browser: { disableDevtools: true } }),
      /Your role does not permit this action: only the Owner or an Admin can change the workspace settings\./, `member ${who}`);
    await assert.rejects(fns.setGlobalSettingsForActor({ startPageLinks: [{ label: 'x', url: 'https://x.example' }] }), /only the Owner or an Admin/, 'start-page links are workspace-wide');
    await assert.rejects(fns.setGlobalSettingsForActor({ website: { localNetworkAccess: true } }), /only the Owner or an Admin/);
  }
  assert.equal(stored().browser, undefined, 'nothing was written');
  ws.as(2);
  assert.equal((await fns.setGlobalSettingsForActor({ browser: { disableDevtools: true } })).browser.disableDevtools, true);
  ws.as(1);
  assert.equal((await fns.setGlobalSettingsForActor({ performance: { launchConcurrency: 3 } })).performance.launchConcurrency, 3);
  ws.as(null);
  assert.equal((await fns.setGlobalSettingsForActor({ audit: { retentionDays: 30 } })).audit.retentionDays, 30, 'single-user mode is the Owner');
});

test('workspace settings: the Owner can turn settings.manage off for one Admin, and a hidden Settings page refuses too', async () => {
  const { ws, fns } = loadSettings();
  ws.as(2, revoked('settings.manage'));
  await assert.rejects(fns.setGlobalSettingsForActor({ browser: { disableDevtools: true } }), /turned off for your account by an administrator/);
  ws.as(2, hidden('settings'));
  await assert.rejects(fns.setGlobalSettingsForActor({ browser: { disableDevtools: true } }), /Settings is turned off for your account by an administrator\./);
  ws.as(2, { status: 'suspended' });
  await assert.rejects(fns.setGlobalSettingsForActor({ browser: { disableDevtools: true } }), /This member is suspended\./);
});

test('workspace settings: a member\'s own page lists stay writable, Smart Autofill is the Owner\'s, footer branding the Super Admin\'s', async () => {
  const { ws, fns, stored } = loadSettings();
  ws.as(3); // an Operator: saved Profiles filters, the first-run flag and the warm-up lists
  await fns.setGlobalSettingsForActor({ profileFilters: [{ name: 'mine', filter: {} }] });
  await fns.setGlobalSettingsForActor({ onboardingDone: true });
  await fns.setGlobalSettingsForActor({ warmer: { sites: ['https://example.com'] } });
  // Round 5: the first-run flag is the Operator's own; the workspace's (the Owner's) is unchanged.
  assert.equal(stored().onboardingDone, undefined);
  assert.equal((await fns.getGlobalSettingsForActor()).onboardingDone, true);
  // Round 4: the filters and warm-up lists are the Operator's own; the Owner's stay as they were.
  const mine = await fns.getGlobalSettingsForActor();
  assert.deepEqual([mine.profileFilters.length, mine.warmer.sites.length], [1, 1]);
  // (No write of the Operator's reaches globalSettings any more, so it holds nothing at all here.)
  assert.deepEqual([(stored().profileFilters || []).length, stored().warmer], [0, undefined]);
  ws.as(3, revoked('automation.run'));
  await assert.rejects(fns.setGlobalSettingsForActor({ warmer: { loop: true } }), /turned off for your account by an administrator/);

  for (const who of [2, 5]) {
    ws.as(who);
    await assert.rejects(fns.setGlobalSettingsForActor({ smartAutofill: { members: true } }), /only the Owner can change the Smart Autofill settings\./, `member ${who}`);
  }
  ws.as(1);
  assert.equal((await fns.setGlobalSettingsForActor({ smartAutofill: { members: true } })).smartAutofill.members, true);
  await assert.rejects(fns.setGlobalSettingsForActor({ branding: { footerText: 'mine' } }), /Only the Super Admin can change the footer branding\./);
  ws.as('super');
  assert.equal((await fns.setGlobalSettingsForActor({ branding: { footerText: 'mine' } })).branding.footerText, 'mine');
});

test('workspace settings: only groups a write changes are checked, so saving back what was read is not refused', async () => {
  const { ws, fns } = loadSettings({ browser: { disableDevtools: true } });
  ws.as(1);
  const all = await fns.getGlobalSettingsForActor();
  ws.as(5); // a Manager writes the whole blob back with one member flag changed (the old onboarding wizard)
  const res = await fns.setGlobalSettingsForActor({ ...all, onboardingDone: true });
  assert.equal(res.onboardingDone, true);
  await assert.rejects(fns.setGlobalSettingsForActor({ ...all, browser: { ...all.browser, disableDevtools: false } }), /only the Owner or an Admin/);
});

test('workspace settings: the CAPTCHA key reaches only members who may change it, and cannot be wiped by writing a read back', async () => {
  const { ws, fns, stored } = loadSettings({ captcha: { enabled: true, apiKey: 'paid-key' } });
  for (const who of [3, 5]) {
    ws.as(who);
    assert.equal((await fns.getGlobalSettingsForActor()).captcha.apiKey, '', `member ${who}`);
    assert.equal((await fns.setGlobalSettingsForActor({ onboardingDone: true })).captcha.apiKey, '', 'the write\'s answer is filtered the same way');
  }
  ws.as(5);
  const seen = await fns.getGlobalSettingsForActor();
  await assert.rejects(fns.setGlobalSettingsForActor(seen), /only the Owner or an Admin/);
  assert.equal(stored().captcha.apiKey, 'paid-key');
  for (const who of [1, 2, null]) {
    ws.as(who);
    assert.equal((await fns.getGlobalSettingsForActor()).captcha.apiKey, 'paid-key', `member ${who}`);
  }
  ws.as(2, revoked('settings.manage'));
  assert.equal((await fns.getGlobalSettingsForActor()).captcha.apiKey, '');
});

test('the catalog has settings.manage (Admin and up) and the renderer table matches', async () => {
  const entry = permissions.ACTION_CATALOG.find((a) => a.key === 'settings.manage');
  assert.deepEqual([entry.minRank, entry.category], [3, 'Workspace']);
  const ui = await import(pathToFileURL(path.join(ROOT, 'src', 'renderer', 'lib', 'memberPermissions.mjs')).href);
  assert.deepEqual({ ...ui.ACTION_MIN_RANK }, { ...permissions.ACTION_MIN_RANK });
  const me = (m) => ({ id: m.id, role: m.role, status: 'active', permissions: permissions.effectivePermissions(m) });
  assert.deepEqual([1, 2, 5, 3].map((id) => ui.can(me(MEMBERS.find((m) => m.id === id)), 'settings.manage')), [true, true, false, false]);
  assert.deepEqual(ui.denial(me(MEMBERS[4]), 'settings.manage'), { kind: 'role', role: 'ADMIN' });
  // Cookie export: profiles.export and the Manager role (main's cookieDump reveal rank).
  assert.deepEqual([1, 2, 5, 3].map((id) => ui.cookieExportDenial(me(MEMBERS.find((m) => m.id === id)))), [null, null, null, { kind: 'role', role: 'MANAGER' }]);
  assert.equal(rbacPolicy.RAW_VALUE_MIN_RANK.cookieDump, permissions.ROLE_RANK.MANAGER);
  assert.deepEqual(ui.cookieExportDenial(me({ ...MEMBERS[4], ...revoked('profiles.export') })), { kind: 'revoked' });
  // Visible features.
  assert.equal(ui.featureVisible(me({ ...MEMBERS[2], ...hidden('proxies') }), 'proxies'), false);
  assert.equal(ui.featureVisible(me(MEMBERS[2]), 'proxies'), true);
  assert.equal(ui.featureVisible(null, 'proxies'), true);
  assert.equal(ui.featureVisible(undefined, 'proxies'), false);
});

test('the Settings page shows workspace sections read-only to members who may not change them', () => {
  const PAGE = read('src', 'renderer', 'pages', 'SettingsPage.jsx');
  assert.match(PAGE, /const denySettings = perm\.deny\('settings\.manage'\);/);
  assert.match(PAGE, /const denyVault = perm\.deny\('vault\.manage'\);/);
  assert.match(PAGE, /const denySchedule = perm\.denyWorkspaceProxy\(\);/);
  // A read-only section disables every control in it through a fieldset and says why.
  assert.match(PAGE, /<fieldset disabled title=\{readOnly\} aria-describedby=\{roId\}/);
  for (const name of ['OnStartupSection', 'CaptchaSection']) {
    assert.match(PAGE, new RegExp(`<ReadOnly deny=\\{denySettings\\}><${name} `), name);
  }
  for (const name of ['FingerprintSection', 'BehaviourSection', 'WebsiteSection', 'PerformanceSection', 'ReliabilitySection', 'AuditSection']) {
    const at = PAGE.indexOf(`<${name} sec=`);
    const open = PAGE.lastIndexOf('<ReadOnly deny={denySettings}>', at);
    assert.ok(open > -1 && PAGE.indexOf('</ReadOnly>', open) > at, `${name} sits inside a read-only block`);
  }
  assert.match(PAGE, /<ReadOnly deny=\{denyVault\}><AutofillSection /);
  assert.match(PAGE, /<ReadOnly deny=\{denySchedule\}><SchedulerSection /);
  assert.match(PAGE, /<EmailSection sec=\{SEC\.email\} deny=\{denyEmail\} denyTest=\{perm\.deny\('members\.manage'\)\} \/>/);
  assert.match(PAGE, /apply\(\{ smartAutofill: \{ members: v \} \}\)/, 'the Owner\'s switch for members\' autofill');
  // Start-page links, the pre-launch "don't check again" box and the onboarding flag.
  const LINKS = read('src', 'renderer', 'pages', 'StartLinksPage.jsx');
  assert.match(LINKS, /const deny = perm\.denyWorkspaceSettings\(\);/);
  assert.match(LINKS, /<fieldset disabled=\{Boolean\(deny\)\}/);
  assert.match(LINKS, /<GuardedButton deny=\{deny\} variant="primary" size="sm" onClick=\{save\}/);
  assert.match(read('src', 'renderer', 'pages', 'ProfilesPage.jsx'), /canStopAsking=\{!perm\.denyWorkspaceSettings\(\)\}/);
  assert.match(read('src', 'renderer', 'components', 'PreLaunchCheck.jsx'), /\{canStopAsking && \(/);
  const WIZARD = read('src', 'renderer', 'components', 'OnboardingWizard.jsx');
  assert.doesNotMatch(WIZARD, /\.\.\.\(g \|\| \{\}\), onboardingDone/, 'the wizard no longer writes the whole settings blob');
  assert.equal((WIZARD.match(/setGlobal\(\{ onboardingDone: true \}\)/g) || []).length, 2);
});

// ---- 2. Cookie import and export ----

function loadCookies() {
  const db = seed();
  const ws = workspace(db);
  const imported = [];
  const fns = loadMain([...VALIDATORS, 'requirePermission', 'assertCanAccessProfile', 'partitionAccessibleProfileIds', 'assertCanRevealKind',
    'cookieExpirySeconds', 'netscapeToCookies', 'parseJsonCookies', 'toSetCookieParam', 'cookieHealth', 'cookiesToNetscape',
    'exportProfileCookies', 'importProfileCookies', 'importCookiesToRunning', 'exportProfileArchive'], {
    ...ws.deps,
    rbacPolicy, BROWSER_CORE, normalizeBrowserCore, path,
    logAudit: async () => {},
    exportSessionCookies: async () => [{ name: 'sid', value: 'v', domain: '.example.com' }],
    exportStoredCookies: async () => [],
    offlineProfileOpts: async () => ({ userDataDir: 'x' }),
    importSessionCookies: async (sid, params) => { imported.push(Number(sid) || sid); return { imported: params.length }; },
    importStoredCookies: async (_o, params) => ({ imported: params.length }),
    listActiveSessions: () => [100, 101, 104, 106, 'temp'].map((id) => ({ sessionId: String(id), profileName: `p${id}` })),
    getRuntimeConfig: () => ({ profileRoot: 'profiles' }),
    dialog: { showSaveDialog: async () => ({ canceled: true }) },
    profileArchive: {}
  }, ['REVEAL_LABELS']);
  return { ws, fns, imported };
}
const COOKIES = JSON.stringify([{ name: 'sid', value: 'a', domain: '.example.com' }]);

test('cookie export needs edit access, profiles.export and the Manager role; a "use only" share is refused', async () => {
  const { ws, fns } = loadCookies();
  ws.as(5);
  await assert.rejects(fns.exportProfileCookies({ id: 104 }), /You do not have access to this profile\./, 'use-only share');
  await assert.rejects(fns.exportProfileArchive({ id: 104, password: 'longpassword' }), /You do not have access to this profile\./, 'archive, use-only share');
  assert.equal((await fns.exportProfileCookies({ id: 106 })).count, 1, 'shared for editing');
  assert.deepEqual(await fns.exportProfileArchive({ id: 106, password: 'longpassword' }), { cancelled: true });
  ws.as(5, revoked('profiles.export'));
  await assert.rejects(fns.exportProfileCookies({ id: 106 }), /turned off for your account by an administrator/);
  await assert.rejects(fns.exportProfileArchive({ id: 106, password: 'longpassword' }), /turned off for your account by an administrator/);
  ws.as(3); // an Operator never exports cookies, not even their own profile's (unchanged)
  await assert.rejects(fns.exportProfileCookies({ id: 100 }), /Your role cannot export cookies or archives/);
  ws.as(1);
  assert.equal((await fns.exportProfileCookies({ id: 104 })).count, 1, 'the Owner, their own profile');
});

test('cookie import needs profiles.edit and edit access; "Import to all running" skips profiles the member may not edit', async () => {
  const { ws, fns, imported } = loadCookies();
  ws.as(3);
  await assert.rejects(fns.importProfileCookies({ id: 104, data: COOKIES }), /You do not have access to this profile\./, 'use-only share');
  await assert.rejects(fns.importProfileCookies({ id: 101, data: COOKIES }), /You do not have access to this profile\./, 'a sibling\'s profile');
  assert.equal((await fns.importProfileCookies({ id: 106, data: COOKIES })).imported, 1, 'shared for editing');
  assert.equal((await fns.importProfileCookies({ id: 100, data: COOKIES })).imported, 1, 'their own');
  imported.length = 0;
  const bulk = await fns.importCookiesToRunning({ data: COOKIES });
  assert.deepEqual(bulk.results.map((r) => Number(r.sessionId)), [100, 106], 'never the use-only share or another member\'s profile');
  ws.as(3, revoked('profiles.edit'));
  await assert.rejects(fns.importProfileCookies({ id: 100, data: COOKIES }), /turned off for your account by an administrator/);
  await assert.rejects(fns.importCookiesToRunning({ data: COOKIES }), /turned off for your account by an administrator/);
  ws.as(null);
  assert.equal((await fns.importCookiesToRunning({ data: COOKIES })).targets, 5, 'single-user mode: every running session, as before');
});

test('the Profiles row and the cookie dialog disable what main refuses', () => {
  const PROFILES = read('src', 'renderer', 'pages', 'ProfilesPage.jsx');
  assert.match(PROFILES, /<GuardedButton deny=\{perm\.denyCookieExport\(p\) && perm\.denyCookieImport\(p\)\}[^\n]*setCookieProfile\(/);
  assert.match(PROFILES, /denyExport=\{perm\.denyCookieExport\(cookieProfile\)\}/);
  assert.match(PROFILES, /denyImport=\{perm\.denyCookieImport\(cookieProfile\)\}/);
  assert.match(PROFILES, /denyBulk=\{perm\.deny\('profiles\.edit'\)\}/);
  const MODAL = read('src', 'renderer', 'components', 'CookieManagerModal.jsx');
  assert.match(MODAL, /<GuardedButton deny=\{denyExport\}[^\n]*onClick=\{handleExport\}/);
  assert.match(MODAL, /<GuardedButton deny=\{denyImport\}[^\n]*onClick=\{handleImport\}/);
  assert.match(MODAL, /<GuardedButton deny=\{denyBulk\}[^\n]*onClick=\{handleBulkImport\}/);
  const HOOK = read('src', 'renderer', 'lib', 'usePermissions.js');
  assert.match(HOOK, /denyCookieExport: \(row\) => text\(cookieExportDenial\(me\)\) \|\| \(row && row\.canEdit === false \? t\('perm\.useOnly'\) : null\)/);
  assert.match(HOOK, /denyCookieImport: \(row\) => text\(denial\(me, 'profiles\.edit'\)\) \|\| \(row && row\.canEdit === false \? t\('perm\.useOnly'\) : null\)/);
});

// ---- 3. A copy of a "use only" share ----

function loadClone() {
  const db = seed();
  const ws = workspace(db);
  const fns = loadMain([...VALIDATORS, 'requirePermission', 'assertCanAccessProfile', 'reconcileReferences', 'reconcileReferencesForMember',
    'pickCloneableFields', 'stripUseOnlySecrets', 'cloneProfile'], {
    ...ws.deps,
    assertWithinLimit: async () => {}, ensureUniqueDataDirName: async (_db, n) => n,
    claimDeviceIdentity: async (_db, _s, data) => data,
    assertCanAccessProxy: async () => {}, assertCanAccessGroup: async () => {},
    serializeProfile: (p) => p, generateFingerprint: () => ({}), ownerStampId: () => (ws.state.member && ws.state.member.id >= 0 ? ws.state.member.id : null)
  }, ['CLONE_EXCLUDE']);
  return { db, ws, fns };
}

test('a copy of a "use only" share leaves out the 2FA seed, saved logins and a bare proxy address, and says so', async () => {
  const { ws, fns } = loadClone();
  for (const who of [3, 5]) {
    ws.as(who);
    const copy = await fns.cloneProfile({ id: 104 });
    assert.equal(copy.ownerMemberId, who);
    assert.deepEqual([copy.twoFactorSeed, copy.platformAccounts, copy.proxyInfoString], [null, null, null], `member ${who}`);
    assert.equal(copy.systemProxyBehavior, 'PROFILE_PROXY', 'still asks for a proxy before launch');
    assert.deepEqual(copy.leftOut, { proxy: true, group: false, twoFactor: true, logins: true });
  }
  ws.as(3); // shared for editing: kept, as before
  const edit = await fns.cloneProfile({ id: 106 });
  assert.deepEqual([edit.twoFactorSeed, edit.platformAccounts], ['enc:v1:seed2', ACCOUNTS]);
  assert.deepEqual(edit.leftOut, { proxy: false, group: false, twoFactor: false, logins: false });
  ws.as(1); // the Owner's own profile: kept
  const own = await fns.cloneProfile({ id: 104 });
  assert.deepEqual([own.twoFactorSeed, own.platformAccounts, own.proxyInfoString], ['enc:v1:seed', ACCOUNTS, 'gw.example.net:7000:owner:secret']);
  ws.as(4);
  await assert.rejects(fns.cloneProfile({ id: 104 }), /You do not have access to this profile\./, 'not shared with Y at all');
});

test('stripUseOnlySecrets: a DIRECT profile\'s stale address is cleared without reporting a missing proxy', () => {
  const { stripUseOnlySecrets } = loadMain(['stripUseOnlySecrets'], {});
  const left = { proxy: false, group: false, twoFactor: false, logins: false };
  const fields = { twoFactorSeed: null, platformAccounts: '[]', proxyId: null, proxyInfoString: 'old:1', systemProxyBehavior: 'DIRECT' };
  stripUseOnlySecrets(fields, left);
  assert.deepEqual([fields.proxyInfoString, left.proxy, left.twoFactor, left.logins], [null, false, false, false]);
  const broken = { platformAccounts: 'not json' };
  assert.equal(stripUseOnlySecrets(broken, { ...left }).logins, true, 'an unreadable list still counts as left out');
});

test('a "use only" share never hands over its saved logins in the profile list or the spreadsheet export either', async () => {
  const db = seed();
  const ws = workspace(db);
  const { withViewerEditFlags } = loadMain(['withViewerEditFlags', 'proxyInVisiblePool'], {
    ...ws.deps, redactPlatformAccounts, redactUseOnlyProxy, currentMemberCanRevealProxy: true, proxyRevealAllowed: () => true,
    serializeProfile: (p) => ({ ...p, platformAccounts: p.platformAccounts ? JSON.parse(p.platformAccounts) : [] })
  });
  ws.as(5); // a Manager may reveal credentials, but not a use-only share's
  const rows = Object.fromEntries((await withViewerEditFlags(await db.profile.findMany())).map((p) => [p.id, p]));
  assert.deepEqual([rows[104].platformAccounts[0].password, rows[104].platformAccounts[0].twoFa, rows[104].platformAccounts[0].username], ['••••••••', '••••••••', 'owner@example.com']);
  assert.equal(rows[106].platformAccounts[0].password, 'hunter2', 'shared for editing: unchanged');

  const { gatherExport } = loadMain(['assertCanRevealKind', 'firstAccount', 'proxyInVisiblePool', 'gatherExport'], {
    ...ws.deps, rbacPolicy, readSetting: async (_k, d) => d, currentMemberCanRevealProxy: true, proxyRevealAllowed: () => true,
    doNotTrackChoice: require('../src/main/doNotTrack').doNotTrackChoice
  }, ['REVEAL_LABELS', 'EXPORT_COLUMNS']);
  const out = await gatherExport();
  const col = (name) => out.headers.indexOf(name);
  const byTitle = Object.fromEntries(out.rows.map((r) => [r[col('Name')] || r[col('Profile Name')] || r[0], r]));
  const rowOf = (title) => out.rows.find((r) => r.includes(title));
  assert.ok(Object.keys(byTitle).length >= 2);
  assert.deepEqual([rowOf('shared-use')[col('Account Password')], rowOf('shared-use')[col('2FA Key')]], ['', '']);
  assert.deepEqual([rowOf('shared-edit')[col('Account Password')], rowOf('shared-edit')[col('2FA Key')]], ['hunter2', 'JBSWY3DPEHPK3PXP']);
});

test('the clone result says what was left out, and the clone buttons warn on a "use only" share', () => {
  const PROFILES = read('src', 'renderer', 'pages', 'ProfilesPage.jsx');
  assert.match(PROFILES, /if \(left\.twoFactor\) notes\.push\(t\('permNotes\.cloneNoTwoFactor'\)\);/);
  assert.match(PROFILES, /if \(left\.logins\) notes\.push\(t\('permNotes\.cloneNoLogins'\)\);/);
  assert.match(PROFILES, /const cloneTitle = \(p, key\) => \(p && p\.canEdit === false \?/);
  assert.match(PROFILES, /onClick=\{\(\) => handleClone\(p\.id\)\} title=\{cloneTitle\(p, 'actions\.cloneSame'\)\}/);
});

// ---- 4. Autofill and the Data Vault ----

function loadAutofill(globals = {}) {
  const db = seed();
  const state = { id: null, dbDown: false };
  const sessionLaunchers = new Map();
  // Round 5: the Firefox-wide rule (firefoxAutofillAllowed) is gone; both bridges ask per session.
  const fns = loadMain(['vaultAutofillAllowed', 'personaVaultAvailable', 'sessionAutofillAllowed'], {
    permissions,
    sessionLaunchers,
    firefoxEngine: { isFirefoxSession: () => false },
    getPrisma: () => (state.dbDown ? { member: { findUnique: async () => { throw new Error('locked'); } } } : db),
    getGlobalSettings: async () => globals,
    ipcAuthState: async () => ({ vaultLocked: false, signedIn: state.id != null, memberCount: 5 })
  });
  return { db, state, fns, sessionLaunchers };
}

test('autofill offers the vault to the Owner only, unless the Owner lets team members use it', async () => {
  // Round 4: the rule is asked for the member who launched the browser (test/permissionsRound4.test.js).
  const off = loadAutofill({ smartAutofill: { enabled: true, members: false } });
  const who = async (id) => off.fns.vaultAutofillAllowed(id);
  assert.deepEqual([await who(1), await who(2), await who(5), await who(3)], [true, false, false, false]);
  assert.equal(await who(-1), true, 'the Super Admin');
  assert.equal(await who(null), true, 'single-user mode is the Owner');
  off.sessionLaunchers.set('100', { memberId: 2, firefoxAutofill: false });
  off.sessionLaunchers.set('104', { memberId: 1, firefoxAutofill: false });
  off.state.id = 2;
  assert.equal(await off.fns.personaVaultAvailable({ sessionId: '100' }), false, 'the bridges get nothing for a browser an Admin launched');
  assert.equal(await off.fns.personaVaultAvailable({ sessionId: '104' }), true);
  off.state.id = null; // signed out on a workspace with members: nothing, as before
  assert.equal(await off.fns.personaVaultAvailable({ sessionId: '104' }), false);

  const on = loadAutofill({ smartAutofill: { enabled: true, members: true } });
  for (const id of [2, 5, 3]) assert.equal(await on.fns.vaultAutofillAllowed(id), true, `member ${id}`);
  await on.db.member.update({ where: { id: 3 }, data: { status: 'suspended' } });
  assert.equal(await on.fns.vaultAutofillAllowed(3), false, 'a suspended member gets nothing');
  on.state.dbDown = true;
  assert.equal(await on.fns.vaultAutofillAllowed(2), false, 'fails closed when the member cannot be read');
  // Defaults: off for members.
  const defaults = extractConst(IPC, 'GLOBAL_SETTINGS_DEFAULTS');
  assert.match(defaults, /smartAutofill: \{ enabled: true, firefox: true, members: false \}/);
});

test('both autofill bridges and the Firefox launch use the rule', () => {
  const reg = IPC.slice(IPC.indexOf('function registerIpcHandlers()'));
  const chromium = reg.slice(reg.indexOf('configurePersonaBridge({'), reg.indexOf('autofillBridge.configure({'));
  // Round 4: the session's launcher decides (test/permissionsRound4.test.js).
  assert.match(chromium, /isAvailable: \(ctx\) => personaVaultAvailable\(\{ sessionId: /);
  assert.match(chromium, /return on && \(await sessionAutofillAllowed\(/, 'no autofill button in a browser its launcher may not use it in');
  const firefox = reg.slice(reg.indexOf('autofillBridge.configure({'));
  // Round 5: the Firefox bridge passes the session that owns the port the call came in on.
  assert.match(firefox, /isAvailable: \(ctx\) => personaVaultAvailable\(\{ sessionId: ctx && ctx\.sessionId != null \? ctx\.sessionId : null \}\)/);
  assert.match(IPC, /&& \(globalSettings\.smartAutofill\?\.firefox !== false\)\s*&& \(await vaultAutofillAllowed\(launchedBy\)\);/, 'the Firefox autofill add-on is installed only for an allowed launcher');
  // The Owner's switch lives in Settings > Smart Autofill (Owner only), and the Data Vault notice says so.
  for (const lang of ['en', 'es']) {
    const ns = JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, 'settingsExtra.json'));
    assert.ok(ns.smartAutofill.members.title && ns.smartAutofill.members.desc, lang);
  }
  assert.match(JSON.parse(read('src', 'renderer', 'i18n', 'locales', 'en', 'common.json')).perm.vaultBody, /only if the Owner turned on/);
  assert.match(read('src', 'renderer', 'components', 'BrandingSettings.jsx'), /const canManageAutofill = !me \|\| me\.role === 'SUPER_ADMIN' \|\| me\.role === 'OWNER';/);
});

// ---- 5. Proxy providers and Free proxies ----

test('the Proxy providers and Free proxies pages disable what main refuses', () => {
  const PROVIDERS_PAGE = read('src', 'renderer', 'pages', 'ProxyProvidersPage.jsx');
  assert.match(PROVIDERS_PAGE, /const denyPull = perm\.deny\('proxies\.manage'\);/);
  assert.match(PROVIDERS_PAGE, /<fieldset disabled=\{Boolean\(denyPull\)\} title=\{denyPull \|\| undefined\}[^\n]*provider-workspace">/);
  assert.match(PROVIDERS_PAGE, /\{!p\.unavailable && !denyPull && <ProviderAccount providerKey=\{p\.key\} \/>\}/);
  const CONNECTORS = read('src', 'renderer', 'components', 'ProxyProviders.jsx');
  assert.match(CONNECTORS, /const denyCreds = usePermissions\(\)\.denyOwner\(\);/);
  assert.equal((CONNECTORS.match(/onClick=\{handleSaveCreds\} disabled=\{savingCreds \|\| Boolean\(denyCreds\)\} title=\{denyCreds \|\| undefined\}/g) || []).length, 2, 'both Save credentials buttons');
  const SEARCH = read('src', 'renderer', 'components', 'FreeProxySearch.jsx');
  assert.match(SEARCH, /const deny = usePermissions\(\)\.deny\('proxies\.manage'\);/);
  assert.match(SEARCH, /<GuardedButton deny=\{deny\} type="submit"/);
  assert.match(SEARCH, /if \(!running && !deny\) start\(\);/);
  const FREE = read('src', 'renderer', 'pages', 'FreeProxiesPage.jsx');
  assert.match(FREE, /const denyManage = usePermissions\(\)\.deny\('proxies\.manage'\);/);
  assert.equal((FREE.match(/<GuardedButton deny=\{denyManage\}/g) || []).length, 3, 'delete dead, delete selected, delete one');
  // Main: every action on both pages needs proxies.manage (saving vendor keys: the Owner).
  for (const fn of ['syncVendorPool', 'vendorLookup', 'getProviderAccount', 'harvestFreeProxiesHandler', 'cancelFreeProxyHarvest', 'deleteProxy', 'bulkDeleteProxies']) {
    assert.match(extractFunction(IPC, fn), /await requirePermission\('proxies\.manage'\)/, fn);
  }
  assert.match(extractFunction(IPC, 'saveProxyProviderCreds'), /await requireOwnerOrSuper\(/);
});

// ---- 6. Visible features ----

test('every channel a feature gates exists, is registered and has a preload entry; shared reads stay open', () => {
  const channelValues = new Set([...IPC.matchAll(/^\s+([A-Z0-9_]+): '([^']+)',?/gm)].map((m) => m[2]));
  const keyOf = new Map([...IPC.matchAll(/^\s+([A-Z0-9_]+): '([^']+)',?/gm)].map((m) => [m[2], m[1]]));
  for (const [feature, channels] of Object.entries(featureGate.FEATURE_CHANNELS)) {
    assert.ok(permissions.FEATURE_KEYS.includes(feature), feature);
    for (const ch of channels) {
      assert.ok(channelValues.has(ch), `${feature}: ${ch} is a main channel`);
      assert.ok(PRELOAD.includes(`'${ch}'`), `${feature}: ${ch} is in the preload`);
      assert.match(IPC, new RegExp(`registerHandler\\(CHANNELS\\.${keyOf.get(ch)},`), `${ch} is registered`);
    }
  }
  assert.deepEqual(Object.keys(featureGate.FEATURE_CHANNELS).sort(), [...permissions.FEATURE_KEYS].sort());
  for (const open of ['profile:list', 'proxy:list', 'proxy:check', 'group:list', 'proxy-group:list', 'member:list', 'member:current',
    'dashboard:get-stats', 'settings:get-global', 'settings:set-global', 'extensions:list', 'tag:list', 'session:list']) {
    assert.equal(featureGate.featureForChannel(open), null, open);
  }
});

test('a hidden feature refuses its actions with a clear message; nothing changes for everyone else', () => {
  const op = { ...MEMBERS[2], ...hidden('proxies') };
  const err = featureGate.refusalFor('proxy:create', op);
  assert.equal(err.message, 'Proxies is turned off for your account by an administrator.');
  assert.equal(err.code, 'FEATURE_OFF');
  assert.equal(featureGate.refusalFor('proxy:list', op), null, 'the editor\'s proxy picker still loads');
  assert.equal(featureGate.refusalFor('profile:create', op), null, 'other features are unaffected');
  assert.equal(featureGate.refusalFor('proxy:create', MEMBERS[2]), null, 'features are on by default');
  assert.equal(featureGate.refusalFor('proxy:create', null), null, 'single-user mode');
  assert.equal(featureGate.refusalFor('proxy:create', { ...permissions.SUPER_ADMIN }), null, 'the Super Admin');
  assert.match(featureGate.refusalFor('profile:restore', { ...MEMBERS[1], ...hidden('trash') }).message, /^Trash is turned off/);
  assert.match(featureGate.refusalFor('batch:commit-profile-import', { ...MEMBERS[4], ...hidden('batchImport') }).message, /^Batch import is turned off/);
  assert.match(featureGate.refusalFor('browser:download', { ...MEMBERS[4], ...hidden('browsers') }).message, /^Browsers is turned off/);
  // A parent can only hide what they can see, so the stored flag is read through effectivePermissions.
  assert.equal(featureGate.featureHidden({ ...MEMBERS[2], permissionsJson: '{bad json' }, 'proxies'), false);
});

test('registerHandler checks the feature after sign-in and before the handler; AI and API tokens follow the same rule', () => {
  const body = extractFunction(IPC, 'registerHandler');
  const auth = body.indexOf('authGate.decide(channel, await ipcAuthState())');
  const feature = body.indexOf('featureGate.refusalFor(channel, await getActiveMember())');
  assert.ok(auth > 0 && feature > auth && feature < body.indexOf('await handler(payload, event)'));
  assert.match(body, /if \(off\) return \{ ok: false, error: \{ message: off\.message, code: off\.code \} \};/);
  // SoftGlaze AI: the registry asks assertFeature for tools tied to a page.
  const REG = read('src', 'main', 'ai', 'toolRegistry.js');
  assert.match(REG, /'getPrisma', 'requirePermission', 'assertFeature',/);
  assert.match(REG, /const feature = typeof tool\.feature === 'function' \? tool\.feature\(args\) : tool\.feature;\s*if \(feature && typeof this\.deps\.assertFeature === 'function'\) \{/);
  assert.match(extractFunction(IPC, 'buildAiToolDeps'), /assertFeature: async \(feature\) => \{\s*if \(featureGate\.featureHidden\(await getActiveMember\(\), feature\)\) throw featureGate\.featureOffError\(feature\);/);
  const { TOOLS } = require('../src/main/ai/tools');
  // rotate_proxy_ip follows the window: by profile it is a Profiles action (profile:rotate-ip), by proxy id a
  // Proxies one (proxy:rotate-ip).
  const featureOf = Object.fromEntries(TOOLS.filter((t) => t.feature).map((t) => [t.name, typeof t.feature === 'function' ? t.feature({ proxyId: 1 }) : t.feature]));
  assert.deepEqual(featureOf, {
    create_profile: 'profiles', update_profile: 'profiles', batch_generate_profiles: 'profiles', start_profile: 'profiles', assign_proxy: 'profiles',
    rotate_proxy_ip: 'proxies', find_free_proxies: 'proxies', create_group: 'groups', move_profiles_to_group: 'groups'
  });
  assert.equal(TOOLS.find((t) => t.name === 'rotate_proxy_ip').feature({ profileId: 7 }), 'profiles');
});

test('an AI tool for a hidden feature is refused before it runs', async () => {
  const reg = require('../src/main/ai/toolRegistry');
  const { ApprovalManager } = require('../src/main/ai/approvals');
  const aiSettings = require('../src/main/ai/aiSettings');
  const memories = require('../src/main/ai/memories');
  const { createFakeApp } = require('./helpers/aiFakes');
  const app = createFakeApp();
  const store = new Map();
  const services = {
    settings: () => aiSettings.normalizeStored({ enabled: true }),
    isEnabled: () => true,
    approvals: new ApprovalManager({ timeoutMs: 2000, emit: () => {} }),
    audit: { record: async () => {} },
    memory: memories.createMemoryStore({ read: async (k, f) => (store.has(k) ? store.get(k) : f), write: async (k, v) => store.set(k, v) }),
    tracker: new reg.AiTracker(),
    jobs: new reg.JobStore({ inlineMs: 200 }),
    limiter: new reg.RateLimiter()
  };
  const off = new Set(['proxies']);
  const deps = { ...app.toolDeps, assertFeature: async (f) => { if (off.has(f)) throw featureGate.featureOffError(f); } };
  const registry = new reg.ToolRegistry({ deps, services, inlineWaitMs: 300 });
  const token = { id: 1, name: 'T', kind: 'ai', scope: 'operate', groupIds: [], preApproved: null, memberId: 1 };
  const r = await registry.call('find_free_proxies', { count: 1 }, { token, clientName: 'Test', transport: 'mcp' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'FORBIDDEN');
  assert.match(r.error, /Proxies is turned off for your account by an administrator\./);
  assert.equal(app.calls.filter((c) => c[0] === 'harvestFreeProxies').length, 0);
});

test('a hidden page is closed in the window too, and the Members dialog says what a feature switch does', () => {
  const APP = read('src', 'renderer', 'App.jsx');
  for (const [route, feature] of [['profiles', 'profiles'], ['groups', 'groups'], ['proxies', 'proxies'], ['free-proxies', 'proxies'], ['proxy-providers', 'proxies'],
    ['extensions', 'extensions'], ['browsers', 'browsers'], ['trash', 'trash'], ['batch-import', 'batchImport'], ['members', 'members'], ['settings', 'settings']]) {
    assert.match(APP, new RegExp(`<Route path="/${route}" element=\\{<FeatureRoute feature="${feature}">`), route);
  }
  assert.match(APP, /<Route path="\/dashboard" element=\{<FeatureRoute feature="dashboard" redirectTo="\/profiles">/);
  const ROUTE = read('src', 'renderer', 'components', 'FeatureRoute.jsx');
  assert.match(ROUTE, /if \(me === undefined\) return null;/, 'nothing mounts before the member is known');
  assert.match(ROUTE, /if \(featureVisible\(me, feature\)\) return children;/);
  assert.match(read('src', 'renderer', 'pages', 'MembersPage.jsx'), /\{t\('perms\.featuresHint'\)\}/);
  for (const lang of ['en', 'es']) {
    const members = JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, 'members.json'));
    assert.ok(members.perms.featuresHint, lang);
    assert.match(members.features.dashboard, /\(/, `${lang}: the Dashboard switch says it only hides the page`);
  }
});

// ---- 7. getProxyPolicy ----

test('the proxy policy read lists overrides only for profiles the member can see', async () => {
  const db = seed();
  const ws = workspace(db);
  const settings = new Map([['proxyPolicy', { default: 'sticky', byProfile: { 100: 'failover', 101: 'each-launch', 104: 'sticky', 106: 'latency-optimized', 9999: 'sticky' } }]]);
  const { getProxyPolicyForActor } = loadMain(['getProxyPolicy', 'getProxyPolicyForActor'], {
    ...ws.deps,
    PROXY_POLICY_MODES: new Set(['each-launch', 'sticky', 'failover', 'latency-optimized']),
    readSetting: async (k, d) => (settings.has(k) ? JSON.parse(JSON.stringify(settings.get(k))) : d)
  });
  const keys = async (who) => { ws.as(who); return Object.keys((await getProxyPolicyForActor()).byProfile).map(Number).sort((a, b) => a - b); };
  assert.deepEqual(await keys(3), [100, 104, 106], 'X: own profile and both shares');
  assert.deepEqual(await keys(4), [101], 'Y: own profile only');
  assert.deepEqual(await keys(2), [100, 101, 104, 106], 'the Admin: their subtree, and profiles shared with it');
  assert.deepEqual(await keys(1), [100, 101, 104, 106], 'the Owner: every profile that exists');
  assert.deepEqual(await keys(null), [100, 101, 104, 106, 9999], 'single-user mode: the stored map');
  ws.as(4);
  const y = await getProxyPolicyForActor();
  assert.equal(y.default, 'sticky', 'the workspace default is still shown');
  assert.match(IPC, /registerHandler\(CHANNELS\.SETTINGS_GET_PROXY_POLICY, getProxyPolicyForActor\);/);
  assert.match(extractFunction(IPC, 'setProxyPolicy'), /return getProxyPolicyForActor\(\);/);
  assert.match(extractFunction(IPC, 'resolveProxyPolicyMode'), /const cfg = await getProxyPolicy\(\);/, 'launch still reads the whole map');
});

// ---- Strings ----

test('every new string exists in both languages', () => {
  for (const lang of ['en', 'es']) {
    const loc = (ns) => JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, `${ns}.json`));
    for (const k of ['viewOnly', 'settingsViewOnly', 'startLinksViewOnly', 'featureOffTitle', 'featureOffBody']) assert.ok(loc('common').perm[k], `${lang} common.perm.${k}`);
    for (const k of ['cloneNoTwoFactor', 'cloneNoLogins', 'cloneUseOnlyHint']) assert.ok(loc('profiles').permNotes[k], `${lang} profiles.permNotes.${k}`);
    assert.ok(loc('providersPage').detail.pullDenied, `${lang} providersPage.detail.pullDenied`);
    assert.match(loc('common').perm.settingsViewOnly, /\{\{reason\}\}/);
  }
});
