'use strict';
// Builds the Microsoft Store package (AppX) into dist_store/. The website installer
// (dist_installer/) and its config are not touched.
//
//   node scripts/build-store.js --tenant <tenants/<id>.config.json>   sellable Store build
//   node scripts/build-store.js --base                                 no licensing backend (test only)
//   add --no-store-commerce to leave out Microsoft Store in-app purchases (the native Store addon)
//
// Steps: bake the tenant config (restored afterwards, even on failure) -> check-tenant-baked ->
// prisma generate -> vite build -> the Store addon (scripts/build-store-native.js, needs Visual Studio
// C++ tools) -> electron-builder with electron-builder.store.js ->
// raise the manifest's Windows version floor (see fixManifest) -> print the identity to check.
const { execSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TENANT_TARGET = path.join(ROOT, 'src', 'main', 'tenant.config.json');
const OUT_DIR = path.join(ROOT, 'dist_store');

// electron-builder 24 writes MinVersion/MaxVersionTested 10.0.14316.0 (Windows 10 build 1607 preview).
// Electron 42 / Chromium needs Windows 10 1809 or later, and Partner Center expects a recent
// MaxVersionTested, so the manifest is rewritten to these values after packaging.
const MIN_VERSION = '10.0.17763.0'; // Windows 10 1809
const MAX_VERSION_TESTED = '10.0.26100.0'; // Windows 11 24H2

const args = process.argv.slice(2);
const tenantIdx = args.indexOf('--tenant');
const tenantPath = tenantIdx >= 0 ? args[tenantIdx + 1] : null;
const baseBuild = args.includes('--base');
const storeCommerce = !args.includes('--no-store-commerce');
if (!tenantPath && !baseBuild) {
  console.error('Usage: node scripts/build-store.js --tenant <tenant.config.json> | --base');
  process.exit(1);
}

// A Store package must stay unsigned (Microsoft signs it), so no certificate may leak in.
const childEnv = { ...process.env };
for (const k of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD', 'CSC_NAME']) delete childEnv[k];
if (baseBuild) childEnv.SG_ALLOW_BASE_BUILD = '1';
else delete childEnv.SG_ALLOW_BASE_BUILD;
// electron-builder.store.js packs dist_store_native/softglaze_store.node only when this is not '0'.
childEnv.SG_STORE_COMMERCE = storeCommerce ? '1' : '0';

const run = (cmd) => execSync(cmd, { stdio: 'inherit', cwd: ROOT, env: childEnv });

function bakeTenant() {
  const cfg = JSON.parse(fs.readFileSync(tenantPath, 'utf8'));
  for (const k of ['tenantId', 'apiBaseUrl', 'publicKeyPem']) {
    if (!cfg[k]) throw new Error(`Tenant config is missing "${k}".`);
  }
  // No updateFeedUrl: Store installs are updated by the Store. distribution 'store' makes the app
  // report channel 'store' to the licensing server (src/main/installChannel.js).
  const baked = { tenantId: cfg.tenantId, apiBaseUrl: cfg.apiBaseUrl, publicKeyPem: cfg.publicKeyPem, updateFeedUrl: '', distribution: 'store' };
  // Payment providers enabled for this tenant on the licensing server (in-app checkout offers these).
  if (Array.isArray(cfg.checkoutProviders) && cfg.checkoutProviders.length) baked.checkoutProviders = cfg.checkoutProviders;
  fs.writeFileSync(TENANT_TARGET, JSON.stringify(baked, null, 2) + '\n');
  console.log(`Baked tenant ${cfg.tenantId} (${cfg.apiBaseUrl}) into src/main/tenant.config.json`
    + (baked.checkoutProviders ? `, checkout: ${baked.checkoutProviders.join(', ')}` : ', no checkout providers'));
}

function newestAppx() {
  const files = fs.readdirSync(OUT_DIR).filter((f) => f.toLowerCase().endsWith('.appx'))
    .map((f) => ({ f, t: fs.statSync(path.join(OUT_DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  if (!files.length) throw new Error('No .appx found in dist_store/.');
  return path.join(OUT_DIR, files[0].f);
}

async function fixManifest(appxPath) {
  const { getSignVendorPath } = require('app-builder-lib/out/codeSign/windowsCodeSign');
  const makeappx = path.join(await getSignVendorPath(), 'windows-10', 'x64', 'makeappx.exe');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-appx-'));
  try {
    execFileSync(makeappx, ['unpack', '/p', appxPath, '/d', work, '/o', '/l'], { stdio: 'pipe' });
    const manifestPath = path.join(work, 'AppxManifest.xml');
    let xml = fs.readFileSync(manifestPath, 'utf8');
    const before = (xml.match(/<TargetDeviceFamily[^>]*>/) || [''])[0];
    xml = xml.replace(/MinVersion="[^"]*"/, `MinVersion="${MIN_VERSION}"`)
      .replace(/MaxVersionTested="[^"]*"/, `MaxVersionTested="${MAX_VERSION_TESTED}"`);
    fs.writeFileSync(manifestPath, xml);
    // makeappx regenerates the block map; the signature file only exists on signed packages.
    for (const f of ['AppxBlockMap.xml', 'AppxSignature.p7x', '[Content_Types].xml']) fs.rmSync(path.join(work, f), { force: true });
    execFileSync(makeappx, ['pack', '/d', work, '/p', appxPath, '/o', '/l'], { stdio: 'pipe' });
    console.log(`Manifest: ${before}\n       -> ${(xml.match(/<TargetDeviceFamily[^>]*>/) || [''])[0]}`);
    return xml;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

(async () => {
  const originalTenant = fs.readFileSync(TENANT_TARGET, 'utf8');
  let ok = false;
  try {
    if (tenantPath) bakeTenant();
    run('node scripts/check-tenant-baked.js');
    run('npx prisma generate');
    run('npx vite build');
    if (storeCommerce) run('node scripts/build-store-native.js');
    else console.log('--no-store-commerce: the package will not offer Microsoft Store purchases.');
    run('npx electron-builder --win --x64 --config electron-builder.store.js');
    ok = true;
  } finally {
    fs.writeFileSync(TENANT_TARGET, originalTenant); // always restore the base config
    console.log('Restored base src/main/tenant.config.json');
  }
  if (!ok) return;
  const appx = newestAppx();
  const xml = await fixManifest(appx);
  const identity = (xml.match(/<Identity[^>]*\/>/) || [''])[0].replace(/\s+/g, ' ');
  const pubName = (xml.match(/<PublisherDisplayName>([^<]*)</) || [])[1];
  console.log(`\nStore package: ${appx} (${(fs.statSync(appx).size / 1048576).toFixed(1)} MB)`);
  console.log(`Identity: ${identity}`);
  console.log(`PublisherDisplayName: ${pubName}`);
  console.log('Check these three against Partner Center > Product identity before uploading.');
})().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
