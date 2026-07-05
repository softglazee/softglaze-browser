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
// Hard ceiling on a single response body. The sync envelope is an encrypted blob whose
// real size is bounded by the workspace data; capping it stops a hostile/broken server
// from streaming unbounded bytes into memory (OOM).
const MAX_RESPONSE_BYTES = 512 * 1024 * 1024;

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
      // Never send the bucket Bearer token in cleartext over http:// (except to a local dev
      // endpoint) — it would be sniffable end-to-end and grants full read/write of the store.
      const host = String(u.hostname || '').replace(/^\[|\]$/g, '');
      const isLocal = host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || host === 'localhost';
      if (u.protocol === 'http:' && this.token && !isLocal) {
        return reject(new Error('Refusing to send the sync auth token over an unencrypted http:// endpoint — use https.'));
      }
      const lib = u.protocol === 'http:' ? http : https;
      const headers = { 'Content-Type': 'application/octet-stream' };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      if (body) headers['Content-Length'] = Buffer.byteLength(body);

      const req = lib.request(u, { method, headers, timeout: this.timeoutMs }, (res) => {
        const chunks = [];
        let total = 0;
        let overflowed = false;
        res.on('data', (c) => {
          if (overflowed) return;
          total += c.length;
          if (total > MAX_RESPONSE_BYTES) {
            overflowed = true;
            req.destroy();
            return reject(new Error('Sync response exceeded the maximum allowed size.'));
          }
          chunks.push(c);
        });
        res.on('end', () => {
          if (overflowed) return;
          const status = res.statusCode || 0;
          const buf = Buffer.concat(chunks);
          // 404 = "no such object" ONLY for a read. A PUT that 404s is a real failure (bad
          // path / server error) and must NOT be reported as success, or the upload
          // silently no-ops and the data is lost.
          if (status === 404 && method === 'GET') return resolve({ status, body: null });
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
