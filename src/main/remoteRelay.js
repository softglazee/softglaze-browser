'use strict';
// ---------------------------------------------------------------------------
// Softglaze Enterprise — Live Workspace Shadowing / Remote Management Relay
//                        (PROTOCOL FOUNDATION)
//
// Establishes the secure WebSocket relay pipeline that streams a live status log
// (and, later, downscaled visual frames) of an active automation container back
// to a manager portal for remote performance audits — without ever exposing the
// container's raw cookies/credentials over the wire.
//
// What is real here: the relay registry, the framing/serialization of audit
// events, subscription fan-out, and a redaction hook so secrets never stream.
// What is stubbed: the concrete WebSocket server/transport (`attachTransport`) —
// drop in `ws`/socket.io (or Electron's net) when the cloud portal ships.
//
// Frame shape (JSON, one per message):
//   { t: 'status'|'log'|'frame', sessionId, ts, payload }
// All frames pass through `sanitizeFrame` so credential-bearing fields are
// stripped before transmission (defense-in-depth alongside rbacPolicy).
// ---------------------------------------------------------------------------
const { EventEmitter } = require('node:events');

const SECRET_KEYS = new Set(['password', 'username', 'token', 'apiKey', 'secretKey', 'cookies', 'pass']);

// Recursively strip known secret-bearing keys from any outbound payload so a live
// audit stream can never carry raw credentials/cookies to the portal.
function sanitizeFrame(value, depth = 0) {
  if (depth > 6 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeFrame(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEYS.has(k)) { out[k] = '••••'; continue; }
      out[k] = sanitizeFrame(v, depth + 1);
    }
    return out;
  }
  return value;
}

class RemoteRelay extends EventEmitter {
  constructor() {
    super();
    this.transport = null;             // injected WS transport (stub until cloud portal ships)
    this.sessions = new Map();         // sessionId -> { startedAt, lastFrame }
    this.subscribers = new Map();      // sessionId -> Set<fn(frame)>
  }

  // Inject the real WebSocket transport later. Expected shape:
  //   transport.broadcast(sessionId, frame) -> void
  //   transport.onAudit(handler)            -> void   (manager → container control)
  attachTransport(transport) {
    this.transport = transport || null;
    return this;
  }

  registerSession(sessionId, meta = {}) {
    if (!sessionId) return;
    this.sessions.set(String(sessionId), { startedAt: Date.now(), meta, lastFrame: null });
  }

  unregisterSession(sessionId) {
    this.sessions.delete(String(sessionId));
    this.subscribers.delete(String(sessionId));
  }

  // A manager portal subscribes to a session's audit stream. Returns an
  // unsubscribe fn (mirrors the app's other progress-stream subscriptions).
  subscribe(sessionId, fn) {
    const sid = String(sessionId);
    if (!this.subscribers.has(sid)) this.subscribers.set(sid, new Set());
    this.subscribers.get(sid).add(fn);
    return () => { const set = this.subscribers.get(sid); if (set) set.delete(fn); };
  }

  // Emit an audit frame for a session. Sanitized, fanned out to local subscribers,
  // and (when a transport exists) pushed to the remote portal. Never throws.
  emitFrame(sessionId, type, payload) {
    try {
      const sid = String(sessionId);
      const frame = { t: type, sessionId: sid, ts: Date.now(), payload: sanitizeFrame(payload) };
      const entry = this.sessions.get(sid);
      if (entry) entry.lastFrame = frame;

      const subs = this.subscribers.get(sid);
      if (subs) for (const fn of subs) { try { fn(frame); } catch (_) { /* one bad subscriber must not break the rest */ } }

      if (this.transport && typeof this.transport.broadcast === 'function') {
        try { this.transport.broadcast(sid, frame); } catch (_) { /* transport down — keep local stream alive */ }
      }
      this.emit('frame', frame);
    } catch (_) { /* auditing must never destabilize the session it observes */ }
  }

  // Convenience emitters matching the frame `t` taxonomy.
  status(sessionId, status) { this.emitFrame(sessionId, 'status', { status }); }
  log(sessionId, message, level = 'info') { this.emitFrame(sessionId, 'log', { level, message }); }
  // `frame` would carry a downscaled, base64 JPEG from Page.captureScreenshot.
  visual(sessionId, jpegBase64, dims) { this.emitFrame(sessionId, 'frame', { image: jpegBase64, dims }); }
}

// Singleton — there is one relay per app process.
module.exports = { RemoteRelay, relay: new RemoteRelay(), sanitizeFrame };
