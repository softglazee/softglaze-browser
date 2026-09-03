'use strict';
// Build config for the TESTING variant of the app.
//
// It packages the SAME source as the production build and changes only identity, so a
// tester can run both installed side by side without them colliding:
//
//   • extraMetadata.name rewrites `name` inside the PACKAGED package.json only. Electron
//     derives app.getPath('userData') from that name, so the testing build gets its own
//     %APPDATA%\softglaze-browser-testing tree — its database, profile folders and
//     browser binaries can never touch the production workspace. This is the whole
//     isolation mechanism; there is no flag for the tester to remember.
//   • A distinct appId gives it its own uninstall registry key, so removing one build
//     leaves the other installed.
//   • publish: null strips the update feed. Without it the testing build would inherit
//     the production GitHub releases config and could auto-update itself into a
//     production release mid-test.
//
// Everything else (files, asarUnpack, afterPack, nsis behaviour, icons) is inherited
// from the `build` block in package.json, so the two builds cannot drift apart.
//
// Usage: npm run build:testing   ->   dist_installer_testing/
//
// NOTE: `-c.publish=null` on the CLI does NOT work — electron-builder receives the
// string "null" and fails schema validation. It has to be a real null, hence this file.

const base = require('./package.json').build;

module.exports = {
  ...base,
  extraMetadata: {
    name: 'softglaze-browser-testing'
  },
  appId: 'com.softglaze.browser.testing',
  productName: 'SoftGlaze Browser Testing',
  nsis: {
    ...base.nsis,
    shortcutName: 'SoftGlaze Browser Testing'
  },
  directories: {
    ...base.directories,
    output: 'dist_installer_testing'
  },
  publish: null
};
