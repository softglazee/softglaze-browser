'use strict';
// Audit T2-2 (partial): the Firefox autofill bridge must reject a mismatched Host header,
// so a DNS-rebound web page cannot reach it even if it somehow learned the token.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bridge = require('../src/main/autofillBridge');

test('a request whose Host is not our loopback bind is rejected even with the token', async () => {
  const started = await bridge.start();
  assert.ok(started.port, 'the bridge should bind a loopback port');
  const port = started.port;

  function ping(hostHeader) {
    return new Promise((resolve) => {
      const req = http.request({
        host: '127.0.0.1', port, method: 'GET', path: '/sg-autofill/ping',
        headers: { 'X-SG-Autofill-Token': bridge.TOKEN, Host: hostHeader }
      }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', () => resolve(0));
      req.end();
    });
  }

  try {
    assert.equal(await ping(`127.0.0.1:${port}`), 200, 'the real extension Host must pass');
    assert.equal(await ping('evil.com'), 401, 'a rebound Host must be rejected');
    assert.equal(await ping(`127.0.0.1:${port + 1}`), 401, 'the wrong port must be rejected');
  } finally {
    await bridge.stop();
  }
});
