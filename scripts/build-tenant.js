'use strict';
// Produce a per-tenant (white-label) build by baking a provisioned tenant config
// into src/main/tenant.config.json, then running the Electron build. The base
// config is always restored afterward so the working tree stays clean.
//
//   node scripts/build-tenant.js <tenant.config.json>             # bake + build + restore
//   node scripts/build-tenant.js <tenant.config.json> --bake-only # just bake (for dev)
//   node scripts/build-tenant.js --reset                          # restore the empty base config
//
// The config is the file emitted by the licensing-server's `npm run provision`:
//   { "tenantId": "...", "apiBaseUrl": "https://...", "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n..." }
// Optional white-label overrides: { "brand": { "name", "appId", "winIcon" } }.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const TARGET = path.join(__dirname, '..', 'src', 'main', 'tenant.config.json');
const EMPTY = { tenantId: '', apiBaseUrl: '', publicKeyPem: '' };
const writeConfig = (obj) => fs.writeFileSync(TARGET, JSON.stringify(obj, null, 2) + '\n');

const args = process.argv.slice(2);

if (args.includes('--reset')) {
  writeConfig(EMPTY);
  console.log('Reset src/main/tenant.config.json to the empty base config.');
  process.exit(0);
}

const cfgPath = args.find((a) => !a.startsWith('--'));
if (!cfgPath) {
  console.error('Usage: node scripts/build-tenant.js <tenant.config.json> [--bake-only]');
  process.exit(1);
}

let cfg;
try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); }
catch (e) { console.error('Could not read config:', e.message); process.exit(1); }
for (const k of ['tenantId', 'apiBaseUrl', 'publicKeyPem']) {
  if (!cfg[k]) { console.error(`Config is missing "${k}".`); process.exit(1); }
}

const original = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : (JSON.stringify(EMPTY, null, 2) + '\n');
writeConfig({ tenantId: cfg.tenantId, apiBaseUrl: cfg.apiBaseUrl, publicKeyPem: cfg.publicKeyPem });
console.log(`Baked tenant ${cfg.tenantId} into src/main/tenant.config.json`);

if (args.includes('--bake-only')) {
  console.log('Bake-only: build skipped. Restore with: node scripts/build-tenant.js --reset');
  process.exit(0);
}

// Optional white-label overrides passed straight to electron-builder.
const overrides = [];
if (cfg.brand && cfg.brand.name) overrides.push(`--config.productName=${JSON.stringify(cfg.brand.name)}`);
if (cfg.brand && cfg.brand.appId) overrides.push(`--config.appId=${JSON.stringify(cfg.brand.appId)}`);
if (cfg.brand && cfg.brand.winIcon) overrides.push(`--config.win.icon=${JSON.stringify(cfg.brand.winIcon)}`);

try {
  execSync('npx prisma generate', { stdio: 'inherit' });
  execSync('npx vite build', { stdio: 'inherit' });
  execSync(`npx electron-builder --win --x64 ${overrides.join(' ')}`.trim(), { stdio: 'inherit' });
  console.log(`\nBuilt tenant ${cfg.tenantId}. Installer is in dist_installer/.`);
} finally {
  fs.writeFileSync(TARGET, original); // always restore the base config
  console.log('Restored base src/main/tenant.config.json');
}
