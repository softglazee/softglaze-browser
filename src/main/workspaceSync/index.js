'use strict';
// Cloud sync (phase 1) wiring for the app: builds the service from the app's database, account session
// and tenant config. ipcHandlers.js calls setup() once and start() after the database is ready.
const os = require('node:os');
const { P } = require('../mobile/protocol');
const { qrDataUrl } = require('../mobile/qr');
const { createKeystore } = require('./keystore');
const { createDesktopReplica, createDbShadowStore } = require('./replica');
const { createWorkspaceSyncService } = require('./service');
const { registerCloudSyncIpc, CLOUD_SYNC_CHANNELS } = require('./ipc');

let service = null;

// host: { registerHandler, getPrisma, apiBaseUrl(), account() -> { session, customerId, email } | null,
//         getWindowMember(), uniqueDataDirName(title), assertProfileCapacity(), isProfileRunning(id),
//         fillNewProfile(data), broadcast(channel, data), safeStorage, userDataDir() }
function setup(host) {
  if (service) return service;
  const keystore = createKeystore({ safeStorage: host.safeStorage, dir: host.userDataDir });
  const replica = createDesktopReplica({
    P,
    getPrisma: host.getPrisma,
    uniqueDataDirName: host.uniqueDataDirName,
    assertProfileCapacity: host.assertProfileCapacity,
    isProfileRunning: host.isProfileRunning,
    fillNewProfile: host.fillNewProfile,
    log: { info: (m) => console.log(m), warn: (m) => console.warn(m) }
  });
  service = createWorkspaceSyncService({
    P,
    keystore,
    replica,
    shadow: createDbShadowStore(host.getPrisma),
    apiBaseUrl: host.apiBaseUrl,
    sessionToken: () => {
      const a = host.account();
      return a && a.session ? a.session : null;
    },
    accountId: () => {
      const a = host.account();
      return a ? a.customerId || a.email || null : null;
    },
    deviceName: () => {
      try {
        return os.hostname() || 'PC';
      } catch (_) {
        return 'PC';
      }
    },
    // The server decides per account (CLOUD_SYNC flag); SG_CLOUD_SYNC=0 turns it off on this PC.
    flagEnabled: () => process.env.SG_CLOUD_SYNC !== '0',
    onChange: (what) => host.broadcast(CLOUD_SYNC_CHANNELS.CHANGED, { what }),
    log: { info: (m) => console.log(m), warn: (m) => console.warn(m) }
  });
  registerCloudSyncIpc(host.registerHandler, service, { getWindowMember: host.getWindowMember, qrDataUrl });
  return service;
}

function start() {
  return service ? service.start() : Promise.resolve(false);
}

function stop() {
  if (service) service.stop();
}

module.exports = { setup, start, stop, CLOUD_SYNC_CHANNELS };
