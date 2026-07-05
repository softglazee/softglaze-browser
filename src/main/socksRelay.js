'use strict';
// ---------------------------------------------------------------------------
// Local SOCKS5 auth-injecting relay.
//
// audit: Chromium has NO SOCKS proxy-authentication support — `--proxy-server=
// socks5://…` carries no credentials and puppeteer's page.authenticate() only
// answers HTTP 407 challenges, so an authenticated SOCKS5 proxy silently fails to
// connect (every request errors, nothing surfaced to the user).
//
// Fix: run a tiny SOCKS5 server on 127.0.0.1 that accepts NO-AUTH from Chromium and
// forwards each CONNECT to the upstream SOCKS5 proxy using username/password auth.
// Chromium then points --proxy-server at socks5://127.0.0.1:<port> (auth-free), and
// the target hostname is forwarded verbatim so DNS still resolves proxy-side
// (remote DNS — no leak). Only CONNECT is supported (all Chromium needs).
// ---------------------------------------------------------------------------
const net = require('node:net');

// SOCKS5 reply codes.
const REP_OK = 0x00;
const REP_GENERAL_FAIL = 0x01;
const REP_CMD_NOT_SUPPORTED = 0x07;
const REP_ATYP_NOT_SUPPORTED = 0x08;

function socksReply(rep) {
  // VER, REP, RSV, ATYP=IPv4, BND.ADDR=0.0.0.0, BND.PORT=0
  return Buffer.from([0x05, rep, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
}

// Byte length of the ATYP+ADDR+PORT portion starting at offset `off` in `buf`, or
// -1 if not enough bytes have arrived yet, or 0 for an unsupported ATYP.
function addrSpecLength(buf, off) {
  if (buf.length < off + 1) return -1;
  const atyp = buf[off];
  if (atyp === 0x01) return (buf.length >= off + 1 + 4 + 2) ? 1 + 4 + 2 : -1;       // IPv4
  if (atyp === 0x04) return (buf.length >= off + 1 + 16 + 2) ? 1 + 16 + 2 : -1;     // IPv6
  if (atyp === 0x03) {                                                              // domain
    if (buf.length < off + 2) return -1;
    const len = buf[off + 1];
    return (buf.length >= off + 2 + len + 2) ? 2 + len + 2 : -1;
  }
  return 0; // unsupported ATYP
}

// Start the relay for one upstream proxy. Resolves with { port, close }.
function startSocksAuthRelay({ host, port, username, password }) {
  return new Promise((resolve, reject) => {
    const upstreamHost = String(host);
    const upstreamPort = Number(port);
    const user = Buffer.from(String(username || ''), 'utf8');
    const pass = Buffer.from(String(password || ''), 'utf8');
    const open = new Set(); // every live socket, destroyed on close()

    const server = net.createServer((client) => {
      open.add(client);
      client.once('close', () => open.delete(client));
      client.on('error', () => { try { client.destroy(); } catch (e) {} });
      handleClient(client);
    });

    function handleClient(client) {
      let buf = Buffer.alloc(0);
      let stage = 'greeting'; // greeting -> request -> piping
      let upstream = null;

      const onData = (chunk) => { buf = Buffer.concat([buf, chunk]); pump(); };
      client.on('data', onData);

      const failClient = (rep) => {
        try { client.write(socksReply(rep)); } catch (e) {}
        try { client.destroy(); } catch (e) {}
        if (upstream) { try { upstream.destroy(); } catch (e) {} }
      };

      function pump() {
        if (stage === 'greeting') {
          if (buf.length < 2) return;
          if (buf[0] !== 0x05) { try { client.destroy(); } catch (e) {} return; }
          const nMethods = buf[1];
          if (buf.length < 2 + nMethods) return;
          buf = buf.slice(2 + nMethods);
          client.write(Buffer.from([0x05, 0x00])); // select NO-AUTH
          stage = 'request';
          if (buf.length) pump();
          return;
        }
        if (stage === 'request') {
          if (buf.length < 4) return;
          if (buf[0] !== 0x05) { try { client.destroy(); } catch (e) {} return; }
          const cmd = buf[1];
          const specLen = addrSpecLength(buf, 3);
          if (specLen === -1) return;                // wait for more bytes
          if (specLen === 0) return failClient(REP_ATYP_NOT_SUPPORTED);
          const targetSpec = buf.slice(3, 3 + specLen); // ATYP + ADDR + PORT (forwarded verbatim)
          const leftover = buf.slice(3 + specLen);       // any pipelined client bytes
          stage = 'piping';
          client.removeListener('data', onData);
          if (cmd !== 0x01) return failClient(REP_CMD_NOT_SUPPORTED); // CONNECT only
          connectUpstream(targetSpec, leftover);
          return;
        }
      }

      function connectUpstream(targetSpec, leftover) {
        upstream = net.connect(upstreamPort, upstreamHost);
        open.add(upstream);
        upstream.once('close', () => open.delete(upstream));
        let ubuf = Buffer.alloc(0);
        let ustage = 'method'; // method -> auth -> reply -> piping
        upstream.setTimeout(20000, () => { try { upstream.destroy(); } catch (e) {} });
        upstream.on('error', () => failClient(REP_GENERAL_FAIL));
        upstream.on('connect', () => {
          upstream.setTimeout(0);
          upstream.write(Buffer.from([0x05, 0x01, 0x02])); // offer username/password auth
        });
        const onUData = (chunk) => { ubuf = Buffer.concat([ubuf, chunk]); upump(); };
        upstream.on('data', onUData);

        function sendConnect() {
          // VER, CMD=CONNECT, RSV, then the client's ATYP+ADDR+PORT verbatim.
          upstream.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), targetSpec]));
        }

        function upump() {
          if (ustage === 'method') {
            if (ubuf.length < 2) return;
            if (ubuf[0] !== 0x05) return failClient(REP_GENERAL_FAIL);
            const method = ubuf[1];
            ubuf = ubuf.slice(2);
            if (method === 0x02) {
              const auth = Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]);
              upstream.write(auth);
              ustage = 'auth';
            } else if (method === 0x00) {
              sendConnect();
              ustage = 'reply';
            } else {
              return failClient(REP_GENERAL_FAIL); // upstream demands an unsupported method
            }
            if (ubuf.length) upump();
            return;
          }
          if (ustage === 'auth') {
            if (ubuf.length < 2) return;
            if (ubuf[1] !== 0x00) return failClient(REP_GENERAL_FAIL); // auth rejected
            ubuf = ubuf.slice(2);
            sendConnect();
            ustage = 'reply';
            if (ubuf.length) upump();
            return;
          }
          if (ustage === 'reply') {
            if (ubuf.length < 4) return;
            const specLen = addrSpecLength(ubuf, 3);
            if (specLen === -1) return; // wait for the full reply
            const end = (specLen === 0) ? ubuf.length : 3 + specLen;
            const reply = ubuf.slice(0, end);
            const extra = ubuf.slice(end);
            ustage = 'piping';
            upstream.removeListener('data', onUData);
            // Forward the upstream's reply verbatim, then splice the two sockets.
            try { client.write(reply); } catch (e) {}
            if (extra.length) { try { client.write(extra); } catch (e) {} }
            if (leftover && leftover.length) { try { upstream.write(leftover); } catch (e) {} }
            client.on('error', () => { try { upstream.destroy(); } catch (e) {} });
            upstream.on('error', () => { try { client.destroy(); } catch (e) {} });
            client.pipe(upstream);
            upstream.pipe(client);
          }
        }
      }
    }

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

module.exports = { startSocksAuthRelay };
