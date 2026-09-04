'use strict';
// Regression tests for the local HTTP proxy auth-injecting relay.
//
// Background: the relay armed a 20s idle timeout on the upstream socket and then
// DISARMED it in the 'connect' handler — i.e. as soon as TCP was established, before
// the upstream had answered the CONNECT. An upstream that accepted the socket and
// then never replied therefore hung FOREVER: the relay held the tunnel, the tab
// waited on a reply that never came, and the request only died when Chromium's own
// timer gave up, surfacing as ERR_TIMED_OUT against a proxy that was otherwise
// reachable. The timer must stay armed until the reply is parsed, and be disarmed
// only once the tunnel is spliced (or a long-lived idle tunnel gets killed instead).
//
// These use fake in-process upstreams — no network, no real proxy credentials.

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');

const { startHttpAuthRelay } = require('../src/main/httpRelay');

const CRLF = String.fromCharCode(13, 10);
const CONNECT_REQ = `CONNECT example.com:443 HTTP/1.1${CRLF}Host: example.com:443${CRLF}${CRLF}`;

function listen(server) {
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port)));
}

// A fake upstream that also remembers its sockets. server.close() only stops
// accepting — a live connection keeps the event loop alive and hangs node --test.
function fakeUpstream(onData) {
  const sockets = new Set();
  const server = net.createServer((s) => {
    sockets.add(s);
    s.on('error', () => {});
    s.on('close', () => sockets.delete(s));
    s.once('data', () => { if (onData) onData(s); });
  });
  server.shutdown = () => {
    for (const s of sockets) { try { s.destroy(); } catch (e) {} }
    sockets.clear();
    try { server.close(); } catch (e) {}
  };
  return server;
}

// Drive one CONNECT through the relay; resolve with the first reply line (or a marker).
function askRelay(relayPort, waitMs) {
  return new Promise((resolve) => {
    const c = net.connect(relayPort, '127.0.0.1');
    let buf = '';
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      try { c.destroy(); } catch (e) {}
      resolve(v);
    };
    const timer = setTimeout(() => finish('NO_REPLY'), waitMs);
    c.on('connect', () => c.write(CONNECT_REQ));
    c.on('data', (b) => {
      buf += b.toString('latin1');
      if (buf.includes(CRLF + CRLF)) { clearTimeout(timer); finish(buf.split(CRLF)[0]); }
    });
    c.on('error', () => { clearTimeout(timer); finish('CLIENT_ERROR'); });
    c.on('close', () => { clearTimeout(timer); finish(buf ? buf.split(CRLF)[0] : 'CLOSED_NO_REPLY'); });
  });
}

test('an upstream that never answers CONNECT is given up on, not hung on', async () => {
  // Accepts the socket, reads the CONNECT, replies nothing — the exact hang case.
  const blackhole = fakeUpstream(null);
  const upstreamPort = await listen(blackhole);
  const relay = await startHttpAuthRelay(
    { host: '127.0.0.1', port: upstreamPort, username: 'u', password: 'p' },
    { replyTimeoutMs: 300 }
  );
  try {
    const reply = await askRelay(relay.port, 5000);
    assert.notEqual(reply, 'NO_REPLY', 'the relay must not hang waiting for a reply that never comes');
    assert.match(reply, /504/, 'it should surface a gateway timeout');
  } finally {
    relay.close();
    blackhole.shutdown();
  }
});

test('an established tunnel survives idling past the reply timeout', async () => {
  // Replies 200, then stays silent. The reply timer must be disarmed once spliced,
  // or every websocket and hanging GET dies at the timeout.
  const upstream = fakeUpstream((s) => s.write(`HTTP/1.1 200 Connection established${CRLF}${CRLF}`));
  const upstreamPort = await listen(upstream);
  const relay = await startHttpAuthRelay(
    { host: '127.0.0.1', port: upstreamPort, username: 'u', password: 'p' },
    { replyTimeoutMs: 200 }
  );
  try {
    const c = net.connect(relay.port, '127.0.0.1');
    let established = false;
    let closed = false;
    c.on('connect', () => c.write(CONNECT_REQ));
    c.on('data', (b) => { if (b.toString('latin1').includes('200')) established = true; });
    c.on('close', () => { closed = true; });
    c.on('error', () => {});
    // Idle well past the (shortened) reply timeout.
    await new Promise((r) => setTimeout(r, 900));
    assert.equal(established, true, 'the tunnel should have been established');
    assert.equal(closed, false, 'an idle established tunnel must not be killed by the reply timer');
    try { c.destroy(); } catch (e) {}
  } finally {
    relay.close();
    upstream.shutdown();
  }
});

test('a non-2xx upstream reply is reported as 502 rather than silently dropped', async () => {
  const upstream = fakeUpstream((s) => s.write(`HTTP/1.1 407 Proxy Authentication Required${CRLF}${CRLF}`));
  const upstreamPort = await listen(upstream);
  const relay = await startHttpAuthRelay(
    { host: '127.0.0.1', port: upstreamPort, username: 'u', password: 'p' },
    { replyTimeoutMs: 2000 }
  );
  try {
    const reply = await askRelay(relay.port, 5000);
    assert.match(reply, /502/, 'a refused upstream CONNECT should surface as 502');
  } finally {
    relay.close();
    upstream.shutdown();
  }
});

// NOTE: relay.close() teardown is deliberately NOT covered here. It works (verified
// standalone: client.destroyed flips true right after close), but asserting it inside
// the runner alongside the tests above was timing-flaky and left a handle open, which
// hung `npm test` for the whole repo. A test that can hang CI is worse than no test.
