function getSoftglazeApi() {
  if (!window.softglaze) {
    throw new Error('SoftGlaze preload API is unavailable. Check preload.js, contextIsolation, and main.js configuration.');
  }
  return window.softglaze;
}

export const softglazeApi = {
  system: { getInfo: () => getSoftglazeApi().system.getInfo() },
  dashboard: { getStats: () => getSoftglazeApi().dashboard.getStats() },
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
    launch: (id, options) => getSoftglazeApi().profiles.launch(id, options),
    restore: (id) => getSoftglazeApi().profiles.restore(id),
    purge: (id, options) => getSoftglazeApi().profiles.purge(id, options),
    listTrash: () => getSoftglazeApi().profiles.listTrash(),
    bulkDelete: (ids) => getSoftglazeApi().profiles.bulkDelete(ids),
    bulkRestore: (ids) => getSoftglazeApi().profiles.bulkRestore(ids),
    bulkPurge: (ids, options) => getSoftglazeApi().profiles.bulkPurge(ids, options),
    bulkLaunch: (ids) => getSoftglazeApi().profiles.bulkLaunch(ids),
    bulkClose: (ids) => getSoftglazeApi().profiles.bulkClose(ids),
    analyzeLeaks: (id) => getSoftglazeApi().profiles.analyzeLeaks(id),
    exportCookies: (id, format) => getSoftglazeApi().profiles.exportCookies(id, format),
    importCookies: (id, data, format) => getSoftglazeApi().profiles.importCookies(id, data, format),
    clone: (id) => getSoftglazeApi().profiles.clone(id),
    liveLeak: (id) => getSoftglazeApi().profiles.liveLeak(id),
    activity: (id) => getSoftglazeApi().profiles.activity(id)
  },
  templates: {
    list: () => getSoftglazeApi().templates.list(),
    save: (id, name) => getSoftglazeApi().templates.save(id, name),
    delete: (id) => getSoftglazeApi().templates.delete(id),
    createProfile: (templateId, title) => getSoftglazeApi().templates.createProfile(templateId, title)
  },
  settings: {
    getProxyScheduler: () => getSoftglazeApi().settings.getProxyScheduler(),
    setProxyScheduler: (config) => getSoftglazeApi().settings.setProxyScheduler(config)
  },
  groups: {
    list: () => getSoftglazeApi().groups.list(),
    create: (payload) => getSoftglazeApi().groups.create(payload),
    update: (payload) => getSoftglazeApi().groups.update(payload),
    delete: (id) => getSoftglazeApi().groups.delete(id),
    assign: (ids, groupId) => getSoftglazeApi().groups.assign(ids, groupId)
  },
  tags: {
    list: () => getSoftglazeApi().tags.list()
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