function getSoftglazeApi() {
  if (!window.softglaze) {
    throw new Error('SoftGlaze preload API is unavailable. Check preload.js, contextIsolation, and main.js configuration.');
  }
  return window.softglaze;
}

export const softglazeApi = {
  system: {
    getInfo: () => getSoftglazeApi().system.getInfo(),
    listBrowsers: () => getSoftglazeApi().system.listBrowsers(),
    humanType: (payload) => getSoftglazeApi().system.humanType(payload)
  },
  browsers: {
    listAvailable: () => getSoftglazeApi().browsers.listAvailable(),
    download: (version) => getSoftglazeApi().browsers.download(version),
    downloadStatus: () => getSoftglazeApi().browsers.downloadStatus(),
    pauseDownload: (version) => getSoftglazeApi().browsers.pauseDownload(version),
    resumeDownload: (version) => getSoftglazeApi().browsers.resumeDownload(version),
    firefoxStatus: () => getSoftglazeApi().browsers.firefoxStatus(),
    firefoxList: () => getSoftglazeApi().browsers.firefoxList(),
    firefoxDownload: (version) => getSoftglazeApi().browsers.firefoxDownload(version),
    firefoxDownloadStatus: () => getSoftglazeApi().browsers.firefoxDownloadStatus(),
    firefoxPauseDownload: (version) => getSoftglazeApi().browsers.firefoxPauseDownload(version),
    firefoxResumeDownload: (version) => getSoftglazeApi().browsers.firefoxResumeDownload(version)
  },
  dashboard: { getStats: () => getSoftglazeApi().dashboard.getStats() },
  proxies: {
    list: (params) => getSoftglazeApi().proxies.list(params),
    create: (payload) => getSoftglazeApi().proxies.create(payload),
    update: (payload) => getSoftglazeApi().proxies.update(payload),
    delete: (id) => getSoftglazeApi().proxies.delete(id),
    batchAdd: (payload) => getSoftglazeApi().proxies.batchAdd(payload),
    check: (payload) => getSoftglazeApi().proxies.check(payload),
    bulkDelete: (ids) => getSoftglazeApi().proxies.bulkDelete(ids),
    getRotation: (profileId) => getSoftglazeApi().proxies.getRotation(profileId),
    setRotation: (payload) => getSoftglazeApi().proxies.setRotation(payload),
    syncVendorPool: (payload) => getSoftglazeApi().proxies.syncVendorPool(payload),
    rotateIp: (payload) => getSoftglazeApi().proxies.rotateIp(payload),
    testAll: () => getSoftglazeApi().proxies.testAll()
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
    importCookiesToRunning: (data, format) => getSoftglazeApi().profiles.importCookiesToRunning(data, format),
    storageInfo: (id) => getSoftglazeApi().profiles.storageInfo(id),
    clone: (id, options) => getSoftglazeApi().profiles.clone(id, options),
    liveLeak: (id) => getSoftglazeApi().profiles.liveLeak(id),
    activity: (id) => getSoftglazeApi().profiles.activity(id),
    get2faToken: (id) => getSoftglazeApi().profiles.get2faToken(id),
    bulkSynchronize: (ids) => getSoftglazeApi().profiles.bulkSynchronize(ids),
    exportArchive: (payload) => getSoftglazeApi().profiles.exportArchive(payload),
    cookieRobot: (payload) => getSoftglazeApi().profiles.cookieRobot(payload),
    getLocks: () => getSoftglazeApi().profiles.getLocks()
  },
  templates: {
    list: () => getSoftglazeApi().templates.list(),
    save: (id, name) => getSoftglazeApi().templates.save(id, name),
    delete: (id) => getSoftglazeApi().templates.delete(id),
    createProfile: (templateId, title) => getSoftglazeApi().templates.createProfile(templateId, title)
  },
  settings: {
    getProxyScheduler: () => getSoftglazeApi().settings.getProxyScheduler(),
    setProxyScheduler: (config) => getSoftglazeApi().settings.setProxyScheduler(config),
    getGlobal: () => getSoftglazeApi().settings.getGlobal(),
    setGlobal: (patch) => getSoftglazeApi().settings.setGlobal(patch),
    getProxyPolicy: () => getSoftglazeApi().settings.getProxyPolicy(),
    setProxyPolicy: (payload) => getSoftglazeApi().settings.setProxyPolicy(payload),
    getEmail: () => getSoftglazeApi().settings.getEmail(),
    setEmail: (config) => getSoftglazeApi().settings.setEmail(config),
    testEmail: (email) => getSoftglazeApi().settings.testEmail(email)
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
  members: {
    list: () => getSoftglazeApi().members.list(),
    create: (payload) => getSoftglazeApi().members.create(payload),
    update: (payload) => getSoftglazeApi().members.update(payload),
    delete: (id) => getSoftglazeApi().members.delete(id),
    setPin: (id, pin) => getSoftglazeApi().members.setPin(id, pin),
    current: () => getSoftglazeApi().members.current(),
    switch: (id, pin, password) => getSoftglazeApi().members.switch(id, pin, password),
    superLogin: (identifier, password) => getSoftglazeApi().members.superLogin(identifier, password),
    superStatus: () => getSoftglazeApi().members.superStatus(),
    superSetup: (payload) => getSoftglazeApi().members.superSetup(payload),
    acceptInvite: (payload) => getSoftglazeApi().members.acceptInvite(payload),
    login: (identifier, password) => getSoftglazeApi().members.login(identifier, password),
    logout: () => getSoftglazeApi().members.logout(),
    updateSelf: (payload) => getSoftglazeApi().members.updateSelf(payload),
    requestChange: (payload) => getSoftglazeApi().members.requestChange(payload),
    commitChange: (payload) => getSoftglazeApi().members.commitChange(payload),
    updatePermissions: (id, permissions) => getSoftglazeApi().members.updatePermissions(id, permissions),
    resetPermissions: (id) => getSoftglazeApi().members.resetPermissions(id),
    setInstructions: (id, instructions) => getSoftglazeApi().members.setInstructions(id, instructions),
    setStatus: (payload) => getSoftglazeApi().members.setStatus(payload)
  },
  team: {
    activity: (limit) => getSoftglazeApi().team.activity(limit),
    reassignProfiles: (payload) => getSoftglazeApi().team.reassignProfiles(payload),
    seatUsage: () => getSoftglazeApi().team.seatUsage(),
    exportActivity: (payload) => getSoftglazeApi().team.exportActivity(payload)
  },
  sync: {
    status: () => getSoftglazeApi().sync.status(),
    configure: (payload) => getSoftglazeApi().sync.configure(payload),
    run: (payload) => getSoftglazeApi().sync.run(payload)
  },
  db: {
    encryptionStatus: () => getSoftglazeApi().db.encryptionStatus(),
    unlock: (password) => getSoftglazeApi().db.unlock(password),
    enableEncryption: (payload) => getSoftglazeApi().db.enableEncryption(payload),
    disableEncryption: (payload) => getSoftglazeApi().db.disableEncryption(payload)
  },
  workspace: {
    backup: (payload) => getSoftglazeApi().workspace.backup(payload),
    restore: (payload) => getSoftglazeApi().workspace.restore(payload)
  },
  license: {
    get: () => getSoftglazeApi().license.get(),
    redeem: (code) => getSoftglazeApi().license.redeem(code),
    grant: (payload) => getSoftglazeApi().license.grant(payload),
    extend: (payload) => getSoftglazeApi().license.extend(payload),
    reset: (payload) => getSoftglazeApi().license.reset(payload),
    startTrial: (payload) => getSoftglazeApi().license.startTrial(payload),
    edit: (payload) => getSoftglazeApi().license.edit(payload),
    terminate: (payload) => getSoftglazeApi().license.terminate(payload),
    listOwners: () => getSoftglazeApi().license.listOwners()
  },
  payments: {
    getConfig: () => getSoftglazeApi().payments.getConfig(),
    setConfig: (payload) => getSoftglazeApi().payments.setConfig(payload),
    validate: (payload) => getSoftglazeApi().payments.validate(payload),
    startCheckout: (payload) => getSoftglazeApi().payments.startCheckout(payload),
    pollCheckout: (payload) => getSoftglazeApi().payments.pollCheckout(payload),
    listMethods: () => getSoftglazeApi().payments.listMethods(),
    submitManual: (payload) => getSoftglazeApi().payments.submitManual(payload),
    manualList: () => getSoftglazeApi().payments.manualList(),
    manualResolve: (payload) => getSoftglazeApi().payments.manualResolve(payload)
  },
  billing: {
    getPlans: () => getSoftglazeApi().billing.getPlans(),
    plansAdmin: () => getSoftglazeApi().billing.plansAdmin(),
    savePlan: (payload) => getSoftglazeApi().billing.savePlan(payload),
    deletePlan: (payload) => getSoftglazeApi().billing.deletePlan(payload),
    assignPlan: (payload) => getSoftglazeApi().billing.assignPlan(payload),
    subscribers: () => getSoftglazeApi().billing.subscribers()
  },
  invoices: {
    list: (payload) => getSoftglazeApi().invoices.list(payload),
    create: (payload) => getSoftglazeApi().invoices.create(payload),
    update: (payload) => getSoftglazeApi().invoices.update(payload),
    remove: (payload) => getSoftglazeApi().invoices.remove(payload)
  },
  ipProviders: {
    getAll: () => getSoftglazeApi().ipProviders.getAll(),
    updateCredentials: (payload) => getSoftglazeApi().ipProviders.updateCredentials(payload),
    toggleStatus: (payload) => getSoftglazeApi().ipProviders.toggleStatus(payload)
  },
  monetization: {
    getLinks: () => getSoftglazeApi().monetization.getLinks(),
    setLinks: (payload) => getSoftglazeApi().monetization.setLinks(payload)
  },
  extensions: {
    list: () => getSoftglazeApi().extensions.list(),
    installFromId: (idOrUrl) => getSoftglazeApi().extensions.installFromId(idOrUrl),
    delete: (id) => getSoftglazeApi().extensions.delete(id),
    toggleGlobal: (id, isGlobal) => getSoftglazeApi().extensions.toggleGlobal(id, isGlobal)
  },
  vault: {
    status: () => getSoftglazeApi().vault.status(),
    setPassword: (payload) => getSoftglazeApi().vault.setPassword(payload),
    unlock: (password) => getSoftglazeApi().vault.unlock(password),
    recover: (recoveryCode, password) => getSoftglazeApi().vault.recover(recoveryCode, password),
    lock: () => getSoftglazeApi().vault.lock(),
    disable: (password) => getSoftglazeApi().vault.disable(password),
    setAutoLock: (minutes) => getSoftglazeApi().vault.setAutoLock(minutes)
  },
  account: {
    get: () => getSoftglazeApi().account.get(),
    save: (payload) => getSoftglazeApi().account.save(payload),
    sendOtp: (email) => getSoftglazeApi().account.sendOtp(email),
    verifyOtp: (email, code) => getSoftglazeApi().account.verifyOtp(email, code),
    register: (payload) => getSoftglazeApi().account.register(payload)
  },
  batch: {
    previewProfilesFromSpreadsheet: () => getSoftglazeApi().batch.previewProfilesFromSpreadsheet(),
    commitProfileImport: (token, options) => getSoftglazeApi().batch.commitProfileImport(token, options),
    exportProfiles: () => getSoftglazeApi().batch.exportProfiles(),
    exportProfilesToFile: (options) => getSoftglazeApi().batch.exportProfilesToFile(options),
    onImportProgress: (callback) => getSoftglazeApi().batch.onImportProgress(callback)
  },
  migration: {
    startTransfer: (payload) => getSoftglazeApi().migration.startTransfer(payload),
    onProgress: (callback) => getSoftglazeApi().migration.onProgress(callback)
  },
  automation: {
    getMacros: () => getSoftglazeApi().automation.getMacros(),
    saveMacro: (payload) => getSoftglazeApi().automation.saveMacro(payload),
    deleteMacro: (id) => getSoftglazeApi().automation.deleteMacro(id),
    startWarmer: (payload) => getSoftglazeApi().automation.startWarmer(payload),
    stopWarmer: (payload) => getSoftglazeApi().automation.stopWarmer(payload),
    getHistory: () => getSoftglazeApi().automation.getHistory(),
    runMacro: (payload) => getSoftglazeApi().automation.runMacro(payload),
    controlMacro: (payload) => getSoftglazeApi().automation.controlMacro(payload),
    startRecording: (payload) => getSoftglazeApi().automation.startRecording(payload),
    stopRecording: (payload) => getSoftglazeApi().automation.stopRecording(payload),
    getSchedule: () => getSoftglazeApi().automation.getSchedule(),
    setSchedule: (payload) => getSoftglazeApi().automation.setSchedule(payload),
    runParallel: (payload) => getSoftglazeApi().automation.runParallel(payload),
    pickDataFile: () => getSoftglazeApi().automation.pickDataFile(),
    onWarmerProgress: (callback) => getSoftglazeApi().automation.onWarmerProgress(callback),
    onMacroProgress: (callback) => getSoftglazeApi().automation.onMacroProgress(callback),
    onRunProgress: (callback) => getSoftglazeApi().automation.onRunProgress(callback)
  },
  developerApi: {
    listTokens: () => getSoftglazeApi().developerApi.listTokens(),
    createToken: (payload) => getSoftglazeApi().developerApi.createToken(payload),
    revokeToken: (id) => getSoftglazeApi().developerApi.revokeToken(id),
    serverStatus: () => getSoftglazeApi().developerApi.serverStatus(),
    setServerEnabled: (enabled) => getSoftglazeApi().developerApi.setServerEnabled(enabled)
  }
};