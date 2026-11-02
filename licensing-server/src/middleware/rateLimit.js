'use strict';
// In-memory fixed-window limiter per server instance, keyed by client IP.
// Multi-instance deployments need a shared store (Redis).
function rateLimit({ windowMs = 60000, max = 120 } = {}) {
  const hits = new Map();
  return function limiter(req, res, next) {
    const now = Date.now();
    const key = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    let rec = hits.get(key);
    if (!rec || now - rec.start >= windowMs) { rec = { start: now, count: 0 }; hits.set(key, rec); }
    rec.count += 1;
    if (rec.count > max) {
      res.set('Retry-After', String(Math.ceil((rec.start + windowMs - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests.' });
    }
    if (hits.size > 5000) { for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k); }
    next();
  };
}

module.exports = { rateLimit };
