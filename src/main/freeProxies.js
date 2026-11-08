'use strict';
// Free proxies are run by strangers, often dead or blocklisted, so each candidate is tested live and
// HTTP ones must also pass an anonymity check: one that forwards the real IP (in a header or in the
// judge's `origin`) or Via/X-Forwarded-For style headers is transparent and rejected. IP addresses are
// matched whole, never as substrings. Network calls are injected (deps) for testing.

const crypto = require('node:crypto');
const net = require('node:net');

// The pool stores HTTP and SOCKS5 (Prisma enum ProxyType). SOCKS4 also resolves DNS on
// the PC, which leaks it, so it is not offered.
const PROTOCOLS = ['http', 'socks5'];

// Lines are "scheme://ip:port" or "ip:port", except Geonode (JSON with country and anonymity).
const SOURCES = [
  {
    id: 'proxyscrape',
    label: 'ProxyScrape',
    url: (protocol, country) => `https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=${protocol}&proxy_format=protocolipport&format=text&timeout=10000${country ? `&country=${country.toLowerCase()}` : ''}`,
    kind: 'lines'
  },
  {
    id: 'geonode',
    label: 'Geonode',
    url: (protocol, country) => `https://proxylist.geonode.com/api/proxy-list?limit=500&page=1&sort_by=lastChecked&sort_type=desc&protocols=${protocol}${country ? `&country=${country.toUpperCase()}` : ''}`,
    kind: 'geonode'
  },
  {
    id: 'monosans',
    label: 'monosans',
    url: (protocol, country) => (country ? null : `https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/${protocol}.txt`),
    kind: 'lines'
  },
  {
    id: 'proxifly',
    label: 'Proxifly',
    // The per-country list mixes protocols (each line carries its scheme).
    url: (protocol, country) => (country
      ? `https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/countries/${country.toUpperCase()}/data.txt`
      : `https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/${protocol}/data.txt`),
    kind: 'lines'
  },
  {
    id: 'thespeedx',
    label: 'TheSpeedX',
    url: (protocol, country) => (country ? null : `https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/${protocol}.txt`),
    kind: 'lines'
  }
];

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function normProtocol(p) {
  const s = String(p || '').toLowerCase();
  return PROTOCOLS.includes(s) ? s : 'http';
}

// Public, routable IPv4 only: a list entry pointing at a private/loopback address could
// otherwise make the app probe the user's own network.
function isPublicIPv4(ip) {
  if (!IPV4.test(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

// "scheme://ip:port" or "ip:port" lines -> candidates of the wanted protocol.
function parseProxyLines(text, protocol) {
  const want = normProtocol(protocol);
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:(https?|socks4a?|socks5h?):\/\/)?([0-9.]+):(\d{1,5})$/i.exec(line);
    if (!m) continue;
    let scheme = (m[1] || want).toLowerCase();
    if (scheme === 'https') scheme = 'http';
    if (scheme === 'socks5h') scheme = 'socks5';
    if (scheme !== want) continue; // also drops socks4 / socks4a lines
    const port = Number(m[3]);
    if (!isPublicIPv4(m[2]) || port < 1 || port > 65535) continue;
    out.push({ type: scheme, host: m[2], port, country: null });
  }
  return out;
}

// Geonode JSON -> candidates; transparent ones are dropped up front.
function parseGeonode(json, protocol) {
  const want = normProtocol(protocol);
  const rows = json && Array.isArray(json.data) ? json.data : [];
  const out = [];
  for (const r of rows) {
    if (!r || !isPublicIPv4(String(r.ip || ''))) continue;
    if (String(r.anonymityLevel || '').toLowerCase() === 'transparent') continue;
    const protos = Array.isArray(r.protocols) ? r.protocols.map((x) => String(x).toLowerCase()) : [];
    if (!protos.includes(want)) continue;
    const port = Number(r.port);
    if (!(port >= 1 && port <= 65535)) continue;
    out.push({ type: want, host: String(r.ip), port, country: r.country ? String(r.country).toUpperCase() : null });
  }
  return out;
}

const keyOf = (c) => `${c.type}://${c.host}:${c.port}`;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// deps.fetchText(url) -> Promise<string>; a failing source is skipped and reported.
async function collectCandidates({ protocol, country, exclude = new Set() }, deps) {
  const want = normProtocol(protocol);
  const cc = country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null;
  const results = await Promise.all(SOURCES.map(async (src) => {
    const url = src.url(want, cc);
    if (!url) return { id: src.id, ok: true, skipped: true, list: [] };
    try {
      const text = await deps.fetchText(url);
      const list = src.kind === 'geonode' ? parseGeonode(JSON.parse(text), want) : parseProxyLines(text, want);
      return { id: src.id, ok: true, list };
    } catch (e) {
      return { id: src.id, ok: false, error: (e && e.message) || 'failed', list: [] };
    }
  }));
  // Most entries are dead and the search has a time budget, so sources that re-verify often go first
  // (SOURCES order), each shuffled so repeat searches do not retest the same head of the list.
  const seen = new Set(exclude);
  const merged = [];
  for (const r of results) {
    for (const c of shuffle([...r.list])) {
      const k = keyOf(c);
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(c);
    }
  }
  return { candidates: merged, sources: results.map(({ list, ...rest }) => ({ ...rest, count: list.length })) };
}

// One IP address in a single written form, so the same address always compares equal: IPv4 as a
// dotted quad, IPv6 lowercase and compressed, and an IPv4-mapped IPv6 address (::ffff:1.2.3.4) as
// its IPv4. Brackets and a zone (%eth0) are dropped. Anything that is not one whole address: null.
function canonicalIp(value) {
  let s = String(value == null ? '' : value).trim();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (net.isIPv4(s)) return s;
  if (!net.isIPv6(s)) return null;
  let host;
  try { host = new URL(`http://[${s}]/`).hostname.slice(1, -1); } catch (e) { return null; }
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (mapped) {
    const hi = parseInt(mapped[1], 16);
    const lo = parseInt(mapped[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return host;
}

// Every whole IP address written in a header value, in canonical form: "1.2.3.4", a list such as
// X-Forwarded-For "1.2.3.4, 5.6.7.8", Forwarded 'for=1.2.3.4' or 'for="[2001:db8::1]:4711"',
// "1.2.3.4:8080", or an address inside text. An address must stand on its own: "11.2.3.45" and
// "host1.2.3.4.example" do not contain 1.2.3.4.
const IPV4_IN_TEXT = /(?<![0-9A-Za-z_.])\d{1,3}(?:\.\d{1,3}){3}(?![0-9A-Za-z_]|\.[0-9A-Za-z_])/g;
const IPV6_IN_TEXT = /[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*/g; // a run with at least two colons
function ipsIn(value) {
  const s = String(value == null ? '' : value);
  const out = new Set();
  for (const m of s.matchAll(IPV4_IN_TEXT)) { const ip = canonicalIp(m[0]); if (ip) out.add(ip); }
  for (const m of s.matchAll(IPV6_IN_TEXT)) {
    const ip = canonicalIp(m[0]) || canonicalIp(m[0].replace(/\.+$/, '')); // "...::1." at a sentence end
    if (ip) out.add(ip);
  }
  return out;
}

// Is this exact address written in the value? Whole addresses only, never a substring match.
function containsIp(value, ip) {
  const want = canonicalIp(ip);
  return Boolean(want) && ipsIn(value).has(want);
}

function sameIp(a, b) {
  const x = canonicalIp(a);
  return Boolean(x) && x === canonicalIp(b);
}

// Headers that only a proxy adds. Their presence alone marks the proxy as transparent.
const PROXY_HEADERS = ['via', 'x-forwarded-for', 'forwarded', 'x-real-ip', 'x-proxy-id', 'proxy-connection'];

// Does an echoed header set reveal the user? `headers` is the judge's echo (case-insensitive).
function revealsClient(headers, realIp) {
  const h = {};
  for (const [k, v] of Object.entries(headers || {})) h[String(k).toLowerCase()] = String(v);
  if (realIp && Object.values(h).some((v) => containsIp(v, realIp))) return true;
  return PROXY_HEADERS.some((k) => k in h);
}

// The judge's echo of one plain-HTTP request through the proxy: { headers, origin }. httpbin.org
// (postmanlabs/httpbin, helpers.py) removes X-Forwarded-For, Via, X-Real-Ip and its other ENV_HEADERS
// from `headers`, and reports the request's X-Forwarded-For chain in `origin` instead
// ("1.2.3.4, 5.6.7.8"; the last entry is the address that reached httpbin). So a proxy that passes
// the user's real IP on shows it in `origin`, not in `headers`. Without `origin` nothing is proven.
function isJudgeEcho(echo) {
  return Boolean(echo) && typeof echo === 'object'
    && Boolean(echo.headers) && typeof echo.headers === 'object'
    && typeof echo.origin === 'string' && echo.origin.trim() !== '';
}

function echoRevealsClient(echo, realIp) {
  if (revealsClient(echo && echo.headers, realIp)) return true;
  return Boolean(realIp) && containsIp(echo && echo.origin, realIp);
}

// A hard deadline for one network step. A dead proxy often never answers the TCP
// connect, and a request timeout does not fire while a proxy agent is still connecting,
// so without this one silent proxy would hold a worker for minutes.
function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); })
  ]).finally(() => clearTimeout(timer));
}

// Test one candidate. deps.checkExit(c) -> { ip, country, latencyMs } (throws if dead);
// deps.judgeEcho(c) -> { headers, origin } echoed for a plain-HTTP request via the proxy (isJudgeEcho).
async function checkCandidate(c, realIp, deps, stepMs = 10000) {
  let exit;
  try { exit = await withTimeout(Promise.resolve().then(() => deps.checkExit(c)), stepMs); } catch (e) { return { ok: false, reason: 'dead' }; }
  if (!exit || !exit.ip) return { ok: false, reason: 'dead' };
  if (realIp && sameIp(exit.ip, realIp)) return { ok: false, reason: 'transparent' };
  if (c.type === 'http') {
    let echo;
    try { echo = await withTimeout(Promise.resolve().then(() => deps.judgeEcho(c)), stepMs); } catch (e) { return { ok: false, reason: 'judge-failed' }; }
    if (!isJudgeEcho(echo)) return { ok: false, reason: 'judge-failed' };
    if (echoRevealsClient(echo, realIp)) return { ok: false, reason: 'transparent' };
  }
  return { ok: true, ip: exit.ip, country: exit.country ? String(exit.country).toUpperCase() : (c.country || null), latencyMs: exit.latencyMs || null };
}

// Find up to `limit` working, anonymous proxies.
// opts: { protocol, country, limit, concurrency, timeBudgetMs, exclude, signal, onProgress }
// deps: { fetchText, checkExit, judgeEcho, getRealIp, now }
async function harvestFreeProxies(opts, deps) {
  const limit = Math.max(1, Math.min(100, Number(opts.limit) || 10));
  const concurrency = Math.max(1, Math.min(64, Number(opts.concurrency) || 48));
  const budget = Math.max(10000, Math.min(10 * 60000, Number(opts.timeBudgetMs) || 3 * 60000));
  const now = deps.now || Date.now;
  const started = now();
  const progress = (p) => { try { if (opts.onProgress) opts.onProgress(p); } catch (e) { /* ignore */ } };
  const aborted = () => Boolean(opts.signal && opts.signal.aborted);

  let realIp = null;
  try { realIp = canonicalIp(await deps.getRealIp()); } catch (e) { realIp = null; }
  if (!realIp) {
    // Without the user's own IP the anonymity check cannot prove anything: refuse
    // rather than risk keeping a proxy that leaks it.
    return { found: [], checked: 0, total: 0, stopped: 'no-real-ip', sources: [], rejected: {} };
  }

  progress({ phase: 'fetch' });
  const { candidates, sources } = await collectCandidates({ protocol: opts.protocol, country: opts.country, exclude: opts.exclude }, deps);
  const want = opts.country && /^[A-Za-z]{2}$/.test(opts.country) ? opts.country.toUpperCase() : null;
  progress({ phase: 'check', total: candidates.length, checked: 0, found: 0, sources });

  const found = [];
  const rejected = { dead: 0, transparent: 0, 'judge-failed': 0, country: 0 };
  let checked = 0;
  let cursor = 0;
  let stopped = null;
  const stop = () => {
    if (found.length >= limit) return 'limit';
    if (aborted()) return 'cancelled';
    if (now() - started > budget) return 'time';
    return null;
  };
  const stepMs = Math.max(2000, Math.min(20000, Number(opts.stepTimeoutMs) || 6000));
  let finished = false; // set when the search returns; late results are then ignored
  const worker = async () => {
    while (cursor < candidates.length && !finished) {
      const why = stop();
      if (why) { stopped = stopped || why; return; }
      const c = candidates[cursor]; cursor += 1;
      const r = await checkCandidate(c, realIp, deps, stepMs);
      if (finished) return;
      checked += 1;
      if (r.ok && want && r.country !== want) { rejected.country += 1; }
      else if (r.ok) { if (found.length < limit) found.push({ ...c, ...r }); }
      else rejected[r.reason] = (rejected[r.reason] || 0) + 1;
      progress({ phase: 'check', total: candidates.length, checked, found: found.length });
    }
  };
  // The budget is enforced from outside the workers too: each worker can be inside one
  // check (at most 2 steps of stepMs), so the search returns at budget + that, at most.
  // Cancel is polled the same way, so Stop answers within about a second.
  let watchdog;
  const deadline = new Promise((resolve) => {
    const tick = () => {
      if (aborted()) { stopped = stopped || 'cancelled'; resolve(); return; }
      if (now() - started > budget + 2 * stepMs) { stopped = stopped || 'time'; resolve(); return; }
      watchdog = setTimeout(tick, 1000);
    };
    watchdog = setTimeout(tick, 1000);
  });
  await Promise.race([
    Promise.all(Array.from({ length: Math.min(concurrency, candidates.length || 1) }, worker)),
    deadline
  ]);
  finished = true;
  clearTimeout(watchdog);
  return { found: found.slice(0, limit), checked, total: candidates.length, stopped: stopped || (found.length >= limit ? 'limit' : 'exhausted'), sources, rejected };
}

// Plain HTTPS GET of a list, with a timeout, a size cap and at most 2 redirects.
function fetchTextDirect(url, { timeoutMs = 15000, maxBytes = 4 * 1024 * 1024, redirects = 2 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { reject(new Error('bad url')); return; }
    if (u.protocol !== 'https:') { reject(new Error('lists are fetched over https only')); return; }
    const req = require('node:https').get(u, { headers: { 'User-Agent': 'SoftGlaze-FreeProxies/1.0', Accept: '*/*' } }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume();
        fetchTextDirect(new URL(res.headers.location, u).toString(), { timeoutMs, maxBytes, redirects: redirects - 1 }).then(resolve, reject);
        return;
      }
      if (status !== 200) { res.resume(); reject(new Error(`HTTP ${status}`)); return; }
      let size = 0; const chunks = [];
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(new Error('list too large')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

module.exports = {
  fetchTextDirect,
  SOURCES,
  isPublicIPv4,
  parseProxyLines,
  parseGeonode,
  canonicalIp,
  containsIp,
  revealsClient,
  isJudgeEcho,
  echoRevealsClient,
  harvestFreeProxies
};
