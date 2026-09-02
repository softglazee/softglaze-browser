'use strict';
// ---------------------------------------------------------------------------
// Local HTTP(S) proxy auth-injecting relay (sibling of socksRelay.js).
//
// Chromium CAN answer an authenticated HTTP proxy's 407 via puppeteer's
// page.authenticate() — but that handler is registered PER PAGE and only after a
// tab object exists. A browser-opened "+" tab (or a window.open / target=_blank
// popup) fires its FIRST request through the upstream proxy BEFORE authenticate()
// is wired, so the upstream answers 407: the tab stalls and the bare, unauthenticated
// request looks highly suspicious to bot-detection (e.g. Google's /sorry CAPTCHA).
//
// Fix (mirrors the SOCKS5 relay): run a tiny forward proxy on 127.0.0.1 that accepts
// NO auth from Chromium and injects `Proxy-Authorization` on every hop to the upstream
// proxy. Chromium points --proxy-server at http://127.0.0.1:<port> (auth-free), so it
// never sees a challenge on ANY tab and the new-tab proxy-auth race is gone.
//
// Handles CONNECT tunnels (HTTPS / any TLS — the common case) and plain-HTTP
// absolute-URI forwarding. Returns { port, close } — the same shape as socksRelay,
// so the browserEngine session teardown closes either kind identically.
// ---------------------------------------------------------------------------
const net = require('node:net');
const http = require('node:http');

function startHttpAuthRelay({ host, port, username, password, clientSecret }) {
  return new Promise((resolve, reject) => {
    const upstreamHost = String(host);
    const upstreamPort = Number(port);
    const authHeader = 'Basic ' + Buffer.from(`${username || ''}:${password || ''}`, 'utf8').toString('base64');
    // audit H-NET1: when a per-launch clientSecret is set, require Chromium to
    // authenticate to THIS relay (validated against every request/CONNECT) so another
    // local process can't use the relay's injected upstream credentials. Chromium
    // provides it via the browser's own proxy-auth (page.authenticate) flow, so this
    // does NOT reach the real upstream as a bare request — the relay always injects
    // upstream auth, preserving the anti-bot-detection guarantee. Verified end-to-end
    // against real Chromium (relay-test.js).
    const expectedClientAuth = clientSecret ? ('Basic ' + Buffer.from(`sg:${clientSecret}`, 'utf8').toString('base64')) : null;
    const clientAuthOk = (h) => !expectedClientAuth || h === expectedClientAuth;
    const open = new Set(); // every live socket, destroyed on close()

    const track = (s) => {
      if (!s) return;
      open.add(s);
      s.once('close', () => open.delete(s));
    };

    const server = http.createServer();
    // Track every inbound client socket (covers both plain-HTTP requests and CONNECT).
    // Defense-in-depth: reject non-loopback peers explicitly (the server binds to
    // 127.0.0.1, but this guards a future bind-address change). This does NOT stop
    // another LOCAL process from using the relay — that needs a per-launch client
    // handshake, deferred because it risks the new-tab proxy-auth flow and needs live
    // proxy testing.
    server.on('connection', (socket) => {
      const ra = socket.remoteAddress;
      if (ra && ra !== '127.0.0.1' && ra !== '::1' && ra !== '::ffff:127.0.0.1') { try { socket.destroy(); } catch (e) {} return; }
      track(socket);
    });

    // Plain HTTP: Chromium sends the absolute-form URI (GET http://site/… HTTP/1.1) to
    // the proxy. Forward it verbatim to the upstream with Proxy-Authorization added.
    server.on('request', (creq, cres) => {
      if (!clientAuthOk(creq.headers['proxy-authorization'])) {
        try { cres.writeHead(407, { 'proxy-authenticate': 'Basic realm="SoftGlaze"', 'content-length': 0 }); } catch (e) {}
        try { cres.end(); } catch (e) {}
        return;
      }
      // Strip the client's Proxy-Authorization (our relay secret) and inject the
      // upstream's — never forward the relay secret upstream.
      const fwdHeaders = { ...creq.headers };
      delete fwdHeaders['proxy-authorization'];
      fwdHeaders['Proxy-Authorization'] = authHeader;
      const upstreamReq = http.request({
        host: upstreamHost,
        port: upstreamPort,
        method: creq.method,
        path: creq.url, // absolute URI — the upstream proxy resolves it
        headers: fwdHeaders
      });
      upstreamReq.on('socket', (s) => track(s));
      upstreamReq.on('error', () => {
        try { if (!cres.headersSent) cres.writeHead(502); } catch (e) {}
        try { cres.end(); } catch (e) {}
      });
      upstreamReq.on('response', (ures) => {
        try { cres.writeHead(ures.statusCode || 502, ures.headers); } catch (e) {}
        ures.pipe(cres);
      });
      creq.on('error', () => { try { upstreamReq.destroy(); } catch (e) {} });
      creq.pipe(upstreamReq);
    });

    // CONNECT tunnel (HTTPS and anything else). Open a raw socket to the upstream proxy,
    // issue our own CONNECT with Proxy-Authorization, and on its 2xx reply splice the two.
    server.on('connect', (creq, clientSocket, head) => {
      clientSocket.on('error', () => { try { clientSocket.destroy(); } catch (e) {} });
      if (!clientAuthOk(creq.headers['proxy-authorization'])) {
        try { clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="SoftGlaze"\r\nContent-Length: 0\r\n\r\n'); } catch (e) {}
        try { clientSocket.destroy(); } catch (e) {}
        return;
      }
      const upstream = net.connect(upstreamPort, upstreamHost);
      track(upstream);
      upstream.setTimeout(20000, () => { try { upstream.destroy(); } catch (e) {} });
      upstream.on('error', () => { try { clientSocket.destroy(); } catch (e) {} });
      upstream.on('connect', () => {
        upstream.setTimeout(0);
        upstream.write(
          `CONNECT ${creq.url} HTTP/1.1\r\n` +
          `Host: ${creq.url}\r\n` +
          `Proxy-Authorization: ${authHeader}\r\n` +
          `\r\n`
        );
      });
      // Buffer the upstream's CONNECT reply until the header terminator, then splice.
      let ubuf = Buffer.alloc(0);
      const onData = (chunk) => {
        ubuf = Buffer.concat([ubuf, chunk]);
        const end = ubuf.indexOf('\r\n\r\n');
        if (end === -1) {
          if (ubuf.length > 65536) { try { upstream.destroy(); } catch (e) {} } // runaway header
          return;
        }
        upstream.removeListener('data', onData);
        const statusLine = ubuf.slice(0, ubuf.indexOf('\r\n')).toString('latin1');
        const established = /^HTTP\/1\.[01]\s+2\d\d\b/.test(statusLine);
        if (!established) {
          try { clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch (e) {}
          try { clientSocket.destroy(); } catch (e) {}
          try { upstream.destroy(); } catch (e) {}
          return;
        }
        try { clientSocket.write('HTTP/1.1 200 Connection established\r\n\r\n'); } catch (e) {}
        const leftover = ubuf.slice(end + 4); // bytes after the reply belong to the tunnel
        if (leftover.length) { try { clientSocket.write(leftover); } catch (e) {} }
        if (head && head.length) { try { upstream.write(head); } catch (e) {} }
        clientSocket.on('error', () => { try { upstream.destroy(); } catch (e) {} });
        upstream.on('error', () => { try { clientSocket.destroy(); } catch (e) {} });
        clientSocket.pipe(upstream);
        upstream.pipe(clientSocket);
      };
      upstream.on('data', onData);
    });

    server.on('clientError', (err, socket) => { try { socket.destroy(); } catch (e) {} });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        close: () => {
          try { server.close(); } catch (e) {}
          for (const s of open) { try { s.destroy(); } catch (e) {} }
          open.clear();
        }
      });
    });
  });
}

module.exports = { startHttpAuthRelay };
