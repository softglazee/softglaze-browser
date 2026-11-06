'use strict';
// SOCKS4 proxies could not be saved: the UI offers SOCKS4 and the main-process validator accepts it,
// but the Prisma enum ProxyType had only HTTP and SOCKS5, so every SOCKS4 write failed with
// "Invalid value for argument `type`. Expected ProxyType." SOCKS4 is now a stored type. Chromium
// still refuses to launch through it (it resolves DNS locally for SOCKS4, a leak), and that is now
// said clearly when the proxy is assigned and before launch instead of surfacing as a raw error.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const IPC = read('src', 'main', 'ipcHandlers.js');
const MIGRATION = path.join(ROOT, 'prisma', 'migrations', '20261107000000_proxy_type_socks4', 'migration.sql');
const launchCheck = require('../src/main/launchCheck');
const loadGuards = () => import(pathToFileURL(path.join(ROOT, 'src', 'renderer', 'lib', 'uiGuards.mjs')).href);

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

// Same comment stripping + statement split the runtime migration runner uses (database.js).
function statementsOf(sql) {
  const cleaned = sql.split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n');
  const out = [];
  let buf = '';
  let inStr = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      buf += ch;
      if (ch === "'") { if (cleaned[i + 1] === "'") buf += cleaned[++i]; else inStr = false; }
      continue;
    }
    if (ch === "'") { inStr = true; buf += ch; continue; }
    if (ch === ';') { if (buf.trim()) out.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

test('the ProxyType enum the database client is generated from includes SOCKS4', () => {
  const schema = read('prisma', 'schema.prisma');
  const m = /enum ProxyType \{([^}]*)\}/.exec(schema);
  assert.ok(m, 'enum ProxyType must exist');
  const values = m[1].split(/\s+/).filter(Boolean);
  assert.deepEqual(values, ['HTTP', 'SOCKS5', 'SOCKS4']);
  const main = /const VALID_PROXY_TYPES = new Set\(\[([^\]]*)\]\)/.exec(IPC);
  const accepted = main[1].match(/'([A-Z0-9]+)'/g).map((s) => s.replace(/'/g, ''));
  assert.deepEqual(accepted.slice().sort(), values.slice().sort(), 'the validator and the enum accept the same types');
});

test('the migration keeps existing rows and rewrites legacy spellings to enum values', (t) => {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) { t.skip('node:sqlite is not available in this Node build'); return; }
  const db = new DatabaseSync(':memory:');
  // The real column: TEXT with no CHECK constraint, plus the unique key the app uses.
  db.exec('CREATE TABLE "Proxy" ("id" INTEGER PRIMARY KEY, "type" TEXT NOT NULL DEFAULT \'HTTP\', "host" TEXT NOT NULL, "port" INTEGER NOT NULL, "username" TEXT, "passwordHash" TEXT)');
  db.exec('CREATE UNIQUE INDEX "Proxy_type_host_port_username_passwordHash_key" ON "Proxy"("type", "host", "port", "username", "passwordHash")');
  const ins = db.prepare('INSERT INTO "Proxy" ("id", "type", "host", "port", "username", "passwordHash") VALUES (?, ?, ?, ?, ?, ?)');
  [
    [1, 'HTTP', 'a', 80, null, null],
    [2, 'SOCKS5', 'b', 1080, null, null],
    [3, 'SOCKS4', 'c', 1080, null, null],
    [4, 'socks4a', 'd', 1080, null, null],
    [5, 'https', 'e', 443, null, null],
    [6, 'socks5h', 'f', 1080, null, null],
    [7, 'SOCKS5', 'g', 1080, 'u', 'h1'],
    [8, 'socks5', 'g', 1080, 'u', 'h1'] // same proxy under another spelling: would collide
  ].forEach((r) => ins.run(...r));

  for (const statement of statementsOf(fs.readFileSync(MIGRATION, 'utf8'))) db.exec(statement + ';');

  const rows = db.prepare('SELECT "id", "type" FROM "Proxy" ORDER BY "id"').all().map((r) => [r.id, r.type]);
  assert.deepEqual(rows, [
    [1, 'HTTP'], [2, 'SOCKS5'], [3, 'SOCKS4'], [4, 'SOCKS4'], [5, 'HTTP'], [6, 'SOCKS5'], [7, 'SOCKS5'],
    [8, 'socks5'] // OR IGNORE: left as is rather than failing the migration on the unique key
  ]);
  // Running it again changes nothing (the runner applies each folder once, but stay idempotent).
  for (const statement of statementsOf(fs.readFileSync(MIGRATION, 'utf8'))) db.exec(statement + ';');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "Proxy" WHERE "type" = \'SOCKS4\'').get().n, 2);
});

test('the migration folder follows the runner\'s naming and runs after the last earlier Proxy change', () => {
  const dir = path.join(ROOT, 'prisma', 'migrations');
  const folders = fs.readdirSync(dir).filter((n) => /^\d{14}_/.test(n)).sort();
  const at = folders.indexOf('20261107000000_proxy_type_socks4');
  assert.ok(at > folders.indexOf('20261007000000_proxy_password_hash'), 'picked up by the startup runner, in order');
  assert.ok(fs.existsSync(MIGRATION));
});

function loadTypeHelpers() {
  const ctx = { VALID_PROXY_TYPES: new Set(['HTTP', 'SOCKS5', 'SOCKS4']) };
  vm.createContext(ctx);
  vm.runInContext(`${extractFunction(IPC, 'parseProxyType')}\n${extractFunction(IPC, 'proxyTypeHintFor')}\nthis.parse = parseProxyType; this.hint = proxyTypeHintFor;`, ctx);
  return ctx;
}

test('every proxy write path stores an enum value: SOCKS4A -> SOCKS4, HTTPS -> HTTP', () => {
  const { parse, hint } = loadTypeHelpers();
  assert.equal(parse('socks4'), 'SOCKS4');
  assert.equal(parse('SOCKS4A'), 'SOCKS4');
  assert.equal(parse('https'), 'HTTP');
  assert.equal(parse('socks'), 'SOCKS5');
  assert.throws(() => parse('ftp'), /Proxy type must be HTTP, SOCKS5, or SOCKS4\./);
  // The profile editor's chosen type applies to a bare host:port string...
  assert.equal(hint('1.2.3.4:1080', 'SOCKS4'), 'SOCKS4');
  assert.equal(hint('1.2.3.4:1080', 'SOCKS5'), 'SOCKS5');
  // ...but a scheme written in the string wins, and "Local" is not a protocol.
  assert.equal(hint('socks5://1.2.3.4:1080', 'HTTP'), null);
  assert.equal(hint('1.2.3.4:1080', 'Local'), null);
  assert.equal(hint('1.2.3.4:1080', ''), null);

  const find = extractFunction(IPC, 'findOrCreateProxy');
  assert.match(find, /parsed\.type = parseProxyType\(typeHint \|\| parsed\.type\);/, 'import / bulk-assign hints are normalised too');
  assert.match(extractFunction(IPC, 'createProfile'), /findOrCreateProxy\(db, input\.proxyRaw, `\$\{title\} Proxy`, proxyTypeHintFor\(input\.proxyRaw, input\.proxyType\)\)/);
  assert.match(extractFunction(IPC, 'updateProfile'), /findOrCreateProxy\(db, input\.proxyRaw, `\$\{existing\.title\} Proxy`, proxyTypeHintFor\(input\.proxyRaw, input\.proxyType\)\)/);
  assert.match(extractFunction(IPC, 'createProxy'), /type: parseProxyType\(input\.type\)/);
  assert.match(extractFunction(IPC, 'updateProxy'), /data\.type = parseProxyType\(input\.type\)/);
  assert.match(extractFunction(IPC, 'batchAddProxies'), /const fallbackType = parseProxyType\(input\.type \|\| 'HTTP'\);/);
});

test('the health check and the launch speak SOCKS4, not HTTP, to a SOCKS4 proxy', () => {
  assert.match(extractFunction(IPC, 'proxyAgentScheme'), /if \(t === 'socks4'\) return 'socks4';/);
  const be = require('../src/main/browserEngine');
  assert.equal(be.buildProxyServerArgument({ type: 'SOCKS4', host: '1.2.3.4', port: 1080 }), 'socks4://1.2.3.4:1080');
});

test('a Chromium profile on a SOCKS4 proxy is flagged before launch as blocking; Firefox is not', () => {
  const { socks4DnsLeak, preLaunchIssues } = launchCheck;
  assert.equal(socks4DnsLeak({ proxyType: 'SOCKS4', browserCore: 'Chromium' }), true);
  assert.equal(socks4DnsLeak({ proxyType: 'socks4', browserCore: null }), true, 'no engine set means Chromium');
  assert.equal(socks4DnsLeak({ proxyType: 'SOCKS4', browserCore: 'Firefox' }), false);
  assert.equal(socks4DnsLeak({ proxyType: 'SOCKS5', browserCore: 'Chromium' }), false);
  assert.equal(socks4DnsLeak({ proxyType: 'HTTP', browserCore: 'Chromium' }), false);

  const chromium = preLaunchIssues({ browserCore: 'Chromium', proxy: { type: 'SOCKS4', name: 'my socks4', host: 'h', port: 1 } });
  const issue = chromium.find((i) => i.key === 'socks4Dns');
  assert.ok(issue, 'the issue is reported');
  assert.equal(issue.blocking, true);
  assert.equal(issue.severity, 'fail');
  assert.equal(issue.params.proxy, 'my socks4');
  const firefox = preLaunchIssues({ browserCore: 'Firefox', proxy: { type: 'SOCKS4', host: 'h', port: 1 } });
  assert.ok(!firefox.some((i) => i.key === 'socks4Dns'));

  // The engine keeps refusing (the protection stays), with its own plain message.
  const engine = read('src', 'main', 'browserEngine.js');
  assert.match(engine, /if \(proxyTypeLc === 'socks4'\) \{\s*const e = new Error\('This profile uses a SOCKS4 proxy\./);
});

test('the renderer check matches the main-process one', async () => {
  const { socks4LeaksDns } = await loadGuards();
  const cases = [['SOCKS4', 'Chromium'], ['SOCKS4', ''], ['SOCKS4', 'Firefox'], ['SOCKS5', 'Chromium'], ['HTTP', 'Firefox'], ['socks4', undefined]];
  for (const [type, core] of cases) {
    assert.equal(socks4LeaksDns(type, core), launchCheck.socks4DnsLeak({ proxyType: type, browserCore: core }), `${type} / ${core}`);
  }
});

test('bulk assignment reports Chromium profiles that got a SOCKS4 proxy; the page says so', () => {
  const body = extractFunction(IPC, 'bulkAssignProxies');
  assert.match(body, /socks4Chromium: \[\]/);
  assert.match(body, /if \(proxy && launchCheck\.socks4DnsLeak\(\{ proxyType: proxy\.type, browserCore: row && row\.browserCore \}\)\) result\.socks4Chromium\.push\(profileId\);/);
  const page = read('src', 'renderer', 'pages', 'ProfilesPage.jsx');
  assert.match(page, /t\('reassignModal\.socks4Chromium', \{ count: res\.socks4Chromium\.length \}\)/);
});

test('the editor, the proxy forms and the pre-launch dialog explain SOCKS4 on Chromium', () => {
  const page = read('src', 'renderer', 'pages', 'ProfilesPage.jsx');
  assert.match(page, /socks4LeaksDns\(pd\.proxyType, pd\.browserCore\) && \(/, 'custom proxy typed as SOCKS4');
  assert.match(page, /socks4LeaksDns\(\(allProxies\.concat\(freeProxies\)\.find\(p => String\(p\.id\) === String\(pd\.selectedSavedProxy\)\) \|\| \{\}\)\.type, pd\.browserCore\)/, 'saved SOCKS4 proxy picked');
  const pool = read('src', 'renderer', 'pages', 'ProxyPoolPage.jsx');
  assert.match(pool, /\{proxyForm\.type === 'SOCKS4' && <Socks4Note text=\{t\('form\.socks4Note'\)\} \/>\}/);
  assert.match(pool, /\{batchType === 'SOCKS4' && <Socks4Note text=\{t\('form\.socks4Note'\)\} \/>\}/);
  const dialog = read('src', 'renderer', 'components', 'PreLaunchCheck.jsx');
  assert.match(dialog, /const launchable = items\.some\(\(it\) => !it\.issues\.some\(\(i\) => i\.blocking\)\);/);
  assert.match(dialog, /\{launchable && \(\s*<Button size="sm" variant="secondary"/, '"Launch anyway" is hidden when nothing could launch');

  for (const lang of ['en', 'es']) {
    const loc = (f) => JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, `${f}.json`));
    assert.ok(loc('captcha').prelaunch.issue.socks4Dns.includes('{{proxy}}'), `${lang} prelaunch.issue.socks4Dns`);
    assert.ok(loc('captcha').prelaunch.blocking, `${lang} prelaunch.blocking`);
    assert.ok(loc('profiles').proxy.socks4Chromium, `${lang} proxy.socks4Chromium`);
    assert.ok(loc('profiles').reassignModal.socks4Chromium.includes('{{count}}'), `${lang} reassignModal.socks4Chromium`);
    assert.ok(loc('proxies').form.socks4Note, `${lang} form.socks4Note`);
  }
});
