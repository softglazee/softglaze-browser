'use strict';
// The phone <-> app bridge: what a paired phone may see and do. Transport-free: the companion
// service hands it opened (already decrypted, fresh, not replayed) messages and gives it a send().
//
// For every command: protocol scope (checkScope) -> the phone's member (active, resolved like an AI
// token's member) -> the app's own role, ProfileAccess and plan checks (the handlers run inside
// host.runAs, so requirePermission / assertCanAccessProfile see the phone's member) -> exactly one
// ActivityLog row -> one `result`.
//
// Outgoing: hello, state.snapshot / state.patch (profiles the member may see, with status), and
// approval_request for AI approvals the member may answer (sealed, push 'approval'), and the same
// approval_request with `resolution` when it ends (sealed, silent push 'update').
const { P, wireProfileId, parseWireProfileId } = require('./protocol');
const { sanitizeFrame } = require('../remoteRelay');

const DECISION_MAP = Object.freeze({ allow_once: 'allow-once', allow_1h: 'allow-hour', deny: 'deny' });
// ApprovalManager decision -> approval_request.resolution (protocol, optional since 20 Nov 2026).
const RESOLUTION_OF = Object.freeze({ 'allow-once': 'approved', 'allow-hour': 'approved', deny: 'denied', cancelled: 'denied', timeout: 'expired' });
// Plaintext limit of one envelope is 32 KiB; stay well under it per message.
const MAX_STATE_BYTES = 24_000;
const PUBLISH_DEBOUNCE_MS = 400;

function truncate(s, n) {
  const t = String(s == null ? '' : s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

// Arguments shown on the phone: redacted again (sanitizeFrame), small (each value 300 chars, 20 keys).
function phoneArgs(args) {
  const clean = sanitizeFrame(args && typeof args === 'object' ? args : {});
  const out = {};
  for (const [k, v] of Object.entries(clean).slice(0, 20)) {
    const key = truncate(k, 64);
    if (v == null || typeof v === 'number' || typeof v === 'boolean') out[key] = v;
    else if (typeof v === 'string') out[key] = truncate(v, 300);
    else out[key] = truncate(JSON.stringify(v), 300);
  }
  return out;
}

// One ProfileSummary for the phone (schema: messages.ts ProfileSummarySchema).
function summaryOf(p) {
  const s = { id: wireProfileId(p.id), title: truncate(p.title || `Profile ${p.id}`, 200), status: p.status || 'stopped' };
  if (p.group) s.group = truncate(p.group, 200);
  if (Array.isArray(p.tags) && p.tags.length) s.tags = p.tags.slice(0, 50).map((t) => truncate(t, 60));
  if (p.proxyCountry && /^[A-Z]{2}$/.test(p.proxyCountry)) s.proxyCountry = p.proxyCountry;
  if (p.member) s.member = truncate(p.member, 200);
  if (p.lastUsedAt) { const t = Date.parse(p.lastUsedAt); if (Number.isFinite(t) && t > 0) s.lastUsedAt = t; }
  if (p.leaseHolder) s.leaseHolder = truncate(p.leaseHolder, 200);
  return s;
}

function sizeOf(x) { return Buffer.byteLength(JSON.stringify(x), 'utf8'); }

// Splits summaries into chunks that fit one envelope.
function chunkSummaries(list, budget = MAX_STATE_BYTES) {
  const chunks = [];
  let cur = [];
  let size = 0;
  for (const s of list) {
    const n = sizeOf(s) + 1;
    if (cur.length && (size + n > budget || cur.length >= 4000)) { chunks.push(cur); cur = []; size = 0; }
    cur.push(s);
    size += n;
  }
  chunks.push(cur);
  return chunks;
}

class MobileBridge {
  // opts: { host, send(device, message, { push, liveOnly }) -> Promise<boolean>, isLive(device) -> bool,
  //         devices() -> Promise<device[]>, now?, log? }
  constructor(opts) {
    this.host = opts.host;
    this.send = opts.send;
    this.isLive = opts.isLive;
    this.devices = opts.devices;
    this.now = opts.now || Date.now;
    this.log = opts.log || (() => {});
    this.state = new Map(); // deviceId -> { rev, profiles: Map(wireId -> json), approvals }
    this.publishTimer = null;
    this.publishing = null;
    // Approvals sent to devices, so their end reaches the same devices: approvalId -> { view, deviceIds }
    this.approvalTargets = new Map();
    this.endedApprovals = new Map(); // approvalId -> resolution (recent ones, for a send that raced the end)
  }

  // ---- member of a phone ----
  // { ok, memberId, member } or { ok: false, message }. memberId null = single-user mode (owner);
  // a phone paired before the workspace had members acts as the first Owner, like an AI token.
  async memberOf(device) {
    const r = await this.host.resolveMember(device.memberId);
    if (!r || !r.ok) return { ok: false, message: (r && r.message) || 'The member this phone acts as cannot be used.' };
    return r;
  }

  // ---- hello + state ----
  helloFor(device) {
    return P.createMessage('hello', {
      device: { name: truncate(this.host.pcName(), 200), platform: this.host.platform, appVersion: truncate(this.host.appVersion, 40) },
      protocol: { min: P.MIN_SUPPORTED_VERSION, max: P.PROTOCOL_VERSION },
      deviceId: device.deviceId,
      scopes: [...device.scopes]
    });
  }

  async _viewOf(device) {
    const who = await this.memberOf(device);
    if (!who.ok) return null;
    return this.host.runAs(device, who, async () => {
      const profiles = await this.host.listProfiles();
      const approvals = this.host.approvals.list().filter((a) => this.host.canAnswerApproval(who.member, a)).length;
      return { profiles: profiles.map(summaryOf), approvals };
    });
  }

  // Full state for one phone: one snapshot, then patches when it does not fit one envelope.
  async sendSnapshot(device) {
    if (!device.scopes.includes('view')) return false;
    const view = await this._viewOf(device);
    if (!view) return false;
    const chunks = chunkSummaries(view.profiles);
    const st = this.state.get(device.deviceId) || { rev: 0 };
    let rev = st.rev + 1;
    await this.send(device, P.createMessage('state.snapshot', {
      rev, pcName: truncate(this.host.pcName(), 200), profiles: chunks[0], alerts: { open: 0 }, approvals: { pending: view.approvals }
    }), { liveOnly: true });
    for (const chunk of chunks.slice(1)) {
      await this.send(device, P.createMessage('state.patch', { rev: rev + 1, baseRev: rev, upsert: chunk }), { liveOnly: true });
      rev += 1;
    }
    this.state.set(device.deviceId, { rev, profiles: new Map(view.profiles.map((s) => [s.id, JSON.stringify(s)])), approvals: view.approvals });
    return true;
  }

  // Changes since the last state sent to this phone, as patches.
  async sendPatch(device) {
    const st = this.state.get(device.deviceId);
    if (!st) return this.sendSnapshot(device);
    const view = await this._viewOf(device);
    if (!view) return false;
    const next = new Map(view.profiles.map((s) => [s.id, JSON.stringify(s)]));
    const upsert = view.profiles.filter((s) => st.profiles.get(s.id) !== next.get(s.id));
    const remove = [...st.profiles.keys()].filter((id) => !next.has(id));
    const approvalsChanged = view.approvals !== st.approvals;
    if (!upsert.length && !remove.length && !approvalsChanged) return false;
    const chunks = upsert.length ? chunkSummaries(upsert) : [[]];
    let rev = st.rev;
    for (let i = 0; i < chunks.length; i++) {
      const body = { rev: rev + 1, baseRev: rev };
      if (chunks[i].length) body.upsert = chunks[i];
      if (i === 0 && remove.length) body.remove = remove.slice(0, 5000);
      if (i === 0 && approvalsChanged) body.approvals = { pending: view.approvals };
      await this.send(device, P.createMessage('state.patch', body), { liveOnly: true });
      rev += 1;
    }
    this.state.set(device.deviceId, { rev, profiles: next, approvals: view.approvals });
    return true;
  }

  forget(deviceId) { this.state.delete(deviceId); }

  // Something changed on the PC (a profile started, stopped, crashed, was edited; an approval came
  // or went). Debounced; phones without a live session get the full state when they reconnect.
  schedulePublish() {
    if (this.publishTimer) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      this.publishing = this.publishNow().catch((e) => this.log('publish failed', e && e.message));
    }, PUBLISH_DEBOUNCE_MS);
    if (this.publishTimer.unref) this.publishTimer.unref();
  }

  async publishNow() {
    for (const d of await this.devices()) {
      if (!d.scopes.includes('view') || !this.isLive(d)) continue;
      try { await this.sendPatch(d); } catch (e) { this.log('patch failed', e && e.message); }
    }
  }

  dispose() { if (this.publishTimer) { clearTimeout(this.publishTimer); this.publishTimer = null; } }

  // ---- approvals ----
  // end: { resolution: 'approved' | 'denied' | 'expired', at } for an approval that is no longer
  // pending. expiresAt is then the end time, so a phone without `resolution` shows it as expired.
  approvalMessage(view, end = null) {
    const body = {
      approvalId: view.id,
      tool: truncate(view.tool, 200),
      summary: truncate(view.summary || view.tool, 2000),
      args: phoneArgs(view.args),
      allowHour: view.allowHour !== false,
      expiresAt: end ? end.at : Date.parse(view.expiresAt) || this.now() + 120_000
    };
    if (end) body.resolution = end.resolution;
    if (view.clientName) body.clientName = truncate(view.clientName, 200);
    if (view.memberName) body.memberName = truncate(view.memberName, 200);
    // The member the AI token acts as and the token's name ("Requested by <tokenName>" on the phone).
    if (view.memberId != null) body.tokenMemberId = String(view.memberId);
    if (view.tokenName) body.tokenName = truncate(view.tokenName, 200);
    return P.createMessage('approval_request', body);
  }

  // Every approval still pending that this phone may answer (state.request, new session).
  async sendPendingApprovals(device) {
    if (!device.scopes.includes('approve_ai')) return 0;
    const who = await this.memberOf(device);
    if (!who.ok) return 0;
    let n = 0;
    for (const view of this.host.approvals.list()) {
      if (!this.host.canAnswerApproval(who.member, view)) continue;
      this._target(view, device.deviceId);
      try { if (await this.send(device, this.approvalMessage(view), {})) n++; } catch (e) { this.log('approval resend failed', e && e.message); }
    }
    return n;
  }

  _target(view, deviceId) {
    let t = this.approvalTargets.get(view.id);
    if (!t) this.approvalTargets.set(view.id, (t = { view, deviceIds: new Set() }));
    t.deviceIds.add(deviceId);
  }

  // The approval ended (ApprovalManager 'ai:approval-resolved': answered on the PC, the web app, a
  // phone, or timed out / cancelled). Every device that got it gets the end, sealed with the silent
  // push 'update', so the phone removes the notification even in the background.
  async onApprovalResolved({ id, decision } = {}) {
    if (!id) return [];
    const resolution = RESOLUTION_OF[decision] || 'expired';
    this.endedApprovals.set(id, resolution);
    while (this.endedApprovals.size > 200) this.endedApprovals.delete(this.endedApprovals.keys().next().value);
    return this._sendEnd(id, resolution);
  }

  async _sendEnd(id, resolution) {
    const t = this.approvalTargets.get(id);
    if (!t) return [];
    this.approvalTargets.delete(id);
    const msg = this.approvalMessage(t.view, { resolution, at: this.now() });
    const sent = [];
    for (const d of await this.devices()) {
      if (!t.deviceIds.has(d.deviceId)) continue;
      try { if (await this.send(d, msg, { push: 'update' })) sent.push(d.deviceId); } catch (e) { this.log('approval end send failed', e && e.message); }
    }
    return sent;
  }

  // A new AI approval: every phone with approve_ai whose member may answer it gets it, sealed, with
  // push 'approval' (the relay pushes the sealed blob when the phone is offline).
  async onApprovalRequested(view) {
    const sent = [];
    for (const d of await this.devices()) {
      if (!d.scopes.includes('approve_ai')) continue;
      const who = await this.memberOf(d);
      if (!who.ok || !this.host.canAnswerApproval(who.member, view)) continue;
      this._target(view, d.deviceId);
      try {
        if (await this.send(d, this.approvalMessage(view), { push: 'approval' })) sent.push(d.deviceId);
      } catch (e) { this.log('approval send failed', e && e.message); }
    }
    // Answered (or cancelled) while it was still being sent: the late devices get the end too.
    const ended = this.endedApprovals.get(view.id);
    if (ended) await this._sendEnd(view.id, ended);
    this.schedulePublish();
    return sent;
  }

  // ---- inbound ----
  async handleMessage(device, msg) {
    if (msg.type === 'hello') {
      if (msg.body && msg.body.device && msg.body.device.appVersion && msg.body.device.appVersion !== device.appVersion) {
        await this.host.updateDevice(device.deviceId, { appVersion: msg.body.device.appVersion }).catch(() => {});
      }
      return null;
    }
    if (msg.type === 'result' || msg.type === 'revoke') return null; // revoke is handled by the service
    const scope = P.checkScope(device.scopes, msg);
    if (msg.type !== 'command') {
      // lease over the live session is not used by this desktop (profile sync uses the relay
      // blob lease); state, alert and approval_request never come from a phone.
      const code = scope.allowed ? 'unsupported' : 'forbidden';
      return this._finish(device, msg, null, { ok: false, code, message: scope.allowed ? 'Not supported by this PC yet.' : 'This phone may not do that.' }, { name: msg.type });
    }
    const cmd = msg.body;
    if (!scope.allowed) {
      return this._finish(device, msg, null, { ok: false, code: 'forbidden', message: 'This phone does not have that permission. Change it on the PC in Settings > Phones.' }, cmd);
    }
    const who = await this.memberOf(device);
    if (!who.ok) return this._finish(device, msg, null, { ok: false, code: 'forbidden', message: who.message }, cmd);
    let outcome;
    try {
      outcome = await this.host.runAs(device, who, () => this._run(device, who, cmd));
    } catch (e) {
      outcome = { ok: false, code: e && e.code === 'FORBIDDEN' ? 'forbidden' : 'error', message: truncate(e && e.message ? e.message : 'Failed.', 200) };
    }
    return this._finish(device, msg, who, outcome, cmd);
  }

  async _run(device, who, cmd) {
    switch (cmd.name) {
      case 'state.request':
        await this.sendSnapshot(device);
        await this.sendPendingApprovals(device);
        return { ok: true, code: 'ok' };
      case 'profile.start':
      case 'profile.stop':
      case 'profile.restart':
        // Free plan (1.0.27): phones and the web app view profiles and answer AI requests; opening and stopping
        // is part of Pro. 'limit' tells the client to show its upgrade line.
        if (typeof this.host.remoteControlAllowed === 'function' && !(await this.host.remoteControlAllowed())) {
          return { ok: false, code: 'limit', message: 'Upgrade to Pro to open profiles from your phone.' };
        }
        return this._profiles(cmd);
      case 'approval.answer': {
        const approval = this.host.approvals.get(cmd.approvalId);
        if (!approval) return { ok: false, code: 'expired', message: 'This request was already answered or has expired.' };
        if (!this.host.canAnswerApproval(who.member, approval)) return { ok: false, code: 'forbidden', message: 'You can answer only requests from AI tokens that act as you.' };
        const r = this.host.approvals.respond(cmd.approvalId, DECISION_MAP[cmd.decision]);
        if (!r || !r.ok) return { ok: false, code: 'expired', message: 'This request was already answered or has expired.' };
        this.schedulePublish();
        return { ok: true, code: 'ok', data: { decision: r.decision } };
      }
      case 'team.request':
      case 'team.decide':
      case 'totp.request':
        return { ok: false, code: 'unsupported', message: 'Update SoftGlaze on your PC to use this from the phone.' };
      default:
        return { ok: false, code: 'invalid' };
    }
  }

  async _profiles(cmd) {
    const results = [];
    for (const wid of cmd.profileIds) {
      const id = parseWireProfileId(wid);
      if (!id) { results.push({ id: wid, ok: false, code: 'not_found' }); continue; }
      try {
        if (cmd.name === 'profile.stop' || cmd.name === 'profile.restart') await this.host.stopProfile(id);
        if (cmd.name === 'profile.start' || cmd.name === 'profile.restart') await this.host.startProfile(id);
        results.push({ id: wid, ok: true, code: 'ok' });
      } catch (e) {
        const code = e && e.code === 'FORBIDDEN' ? 'forbidden' : e && e.code === 'IN_USE' ? 'in_use' : /not found/i.test(String(e && e.message)) ? 'not_found' : 'error';
        results.push({ id: wid, ok: false, code, message: truncate(e && e.message ? e.message : 'Failed.', 200) });
      }
    }
    this.schedulePublish();
    const okCount = results.filter((r) => r.ok).length;
    if (okCount === results.length) return { ok: true, code: 'ok', data: { results } };
    const codes = new Set(results.filter((r) => !r.ok).map((r) => r.code));
    const code = okCount === 0 && codes.size === 1 ? [...codes][0] : 'error';
    const failed = results.find((r) => !r.ok);
    return { ok: false, code, message: truncate(failed.message || `${results.length - okCount} of ${results.length} failed.`, 200), data: { results } };
  }

  // Exactly one ActivityLog row per command, then one result.
  async _finish(device, msg, who, outcome, cmd) {
    const name = cmd && cmd.name ? cmd.name : msg.type;
    const detail = { source: 'mobile', deviceId: device.deviceId, device: device.name, command: name, code: outcome.code };
    if (cmd && Array.isArray(cmd.profileIds)) detail.profileIds = cmd.profileIds.map(parseWireProfileId).filter(Boolean).slice(0, 50);
    if (cmd && cmd.approvalId) detail.approvalId = cmd.approvalId;
    if (cmd && cmd.decision) detail.decision = cmd.decision;
    const single = detail.profileIds && detail.profileIds.length === 1 ? detail.profileIds[0] : 0;
    try {
      await this.host.logActivity({ device, memberId: who && who.ok ? who.memberId : device.memberId, action: `mobile.${name}`, profileId: single, detail });
    } catch (e) { /* the log must not block the answer */ }
    const body = { re: msg.id, ok: Boolean(outcome.ok), code: outcome.code || (outcome.ok ? 'ok' : 'error') };
    if (outcome.message) body.message = truncate(outcome.message, 200);
    if (outcome.data) body.data = outcome.data;
    const result = P.createMessage('result', body);
    await this.send(device, result, {});
    return result;
  }
}

module.exports = { MobileBridge, summaryOf, chunkSummaries, phoneArgs, DECISION_MAP };
