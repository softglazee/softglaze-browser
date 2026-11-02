'use strict';
// puppeteer's page.authenticate() is wired per page, so a new tab or popup sends its first request
// before auth and gets a 407 (and looks like a bot). This relay on 127.0.0.1 takes no auth and adds
// Proxy-Authorization upstream (CONNECT and plain HTTP); returns { port, close } like socksRelay.
const net = require('node:net');
const http = require('node:http');

function startHttpAuthRelay({ host, port, username, password }) {
  return new Promise((resolve, reject) => {
    const upstreamHost = String(host);
    const upstreamPort = Number(port);
    const authHeader = 'Basic ' + Buffer.from(`${username || ''}:${password || ''}`, 'utf8').toString('base64');
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
        path: creq.url, // absolute URI - the upstream proxy resolves it
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
