'use strict';
// Pure helpers for the proxy vendor adapters, kept out of ipcHandlers.js (which pulls in electron)
// so tests can require them.

// Parse one `login:password@host:port` line, as returned by DataImpulse /api/list and by
// Proxy-Seller /proxy/download/resident with a custom template. Returns null for a blank
// line, an error body, or anything that is not a usable endpoint.
function parseLoginLine(raw) {
  // Proxy-Seller's documented export ends each line with ';'.
  const line = String(raw || '').trim().replace(/;+$/, '').trim();
  if (!line || line.startsWith('{') || line.startsWith('[') || line.startsWith('<')) return null;
  // Split at the last '@' and the first ':' of the credential half: passwords may contain '@' or ':'.
  const at = line.lastIndexOf('@');
  if (at < 0) return null;
  const cred = line.slice(0, at);
  const endpoint = line.slice(at + 1);
  const c = cred.indexOf(':');
  const username = c >= 0 ? cred.slice(0, c) : cred;
  const password = c >= 0 ? cred.slice(c + 1) : '';
  // host:port splits at the last ':' so a bracketed IPv6 host survives.
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

// Proxy-Seller takes the API key in the URL path, which error bodies can echo back
// ("Unknown action /personal/api/v2/<key>/proxy/list"). Mask it raw, URL-encoded and in any case.
function maskProxySellerKey(text, key) {
  let out = String(text == null ? '' : text);
  const raw = String(key || '');
  if (!raw) return out;
  for (const form of new Set([raw, encodeURIComponent(raw)])) {
    out = out.replace(new RegExp(form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '***');
  }
  return out;
}

// Proxy-Seller wraps every JSON response in { status, data, errors }. Business errors come
// back as HTTP 200 with status "error", so the status code alone proves nothing.
function unwrapProxySeller(text, what, key) {
  let body;
  try {
    body = JSON.parse(String(text));
  } catch (e) {
    throw new Error(`Proxy-Seller ${what}: the API did not return JSON.`);
  }
  if (body && body.status === 'success') return body.data;
  const first = body && Array.isArray(body.errors) && body.errors[0];
  const msg = first && first.message ? String(first.message) : 'request failed';
  // Access failures arrive as one fixed triple, whichever of the three really happened, so
  // errors[0] saying "Error api key" proves nothing when the other two are beside it.
  const all = body && Array.isArray(body.errors) ? body.errors.map((e) => String((e && e.message) || '')) : [];
  if ([/error api key/i, /ip not allowed/i, /request limit/i].every((re) => all.some((m) => re.test(m)))) {
    throw new Error('Proxy-Seller: the API refused this request. Either the API key is wrong, this computer\'s IP is not on the key\'s whitelist, or the rate limit was reached. Copy the key again from the dashboard, API section, check its IP list, and try again in a minute.');
  }
  if (/error api key/i.test(msg)) throw new Error('Proxy-Seller: the API key was rejected. Copy it again from the dashboard, API section.');
  if (/ip not allowed/i.test(msg)) throw new Error('Proxy-Seller: this API key only accepts calls from whitelisted IPs, and this machine is not one of them. Add its IP in the dashboard API settings.');
  // v1 says "Tarif not found", v2 "Make order with resident first"; both mean no residential package.
  if (/tarif not found|make order with resident/i.test(msg)) throw new Error('Proxy-Seller: this account has no active residential package.');
  if (/request limit/i.test(msg)) throw new Error('Proxy-Seller: the API rate limit was reached. Wait a minute and try again.');
  throw new Error(`Proxy-Seller ${what}: ${maskProxySellerKey(msg, key)}`);
}

// GET resident/lists. The v2 docs page shows data.items; the v2 SDK READMEs (Node, Python,
// PHP) say data is a flat array with no items wrapper. Read both.
function proxySellerListItems(data) {
  if (Array.isArray(data)) return data;
  return data && Array.isArray(data.items) ? data.items : [];
}

// A list's geo. The v2 docs show an object on GET resident/lists and a one-item array on the
// POST resident/list/add response, so a label read straight off the array would say "Global".
function proxySellerListGeo(geo) {
  const one = Array.isArray(geo) ? geo[0] : geo;
  return one && typeof one === 'object' ? one : {};
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

// Dual-stack geo fallback for when ipinfo.io and ip-api.com fail through a proxy: neither has an AAAA
// record, so IPv6-only exits cannot reach them. get.geojs.io answers on both families.
// Fields: ip, country_code, region, city, timezone, latitude, longitude, organization_name.
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

// Geo databases disagree on leased proxy ranges, and a wrong country gives mismatched timezone and
// language (a bot signal). The majority country wins; ties go to countryHint, then input order.
// Inputs are ip-api-shaped ({ countryCode, timezone, query, ... }); the winner supplies timezone/city.
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

// IPRoyal residential: resi-api.iproyal.com/v1 (OpenAPI spec served at /docs).

// Parses one generate-proxy-list line in {hostname}:{port}:{username}:{password} form. Only the
// password may hold ':' (it carries targeting and session), so split on the first three colons.
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

// Named port for the protocol from GET /access/entry-nodes. The generate call takes the port name
// ("http", "socks5"), not the number.
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

// Splits a bare "host:port" (IPv6-bracket aware), as the Proxidize per-proxy API returns it.
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

// MarsProxies residential (api.marsproxies.com, Bearer): generate-proxy-list returns a JSON array of
// "host:port:user:pass" strings carrying location and session, parsed like IPRoyal lines. Sticky
// lifetime follows the IPRoyal rule (ipRoyalLifetime).

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

// NodeMaven (gate.nodemaven.com): targeting lives in the username, no list endpoint:
// <login>-country-<cc>-region-<r>-city-<c>-type-<residential|mobile>-sid-<id>-ttl-<t>-filter-<f>.
// The gateway truncates on '-', so values containing it are dropped; city needs region.
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

// Froxy (proxy.froxy.com, ports 9000-9199, each its own session). Login is the package; password is
// "<password>;<country>;<region>;<city>;<provider>". The dashboard shows "qwerty;;;;", so only the
// text before the first ';' is the base. Froxy reports a malformed password as an IP-whitelist error.
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

// PacketStream: one gateway (proxy.packetstream.io:31112 HTTP, :31113 SOCKS5). Country and session go
// on the password (<pass>_country-UnitedStates_session-ab12cd). Countries are English names without
// spaces, not ISO codes (a code is ignored); these are the 126 names its dashboard offers.
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

// Airproxy dedicated mobile proxies (HTTP only). GET /api/proxy/list/ returns { proxies: [{ id, ip,
// port, username, password, isp, in_use_till, ... }], count, success }.
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

// CatProxies rotating pools: targeting goes on the username, password unchanged. Residential:
// <base>-type-residential[-country-<cc>][-state-..][-city-..][-lifetime-<min>-session-<id>]
// Mobile: <base>[-country-<CC>][-city-..][-sid-<id>[-ttl-<n>m]]. Country case follows the dashboard.
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

// Proxidize (api.proxidize.com/api/v1, Bearer). Per-Proxy plans return host:port:user:pass from
// GET /perproxy/proxies/{username}. Per-GB sub-users take "-co-USA-st-TX-ci-Dallas" and an optional
// "-s-<session>" in the username, on the access point's host (20000 HTTP, 20002 SOCKS5).
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

// Live Proxies documents only the credential shape (user:pass@host:port), so the adapter takes the
// list URL from the user's dashboard. It is pinned to https liveproxies.io so a typo or pasted link
// cannot send the request, with the access code embedded in it, to another host.
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

// Rotating plans give one gateway that re-rotates per request, so a repeated line is one proxy;
// parseLoginList dedupes on host/port/username, like the pool.
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

// Live Proxies gateway (no list URL): lines are built from the account username (LV<id>) and password.
// Rotating b2b.liveproxies.io:7383 (user LV58712-lv_us); sticky b2b-s<N>, user -<1-8 digits>, 60 min;
// SOCKS5 socks.liveproxies.io:1080. Country is "lv_" + lowercase ISO-2 code.
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
// Only b2b-s1 to b2b-s17 exist in DNS, so higher numbers wrap. The username's session id picks the
// exit IP, not the server.
const LIVEPROXIES_STICKY_SERVERS = 17;
function liveProxiesStickyHost(n) {
  const i = Math.max(1, Number.parseInt(String(n), 10) || 1);
  return `b2b-s${((i - 1) % LIVEPROXIES_STICKY_SERVERS) + 1}.liveproxies.io`;
}

// Middle value of some timings, ignoring anything that is not a number. Null when there are none.
function medianMs(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

// Shared: "new york" / "New-York" -> "NewYork" (vendors that want CamelCase place names).
function camelPlace(value) {
  return String(value || '').trim().split(/[\s_-]+/).filter(Boolean)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

// RapidProxy (us.rapidproxy.io:5001, dashboard sub-account); targeting rides in the username:
// <sub>-residential-<CC|global>[-state-<State>[-city-<City>]][-session-<id>[-stime-<min>]]
// State/City are CamelCase and need a country, City needs State; stime (1-180 min) needs a session.
const RAPIDPROXY_MAX_STIME = 180;
// The dashboard uses a random 8-digit number as the sid. Input of 1-8 digits is kept; anything else
// maps to a stable 8-digit number.
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

// NOVADA (super.novada.pro:7777, overridable for regional hosts like pr-as.novada.pro). Auth is a
// proxy user from Residential Proxies -> Users, not the login email. Lowercase, no spaces:
// <user>-zone-<res|isp|mob>[-region-<cc>[-st-<state>][-city-<city>]][-session-<id>-sessTime-<1-120>]
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

// Proxies.sx (gw.proxies.sx, 7000 HTTP, 7001 SOCKS5) lowercases the username and splits it on '-':
// psx_<acct>-<mbl|peer>-<cc>[-sid-<id>-rot-sticky]-failover-strict. Never best/any (they cross pools);
// failover-strict errors on an out-of-stock country instead of exiting elsewhere.
const PROXIESSX_POOLS = Object.freeze({ mobile: 'mbl', residential: 'peer' });
function proxiesSxSid(prefix, index) {
  // Pad short ids on the left: callers number sessions ('ab1', 'ab10'), and right-padding would make
  // them collide. Minimum total length 8.
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

// MobileProxy.Space: GET mobileproxy.space/api.html?command=get_my_proxy (Bearer) -> { status: 'ok',
// list }; errors are { status: 'err', message }. Each proxy has one login, separate HTTP/SOCKS5 ports;
// numbers may be strings, and proxy_exp stays vendor text (Moscow time).
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

// Proxy-Solutions: GET proxy-solutions.net/api/proxies/{provider_key}?format=object&proto=http|socks
// &page=N&per_page=200 -> { total_pages, proxies: [{ ip, port, login, password, expires_at ms }] }.
// The contract came by email and is not in their public docs; expired entries are skipped.
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

// Proxmint: GET /api/v1/account (Bearer pmk_) lists products with host, ports and login. Targeting
// follows "__" in the username, ';'-joined: cr.<cc>; state.<words joined, lowercase>; city.<name>
// (without state); sessid.<id>;sessttl.<1-120 min>. Underscores fail. Rotating ports 823/824 (SOCKS5).
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

// Databay gateway gw.databay.co:8888 (HTTP and SOCKS5). Username: <user>-zone-<zone>-countryCode-US
// -stateName-<s>-cityName-<c>-sessionId-<id>-sessionLength-<max 120 min>. Only the most specific
// location is sent; state and city exist on Residential only.
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

// IPFoxy rotating residential: gate-us/gate-sg.ipfoxy.io:58688 (HTTP and SOCKS5). Username:
// customer-<user>-cc-US-st-Florida-city-Miami-sessid-<id>-ttl-<min>; -ttl- goes last, sticky only.
// Built from the docs; not tested with a live key.
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

// MangoProxy: POST backend.mangoproxy.com/public-api/v1/upstream/json (x-api-key) returns
// [{ http, https, socks5 }] proxy URLs (OpenAPI ProxyUrlDto).
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

// IP Burger: residential.ipb.cloud:7777, HTTP only (no residential SOCKS5). Username: customer-<id>
// plus one geo token, cc-<CC> or a city-/state- token instead (never both), e.g. customer-x-cc-US or
// customer-x-city-washington-sessid-cFNk-sesstime-30 (sticky only, max 30 min).
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

// Proxy302 Open API v3. GET /user/users/token (API sub-account, not the login) returns the full
// Authorization value ("Basic ..."). /proxy/area/country maps ISO-2 to country_id; POST
// /proxy/api/proxy/dynamic/traffic gives one proxy. A nonzero code in { code, msg, data } is an error.
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

// 2extract username: 2xt-customer-<id>-proxy-<name>[-country-de[-state-..][-city-..]][-session-<id>
// [-time-<min>]]; -time needs -session, state/city need country. The Public API lacks the customer id,
// so the base username comes from the dashboard. Not tested with a live key.
const TWOEXTRACT_COUNTRIES = new Set('af ax al dz as ad ao ai aq ag ar am aw au at az bh bd bb by be bz bj bm bt bo ba bw bv br io vg bn bg bf bi kh cm ca cv bq ky cf td cl cn cx cc co km ck cr ci hr cu cw cy cz cd dk dj dm do ec eg sv en gq er ee sz et fk fo fj fi fr gf pf tf ga ge de gh gi gr gl gd gp gu gt gg gn gw gy ht hm hn hk hu is in id ir iq ie im il it jm jp je jo kz ke ki xk kw kg la lv lb ls lr ly li lt lu mo mg mw my mv ml mt mh mq mr mu yt mx fm md mc mn me ms ma mz mm na nr np nl nc nz ni ne ng nu nf kp mk mp no om pk pw ps pa pg py pe ph pn pl pt pr qa cg re ro ru rw bl kn lc mf pm vc ws sm st sa sn rs sc sl sg sx sk si sb so za gs kr ss es lk sd sr sj se ch sy tj tw tz th bs gm tl tg tk to tt tn tr tm tc tv vi ug ua ae gb us uy uz vu va ve vn wf eh ye zm zw'.split(' '));
function twoExtractBaseUser(raw) {
  // The proxy name is lowercase letters, digits and underscores, so the first hyphen after it
  // starts a pasted targeting suffix, which is dropped here and rebuilt from the form.
  const m = /^2xt-customer-[A-Za-z0-9]+-proxy-[A-Za-z0-9_]+/.exec(String(raw || '').trim());
  return m ? m[0] : '';
}
function twoExtractCountry(country) {
  const cc = String(country || '').trim().toLowerCase();
  return TWOEXTRACT_COUNTRIES.has(cc) ? cc : '';
}
function twoExtractPlace(v) {
  return String(v || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}
function twoExtractUsername(base, { country, state, city, session, timeMin } = {}) {
  const user = twoExtractBaseUser(base);
  if (!user) throw new Error('2extract: enter the proxy username from Connection Details. It looks like 2xt-customer-<id>-proxy-<name>.');
  const parts = [user];
  const rawCc = String(country || '').trim();
  const st = twoExtractPlace(state);
  const ct = twoExtractPlace(city);
  if (rawCc) {
    const cc = twoExtractCountry(rawCc);
    if (!cc) throw new Error(`2extract does not list the country "${rawCc}". Pick another country, or Any.`);
    parts.push('country', cc);
    if (st) parts.push('state', st);
    if (ct) parts.push('city', ct);
  } else if (st || ct) {
    throw new Error('2extract: a state or city needs a country as well.');
  }
  const rawSid = String(session || '').trim();
  const sid = rawSid.replace(/[^A-Za-z0-9]/g, '');
  if (rawSid && !sid) throw new Error('2extract: a sticky session name must contain letters or digits.');
  const rawTime = String(timeMin == null ? '' : timeMin).trim();
  if (rawTime) {
    if (!/^[1-9]\d*$/.test(rawTime)) throw new Error('2extract: Keep same IP must be a whole number of minutes.');
    if (!sid) throw new Error('2extract: Keep same IP needs a sticky session.');
  }
  if (sid) {
    parts.push('session', sid);
    if (rawTime) parts.push('time', rawTime);
  }
  return parts.join('-');
}

// GonzoProxy: connect.gonzoproxy.app:10000, HTTP and SOCKS5, all pools. Targeting is in the login,
// underscore-joined: Gonzoj9CiIi_c_US_sd_443_s_663698TEC_ttl_72h (sd = region; also isp_, city_).
// Only the sticky form is documented, so only it is built. Not tested with a live key.
const GONZOPROXY_TTL = '72h'; // the lifetime in every published example
function gonzoProxyBaseLogin(raw) {
  const s = String(raw || '').trim();
  const base = s.split(/_c_/)[0];
  return /^[A-Za-z0-9]+$/.test(base) ? base : '';
}
function gonzoProxyCity(v) {
  return String(v || '').trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('-');
}
function gonzoProxyUsername(login, { country, state, city, session } = {}) {
  const base = gonzoProxyBaseLogin(login);
  if (!base) throw new Error('GonzoProxy: enter the login from Proxy Setup in your dashboard (letters and digits, for example Gonzoj9CiIi).');
  const cc = String(country || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) throw new Error('GonzoProxy: pick a country. Its proxy login needs one.');
  const parts = [base, 'c', cc];
  const sd = String(state || '').trim();
  if (sd) {
    if (!/^\d+$/.test(sd)) throw new Error('GonzoProxy: State takes the numeric region code from the login in Proxy Setup (the 443 in sd_443), not a name.');
    parts.push('sd', sd);
  }
  const ct = gonzoProxyCity(city);
  if (ct) parts.push('city', ct);
  const sid = String(session || '').trim().replace(/[^A-Za-z0-9]/g, '');
  if (!sid) throw new Error('GonzoProxy: a sticky session name must contain letters or digits.');
  parts.push('s', sid, 'ttl', GONZOPROXY_TTL);
  return parts.join('_');
}

// Simply Proxies (UK only, no customer API): <user>[-ee|-o2|-vodafone|-three][-session-<id>[-<min>]].
// Minutes (5-720) apply on SOCKS5 only; HTTPS uses a fixed 12 h window. Ids stay alphanumeric, since
// a trailing -<digits> would read as minutes. Not tested with a live key.
const SIMPLYPROXIES_NETWORKS = Object.freeze(['ee', 'o2', 'vodafone', 'three']);
function simplyProxiesUsername(base, { network, session, minutes } = {}) {
  // Drop a pasted suffix so the targeting is rebuilt from the form, never doubled.
  const user = String(base || '').trim().replace(/-session-.*$/i, '').replace(/-(ee|o2|vodafone|three)$/i, '');
  if (!user || /[\s:@]/.test(user)) throw new Error('Simply Proxies: enter the proxy username from your dashboard.');
  const parts = [user];
  // The panel's untouched pool select sends the app-wide default 'residential', which it shows as Any.
  const net = String(network || '').trim().toLowerCase();
  if (net && net !== 'any' && net !== 'residential') {
    if (!SIMPLYPROXIES_NETWORKS.includes(net)) throw new Error(`Simply Proxies has no network "${network}". Pick EE, O2, Vodafone, Three or Any.`);
    parts.push(net);
  }
  const rawSid = String(session || '').trim();
  const sid = rawSid.replace(/[^A-Za-z0-9]/g, '');
  if (rawSid && !sid) throw new Error('Simply Proxies: a sticky session name must contain letters or digits.');
  const rawMin = String(minutes == null ? '' : minutes).trim();
  if (rawMin) {
    const m = Number(rawMin);
    if (!Number.isInteger(m) || m < 5 || m > 720) throw new Error('Simply Proxies: Keep same IP must be from 5 minutes to 12 hours.');
    if (!sid) throw new Error('Simply Proxies: Keep same IP needs a sticky session.');
  }
  if (sid) {
    parts.push('session', sid);
    if (rawMin) parts.push(String(Number(rawMin)));
  }
  return parts.join('-');
}

// Coronium: GET /api/v3/account/proxies (Bearer) -> { data }. Rows use ip_address + proxy_login on
// http_port/socks_port, or per-protocol proxyEndpoints, which win. The restart/status token URLs
// rotate the IP without auth, so only the named fields are copied. Not tested with a live key.
function coroniumRows(body, { socks = false, now = Date.now() } = {}) {
  let json;
  try { json = typeof body === 'string' ? JSON.parse(body) : body; } catch { return { rows: [], total: 0, expired: 0 }; }
  const list = Array.isArray(json && json.data) ? json.data : [];
  const rows = [];
  const seen = new Set();
  let expired = 0;
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const exp = Number(p.tariff_expired_at);
    if (Number.isFinite(exp) && exp > 0 && exp <= now) { expired += 1; continue; }
    // A row with proxyEndpoints never falls back to the classic fields: those are for other rows.
    const pe = p.proxyEndpoints && typeof p.proxyEndpoints === 'object' ? p.proxyEndpoints : null;
    const ep = pe ? (socks ? pe.socks5 : pe.http) : null;
    if (pe && (!ep || typeof ep !== 'object')) continue;
    const host = String((ep ? ep.host : (p.ip_address || p.connection_ip)) || '').trim();
    const port = Number.parseInt(String(ep ? ep.port : (socks ? p.socks_port : p.http_port)), 10);
    const username = String((ep ? ep.username : p.proxy_login) || '');
    const password = String((ep ? ep.password : p.proxy_password) || '');
    if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !username || !password) continue;
    const key = `${host}:${port}:${username}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = String(p.name || '').trim();
    rows.push({
      type: socks ? 'SOCKS5' : 'HTTP',
      host, port, username, password,
      label: `Coronium • Mobile${name ? ` • ${name}` : ''}${p.isOnline === false ? ' • offline' : ''}`,
      country: null
    });
  }
  return { rows, total: list.length, expired };
}

// Singapore Mobile Proxy: GET /api/v1/proxies/my (x-api-key) -> { proxyList }; authentication_user is
// "user:password". rotation_link changes the IP when fetched, so it is never copied. Lines without a
// login (IP allow-list only) are counted and left out. Not tested with a live key.
function singaporeMobileProxyRows(body, { socks = false } = {}) {
  let json;
  try { json = typeof body === 'string' ? JSON.parse(body) : body; } catch { return { rows: [], total: 0, inactive: 0, noLogin: 0 }; }
  const list = Array.isArray(json && json.proxyList) ? json.proxyList : [];
  const rows = [];
  const seen = new Set();
  let inactive = 0;
  let noLogin = 0;
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    if (String(p.license_status || '').toUpperCase() !== 'ACTIVE') { inactive += 1; continue; }
    const auth = String(p.authentication_user || '');
    const at = auth.indexOf(':');
    const username = at > 0 ? auth.slice(0, at) : '';
    const password = at > 0 ? auth.slice(at + 1) : '';
    if (!username || !password) { noLogin += 1; continue; }
    const host = String(p.host_domain || '').trim();
    const port = Number.parseInt(String(socks ? p.socket_port : p.http_port), 10);
    if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    const key = `${host}:${port}:${username}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const plan = String(p.package_name || '').trim();
    rows.push({
      type: socks ? 'SOCKS5' : 'HTTP',
      host, port, username, password,
      label: `Singapore Mobile Proxy${plan ? ` • ${plan}` : ''} • ${port}`,
      country: null
    });
  }
  return { rows, total: list.length, inactive, noLogin };
}

// Gsocks (api.gsocks.net, "authorization: key <api_key>"): GET /proxy returns { proxies, count },
// then /proxy/<residential|mobile>-proxy-list/:id a host:port:user:pass text list (bare or { List }).
// The id field is undocumented (read as `id`, failing loudly). Not tested with a live key.
function gsocksProxyIds(body) {
  let json;
  try { json = typeof body === 'string' ? JSON.parse(body) : body; } catch { return { ids: [], listed: 0, total: 0 }; }
  const list = Array.isArray(json && json.proxies) ? json.proxies : [];
  const ids = [];
  for (const p of list) {
    const id = p && p.id;
    if ((typeof id === 'number' && Number.isInteger(id)) || (typeof id === 'string' && /^\d+$/.test(id))) ids.push(String(id));
  }
  const total = Number.parseInt(String(json && json.count), 10);
  return { ids, listed: list.length, total: Number.isInteger(total) ? total : list.length };
}
function gsocksListRows(body, { kind = 'Residential', id = '' } = {}) {
  let text = typeof body === 'string' ? body : '';
  if (typeof body !== 'string' && body && typeof body === 'object') text = body.List ?? body.list ?? '';
  const trimmed = String(text).trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('"')) {
    try {
      const j = JSON.parse(trimmed);
      text = typeof j === 'string' ? j : (j && (j.List ?? j.list)) || '';
    } catch { text = ''; }
  }
  const rows = [];
  const seen = new Set();
  for (const raw of String(text).split(/\r?\n|<br\s*\/?>/i)) {
    const line = raw.trim();
    if (!line) continue;
    // host:port:user:pass, and only the password may hold further colons.
    const parts = line.split(':');
    if (parts.length < 4) continue;
    const [host, portText, username] = parts;
    const password = parts.slice(3).join(':');
    const port = Number.parseInt(portText, 10);
    if (!/^[A-Za-z0-9.-]+$/.test(host) || !/^\d+$/.test(portText) || port < 1 || port > 65535 || !username || !password) continue;
    const key = `${host}:${port}:${username}:${password}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      type: 'HTTP',
      host, port, username, password,
      label: `Gsocks • ${kind}${id ? ` • #${id}` : ''}`,
      country: null,
      dedupeOnPassword: true
    });
  }
  return rows;
}

// Proxy Bonanza: GET /api/v1/userpackages-ippacks.json with "Authorization: <api_key>!<user_id>"
// returns { success, data: [{ ip, port_http, port_socks, login, password, countrycode, ... }] }
// for every IP on active plans. Not tested with a live key.
function proxyBonanzaRows(body, { socks = false } = {}) {
  let json;
  try { json = typeof body === 'string' ? JSON.parse(body) : body; } catch { return { rows: [], error: 'The API did not return JSON.' }; }
  if (!json || json.success !== true) {
    const msg = json && json.data && typeof json.data.message === 'string' ? json.data.message : 'The API reported a failure.';
    return { rows: [], error: msg };
  }
  const list = Array.isArray(json.data) ? json.data : [];
  const rows = [];
  const seen = new Set();
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const host = String(p.ip || '').trim();
    const port = Number.parseInt(String(socks ? p.port_socks : p.port_http), 10);
    const username = p.login != null ? String(p.login) : '';
    const password = p.password != null ? String(p.password) : '';
    if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !username || !password) continue;
    const key = `${host}:${port}:${username}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cc = String(p.countrycode || '').trim().toUpperCase();
    const place = String(p.georegion_name || '').trim();
    const code = /^[A-Z]{2}$/.test(cc) ? cc : '';
    rows.push({
      type: socks ? 'SOCKS5' : 'HTTP',
      host, port, username, password,
      label: `Proxy Bonanza • ${[place, code].filter(Boolean).join(', ') || 'Proxy'} • ${host}`,
      country: code || null
    });
  }
  return { rows, error: '', total: list.length };
}

// PROXY6: GET px6.link/api/<key>/getproxy/?state=active&nokey&limit=1000&page=<n> -> { list }.
// Failures are { status: "no", error_id, error } with HTTP 200. Version 5 (MTProto) is not a web proxy;
// type http/socks fixes a line's protocol, auto serves both. Not tested with a live key.
const PROXY6_VERSIONS = Object.freeze({ 3: 'IPv4 Shared', 4: 'IPv4', 6: 'IPv6' });
function proxy6ErrorMessage(errorId, error) {
  const id = Number(errorId);
  if (id === 100) return 'PROXY6 rejected the API key. Copy it again from your account.';
  if (id === 105) return 'PROXY6 refused this computer\'s IP. Your API key has an IP restriction; add this IP or remove the restriction in your account.';
  return `PROXY6: ${String(error || 'the API reported an error').trim()}${Number.isFinite(id) ? ` (code ${id})` : ''}.`;
}
function proxy6Page(body, { socks = false, now = Date.now() } = {}) {
  let json;
  try { json = typeof body === 'string' ? JSON.parse(body) : body; } catch { return { rows: [], listCount: 0, skippedProtocol: 0, error: 'PROXY6: the API did not return JSON.' }; }
  if (!json || json.status !== 'yes') {
    return { rows: [], listCount: 0, skippedProtocol: 0, error: proxy6ErrorMessage(json && json.error_id, json && json.error) };
  }
  // With nokey the list is an array; without it, an object keyed by proxy id.
  const list = Array.isArray(json.list) ? json.list : (json.list && typeof json.list === 'object' ? Object.values(json.list) : []);
  const rows = [];
  let skippedProtocol = 0;
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const version = PROXY6_VERSIONS[String(p.version)];
    if (!version || String(p.active) !== '1') continue;
    const end = Number(p.unixtime_end);
    if (Number.isFinite(end) && end > 0 && end * 1000 <= now) continue;
    const kind = String(p.type || '').toLowerCase();
    if (kind !== 'auto' && kind !== (socks ? 'socks' : 'http')) { skippedProtocol += 1; continue; }
    const host = String(p.host || '').trim();
    const port = Number.parseInt(String(p.port), 10);
    const username = p.user != null ? String(p.user) : '';
    const password = p.pass != null ? String(p.pass) : '';
    if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !username || !password) continue;
    const cc = String(p.country || '').trim().toUpperCase();
    const code = /^[A-Z]{2}$/.test(cc) ? cc : '';
    rows.push({
      type: socks ? 'SOCKS5' : 'HTTP',
      host, port, username, password,
      label: `PROXY6 • ${version}${code ? ` • ${code}` : ''}${p.id != null ? ` • #${p.id}` : ''}`,
      country: code || null
    });
  }
  return { rows, listCount: list.length, skippedProtocol, error: '' };
}

// CatProxies fixed IP, not tested with a live key. ISP: GET /generator/isp?orderId= gives a line per
// IP; the array key is undocumented, so it is found by its fields (pending = HTTP 202). Datacenter:
// GET /orders/:id has shared logins and ip_list by country/city (array or object); ports 1338 / 1339.
const CATPROXIES_DATACENTER_PORTS = Object.freeze({ http: 1338, socks: 1339 });
function catProxiesIspRows(json, { socks = false } = {}) {
  const root = (json && json.payload) || json;
  if (root && root.pending === true) return { rows: [], pending: true };
  const isLine = (l) => l && typeof l === 'object' && 'host' in l && ('port_http' in l || 'port_socks' in l);
  let lines = Array.isArray(root) ? root : [];
  if (!lines.some(isLine) && root && typeof root === 'object') {
    const found = Object.values(root).find((v) => Array.isArray(v) && v.some(isLine));
    lines = found || [];
  }
  const rows = [];
  const seen = new Set();
  for (const l of lines) {
    if (!isLine(l)) continue;
    const host = String(l.host || '').trim();
    const port = Number.parseInt(String(socks ? l.port_socks : l.port_http), 10);
    const username = l.login != null ? String(l.login) : '';
    const password = l.password != null ? String(l.password) : '';
    if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !username || !password) continue;
    const key = `${host}:${port}:${username}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const exit = String(l.ip || host).trim();
    rows.push({ type: socks ? 'SOCKS5' : 'HTTP', host, port, username, password, label: `CatProxies • ISP • ${exit}`, country: null });
  }
  return { rows, pending: false };
}
function catProxiesDatacenterRows(json, { socks = false } = {}) {
  const order = (json && (json.payload && json.payload.order)) || (json && json.order) || (json && json.payload) || json || {};
  const proxy = (order && order.proxy) || {};
  const username = typeof proxy.username === 'string' ? proxy.username.trim() : '';
  const password = typeof proxy.password === 'string' ? proxy.password : '';
  const ipList = order.ip_list || proxy.ip_list;
  const groups = Array.isArray(ipList) ? ipList.map((g) => [null, g])
    : (ipList && typeof ipList === 'object' ? Object.entries(ipList) : []);
  const port = socks ? CATPROXIES_DATACENTER_PORTS.socks : CATPROXIES_DATACENTER_PORTS.http;
  const rows = [];
  const seen = new Set();
  if (!username || !password) return rows;
  for (const [groupKey, group] of groups) {
    if (!group || typeof group !== 'object') continue;
    const rawCc = String(groupKey || group.country || group.country_code || group.code || '').trim().toUpperCase();
    const cc = /^[A-Z]{2}$/.test(rawCc) ? rawCc : '';
    for (const city of Array.isArray(group.cities) ? group.cities : []) {
      for (const entry of Array.isArray(city && city.ips) ? city.ips : []) {
        const host = String(entry && typeof entry === 'object' ? entry.ip : entry || '').trim();
        if (!host || /[\s/@?#]/.test(host) || seen.has(host)) continue;
        seen.add(host);
        rows.push({ type: socks ? 'SOCKS5' : 'HTTP', host, port, username, password, label: `CatProxies • Datacenter${cc ? ` • ${cc}` : ''} • ${host}`, country: cc || null });
      }
    }
  }
  return rows;
}

module.exports = {
  ipBurgerBaseUser,
  ipBurgerUsername,
  proxy302Token,
  proxy302CountryId,
  proxy302Row,
  rapidProxySid,
  froxyBasePassword,
  medianMs,
  LIVEPROXIES_GATEWAY,
  liveProxiesBaseUser,
  liveProxiesUsername,
  liveProxiesStickyHost,
  pickGeoConsensus,
  mobileProxySpaceRows,
  proxySolutionsPage,
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
  maskProxySellerKey,
  proxySellerListItems,
  proxySellerListGeo,
  proxySellerGeoView,
  parseHostPort,
  marsProxiesLocation,
  parseMarsProxiesList,
  nodeMavenTtl,
  nodeMavenUsername,
  froxyType,
  froxyPassword,
  packetStreamPassword, packetStreamCountry,
  airproxyRows,
  catProxiesResiUsername,
  catProxiesMobileUsername,
  catProxiesCreds,
  parseProxidizePerProxy,
  proxidizeGeoToken,
  proxidizePerGbUsername,
  proxmintUsername, proxmintPickProduct,
  databayUsername,
  ipfoxyUsername, mangoProxyRows,
  twoExtractBaseUser, twoExtractCountry, twoExtractUsername,
  gonzoProxyBaseLogin, gonzoProxyUsername,
  SIMPLYPROXIES_NETWORKS, simplyProxiesUsername,
  coroniumRows,
  singaporeMobileProxyRows,
  gsocksProxyIds, gsocksListRows,
  proxyBonanzaRows,
  proxy6Page, 
  catProxiesIspRows, catProxiesDatacenterRows
};
