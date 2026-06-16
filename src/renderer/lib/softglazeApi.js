function getSoftglazeApi() {
  if (!window.softglaze) {
    throw new Error('SoftGlaze preload API is unavailable. Check preload.js, contextIsolation, and main.js configuration.');
  }
  return window.softglaze;
}

export const softglazeApi = {
  system: { getInfo: () => getSoftglazeApi().system.getInfo() },
  proxies: {
    list: (params) => getSoftglazeApi().proxies.list(params),
    create: (payload) => getSoftglazeApi().proxies.create(payload),
    update: (payload) => getSoftglazeApi().proxies.update(payload),
    delete: (id) => getSoftglazeApi().proxies.delete(id),
    batchAdd: (payload) => getSoftglazeApi().proxies.batchAdd(payload),
    check: (payload) => getSoftglazeApi().proxies.check(payload)
  },
  profiles: {
    list: (params) => getSoftglazeApi().profiles.list(params),
    create: (payload) => getSoftglazeApi().profiles.create(payload),
    update: (payload) => getSoftglazeApi().profiles.update(payload),
    delete: (id, options) => getSoftglazeApi().profiles.delete(id, options),
    launch: (id, options) => getSoftglazeApi().profiles.launch(id, options)
  },
  sessions: {
    list: () => getSoftglazeApi().sessions.list(),
    close: (sessionId) => getSoftglazeApi().sessions.close(sessionId)
  },
  batch: {
    previewProfilesFromSpreadsheet: () => getSoftglazeApi().batch.previewProfilesFromSpreadsheet(),
    commitProfileImport: (token) => getSoftglazeApi().batch.commitProfileImport(token)
  }
};