'use strict';
// REST object-store client for cloud sync. The separately hosted server only stores opaque,
// already-encrypted blobs: PUT/GET {baseUrl}/{key} with a Bearer token; GET gives 200 + bytes or 404.
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

const DEFAULT_TIMEOUT_MS = 20000;
// Caps one response body so a hostile or broken server cannot exhaust memory.
const MAX_RESPONSE_BYTES = 512 * 1024 * 1024;

class RestBucketTransport {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || '').trim().replace(/\/+$/, '');
    if (!this.baseUrl) throw new Error('Cloud sync endpoint URL is required.');
    this.token = options.token || '';
    this.timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  }

  // Encode each segment but keep the / separators. encodeURIComponent leaves dots alone, so reject
  // . and .. segments and check the resolved URL stays under baseUrl (no namespace escape).
  _url(key) {
    const segments = String(key).split('/');
    for (const seg of segments) {
      if (seg === '.' || seg === '..') throw new Error('Invalid sync key (path traversal).');
    }
    const url = `${this.baseUrl}/${segments.map(encodeURIComponent).join('/')}`;
    if (url !== this.baseUrl && !url.startsWith(this.baseUrl + '/')) throw new Error('Invalid sync key.');
    return url;
  }

  _request(method, key, body) {
    return new Promise((resolve, reject) => {
      let u;
      try { u = new URL(this._url(key)); } catch (e) { return reject(new Error('Invalid sync endpoint URL.')); }
      // Never send the Bearer token over plain http (except to localhost): it grants full store access.
      const host = String(u.hostname || '').replace(/^\[|\]$/g, '');
      const isLocal = host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || host === 'localhost';
      if (u.protocol === 'http:' && this.token && !isLocal) {
        return reject(new Error('Refusing to send the sync auth token over an unencrypted http:// endpoint - use https.'));
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
          // 404 means "no object" only for GET; a 404 on PUT is a real failure and must not look like success.
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
