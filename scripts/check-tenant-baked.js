'use strict';
// Refuse to package an installer with no licensing backend baked in: an empty tenant.config.json
// runs only on the local trial state machine and cannot redeem anything. Sellable builds use
// `npm run build:tenant -- <config>`; dev builds set SG_ALLOW_BASE_BUILD=1.
const fs = require('node:fs');
const path = require('node:path');

const TARGET = path.join(__dirname, '..', 'src', 'main', 'tenant.config.json');

if (String(process.env.SG_ALLOW_BASE_BUILD || '') === '1') {
  console.log('check-tenant-baked: SG_ALLOW_BASE_BUILD=1 — packaging a base build with no licensing backend.');
  process.exit(0);
}

let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(TARGET, 'utf8')) || {}; }
catch (e) { cfg = {}; }

const missing = ['tenantId', 'apiBaseUrl', 'publicKeyPem'].filter((k) => !String(cfg[k] || '').trim());
if (missing.length) {
  console.error(
    '\ncheck-tenant-baked: refusing to package — src/main/tenant.config.json is missing '
    + missing.join(', ') + '.\n\n'
    + '  This installer would ship with no licensing backend: paid entitlement would rest\n'
    + '  entirely on local state, and purchase codes could not be redeemed at all.\n\n'
    + '  To build a sellable installer:\n'
    + '    1) on the licensing server:  npm run provision -- "SoftGlaze"\n'
    + '    2) here:                     npm run build:tenant -- <path to that tenants/<id>.config.json>\n\n'
    + '  To build for development anyway:\n'
    + '    SG_ALLOW_BASE_BUILD=1 npm run build\n'
  );
  process.exit(1);
}

// A production build must not point the app at a development server.
let host = '';
try { host = new URL(cfg.apiBaseUrl).hostname.toLowerCase(); } catch (e) { host = ''; }
if (!host) {
  console.error(`\ncheck-tenant-baked: apiBaseUrl is not a valid URL: "${cfg.apiBaseUrl}"\n`);
  process.exit(1);
}
if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
  console.error(
    `\ncheck-tenant-baked: apiBaseUrl points at ${host} — that server does not exist on a`
    + '\ncustomer machine, so every licence check would fail. Bake the public HTTPS URL.\n'
  );
  process.exit(1);
}
if (!/^-----BEGIN PUBLIC KEY-----/.test(String(cfg.publicKeyPem).trim())) {
  console.error('\ncheck-tenant-baked: publicKeyPem is not an SPKI PEM public key.\n');
  process.exit(1);
}
// The private half must never be in a build config.
if (/PRIVATE KEY/.test(String(cfg.publicKeyPem))) {
  console.error('\ncheck-tenant-baked: publicKeyPem contains a PRIVATE key. Stop and rotate it.\n');
  process.exit(1);
}

console.log(`check-tenant-baked: tenant ${cfg.tenantId} @ ${cfg.apiBaseUrl}`);
