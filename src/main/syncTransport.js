'use strict';
// ---------------------------------------------------------------------------
// Softglaze Enterprise — Cloud sync transport (REST object-store CLIENT).
//
// Talks to an EXTERNAL, SEPARATE server service that you host yourself: a thin
// object store that accepts PUT/GET of opaque blobs by key, authorized with a
// Bearer token. This client only ever sends/receives the already-encrypted sync
// envelope produced by CloudSyncEngine — the server stores opaque ciphertext and
// can never read it (zero-knowledge).
//
// Server contract (host this separately — it is NOT part of this app):
//   PUT {baseUrl}/{key}  Authorization: Bearer <token>  body = opaque bytes  -> 2xx
//   GET {baseUrl}/{key}  Authorization: Bearer <token>                       -> 200 + bytes | 404
//
// Any S3-compatible bucket fronted by such a proxy, or a tiny REST bucket, works.
// ---------------------------------------------------------------------------
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

const DEFAULT_TIMEOUT_MS = 20000;

class RestBucketTransport {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || '').trim().replace(/\/+$/, '');
    if (!this.baseUrl) throw new Error('Cloud sync endpoint URL is required.');
    this.token = options.token || '';
    this.timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  }

  // Encode each path segment but keep the '/' separators (keys look like
  // "namespace/profile.sgz-env").
  _url(key) {
    const safe = String(key).split('/').map(encodeURIComponent).join('/');
    return `${this.baseUrl}/${safe}`;
  }

  _request(method, key, body) {
    return new Promise((resolve, reject) => {
      let u;
      try { u = new URL(this._url(key)); } catch (e) { return reject(new Error('Invalid sync endpoint URL.')); }
      const lib = u.protocol === 'http:' ? http : https;
      const headers = { 'Content-Type': 'application/octet-stream' };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      if (body) headers['Content-Length'] = Buffer.byteLength(body);

      const req = lib.request(u, { method, headers, timeout: this.timeoutMs }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const status = res.statusCode || 0;
          const buf = Buffer.concat(chunks);
          if (status === 404) return resolve({ status, body: null });
          if (status >= 200 && status < 300) return resolve({ status, body: buf });
          reject(new Error(`Sync server responded ${status}${buf.length ? `: ${buf.toString('utf8').slice(0, 200)}` : ''}`));
        });
      });
      req.on('error', (e) => reject(new Error(`Sync transport error: ${(e && e.message) || e}`)));
      req.on('timeout', () => { req.destroy(new Error('Sync request timed out.')); });
      if (body) req.write(body);
      req.end();
    });
  }

  async put(key, buffer) {
    const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer));
    await this._request('PUT', key, body);
    return true;
  }

  async get(key) {
    const res = await this._request('GET', key);
    return res.body; // Buffer on 2xx, null on 404
  }
}

// Build a transport from stored config, or null when not configured (local-only).
function createTransport(config) {
  if (!config || !config.baseUrl) return null;
  return new RestBucketTransport({ baseUrl: config.baseUrl, token: config.token, timeoutMs: config.timeoutMs });
}

module.exports = { RestBucketTransport, createTransport };
