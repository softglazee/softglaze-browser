'use strict';
// Relay that streams sanitized status/log frames of a running session to a manager portal.
// The WebSocket transport is a stub (attachTransport) until the cloud portal exists.
// Frames are { t: 'status'|'log'|'frame', sessionId, ts, payload }, all passed through sanitizeFrame.
const { EventEmitter } = require('node:events');

// Case-insensitive substring match on key names, so Cookie, Set-Cookie, Authorization, sessionToken
// and capitalized variants are all redacted.
const SECRET_KEY_RE = /pass|secret|token|api[_-]?key|auth|cookie|session|credential|bearer|private|otp|2fa|passphrase/i;
// Binary/image frames (screenshots) can render credentials/PII; never stream raw image data.
const IMAGE_KEY_RE = /^(image|screenshot|thumbnail|jpe?g|png|dataurl|framedata|snapshot)$/i;

// Recursively strips secret-bearing keys and raw images from any outbound payload.
function sanitizeFrame(value, depth = 0) {
  if (depth > 6 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeFrame(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(k)) { out[k] = '••••'; continue; }
      if (IMAGE_KEY_RE.test(k) && typeof v === 'string' && v.length > 256) { out[k] = `[redacted ${v.length}B image]`; continue; }
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

  // A manager portal subscribes to a session's frames; returns an unsubscribe function.
  subscribe(sessionId, fn) {
    const sid = String(sessionId);
    if (!this.subscribers.has(sid)) this.subscribers.set(sid, new Set());
    this.subscribers.get(sid).add(fn);
    return () => { const set = this.subscribers.get(sid); if (set) set.delete(fn); };
  }

  // Sanitized, fanned out to local subscribers and, with a transport, to the portal. Never throws.
  emitFrame(sessionId, type, payload) {
    try {
      const sid = String(sessionId);
      const frame = { t: type, sessionId: sid, ts: Date.now(), payload: sanitizeFrame(payload) };
      const entry = this.sessions.get(sid);
      if (entry) entry.lastFrame = frame;

      const subs = this.subscribers.get(sid);
      if (subs) for (const fn of subs) { try { fn(frame); } catch (_) { /* one bad subscriber must not break the rest */ } }

      if (this.transport && typeof this.transport.broadcast === 'function') {
        try { this.transport.broadcast(sid, frame); } catch (_) { /* transport down - keep local stream alive */ }
      }
      this.emit('frame', frame);
    } catch (_) { /* streaming must never destabilize the session it observes */ }
  }

  // Convenience emitters matching the frame `t` taxonomy.
  status(sessionId, status) { this.emitFrame(sessionId, 'status', { status }); }
  log(sessionId, message, level = 'info') { this.emitFrame(sessionId, 'log', { level, message }); }
  // `frame` would carry a downscaled, base64 JPEG from Page.captureScreenshot.
  visual(sessionId, jpegBase64, dims) { this.emitFrame(sessionId, 'frame', { image: jpegBase64, dims }); }
}

// Singleton - there is one relay per app process.
module.exports = { RemoteRelay, relay: new RemoteRelay(), sanitizeFrame };
