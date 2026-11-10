'use strict';
// 1.0.26 profile editor fixes, found while preparing the tutorial videos:
//  - "Check network" showed "Connection Successful" for a dead proxy and filled in "US" / "120ms".
//  - "Rotating Proxy" saved the profile with no proxy at all (it launched on the real IP).
//  - Group was a hard-coded list and was sent as a name; main reads groupId only.
//  - Tags were sent as text; main stores an array only.
//  - The Cookie box was never saved or imported.
//  - Batch import saved profiles with no owner, so members could not see their own imports.
//  - The editor's checkboxes ignored clicks (no input), so "Load SoftGlaze extensions" could not be ticked.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const IPC = read('src', 'main', 'ipcHandlers.js');
const PAGE = read('src', 'renderer', 'pages', 'ProfilesPage.jsx');
const loadEditorLib = () => import(pathToFileURL(path.join(ROOT, 'src', 'renderer', 'lib', 'profileEditor.mjs')).href);
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
const VALIDATORS = ['requireObject', 'optionalString', 'requiredString', 'parseId'];

// ---- Tags ----

test('tags typed as text are saved as a clean array', async () => {
  const { parseTagInput, tagsToInput, TAG_MAX_LENGTH } = await loadEditorLib();
  assert.deepEqual(parseTagInput('vip, warm-up,, vip ,VIP,  new'), ['vip', 'warm-up', 'new']);
  assert.deepEqual(parseTagInput(''), []);
  assert.deepEqual(parseTagInput('   ,  ,'), []);
  assert.deepEqual(parseTagInput(undefined), []);
  assert.deepEqual(parseTagInput(['a', ' b ', 'A', '', null]), ['a', 'b']);
  assert.equal(parseTagInput('x'.repeat(60))[0].length, TAG_MAX_LENGTH, 'same 40-character cap as the bulk tag action');
  assert.equal(tagsToInput(['vip', 'warm-up']), 'vip, warm-up');
  assert.equal(tagsToInput(null), '');
  assert.equal(tagsToInput('a, b'), 'a, b');
});

test('the editor saves groupId and a tag array on create and edit, and prefills both', () => {
  const save = extractFunction(PAGE, 'handleSaveProfile');
  assert.match(save, /groupId: pd\.groupId \? Number\(pd\.groupId\) : null/);
  assert.match(save, /tags: parseTagInput\(pd\.tags\)/);
  assert.match(save, /softglazeApi\.profiles\.update\(\{ id: pd\.id, \.\.\.updatePayload \}\)/, 'edit sends the same payload');
  assert.match(save, /softglazeApi\.profiles\.create\(payload\)/);
  const edit = extractFunction(PAGE, 'openEdit');
  assert.match(edit, /groupId: profile\.groupId != null \? String\(profile\.groupId\) : ''/);
  assert.match(edit, /tags: tagsToInput\(profile\.tags\)/);
});

// ---- Group ----

test('the group list is the workspace groups, and "+ Add new group" creates one inline', () => {
  assert.doesNotMatch(PAGE, /Lead Gen/, 'no hard-coded sample group');
  assert.doesNotMatch(PAGE, /<option value="New">/);
  assert.match(PAGE, /\{groups\.map\(\(g\) => <option key=\{g\.id\} value=\{String\(g\.id\)\}>\{g\.name\}<\/option>\)\}/);
  assert.match(PAGE, /if \(e\.target\.value === '__new__'\) \{ setNewGroupOpen\(true\); return; \}/);
  const create = extractFunction(PAGE, 'handleCreateGroup');
  assert.match(create, /await softglazeApi\.groups\.create\(\{ name \}\)/);
  assert.match(create, /updatePd\('groupId', String\(g\.id\)\)/, 'the new group is selected');
  assert.doesNotMatch(create, /prompt\(/, 'no window.prompt (it returns null in Electron)');
});

test('createProfile stores a real group id and refuses one that does not exist', async () => {
  const created = [];
  const db = {
    group: { findUnique: async ({ where }) => (where.id === 3 ? { id: 3 } : null) },
    profile: { create: async ({ data }) => { created.push(data); return { id: 11, ...data }; } },
    proxy: { findUnique: async () => null }
  };
  const { createProfile } = loadMain([...VALIDATORS, 'createProfile'], {
    requirePermission: async () => {}, restoreMaskedSecrets: (x) => x, getPrisma: () => db,
    assertWithinLimit: async () => {}, findOrCreateProxy: async () => null, proxyTypeHintFor: () => null,
    ensureUniqueDataDirName: async (_db, n) => n, ownerStampId: () => 5, buildProxyInfoString: () => '',
    validateSystemProxyBehavior: (v) => v || 'DIRECT', buildFingerprintFields: () => ({}),
    logActivity: async () => {}, serializeProfile: (p) => p,
    assertCanAccessGroup: async () => {} // group visibility: test/permissionGaps.test.js
  });
  await createProfile({ title: 'A', groupId: 3, tags: ['vip', 'warm'] });
  assert.equal(created[0].groupId, 3);
  assert.equal(created[0].tags, '["vip","warm"]');
  assert.equal(created[0].ownerMemberId, 5);
  await createProfile({ title: 'B', groupId: null, tags: [] });
  assert.equal(created[1].groupId, null);
  assert.equal(created[1].tags, '[]');
  await assert.rejects(createProfile({ title: 'C', groupId: 99 }), /Selected group does not exist\./);
  assert.equal(created.length, 2, 'nothing is written for a missing group');
});

test('updateProfile saves the group and tags, and refuses a group that does not exist', async () => {
  const updates = [];
  const db = {
    group: { findUnique: async ({ where }) => (where.id === 3 ? { id: 3 } : null) },
    profile: {
      findUnique: async () => ({ id: 4, title: 'T', dataDirName: 'T', groupId: 2, proxy: null }),
      update: async ({ data }) => { updates.push(data); return { id: 4, ...data }; }
    }
  };
  const { updateProfile } = loadMain([...VALIDATORS, 'updateProfile'], {
    requirePermission: async () => {}, getPrisma: () => db, assertCanAccessProfile: async () => {},
    restoreMaskedSecrets: (x) => x, extractFingerprintData: () => ({}), validateSystemProxyBehavior: (v) => v,
    findOrCreateProxy: async () => null, proxyTypeHintFor: () => null, buildProxyInfoString: () => '',
    sanitizeDataDirName: (v) => v, logActivity: async () => {}, serializeProfile: (p) => p, console,
    assertCanAccessGroup: async () => {} // group visibility: test/permissionGaps.test.js
  });
  await updateProfile({ id: 4, groupId: 3, tags: ['a'] });
  assert.equal(updates[0].groupId, 3);
  assert.equal(updates[0].tags, '["a"]');
  await updateProfile({ id: 4, groupId: '' });
  assert.equal(updates[1].groupId, null, 'Ungrouped clears it');
  await updateProfile({ id: 4, groupId: 2 });
  assert.equal(updates[2].groupId, 2, 'an unchanged group saves even if the row is gone');
  await assert.rejects(updateProfile({ id: 4, groupId: 99 }), /Selected group does not exist\./);
});

// ---- Check network ----

test('the check result only reads as working when main says success, with real values only', async () => {
  const { proxyCheckView } = await loadEditorLib();
  assert.equal(proxyCheckView(null), null);
  assert.deepEqual(proxyCheckView({ success: false, error: 'Proxy connection timed out.', latencyMs: 15000 }), { ok: false, error: 'Proxy connection timed out.' });
  assert.deepEqual(proxyCheckView({ success: false }), { ok: false, error: null });
  assert.deepEqual(proxyCheckView({}), { ok: false, error: null }, 'anything but success === true is a failure');
  assert.deepEqual(proxyCheckView({ success: true, ip: '203.0.113.7', country: 'DE', city: 'Berlin', latencyMs: 812.4 }),
    { ok: true, ip: '203.0.113.7', country: 'DE', city: 'Berlin', latencyMs: 812 });
  // Missing values stay null: no "US", no "120ms", no proxy host passed off as the exit IP.
  assert.deepEqual(proxyCheckView({ success: true }), { ok: true, ip: null, country: null, city: null, latencyMs: null });
  assert.deepEqual(proxyCheckView({ success: true, ip: '', country: '  ', latencyMs: null }), { ok: true, ip: null, country: null, city: null, latencyMs: null });
});

test('the editor renders the check through proxyCheckView and checks saved proxies by id', () => {
  assert.doesNotMatch(PAGE, /\|\| 'US'/);
  assert.doesNotMatch(PAGE, /\|\| '120'/);
  assert.doesNotMatch(PAGE, /proxyResult\.ip \|\| pd\.proxyHost/);
  const box = extractFunction(PAGE, 'ProxyCheckResult');
  assert.match(box, /const view = proxyCheckView\(result\);/);
  assert.match(box, /if \(!view\.ok\) \{/);
  assert.match(box, /t\('proxy\.connectionFailed'\)/);
  assert.equal((PAGE.match(/<ProxyCheckResult result=\{proxyResult\} \/>/g) || []).length, 2, 'Custom and Saved Proxies both show it');
  const check = extractFunction(PAGE, 'handleCheckProxy');
  assert.match(check, /request = \{ id: Number\(pd\.selectedSavedProxy\) \};/);
  assert.match(check, /setProxyResult\(\{ success: false, error: err\.message \|\| t\('errors\.proxyCheckFailed'\) \}\)/);
});

function loadCheckProxy(result) {
  const seen = [];
  const persisted = [];
  const db = { proxy: { findUnique: async ({ where }) => ({ id: where.id, type: 'SOCKS5', host: 's.example', port: 1080, username: 'u', password: 'p', createdAt: new Date(0) }) } };
  const fns = loadMain([...VALIDATORS, 'parseProxyType', 'proxyTypeHintFor', 'checkProxy'], {
    VALID_PROXY_TYPES: new Set(['HTTP', 'SOCKS5', 'SOCKS4']),
    getPrisma: () => db,
    assertCanAccessProxy: async () => {},
    parseProxyInput: (raw) => {
      if (typeof raw === 'object') return { ...raw, port: Number(raw.port) };
      const m = /^(socks5|socks4|http):\/\//i.exec(raw);
      return { type: m ? m[1].toUpperCase() : 'HTTP', host: 'h.example', port: 8080 };
    },
    testProxyConnectivity: async (proxy) => { seen.push({ ...proxy }); return result; },
    persistProxyHealth: async (_db, id, r) => { persisted.push([id, r]); }
  });
  return { checkProxy: fns.checkProxy, seen, persisted };
}

test('checkProxy tests the proxy the save would store, and hands a dead result back as is', async () => {
  const dead = { success: false, error: 'Proxy connection timed out.' };
  const { checkProxy, seen, persisted } = loadCheckProxy(dead);
  assert.equal(await checkProxy({ raw: 'h.example:8080', type: 'Local' }), dead, '"Local" is not a protocol: no throw');
  assert.equal(seen[0].type, 'HTTP');
  await checkProxy({ raw: 'h.example:1080', type: 'SOCKS5' });
  assert.equal(seen[1].type, 'SOCKS5');
  await checkProxy({ raw: 'socks5://h.example:1080', type: 'HTTP' });
  assert.equal(seen[2].type, 'SOCKS5', 'a scheme in the string wins, as on save');
  await checkProxy({ id: 7 });
  assert.equal(seen[3].host, 's.example', 'a saved proxy is checked by id');
  assert.deepEqual(persisted.map(([id]) => id), [7], 'and its health is recorded');
});

// ---- Rotating Proxy ----

test('the rotation pool keeps the list order and drops proxies that are gone', async () => {
  const { rotationPoolIds } = await loadEditorLib();
  const proxies = [{ id: 4 }, { id: 9 }, { id: 2 }];
  assert.deepEqual(rotationPoolIds(proxies, ['2', '4']), [4, 2]);
  assert.deepEqual(rotationPoolIds(proxies, [9, 77]), [9]);
  assert.deepEqual(rotationPoolIds(proxies, []), []);
  assert.deepEqual(rotationPoolIds(undefined, ['1']), []);
});

test('"Rotating Proxy" saves a proxy and the rotation pool, never a DIRECT profile', () => {
  const save = extractFunction(PAGE, 'handleSaveProfile');
  assert.match(save, /if \(rotating && rotationIds\.length === 0\) \{ setActiveTab\('Proxy'\); return setError\(t\('errors\.rotationEmpty'\)\); \}/, 'an empty pool cannot be saved');
  assert.match(save, /: \(rotating \? rotationIds\[0\] : null\);/, 'the first pool proxy is the profile\'s own proxy');
  assert.match(save, /systemProxyBehavior: usingProxy \? 'PROFILE_PROXY' : 'DIRECT'/);
  assert.match(save, /\{ id: profileId, enabled: true, mode: pd\.rotationMode, proxyIds: rotationIds \}/);
  assert.match(save, /\{ id: profileId, enabled: false, mode: pd\.rotationMode, proxyIds: \[\] \}/, 'leaving Rotating turns the old pool off');
  const edit = extractFunction(PAGE, 'openEdit');
  assert.match(edit, /softglazeApi\.proxies\.getRotation\(editId\)/, 'a rotating profile opens on Rotating Proxy');
  assert.match(edit, /proxySetting: 'Rotating Proxy'/);
  // The launch path this feeds: an enabled pool overrides the profile's proxy for Chromium and Firefox.
  assert.match(IPC, /const ffRotated = await pickRotationProxy\(db, id\);/);
  // (1.0.26: a profile left without its own proxy is refused in between; test/permissionsFollowup.test.js.)
  assert.match(IPC, /const rotated = await pickRotationProxy\(db, id\);\s*assertProfileHasLaunchProxy\(profile, rotated\);\s*const launchProxy = rotated \|\| \(useProfileProxy \? profile\.proxy : null\);/);
});

// ---- Cookie box ----

function loadMainCookieParsers() {
  return loadMain(['cookieExpirySeconds', 'netscapeToCookies', 'parseJsonCookies', 'toSetCookieParam'], {});
}

test('the Cookie box accepts what the importer reads and refuses what it would drop', async () => {
  const { checkEditorCookies } = await loadEditorLib();
  const main = loadMainCookieParsers();
  const usable = (format, text) => (format === 'netscape' ? main.netscapeToCookies(text) : main.parseJsonCookies(text))
    .map(main.toSetCookieParam).filter(Boolean).length;

  const json = JSON.stringify([{ name: 'sid', value: 'a', domain: '.example.com' }, { name: 'x', value: 'b', url: 'https://example.org' }, { name: 'nodomain', value: 'c' }]);
  const wrapped = JSON.stringify({ cookies: [{ name: 'sid', value: 'a', domain: 'example.com', path: '/', secure: true }] });
  const netscape = '# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tTRUE\t1767225600\tsid\tabc123\n#HttpOnly_.example.com\tTRUE\t/\tTRUE\t0\tauth\tz';
  for (const [text, format, count] of [[json, 'json', 2], [wrapped, 'json', 1], [netscape, 'netscape', 2]]) {
    const res = checkEditorCookies(text);
    assert.equal(res.format, format, text);
    assert.equal(res.count, count, text);
    assert.equal(res.count, usable(format, text), 'the same cookies main imports');
  }

  assert.deepEqual(checkEditorCookies('  '), { empty: true });
  assert.deepEqual(checkEditorCookies('[{"name": "sid", '), { error: 'jsonInvalid' });
  assert.deepEqual(checkEditorCookies('{"name": "sid"}'), { error: 'jsonShape' });
  assert.deepEqual(checkEditorCookies('[{"name": "sid", "value": "a"}]'), { error: 'noDomain' });
  assert.equal(usable('json', '[{"name": "sid", "value": "a"}]'), 0, 'main would drop it too');
  assert.deepEqual(checkEditorCookies('sid=abc123; theme=dark'), { error: 'nameValue' });
  assert.deepEqual(checkEditorCookies('sid=abc123\ntheme=dark'), { error: 'nameValue' });
  assert.deepEqual(checkEditorCookies('just some text'), { error: 'unrecognised' });
});

test('saving imports changed cookies into the profile and reports a failed import', () => {
  const save = extractFunction(PAGE, 'handleSaveProfile');
  assert.match(save, /checkEditorCookies\(cookieText\)/);
  assert.match(save, /if \(cookieCheck\.error\) \{ setActiveTab\('General'\); return setError\(t\(`cookieErrors\.\$\{cookieCheck\.error\}`\)\); \}/, 'bad cookies stop the save before anything is written');
  assert.match(save, /await softglazeApi\.profiles\.importCookies\(profileId, cookieText, cookieCheck\.format\);/);
  assert.match(save, /followUp\.push\(t\('errors\.cookiesNotImported'/);
  assert.match(save, /const \{ cookie, group, rotationMode, rotationProxyIds, \.\.\.fields \} = pd;/, 'raw cookies are not sent with the profile');
  assert.match(extractFunction(PAGE, 'handleLoadCookies'), /setCookieBaseline\(res\.content \|\| ''\)/, 'loaded cookies are not imported again');
});

test('importProfileCookies refuses Firefox profiles instead of reporting a silent no-op', async () => {
  const { BROWSER_CORE, normalizeBrowserCore } = require('../src/main/importParser');
  const writes = [];
  let core = 'Firefox';
  const parsers = ['cookieExpirySeconds', 'netscapeToCookies', 'parseJsonCookies', 'toSetCookieParam', 'cookieHealth'];
  const { importProfileCookies } = loadMain([...VALIDATORS, ...parsers, 'importProfileCookies'], {
    assertCanAccessProfile: async () => {},
    getPrisma: () => ({ profile: { findUnique: async () => ({ browserCore: core }) } }),
    BROWSER_CORE, normalizeBrowserCore,
    importSessionCookies: async () => null,
    offlineProfileOpts: async () => ({ userDataDir: 'x' }),
    importStoredCookies: async (_opts, params) => { writes.push(params); return { imported: params.length }; }
  });
  const data = JSON.stringify([{ name: 'sid', value: 'a', domain: '.example.com' }]);
  await assert.rejects(importProfileCookies({ id: 3, data, format: 'json' }), /Chromium profiles only/);
  assert.equal(writes.length, 0);
  core = 'Chromium';
  const res = await importProfileCookies({ id: 3, data, format: 'json' });
  assert.equal(res.imported, 1);
  assert.equal(writes.length, 1);
});

// ---- Batch import owner ----

test('batch import stamps the importing member as owner and assignee', async () => {
  const created = [];
  const cache = new Map([['tok', {
    parsed: {
      fileName: 'p.xlsx', sheetName: 'S', headerRow: 1, totalRows: 2, errors: [],
      items: [{ row: 2, title: 'One', group: 'Lead Gen' }, { row: 3, title: 'Two' }]
    }
  }]]);
  const db = {
    proxy: { findMany: async () => [] },
    group: { findFirst: async () => null, create: async ({ data }) => ({ id: 8, ...data }) },
    profile: { create: async ({ data }) => { created.push(data); return { id: created.length, ...data }; } }
  };
  const { commitProfileImport } = loadMain([...VALIDATORS, 'commitProfileImport'], {
    importPreviewCache: cache, getPrisma: () => db, CHANNELS: { BATCH_IMPORT_PROGRESS: 'p' },
    proxyScope: { autoBindPoolWhere: () => ({}) }, toCountryCode: () => '', countryMatches: () => false,
    readSetting: async () => ({}), writeSetting: async () => {}, findOrCreateProxy: async () => null,
    serializeProxy: (p) => p, parseSystemProxyBehavior: (_v, d) => d, doNotTrackChoice: (v) => v,
    ensureUniqueDataDirName: async (_db, n) => n, generateFingerprint: () => ({}), buildProxyInfoString: () => '',
    serializeProfile: (p) => p, logActivity: async () => {}, ownerStampId: () => 5,
    // Permission, quota and scoping: test/permissionGaps.test.js
    requirePermission: async () => {}, assertWithinLimit: async () => {}, scopedProxyWhere: async (w) => w, scopedGroupWhere: async (w) => w,
    proxyAddContext: async () => ({ visible: undefined, ownerId: 5, max: -1 }) // proxy reuse: test/permissionsFollowup.test.js
  });
  const res = await commitProfileImport({ token: 'tok' }, null);
  assert.equal(res.createdProfiles.length, 2);
  for (const data of created) {
    assert.equal(data.ownerMemberId, 5);
    assert.equal(data.assignedMemberId, 5);
  }
  assert.equal(created[0].groupId, 8);
});

test('the Profiles list scope would hide an unowned import from a member', () => {
  // scopedProfileWhere: a member sees rows owned by, assigned to or shared with a visible member.
  const scoped = extractFunction(IPC, 'scopedProfileWhere');
  assert.match(scoped, /\{ assignedMemberId: \{ in: visible \} \}/);
  assert.match(scoped, /\{ ownerMemberId: \{ in: visible \} \}/);
  assert.match(extractFunction(IPC, 'commitProfileImport'), /ownerMemberId: stampId,\s*assignedMemberId: stampId,/);
});

// ---- Checkbox, banner and wording ----

test('editor checkboxes are real inputs, so "Load SoftGlaze extensions" can be ticked', () => {
  const m = /const CustomCheckbox = \(\{ checked, onChange, label \}\) => \(([\s\S]*?)\n\);/.exec(PAGE);
  assert.ok(m, 'CustomCheckbox exists');
  assert.match(m[1], /<input type="checkbox"[^>]*checked=\{Boolean\(checked\)\}[^>]*onChange=\{\(e\) => onChange && onChange\(e\.target\.checked\)\}/);
  assert.match(PAGE, /<CustomCheckbox label=\{t\('advanced\.loadExtensions'/);
});

test('the authenticator banner is gone (there is no account 2FA to bind)', () => {
  assert.doesNotMatch(PAGE, /authBanner/);
  for (const lang of ['en', 'es']) assert.equal(locale(lang, 'profiles').editor.authBanner, undefined, lang);
});

test('the Extensions page says extensions load only where the Advanced tab box is ticked', () => {
  const en = locale('en', 'extensions');
  const all = JSON.stringify(en);
  assert.doesNotMatch(all, /injected into every profile|inject it into every profile|Injected Globally/i);
  assert.match(en.caveat.before, /Load SoftGlaze extensions \(uses Chrome-for-Testing\)/, 'names the real checkbox label');
  assert.match(en.caveat.before, /Advanced tab/);
  assert.match(en.caveat.after, /Chrome for Testing/);
  assert.match(en.caveat.after, /Firefox profiles do not load them/);
  assert.equal(locale('en', 'profiles').advanced.loadExtensions, 'Load SoftGlaze extensions (uses Chrome-for-Testing)');
  const es = JSON.stringify(locale('es', 'extensions'));
  assert.doesNotMatch(es, /inyectadas en cada perfil|inyectarla en cada perfil|Inyectadas globalmente/i);
});

test('the SoftGlaze AI subtitle no longer claims every change asks first', () => {
  const en = locale('en', 'ai').description;
  assert.doesNotMatch(en, /Every change asks you first/);
  assert.match(en, /You choose how often changes need your approval/);
  assert.doesNotMatch(locale('es', 'ai').description, /Cada cambio te pide permiso primero/);
  // What the wording rests on: changes can never skip approval; reads can.
  const settings = read('src', 'main', 'ai', 'aiSettings.js');
  assert.match(settings, /operate: \['ask-hour', 'ask-always'\]/);
  assert.match(settings, /full: \['ask-hour', 'ask-always'\]/);
});

test('every new editor string exists in English and Spanish', () => {
  const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
  for (const ns of ['profiles', 'extensions', 'ai']) {
    const en = flat(locale('en', ns)).sort();
    const es = flat(locale('es', ns)).sort();
    assert.deepEqual(en, es, `${ns}: en and es keys match`);
  }
  const p = locale('en', 'profiles');
  for (const key of ['connectionFailed', 'connectionFailedNoReason', 'unknown', 'latencyMs', 'rotationPool', 'rotationHelp', 'rotationSelected_one', 'rotationSelected_other', 'settingRotating']) {
    assert.ok(p.proxy[key], `proxy.${key}`);
  }
  for (const key of ['pickSavedProxy', 'rotationEmpty', 'rotationNotSaved', 'rotationNotCleared', 'cookiesNotImported', 'groupCreate']) {
    assert.ok(p.errors[key], `errors.${key}`);
  }
  for (const key of ['jsonInvalid', 'jsonShape', 'noDomain', 'nameValue', 'unrecognised', 'firefox']) {
    assert.ok(p.cookieErrors[key], `cookieErrors.${key}`);
  }
  for (const key of ['tags', 'tagsHint', 'newGroupName', 'newGroupPlaceholder', 'createGroup', 'cookieHint']) {
    assert.ok(p.general[key], `general.${key}`);
  }
  assert.doesNotMatch(p.general.cookiePlaceholder, /Name=Value/, 'the placeholder no longer offers a format that cannot be imported');
});
