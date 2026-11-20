'use strict';
// A bridge host for tests: profiles in memory, the real ApprovalManager and the real
// canAnswerApproval rule, members in a map. runAs records which member acted.
const { ApprovalManager } = require('../../src/main/ai/approvals');
const { canAnswerApproval } = require('../../src/main/ai/ipc');

function createTestHost({ members = [], profiles = [] } = {}) {
  const memberMap = new Map(members.map((m) => [m.id, { status: 'active', ...m }]));
  const state = {
    profiles: new Map(profiles.map((p) => [p.id, { status: 'stopped', ...p }])),
    activity: [],
    actedAs: [],
    approvalEvents: []
  };
  let currentMember = undefined;
  const approvals = new ApprovalManager({ emit: (ch, data) => state.approvalEvents.push({ ch, data }) });
  const host = {
    state,
    approvalsManager: approvals,
    pcName: () => 'OFFICE-PC',
    platform: 'windows',
    appVersion: '1.0.27',
    async resolveMember(memberId) {
      if (memberId == null) {
        if (!memberMap.size) return { ok: true, memberId: null, member: null };
        const owner = [...memberMap.values()].find((m) => m.role === 'OWNER');
        return owner ? { ok: true, memberId: owner.id, member: owner } : { ok: false, message: 'No owner.' };
      }
      const m = memberMap.get(Number(memberId));
      if (!m) return { ok: false, message: 'The member this phone acts as no longer exists.' };
      if (m.status !== 'active') return { ok: false, message: `The member this phone acts as is ${m.status}.` };
      return { ok: true, memberId: m.id, member: m };
    },
    async runAs(device, who, fn) {
      const prev = currentMember;
      currentMember = who.member;
      state.actedAs.push(who.memberId);
      try { return await fn(); } finally { currentMember = prev; }
    },
    // Profiles the acting member may see: owner/assigned member, or everything for OWNER/ADMIN.
    async listProfiles() {
      const m = currentMember;
      return [...state.profiles.values()].filter((p) => !m || ['OWNER', 'ADMIN'].includes(m.role) || p.memberId === m.id);
    },
    async startProfile(id) {
      const p = state.profiles.get(id);
      if (!p) throw new Error('Profile not found.');
      const m = currentMember;
      if (m && !['OWNER', 'ADMIN'].includes(m.role) && p.memberId !== m.id) { const e = new Error('You do not have access to this profile.'); e.code = 'FORBIDDEN'; throw e; }
      p.status = 'running';
    },
    async stopProfile(id) {
      const p = state.profiles.get(id);
      if (!p) throw new Error('Profile not found.');
      p.status = 'stopped';
    },
    approvals: {
      list: () => approvals.list(),
      get: (id) => approvals.get(id),
      respond: (id, decision) => approvals.respond(id, decision)
    },
    canAnswerApproval,
    async logActivity(entry) { state.activity.push(entry); }
  };
  return host;
}

// The desktop side of profile sync for tests: profile rows, cookie jars and the sealed sidecar in
// memory, same contract as the host ipcHandlers builds (src/main/mobile/sync/local.js).
function createTestSyncHost({ profiles = [] } = {}) {
  const rows = new Map(profiles.map((p) => [p.id, { region: {}, tags: [], startUrls: [], updatedAt: Date.now(), ...p }]));
  const jars = new Map();
  const sidecars = new Map();
  const snapshots = new Map();
  let idMap = {};
  let nextId = 100;
  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  return {
    rows, jars, sidecars, snapshots,
    proxyPassword: new Set(),
    async readProfile(id) { return clone(rows.get(Number(id)) || null); },
    async writeProfile(id, patch) {
      const r = rows.get(Number(id));
      if (!r) throw new Error('Profile not found.');
      const { region, startUrls, ...rest } = patch;
      Object.assign(r, rest);
      if (region) r.region = { ...r.region, ...region };
      // The desktop normalises start pages (adds https://), like normalizeStartupUrls.
      if (startUrls) r.startUrls = startUrls.map((u) => (/^[a-z]+:\/\//i.test(u) ? u : `https://${u}`));
      r.updatedAt = Date.now();
    },
    async createProfile({ title }) { const id = nextId++; rows.set(id, { id, title, region: {}, tags: [], startUrls: [], updatedAt: Date.now() }); return id; },
    async exportCookies(id) { return clone(jars.get(Number(id)) || []); },
    async replaceCookies(id, params) {
      // What Chromium stores for CDP params: domain from the url for host-only cookies.
      jars.set(Number(id), params.map((p) => ({ name: p.name, value: p.value, domain: p.domain || new URL(p.url).hostname, path: p.path, expires: p.expires || -1, session: !p.expires, secure: p.secure, httpOnly: p.httpOnly, sameSite: p.sameSite })));
    },
    async snapshotCookies(syncId, cookies) { snapshots.set(syncId, clone(cookies)); },
    async readSidecar(syncId) { return clone(sidecars.get(syncId) || null); },
    async writeSidecar(syncId, obj) { sidecars.set(syncId, clone(obj)); },
    async readIdMap() { return clone(idMap); },
    async writeIdMap(map) { idMap = clone(map); },
    async syncProxyPassword(id) { return this.proxyPassword.has(Number(id)); }
  };
}

module.exports = { createTestHost, createTestSyncHost };
