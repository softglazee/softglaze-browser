'use strict';
// Minimal HTTPS JSON/form helper shared by the payment provider adapters.
// Resolves { status, json, text }; a string body is sent verbatim, an object is
// JSON-encoded.
const https = require('node:https');

function httpsRequest(method, url, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const h = { ...headers };
    if (payload != null && h['Content-Length'] == null) h['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request({ method, hostname: u.hostname, path: u.pathname + u.search, headers: h }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch (e) { /* non-JSON */ }
        resolve({ status: res.statusCode, json, text: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Payment gateway request timed out.')));
    if (payload != null) req.write(payload);
    req.end();
  });
}

module.exports = { httpsRequest };
