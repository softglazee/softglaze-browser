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

// Pick one geo answer from several services queried through the same proxy. Geo databases
// disagree on leased proxy ranges: on 29 Sep 2026 ipinfo put 169.128.195.52 in Lisbon while
// ip-api and geojs both said Albuquerque, US, and trusting ipinfo alone launched a "US" proxy
// with Portuguese time and language, a loud bot signal. Rule: the country most services agree
// on wins; a tie goes to the country the user asked the vendor for (hint), then to the order
// the services were listed in. The winner's own record supplies timezone/city. Each input is
// the ip-api-shaped object the launch code already uses ({ countryCode, timezone, query, ... }).
function pickGeoConsensus(results, { countryHint } = {}) {
  const valid = (Array.isArray(results) ? results : []).filter((r) => r && typeof r === 'object' && /^[A-Z]{2}$/i.test(String(r.countryCode || '')));
  if (!valid.length) return null;
  const hint = String(countryHint || '').trim().toUpperCase();
  const votes = new Map();
  valid.forEach((r, i) => {
    const cc = String(r.countryCode).toUpperCase();
    const v = votes.get(cc) || { n: 0, first: i };
    v.n += 1;
    votes.set(cc, v);
  });
  const ranked = [...votes.entries()].sort((a, b) => (b[1].n - a[1].n)
    || ((b[0] === hint) - (a[0] === hint))
    || (a[1].first - b[1].first));
  const winner = ranked[0][0];
  const pick = valid.find((r) => String(r.countryCode).toUpperCase() === winner && r.timezone) || valid.find((r) => String(r.countryCode).toUpperCase() === winner);
  return { ...pick, countryCode: winner, geoVotes: `${ranked[0][1].n}/${valid.length}` };
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
// Froxy (gateway proxy.froxy.com, ports 9000-9199). Login/password access: the LOGIN is the
// package and the PASSWORD is the dashboard password followed by the geo fields, separated
// by ";": "<password>;<country>;<region>;<city>;<provider>" (help.froxy.com, Login-Password
// Authorization; blog example "password;country;;;"). The dashboard shows the bare password
// with empty fields, e.g. "qwerty;;;;", so only the part before the first ";" is kept as the
// base. Each port 9000-9199 is its own session, which is how a pull gets several exit IPs.
// The previous builder replaced the whole password with "wifi;<cc>;..." (a SOAX pattern),
// which Froxy rejected and reported as "your IP is not in the whitelist" (29 Sep 2026).
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
function froxyBasePassword(pasted) {
  return String(pasted == null ? '' : pasted).split(';')[0].trim();
}
// The first field of a Froxy "password" is the pool type (wifi = residential, mobile, fast =
// datacenter), as the dashboard shows it ("wifi;;;;"). When the pasted value is one of those
// type tokens, the panel's Pool type wins; anything else is treated as a real secret and kept.
function froxyPassword(base, { country, region, city, poolType } = {}) {
  const cc = String(country || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  let head = froxyBasePassword(base);
  if (poolType && ['wifi', 'mobile', 'fast'].includes(head.toLowerCase())) head = froxyType(poolType);
  return [head, /^[a-z]{2}$/.test(cc) ? cc : '', froxyField(region), froxyField(city), ''].join(';');
}

// ---------------------------------------------------------------------------------------
// PacketStream: a single residential gateway (proxy.packetstream.io:31112 HTTP / :31113
// SOCKS5). Country and sticky session are appended to the PASSWORD, e.g.
// <pass>_country-US_session-ab12cd. No flags = random country + rotating IP. Country codes
// are 2-letter uppercase. Confirmed against the dashboard Network Access generator 2026-09-27.
// PacketStream targets a country by its English name with the spaces removed
// (_country-UnitedStates), not by ISO code; a bare code is ignored and the exit is random.
// These are the 126 names its dashboard (Network Access, Location) offered on 2026-10-06.
const PACKETSTREAM_COUNTRIES = Object.freeze({
  US: 'UnitedStates', CA: 'Canada', AF: 'Afghanistan', AL: 'Albania', DZ: 'Algeria',
  AR: 'Argentina', AM: 'Armenia', AW: 'Aruba', AU: 'Australia', AT: 'Austria', AZ: 'Azerbaijan',
  BS: 'Bahamas', BH: 'Bahrain', BD: 'Bangladesh', BY: 'Belarus', BE: 'Belgium',
  BA: 'BosniaandHerzegovina', BR: 'Brazil', VG: 'BritishVirginIslands', BN: 'Brunei',
  BG: 'Bulgaria', KH: 'Cambodia', CM: 'Cameroon', CL: 'Chile', CN: 'China', CO: 'Colombia',
  CR: 'CostaRica', HR: 'Croatia', CU: 'Cuba', CY: 'Cyprus', CZ: 'Czechia', DK: 'Denmark',
  DO: 'DominicanRepublic', EC: 'Ecuador', EG: 'Egypt', SV: 'ElSalvador', EE: 'Estonia',
  ET: 'Ethiopia', FI: 'Finland', FR: 'France', GE: 'Georgia', DE: 'Germany', GH: 'Ghana',
  GR: 'Greece', GT: 'Guatemala', GY: 'Guyana', JO: 'HashemiteKingdomofJordan', HK: 'HongKong',
  HU: 'Hungary', IN: 'India', ID: 'Indonesia', IR: 'Iran', IQ: 'Iraq', IE: 'Ireland', IL: 'Israel',
  IT: 'Italy', JM: 'Jamaica', JP: 'Japan', KZ: 'Kazakhstan', KE: 'Kenya', KW: 'Kuwait',
  LV: 'Latvia', LI: 'Liechtenstein', LU: 'Luxembourg', MK: 'Macedonia', MG: 'Madagascar',
  MY: 'Malaysia', MU: 'Mauritius', MX: 'Mexico', MN: 'Mongolia', ME: 'Montenegro', MA: 'Morocco',
  MZ: 'Mozambique', MM: 'Myanmar', NP: 'Nepal', NL: 'Netherlands', NZ: 'NewZealand', NG: 'Nigeria',
  NO: 'Norway', OM: 'Oman', PK: 'Pakistan', PS: 'Palestine', PA: 'Panama', PG: 'PapuaNewGuinea',
  PY: 'Paraguay', PE: 'Peru', PH: 'Philippines', PL: 'Poland', PT: 'Portugal', PR: 'PuertoRico',
  QA: 'Qatar', LT: 'RepublicofLithuania', MD: 'RepublicofMoldova', RO: 'Romania', RU: 'Russia',
  SA: 'SaudiArabia', SN: 'Senegal', RS: 'Serbia', SC: 'Seychelles', SG: 'Singapore',
  SK: 'Slovakia', SI: 'Slovenia', SO: 'Somalia', ZA: 'SouthAfrica', KR: 'SouthKorea', ES: 'Spain',
  LK: 'SriLanka', SD: 'Sudan', SR: 'Suriname', SE: 'Sweden', CH: 'Switzerland', SY: 'Syria',
  TW: 'Taiwan', TJ: 'Tajikistan', TH: 'Thailand', TT: 'TrinidadandTobago', TN: 'Tunisia',
  TR: 'Turkey', UG: 'Uganda', UA: 'Ukraine', AE: 'UnitedArabEmirates', GB: 'UnitedKingdom',
  UZ: 'Uzbekistan', VE: 'Venezuela', VN: 'Vietnam', ZM: 'Zambia'
});
function packetStreamCountry(country) {
  const cc = String(country || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  return PACKETSTREAM_COUNTRIES[cc] || '';
}
function packetStreamPassword(base, { country, session } = {}) {
  let pw = base != null ? String(base) : '';
  const name = packetStreamCountry(country);
  if (name) pw += `_country-${name}`;
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

// ---------------------------------------------------------------------------------------
// Live Proxies gateway (read from the dashboard Proxy Generation panel, 29 Sep 2026). There
// is no downloadable list URL: the dashboard builds lines from one account username (LV<id>)
// and one proxy password, and so does the app.
//   Rotating: b2b.liveproxies.io:7383   user LV58712-lv_us
//   Sticky:   b2b-s<N>.liveproxies.io:7383   user LV58712-lv_us-<digits, max 8>   (60 min)
//   SOCKS5:   socks.liveproxies.io:1080 with the same username/password
// Country = "lv_" + lowercase ISO-2 code (the generator offers 59 countries).
const LIVEPROXIES_GATEWAY = Object.freeze({ http: 'b2b.liveproxies.io', port: 7383, socksHost: 'socks.liveproxies.io', socksPort: 1080 });
function liveProxiesBaseUser(raw) {
  // Accept "LV58712" or a full generated username ("LV58712-lv_us-123") and keep the account part.
  const m = String(raw || '').trim().match(/^([A-Za-z]{2}\d{2,})/);
  return m ? m[1].toUpperCase() : '';
}
function liveProxiesUsername(base, { country, sid } = {}) {
  const acct = liveProxiesBaseUser(base);
  const cc = String(country || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!acct || !/^[a-z]{2}$/.test(cc)) return '';
  const s = String(sid || '').replace(/\D/g, '').slice(0, 8);
  return `${acct}-lv_${cc}${s ? `-${s}` : ''}`;
}
// Sticky server for the Nth sticky proxy (1-based), exactly as the dashboard hands them out.
function liveProxiesStickyHost(n) {
  const i = Math.max(1, Number.parseInt(String(n), 10) || 1);
  return `b2b-s${i}.liveproxies.io`;
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
// The dashboard generator uses a random 8-digit NUMBER as the session id (sid). A typed or
// auto-generated name is kept if it is already 1-8 digits, else mapped to a stable 8-digit number.
function rapidProxySid(session) {
  const raw = String(session || '').trim();
  if (!raw) return '';
  if (/^\d{1,8}$/.test(raw)) return raw;
  let h = 2166136261;
  for (const ch of raw) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return String(10000000 + (h % 90000000));
}
function rapidProxyUsername(base, { country, state, city, session, lifeMin } = {}) {
  const sub = String(base || '').trim();
  const cc = String(country || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  const hasCc = /^[A-Z]{2}$/.test(cc);
  let user = `${sub}-residential-${hasCc ? cc : 'GLOBAL'}`;
  const st = camelPlace(state);
  if (hasCc && st) {
    user += `-state-${st}`;
    const ct = camelPlace(city);
    if (ct) user += `-city-${ct}`;
  }
  const sid = rapidProxySid(session);
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
  // Short ids are padded on the LEFT of the name, never on the right: mintGatewayRows numbers
  // sessions before they reach here ('ab1', 'ab10'), and right-padding turned both into
  // 'sg_ab100'. Left-padding keeps every distinct input distinct. Minimum total length 8.
  let core = String(prefix || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (index != null) core = `${core}_${index}`;
  if (core.length >= 8) return core.slice(0, 64);
  return `sg_${core.padStart(5, '0')}`.slice(0, 64);
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

// ---------------------------------------------------------------------------------------
// Proxmint: GET /api/v1/account (Bearer pmk_ key) returns every product with its gateway
// host, HTTP/SOCKS5 ports and proxy login. Targeting rides in the username after "__",
// parameters joined by ";". Verified against the live gateway 2026-10-07:
//   <user>__cr.de                      country (lower-case ISO code)
//   <user>__cr.us;state.newyork        state, words joined, lower-case (underscores fail)
//   <user>__cr.us;city.losangeles      city; sent WITHOUT the state (state+city weakened it)
//   <user>__sessid.<id>;sessttl.<min>  sticky session, 1-120 minutes; works with or without cr
// Rotating gateway port 823 (HTTP) / 824 (SOCKS5).
const PROXMINT_PRODUCTS = Object.freeze(['residential', 'residential_premium', 'mobile', 'datacenter']);
function proxmintGeoToken(v) {
  return String(v || '').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
}
function proxmintUsername(base, { country, state, city, session, ttlMin } = {}) {
  const user = String(base || '').trim();
  if (!user) return '';
  const params = [];
  const cc = String(country || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (/^[a-z]{2}$/.test(cc)) {
    params.push(`cr.${cc}`);
    const ct = proxmintGeoToken(city);
    const st = proxmintGeoToken(state);
    if (ct) params.push(`city.${ct}`);
    else if (st) params.push(`state.${st}`);
  }
  const sid = String(session || '').trim().replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
  if (sid) {
    const ttl = Math.min(120, Math.max(1, Number.parseInt(String(ttlMin), 10) || 30));
    params.push(`sessid.${sid}`, `sessttl.${ttl}`);
  }
  return params.length ? `${user}__${params.join(';')}` : user;
}
// Pick the product the user asked for out of the account response. Throws a clear message
// listing what the account actually has when the wanted product is missing or not usable.
function proxmintPickProduct(json, poolType) {
  const products = Array.isArray(json && json.products) ? json.products : [];
  const want = PROXMINT_PRODUCTS.includes(String(poolType || '').toLowerCase()) ? String(poolType).toLowerCase() : 'residential';
  const match = products.find((p) => p && p.product === want && p.status === 'active');
  if (!match) {
    const have = products.map((p) => `${p.name || p.product} (${p.status})`).join(', ');
    const err = new Error(have ? `Proxmint: no active ${want.replace('_', ' ')} product on this account. It has: ${have}.` : 'Proxmint: this account has no products yet. Buy or claim bandwidth first.');
    err.code = 'NO_PRODUCT';
    throw err;
  }
  const proxy = match.proxy || {};
  const bw = match.bandwidth || {};
  return {
    product: want,
    name: match.name || want,
    host: String(proxy.host || '').trim(),
    httpPort: Number(proxy.httpPort) || 0,
    socksPort: Number(proxy.socks5Port) || 0,
    username: String(proxy.username || '').trim(),
    password: proxy.password != null ? String(proxy.password) : '',
    remainingBytes: Number.isFinite(Number(bw.remainingBytes)) ? Number(bw.remainingBytes) : null
  };
}

// ---------------------------------------------------------------------------------------
// Databay: one gateway, gw.databay.co:8888, for HTTP and SOCKS5. Targeting rides in the
// proxy username as hyphen-separated key/value pairs (docs.databay.com, Connection String):
//   <user>-zone-<residential|mobile|datacenter>-countryCode-US-stateName-California
//   -cityName-Los Angeles-sessionId-<id>-sessionLength-<minutes, max 120>
// One location filter is used (most specific wins on their side, so only the most specific
// is sent). State and city exist on Residential only; Mobile and Datacenter take country.
const DATABAY_ZONES = Object.freeze(['residential', 'mobile', 'datacenter']);
function databayGeoValue(v) {
  // Hyphen is the parameter separator, so it can never appear inside a value.
  return String(v || '').trim().replace(/[-_]+/g, ' ').replace(/[^\p{L}\p{N} .']/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}
function databayUsername(base, { zone, country, state, city, session, lengthMin } = {}) {
  const user = String(base || '').trim().replace(/-zone-.*$/i, '');
  if (!user) return '';
  const z = DATABAY_ZONES.includes(String(zone || '').toLowerCase()) ? String(zone).toLowerCase() : 'residential';
  let u = `${user}-zone-${z}`;
  const cc = String(country || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (/^[A-Z]{2}$/.test(cc)) {
    const ct = z === 'residential' ? databayGeoValue(city) : '';
    const st = z === 'residential' ? databayGeoValue(state) : '';
    if (ct) u += `-cityName-${ct}`;
    else if (st) u += `-stateName-${st}`;
    else u += `-countryCode-${cc}`;
  }
  const sid = String(session || '').trim().replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
  if (sid) {
    const len = Math.min(120, Math.max(1, Number.parseInt(String(lengthMin), 10) || 30));
    u += `-sessionId-${sid}-sessionLength-${len}`;
  }
  return u;
}

// ---------------------------------------------------------------------------------------
// IPFoxy rotating residential (ipfoxy.com/help/docs/1eyfJt + /session-time): one account on
// gate-us.ipfoxy.io / gate-sg.ipfoxy.io port 58688 (HTTP and SOCKS5). Targeting rides in the
// username: customer-<user>-cc-US-st-Florida-city-Miami-sessid-<id>-ttl-<min>; -ttl- must be
// last and only applies to a sticky session. Built from the docs 2026-10-07; NOT live-key tested.
function ipfoxyGeo(v) { return String(v || '').trim().replace(/[^\p{L}\p{N}]+/gu, ''); }
function ipfoxyUsername(account, { country, state, city, session, ttlMin } = {}) {
  let user = String(account || '').trim();
  if (!user) return '';
  user = user.replace(/-(cc|st|city|sessid|ttl)-.*$/i, '');
  if (!/^customer-/i.test(user)) user = `customer-${user}`;
  const cc = String(country || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (/^[A-Z]{2}$/.test(cc)) {
    user += `-cc-${cc}`;
    const st = ipfoxyGeo(state);
    const ct = ipfoxyGeo(city);
    if (st) user += `-st-${st}`;
    if (ct) user += `-city-${ct}`;
  }
  const sid = String(session || '').trim().replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
  if (sid) {
    user += `-sessid-${sid}`;
    const ttl = Number.parseInt(String(ttlMin), 10);
    if (Number.isInteger(ttl) && ttl > 0) user += `-ttl-${ttl}`;
  }
  return user;
}

// ---------------------------------------------------------------------------------------
// kookeey dynamic residential (kookeey.com/apidoc, "提取动态IP（账密）"): username is
// "<userId>-<policyUser>", and geo, session and rotation interval ride in the PASSWORD:
//   <policyPass>-US                         country
//   <policyPass>-US_California_city_LosAngeles  state + city   (or US_California / US_city_X)
//   <policyPass>-global                     any country
//   <policyPass>-US-71261427-5m             sticky: 8-char session, then interval (Nm / Nh)
// Gateway gate.kookeey.info:1000 (regional gate-xx.kookeey.info). Built from the docs
// 2026-10-07; NOT live-key tested. Port 1000's protocol is not stated, so rows are HTTP.
function kookeeyGeo(v) { return String(v || '').trim().replace(/[^\p{L}\p{N}]+/gu, ''); }
function kookeeySession(sid) {
  const s = String(sid || '').replace(/[^A-Za-z0-9]/g, '');
  if (!s) return '';
  return s.length >= 8 ? s.slice(-8) : s.padStart(8, '0');
}
function kookeeyInterval(min) {
  const m = Number.parseInt(String(min), 10);
  if (!Number.isInteger(m) || m <= 0) return '';
  return m % 60 === 0 ? `${m / 60}h` : `${m}m`;
}
function kookeeyPassword(base, { country, state, city, session, lifeMin } = {}) {
  const pass = String(base == null ? '' : base).split('-')[0];
  const cc = String(country || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  let geo = 'global';
  if (/^[A-Z]{2}$/.test(cc)) {
    geo = cc;
    const st = kookeeyGeo(state);
    const ct = kookeeyGeo(city);
    if (st) geo += `_${st}`;
    if (ct) geo += `_city_${ct}`;
  }
  let pw = `${pass}-${geo}`;
  const sid = kookeeySession(session);
  if (sid) {
    pw += `-${sid}`;
    const iv = kookeeyInterval(lifeMin);
    if (iv) pw += `-${iv}`;
  }
  return pw;
}

// ---------------------------------------------------------------------------------------
// MangoProxy: POST backend.mangoproxy.com/public-api/v1/upstream/json (x-api-key) returns an
// array of { http, https, socks5 } proxy URLs (OpenAPI ProxyUrlDto). Turn them into rows.
function mangoProxyRows(json, { socks = false } = {}) {
  const list = Array.isArray(json) ? json : [];
  const rows = [];
  const seen = new Set();
  for (const item of list) {
    const raw = item && (socks ? item.socks5 : (item.http || item.https));
    if (typeof raw !== 'string' || !raw.trim()) continue;
    let u;
    try { u = new URL(raw.trim()); } catch (e) { continue; }
    const port = Number.parseInt(u.port, 10);
    if (!u.hostname || !Number.isInteger(port)) continue;
    const username = decodeURIComponent(u.username || '');
    const password = decodeURIComponent(u.password || '');
    const key = `${u.hostname}:${port}:${username}:${password}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ type: socks ? 'SOCKS5' : 'HTTP', host: u.hostname, port, username, password });
  }
  return rows;
}

// ---------------------------------------------------------------------------------------
// LumiProxy (gateway-minted residential). The username carries the targeting and the sticky
// session; the gateway host/port stay fixed (as.lumiproxy.com:5888 by default, country/region
// nodes such as us./eu. are reachable through the gateway override). Grammar verified against
// LumiProxy's own docs/blog (lumiproxy.com "How to use lumiproxy", fetched 2026-10-07), whose
// verbatim sticky example is:
//   eu.lumiproxy.com:5888:lumi-gdskfh45_area-US_city-Bessemer_life-10_session-u9sBvMSOLO:XXXXXX
// So flags are underscore-joined after the base login: area-<CC> (country, upper ISO-2),
// city-<City> (CamelCase), life-<min> (sticky minutes, 1-120) and session-<id>. life/session
// only appear for a sticky pull. state-<State> follows the identical area-/city- pattern and
// the dashboard's own country/state/city selector; it is emitted between area and city. The
// base is "lumi-<id>", whose single hyphen never clashes because the flags split on "_".
function lumiProxyUsername(base, { country, state, city, session, lifeMin } = {}) {
  const user = String(base || '').trim();
  if (!user) return '';
  const suffix = [];
  const cc = String(country || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (/^[A-Z]{2}$/.test(cc)) {
    suffix.push(`area-${cc}`);
    const st = camelPlace(state);
    if (st) suffix.push(`state-${st}`);
    const ct = camelPlace(city);
    if (ct) suffix.push(`city-${ct}`);
  }
  const sid = String(session || '').trim().replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
  if (sid) {
    const life = Number.parseInt(String(lifeMin), 10);
    if (Number.isInteger(life) && life >= 1 && life <= 120) suffix.push(`life-${life}`);
    suffix.push(`session-${sid}`);
  }
  return suffix.length ? `${user}_${suffix.join('_')}` : user;
}

// ---------------------------------------------------------------------------------------
// IP Burger (rotating residential, gateway residential.ipb.cloud:7777, HTTP only - their docs
// state SOCKS5 is not offered on the residential network). The proxy user (customer-<id>) and
// its password come from the dashboard Proxy Users; everything else rides in the username.
// Grammar verified against IPBurger's own residential product page (ipburger.com/residential-
// proxies, fetched 2026-10-07), whose verbatim examples are:
//   customer-a1b2c3d4e5-cc-US                                        (country-wide, rotating)
//   customer-a1b2c3d4e5-city-washington-sessid-cFNk-sesstime-30      (city, sticky)
// So the geo is ONE token - cc-<CC> for the whole country, OR a narrowing city-/state- token
// used INSTEAD of cc (the examples never combine them; the gateway resolves the city's country
// itself). sessid-<id> + sesstime-<min> (held minutes, max 30) appear only for a sticky pull.
function ipBurgerBaseUser(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^customer-([A-Za-z0-9]+)/i);
  if (m) return `customer-${m[1]}`;
  const id = s.replace(/[^A-Za-z0-9]/g, '');
  return id ? `customer-${id}` : '';
}
function ipBurgerPlace(v) {
  return String(v || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}
const IPBURGER_MAX_SESSTIME = 30;
function ipBurgerUsername(base, { country, state, city, session, sesstimeMin } = {}) {
  const user = ipBurgerBaseUser(base);
  if (!user) return '';
  const parts = [user];
  const cc = String(country || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (/^[A-Z]{2}$/.test(cc)) {
    const ct = ipBurgerPlace(city);
    const st = ipBurgerPlace(state);
    if (ct) parts.push('city', ct);
    else if (st) parts.push('state', st);
    else parts.push('cc', cc);
  }
  const sid = String(session || '').trim().replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
  if (sid) {
    const mins = Math.min(IPBURGER_MAX_SESSTIME, Math.max(1, Number.parseInt(String(sesstimeMin), 10) || IPBURGER_MAX_SESSTIME));
    parts.push('sessid', sid, 'sesstime', String(mins));
  }
  return parts.join('-');
}

// ---------------------------------------------------------------------------------------
// Proxy302 (open.proxy302.com Open API v3). A real list API, not a gateway grammar. Flow,
// verified against the published docs (proxy302.apifox.cn, fetched 2026-10-07):
//   GET  /user/users/token?username=<keyName>&password=<keyPwd>  -> { code:0, data:{ token } }
//        the returned token already includes the "Basic " prefix and is sent verbatim as the
//        Authorization header on every later call. The key is an API sub-account, not the login.
//   GET  /proxy/area/country                                     -> { code:0, data:{ data:[
//        { id, name, code } ] } }  maps an ISO-2 code to the numeric country_id.
//   POST /proxy/api/proxy/dynamic/traffic?s=1&protocol=<http|socks5>&country_id=&state_id=0&
//        city_id=0                                                -> { code:0, data:{ host:
//        "proxy.proxy302.com", port:2222, user_name, password, protocol } }  one ready proxy.
// Every response wraps the payload in { code, msg, data }; code 0 is success, anything else is
// a business error carried in msg (so the HTTP status alone proves nothing).
function proxy302Body(text, what) {
  let body;
  try { body = JSON.parse(String(text)); } catch (e) { throw new Error(`Proxy302 ${what}: the API did not return JSON.`); }
  if (body && Number(body.code) === 0) return body.data;
  const msg = body && body.msg ? String(body.msg) : 'request failed';
  throw new Error(`Proxy302 ${what}: ${msg}`);
}
function proxy302Token(text) {
  const data = proxy302Body(text, 'sign-in');
  const token = data && typeof data.token === 'string' ? data.token.trim() : '';
  if (!token) throw new Error('Proxy302: the sign-in response carried no token. Check the API key name and password in the Proxy302 backend.');
  return token;
}
// Return the numeric country_id for an ISO-2 code, 0 for "any", or null when the vendor does
// not list that country (so the caller can refuse instead of pulling the wrong location).
function proxy302CountryId(text, code) {
  const cc = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return 0;
  const data = proxy302Body(text, 'country list');
  const list = Array.isArray(data && data.data) ? data.data : (Array.isArray(data) ? data : []);
  const hit = list.find((a) => a && String(a.code || '').trim().toUpperCase() === cc);
  if (!hit) return null;
  const id = Number(hit.id);
  return Number.isInteger(id) ? id : null;
}
function proxy302Row(text, { socks = false, country = '' } = {}) {
  const data = proxy302Body(text, 'proxy');
  const host = String((data && data.host) || '').trim();
  const port = Number.parseInt(String(data && data.port), 10);
  const username = data && data.user_name != null ? String(data.user_name) : '';
  const password = data && data.password != null ? String(data.password) : '';
  if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !username) return null;
  const cc = String(country || '').trim().toUpperCase();
  const where = /^[A-Z]{2}$/.test(cc) ? cc : '';
  return {
    type: socks ? 'SOCKS5' : 'HTTP',
    host, port, username, password,
    label: `Proxy302 • Residential • ${where || 'Worldwide'}`,
    country: where || null
  };
}

module.exports = {
  lumiProxyUsername,
  ipBurgerBaseUser,
  ipBurgerUsername,
  IPBURGER_MAX_SESSTIME,
  proxy302Token,
  proxy302CountryId,
  proxy302Row,
  rapidProxySid,
  froxyBasePassword,
  LIVEPROXIES_GATEWAY,
  liveProxiesBaseUser,
  liveProxiesUsername,
  liveProxiesStickyHost,
  pickGeoConsensus,
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
  packetStreamPassword, packetStreamCountry,
  airproxyRows,
  catProxiesResiUsername,
  catProxiesMobileUsername,
  catProxiesCreds,
  parseProxidizePerProxy,
  proxidizeGeoToken,
  proxidizePerGbUsername,
  PROXMINT_PRODUCTS, proxmintUsername, proxmintPickProduct,
  DATABAY_ZONES, databayUsername,
  ipfoxyUsername, kookeeySession, kookeeyPassword, mangoProxyRows
};
