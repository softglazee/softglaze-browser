'use strict';
// The loopback fallback of one-click sign-in (RFC 8252 section 7.3): a one-shot HTTP listener on 127.0.0.1
// with a random port that receives the sign-in result when the softglaze:// protocol is not registered (an
// unpacked dev run) or did not open the app. It accepts only GET /auth with this sign-in's own state; anything
// else gets 404 or 400 and the listener keeps waiting, so a stray local request cannot end the sign-in. It
// closes after the result, on close(), or after timeoutMs.
const http = require('node:http');
const { readResult, sameState } = require('./oneClickAuth');

const PAGE = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}main{max-width:420px}h1{font-size:20px;margin:0 0 8px}p{margin:0;opacity:.75}</style>
</head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
const DONE = PAGE('You can close this tab', 'Go back to SoftGlaze Browser to finish signing in. / Vuelve a SoftGlaze Browser para terminar.');
const STOPPED = PAGE('Sign-in stopped', 'Go back to SoftGlaze Browser and try again. / Vuelve a SoftGlaze Browser e inténtalo de nuevo.');

function send(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'Referrer-Policy': 'no-referrer'
  });
  res.end(html);
}

// -> Promise<{ port, redirectUri, result: Promise<{ code, state } | { error, state }>, close() }>.
// `result` rejects with an Error whose code is 'SIGNIN_TIMEOUT' or 'SIGNIN_CANCELLED'.
function startLoopback({ expectState, timeoutMs = 10 * 60000, host = '127.0.0.1' } = {}) {
  return new Promise((resolveStart, rejectStart) => {
    let settle;
    const result = new Promise((resolve, reject) => { settle = { resolve, reject }; });
    result.catch(() => {}); // the caller may never look at it after close()
    let done = false;
    let timer = null;
    const server = http.createServer((req, res) => {
      if (done || req.method !== 'GET') return send(res, 404, STOPPED);
      let url;
      try { url = new URL(req.url, `http://${host}`); } catch (_) { return send(res, 400, STOPPED); }
      if (url.pathname !== '/auth') return send(res, 404, STOPPED);
      const r = readResult(url.searchParams);
      if (!r || !sameState(r.state, expectState)) return send(res, 400, STOPPED);
      done = true;
      send(res, 200, r.error ? STOPPED : DONE);
      finish();
      settle.resolve(r);
    });
    function finish() {
      if (timer) clearTimeout(timer);
      timer = null;
      server.close();
      // Keep-alive sockets would hold the port open after close().
      if (typeof server.closeAllConnections === 'function') setImmediate(() => server.closeAllConnections());
    }
    server.on('error', (e) => { if (!done) { done = true; rejectStart(e); } });
    server.listen(0, host, () => {
      const { port } = server.address();
      timer = setTimeout(() => {
        if (done) return;
        done = true;
        finish();
        settle.reject(Object.assign(new Error('The sign-in took too long.'), { code: 'SIGNIN_TIMEOUT' }));
      }, timeoutMs);
      if (timer.unref) timer.unref();
      resolveStart({
        port,
        redirectUri: `http://127.0.0.1:${port}/auth`,
        result,
        close() {
          if (done) return;
          done = true;
          finish();
          settle.reject(Object.assign(new Error('The sign-in was cancelled.'), { code: 'SIGNIN_CANCELLED' }));
        }
      });
    });
  });
}

module.exports = { startLoopback };
