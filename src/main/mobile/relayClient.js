'use strict';
// WebSocket client of the SoftGlaze relay (docs/RELAY.md and PROTOCOL.md section 12 in the
// SoftGlaze-Mobile repository). The relay only routes: every envelope is end to end encrypted
// before it gets here. This class knows the outer JSON frames only.
//
//   connect -> challenge -> auth (Ed25519 over host + nonce + mailbox + role) -> ready
//   send {id, to, env, push?} -> ack {id, status: delivered | queued | rejected}
//   msg {qid, from, env, ticket?} -> handler, then got {qid} (pairing messages use qid 'pair')
//
// Reconnects with jittered exponential back-off. Close codes: 4001 auth failed, 4002 replaced by
// a newer socket of the same mailbox, 4003 revoked by the relay admin (no fast retry for these).
const { EventEmitter } = require('node:events');
const { P } = require('./protocol');

const ACK_TIMEOUT_MS = 10_000;
const PING_EVERY_MS = 25_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;
const SLOW_CLOSE_CODES = new Set([4001, 4002, 4003]);

class RelayClient extends EventEmitter {
  // opts: { url, host, identity, WebSocketImpl?, role?, ackTimeoutMs?, pingMs?, backoffMinMs?,
  //         backoffMaxMs?, random?, setTimer?, clearTimer?, log? }
  constructor(opts) {
    super();
    this.url = opts.url;
    this.host = opts.host;
    this.identity = opts.identity;
    this.role = opts.role || 'pc';
    this.WebSocketImpl = opts.WebSocketImpl || require('ws');
    this.ackTimeoutMs = opts.ackTimeoutMs || ACK_TIMEOUT_MS;
    this.pingMs = opts.pingMs || PING_EVERY_MS;
    this.backoffMinMs = opts.backoffMinMs || BACKOFF_MIN_MS;
    this.backoffMaxMs = opts.backoffMaxMs || BACKOFF_MAX_MS;
    this.random = opts.random || Math.random;
    this.log = opts.log || (() => {});
    this.ws = null;
    this.state = 'idle'; // idle | connecting | authenticating | ready | stopped
    this.attempt = 0;
    this.stopped = true;
    this.n = 0;
    this.pendingAcks = new Map(); // id -> { resolve, timer }
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.lastError = null;
    this.queuedOnReady = 0;
  }

  get ready() { return this.state === 'ready'; }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this._connect();
  }

  // Closes for good (no reconnect). `bye` tells the relay the PC goes to sleep or quits on purpose,
  // so phones do not get a "PC offline" push.
  stop(byeReason = null) {
    this.stopped = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (byeReason && this.ready) { try { this._write({ t: 'bye', reason: byeReason }); } catch (e) { /* closing */ } }
    this._teardown(1000, 'stop');
    this.state = 'stopped';
    this.emit('state', this.status());
  }

  status() {
    return { state: this.state, url: this.url, attempt: this.attempt, lastError: this.lastError, queued: this.queuedOnReady };
  }

  _connect() {
    if (this.stopped) return;
    this.state = 'connecting';
    this.emit('state', this.status());
    let ws;
    try {
      ws = new this.WebSocketImpl(this.url);
    } catch (e) {
      this.lastError = e && e.message ? e.message : String(e);
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;
    const on = (ev, fn) => (typeof ws.on === 'function' ? ws.on(ev, fn) : ws.addEventListener(ev, fn));
    on('message', (data) => this._onFrame(ws, typeof data === 'object' && data && 'data' in data && !Buffer.isBuffer(data) ? data.data : data));
    on('close', (code) => this._onClose(ws, typeof code === 'object' && code ? code.code : code));
    on('error', (err) => { this.lastError = err && err.message ? err.message : 'connection error'; });
  }

  _onFrame(ws, data) {
    if (ws !== this.ws) return;
    let f;
    try { f = JSON.parse(String(data)); } catch (e) { return; }
    if (!f || typeof f.t !== 'string') return;
    switch (f.t) {
      case 'challenge': {
        this.state = 'authenticating';
        try {
          this._write(P.buildAuthFrame(this.identity, f.nonce, this.role, this.host));
        } catch (e) {
          this.lastError = e.message;
          this._teardown(1000, 'auth');
        }
        return;
      }
      case 'ready':
        this.state = 'ready';
        this.attempt = 0;
        this.lastError = null;
        this.queuedOnReady = Number(f.queued) || 0;
        this._startPing();
        this.emit('state', this.status());
        this.emit('ready', { queued: this.queuedOnReady });
        return;
      case 'ack': {
        const p = this.pendingAcks.get(f.id);
        if (p) { this.pendingAcks.delete(f.id); clearTimeout(p.timer); p.resolve({ status: f.status, reason: f.reason || null }); }
        return;
      }
      case 'msg': {
        // The handler runs first; the ack after it (an envelope the PC never handled comes again on
        // the next connect). Pairing messages are not queued by the relay and take no ack.
        try { this.emit('msg', f); } catch (e) { /* a failing handler must not block the ack */ }
        if (f.qid && f.qid !== 'pair' && f.qid !== 'live') this._safeWrite({ t: 'got', qid: f.qid });
        return;
      }
      case 'error':
        this.lastError = f.code || 'error';
        this.emit('relay-error', f);
        return;
      case 'linked':
      case 'revoked':
      case 'presence':
        this.emit(f.t, f);
        return;
      default:
    }
  }

  _onClose(ws, code) {
    if (ws !== this.ws) return;
    this._clearPing();
    this.ws = null;
    for (const [, p] of this.pendingAcks) { clearTimeout(p.timer); p.resolve({ status: 'rejected', reason: 'disconnected' }); }
    this.pendingAcks.clear();
    const wasReady = this.state === 'ready';
    if (code === 4001) this.lastError = 'auth_failed';
    if (code === 4003) this.lastError = 'revoked';
    if (this.stopped) { this.state = 'stopped'; return; }
    this.state = 'idle';
    this.emit('state', this.status());
    if (wasReady) this.emit('disconnected', { code });
    this._scheduleReconnect(SLOW_CLOSE_CODES.has(Number(code)));
  }

  _scheduleReconnect(slow = false) {
    if (this.stopped || this.reconnectTimer) return;
    const exp = Math.min(this.backoffMaxMs, this.backoffMinMs * 2 ** Math.min(this.attempt, 16));
    const base = slow ? this.backoffMaxMs : exp;
    const delay = Math.round(base * (0.5 + this.random() * 0.5));
    this.attempt++;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this._connect(); }, delay);
    if (this.reconnectTimer.unref) this.reconnectTimer.unref();
  }

  // Reconnect at once (network came back, PC woke up).
  reconnectNow() {
    if (this.stopped) return;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) return;
    this.attempt = 0;
    this._connect();
  }

  _startPing() {
    this._clearPing();
    this.pingTimer = setInterval(() => this._safeWrite({ t: 'ping' }), this.pingMs);
    if (this.pingTimer.unref) this.pingTimer.unref();
  }

  _clearPing() { if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; } }

  _teardown(code, reason) {
    this._clearPing();
    const ws = this.ws;
    this.ws = null;
    for (const [, p] of this.pendingAcks) { clearTimeout(p.timer); p.resolve({ status: 'rejected', reason: 'disconnected' }); }
    this.pendingAcks.clear();
    if (ws) { try { ws.close(code, reason); } catch (e) { /* already closed */ } }
  }

  _write(frame) {
    if (!this.ws) throw new Error('Not connected to the relay.');
    this.ws.send(JSON.stringify(frame));
  }

  _safeWrite(frame) {
    try { this._write(frame); return true; } catch (e) { return false; }
  }

  _nextId() {
    this.n = (this.n + 1) % 1e9;
    return `c${this.n}`;
  }

  _withAck(frame) {
    if (!this.ready) return Promise.resolve({ status: 'rejected', reason: 'offline' });
    const id = this._nextId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pendingAcks.delete(id); resolve({ status: 'rejected', reason: 'timeout' }); }, this.ackTimeoutMs);
      if (timer.unref) timer.unref();
      this.pendingAcks.set(id, { resolve, timer });
      if (!this._safeWrite({ ...frame, id })) { clearTimeout(timer); this.pendingAcks.delete(id); resolve({ status: 'rejected', reason: 'offline' }); }
    });
  }

  // envelope: Uint8Array. push: 'alert' | 'approval' | 'security' (only for sealed envelopes: the
  // relay hands the envelope to APNs/FCM as an opaque blob when the phone is offline).
  sendEnvelope(to, envelope, push = null) {
    const frame = { t: 'send', to, env: P.toBase64Url(envelope) };
    if (push && push !== 'none') frame.push = push;
    return this._withAck(frame);
  }

  pairOpen(ticket, ttlMs) { return this.ready ? this._safeWrite({ t: 'pair_open', ticket, ttlMs: Math.max(1000, Math.min(300_000, Math.floor(ttlMs))) }) : false; }
  pairClose(ticket) { return this.ready ? this._safeWrite({ t: 'pair_close', ticket }) : false; }
  pairReply(to, ticket, envelope) { return this._withAck({ t: 'pair_reply', to, ticket, env: P.toBase64Url(envelope) }); }
  link(peer) { return this.ready ? this._safeWrite({ t: 'link', peer }) : false; }
  unlink(peer) { return this.ready ? this._safeWrite({ t: 'unlink', peer }) : false; }
  presenceSub(peers) { return this.ready && peers.length ? this._safeWrite({ t: 'presence_sub', peers: peers.slice(0, 50) }) : false; }
}

module.exports = { RelayClient, ACK_TIMEOUT_MS, PING_EVERY_MS };
