'use strict';
// Where this install came from, sent with the licence calls so the owner's admin can count installs
// by channel. Not personal data: one of three fixed words.
//
//   'store'    the Microsoft Store package (AppX/MSIX)
//   'website'  the website installer: a licensing tenant is baked in
//   'base'     no licensing backend (dev and base builds; nothing is sent then anyway)
//
// A Store install is recognised by EITHER of two signals, so neither has to be perfect:
//   - process.windowsStore: Electron sets it to true when the process runs with MSIX/AppX package
//     identity (GetPackageFamilyName succeeds), otherwise it is undefined.
//     https://www.electronjs.org/docs/latest/api/process#processwindowsstore-readonly
//     It is true for ANY MSIX package, a sideloaded one too, not only for Store installs. The Store
//     build is the only MSIX this repo makes, so here it means the Store build.
//   - distribution: 'store' in tenant.config.json, baked by scripts/build-store.js (the way the Store
//     package is built). scripts/build-tenant.js (the website installer) never writes it.
const { tenantConfig } = require('./tenantConfig');

const CHANNELS = ['store', 'website', 'base'];

// Pure decision, for tests: { windowsStore, distribution, tenantEnabled } -> 'store' | 'website' | 'base'.
function decideChannel({ windowsStore, distribution, tenantEnabled } = {}) {
  if (windowsStore === true || distribution === 'store') return 'store';
  if (tenantEnabled === true) return 'website';
  return 'base';
}

// Neither input changes while the app runs, so the answer is worked out once.
let cached = null;
function installChannel() {
  if (cached === null) {
    const cfg = tenantConfig();
    cached = decideChannel({ windowsStore: process.windowsStore, distribution: cfg.distribution, tenantEnabled: cfg.enabled });
  }
  return cached;
}
// Test seam: forget the cached answer after changing process.windowsStore or the tenant env.
function _reset() { cached = null; }

module.exports = { installChannel, decideChannel, CHANNELS, _reset };
