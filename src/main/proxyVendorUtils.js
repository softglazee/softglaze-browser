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
// PacketStream: a single residential gateway (proxy.packetstream.io:31112 HTTP / :31113
// SOCKS5). Country and sticky session are appended to the PASSWORD, e.g.
// <pass>_country-US_session-ab12cd. No flags = random country + rotating IP. Country codes
// are 2-letter uppercase. Confirmed against the dashboard Network Access generator 2026-09-27.
function packetStreamPassword(base, { country, session } = {}) {
  let pw = base != null ? String(base) : '';
  const cc = String(country || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (/^[A-Z]{2}$/.test(cc)) pw += `_country-${cc}`;
  const sid = String(session || '').trim().replace(/[^A-Za-z0-9]/g, '');
  if (sid) pw += `_session-${sid}`;
  return pw;
}

// ---------------------------------------------------------------------------------------
// Airproxy: dedicated mobile proxies (each its own SIM). GET /api/proxy/list/ returns
// { proxies: [{ id, ip, port, username, password, isp, in_use_till, ... }], count, success }.
// HTTP only (no SOCKS port documented). Map active, well-formed entries to pool rows and
// dedupe on host:port:username. Confirmed against a live account 2026-09-27.
function airproxyRows(body) {
  let data;
  try { data = typeof body === 'string' ? JSON.parse(body) : body; } catch { return []; }
  const list = Array.isArray(data && data.proxies) ? data.proxies : [];
  const rows = [];
  const seen = new Set();
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const host = String(p.ip || '').trim();
    const port = Number(p.port);
    const username = typeof p.username === 'string' ? p.username : '';
    const password = typeof p.password === 'string' ? p.password : '';
    if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !username || !password) continue;
    const dupe = `${host}:${port}:${username}`;
    if (seen.has(dupe)) continue;
    seen.add(dupe);
    const isp = String(p.isp || '').trim();
    const id = p.id != null ? String(p.id) : '';
    rows.push({
      type: 'HTTP',
      host, port, username, password,
      label: `Airproxy • Mobile${isp ? ` • ${isp}` : ''}${id ? ` • #${id}` : ''}`,
      country: null
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------------------
// CatProxies: multi-product. The app supports the two ROTATING pools (Standard Residential
// and Rotating Mobile). Both use one gateway with the targeting appended to the USERNAME and
// the plan's proxy password unchanged. Grammars confirmed against the live dashboard
// generator 2026-09-27:
//   Standard Residential: <base>-type-residential[-country-<cc>][-state-..][-city-..]
//                          [-lifetime-<min>-session-<id>]      (rotating = no session)
//   Rotating Mobile:       <base>[-country-<CC>][-city-..][-sid-<id>[-ttl-<n>m]]
// Country is lowercased for residential, uppercased for mobile (as the dashboard emits).
function catProxiesResiUsername(base, { country, state, city, session, lifetimeMin } = {}) {
  let u = `${String(base || '').trim()}-type-residential`;
  const code = (v) => String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  const cc = code(country);
  if (/^[a-z]{2}$/.test(cc)) u += `-country-${cc}`;
  const st = /^[a-z]{2}$/.test(cc) ? code(state) : '';
  if (st) u += `-state-${st}`;
  const ct = st ? code(city) : '';
  if (ct) u += `-city-${ct}`;
  const sid = String(session || '').trim().replace(/[^A-Za-z0-9]/g, '');
  const life = Number(lifetimeMin);
  if (sid && Number.isInteger(life) && life > 0) u += `-lifetime-${life}-session-${sid}`;
  return u;
}
function catProxiesMobileUsername(base, { country, city, session, ttlMin } = {}) {
  let u = String(base || '').trim();
  const cc = String(country || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (/^[A-Z]{2}$/.test(cc)) u += `-country-${cc}`;
  const ct = /^[A-Z]{2}$/.test(cc) ? String(city || '').trim().toLowerCase().replace(/\s+/g, '+').replace(/[^a-z0-9+]/g, '') : '';
  if (ct) u += `-city-${ct}`;
  const sid = String(session || '').trim().replace(/[^A-Za-z0-9]/g, '');
  const ttl = Number(ttlMin);
  if (sid) u += Number.isInteger(ttl) && ttl > 0 ? `-sid-${sid}-ttl-${ttl}m` : `-sid-${sid}`;
  return u;
}
// Pull { username, password, bandwidthLeft } out of a GET /orders/:id response, tolerating
// the payload.order.proxy nesting the API documents plus a couple of flatter fallbacks.
function catProxiesCreds(json) {
  const order = (json && (json.payload && json.payload.order)) || (json && json.order) || (json && json.payload) || json || {};
  const proxy = (order && order.proxy) || order || {};
  const username = typeof proxy.username === 'string' ? proxy.username.trim() : '';
  const password = typeof proxy.password === 'string' ? proxy.password : '';
  const bw = Number(proxy.bandwidth_left);
  return { username, password, bandwidthLeft: Number.isFinite(bw) ? bw : null };
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

// Shared: "new york" / "New-York" -> "NewYork" (vendors that want CamelCase place names).
function camelPlace(value) {
  return String(value || '').trim().split(/[\s_-]+/).filter(Boolean)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

// ---------------------------------------------------------------------------------------
// RapidProxy (rotating residential): gateway us.rapidproxy.io:5001, credentials are a
// dashboard sub-account. Targeting rides in the USERNAME, hyphen-separated:
//   <sub>-residential-<CC|global>[-state-<State>[-city-<City>]][-session-<id>[-stime-<min>]]
// Country is 2-letter uppercase (global = anywhere). State and City are CamelCase with no
// spaces; City is only documented under a State, and both need a country. stime (1-180
// minutes) only works with a session. Source: rapidproxy.io/proxy examples, 2026-09-29.
const RAPIDPROXY_MAX_STIME = 180;
function rapidProxyUsername(base, { country, state, city, session, lifeMin } = {}) {
  const sub = String(base || '').trim();
  const cc = String(country || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  const hasCc = /^[A-Z]{2}$/.test(cc);
  let user = `${sub}-residential-${hasCc ? cc : 'global'}`;
  const st = camelPlace(state);
  if (hasCc && st) {
    user += `-state-${st}`;
    const ct = camelPlace(city);
    if (ct) user += `-city-${ct}`;
  }
  const sid = String(session || '').trim().replace(/[^A-Za-z0-9]/g, '');
  if (sid) {
    user += `-session-${sid}`;
    const m = Number(lifeMin);
    if (Number.isInteger(m) && m > 0) user += `-stime-${Math.min(m, RAPIDPROXY_MAX_STIME)}`;
  }
  return user;
}

// ---------------------------------------------------------------------------------------
// NOVADA: gateway super.novada.pro:7777 (the dashboard may assign a regional host such as
// pr-as.novada.pro, so the host is overridable). Auth is a PROXY USER created under
// Residential Proxies -> Users, not the login email. Targeting rides in the USERNAME:
//   <user>-zone-<res|isp|mob>[-region-<cc>[-st-<state>][-city-<city>]][-session-<id>-sessTime-<min>]
// Values are lowercase with no spaces; sessTime is 1-120 minutes. Sources:
// developer.novada.com location-settings + session-type pages, and the dashboard endpoint
// generator (...-zone-res-session-<id>-sessTime-5), 2026-09-29.
const NOVADA_ZONES = Object.freeze({ residential: 'res', isp: 'isp', mobile: 'mob' });
const NOVADA_MAX_SESSTIME = 120;
function novadaPlace(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}
function novadaUsername(base, { poolType, country, state, city, session, lifeMin } = {}) {
  const zone = NOVADA_ZONES[String(poolType || '').toLowerCase()] || NOVADA_ZONES.residential;
  let user = `${String(base || '').trim()}-zone-${zone}`;
  const cc = String(country || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (/^[a-z]{2}$/.test(cc)) {
    user += `-region-${cc}`;
    const st = novadaPlace(state);
    if (st) user += `-st-${st}`;
    const ct = novadaPlace(city);
    if (ct) user += `-city-${ct}`;
  }
  const sid = String(session || '').trim().replace(/[^A-Za-z0-9]/g, '');
  if (sid) {
    const m = Number(lifeMin);
    const mins = Number.isInteger(m) && m > 0 ? Math.min(m, NOVADA_MAX_SESSTIME) : 10;
    user += `-session-${sid}-sessTime-${mins}`;
  }
  return user;
}

// ---------------------------------------------------------------------------------------
// Proxies.sx pool gateway: gw.proxies.sx, 7000 HTTP / 7001 SOCKS5. Username grammar:
//   psx_<acct>-<pool>-<cc>[-sid-<id>-rot-sticky]-failover-strict
// The gateway lowercases the username and splits on "-", so no value may contain a hyphen.
// pool = mbl (mobile modems) or peer (residential peers); "best"/"any" are never used because
// they fail over across pools. failover-strict makes an out-of-stock country return an error
// (E_NO_STOCK_COUNTRY) instead of silently exiting somewhere else, and a country is required.
// A sticky row pins one session id (sid, [a-z0-9_] 8-64 chars) with rot-sticky; a rotating row
// has no sid, so each new connection gets a fresh IP. An explicit rotate = a new sid.
// Source: agents.proxies.sx pool skill + rotation cookbook, 2026-09-29.
const PROXIESSX_POOLS = Object.freeze({ mobile: 'mbl', residential: 'peer' });
function proxiesSxSid(prefix, index) {
  const core = `${String(prefix || '').toLowerCase().replace(/[^a-z0-9_]/g, '')}${index != null ? `_${index}` : ''}`;
  const sid = core.length >= 8 ? core : `sg_${core}`.padEnd(8, '0');
  return sid.slice(0, 64);
}
function proxiesSxUsername(login, { poolType, country, sid } = {}) {
  const acct = String(login || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  const pool = PROXIESSX_POOLS[String(poolType || '').toLowerCase()] || PROXIESSX_POOLS.mobile;
  const cc = String(country || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!acct || !/^[a-z]{2}$/.test(cc)) return '';
  let user = `${acct}-${pool}-${cc}`;
  const s = String(sid || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (s) user += `-sid-${s}-rot-sticky`;
  return `${user}-failover-strict`;
}
// GET /v1/account/proxy-password. Field names differ between the docs and the reference
// client, so accept the common shapes and an optional { data: {...} } envelope.
function proxiesSxProxyCreds(body) {
  let data;
  try { data = typeof body === 'string' ? JSON.parse(body) : body; } catch { return { username: '', password: '' }; }
  const o = data && typeof data.data === 'object' && data.data ? data.data : (data || {});
  const pick = (...keys) => { for (const k of keys) { if (typeof o[k] === 'string' && o[k].trim()) return o[k].trim(); } return ''; };
  return {
    username: pick('proxyUsername', 'username', 'login', 'proxyLogin'),
    password: pick('proxyPassword', 'password')
  };
}

// ---------------------------------------------------------------------------------------
// MobileProxy.Space: GET https://mobileproxy.space/api.html?command=get_my_proxy with
// Authorization: Bearer <token> returns { status: 'ok', list: [Proxy] }. Each dedicated
// mobile proxy has one login/password and separate HTTP and SOCKS5 ports on proxy_host_ip
// (or proxy_hostname). Numbers may arrive as strings, so every one is parsed. proxy_exp is
// kept as the vendor's text (their timezone is Moscow). Errors come back as
// { status: 'err', message }. Source: github.com/mobileproxy/api-docs openapi.yaml + a live
// bad-token probe, 2026-09-29.
function mobileProxySpaceRows(body, { socks = false } = {}) {
  let data;
  try { data = typeof body === 'string' ? JSON.parse(body) : body; } catch { return { error: 'bad-json', rows: [] }; }
  if (!data || typeof data !== 'object') return { error: 'bad-json', rows: [] };
  if (data.status && data.status !== 'ok') return { error: String(data.message || data.status), rows: [] };
  const list = Array.isArray(data.list) ? data.list : [];
  const rows = [];
  const seen = new Set();
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const host = String(p.proxy_host_ip || p.proxy_hostname || '').trim();
    const port = Number.parseInt(String(socks ? p.proxy_socks5_port : p.proxy_http_port), 10);
    const username = p.proxy_login != null ? String(p.proxy_login) : '';
    const password = p.proxy_pass != null ? String(p.proxy_pass) : '';
    if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !username || !password) continue;
    const key = `${host}:${port}:${username}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const geo = String(p.proxy_geo || '').trim();
    const op = String(p.proxy_operator || '').trim();
    const exp = String(p.proxy_exp || '').trim();
    rows.push({
      type: socks ? 'SOCKS5' : 'HTTP',
      host, port, username, password,
      label: `MobileProxy.Space • ${[geo, op].filter(Boolean).join(' • ') || 'Mobile'}${p.proxy_id != null ? ` • #${p.proxy_id}` : ''}${exp ? ` • until ${exp}` : ''}`,
      country: null
    });
  }
  return { error: '', rows };
}

// ---------------------------------------------------------------------------------------
// Proxy-Solutions anti-detect integration: GET https://proxy-solutions.net/api/proxies/
// {provider_key}?format=object&proto=http|socks&page=N&per_page=200 returns
// { page, per_page, total_pages, total_proxies, proxies: [{ name, location, country_code,
// dynamic, proto, ip, port, login, password, expires_at (epoch ms) }] }. Expired entries are
// skipped. Source: the contract Proxy-Solutions sent SoftGlaze by email, 2026-09-28 (not in
// their public docs yet, so it is verified against one live key before listing).
function proxySolutionsPage(body, { now = Date.now() } = {}) {
  let data;
  try { data = typeof body === 'string' ? JSON.parse(body) : body; } catch { return { rows: [], totalPages: 0 }; }
  const list = Array.isArray(data && data.proxies) ? data.proxies : [];
  const rows = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const host = String(p.ip || '').trim();
    const port = Number.parseInt(String(p.port), 10);
    const username = p.login != null ? String(p.login) : '';
    const password = p.password != null ? String(p.password) : '';
    const exp = Number(p.expires_at);
    if (Number.isFinite(exp) && exp > 0 && exp <= now) continue;
    if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    const cc = String(p.country_code || '').trim().toUpperCase();
    const socks = String(p.proto || '').toLowerCase() === 'socks';
    rows.push({
      type: socks ? 'SOCKS5' : 'HTTP',
      host, port, username, password,
      label: `Proxy-Solutions • ${String(p.name || p.location || cc || 'Proxy').trim()}${p.dynamic ? ' • dynamic' : ''}`,
      country: /^[A-Z]{2}$/.test(cc) ? cc : null
    });
  }
  const totalPages = Number.parseInt(String(data && data.total_pages), 10);
  return { rows, totalPages: Number.isInteger(totalPages) && totalPages > 0 ? totalPages : 1 };
}

module.exports = {
  mobileProxySpaceRows,
  proxySolutionsPage,
  camelPlace,
  rapidProxyUsername,
  NOVADA_ZONES,
  novadaUsername,
  PROXIESSX_POOLS,
  proxiesSxSid,
  proxiesSxUsername,
  proxiesSxProxyCreds,
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
  packetStreamPassword,
  airproxyRows,
  catProxiesResiUsername,
  catProxiesMobileUsername,
  catProxiesCreds,
  parseProxidizePerProxy,
  proxidizeGeoToken,
  proxidizePerGbUsername
};
