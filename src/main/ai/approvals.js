'use strict';
// Approvals for AI actions, decided inside SoftGlaze and never by the AI app's own setting.
// A pending approval shows as a dialog in the app; it ends as allow-once, allow-hour, deny, or
// timeout (2 minutes, counted as deny). "Allow for 1 hour" stores a grant for that token and
// grant key (a tool, or every page tool on one profile), so the same action is not asked again
// within the hour.
//
// The MCP client times out a request after 60 seconds by default, so the caller waits only part
// of the window inline. If the user answers after the caller gave up, the answer is kept as a
// one-time grant for the same call, and the AI's retry with the same arguments goes through.
//
// Pure: timers, clock and the renderer emitter are injected, so tests drive it directly.
const crypto = require('node:crypto');

const APPROVAL_TIMEOUT_MS = 2 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const LATE_GRANT_MS = 2 * 60 * 1000;
const DECISIONS = Object.freeze(['allow-once', 'allow-hour', 'deny']);

class ApprovalManager {
  constructor(opts = {}) {
    this.timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : APPROVAL_TIMEOUT_MS;
    this.hourMs = Number(opts.hourMs) > 0 ? Number(opts.hourMs) : HOUR_MS;
    this.lateGrantMs = Number(opts.lateGrantMs) > 0 ? Number(opts.lateGrantMs) : LATE_GRANT_MS;
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this.setTimer = typeof opts.setTimer === 'function' ? opts.setTimer : setTimeout;
    this.clearTimer = typeof opts.clearTimer === 'function' ? opts.clearTimer : clearTimeout;
    this.emit = typeof opts.emit === 'function' ? opts.emit : () => {};
    this.pending = new Map(); // id -> approval (with internal fields)
    this.hourGrants = new Map(); // `${tokenId}|${grantKey}` -> expiresAt
    this.lateGrants = new Map(); // `${tokenId}|${fingerprint}` -> expiresAt
  }

  static fingerprint(tool, args) {
    return crypto.createHash('sha256').update(`${tool}\n${stableStringify(args || {})}`).digest('hex').slice(0, 32);
  }

  // The renderer's view of one approval (args already redacted by the caller).
  publicView(a) {
    return {
      id: a.id,
      tokenId: a.tokenId,
      tokenName: a.tokenName,
      memberId: a.memberId,
      memberName: a.memberName,
      clientName: a.clientName,
      tool: a.tool,
      summary: a.summary,
      args: a.args,
      allowHour: a.allowHour,
      createdAt: new Date(a.createdAt).toISOString(),
      expiresAt: new Date(a.expiresAt).toISOString()
    };
  }

  list() {
    return [...this.pending.values()].map((a) => this.publicView(a));
  }

  get(id) {
    const a = this.pending.get(String(id));
    return a ? this.publicView(a) : null;
  }

  pendingCount() {
    return this.pending.size;
  }

  // An approval already pending for this exact call (the AI retried before the user answered).
  findPending(tokenId, fingerprint) {
    for (const a of this.pending.values()) if (a.tokenId === tokenId && a.fingerprint === fingerprint) return a;
    return null;
  }

  // Creates a pending approval. Returns the internal record; `record.promise` resolves with
  // { decision: 'allow-once' | 'allow-hour' | 'deny' | 'timeout' | 'cancelled' }.
  request(input) {
    const now = this.now();
    const id = crypto.randomUUID();
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    const a = {
      id,
      tokenId: input.tokenId,
      tokenName: input.tokenName || 'AI token',
      memberId: input.memberId == null ? null : input.memberId,
      memberName: input.memberName || null,
      clientName: input.clientName || null,
      tool: input.tool,
      summary: input.summary || input.tool,
      args: input.args || {},
      allowHour: input.allowHour !== false,
      grantKey: input.grantKey || input.tool,
      fingerprint: input.fingerprint || null,
      createdAt: now,
      expiresAt: now + this.timeoutMs,
      detached: false,
      promise,
      _resolve: resolve,
      _timer: null
    };
    a._timer = this.setTimer(() => this._finish(a, 'timeout'), this.timeoutMs);
    if (a._timer && typeof a._timer.unref === 'function') a._timer.unref();
    this.pending.set(id, a);
    try { this.emit('ai:approval-requested', this.publicView(a)); } catch (e) { /* renderer gone */ }
    this._changed();
    return a;
  }

  // The user's answer. Returns { ok } (false when the approval already ended).
  respond(id, decision) {
    const a = this.pending.get(String(id));
    if (!a) return { ok: false, reason: 'not-pending' };
    if (!DECISIONS.includes(decision)) throw new Error('Decision must be allow-once, allow-hour or deny.');
    const effective = decision === 'allow-hour' && !a.allowHour ? 'allow-once' : decision;
    this._finish(a, effective);
    return { ok: true, decision: effective };
  }

  _finish(a, decision) {
    if (!this.pending.has(a.id)) return;
    this.pending.delete(a.id);
    if (a._timer) { try { this.clearTimer(a._timer); } catch (e) { /* ignore */ } }
    const now = this.now();
    if (decision === 'allow-hour') this.hourGrants.set(`${a.tokenId}|${a.grantKey}`, now + this.hourMs);
    // Nobody is waiting any more: keep an allow as a one-time grant for the identical retry.
    if (a.detached && (decision === 'allow-once' || decision === 'allow-hour') && a.fingerprint) {
      this.lateGrants.set(`${a.tokenId}|${a.fingerprint}`, now + this.lateGrantMs);
    }
    a._resolve({ decision });
    this._changed();
  }

  hasHourGrant(tokenId, grantKey) {
    const key = `${tokenId}|${grantKey}`;
    const exp = this.hourGrants.get(key);
    if (!exp) return false;
    if (exp <= this.now()) { this.hourGrants.delete(key); return false; }
    return true;
  }

  // One-time: true at most once per late grant.
  consumeLateGrant(tokenId, fingerprint) {
    const key = `${tokenId}|${fingerprint}`;
    const exp = this.lateGrants.get(key);
    if (!exp) return false;
    this.lateGrants.delete(key);
    return exp > this.now();
  }

  // Stop all AI: deny everything pending, forget every grant. Returns how many were denied.
  cancelAll() {
    const all = [...this.pending.values()];
    for (const a of all) this._finish(a, 'cancelled');
    this.hourGrants.clear();
    this.lateGrants.clear();
    return all.length;
  }

  // A revoked token loses its grants and pending approvals.
  forgetToken(tokenId) {
    for (const a of [...this.pending.values()]) if (a.tokenId === tokenId) this._finish(a, 'cancelled');
    for (const key of [...this.hourGrants.keys()]) if (key.startsWith(`${tokenId}|`)) this.hourGrants.delete(key);
    for (const key of [...this.lateGrants.keys()]) if (key.startsWith(`${tokenId}|`)) this.lateGrants.delete(key);
  }

  _changed() {
    try { this.emit('ai:approvals-changed', { pending: this.pending.size }); } catch (e) { /* renderer gone */ }
  }
}

// JSON with sorted keys, so { a, b } and { b, a } fingerprint the same.
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

module.exports = { ApprovalManager, APPROVAL_TIMEOUT_MS, HOUR_MS, DECISIONS, stableStringify };
