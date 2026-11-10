'use strict';
// 1.0.26 round 8, Spanish, Store languages and small texts:
//  16. One Spanish name for the Manager role, "Gerente" (the Store listing's), everywhere.
//  17. English left in the Spanish window: the editor's choice values and summary, the permission
//      list, the Browsers page's fingerprint engine card, each AI client's "where" line, the footer.
//  18. One Spanish term each for Settings, Batch import and the proxy pool.
//  15. The Store package declares Spanish.
//   8. The delete-proxy confirmations said profiles "keep working"; since 1.0.26 they wait for a proxy.
//   6. The backup message showed the database's size, not the saved file's.
//   7. Check network on a proxy that does not answer took about 30 s to fail.
//  10. The sidebar's "Dark mode" switch was off while the dark theme was on.
//  14. SoftGlaze AI: canRotate for DataImpulse sticky proxies, Firefox WebRTC in the profile view,
//      rotate_proxy_ip by profile ("use only" shares), the legacy rotation-link pass after a restore.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const permissions = require('../src/main/permissions');
const { createFakePrisma } = require('./helpers/fakePrisma');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const IPC = read('src', 'main', 'ipcHandlers.js');
const importLib = (name) => import(pathToFileURL(path.join(ROOT, 'src', 'renderer', 'lib', name)).href);
const loc = (lang, ns) => JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, `${ns}.json`));
const LOCALES = fs.readdirSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', 'es')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
const flat = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${pre}${k}.`) : [[`${pre}${k}`, v]]));
const keys = (o) => flat(o).map(([k]) => k).sort();

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

test('every locale namespace has the same keys in English and Spanish', () => {
  for (const ns of LOCALES) assert.deepEqual(keys(loc('es', ns)), keys(loc('en', ns)), ns);
});

// ---- 16. Gerente ----

test('16: the Manager role is "Gerente" everywhere in Spanish', () => {
  assert.equal(loc('es', 'common').roles.MANAGER, 'Gerente');
  assert.equal(loc('es', 'members').roles.MANAGER, 'Gerente');
  assert.equal(loc('es', 'ai').roles.MANAGER, 'Gerente', 'the AI token dialog said "Gestor"');
  assert.equal(loc('es', 'cmpModalsC').shareProfile.roleManager, 'Gerente');
  assert.equal(loc('es', 'members').caps.maxManagers, 'Gerentes');
  assert.equal(loc('es', 'members').perms.canInvite.canCreateManagers, 'Puede invitar gerentes');
  for (const ns of LOCALES) {
    for (const [k, v] of flat(loc('es', ns))) {
      assert.doesNotMatch(String(v), /\bresponsables?\b/i, `${ns}:${k}`);
      assert.doesNotMatch(String(v).replace(/Gestor de cookies/g, ''), /\bgestor(es)?\b/i, `${ns}:${k}`);
    }
  }
});

// ---- 18. One term each ----

test('18: Settings is "Configuración", Batch import "Importación masiva", the proxy pool "Grupo de proxies"', () => {
  const es = Object.fromEntries(LOCALES.map((ns) => [ns, loc('es', ns)]));
  for (const ns of LOCALES) {
    for (const [k, v] of flat(es[ns])) {
      // "{{count}} ajuste(s)" is a count of saved settings in the backup message, not the page's name.
      if (!/workspaceBackup\.msgSaved_/.test(k)) assert.doesNotMatch(String(v), /\bajustes\b/i, `${ns}:${k}`);
      assert.doesNotMatch(String(v), /importación por lotes|conjunto de proxies/i, `${ns}:${k}`);
    }
  }
  assert.equal(es.common.nav.settings, 'Configuración');
  assert.equal(es.members.features.settings, 'Configuración');
  assert.equal(es.ai.tabs.settings, 'Configuración');
  for (const v of [es.common.nav.batchImport, es.cmpOverlays.palette.nav.batchImport, es.members.features.batchImport]) assert.equal(v, 'Importación masiva');
  for (const v of [es.common.nav.proxies, es.cmpOverlays.palette.nav.proxies, es.members.features.proxies, es.proxies.header.title, es.common.dashboard.statProxyPool]) assert.equal(v, 'Grupo de proxies');
  // A group inside the pool is a "grupo", so it never reads like the pool itself.
  assert.equal(es.proxies.groupModal.titleNew, 'Nuevo grupo');
  assert.equal(es.proxies.groupModal.titleEdit, 'Editar grupo');
  assert.equal(es.profiles.reassignModal.sources.group, 'Solo un grupo');
});

// ---- 17. English in the Spanish window ----

test('17: the editor\'s choice values and summary are labelled; English stays exactly as before', async () => {
  const { OPTION_LABEL_KEYS, optionLabel, osVersionLabel } = await importLib('profileOptionLabels.mjs');
  const page = read('src', 'renderer', 'pages', 'ProfilesPage.jsx');
  const used = new Set();
  for (const m of page.matchAll(/<ButtonTabs\b[^\n]*?options=\{\[([^\]]*)\]\}([^\n]*)/g)) {
    if (/labels=/.test(m[2])) continue; // its own labels
    for (const o of m[1].matchAll(/'([^']+)'/g)) used.add(o[1]);
  }
  assert.ok(used.has('Forward') && used.has('Based on IP') && used.has('Based on Language'));
  const en = loc('en', 'profiles');
  const es = loc('es', 'profiles');
  const get = (o, k) => k.split('.').reduce((a, p) => (a == null ? a : a[p]), o);
  for (const v of used) {
    const key = OPTION_LABEL_KEYS[v];
    assert.ok(key, `no label for "${v}"`);
    assert.equal(get(en, key), v, `English "${v}" unchanged`);
    assert.ok(get(es, key), `Spanish for "${v}"`);
  }
  const tEs = (k, o) => (get(es, k) || (o && o.defaultValue)).replace(/\{\{(\w+)\}\}/g, (_, n) => o[n]);
  assert.equal(optionLabel(tEs, 'Forward'), 'Reenviar');
  assert.equal(optionLabel(tEs, 'Based on IP'), 'Según la IP');
  assert.equal(optionLabel(tEs, 'Europe/Madrid'), 'Europe/Madrid', 'a typed value passes through');
  assert.equal(osVersionLabel(tEs, 'Windows', 'All Windows'), 'Todas');
  assert.equal(osVersionLabel(tEs, 'Windows', '11'), '11');
  assert.match(es.fp.webrtcHelpReplace, /^Como Reenviar,/);
  // The buttons and the summary use them.
  assert.match(page, /\{labels && labels\[opt\] \? labels\[opt\] : optionLabel\(t, opt\)\}/);
  for (const re of [/v=\{pd\.timezoneType === 'Custom' \? pd\.timezoneCustom : optionLabel\(t, pd\.timezoneType\)\}/, /v=\{optionLabel\(t, pd\.doNotTrack\)\}/,
    /v=\{optionLabel\(t, pd\.portScanProtection\)\}/, /optionLabel\(t, webrtcModeOf\(pd\.webrtc\)\)/, /t\('env\.osAllVersions', \{ os: pd\.os \}\)/]) assert.match(page, re);
  assert.equal(es.env.osAllVersions, '{{os}} (todas las versiones)');
});

test('17: the permission list is translated by action key; English is the catalog\'s own label', () => {
  const en = loc('en', 'members');
  const es = loc('es', 'members');
  for (const a of permissions.ACTION_CATALOG) {
    const k = a.key.replace('.', '_');
    assert.equal(en.actionLabels[k], a.label, a.key);
    assert.ok(es.actionLabels[k] && es.actionLabels[k] !== a.label, a.key);
    assert.ok(es.actionCategories[a.category], a.category);
  }
  assert.equal(es.actionLabels.settings_manage, 'Cambiar la configuración del espacio de trabajo');
  assert.equal(es.actionLabels.proxies_reveal, 'Ver las credenciales de proxy sin ocultar');
  const page = read('src', 'renderer', 'pages', 'MembersPage.jsx');
  assert.match(page, /t\(`actionLabels\.\$\{a\.key\.replace\('\.', '_'\)\}`, \{ defaultValue: a\.label \}\)/);
  assert.match(page, /t\(`actionCategories\.\$\{cat\.name\}`, \{ defaultValue: cat\.name \}\)/);
});

test('17: the Browsers page\'s fingerprint engine card has no English literals', () => {
  const page = read('src', 'renderer', 'pages', 'BrowsersPage.jsx');
  for (const s of ['>Fingerprint engine<', '/> Installed<', '>Not installed<', 'Download (~180 MB)', 'Turn it on in Settings', "? 'Installing' :"]) assert.ok(!page.includes(s), s);
  for (const k of ['heading', 'installed', 'notInstalled', 'description', 'download', 'installing', 'verifying', 'downloading', 'progressInstalling', 'progressVerifying']) {
    assert.ok(loc('en', 'browsers').engine[k] && loc('es', 'browsers').engine[k], k);
  }
  assert.match(loc('es', 'browsers').engine.description, /Configuración → Navegador/);
});

test('17: every AI client\'s "where" line has an English template equal to main\'s text, and a Spanish one', () => {
  const { buildSnippets } = require('../src/main/ai/snippets');
  const en = loc('en', 'ai').connect.clients;
  const es = loc('es', 'ai').connect.clients;
  for (const s of buildSnippets({ port: 18765, bridge: null })) {
    const key = s.client === 'generic' ? 'other' : s.client;
    const fill = (tpl) => tpl.replace(/\{\{(\w+)\}\}/g, (_, n) => (s.whereVars || {})[n]);
    assert.equal(fill(en[key].where), s.where, key);
    assert.ok(es[key].where && es[key].where !== en[key].where || key === 'cline', key);
    assert.doesNotMatch(fill(es[key].where), /\{\{/, key);
  }
  assert.match(es.cursor.where, /todos los proyectos/);
  const tab = read('src', 'renderer', 'components', 'ai', 'AiConnectTab.jsx');
  assert.match(tab, /t\(`\$\{base\}\.where`, \{ \.\.\.\(entry\.whereVars \|\| \{\}\), defaultValue: entry\.where \}\)/);
  assert.match(read('src', 'renderer', 'lib', 'aiCore.mjs'), /whereVars: s\.whereVars && typeof s\.whereVars === 'object' \? s\.whereVars : \{\}/);
});

test('17: the default footer is shown in the window\'s language; a custom one as written', async () => {
  const lib = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'lib', 'footerText.jsx'), 'utf8');
  const def = (lib.match(/export const DEFAULT_FOOTER_TEXT = '([^']+)';/) || [])[1];
  assert.ok(def);
  assert.ok(IPC.includes(`footerText: '${def}'`), 'the same default main seeds');
  assert.equal(loc('en', 'common').shell.footerDefault, def);
  assert.match(loc('es', 'common').shell.footerDefault, /^© \{year\} SoftGlaze - Creado por el \[equipo de SoftGlaze\]\(https:\/\/softglaze\.com\) · Desarrollado por \[Azhar Ali\]\(https:\/\/azhar\.softglaze\.com\)$/);
  assert.match(lib, /return text === DEFAULT_FOOTER_TEXT \? t\('shell\.footerDefault', \{ defaultValue: text \}\) : text;/);
  assert.match(read('src', 'renderer', 'components', 'AppShell.jsx'), /\{renderFooterNodes\(footerTextFor\(text, t\)\)\}/);
});

// ---- 10. Dark mode switch ----

test('10: the sidebar says "Dark mode" and its switch is on while the dark theme is on', () => {
  const toggle = extractFunction(read('src', 'renderer', 'components', 'AppShell.jsx'), 'ThemeToggle');
  assert.match(toggle, /role="switch"\s*aria-checked=\{isDark\}/);
  assert.match(toggle, /\{t\('shell\.darkMode'\)\}/);
  assert.doesNotMatch(toggle, /t\('shell\.lightMode'\)/);
  assert.match(toggle, /background: isDark \? 'var\(--primary\)' : 'var\(--switch-background\)'/);
  assert.match(toggle, /\$\{isDark \? 'translate-x-4' : ''\}/);
});

// ---- 8. Delete-proxy confirmations ----

test('8: deleting proxies says their profiles will not launch until they get another proxy', () => {
  for (const lang of ['en', 'es']) {
    const p = loc(lang, 'proxies');
    for (const s of [p.bulkDelete.confirm_one, p.bulkDelete.confirm_other, p.deleteFiltered.confirm_one, p.deleteFiltered.confirm_other]) {
      assert.doesNotMatch(s, /keep working|seguir[aá]n funcionando|siguen funcionando/i);
      assert.match(s, lang === 'en' ? /will not launch until you assign/ : /no se abrirán hasta que les asignes/);
    }
  }
  // What main does (detachProfilesFromProxies): the profile keeps "Profile proxy" with no proxy, so launch refuses it.
  assert.match(extractFunction(IPC, 'detachProfilesFromProxies'), /data: \{ proxyId: null, proxyInfoString: null \}/);
});

// ---- 6. Backup size ----

test('6: the backup message shows the saved file\'s size, as Explorer does', async () => {
  const { backupKb } = await importLib('backupSize.mjs');
  assert.equal(backupKb({ fileBytes: 423_590, dbBytes: 315_392 }), '414', 'the file (414 KB), not the database inside (308)');
  assert.equal(backupKb({ dbBytes: 315_392 }), '308', 'an older main without fileBytes');
  assert.equal(backupKb({}), '?');
  assert.match(extractFunction(IPC, 'workspaceBackup'), /fileBytes = \(await fs\.stat\(save\.filePath\)\)\.size;/);
  assert.match(read('src', 'renderer', 'components', 'WorkspaceBackupSettings.jsx'), /kb: backupKb\(r\)/);
});

// ---- 7. Check network on a dead proxy ----

function loadConnectivity() {
  return loadMain(['probeProxyTcp', 'proxyUnreachableMessage', 'testProxyConnectivity', 'httpGetJson', 'describeGatewayError', 'scrubProxySecrets', 'proxyAgentScheme', 'proxyUserinfo'], {
    require,
    GEOJS_URL: 'https://get.geojs.io/v1/ip/geo.json',
    normalizeGeoJs: () => null,
    formatProxyHost: (h) => (String(h).includes(':') ? `[${h}]` : String(h))
  }, ['PROXY_ERROR_BODY_LIMIT', 'PROXY_TCP_PROBE_MS']);
}

// A "proxy" that accepts connections and never answers. close() also ends the connections it holds,
// so nothing keeps the test process alive.
async function silentServer() {
  const conns = new Set();
  const server = net.createServer((c) => { conns.add(c); c.on('close', () => conns.delete(c)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, close: () => { for (const c of conns) c.destroy(); server.close(); } };
}

test('7: a proxy that does not answer fails within the probe time, without the two 15 s stages', async () => {
  const { testProxyConnectivity } = loadConnectivity();
  // A "proxy" that accepts and never answers, so the IP services would wait out their timeouts...
  const silent = await silentServer();
  try {
    const port = silent.port;
    const t0 = Date.now();
    // ...while the reachability probe (stood in here) has already found it dead.
    const r = await testProxyConnectivity({ type: 'HTTP', host: '127.0.0.1', port, username: 'u', password: 'p' },
      { timeoutMs: 1500, fallbackTimeoutMs: 1500, probe: () => new Promise((res) => setTimeout(() => res({ ok: false, code: 'ETIMEDOUT' }), 50)) });
    assert.equal(r.success, false);
    assert.equal(r.unreachable, true);
    assert.match(r.error, new RegExp(`did not answer at 127\\.0\\.0\\.1:${port} within 8 s`));
    assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
  } finally { silent.close(); }
});

test('7: the real probe: a closed port is refused at once; a reachable proxy still gets both stages', async () => {
  const { testProxyConnectivity, probeProxyTcp } = loadConnectivity();
  const closed = net.createServer(() => {});
  await new Promise((r) => closed.listen(0, '127.0.0.1', r));
  const deadPort = closed.address().port;
  await new Promise((r) => closed.close(r));
  assert.deepEqual(await probeProxyTcp('127.0.0.1', deadPort, 2000), { ok: false, code: 'ECONNREFUSED' });
  const r = await testProxyConnectivity({ type: 'HTTP', host: '127.0.0.1', port: deadPort }, { timeoutMs: 1500, fallbackTimeoutMs: 1500 });
  assert.equal(r.success, false);
  assert.match(r.error, /refused the connection|ECONNREFUSED/);

  const silent = await silentServer();
  try {
    assert.deepEqual(await probeProxyTcp('127.0.0.1', silent.port, 2000), { ok: true });
    const t0 = Date.now();
    const slow = await testProxyConnectivity({ type: 'HTTP', host: '127.0.0.1', port: silent.port }, { timeoutMs: 300, fallbackTimeoutMs: 300 });
    assert.equal(slow.success, false);
    assert.equal(slow.unreachable, undefined, 'reachable: the plain-HTTP fallback still runs');
    assert.ok(Date.now() - t0 >= 550, 'both stages ran');
  } finally { silent.close(); }
});

// ---- 14. SoftGlaze AI tools ----

const tools = require('../src/main/ai/tools');

test('14: compactProxy offers rotation for DataImpulse sticky proxies, by the same rule as main', () => {
  const { isDataImpulseSticky } = loadMain(['isDataImpulseSticky'], {});
  const rows = [
    { id: 1, provider: 'dataimpulse', host: 'gw.dataimpulse.com', port: 10001, username: 'plan__cr.us', password: 'p' },
    { id: 2, provider: 'dataimpulse', host: 'gw.dataimpulse.com', port: 823, username: 'plan', password: 'p' },
    { id: 3, provider: 'DataImpulse', host: 'eu.dataimpulse.com', port: 10500, username: 'plan', password: 'p' },
    { id: 4, provider: 'dataimpulse', host: 'gw.dataimpulse.com.evil.net', port: 10001, username: 'plan', password: 'p' },
    { id: 5, provider: 'other', host: 'gw.example', port: 10001, username: 'u', password: 'p', rotationUrl: 'https://rot.example/x' },
    { id: 6, provider: 'dataimpulse', host: 'gw.dataimpulse.com', port: 10001, username: 'plan', password: '' }
  ];
  for (const r of rows) {
    const view = tools.compactProxy(r);
    assert.equal(view.canRotate, Boolean(r.rotationUrl) || isDataImpulseSticky(r), `row ${r.id}`);
    assert.doesNotMatch(JSON.stringify(view), /plan__|"p"|rot\.example/);
  }
  assert.equal(tools.compactProxy(rows[0]).canRotate, true);
});

test('14: the AI profile view says WebRTC is off for Firefox profiles', () => {
  const view = (p) => tools.detailedProfile({ id: 1, title: 'x', ...p }, new Set()).location.webrtc;
  assert.equal(view({ browserCore: 'Chromium', webrtc: 'Real' }), 'Real');
  assert.match(view({ browserCore: 'Firefox', webrtc: 'Real' }), /^Off \(Firefox profiles always run with WebRTC off; saved setting Real applies on Chromium\)$/);
});

test('14: rotate_proxy_ip can rotate the proxy of a profile shared "use only", by profile id', async () => {
  const tool = tools.TOOLS.find((t) => t.name === 'rotate_proxy_ip');
  const z = require('zod');
  const schema = z.object(tool.input);
  assert.ok(schema.safeParse({ profileId: 104 }).success);
  assert.ok(schema.safeParse({ proxyId: 20 }).success);
  assert.deepEqual(tool.targets({ profileId: 104 }), { profileIds: [104] }, 'the registry checks access to the profile ("use only" is enough)');
  assert.deepEqual(tool.targets({ proxyId: 20 }), { profileIds: [] });
  const calls = [];
  const ctx = {
    db: { profile: { findUnique: async ({ where }) => (where.id === 104 ? { proxyId: 20, deletedAt: null } : null) } },
    userError: (m) => Object.assign(new Error(m), { code: 'USER' }),
    assertProxy: async () => { throw new Error('the Owner\'s proxy is not in this member\'s pool'); },
    deps: {
      rotateProfileProxyIp: async (p) => { calls.push(['profile', p]); return { ok: true, status: 200, latencyMs: 300 }; },
      rotateProxyIp: async (p) => { calls.push(['proxy', p]); return { ok: true, status: 200 }; }
    }
  };
  const out = await tool.handler({ profileId: 104 }, ctx);
  assert.deepEqual(calls, [['profile', { id: 104 }]]);
  assert.equal(out.data.proxyId, 20);
  assert.match(out.summary, /accepted the rotation for the proxy of profile #104/);
  await assert.rejects(tool.handler({ profileId: 104, proxyId: 21 }, ctx), /uses proxy #20, not #21/);
  await assert.rejects(tool.handler({}, ctx), /Give proxyId .* or profileId/);
  await assert.rejects(tool.handler({ proxyId: 20 }, ctx), /not in this member's pool/, 'by proxy id the pool rule stays');
  // Main's by-profile path is the window's Rotate IP on a profile row.
  assert.match(IPC, /rotateProfileProxyIp: \(payload\) => rotateProfileProxyIp\(\{ id: payload\.id \}\)/);
  assert.match(extractFunction(IPC, 'rotateProfileProxyIp'), /await requirePermission\('profiles\.launch'\);[\s\S]*await assertCanAccessProfile\(id\);[\s\S]*rotateProxyIp\(\{ id: profile\.proxy\.id, profileId: id \}\)/);
});

test('14: a workspace restore runs the pass for links imported before 1.0.26 on the restored database', async () => {
  // The restored database: profile 7's row made proxy 70 (same owner, a few seconds earlier), and its
  // imported link was never looked at.
  const t = (s) => new Date(`2026-10-01T10:00:${s}Z`);
  const restored = createFakePrisma({
    proxy: [{ id: 70, name: 'Shop 7 Proxy', ownerMemberId: 1, rotationUrl: null, createdAt: t('00') }],
    profile: [{ id: 7, title: 'Shop 7', ownerMemberId: 1, proxyId: 70, createdAt: t('05') }],
    setting: [{ key: 'profileRotationUrls', value: JSON.stringify({ 7: 'https://rotate.example/api?key=K7' }) }]
  });
  let db = createFakePrisma({});
  const readSetting = async (k, def) => { const r = await db.setting.findUnique({ where: { key: k } }); return r ? JSON.parse(r.value) : def; };
  const writeSetting = async (k, v) => { await db.setting.upsert({ where: { key: k }, update: { value: JSON.stringify(v) }, create: { key: k, value: JSON.stringify(v) } }); };
  let fns = null;
  fns = loadMain(['importedRotationUrl', 'attachImportedRotationUrl', 'proxyMadeForImportedRow', 'adoptImportedRotationLinks', 'workspaceRestore', 'requireObject'], {
    getPrisma: () => db, readSetting, writeSetting, logAudit: async () => {}, require,
    rotationLinksAdoptedThisRun: false,
    requireOwnerOrSuper: async () => {},
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['C:/backups/ws.sgzw'] }) },
    profileArchive: { restoreWorkspaceArchive: async () => ({ db: Buffer.from('SQLite format 3\0'), exportedAt: '2026-10-02' }) },
    getRuntimeConfig: () => ({ dbPath: 'C:/data/softglaze.db' }),
    fs: { writeFile: async () => {}, unlink: async () => {}, copyFile: async () => {}, rename: async () => {} },
    dbCrypto: { looksLikeSqlite: () => true, secureUnlink: async () => {} },
    database: { disconnectPrisma: async () => {}, bootstrapDatabase: async () => { db = restored; } },
    afterDbReady: async () => { await fns.adoptImportedRotationLinks(); },
    findUnreadableSealedSecrets: async () => []
  }, ['ROTATION_LINKS_ADOPTED_SETTING']);
  // Startup already ran the pass on the old (empty) database.
  assert.deepEqual(await fns.adoptImportedRotationLinks(), { attached: 0, skipped: 0 });
  const res = await fns.workspaceRestore({ password: 'pw' });
  assert.equal(res.ok, true);
  assert.equal((await restored.proxy.findUnique({ where: { id: 70 } })).rotationUrl, 'https://rotate.example/api?key=K7', 'adopted after the restore, same run');
  assert.match(extractFunction(IPC, 'workspaceRestore'), /rotationLinksAdoptedThisRun = false;\s*await afterDbReady\(\);/);
});

// ---- 15. Store package languages ----

test('15: the Store package declares English and Spanish; the manifest fix-up leaves them alone', () => {
  const cfgPath = require.resolve('../electron-builder.store.js');
  const old = process.env.SG_STORE_COMMERCE;
  process.env.SG_STORE_COMMERCE = '0';
  delete require.cache[cfgPath];
  try {
    assert.deepEqual(require(cfgPath).appx.languages, ['en-US', 'es']);
  } finally {
    if (old === undefined) delete process.env.SG_STORE_COMMERCE; else process.env.SG_STORE_COMMERCE = old;
    delete require.cache[cfgPath];
  }
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales')).sort(), ['en', 'es'], 'the app\'s own languages');
  // electron-builder writes one <Resource Language> per entry (AppxTarget resourceLanguageTag).
  const target = fs.readFileSync(require.resolve('app-builder-lib/out/targets/AppxTarget.js'), 'utf8');
  assert.match(target, /userLanguages\.map\(it => `<Resource Language="\$\{it\.replace\(\/_\/g, "-"\)\}" \/>`\)/);
  // build-store.js rewrites only the TargetDeviceFamily versions, and now prints the languages.
  const bs = read('scripts', 'build-store.js');
  const fix = extractFunction(bs, 'fixManifest');
  assert.match(fix, /xml = xml\.replace\(\/MinVersion="\[\^"\]\*"\/, `MinVersion="\$\{MIN_VERSION\}"`\)\s*\.replace\(\/MaxVersionTested="\[\^"\]\*"\/, `MaxVersionTested="\$\{MAX_VERSION_TESTED\}"`\);/);
  assert.doesNotMatch(fix, /Resource/);
  const manifest = '<Resources>\n<Resource Language="en-US" />\n<Resource Language="es" />\n</Resources>\n<TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.14316.0" MaxVersionTested="10.0.14316.0" />';
  const fixed = manifest.replace(/MinVersion="[^"]*"/, 'MinVersion="10.0.17763.0"').replace(/MaxVersionTested="[^"]*"/, 'MaxVersionTested="10.0.26100.0"');
  assert.deepEqual([...fixed.matchAll(/<Resource Language="([^"]+)"/g)].map((m) => m[1]), ['en-US', 'es']);
  assert.match(bs, /console\.log\(`Languages: \$\{languages\.join\(', '\) \|\| '\(none\)'\}`\);/);
});
