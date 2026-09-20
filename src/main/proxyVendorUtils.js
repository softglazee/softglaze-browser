'use strict';
// Pure helpers shared by the proxy vendor adapters in ipcHandlers.js.
//
// They live in their own module because ipcHandlers.js pulls in electron and cannot be
// required from a test. Everything here is plain data in, plain data out, so the tests
// can exercise the real parsing instead of pattern-matching the source.

// Parse one `login:password@host:port` line, as returned by DataImpulse /api/list and by
// Proxy-Seller /proxy/download/resident with a custom template. Returns null for a blank
// line, an error body, or anything that is not a usable endpoint.
function parseLoginLine(raw) {
  // Proxy-Seller's documented export ends each line with ';'.
  const line = String(raw || '').trim().replace(/;+$/, '').trim();
  if (!line || line.startsWith('{') || line.startsWith('[') || line.startsWith('<')) return null;
  // Split at the LAST '@' and the FIRST ':' of the credential half. A password may
  // legitimately contain '@' or ':', and splitting naively is exactly the bug that once
  // parsed user:pass@host:port into host="user" with a NaN port.
  const at = line.lastIndexOf('@');
  if (at < 0) return null;
  const cred = line.slice(0, at);
  const endpoint = line.slice(at + 1);
  const c = cred.indexOf(':');
  const username = c >= 0 ? cred.slice(0, c) : cred;
  const password = c >= 0 ? cred.slice(c + 1) : '';
  // host:port splits at the LAST ':' so a bracketed IPv6 host survives.
  const h = endpoint.lastIndexOf(':');
  if (h < 0) return null;
  let host = endpoint.slice(0, h).trim();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  const portText = endpoint.slice(h + 1).trim();
  if (!/^\d{1,5}$/.test(portText)) return null;
  const port = Number.parseInt(portText, 10);
  if (!host || !username || port < 1 || port > 65535) return null;
  return { host, port, username, password };
}

// Parse a whole list body into unique endpoints, keyed on the identity the proxy pool
// dedupes on (host, port, username). A rotating gateway listed five times is one proxy.
function parseLoginList(text) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const row = parseLoginLine(raw);
    if (!row) continue;
    const key = `${row.host}:${row.port}:${row.username}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

// Normalise a free-text filter into the comma-separated shape the vendor documents, and
// drop any value that cannot be of its kind, so a stray character never becomes a filter
// the vendor silently fails to match.
function csvFilter(value, pattern, max = 50) {
  return String(value || '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s && pattern.test(s))
    .slice(0, max)
    .join(',');
}

const FILTER_PATTERNS = Object.freeze({
  text: /^[\p{L}\p{N} .'()-]{1,80}$/u,
  zip: /^[A-Za-z0-9 -]{2,12}$/,
  asn: /^(AS)?\d{1,10}$/i,
  country: /^[A-Za-z]{2}$/
});

// ASNs may be typed as "AS7922" or "7922"; the vendors take the bare number.
function asnList(value) {
  return csvFilter(value, FILTER_PATTERNS.asn).replace(/AS/gi, '');
}

// Proxy-Seller residential rotation, as documented on list create and change-rotation:
// -1 keeps the exit IP (sticky), 0 changes it on every request, 1..3600 changes it every
// N seconds. Anything else is refused by the API with a not-found error.
function proxySellerRotation(mode, seconds) {
  const m = String(mode || '').toLowerCase();
  if (m === 'sticky') return -1;
  if (m === 'interval') {
    const s = Number.parseInt(String(seconds), 10);
    if (Number.isFinite(s) && s >= 1) return Math.min(3600, s);
    return 60;
  }
  return 0;
}

// Proxy-Seller wraps every JSON response in { status, data, errors }. Business errors come
// back as HTTP 200 with status "error", so the status code alone proves nothing.
function unwrapProxySeller(text, what) {
  let body;
  try {
    body = JSON.parse(String(text));
  } catch (e) {
    throw new Error(`Proxy-Seller ${what}: the API did not return JSON.`);
  }
  if (body && body.status === 'success') return body.data;
  const first = body && Array.isArray(body.errors) && body.errors[0];
  const msg = first && first.message ? String(first.message) : 'request failed';
  if (/error api key/i.test(msg)) throw new Error('Proxy-Seller: the API key was rejected. Copy it again from the dashboard, API section.');
  if (/ip not allowed/i.test(msg)) throw new Error('Proxy-Seller: this API key only accepts calls from whitelisted IPs, and this machine is not one of them. Add its IP in the dashboard API settings.');
  if (/tarif not found/i.test(msg)) throw new Error('Proxy-Seller: this account has no active residential package.');
  if (/request limit/i.test(msg)) throw new Error('Proxy-Seller: the API rate limit was reached. Wait a minute and try again.');
  throw new Error(`Proxy-Seller ${what}: ${msg}`);
}

// Trim the residential geo database (a JSON array of countries, each with regions, each
// with cities) down to what the panel needs, for one country or for the country list.
function proxySellerGeoView(db, country) {
  const list = Array.isArray(db) ? db : [];
  const cc = String(country || '').trim().toUpperCase();
  if (!cc) {
    return list
      .filter((c) => c && c.code)
      .map((c) => ({ key: String(c.code), label: String(c.name || c.code) }));
  }
  const hit = list.find((c) => c && String(c.code).toUpperCase() === cc);
  if (!hit) return [];
  return (Array.isArray(hit.regions) ? hit.regions : [])
    .filter((r) => r && r.name)
    .map((r) => ({
      key: String(r.name),
      label: String(r.name),
      cities: (Array.isArray(r.cities) ? r.cities : [])
        .filter((ct) => ct && ct.name)
        .map((ct) => ({ name: String(ct.name), isps: Array.isArray(ct.isps) ? ct.isps.map(String) : [] }))
    }));
}

// Dual-stack geo lookup used when ipinfo.io and ip-api.com cannot be reached through a
// proxy. Neither of those publishes an AAAA record (checked 15 Sep 2026), so an IPv6-only
// exit cannot reach them at all and a healthy IPv6 proxy used to look dead. get.geojs.io
// answers on both families. Response fields verified live: ip, country_code, region,
// city, timezone, latitude, longitude, organization_name.
const GEOJS_URL = 'https://get.geojs.io/v1/ip/geo.json';
function normalizeGeoJs(j) {
  if (!j || typeof j !== 'object' || !j.ip) return null;
  const num = (v) => { const n = Number.parseFloat(v); return Number.isFinite(n) ? n : null; };
  return {
    ip: String(j.ip),
    country: j.country_code ? String(j.country_code) : null,
    region: j.region ? String(j.region) : null,
    city: j.city ? String(j.city) : null,
    isp: j.organization_name ? String(j.organization_name) : (j.organization ? String(j.organization) : null),
    timezone: j.timezone ? String(j.timezone) : null,
    lat: num(j.latitude),
    lon: num(j.longitude)
  };
}

// Proxy-Seller products that are sold per IP (an order of N addresses), as opposed to the
// residential traffic package. All of them list through GET proxy/list/{type}.
const PROXY_SELLER_ORDER_TYPES = Object.freeze({
  ipv6: 'IPv6', ipv4: 'IPv4', isp: 'ISP', mobile: 'Mobile', mix: 'IPv4 Mix', mix_isp: 'ISP Mix'
});

// Map proxy/list/{type} items to pool rows. Each item is one purchased address with its own
// HTTP and SOCKS5 port on the entry host. Inactive or expired items are skipped, because a
// row that can never connect is worse than no row.
function proxySellerOrderRows(items, { socks = false, label = 'Proxy-Seller' } = {}) {
  const out = [];
  const seen = new Set();
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== 'object') continue;
    const status = String(it.status_type || '').toUpperCase();
    if (status && status !== 'ACTIVE') continue;
    const host = String(it.ip_only || it.ip || '').trim();
    const port = Number.parseInt(String(socks ? it.port_socks : it.port_http), 10);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    const username = it.login ? String(it.login) : null;
    const key = `${host}:${port}:${username || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const where = it.country_alpha3 ? String(it.country_alpha3) : (it.country ? String(it.country) : 'Global');
    out.push({
      type: socks ? 'SOCKS5' : 'HTTP',
      host, port, username,
      password: it.password != null && it.password !== '' ? String(it.password) : null,
      label: `${label} • ${where} • port ${port}`,
      orderId: it.order_id != null ? String(it.order_id) : null,
      expires: it.date_end ? String(it.date_end) : null,
      // Mobile items carry a reboot link that changes the IP; the docs example shows "#"
      // for products without one, so only a real http(s) URL counts.
      rotationUrl: /^https?:\/\//i.test(String(it.link_reboot || '')) ? String(it.link_reboot) : null
    });
  }
  return out;
}

// Summarise GET proxy/list (all types) into what the panel shows: per product, how many
// addresses are active, in which countries, which orders, and the earliest expiry.
function summarizeProxySellerOrders(data) {
  const out = [];
  for (const [key, label] of Object.entries(PROXY_SELLER_ORDER_TYPES)) {
    const items = data && Array.isArray(data[key]) ? data[key] : [];
    if (!items.length) continue;
    const active = items.filter((it) => !it.status_type || String(it.status_type).toUpperCase() === 'ACTIVE');
    const orders = new Map();
    for (const it of active) {
      const id = it.order_id != null ? String(it.order_id) : '';
      if (!id) continue;
      const o = orders.get(id) || { id, number: it.order_number ? String(it.order_number) : id, count: 0, country: it.country_alpha3 ? String(it.country_alpha3) : '', expires: it.date_end ? String(it.date_end) : '' };
      o.count += 1;
      orders.set(id, o);
    }
    const countries = [...new Set(active.map((it) => it.country_alpha3).filter(Boolean).map(String))];
    // date_end is d.m.Y, so sort on Y m d to get the earliest.
    const sortKey = (s) => { const m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(s); return m ? `${m[3]}${m[2]}${m[1]}` : s; };
    const ends = active.map((it) => it.date_end).filter(Boolean).map(String).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    out.push({ key, label, total: items.length, active: active.length, countries, expires: ends[0] || null, orders: [...orders.values()] });
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// IPRoyal residential (resi-api.iproyal.com/v1, OpenAPI spec served at /docs).
// ---------------------------------------------------------------------------------------

// Parse one line of POST /access/generate-proxy-list requested in the
// {hostname}:{port}:{username}:{password} format. Hostnames and usernames carry no ':' and
// the password carries the targeting and sticky session (…_country-us_session-xxxx_lifetime-30m),
// so split on the first three colons and keep the rest as the password.
function parseIpRoyalLine(raw) {
  const line = String(raw || '').trim();
  const parts = line.split(':');
  if (parts.length < 4) return null;
  const host = parts[0].trim();
  const portText = parts[1].trim();
  const username = parts[2];
  const password = parts.slice(3).join(':');
  if (!host || !/^\d{1,5}$/.test(portText) || !username || !password) return null;
  const port = Number.parseInt(portText, 10);
  if (port < 1 || port > 65535) return null;
  const session = /_session-([A-Za-z0-9]+)/.exec(password);
  return { host, port, username, password, session: session ? session[1] : null };
}

// Sticky lifetime as the spec defines it: "{n}s" or "{n}m" with n 1-59, or "{n}h" with n 1-168.
const IPROYAL_LIFETIME = /^(?:(?:[1-9]|[1-5]\d)[sm]|(?:[1-9]|[1-9]\d|1[0-5]\d|16[0-8])h)$/;
function ipRoyalLifetime(value) {
  const v = String(value || '').trim().toLowerCase();
  return IPROYAL_LIFETIME.test(v) ? v : '24h';
}

// Location string for the generate call, e.g. "_country-us_state-iowa_city-desmoines". Codes come
// from GET /access/countries; anything that is not a plain code is dropped rather than sent.
function ipRoyalLocation({ country, state, city } = {}) {
  const code = (v) => String(v || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  const cc = code(country);
  if (!/^[a-z]{2}$/.test(cc)) return '';
  let out = `_country-${cc}`;
  const st = code(state);
  if (st) out += `_state-${st}`;
  const ct = code(city);
  if (ct) out += `_city-${ct}`;
  return out;
}

// Pick the named port for the protocol from GET /access/entry-nodes. The port NAME is what the
// generate call takes ("http", "socks5"), not the number.
function pickIpRoyalPort(nodes, socks) {
  const list = Array.isArray(nodes) ? nodes : [];
  const want = socks ? /socks/i : /^https?$/i;
  for (const node of list) {
    for (const p of (node && Array.isArray(node.ports) ? node.ports : [])) {
      if (p && p.name && want.test(String(p.name))) return { name: String(p.name), port: Number(p.port) || null, dns: node.dns ? String(node.dns) : null };
    }
  }
  return null;
}

// Country list, or one country's states (each with its cities) and top-level cities.
function ipRoyalCountriesView(data, country) {
  const countries = data && Array.isArray(data.countries) ? data.countries : [];
  const opts = (group) => (group && Array.isArray(group.options) ? group.options : [])
    .filter((o) => o && o.code)
    .map((o) => ({ key: String(o.code), label: String(o.name || o.code) }));
  const cc = String(country || '').trim().toLowerCase();
  if (!cc) return { countries: countries.filter((c) => c && c.code).map((c) => ({ key: String(c.code), label: String(c.name || c.code) })) };
  const hit = countries.find((c) => c && String(c.code).toLowerCase() === cc);
  if (!hit) return { states: [], cities: [] };
  const states = (hit.states && Array.isArray(hit.states.options) ? hit.states.options : [])
    .filter((s) => s && s.code)
    .map((s) => ({ key: String(s.code), label: String(s.name || s.code), cities: opts(s.cities) }));
  return { states, cities: opts(hit.cities) };
}

// IPRoyal errors are {"error":{"code","message"}}; 422 adds detailed_messages. The transport
// helper puts the start of the body in its message, so pull the vendor message out of that.
function ipRoyalErrorMessage(text) {
  const s = String(text || '');
  if (/HTTP 401\b/.test(s)) return 'the API token was rejected. Copy it again from the IPRoyal dashboard, Settings, API.';
  if (/HTTP 429\b/.test(s)) return 'the API rate limit was reached. Wait a minute and try again.';
  const m = /"message"\s*:\s*"([^"]+)"/.exec(s);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------------------
// Shared: split a bare "host:port" (IPv6-bracket aware). Used by the Proxidize per-proxy
// parser, whose API returns the endpoint already joined.
// ---------------------------------------------------------------------------------------
function parseHostPort(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const h = s.lastIndexOf(':');
  if (h < 0) return null;
  let host = s.slice(0, h).trim();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  const portText = s.slice(h + 1).trim();
  if (!/^\d{1,5}$/.test(portText)) return null;
  const port = Number.parseInt(portText, 10);
  if (!host || port < 1 || port > 65535) return null;
  return { host, port };
}

// ---------------------------------------------------------------------------------------
// MarsProxies residential (api.marsproxies.com, Bearer token). POST
// /v1/residential/access/generate-proxy-list returns a JSON array of strings, each rendered
// "{hostname}:{port}:{username}:{password}". Location and the sticky session ride in the
// generated string, so each line parses exactly like an IPRoyal line. Sticky lifetime uses
// the same {n}s/{n}m/{n}h rule as IPRoyal (reuse ipRoyalLifetime).
// ---------------------------------------------------------------------------------------

// Underscore-joined location, e.g. "_country-us_state-texas_city-dallas" or "_region-europe".
// Codes come from GET /v1/residential/access/countries|regions; a non-plain token is dropped.
function marsProxiesLocation({ country, state, city, region } = {}) {
  const tok = (v) => String(v || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  const cc = tok(country);
  if (/^[a-z]{2}$/.test(cc)) {
    let out = `_country-${cc}`;
    const st = tok(state);
    if (st) out += `_state-${st}`;
    const ct = tok(city);
    if (ct) out += `_city-${ct}`;
    return out;
  }
  const rg = tok(region);
  return rg ? `_region-${rg}` : '';
}

// Parse the JSON string-array from generate-proxy-list into unique endpoints. Reuses
// parseIpRoyalLine because MarsProxies renders the same "host:port:user:pass" colon form.
function parseMarsProxiesList(text) {
  let arr;
  try { arr = JSON.parse(String(text)); } catch (e) { return []; }
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const line of arr) {
    const row = parseIpRoyalLine(line);
    if (!row) continue;
    const key = `${row.host}:${row.port}:${row.username}:${row.password}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// NodeMaven (gateway gate.nodemaven.com; targeting encoded in the proxy USERNAME, no list
// endpoint). Build "<login>-country-<cc>-region-<r>-city-<c>-type-<residential|mobile>-sid-
// <id>-ttl-<t>-filter-<f>". A value containing '-' is truncated by the gateway, so drop it.
// city requires region beside it; type selects residential vs mobile.
// ---------------------------------------------------------------------------------------
const NODEMAVEN_TTL = /^[1-9]\d*[smh]$/;
function nodeMavenTtl(value) {
  const v = String(value || '').trim().toLowerCase();
  return NODEMAVEN_TTL.test(v) ? v : '';
}
// country/region/city/isp/type: trimmed, lowercased, spaces -> '_', and rejected outright if
// it still contains a '-' (which the gateway would truncate on, silently breaking targeting).
function nodeMavenToken(v) {
  const s = String(v || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!s || s.includes('-')) return '';
  return s.replace(/[^a-z0-9_]/g, '');
}
function nodeMavenUsername(login, { country, region, city, isp, type, sid, ttl, filter } = {}) {
  const base = String(login || '').trim();
  if (!base) return '';
  const parts = [base];
  const cc = String(country || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  const hasCountry = /^[a-z]{2}$/.test(cc);
  if (hasCountry) parts.push('country', cc);
  const rg = nodeMavenToken(region);
  if (hasCountry && rg) parts.push('region', rg);
  const ct = nodeMavenToken(city);
  if (hasCountry && rg && ct) parts.push('city', ct);
  const ip = nodeMavenToken(isp);
  if (ip) parts.push('isp', ip);
  const ty = nodeMavenToken(type);
  if (ty === 'residential' || ty === 'mobile') parts.push('type', ty);
  const sd = String(sid || '').trim().replace(/[^A-Za-z0-9]/g, '');
  if (sd) parts.push('sid', sd);
  const tl = nodeMavenTtl(ttl);
  if (sd && tl) parts.push('ttl', tl);
  const fl = String(filter || '').trim().toLowerCase();
  if (/^(low|medium|high)$/.test(fl)) parts.push('filter', fl);
  return parts.join('-');
}

// ---------------------------------------------------------------------------------------
// Froxy (SOAX reseller; gateway proxy.froxy.com:9000). Targeting rides in the PASSWORD as
// "<type>;<country>;;<region>;<city>" (spaces -> '+'); type is wifi (residential), mobile,
// or fast (datacenter). The login authenticates. Verified against Froxy's own connection
// guide; the trailing sticky-session field follows the SOAX convention this gateway inherits
// (confirm the exact delimiter against a live key before relying on sticky).
// ---------------------------------------------------------------------------------------
function froxyType(poolType) {
  const t = String(poolType || '').trim().toLowerCase();
  if (t === 'mobile') return 'mobile';
  if (t === 'fast' || t === 'datacenter') return 'fast';
  return 'wifi';
}
function froxyField(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, '+').replace(/[^a-z0-9+]/g, '');
}
function froxyPassword({ poolType, country, region, city, session } = {}) {
  const cc = String(country || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  const parts = [froxyType(poolType), /^[a-z]{2}$/.test(cc) ? cc : '', '', froxyField(region), froxyField(city)];
  let pw = parts.join(';');
  const sid = String(session || '').trim().replace(/[^A-Za-z0-9]/g, '');
  if (sid) pw += `;sessionid;${sid}`;
  return pw;
}

// ---------------------------------------------------------------------------------------
// Proxidize (api.proxidize.com/api/v1, Bearer token). Per-Proxy plans return ready
// host:port:user:pass from GET /perproxy/proxies/{username}. Per-GB plans expose a sub-user
// (access point) whose username carries geo tokens "-co-USA-st-TX-ci-Dallas" and an optional
// "-s-<session>" sticky token, built against the access point's own gateway host (20000 HTTP,
// 20002 SOCKS5).
// ---------------------------------------------------------------------------------------
function parseProxidizePerProxy(data, { socks = false } = {}) {
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : []);
  const out = [];
  const seen = new Set();
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const ep = parseHostPort(it.proxy);
    if (!ep) continue;
    const username = it.username != null ? String(it.username) : '';
    const password = it.password != null ? String(it.password) : '';
    const key = `${ep.host}:${ep.port}:${username}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      type: socks ? 'SOCKS5' : 'HTTP',
      host: ep.host, port: ep.port, username, password,
      rotationUrl: /^https?:\/\//i.test(String(it.rotate_url || '')) ? String(it.rotate_url) : null,
      ip: it.ip ? String(it.ip) : null,
      session: it.session_id != null ? String(it.session_id) : null
    });
  }
  return out;
}
function proxidizeGeoToken({ country, state, city } = {}) {
  const tok = (v) => String(v || '').trim().replace(/[^A-Za-z0-9 ]/g, '').replace(/\s+/g, '');
  let out = '';
  const co = tok(country);
  if (co) out += `-co-${co.toUpperCase()}`;
  const st = tok(state);
  if (co && st) out += `-st-${st.toUpperCase()}`;
  const ci = tok(city);
  if (co && ci) out += `-ci-${ci}`;
  return out;
}
function proxidizePerGbUsername(base, { country, state, city, session } = {}) {
  const u = String(base || '').trim();
  if (!u) return '';
  let out = u + proxidizeGeoToken({ country, state, city });
  const sid = String(session || '').trim().replace(/[^A-Za-z0-9]/g, '');
  if (sid) out += `-s-${sid}`;
  return out;
}

// ---------------------------------------------------------------------------------------
// Live Proxies (rotating residential, static residential, rotating mobile).
//
// What is actually documented publicly is the CREDENTIAL shape, not an endpoint: the help
// centre's own curl example is
//   curl -x LV3418547-dc1LU7SsG-33:AL7sj3xus1@172.148.150.38:7383 http://ipinfo.io/
// i.e. plain `username:password@host:port`, which parseLoginLine already handles (including
// a password containing '@' or ':'). Plans are downloaded as a list from the dashboard, and
// the programmatic API is documented inside the dashboard rather than on the public site.
//
// So this adapter takes the list URL the user copies out of THEIR dashboard instead of a
// guessed endpoint. The URL is pinned to liveproxies.io over https so a typo or a pasted
// third-party link cannot turn the pull into a request to an arbitrary host, and the account
// access code that Live Proxies embeds in that URL never has to be handled separately.
const LIVEPROXIES_HOST = /(^|\.)liveproxies\.io$/i;
function liveProxiesListUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  let u;
  try { u = new URL(text); } catch (e) { return null; }
  if (u.protocol !== 'https:') return null;
  if (!LIVEPROXIES_HOST.test(u.hostname)) return null;
  return u.toString();
}

// Map a downloaded Live Proxies list into pool rows. Rotating plans hand out one gateway
// endpoint that re-rotates per request, so a repeated line is ONE proxy; parseLoginList
// already dedupes on host/port/username, which is the identity the pool dedupes on too.
const LIVEPROXIES_PLANS = Object.freeze({
  residential: 'Residential',
  static: 'Static residential',
  mobile: 'Mobile'
});
function liveProxiesPlanLabel(value) {
  const v = String(value || '').trim().toLowerCase();
  return LIVEPROXIES_PLANS[v] || LIVEPROXIES_PLANS.residential;
}
function liveProxiesRows(text, { socks = false, country = '', plan = 'residential' } = {}) {
  const cc = String(country || '').trim().toUpperCase();
  const where = /^[A-Z]{2}$/.test(cc) ? cc : '';
  const kind = liveProxiesPlanLabel(plan);
  return parseLoginList(text).map((r) => ({
    type: socks ? 'SOCKS5' : 'HTTP',
    host: r.host,
    port: r.port,
    username: r.username,
    password: r.password,
    label: `Live Proxies • ${kind} • ${where || 'Global'}`,
    country: where || null
  }));
}

module.exports = {
  liveProxiesListUrl,
  liveProxiesRows,
  liveProxiesPlanLabel,
  parseIpRoyalLine,
  ipRoyalLifetime,
  ipRoyalLocation,
  pickIpRoyalPort,
  ipRoyalCountriesView,
  ipRoyalErrorMessage,
  GEOJS_URL,
  normalizeGeoJs,
  PROXY_SELLER_ORDER_TYPES,
  proxySellerOrderRows,
  summarizeProxySellerOrders,
  parseLoginLine,
  parseLoginList,
  csvFilter,
  asnList,
  FILTER_PATTERNS,
  proxySellerRotation,
  unwrapProxySeller,
  proxySellerGeoView,
  parseHostPort,
  marsProxiesLocation,
  parseMarsProxiesList,
  nodeMavenTtl,
  nodeMavenToken,
  nodeMavenUsername,
  froxyType,
  froxyField,
  froxyPassword,
  parseProxidizePerProxy,
  proxidizeGeoToken,
  proxidizePerGbUsername
};
