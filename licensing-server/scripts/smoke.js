'use strict';
// Smoke test against a RUNNING licensing server (no DB/secrets needed locally).
//   BASE=http://localhost:8787 node scripts/smoke.js [tenantId]
// Checks /health, and if a tenantId is given, exercises /v1/register + /v1/license.
const http = require('node:http');
const https = require('node:https');

const BASE = (process.env.BASE || 'http://localhost:8787').replace(/\/+$/, '');

function req(method, path, body) {
  const url = new URL(BASE + path);
  const lib = url.protocol === 'http:' ? http : https;
  const payload = body ? Buffer.from(JSON.stringify(body)) : null;
  const headers = body ? { 'content-type': 'application/json', 'content-length': payload.length } : {};
  return new Promise((resolve, reject) => {
    const r = lib.request({ method, hostname: url.hostname, port: url.port, path: url.pathname, headers }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; });
      res.on('end', () => { let j = null; try { j = d ? JSON.parse(d) : null; } catch (_) {} resolve({ status: res.statusCode, json: j }); });
    });
    r.on('error', reject);
    r.setTimeout(10000, () => r.destroy(new Error('timed out')));
    if (payload) r.write(payload);
    r.end();
  });
}

(async () => {
  const h = await req('GET', '/health');
  console.log('GET /health →', h.status, JSON.stringify(h.json));
  if (h.status !== 200) { console.error('health check failed'); process.exit(1); }

  const tenantId = process.argv[2];
  if (!tenantId) { console.log('Pass a tenantId to also exercise /v1/register + /v1/license.'); return; }

  const reg = await req('POST', '/v1/register', { tenantId, machineId: 'smoke-machine' });
  console.log('POST /v1/register →', reg.status, JSON.stringify(reg.json));
  const installId = reg.json && reg.json.installId;
  if (installId) {
    const lic = await req('POST', '/v1/license', { tenantId, installId });
    console.log('POST /v1/license →', lic.status, JSON.stringify(lic.json));
  }
  console.log('\nSmoke OK.');
})().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
