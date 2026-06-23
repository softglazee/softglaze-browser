'use strict';
// Provision a new tenant: generate an Ed25519 keypair (private key sealed at
// rest), create the Tenant row, and emit the build config to bake into that
// merchant's desktop build. The tenant API key is printed ONCE.
//
//   npm run provision -- "Acme Browsers"
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const prisma = require('../src/db');
const { generateTenantKeypair, newApiKey, sha256Hex } = require('../src/crypto/keys');
const { seal } = require('../src/crypto/secrets');
const { publicBaseUrl } = require('../src/env');

async function main() {
  const name = process.argv.slice(2).join(' ').trim();
  if (!name) {
    console.error('Usage: npm run provision -- "<Tenant Name>"');
    process.exit(1);
  }

  const { publicKeyPem, privateKeyPem } = generateTenantKeypair();
  const apiKey = newApiKey();
  const tenant = await prisma.tenant.create({
    data: {
      name,
      publicKeyPem,
      privateKeySealed: seal(privateKeyPem),
      apiKeyHash: sha256Hex(apiKey)
    }
  });

  const config = { tenantId: tenant.id, apiBaseUrl: publicBaseUrl, publicKeyPem };
  const outDir = path.join(__dirname, '..', 'tenants');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${tenant.id}.config.json`);
  fs.writeFileSync(outFile, JSON.stringify(config, null, 2));

  console.log('\n=== Tenant provisioned ===');
  console.log('Tenant ID :', tenant.id);
  console.log('Name      :', name);
  console.log('\nTenant API key (store securely — shown ONCE; used for /v1/tenant admin calls):');
  console.log('   ' + apiKey);
  console.log('\nBuild config written to:', outFile);
  console.log('Bake { tenantId, apiBaseUrl, publicKeyPem } into the merchant\'s desktop build.');
  console.log('\nNext steps:');
  console.log('  1) POST /v1/tenant/payment-config  (set the merchant\'s Stripe key + webhook secret)');
  console.log('  2) Point the merchant\'s Stripe webhook at the URL that call returns');
  console.log('  3) POST /v1/tenant/plans           (define plans)\n');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch (_) { /* ignore */ }
  process.exit(1);
});
