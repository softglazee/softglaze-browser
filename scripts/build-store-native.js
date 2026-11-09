'use strict';
// Builds native/store-addon (C++/WinRT + Node-API) into dist_store_native/softglaze_store.node, the
// Microsoft Store build's bridge to Windows.Services.Store (purchases, add-on licences, Store ID
// keys, the rating dialog). Only the Store package ships it (electron-builder.store.js); website and base builds never
// include or load it.
//
//   node scripts/build-store-native.js           build
//   node scripts/build-store-native.js --check   build, then load it in Node and call ping + license
//
// Needs Windows with Visual Studio 2019+ (or the Build Tools) "Desktop development with C++" (MSVC and
// a Windows 10/11 SDK, which includes the C++/WinRT headers) and Python 3, the usual node-gyp setup.
// node-gyp is the copy bundled with npm. The addon uses Node-API only, so it is built once against
// Electron's headers and keeps working across Electron upgrades.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ADDON_DIR = path.join(ROOT, 'native', 'store-addon');
const OUT_DIR = path.join(ROOT, 'dist_store_native');
const OUT = path.join(OUT_DIR, 'softglaze_store.node');

function fail(msg) {
  console.error(`build-store-native: ${msg}`);
  process.exit(1);
}

function electronVersion() {
  try { return require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version; } catch (_) { /* fall through */ }
  const dev = require(path.join(ROOT, 'package.json')).devDependencies.electron;
  return String(dev || '').replace(/^[^\d]*/, '');
}

function nodeGypScript() {
  const candidates = [
    process.env.npm_config_node_gyp,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')
  ];
  try { candidates.push(require.resolve('node-gyp/bin/node-gyp.js', { paths: [ROOT] })); } catch (_) { /* not installed locally */ }
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

function build() {
  if (process.platform !== 'win32') fail('the Store addon can only be built on Windows.');
  const gyp = nodeGypScript();
  if (!gyp) fail('node-gyp not found (it ships with npm). Reinstall Node.js with npm.');
  const version = electronVersion();
  if (!/^\d+\.\d+\.\d+/.test(version)) fail(`could not read the Electron version (got "${version}").`);
  const args = [gyp, 'rebuild', `--directory=${ADDON_DIR}`, `--target=${version}`, '--arch=x64', '--dist-url=https://electronjs.org/headers', '--release'];
  console.log(`node-gyp rebuild (Electron ${version} headers) in native/store-addon`);
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: ADDON_DIR });
  const built = path.join(ADDON_DIR, 'build', 'Release', 'softglaze_store.node');
  if (r.status !== 0 || !fs.existsSync(built)) {
    fail(`node-gyp failed (exit ${r.status}). Needs Visual Studio "Desktop development with C++" and Python 3. `
      + 'To build the Store package without in-app purchases: npm run build:store -- --tenant <file> --no-store-commerce');
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.copyFileSync(built, OUT);
  console.log(`Store addon: ${OUT} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
}

// Loads the addon in a separate Node process: outside the Store package it must answer ping and refuse
// Store calls with no_package_identity instead of crashing.
function check() {
  const script = `
    const a = require(${JSON.stringify(OUT)});
    (async () => {
      const ping = JSON.parse(await a.call('ping', {}));
      const lic = JSON.parse(await a.call('license', {}));
      const rate = JSON.parse(await a.call('rate', {}));
      const bad = JSON.parse(await a.call('nope', {}));
      process.stdout.write(JSON.stringify({ ping, lic, rate, bad }));
    })().catch((e) => { console.error(e); process.exit(2); });`;
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 30000 });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch (_) { out = null; }
  if (!out || out.ping.ok !== true || out.ping.protocol !== 1) fail(`ping failed: exit ${r.status} ${r.stdout} ${r.stderr}`);
  if (!out.ping.packaged && !(out.lic.ok === false && out.lic.error === 'no_package_identity')) fail(`license outside a package: ${JSON.stringify(out.lic)}`);
  if (!out.ping.packaged && !(out.rate.ok === false && out.rate.error === 'no_package_identity')) fail(`rate outside a package: ${JSON.stringify(out.rate)}`);
  console.log(`check: ${JSON.stringify(out)}`);
}

if (require.main === module) {
  build();
  if (process.argv.includes('--check')) check();
}

module.exports = { OUT, OUT_DIR };
