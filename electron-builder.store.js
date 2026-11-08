'use strict';
// Build config for the MICROSOFT STORE (AppX) variant of the app.
//
// It packages the SAME source as the website installer and changes only how it is packaged:
//
//   • target appx instead of nsis. The package is left UNSIGNED on purpose: Partner Center
//     re-signs every Store package with Microsoft's certificate, so no code-signing
//     certificate is needed (or wanted) here. scripts/build-store.js clears CSC_* so a
//     certificate in the environment can't sneak in and change the publisher.
//   • identity (identityName / publisher / publisherDisplayName) must be copied EXACTLY from
//     Partner Center > the app > Product identity. A mismatch makes the upload fail.
//     The values can be overridden with SG_STORE_* environment variables for a test build.
//   • extraMetadata.name gives the Store build its own %APPDATA% folder name
//     (softglaze-browser-store), so it can never read or write the website build's
//     database, profiles or downloaded browsers on a machine that has both installed.
//   • publish: null strips the GitHub update feed. Store installs are updated by the Store;
//     src/main/updater.js also switches itself off when process.windowsStore is true.
//   • output goes to dist_store/, so the website installer in dist_installer/ is untouched.
//   • extraResources adds the Microsoft Store purchase addon (dist_store_native/softglaze_store.node,
//     built by scripts/build-store-native.js) as resources/store-native/softglaze_store.node. Only this
//     config ships it; src/main/storeBridge.js loads it only when process.windowsStore is true.
//     SG_STORE_COMMERCE=0 (build-store.js --no-store-commerce) leaves it out.
//
// Everything else (files, asarUnpack, afterPack, icons) is inherited from the `build` block
// in package.json, so the Store and website builds cannot drift apart.
//
// Usage: npm run build:store -- --tenant <path to tenants/<id>.config.json>   ->   dist_store/

const fs = require('node:fs');
const path = require('node:path');
const base = require('./package.json').build;

const env = process.env;
const identity = {
  // Copied from Partner Center > SoftGlaze Browser (Store ID 9NQZMTHN87CB) > Product identity.
  identityName: env.SG_STORE_IDENTITY_NAME || 'SoftGlaze.SoftGlazeBrowser',
  publisher: env.SG_STORE_PUBLISHER || 'CN=1EBF5ABB-3062-4136-A9B0-C047CD2DEAEF',
  publisherDisplayName: env.SG_STORE_PUBLISHER_DISPLAY_NAME || 'Soft Glaze',
};

const STORE_ADDON = path.join(__dirname, 'dist_store_native', 'softglaze_store.node');
const withCommerce = env.SG_STORE_COMMERCE !== '0';
if (withCommerce && !fs.existsSync(STORE_ADDON)) {
  throw new Error('dist_store_native/softglaze_store.node is missing: run node scripts/build-store-native.js, or build with --no-store-commerce.');
}

module.exports = {
  ...base,
  extraResources: [
    ...(base.extraResources || []),
    ...(withCommerce ? [{ from: 'dist_store_native/softglaze_store.node', to: 'store-native/softglaze_store.node' }] : [])
  ],
  extraMetadata: {
    name: 'softglaze-browser-store',
  },
  win: {
    ...base.win,
    target: [{ target: 'appx', arch: ['x64'] }],
  },
  appx: {
    ...identity,
    applicationId: 'SoftGlazeBrowser',
    displayName: 'SoftGlaze Browser',
    backgroundColor: 'transparent',
    languages: ['en-US'],
    showNameOnTiles: true,
  },
  directories: {
    ...base.directories,
    output: 'dist_store',
  },
  publish: null,
};
