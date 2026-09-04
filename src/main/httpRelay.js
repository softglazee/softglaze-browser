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

function startHttpAuthRelay({ host, port, username, password }, opts = {}) {
  // How long to wait for the upstream's CONNECT REPLY before giving up. Exposed so
  // tests can exercise the timeout without waiting the full production value.
  const replyTimeoutMs = Number(opts.replyTimeoutMs) > 0 ? Number(opts.replyTimeoutMs) : 20000;
  return new Promise((resolve, reject) => {
    const upstreamHost = String(host);
    const upstreamPort = Number(port);
    const authHeader = 'Basic ' + Buffer.from(`${username || ''}:${password || ''}`, 'utf8').toString('base64');
    const CRLF = String.fromCharCode(13, 10);
    const open = new Set(); // every live socket, destroyed on close()

    const track = (s) => {
      if (!s) return;
      open.add(s);
      s.once('close', () => open.delete(s));
    };

    const server = http.createServer();
    // Track every inbound client socket (covers both plain-HTTP requests and CONNECT).
    server.on('connection', (socket) => track(socket));

    // Plain HTTP: Chromium sends the absolute-form URI (GET http://site/… HTTP/1.1) to
    // the proxy. Forward it verbatim to the upstream with Proxy-Authorization added.
    server.on('request', (creq, cres) => {
      const upstreamReq = http.request({
        host: upstreamHost,
        port: upstreamPort,
        method: creq.method,
        path: creq.url, // absolute URI — the upstream proxy resolves it
        headers: { ...creq.headers, 'Proxy-Authorization': authHeader }
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
      const upstream = net.connect(upstreamPort, upstreamHost);
      track(upstream);
      // The idle timeout must stay armed until the CONNECT REPLY has been read, not
      // just until the TCP connect completes. Clearing it in the 'connect' handler
      // (setTimeout(0) below used to run here) left an upstream that accepted the
      // socket and then never answered hanging FOREVER: the relay held the tunnel
      // open, the tab waited on a reply that never came, and the request only died
      // when Chromium's own timer gave up — surfacing as ERR_TIMED_OUT on a proxy
      // that is otherwise reachable. Failing fast instead lets Chromium retry.
      upstream.setTimeout(replyTimeoutMs, () => {
        try { clientSocket.write('HTTP/1.1 504 Gateway Timeout\r\n\r\n'); } catch (e) {}
        try { upstream.destroy(); } catch (e) {}
        try { clientSocket.destroy(); } catch (e) {}
      });
      upstream.on('error', () => { try { clientSocket.destroy(); } catch (e) {} });
      upstream.on('connect', () => {
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
          if (ubuf.length > 65536) { // runaway header — refuse rather than buffer forever
            try { clientSocket.write('HTTP/1.1 502 Bad Gateway' + CRLF + CRLF); } catch (e) {}
            try { upstream.destroy(); } catch (e) {}
            try { clientSocket.destroy(); } catch (e) {}
          }
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
        // Tunnel is live — the reply timer has done its job, and long-lived idle
        // traffic (a websocket, a hanging GET) must not be killed by it.
        upstream.setTimeout(0);
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
