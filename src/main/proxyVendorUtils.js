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

// GET proxy/list/{type} pages with page and per_page (default 100) and reports total_pages.
// A response without paging fields is the whole list.
const PROXY_SELLER_PAGE_SIZE = 100;
function proxySellerPageInfo(data) {
  const items = data && Array.isArray(data.items) ? data.items : [];
  const num = (v) => { const n = Number.parseInt(String(v), 10); return Number.isInteger(n) && n > 0 ? n : null; };
  return {
    items,
    page: num(data && data.page),
    perPage: num(data && data.per_page),
    totalPages: num(data && data.total_pages)
  };
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
// ("http", "socks5"), not the number. The OpenAPI example names the HTTP port "http"; the GitBook
// docs name it "http|https", so both forms count as the HTTP port.
const IPROYAL_HTTP_PORT_NAME = /^https?(?:\|https?)?$/i;
function pickIpRoyalPort(nodes, socks) {
  const list = Array.isArray(nodes) ? nodes : [];
  const want = socks ? /socks/i : IPROYAL_HTTP_PORT_NAME;
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

// The generate call caps proxy_count at a server setting the spec does not publish. A request over
// it fails validation as "The proxy count field must not be greater than N.", so read N back.
function ipRoyalMaxCount(message) {
  const m = /proxy[ _]count[^.]*?greater than (\d+)/i.exec(String(message || ''));
  const n = m ? Number.parseInt(m[1], 10) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}
// The spec words the same refusal without a number: "The proxy count field must be between 1 and
// the configured proxy_list_max_quantity." The caller then retries with a smaller batch.
function ipRoyalCountRefused(message) {
  const s = String(message || '');
  return /proxy[ _]count/i.test(s) && /(between|greater than|max_quantity|maximum)/i.test(s);
}

// IPRoyal-style sticky lifetime ("{n}m" or "{n}h", 1 second to 168 hours) from a Keep same IP time in
// minutes; '' when blank, so the API default applies. MarsProxies uses the same rule.
function ipRoyalLifetimeFromMinutes(minutes) {
  const m = Number.parseInt(String(minutes == null ? '' : minutes), 10);
  if (!Number.isInteger(m) || m <= 0) return '';
  if (m < 60) return `${m}m`;
  if (m % 60 === 0) return `${Math.min(168, m / 60)}h`;
  return `${Math.min(168, Math.ceil(m / 60))}h`;
}

// ---- Session-minting gateways (Oxylabs, Decodo, Bright Data, Apify, AnyIP) ----
// Each vendor reads targeting and the sticky session from the proxy username.

// A place name as a username token: plain ASCII, lower case, words joined by `joiner`. Hyphens and
// commas are dropped because they start the next flag.
function placeToken(value, joiner = '_') {
  const out = String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase().replace(/[\s_-]+/g, joiner);
  return out.replace(joiner ? /[^a-z0-9_]/g : /[^a-z0-9]/g, '').replace(/^_+|_+$/g, '');
}

function isoCountry(value) {
  const v = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : '';
}

// Oxylabs residential (pr.oxylabs.io:7777): customer-USER-cc-US-city-los_angeles-sessid-x-sesstime-30.
// The docs pair a city with cc, and give st (US states only, us_ prefix) on its own.
const OXYLABS_FLAGS = /-(?:cc|city|st|cn|postalcode|sessid|sesstime|asn|geohash|geohash_fallback)-[^-]*/gi;
const OXYLABS_MAX_SESSTIME = 1440;
function oxylabsBaseUser(raw) {
  const user = String(raw || '').trim().replace(OXYLABS_FLAGS, '');
  if (!user) return '';
  return /^customer-/i.test(user) ? user : `customer-${user}`;
}
function oxylabsUsername(base, { country, state, city, session, minutes } = {}) {
  const parts = [base];
  const cc = isoCountry(country);
  const ct = placeToken(city, '_');
  const st = placeToken(state, '_').replace(/^us_/, '');
  if (cc && ct) parts.push(`cc-${cc}`, `city-${ct}`);
  else if (st && (!cc || cc === 'US')) parts.push(`st-us_${st}`);
  else if (cc) parts.push(`cc-${cc}`);
  if (session) {
    parts.push(`sessid-${session}`);
    const m = Number.parseInt(String(minutes), 10);
    if (Number.isFinite(m) && m > 0) parts.push(`sesstime-${Math.min(OXYLABS_MAX_SESSTIME, m)}`);
  }
  return parts.join('-');
}

// Decodo, formerly Smartproxy (gate.decodo.com:7000, HTTP and SOCKS5):
// user-USER-country-us-city-new_york-session-x-sessionduration-30. state is US only (us_ prefix);
// the docs ask for one of city or state.
const DECODO_FLAGS = /-(?:country|state|city|zip|asn|continent|session|sessionduration|geohash)-[^-]*/gi;
const DECODO_MAX_DURATION = 1440;
function decodoBaseUser(raw) {
  const user = String(raw || '').trim().replace(DECODO_FLAGS, '');
  if (!user) return '';
  return /^user-/i.test(user) ? user : `user-${user}`;
}
function decodoUsername(base, { country, state, city, session, minutes } = {}) {
  const parts = [base];
  const cc = isoCountry(country).toLowerCase();
  const ct = placeToken(city, '_');
  const st = placeToken(state, '_').replace(/^us_/, '');
  if (cc) parts.push(`country-${cc}`);
  if (cc && ct) parts.push(`city-${ct}`);
  else if (st && cc === 'us') parts.push(`state-us_${st}`);
  if (session) {
    parts.push(`session-${session}`);
    const m = Number.parseInt(String(minutes), 10);
    if (Number.isFinite(m) && m > 0) parts.push(`sessionduration-${Math.min(DECODO_MAX_DURATION, m)}`);
  }
  return parts.join('-');
}

// Bright Data: brd-customer-<id>-zone-<zone>[-key-value...]. Pasted targeting and session flags are
// dropped so each row sets its own; other flags (os, for one) are kept.
const BRIGHTDATA_OWN_FLAGS = new Set(['country', 'state', 'city', 'zip', 'asn', 'session', 'ip']);
function brightDataZoneUser(raw) {
  const m = /^(brd-customer-[^-\s]+-zone-[^-\s]+)((?:-[^-\s]+)*)$/.exec(String(raw || '').trim());
  if (!m) return null;
  const tokens = m[2].split('-').filter(Boolean);
  const kept = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    if (!BRIGHTDATA_OWN_FLAGS.has(tokens[i].toLowerCase())) kept.push(tokens[i], tokens[i + 1]);
  }
  return { base: [m[1], ...kept].join('-'), zone: m[1].split('-zone-')[1] };
}
// US states by name, for the two-letter code Bright Data's -state- flag takes (-country-us-state-ny).
const US_STATE_CODES = Object.freeze({
  alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar', california: 'ca', colorado: 'co', connecticut: 'ct',
  delaware: 'de', districtofcolumbia: 'dc', florida: 'fl', georgia: 'ga', hawaii: 'hi', idaho: 'id', illinois: 'il',
  indiana: 'in', iowa: 'ia', kansas: 'ks', kentucky: 'ky', louisiana: 'la', maine: 'me', maryland: 'md',
  massachusetts: 'ma', michigan: 'mi', minnesota: 'mn', mississippi: 'ms', missouri: 'mo', montana: 'mt',
  nebraska: 'ne', nevada: 'nv', newhampshire: 'nh', newjersey: 'nj', newmexico: 'nm', newyork: 'ny',
  northcarolina: 'nc', northdakota: 'nd', ohio: 'oh', oklahoma: 'ok', oregon: 'or', pennsylvania: 'pa',
  rhodeisland: 'ri', southcarolina: 'sc', southdakota: 'sd', tennessee: 'tn', texas: 'tx', utah: 'ut',
  vermont: 'vt', virginia: 'va', washington: 'wa', westvirginia: 'wv', wisconsin: 'wi', wyoming: 'wy'
});
// A US state as Bright Data's two-letter code: a code is kept, a full name is mapped, anything else
// is '' so the caller can refuse it instead of sending a state Bright Data does not know.
function brightDataState(value) {
  const t = placeToken(value, '');
  if (!t) return '';
  if (/^[a-z]{2}$/.test(t) && Object.values(US_STATE_CODES).includes(t)) return t;
  return US_STATE_CODES[t] || '';
}
// Country works on every network; state (US, as its two-letter code) and city are residential only
// and need the country.
function brightDataUsername(base, { country, state, city, session } = {}) {
  const parts = [base];
  const cc = isoCountry(country).toLowerCase();
  const ct = placeToken(city, '');
  const st = brightDataState(state);
  if (cc) parts.push(`country-${cc}`);
  if (cc && ct) parts.push(`city-${ct}`);
  else if (cc === 'us' && st) parts.push(`state-${st}`);
  if (session) parts.push(`session-${session}`);
  return parts.join('-');
}
// GET /zone/route_ips: one IP per line, or [{ ip, country }] with list_countries=true.
function brightDataRouteIps(text) {
  const raw = String(text || '').trim();
  let items = [];
  if (raw.startsWith('[')) {
    try {
      items = JSON.parse(raw);
    } catch (e) {
      // The docs example ends the array with a trailing comma, which JSON.parse refuses.
      items = [...raw.matchAll(/\{[^{}]*\}/g)].map((m) => { try { return JSON.parse(m[0]); } catch (err) { return null; } });
    }
  } else {
    items = raw.split(/\r?\n/).map((ip) => ({ ip }));
  }
  const out = [];
  const seen = new Set();
  for (const it of Array.isArray(items) ? items : []) {
    const ip = String((it && (typeof it === 'string' ? it : it.ip)) || '').trim();
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || seen.has(ip)) continue;
    seen.add(ip);
    out.push({ ip, country: isoCountry(it && it.country) || null });
  }
  return out;
}

// Apify residential (proxy.apify.com:8000): groups-RESIDENTIAL,country-JP,session-x, and a US state
// as country-US_CA. Session names allow letters, digits, '.', '_' and '~', up to 50 characters.
function apifyUsername({ country, state, session } = {}) {
  const parts = ['groups-RESIDENTIAL'];
  const cc = isoCountry(country);
  const st = String(state || '').trim().toUpperCase();
  if (cc) parts.push(cc === 'US' && /^[A-Z]{2}$/.test(st) ? `country-US_${st}` : `country-${cc}`);
  const sid = String(session || '').replace(/[^A-Za-z0-9._~]/g, '').slice(0, 50);
  if (sid) parts.push(`session-${sid}`);
  return parts.join(',');
}

// AnyIP region and city values are lower case with the spaces removed ("newyork",
// "districtofcolumbia"), as dashboard.anyip.io/api/data/region and /city list them.
function anyIpPlace(value) {
  return placeToken(value, '');
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
// <login>-country-<cc>-region-<r>-city-<c>-type-<residential|mobile>-sid-<id>-ttl-<t>-filter-<f>-ipv4-true.
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
function nodeMavenUsername(login, { country, region, city, isp, type, sid, ttl, filter, ipv4 } = {}) {
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
  // NodeMaven mixes IPv4 and IPv6 exits unless -ipv4-true asks for IPv4 only.
  if (ipv4 === true) parts.push('ipv4', 'true');
  return parts.join('-');
}

// Froxy (proxy.froxy.com, ports 9000-9999 up to the package's port count; help.froxy.com). Login is
// the package; password is "<type>;<country>;<region>;<city>;<provider>". There is no session token:
// each port holds its own exit IP until the forced rotation set in the dashboard (90-3600 s).
// The dashboard shows "qwerty;;;;", so only the text before the first ';' is the base. Froxy reports
// a malformed password as an IP-whitelist error.
// Froxy's password type words: wifi (Residential), mobile, shared (Datacenter plans, plan ids
// datacenter-*) and fast (the separate Fast residential product).
const FROXY_TYPE_WORDS = Object.freeze({ wifi: 'residential', mobile: 'mobile', shared: 'datacenter', fast: 'fast' });
function froxyType(poolType) {
  const t = String(poolType || '').trim().toLowerCase();
  if (t === 'mobile') return 'mobile';
  if (t === 'datacenter' || t === 'shared') return 'shared';
  if (t === 'fast') return 'fast';
  return 'wifi';
}
function froxyField(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, '+').replace(/[^a-z0-9+]/g, '');
}
function froxyBasePassword(pasted) {
  return String(pasted == null ? '' : pasted).split(';')[0].trim();
}
// The pool a pasted password names by its type word ('residential', 'mobile', 'datacenter', 'fast'),
// or '' when its first field is a real secret rather than a type word.
function froxyPastedPool(pasted) {
  return FROXY_TYPE_WORDS[froxyBasePassword(pasted).toLowerCase()] || '';
}
// The first field of a Froxy "password" is the subscription's type word as the dashboard shows it
// ("wifi;;;;", "mobile;;;;"), or a real secret. Either is kept as pasted: each subscription has its
// own login, so a type word that does not match it is refused by Froxy. fetchFroxyPool stops a Pool
// type that disagrees with the pasted word instead of rewriting it.
function froxyPassword(base, { country, region, city } = {}) {
  const cc = String(country || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  const head = froxyBasePassword(base);
  return [head, /^[a-z]{2}$/.test(cc) ? cc : '', froxyField(region), froxyField(city), ''].join(';');
}

// PacketStream: one gateway (proxy.packetstream.io: 31111 HTTPS, 31112 HTTP, 31113 SOCKS5). Country and
// session go on the auth key, the proxy password (<key>_country-UnitedStates_session-ab12cd). Countries
// are the English dashboard names without spaces, the 126 its dashboard offers. PacketStream's docs now
// show ISO codes (_country-US), but a code was ignored in our live test of 6 Oct 2026 (the exit landed
// anywhere), so the names stay until a live re-test shows codes work.
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

// Airproxy dedicated mobile proxies, all in Italy. GET /api/proxy/list/ returns { proxies: [{ id, ip,
// port, username, password, isp, in_use_till, ... }], count, success }. The list names one port; our
// dashboard read of 29 Sep 2026 showed HTTP and SOCKS5 on it, which Airproxy's public pages do not state,
// so SOCKS5 is the user's choice and HTTP stays the default.
const AIRPROXY_COUNTRY = 'IT';
function airproxyRows(body, { socks = false } = {}) {
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
      type: socks ? 'SOCKS5' : 'HTTP',
      host, port, username, password,
      label: `Airproxy • Mobile • IT${isp ? ` • ${isp}` : ''}${id ? ` • #${id}` : ''}`,
      country: AIRPROXY_COUNTRY
    });
  }
  return rows;
}

// CatProxies rotating pools (catproxies.com/docs/api): targeting goes on the username, password
// unchanged. Residential: <base>-type-residential[-country-<cc>][-state-..][-city-..]
// [-lifetime-<1-1440 min>-session-<id>]; state and city are each optional. Mobile:
// <base>[-country-<CC>][-region-..][-city-..][-sid-<id>[-ttl-<n>m]]. Country case follows the docs.
const CATPROXIES_RESI_MAX_LIFETIME = 1440;
function catProxiesResiUsername(base, { country, state, city, session, lifetimeMin } = {}) {
  let u = `${String(base || '').trim()}-type-residential`;
  const code = (v) => String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  const cc = code(country);
  const hasCc = /^[a-z]{2}$/.test(cc);
  if (hasCc) u += `-country-${cc}`;
  const st = hasCc ? code(state) : '';
  if (st) u += `-state-${st}`;
  const ct = hasCc ? code(city) : '';
  if (ct) u += `-city-${ct}`;
  const sid = String(session || '').trim().replace(/[^A-Za-z0-9]/g, '');
  const life = Number(lifetimeMin);
  if (sid && Number.isInteger(life) && life > 0) u += `-lifetime-${Math.min(life, CATPROXIES_RESI_MAX_LIFETIME)}-session-${sid}`;
  return u;
}
// The mobile gateway accepts only these sticky TTLs and fails on any other, so a longer pick holds
// for the longest allowed one (4 hours).
const CATPROXIES_MOBILE_TTLS = Object.freeze([1, 5, 10, 30, 60, 120, 180, 240]);
function catProxiesMobileTtl(minutes) {
  const n = Number(minutes);
  if (!Number.isInteger(n) || n < 1) return 0;
  return CATPROXIES_MOBILE_TTLS.filter((t) => t <= n).pop();
}
function catProxiesMobileUsername(base, { country, region, city, session, ttlMin } = {}) {
  let u = String(base || '').trim();
  const cc = String(country || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  const hasCc = /^[A-Z]{2}$/.test(cc);
  if (hasCc) u += `-country-${cc}`;
  // Multi-word places use '+', as the docs show for cities ("los+angeles").
  const place = (v) => (hasCc ? String(v || '').trim().toLowerCase().replace(/\s+/g, '+').replace(/[^a-z0-9+]/g, '') : '');
  const rg = place(region);
  if (rg) u += `-region-${rg}`;
  const ct = place(city);
  if (ct) u += `-city-${ct}`;
  const sid = String(session || '').trim().replace(/[^A-Za-z0-9]/g, '');
  const ttl = catProxiesMobileTtl(ttlMin);
  if (sid) u += ttl ? `-sid-${sid}-ttl-${ttl}m` : `-sid-${sid}`;
  return u;
}
// CatProxies Premium Residential (resix): <region>.premium.catproxies.com, with the targeting on the
// password, not the username. The first flag joins with '-', every later one with '_':
// <pass>-country-gb_city-london_session-a1b2c3d4_lifetime-1h. A state is US-only and cannot be combined
// with a city; a session id is exactly 8 lowercase letters or digits; lifetime is 30m, 1h, 24h and so on,
// up to 168 hours (catproxies.com/docs/api, Premium Residential).
const CATPROXIES_PREMIUM_MAX_LIFETIME = 168 * 60;
function catProxiesPremiumSession(id) {
  const raw = String(id || '').trim().toLowerCase();
  if (!raw) return '';
  if (/^[a-z0-9]{8}$/.test(raw)) return raw;
  // Two FNV-1a hashes give a stable 8-character id for any session name.
  let a = 2166136261;
  let b = 0x9747b28c;
  for (const ch of raw) {
    const c = ch.codePointAt(0);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = Math.imul(b ^ c, 16777619) >>> 0;
  }
  return a.toString(36).padStart(7, '0').slice(-4) + b.toString(36).padStart(7, '0').slice(-4);
}
function catProxiesPremiumLifetime(minutes) {
  const m = Number(minutes);
  if (!Number.isInteger(m) || m < 1) return '';
  const c = Math.min(m, CATPROXIES_PREMIUM_MAX_LIFETIME);
  return c % 60 === 0 ? `${c / 60}h` : `${c}m`;
}
function catProxiesPremiumPassword(base, { country, state, city, session, lifetimeMin } = {}) {
  const pass = base != null ? String(base) : '';
  const flags = [];
  const cc = String(country || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  const hasCc = /^[a-z]{2}$/.test(cc);
  if (hasCc) flags.push(`country-${cc}`);
  const place = (v) => (hasCc ? String(v || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '') : '');
  const ct = place(city);
  const st = cc === 'us' ? place(state) : '';
  if (ct) flags.push(`city-${ct}`);
  else if (st) flags.push(`state-${st}`);
  const sid = catProxiesPremiumSession(session);
  if (sid) {
    flags.push(`session-${sid}`);
    const life = catProxiesPremiumLifetime(lifetimeMin);
    if (life) flags.push(`lifetime-${life}`);
  }
  return flags.length ? `${pass}-${flags.join('_')}` : pass;
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
// GET /perproxy/proxies/{username}, paged as { perPage, page, total, data }. Per-GB usernames
// (help.proxidize.com, Per GB Connection Details) are <base>[-s-<session>][-co-<CC>][-st-<State>]
// [-ci-<City>], plus -type-residential last on Residential, on pg.proxi.es (20000 HTTP, 20002 SOCKS5).
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
// Next page to request from a paged per-proxy reply, or 0 when the list is complete. A bare array or
// a reply without paging fields is one page.
function proxidizeNextPage(data, page) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.data) || !data.data.length) return 0;
  const per = Number(data.perPage);
  const total = Number(data.total);
  if (!(per > 0) && !Number.isFinite(total)) return 0;
  if (Number.isFinite(total) && page * (per > 0 ? per : data.data.length) >= total) return 0;
  if (per > 0 && data.data.length < per) return 0;
  return page + 1;
}
// Walks the per-proxy pages through fetchPage(page) until the list ends, `want` rows are in hand,
// a page adds nothing new (a server that ignores `page`) or maxPages is reached.
async function collectProxidizePerProxy(fetchPage, { socks = false, want = 0, maxPages = 50 } = {}) {
  const rows = [];
  const seen = new Set();
  let page = 1;
  while (page && page <= maxPages) {
    const data = await fetchPage(page);
    let added = 0;
    for (const r of parseProxidizePerProxy(data, { socks })) {
      const key = `${r.host}:${r.port}:${r.username}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(r);
      added += 1;
    }
    if (!added || (want > 0 && rows.length >= want)) break;
    page = proxidizeNextPage(data, page);
  }
  return want > 0 ? rows.slice(0, want) : rows;
}
// Country is a two-letter code; state and city are names without spaces ("-st-Texas").
function proxidizeGeoToken({ country, state, city } = {}) {
  const place = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '');
  const co = String(country || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(co)) return '';
  let out = `-co-${co}`;
  const st = place(state);
  if (st) out += `-st-${st}`;
  const ci = place(city);
  if (ci) out += `-ci-${ci}`;
  return out;
}
function proxidizePerGbUsername(base, { country, state, city, session, residential = false } = {}) {
  const u = String(base || '').trim().replace(/-type-residential$/i, '');
  if (!u) return '';
  let out = u;
  const sid = String(session || '').trim().replace(/[^A-Za-z0-9]/g, '').slice(0, 256);
  if (sid) out += `-s-${sid}`;
  out += proxidizeGeoToken({ country, state, city });
  if (residential) out += '-type-residential';
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
// Rotating b2b.liveproxies.io:7383 (user LV00000-lv_us); sticky b2b-s<N>, user -<1-8 digits>, held up
// to 60 min on residential (30 on mobile); SOCKS5 socks.liveproxies.io:1080. Country is "lv_" + the
// lowercase ISO-2 code. The examples use the made-up account LV00000.
const LIVEPROXIES_GATEWAY = Object.freeze({ http: 'b2b.liveproxies.io', port: 7383, socksHost: 'socks.liveproxies.io', socksPort: 1080 });
// A sticky session id is 1 to 8 digits, as the dashboard's Proxy Generation panel makes them.
const LIVEPROXIES_SID_MAX = 8;
function liveProxiesBaseUser(raw) {
  // Accept "LV00000" or a full generated username ("LV00000-lv_us-123") and keep the account part.
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

// NOVADA (super.novada.pro:7777; another host shown for the account in the dashboard endpoint
// generator goes through the override). Auth is a proxy user from Users, Add User, not the login
// email. Lowercase, no spaces:
// <user>-zone-<res|isp|mob>[-region-<cc>[-st-<state>][-city-<city>]][-session-<id>-sessTime-<min>]
// sessTime runs up to 120 minutes on Residential and Mobile, and up to 360 on Rotating ISP.
const NOVADA_ZONES = Object.freeze({ residential: 'res', isp: 'isp', mobile: 'mob' });
const NOVADA_MAX_SESSTIME = Object.freeze({ res: 120, isp: 360, mob: 120 });
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
    const mins = Number.isInteger(m) && m > 0 ? Math.min(m, NOVADA_MAX_SESSTIME[zone]) : 10;
    user += `-session-${sid}-sessTime-${mins}`;
  }
  return user;
}

// Proxies.sx (gw.proxies.sx, 7000 HTTP, 7001 SOCKS5) lowercases the username and splits it on '-':
// psx_<acct>-<mbl|peer>-<cc>[-iptype-residential][-state-<xx>][-city-<name>]
// (-sid-<id>[-ttl-<seconds>]-rot-sticky|-rot-ondemand)-failover-strict.
// Never best/any (they cross pools); failover-strict errors on an out-of-stock country instead of
// exiting elsewhere. Without a rot token the gateway moves the exit every 10 minutes (auto10), so a
// rotating row asks for ondemand: a new endpoint on each connection. State and city are peer-only.
// The peer network mixes residential and mobile devices, so the Residential choice adds the hard
// -iptype-residential filter (agents.proxies.sx/pool/skill.md). -ttl- is the session record's life in
// seconds (60 to 2592000, default 3600); it does not promise the IP, which leaves when its device does.
const PROXIESSX_TTL_MIN_S = 60;
const PROXIESSX_TTL_MAX_S = 2592000;
const PROXIESSX_POOLS = Object.freeze({ mobile: 'mbl', residential: 'peer' });
// The carrier-modem pool (mbl) runs in these six countries only; GE is Georgia.
const PROXIESSX_MOBILE_COUNTRIES = Object.freeze(['US', 'GB', 'FR', 'NL', 'PL', 'GE']);
// The gateway refuses more than 250 concurrent sessions (distinct sids) per account (E_SESSION_LIMIT).
const PROXIESSX_MAX_SESSIONS = 250;
function proxiesSxSid(prefix, index) {
  // Pad short ids on the left: callers number sessions ('ab1', 'ab10'), and right-padding would make
  // them collide. Minimum total length 8.
  let core = String(prefix || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (index != null) core = `${core}_${index}`;
  if (core.length >= 8) return core.slice(0, 64);
  return `sg_${core.padStart(5, '0')}`.slice(0, 64);
}
function proxiesSxUsername(login, { poolType, country, sid, state, city, ttlSeconds } = {}) {
  const acct = String(login || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  const pool = PROXIESSX_POOLS[String(poolType || '').toLowerCase()] || PROXIESSX_POOLS.mobile;
  const cc = String(country || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!acct || !/^[a-z]{2}$/.test(cc)) return '';
  let user = `${acct}-${pool}-${cc}`;
  if (pool === PROXIESSX_POOLS.residential) {
    user += '-iptype-residential';
    // State is the 2-letter region code (-state-ca, never -state-california).
    const st = String(state || '').trim().toLowerCase();
    if (/^[a-z]{2}$/.test(st)) user += `-state-${st}`;
    const ct = String(city || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 64);
    if (ct) user += `-city-${ct}`;
  }
  const s = String(sid || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  const ttl = Number(ttlSeconds);
  const ttlTag = s && Number.isInteger(ttl) && ttl > 0 ? `-ttl-${Math.min(PROXIESSX_TTL_MAX_S, Math.max(PROXIESSX_TTL_MIN_S, ttl))}` : '';
  user += s ? `-sid-${s}${ttlTag}-rot-sticky` : '-rot-ondemand';
  return `${user}-failover-strict`;
}
// Routable endpoints for one pool and country from GET /v1/gateway/pool/stock (public, counts only):
// { pools: { mbl: { us: 27 }, peer: { de: 310 } } }. A country with no stock is left out, so a missing
// entry is 0. Returns null when the body is not that shape, so the caller can skip the check.
function proxiesSxStock(body, poolType, country) {
  let data;
  try { data = typeof body === 'string' ? JSON.parse(body) : body; } catch { return null; }
  const pools = data && typeof data === 'object' ? data.pools : null;
  const pool = PROXIESSX_POOLS[String(poolType || '').toLowerCase()] || PROXIESSX_POOLS.mobile;
  if (!pools || typeof pools !== 'object' || !pools[pool] || typeof pools[pool] !== 'object') return null;
  const n = Number(pools[pool][String(country || '').trim().toLowerCase()]);
  return Number.isFinite(n) && n > 0 ? n : 0;
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

// MobileProxy.Space: GET mpsapi.com/api.html?command=get_my_proxy (Bearer) -> { status: 'ok', list };
// one docs sample is a bare array instead. Errors are { status: 'err', message }, and some commands
// answer 'OK', so status is compared without case. Each proxy has one login, separate HTTP/SOCKS5
// ports; numbers may be strings, and proxy_exp stays vendor text (Moscow time). The equipment-independent
// address (proxy_independent_http_hostname / _socks5_hostname, or their _host_ip, on
// proxy_independent_port) survives a device change, so it wins over proxy_host_ip and the per-protocol
// ports when the proxy has one (github.com/mobileproxy/api-docs, openapi.yaml, schema Proxy).
// `countries` maps id_country to an ISO code (mobileProxySpaceCountries), so a row carries its country.
function mobileProxySpaceCountries(body) {
  let data;
  try { data = typeof body === 'string' ? JSON.parse(body) : body; } catch { return {}; }
  const list = data && Array.isArray(data.id_country) ? data.id_country : [];
  const out = {};
  for (const c of list) {
    const iso = String((c && c.iso) || '').trim().toUpperCase();
    if (c && c.id_country != null && /^[A-Z]{2}$/.test(iso)) out[String(c.id_country)] = iso;
  }
  return out;
}
function mobileProxySpaceRows(body, { socks = false, countries = null } = {}) {
  let data;
  try { data = typeof body === 'string' ? JSON.parse(body) : body; } catch { return { error: 'bad-json', rows: [] }; }
  if (!data || typeof data !== 'object') return { error: 'bad-json', rows: [] };
  if (!Array.isArray(data) && data.status && String(data.status).toLowerCase() !== 'ok') return { error: String(data.message || data.status), rows: [] };
  const list = Array.isArray(data) ? data : (Array.isArray(data.list) ? data.list : []);
  const rows = [];
  const seen = new Set();
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const indHost = String((socks
      ? (p.proxy_independent_socks5_hostname || p.proxy_independent_socks5_host_ip)
      : (p.proxy_independent_http_hostname || p.proxy_independent_http_host_ip)) || '').trim();
    const indPort = Number.parseInt(String(p.proxy_independent_port), 10);
    const independent = Boolean(indHost) && !/[\s/@?#]/.test(indHost) && Number.isInteger(indPort) && indPort >= 1 && indPort <= 65535;
    const host = independent ? indHost : String(p.proxy_host_ip || p.proxy_hostname || '').trim();
    const port = independent ? indPort : Number.parseInt(String(socks ? p.proxy_socks5_port : p.proxy_http_port), 10);
    const username = p.proxy_login != null ? String(p.proxy_login) : '';
    const password = p.proxy_pass != null ? String(p.proxy_pass) : '';
    if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !username || !password) continue;
    const key = `${host}:${port}:${username}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const geo = String(p.proxy_geo || '').trim();
    const op = String(p.proxy_operator || '').trim();
    const exp = String(p.proxy_exp || '').trim();
    const iso = countries && p.id_country != null ? String(countries[String(p.id_country)] || '') : '';
    rows.push({
      type: socks ? 'SOCKS5' : 'HTTP',
      host, port, username, password,
      label: `MobileProxy.Space • ${[geo, op].filter(Boolean).join(' • ') || 'Mobile'}${p.proxy_id != null ? ` • #${p.proxy_id}` : ''}${exp ? ` • until ${exp}` : ''}`,
      country: /^[A-Z]{2}$/.test(iso) ? iso : null
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
// The API names premium residential 'premium-residential' (proxmint.com/docs/api); the form keeps
// its own key, which is accepted too.
const PROXMINT_API_PRODUCTS = Object.freeze({
  residential: ['residential'],
  residential_premium: ['premium-residential', 'residential_premium'],
  mobile: ['mobile'],
  datacenter: ['datacenter']
});
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
  const match = products.find((p) => p && PROXMINT_API_PRODUCTS[want].includes(p.product) && p.status === 'active');
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
// -stateName-<s>-cityName-<c>-sessionId-<id>-sessionLength-<min>. Only the most specific location is
// sent; state and city exist on Residential only. Sticky sessions last up to 120 minutes, 30 on
// Residential Flex (zone residential_FLEX, country only) (docs.databay.com, Network Types).
const DATABAY_ZONES = Object.freeze(['residential', 'residential_FLEX', 'mobile', 'datacenter']);
const DATABAY_MAX_SESSION = Object.freeze({ residential: 120, residential_FLEX: 30, mobile: 120, datacenter: 120 });
function databayZone(value) {
  const v = String(value || '').trim().toLowerCase();
  return DATABAY_ZONES.find((z) => z.toLowerCase() === v) || 'residential';
}
// Hyphen is the parameter separator, so inside a value the Connection String page asks for %2D, and %20
// for a space (Winston-Salem -> Winston%2DSalem, Los Angeles -> Los%20Angeles). A value typed already
// encoded is read back first; an underscore counts as a space.
function databayGeoValue(v) {
  const plain = String(v || '').replace(/%2D/gi, '-').replace(/%20/g, ' ').replace(/_+/g, ' ')
    .replace(/[^\p{L}\p{N} .'-]/gu, '').replace(/\s*-\s*/g, '-').replace(/-+/g, '-').replace(/\s+/g, ' ')
    .trim().replace(/^-+|-+$/g, '').slice(0, 60);
  return plain.replace(/-/g, '%2D').replace(/ /g, '%20');
}
function databayUsername(base, { zone, country, state, city, session, lengthMin } = {}) {
  const user = String(base || '').trim().replace(/-zone-.*$/i, '');
  if (!user) return '';
  const z = databayZone(zone);
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
    const len = Math.min(DATABAY_MAX_SESSION[z], Math.max(1, Number.parseInt(String(lengthMin), 10) || 30));
    u += `-sessionId-${sid}-sessionLength-${len}`;
  }
  return u;
}

// IPFoxy rotating residential: gate.ipfoxy.io and the gate-us/-sg/-de routes, port 58688 (HTTP and
// SOCKS5). Username: customer-<user>-cc-US-st-Florida-city-Miami-sessid-<id>-ttl-<min>; -ttl- goes
// last, sticky only, and takes 30 (the default) or 60 (ipfoxy.com/help/docs/session-time), so other
// lifetimes snap to one of those. Built from the docs; not tested with a live key.
function ipfoxyTtl(min) {
  const m = Number.parseInt(String(min), 10);
  if (!Number.isInteger(m) || m <= 0) return 0;
  return m > 30 ? 60 : 30;
}
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
    const ttl = ipfoxyTtl(ttlMin);
    if (ttl) user += `-ttl-${ttl}`;
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
// Location values are lowercase with no spaces, as in Mango's location lists (california, losangeles).
function mangoProxyPlace(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, '');
}
// The API takes an ASN as AS<number> (GenerateConnectionDetailsDto.asn); a bare number gets the prefix.
function mangoProxyAsn(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const m = /^(?:AS)?(\d{1,10})$/i.exec(s);
  if (!m) throw new Error(`MangoProxy: "${s}" is not an ASN. Use its number, for example 7922 or AS7922.`);
  return `AS${m[1]}`;
}
// /upstream/json makes at most 100 lines per call, so a bigger pull calls again until `want` new lines
// are in hand. A call that adds nothing new (a rotating line repeats itself) ends the pull.
const MANGOPROXY_BATCH_MAX = 100;
const MANGOPROXY_MAX_CALLS = 20;
async function mangoProxyCollect(want, fetchBatch, { socks = false } = {}) {
  const rows = [];
  const seen = new Set();
  for (let call = 0; rows.length < want && call < MANGOPROXY_MAX_CALLS; call += 1) {
    const json = await fetchBatch(Math.min(MANGOPROXY_BATCH_MAX, want - rows.length));
    let added = 0;
    for (const r of mangoProxyRows(json, { socks })) {
      const key = `${r.host}:${r.port}:${r.username}:${r.password}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(r);
      added += 1;
      if (rows.length >= want) break;
    }
    if (!added) break;
  }
  return rows;
}
// GET /locations/countries -> { data: [{ code, title }], meta: { currentPage, lastPage } }.
function mangoProxyCountryPage(json) {
  const list = Array.isArray(json && json.data) ? json.data : [];
  const countries = [];
  for (const c of list) {
    const code = String((c && c.code) || '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(code)) countries.push({ key: code, label: String((c && c.title) || '').trim() || code });
  }
  const meta = (json && json.meta) || {};
  const current = Number(meta.currentPage);
  const last = Number(meta.lastPage);
  return { countries, more: Number.isInteger(current) && Number.isInteger(last) && current < last };
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

// Proxy302 Open API v3 on https://proxy302.com/open_api/v3 (proxy302.com/llms-full.txt). GET
// /user/users/token (API key id + secret, not the login) returns the full Authorization value
// ("Basic ..."). /proxy/area/{country|state|city} maps names to ids; POST
// /proxy/api/proxy/dynamic/traffic buys one proxy. Every answer is HTTP 200 with { code, msg, data };
// a nonzero code is an error.
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
// Id of a state or city from /proxy/area/{state|city}?pid=<parent id>, matched on its name or code
// without case, spaces or punctuation. null when the parent lists no such place.
function proxy302AreaId(text, place) {
  const want = String(place || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  if (!want) return 0;
  const data = proxy302Body(text, 'area list');
  const list = Array.isArray(data && data.data) ? data.data : (Array.isArray(data) ? data : []);
  const norm = (v) => String(v || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const hit = list.find((a) => a && (norm(a.name) === want || (a.code && norm(a.code) === want)));
  if (!hit) return null;
  const id = Number(hit.id);
  return Number.isInteger(id) ? id : null;
}
// Product line s: 1-2 premium, 3-4 standard. Premium takes state/city and keeps a sticky session of a
// fixed length Proxy302 sets, or rotates when lifeMin is 'rotating' (the API reference allows rotating
// on s=1/2 in one place and only on 3/4 in another, so fetchProxy302Pool names a refusal clearly).
// Standard takes rotating, or sticky with session_duration 10/30/60/120 minutes.
const PROXY302_LINES = Object.freeze({ premium: 1, standard: 3 });
const PROXY302_DURATIONS = Object.freeze([10, 30, 60, 120]);
function proxy302PurchaseQuery({ line, socks = false, countryId = 0, stateId = 0, cityId = 0, lifeMin } = {}) {
  const standard = String(line || '').toLowerCase() === 'standard';
  const q = new URLSearchParams({
    s: String(standard ? PROXY302_LINES.standard : PROXY302_LINES.premium),
    protocol: socks ? 'socks5' : 'http',
    country_id: String(Number(countryId) || 0),
    state_id: String(standard ? 0 : Number(stateId) || 0),
    city_id: String(standard ? 0 : Number(cityId) || 0)
  });
  if (standard) {
    const m = Number.parseInt(String(lifeMin), 10);
    if (Number.isInteger(m) && m > 0) {
      q.set('session_mode', 'sticky');
      q.set('session_duration', String(PROXY302_DURATIONS.find((d) => d >= m) || 120));
    } else {
      q.set('session_mode', 'rotating');
    }
  } else if (String(lifeMin == null ? '' : lifeMin).trim().toLowerCase() === 'rotating') {
    q.set('session_mode', 'rotating');
  }
  return q.toString();
}
function proxy302Row(text, { socks = false, country = '' } = {}) {
  const data = proxy302Body(text, 'proxy');
  const host = String((data && data.host) || '').trim();
  const port = Number.parseInt(String(data && data.port), 10);
  // The purchase answer names the login `username` (llms-full.txt); one Apifox sample spells it `user_name`.
  const login = data && (data.username != null ? data.username : data.user_name);
  const username = login != null ? String(login) : '';
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

// 2extract username: 2xt-customer-<id>-proxy-<name>[-country-de[-state-..][-city-..][-zip-..] | -asn-<n>]
// [-session-<id>[-time-<min>]]; -time needs -session, state/city/zip need country, and asn excludes
// all geography. The Public API lacks the customer id, so the base username comes from the dashboard.
// Not tested with a live key.
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
function twoExtractUsername(base, { country, state, city, zip, asn, session, timeMin } = {}) {
  const user = twoExtractBaseUser(base);
  if (!user) throw new Error('2extract: enter the proxy username from Connection Details. It looks like 2xt-customer-<id>-proxy-<name>.');
  const parts = [user];
  const rawCc = String(country || '').trim();
  const st = twoExtractPlace(state);
  const ct = twoExtractPlace(city);
  const rawZip = String(zip || '').trim();
  const zp = rawZip.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (rawZip && !zp) throw new Error(`2extract: "${rawZip}" is not a ZIP code.`);
  const rawAsn = String(asn || '').trim();
  if (rawAsn) {
    const m = /^(?:AS)?(\d{1,10})$/i.exec(rawAsn);
    if (!m) throw new Error(`2extract: "${rawAsn}" is not an ASN. Use its number, for example 7922.`);
    if (rawCc || st || ct || zp) throw new Error('2extract: ASN targeting cannot be combined with a country, state, city or ZIP. Clear one of them.');
    parts.push('asn', m[1]);
  } else if (rawCc) {
    const cc = twoExtractCountry(rawCc);
    if (!cc) throw new Error(`2extract does not list the country "${rawCc}". Pick another country, or Any.`);
    parts.push('country', cc);
    if (st) parts.push('state', st);
    if (ct) parts.push('city', ct);
    if (zp) parts.push('zip', zp);
  } else if (st || ct || zp) {
    throw new Error('2extract: a state, city or ZIP needs a country as well.');
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
// A login with no _s_/_ttl_ gets a new IP per request (LOGIN_c_us on gonzoproxy.com); _ttl_ takes
// s, m or h up to 7 days. Not tested with a live key.
const GONZOPROXY_TTL = '72h'; // the dashboard generator's default lifetime
const GONZOPROXY_MAX_TTL_MIN = 7 * 24 * 60;
function gonzoProxyTtl(minutes) {
  const raw = String(minutes == null ? '' : minutes).trim();
  if (!raw) return GONZOPROXY_TTL;
  const m = Number(raw);
  if (!/^\d+$/.test(raw) || m < 1 || m > GONZOPROXY_MAX_TTL_MIN) throw new Error('GonzoProxy: Keep same IP must be from 1 minute to 7 days.');
  return m % 60 === 0 ? `${m / 60}h` : `${m}m`;
}
function gonzoProxyBaseLogin(raw) {
  const s = String(raw || '').trim();
  const base = s.split(/_c_/)[0];
  return /^[A-Za-z0-9]+$/.test(base) ? base : '';
}
function gonzoProxyCity(v) {
  return String(v || '').trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('-');
}
function gonzoProxyUsername(login, { country, state, city, session, ttlMin } = {}) {
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
  const rawSid = String(session || '').trim();
  const sid = rawSid.replace(/[^A-Za-z0-9]/g, '');
  if (rawSid && !sid) throw new Error('GonzoProxy: a sticky session name must contain letters or digits.');
  const rawTtl = String(ttlMin == null ? '' : ttlMin).trim();
  if (rawTtl && !sid) throw new Error('GonzoProxy: Keep same IP needs a sticky session.');
  if (sid) parts.push('s', sid, 'ttl', gonzoProxyTtl(rawTtl));
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

// Coronium: GET /api/v3/account/proxies (Bearer) -> { data }. Rows use ip_address (connection_ip is its
// documented alias) + proxy_login on http_port/socks_port, or per-protocol proxyEndpoints, which win.
// The restart/status token URLs rotate the IP without auth, so only the named fields are copied.
// Expiry: Coronium's OpenAPI (api.coronium.io/openapi.json, schema Proxy) gives tariff_expired_at in
// epoch milliseconds; support named expires_at, which the same file has as ISO-8601 on rental rows. Both
// are read, and a number below 1e12 is taken as seconds, so a unit mix-up cannot mark every line expired.
// Not tested with a live key.
function coroniumExpiryMs(p) {
  for (const v of [p && p.tariff_expired_at, p && p.expires_at]) {
    if (v == null || v === '' || typeof v === 'boolean') continue;
    const n = typeof v === 'number' ? v : (/^\d+(\.\d+)?$/.test(String(v).trim()) ? Number(v) : NaN);
    if (Number.isFinite(n)) { if (n > 0) return n < 1e12 ? n * 1000 : n; continue; }
    const t = Date.parse(String(v));
    if (Number.isFinite(t)) return t;
  }
  return null;
}
function coroniumRows(body, { socks = false, now = Date.now() } = {}) {
  let json;
  try { json = typeof body === 'string' ? JSON.parse(body) : body; } catch { return { rows: [], total: 0, expired: 0 }; }
  const list = Array.isArray(json && json.data) ? json.data : [];
  const rows = [];
  const seen = new Set();
  let expired = 0;
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const exp = coroniumExpiryMs(p);
    if (exp != null && exp <= now) { expired += 1; continue; }
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
// "user:password". Each row is one dedicated modem. Its rotation_link changes the IP when opened (at
// most every few minutes), so it becomes the proxy's Rotate IP link and is never fetched here. Lines
// without a login (IP allow-list only) are counted and left out. The vendor sells Singapore only, so
// every row is SG.
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
    const used = Number(p.bandwidth_used_gb);
    const limit = Number(p.bandwidth_limit_gb);
    const data = Number.isFinite(used) && Number.isFinite(limit) && limit > 0 ? ` • ${Math.round(used * 10) / 10}/${limit} GB` : '';
    const rotation = String(p.rotation_link || '').trim();
    rows.push({
      type: socks ? 'SOCKS5' : 'HTTP',
      host, port, username, password,
      label: `Singapore Mobile Proxy${plan ? ` • ${plan}` : ''} • ${port}${data}`,
      country: 'SG',
      rotationUrl: /^https:\/\//i.test(rotation) ? rotation : null
    });
  }
  return { rows, total: list.length, inactive, noLogin };
}

// Gsocks (api.gsocks.net): GET /proxy returns { proxies, count }, then
// /proxy/<residential|mobile>-proxy-list/:id a host:port:user:pass text list (bare or { List }).
// HTTP and SOCKS5 share each line's host and port (Gsocks' help guides), so the protocol is the user's
// choice. The id field is undocumented (read as `id`, a number or a plain token, failing loudly).
// Not tested with a live key.
//
// The auth header is unsettled: the API page's rule and header tables say "authorization: key
// {api_key}", while every curl example on the same page sends "authorization: session eyJ..." (a JWT).
// gsocksAuthSchemes gives the order to try: the documented rule first, or session first for a key
// that is itself a JWT; the caller tries the other once on 401/403 and keeps the one that works.
function gsocksAuthSchemes(key) {
  return /^eyJ[\w-]*\.[\w-]*\.[\w-]*$/.test(String(key || '').trim()) ? ['session', 'key'] : ['key', 'session'];
}
function gsocksProxyIds(body) {
  let json;
  try { json = typeof body === 'string' ? JSON.parse(body) : body; } catch { return { ids: [], listed: 0, total: 0 }; }
  const list = Array.isArray(json && json.proxies) ? json.proxies : [];
  const ids = [];
  for (const p of list) {
    const id = p && p.id;
    if ((typeof id === 'number' && Number.isInteger(id) && id >= 0) || (typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id))) ids.push(String(id));
  }
  const total = Number.parseInt(String(json && json.count), 10);
  return { ids, listed: list.length, total: Number.isInteger(total) ? total : list.length };
}
function gsocksListRows(body, { kind = 'Residential', id = '', socks = false } = {}) {
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
      type: socks ? 'SOCKS5' : 'HTTP',
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
// for every IP on active plans. Not tested with a live key. A plan can also authorize by IP; whether such
// a plan still returns its login here is not documented, so an IP without a login is counted (noLogin)
// and left out, and the pull says why when that leaves nothing.
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
  let noLogin = 0;
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const host = String(p.ip || '').trim();
    const port = Number.parseInt(String(socks ? p.port_socks : p.port_http), 10);
    const username = p.login != null ? String(p.login) : '';
    const password = p.password != null ? String(p.password) : '';
    if (!username || !password) { noLogin += 1; continue; }
    if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) continue;
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
  return { rows, error: '', total: list.length, noLogin };
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

// ---------------------------------------------------------------------------------------
// Shared by the 1.0.26 list and generator connectors (ProxyBrazil, ProxyUDP, Zokol, ResiProx,
// SimplyNode). Pure: no network, no key ever kept in a result.

// A JSON body, or null.
function jsonOf(body) {
  if (body && typeof body === 'object') return body;
  try { return JSON.parse(String(body)); } catch { return null; }
}
// 'YYYY-MM-DD' of an ISO date or date-time, '' otherwise.
function isoDay(v) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v == null ? '' : v).trim());
  return m ? m[1] : '';
}
// A Retry-After header (seconds) as "N seconds", or "a minute" when absent or a date.
function retryAfterWait(retryAfter) {
  const n = Number.parseInt(String(retryAfter == null ? '' : retryAfter).trim(), 10);
  if (!Number.isInteger(n) || n <= 0) return 'a minute';
  return n === 1 ? '1 second' : `${n} seconds`;
}
// The human part of a vendor's JSON error body (Laravel 422 "errors", an "error" string or object, or
// "message"), from a body or from httpRequestText's "HTTP <status> <body>" text. URLs are cut out and
// the text is kept short, so a key-bearing link is never echoed. '' when there is none.
function vendorErrorText(text) {
  const s = String(text == null ? '' : text);
  const unq = (v) => { try { return JSON.parse(`"${v}"`); } catch { return v; } };
  const m = /"errors"\s*:\s*\{\s*"[^"]*"\s*:\s*\[\s*"((?:[^"\\]|\\.)*)"/.exec(s)
    || /"error"\s*:\s*\{[^{}]*?"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(s)
    || /"error"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(s)
    || /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(s);
  if (!m) return '';
  return unq(m[1]).replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '').slice(0, 160);
}
// A vendor error code ("code": "rate_limited") from a JSON error body or httpRequestText's error text.
function vendorErrorCode(text) {
  const m = /"code"\s*:\s*"([A-Za-z0-9_.-]{1,60})"/.exec(String(text == null ? '' : text));
  return m ? m[1] : '';
}

// A proxy host: a DNS name or IPv4 address, or a bracketed IPv6 address (returned without brackets).
function vendorProxyEndpoint(text) {
  const s = String(text || '').trim();
  const h = s.lastIndexOf(':');
  if (h < 0) return null;
  let host = s.slice(0, h).trim();
  const portText = s.slice(h + 1).trim();
  if (!/^\d{1,5}$/.test(portText)) return null;
  const port = Number.parseInt(portText, 10);
  if (port < 1 || port > 65535) return null;
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
    if (!/^[0-9A-Fa-f:.]+$/.test(host) || !host.includes(':')) return null;
  } else if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(host)) {
    return null;
  }
  return { host, port };
}

// One proxy string from a vendor's generator API (ResiProx GET /generate-proxy-string, SimplyNode
// POST /proxy). Neither vendor publishes the format, so this reads the three shapes such APIs print,
// and nothing else:
//   a URL           http|https|socks4|socks5|socks5h://user:pass@host:port (user and password decoded)
//   user:pass@host:port   (split at the last @; the password may hold ':' or ';')
//   host:port:user:pass   (the password may hold ':')
// host:port alone is a proxy without a login (an IP allow-list), which the app cannot store as a
// login proxy: { ok: false, reason: 'noLogin' }. Anything else: { ok: false, reason: 'unreadable' }.
const VENDOR_STRING_SCHEMES = new Set(['http', 'https', 'socks4', 'socks5', 'socks5h']);
function parseVendorProxyString(raw) {
  const unreadable = { ok: false, reason: 'unreadable' };
  const noLogin = { ok: false, reason: 'noLogin' };
  let s = String(raw == null ? '' : raw).trim();
  if (!s || s.length > 2048 || /\s/.test(s)) return unreadable;
  let scheme = '';
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/.exec(s);
  if (m) {
    scheme = m[1].toLowerCase();
    if (!VENDOR_STRING_SCHEMES.has(scheme)) return unreadable;
    s = m[2].replace(/\/$/, '');
    if (/[/?#]/.test(s)) return unreadable;
  }
  const at = s.lastIndexOf('@');
  if (at >= 0) {
    const ep = vendorProxyEndpoint(s.slice(at + 1));
    if (!ep) return unreadable;
    const cred = s.slice(0, at);
    const c = cred.indexOf(':');
    let username = c >= 0 ? cred.slice(0, c) : cred;
    let password = c >= 0 ? cred.slice(c + 1) : '';
    if (scheme) {
      try { username = decodeURIComponent(username); password = decodeURIComponent(password); } catch { return unreadable; }
    }
    if (!username || !password) return noLogin;
    return { ok: true, scheme, host: ep.host, port: ep.port, username, password };
  }
  const parts = s.split(':');
  if (!scheme && parts.length >= 4) {
    const ep = vendorProxyEndpoint(`${parts[0]}:${parts[1]}`);
    const username = parts[2];
    const password = parts.slice(3).join(':');
    if (ep && username && password) return { ok: true, scheme: '', host: ep.host, port: ep.port, username, password };
    if (ep) return noLogin;
  }
  return vendorProxyEndpoint(s) ? noLogin : unreadable;
}

// Calls a generator API `want` times, `inFlight` at a time, and keeps each distinct string. A call
// that returns a string already seen ends the pull (a rotating string repeats itself), as does an
// error (kept for the caller: rows already made are not thrown away) or the deadline.
async function collectVendorStrings(want, fetchOne, { inFlight = 3, deadlineMs = 60000, now = Date.now } = {}) {
  const strings = [];
  const seen = new Set();
  let error = null;
  let repeated = false;
  let timedOut = false;
  const until = now() + deadlineMs;
  let calls = 0;
  while (strings.length < want && !error && !repeated) {
    if (now() > until) { timedOut = true; break; }
    const size = Math.max(1, Math.min(inFlight, want - strings.length));
    const settled = await Promise.allSettled(Array.from({ length: size }, () => { calls += 1; return fetchOne(calls); }));
    for (const r of settled) {
      if (r.status === 'rejected') { if (!error) error = r.reason; continue; }
      const v = String(r.value == null ? '' : r.value).trim();
      if (!v || seen.has(v)) { repeated = true; continue; }
      if (strings.length >= want) continue;
      seen.add(v);
      strings.push(v);
    }
  }
  return { strings, error, repeated, timedOut };
}

// ---------------------------------------------------------------------------------------
// ProxyBrazil: the Partner API for profile browsers (api.proxybrazil.com/v1, OpenAPI 1.0.0, read
// 2026-11-10). GET /proxies?page=&per_page= (Bearer pb_live_ key) -> { data: [Proxy], page, per_page,
// total }. A Proxy is one dedicated 4G modem port: host, http_port, socks5_port, username, password,
// status active | data_exhausted, data_limit_mb, data_used_mb, expires_at, rotation_url (a per-proxy
// link that needs no key; null while rotation links are not configured). Not tested with a live key.
const PROXYBRAZIL_KEY = /^pb_live_[A-Za-z0-9]{40}$/;
function proxyBrazilRows(body, { socks = false } = {}) {
  const json = jsonOf(body);
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { rows: [], total: 0, exhausted: 0, inactive: 0, noLogin: 0, more: false, error: 'ProxyBrazil: the API did not return JSON.' };
  }
  const list = Array.isArray(json.data) ? json.data : [];
  const rows = [];
  const seen = new Set();
  let exhausted = 0;
  let inactive = 0;
  let noLogin = 0;
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const status = String(p.status || '').toLowerCase();
    // data_exhausted proxies are listed but "will not carry traffic until renewed".
    if (status === 'data_exhausted') { exhausted += 1; continue; }
    if (status !== 'active') { inactive += 1; continue; }
    const username = p.username != null ? String(p.username) : '';
    const password = p.password != null ? String(p.password) : '';
    if (!username || !password) { noLogin += 1; continue; }
    const host = String(p.host || '').trim();
    const port = Number.parseInt(String(socks ? p.socks5_port : p.http_port), 10);
    if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    const key = `${host}:${port}:${username}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = String(p.name || '').trim().slice(0, 60);
    const used = Number(p.data_used_mb);
    const limit = Number(p.data_limit_mb);
    const data = Number.isFinite(used) && Number.isFinite(limit) && limit > 0
      ? `${Math.round((used / 1024) * 10) / 10}/${Math.round((limit / 1024) * 10) / 10} GB` : '';
    const until = isoDay(p.expires_at);
    const rotation = String(p.rotation_url || '').trim();
    rows.push({
      type: socks ? 'SOCKS5' : 'HTTP',
      host, port, username, password,
      label: ['ProxyBrazil', String(p.type || '') === 'mobile_4g_dedicated' ? '4G' : 'Mobile', name || `port ${port}`, data, until ? `until ${until}` : ''].filter(Boolean).join(' • '),
      country: 'BR',
      rotationUrl: /^https:\/\/[^\s]+$/i.test(rotation) ? rotation : null
    });
  }
  const page = Number(json.page);
  const per = Number(json.per_page);
  const total = Number(json.total);
  const more = list.length > 0 && Number.isInteger(page) && per > 0 && Number.isFinite(total) && page * per < total;
  return { rows, total: list.length, exhausted, inactive, noLogin, more, error: '' };
}
// A failed list call, from its status and the { error: { code } } body. Never echoes the key.
function proxyBrazilErrorMessage(status, text) {
  const code = vendorErrorCode(text);
  if (status === 401 || code === 'invalid_key') return 'ProxyBrazil rejected the API key, or it was revoked. Create a new one under Integrations (App: SoftGlaze).';
  if (code === 'missing_scope') return 'ProxyBrazil: this key cannot list proxies. Create a new one under Integrations.';
  if (code === 'account_blocked') return 'ProxyBrazil: this account is blocked. Contact ProxyBrazil support.';
  if (status === 403) return 'ProxyBrazil refused access for this key.';
  if (status === 429 || code === 'rate_limited') return 'ProxyBrazil: too many requests (120 a minute). Wait a minute and pull again.';
  if (status === 503 || code === 'api_disabled') return 'ProxyBrazil: the API is switched off for now. Try again later.';
  return 'ProxyBrazil: could not read the proxy list. Check your connection and try again.';
}
// What ProxyBrazil's rotation_url answered: '' when the IP changed (or the link worked), else a clear
// message. Success is { success: true, old_ip, new_ip }; a refusal has error.code.
function proxyBrazilRotateRefusal(status, data) {
  const s = Number(status);
  const body = jsonOf(data);
  const code = body && body.error && typeof body.error === 'object' ? String(body.error.code || '') : '';
  const again = 'ProxyBrazil: the modem did not change IP this time. Try again in a minute.';
  if (s >= 200 && s < 300) return body && body.success === false ? again : '';
  if (s >= 300 && s < 400) return '';
  if (s === 409 || code === 'proxy_not_active') return 'ProxyBrazil: this proxy is not active, so it cannot change IP.';
  if (s === 429 || code === 'rate_limited') return 'ProxyBrazil: the account reached 30 IP changes in 15 minutes. Wait and try again.';
  if (s === 400 || s === 502 || s === 504 || code === 'rotation_failed' || code === 'rotation_timeout') return again;
  if (s === 404 || code === 'invalid_link' || code === 'not_found') return 'ProxyBrazil: this rotation link no longer works (links stop when every API key is revoked). Pull the proxies again with a current key.';
  if (code === 'account_blocked') return 'ProxyBrazil: this account is blocked. Contact ProxyBrazil support.';
  if (s === 503 || code === 'api_disabled') return 'ProxyBrazil: the API is switched off for now. Try again later.';
  return `ProxyBrazil: the IP change failed (HTTP ${s || 0}). Try again in a minute.`;
}

// ---------------------------------------------------------------------------------------
// ProxyUDP (proxyudp.com/api/v1, "Authorization: Token <token>"; OpenAPI 3.0.3, read 2026-11-10).
// GET /subscriptions/?active=true&page= -> { count, next, previous, results } (Django REST paging);
// GET /subscriptions/{id}/ adds proxy_login and proxy_password. Each subscription is one mobile port
// pair on proxy_ip_address (http_port, socks_port). Not tested with a live key.
const PROXYUDP_FLAG = /^\s*([\u{1F1E6}-\u{1F1FF}])([\u{1F1E6}-\u{1F1FF}])\s*/u;
// The country of a product name that starts with a flag emoji ("🇩🇪 1&1 Versatel"), else ''. The flag
// is inferred from the public catalog; the health check fills the country when there is none.
function proxyUdpFlagCountry(serverName) {
  const m = PROXYUDP_FLAG.exec(String(serverName || ''));
  if (!m) return '';
  const code = [m[1], m[2]].map((c) => String.fromCharCode(c.codePointAt(0) - 0x1F1E6 + 65)).join('');
  return /^[A-Z]{2}$/.test(code) ? code : '';
}
function proxyUdpPlanName(serverName) {
  return String(serverName || '').replace(PROXYUDP_FLAG, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}
function proxyUdpLive(s, now) {
  if (!s || typeof s !== 'object' || String(s.status || '').toLowerCase() !== 'active') return false;
  const ends = Date.parse(String(s.expires_at || ''));
  return !(Number.isFinite(ends) && ends <= now);
}
// One page of the subscription list: the active, unexpired subscriptions (id, address, ports), the
// number listed, and whether another page follows (`next` is set). The id must be a plain id.
function proxyUdpSubscriptions(body, { now = Date.now() } = {}) {
  const json = jsonOf(body);
  const list = Array.isArray(json && json.results) ? json.results : [];
  const active = [];
  for (const s of list) {
    if (!proxyUdpLive(s, now)) continue;
    const id = String(s.id == null ? '' : s.id).trim();
    if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) continue;
    active.push({
      id, server_name: s.server_name, proxy_ip_address: String(s.proxy_ip_address || '').trim(),
      http_port: s.http_port, socks_port: s.socks_port, expires_at: s.expires_at
    });
  }
  return { active, listed: list.length, more: Boolean(json && typeof json.next === 'string' && json.next) && list.length > 0 };
}
// Rows from the detail calls (SubscriptionDetail). Ports without a login are counted, not imported.
function proxyUdpRows(details, { socks = false, now = Date.now() } = {}) {
  const rows = [];
  const seen = new Set();
  let noLogin = 0;
  for (const d of Array.isArray(details) ? details : []) {
    if (!proxyUdpLive(d, now)) continue;
    const username = d.proxy_login != null ? String(d.proxy_login) : '';
    const password = d.proxy_password != null ? String(d.proxy_password) : '';
    if (!username || !password) { noLogin += 1; continue; }
    const host = String(d.proxy_ip_address || '').trim();
    const port = Number.parseInt(String(socks ? d.socks_port : d.http_port), 10);
    if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    const key = `${host}:${port}:${username}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cc = proxyUdpFlagCountry(d.server_name);
    const until = isoDay(d.expires_at);
    rows.push({
      type: socks ? 'SOCKS5' : 'HTTP',
      host, port, username, password,
      label: ['ProxyUDP', proxyUdpPlanName(d.server_name) || 'Mobile', String(port), until ? `until ${until}` : ''].filter(Boolean).join(' • '),
      country: cc || null
    });
  }
  return { rows, noLogin };
}
// The subscription a stored proxy row belongs to: same address, and its HTTP or SOCKS5 port.
function proxyUdpFindSubscription(list, proxy) {
  const host = String((proxy && proxy.host) || '').trim();
  const port = Number(proxy && proxy.port);
  if (!host || !Number.isInteger(port)) return null;
  return (Array.isArray(list) ? list : []).find((s) => s && s.proxy_ip_address === host
    && (Number(s.http_port) === port || Number(s.socks_port) === port)) || null;
}
// What POST /subscriptions/{id}/rotate-ip/ answered ({ status, message, code, changed, success,
// egress_ip, ... } on 200, 400, 409 and 503). { ok, response } or { ok: false, message }.
function proxyUdpRotateOutcome(status, body, { retryAfter } = {}) {
  const s = Number(status);
  const json = jsonOf(body);
  const said = json && typeof json === 'object' ? vendorErrorText(JSON.stringify({ message: json.message })) : vendorErrorText(body);
  if (s >= 200 && s < 300) {
    if (json && json.success === false) return { ok: false, message: `ProxyUDP did not change the IP${said ? `: ${said}` : ''}.` };
    const ip = json && typeof json.egress_ip === 'string' && /^[0-9A-Fa-f.:]{3,45}$/.test(json.egress_ip) ? json.egress_ip : '';
    if (json && json.changed === false) return { ok: true, response: `ProxyUDP kept the same IP${ip ? ` (${ip})` : ''}: the carrier can hand back the same address.` };
    return { ok: true, response: ip ? `New IP ${ip}` : 'IP change requested' };
  }
  if (s === 409 || s === 503) return { ok: false, message: `ProxyUDP: the modem is busy. Try again in ${retryAfterWait(retryAfter)}.` };
  if (s === 429) return { ok: false, message: `ProxyUDP: too many IP changes. Try again in ${retryAfterWait(retryAfter)}.` };
  if (s === 401) return { ok: false, message: 'ProxyUDP rejected the saved API token. Save it again on the Proxy providers page.' };
  if (s === 403) return { ok: false, message: 'ProxyUDP refused access for this token.' };
  if (s === 404) return { ok: false, message: 'ProxyUDP: this port is no longer on the account.' };
  if (s === 400) return { ok: false, message: `ProxyUDP refused the IP change${said ? `: ${said}` : ' for this port'}.` };
  return { ok: false, message: 'ProxyUDP: could not reach the API to change the IP. Try again in a moment.' };
}

// ---------------------------------------------------------------------------------------
// Zokol ("Zokol Dashboard API" v2.24.0 at docs.zokol.fr, read 2026-11-10; Bearer API key).
// GET api.dashboard.zokol.fr/v1/proxies/mobile/?active=true&size=100&page=<0-based> ->
// { content: [ProxyDto], page: { size, number, totalElements, totalPages } }. Not tested with a live key.
const ZOKOL_ISPS = Object.freeze({ ISP_ORANGE_FR: 'Orange', ISP_SFR_FR: 'SFR', ISP_BOUYGUES_FR: 'Bouygues', ISP_FREE_FR: 'Free' });
function zokolRows(body, { socks = false, now = Date.now() } = {}) {
  const json = jsonOf(body);
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { rows: [], total: 0, expired: 0, violation: 0, noLogin: 0, more: false, error: 'Zokol: the API did not return JSON.' };
  }
  const list = Array.isArray(json.content) ? json.content : [];
  const rows = [];
  const seen = new Set();
  let expired = 0;
  let violation = 0;
  let noLogin = 0;
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const state = String(p.state || '').toUpperCase();
    if (state === 'POLICY_VIOLATION') { violation += 1; continue; }
    const ends = Date.parse(String(p.finishAt || ''));
    if (state === 'EXPIRED' || (Number.isFinite(ends) && ends <= now)) { expired += 1; continue; }
    if (state !== 'ACTIVE' && state !== 'EXPIRE_SOON') continue;
    const auth = p.auth && typeof p.auth === 'object' ? p.auth : {};
    const username = auth.username != null ? String(auth.username) : '';
    const password = auth.password != null ? String(auth.password) : '';
    if (!username || !password) { noLogin += 1; continue; }
    const host = String(p.hostname || '').trim();
    const portObj = socks ? p.portSocks5 : p.portHttp;
    const port = Number.parseInt(String(portObj && typeof portObj === 'object' ? portObj.port : ''), 10);
    if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    const key = `${host}:${port}:${username}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const isp = ZOKOL_ISPS[String((p.network && p.network.data && p.network.data.isp) || '')] || '';
    const shared = p.shared === true;
    const link = p.rotation && p.rotation.manual && typeof p.rotation.manual === 'object' ? String(p.rotation.manual.url || '').trim() : '';
    const until = isoDay(p.finishAt);
    rows.push({
      type: socks ? 'SOCKS5' : 'HTTP',
      host, port, username, password,
      label: ['Zokol', isp || 'Mobile', `${shared ? 'Shared' : 'Dedicated'}${p.trial === true ? ' • trial' : ''}`, p.id != null ? `#${p.id}` : '', until ? `until ${until}` : ''].filter(Boolean).join(' • '),
      country: 'FR',
      // Shared lines have no rotation link ("No rotation link available with shared proxy").
      rotationUrl: !shared && /^https:\/\/[^\s]+$/i.test(link) ? link : null
    });
  }
  const pg = json.page && typeof json.page === 'object' ? json.page : {};
  const more = list.length > 0 && Number.isInteger(Number(pg.number)) && Number(pg.number) + 1 < Number(pg.totalPages);
  return { rows, total: list.length, expired, violation, noLogin, more, error: '' };
}
// What a Zokol rotation link answered. Its behaviour is not documented (the dashboard opens it with a
// plain GET), so a refusal gets a clear message and the dashboard as the fallback.
function zokolRotateRefusal(status) {
  const s = Number(status);
  if (s >= 200 && s < 400) return '';
  if (s === 429) return 'Zokol: the IP was changed a moment ago. Wait for the cooldown the Zokol dashboard shows, then try again.';
  if (s === 401 || s === 403 || s === 404) return 'Zokol refused this rotation link. Pull the proxy again to refresh its link, or change the IP in the Zokol dashboard.';
  return `Zokol: the IP change failed (HTTP ${s || 0}). Try again in a moment, or change the IP in the Zokol dashboard.`;
}

// ---------------------------------------------------------------------------------------
// ResiProx (dashboard.resiprox.com/api/v1, Bearer API token; OpenAPI 3.1 "0.1", read 2026-11-10).
// GET /user/me -> { user: { data: { residential: { user, pass, bandwidth: { total, used, remaining } }
// | null, mobile: same } } }, bandwidth in BYTES as strings (1 GB = 1,000,000,000 bytes, the docs' rule).
// GET /generate-proxy-string -> { proxy_string } (format unpublished: parseVendorProxyString).
const RESIPROX_POOLS = Object.freeze({ residential: 'Residential', mobile: 'Mobile' });
function resiProxPool(me, pool) {
  const json = jsonOf(me);
  const data = (json && json.user && json.user.data) || (json && json.data) || null;
  const p = data && typeof data === 'object' ? data[pool] : null;
  if (!p || typeof p !== 'object') return null;
  const bw = p.bandwidth && typeof p.bandwidth === 'object' ? p.bandwidth : {};
  const n = (v) => {
    const s = String(v == null ? '' : v).trim();
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
  };
  return {
    user: p.user != null ? String(p.user) : '', pass: p.pass != null ? String(p.pass) : '',
    totalBytes: n(bw.total), usedBytes: n(bw.used), remainingBytes: n(bw.remaining)
  };
}
// GET /countries -> { countries: <shape undocumented> }: an array of codes, of objects with a code and
// a name, or an object keyed by code. Only 2-letter codes are kept.
function resiProxCountries(body) {
  const json = jsonOf(body);
  let src = json && typeof json === 'object' && !Array.isArray(json) ? json.countries : json;
  if (src && typeof src === 'object' && !Array.isArray(src) && Array.isArray(src.data)) src = src.data;
  const entries = Array.isArray(src)
    ? src.map((c) => (c && typeof c === 'object'
      ? [c.code ?? c.country_code ?? c.iso ?? c.iso2 ?? c.alpha2 ?? c.value, c.name ?? c.country_name ?? c.label ?? c.country]
      : [c, '']))
    : (src && typeof src === 'object' ? Object.entries(src).map(([k, v]) => [k, typeof v === 'string' ? v : (v && (v.name || v.label)) || '']) : []);
  const out = [];
  const seen = new Set();
  for (const [code, name] of entries) {
    const key = String(code == null ? '' : code).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: String(name || '').trim().slice(0, 60) || key });
  }
  return out;
}
// One generated proxy string as a row on the ResiProx gateway; a host that is not a resiprox.com
// name is refused (old pages print a dead template host).
function resiProxRow(raw, { socks = false, pool = 'residential', country = '', index = 1, sticky = false } = {}) {
  const p = parseVendorProxyString(raw);
  if (!p.ok) return { row: null, reason: p.reason };
  if (!/(^|\.)resiprox\.com$/i.test(p.host)) return { row: null, reason: 'host', host: p.host };
  const cc = /^[A-Z]{2}$/.test(String(country || '').toUpperCase()) ? String(country).toUpperCase() : '';
  return {
    row: {
      type: socks ? 'SOCKS5' : 'HTTP',
      host: p.host, port: p.port, username: p.username, password: p.password,
      label: `ResiProx • ${RESIPROX_POOLS[pool] || 'Residential'} • ${cc || 'Any country'} • ${sticky ? `#${index}` : 'rotating'}`,
      country: cc || null,
      // Sticky strings may differ only in the password.
      dedupeOnPassword: true
    },
    reason: ''
  };
}

// ---------------------------------------------------------------------------------------
// SimplyNode (app.simplynode.io/api, x-api-key; OpenAPI 3.1 file emailed 2026-11-02). One sub-account
// (proxy profile) per pull: GET /subaccounts lists them ({ count, nextToken, items: [Subaccount] }),
// POST /proxy generates one proxy string ({ "proxy-string" }, format unpublished). Not live-key tested.
const SIMPLYNODE_POOLS = Object.freeze({
  residential_essential: Object.freeze({ productType: 'residential', solution: 'essential', kind: 'Essential', name: 'Residential Essential' }),
  residential_core: Object.freeze({ productType: 'residential', solution: 'core', kind: 'Core', name: 'Residential Core' }),
  mobile: Object.freeze({ productType: 'mobile', solution: '', kind: 'Mobile', name: 'Mobile' })
});
// The sticky ports of the port format (proxy.simplynode.io, one session per port) that
// GET /subaccounts/{login}/session:reset?ports= accepts, per the API file.
const SIMPLYNODE_RESET_PORTS = Object.freeze({ host: 'proxy.simplynode.io', min: 9000, max: 18999 });
// { unit, value } traffic: the value as a number, or null.
function simplyNodeTrafficValue(t) {
  if (!t || typeof t !== 'object') return null;
  const n = Number(t.value);
  return Number.isFinite(n) ? n : null;
}
// The first sub-account with traffic left. Subaccount.status values are undocumented, so only a status
// that plainly reads as off is skipped.
function simplyNodeSubaccountPick(items) {
  for (const s of Array.isArray(items) ? items : []) {
    if (!s || typeof s !== 'object' || !/^[A-Za-z0-9_.-]{1,64}$/.test(String(s.subaccountLogin || ''))) continue;
    if (/^(inactive|disabled|blocked|suspended|deleted|expired|banned)$/i.test(String(s.status || '').trim())) continue;
    const left = simplyNodeTrafficValue(s.trafficAvailable);
    if (left != null && left > 0) return s;
  }
  return null;
}
// GET /targets/countries -> { items: [{ code, name }] } with lowercase codes. The code is kept as
// SimplyNode prints it (upper-cased for the picker): its site uses "uk", not the ISO "gb".
function simplyNodeCountries(body) {
  const json = jsonOf(body);
  const list = Array.isArray(json && json.items) ? json.items : (Array.isArray(json) ? json : []);
  const out = [];
  const seen = new Set();
  for (const c of list) {
    const key = String((c && typeof c === 'object' ? c.code : c) || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: String((c && typeof c === 'object' && c.name) || '').trim().slice(0, 60) || key });
  }
  return out;
}
// The POST /proxy body (GetProxyStringRequest, additionalProperties false). auth 'login' because a row
// stores a username and password; country, region and city lowercase as SimplyNode's lists print them.
// One rotating proxy is sticky false with ttl 0; a sticky one holds `ttlMin` minutes (sent in seconds).
function simplyNodeProxyBody({ login, socks = false, country = '', region = '', city = '', sticky = false, ttlMin = 0 } = {}) {
  const body = { login: String(login || ''), auth: 'login', protocol: socks ? 'socks5' : 'http' };
  const cc = String(country || '').trim().toLowerCase();
  if (/^[a-z]{2}$/.test(cc)) {
    body.country = cc;
    const rg = String(region || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const ct = String(city || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (rg) body.region = rg;
    if (ct) body.city = ct;
  }
  body.sticky = Boolean(sticky);
  const minutes = Number.parseInt(String(ttlMin), 10);
  body.ttl = sticky && Number.isInteger(minutes) && minutes > 0 ? minutes * 60 : 0;
  return body;
}
function simplyNodeRow(raw, { socks = false, kind = 'Essential', country = '', index = 1, sticky = false } = {}) {
  const p = parseVendorProxyString(raw);
  if (!p.ok) return { row: null, reason: p.reason };
  if (!/(^|\.)simplynode\.io$/i.test(p.host)) return { row: null, reason: 'host', host: p.host };
  let cc = String(country || '').trim().toUpperCase();
  if (cc === 'UK') cc = 'GB';
  if (!/^[A-Z]{2}$/.test(cc)) cc = '';
  return {
    row: {
      type: socks ? 'SOCKS5' : 'HTTP',
      host: p.host, port: p.port, username: p.username, password: p.password,
      label: `SimplyNode • ${kind} • ${cc || 'Any country'} • ${sticky ? `#${index}` : 'rotating'}`,
      country: cc || null,
      // The flag format keeps host, port and user and differs in the password.
      dedupeOnPassword: true
    },
    reason: ''
  };
}

// The wait a vendor asks for on a 429: the Retry-After header (seconds, or an HTTP date), else a
// retryAfterSeconds field in its JSON body (Node4). null when neither says.
function retryAfterSeconds(headers, body, now = Date.now()) {
  const h = headers && typeof headers === 'object' ? (headers['retry-after'] != null ? headers['retry-after'] : headers['Retry-After']) : null;
  const raw = Array.isArray(h) ? h[0] : h;
  if (raw != null && String(raw).trim() !== '') {
    const s = String(raw).trim();
    if (/^\d{1,6}$/.test(s)) return Number(s);
    const at = Date.parse(s);
    if (Number.isFinite(at)) return Math.max(0, Math.ceil((at - now) / 1000));
  }
  const m = /"retryAfterSeconds"\s*:\s*(\d{1,6})/.exec(String(body == null ? '' : body));
  return m ? Number(m[1]) : null;
}

function parseJsonBody(body) {
  if (body && typeof body === 'object') return body;
  try { return JSON.parse(String(body)); } catch { return null; }
}

// ---------------------------------------------------------------------------------------
// Node4 (node4.io/api/v1, OpenAPI 3.1.0 read 2026-11-10). Gateway products are built by Node4 with
// POST /gateways/endpoint: count 1 to 100 per call, state, city and ASN on Residential only, ttl not
// selectable. Static Premium and Shared Datacenter IPs come from GET /proxies/list. Replies use the
// { success, data } envelope. Built from the docs only: never checked against a live account.
const NODE4_GATEWAY_PRODUCTS = Object.freeze({
  residential: { product: 'residential', name: 'Residential', residential: true },
  rotating_datacenter: { product: 'rotating_datacenter', name: 'Rotating Datacenter', residential: false },
  rotating_unmetered: { product: 'rotating_unmetered', name: 'Rotating Unmetered', residential: false }
});
const NODE4_CALL_MAX = 100;
const NODE4_STATIC_TYPES = Object.freeze({ premium_private: 'Premium', shared: 'Shared' });

function node4Data(json) {
  const j = parseJsonBody(json);
  if (!j || typeof j !== 'object') return null;
  return !Array.isArray(j) && Object.prototype.hasOwnProperty.call(j, 'data') && j.data != null ? j.data : j;
}

// One POST /gateways/endpoint body. Throws, before any call, on targeting the product does not take.
// `sticky` is for the whole pull (How many above 1), so a follow-up call for the rest stays sticky.
function node4GatewayBody({ pool, socks = false, country, state, city, asn, count, sticky = false } = {}) {
  const product = NODE4_GATEWAY_PRODUCTS[String(pool || '').toLowerCase()];
  if (!product) throw new Error('Node4: pick Residential, Rotating Datacenter, Rotating Unmetered or Static Datacenter.');
  const rawCc = String(country || '').trim();
  const cc = rawCc.toLowerCase();
  if (rawCc && !/^[a-z]{2}$/.test(cc)) throw new Error(`Node4: "${rawCc}" is not a country code.`);
  const st = String(state || '').trim();
  const ct = String(city || '').trim();
  const asnRaw = String(asn || '').trim();
  if ((st || ct || asnRaw) && !product.residential) throw new Error('Node4: state, city and ASN work on Residential only. Clear them for this pool.');
  if ((st || ct) && !cc) throw new Error('Node4: pick a country before a state or city.');
  const stateCode = st.toLowerCase();
  if (st && !/^[a-z0-9]{2,3}$/.test(stateCode)) throw new Error('Node4: a state is a 2 or 3 letter code, for example TX.');
  // A city segment is lowercase letters and digits ("New York" is newyork).
  const cityName = ct.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (ct && !cityName) throw new Error('Node4: a city is letters and digits, for example austin.');
  const asnNum = asnRaw.replace(/^AS/i, '');
  if (asnRaw && !/^\d{1,10}$/.test(asnNum)) throw new Error('Node4: an ASN is digits only, for example 7922.');
  const n = sticky ? Math.max(1, Math.min(NODE4_CALL_MAX, Number.parseInt(String(count), 10) || 1)) : 1;
  const body = { product: product.product, protocol: socks ? 'socks5' : 'http' };
  // The UK is gb in Node4's targeting.
  if (cc) body.country = cc === 'uk' ? 'gb' : cc;
  if (stateCode) body.state = stateCode;
  if (cityName) body.city = cityName;
  if (asnNum) body.asn = asnNum;
  body.sticky = Boolean(sticky);
  body.count = n;
  return body;
}

// Rows from a POST /gateways/endpoint reply: endpoints[] (one per session), or the top-level endpoint
// when that list is empty. Rows dedupe on the password too: the login grammar is Node4's.
function node4GatewayRows(json, { socks = false, name = 'Residential', country = '' } = {}) {
  const d = node4Data(json);
  if (!d || typeof d !== 'object' || Array.isArray(d)) return [];
  const list = Array.isArray(d.endpoints) && d.endpoints.length ? d.endpoints : [d];
  const cc = String(country || '').trim().toUpperCase();
  const code = /^[A-Z]{2}$/.test(cc) ? (cc === 'UK' ? 'GB' : cc) : '';
  const rows = [];
  const seen = new Set();
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const host = String(e.host || '').trim();
    const port = Number.parseInt(String(e.port), 10);
    const username = e.username != null ? String(e.username) : '';
    const password = e.password != null ? String(e.password) : '';
    if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !username || !password) continue;
    const key = `${host}:${port}:${username}:${password}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sid = e.sessionId != null && String(e.sessionId).trim() ? String(e.sessionId).trim() : '';
    rows.push({
      type: socks ? 'SOCKS5' : 'HTTP',
      host, port, username, password,
      label: `Node4 • ${name} • ${code || 'Any country'} • ${sid ? `sticky ${sid}` : 'rotating'}`,
      country: code || null,
      dedupeOnPassword: true
    });
  }
  return rows;
}

// GET /proxies/list?format=json: the account's active static IPs. Only Premium (premium_private) and
// Shared Datacenter rows for the chosen protocol; rows without a login (the free tier's IP
// authorization) are counted, not added.
function node4StaticRows(json, { socks = false } = {}) {
  const d = node4Data(json);
  const list = Array.isArray(d) ? d : (d && Array.isArray(d.proxies) ? d.proxies : []);
  const rows = [];
  const seen = new Set();
  let total = 0; let skippedType = 0; let skippedProtocol = 0; let noLogin = 0;
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    total += 1;
    const kind = NODE4_STATIC_TYPES[String(p.type || '').toLowerCase()];
    if (!kind) { skippedType += 1; continue; }
    // HTTP and HTTPS rows serve the HTTP select; SOCKS5 rows the SOCKS5 one.
    if (/socks/i.test(String(p.protocol || '')) !== Boolean(socks)) { skippedProtocol += 1; continue; }
    const host = String(p.host || '').trim();
    const port = Number.parseInt(String(p.port), 10);
    if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    const username = p.username != null ? String(p.username) : '';
    const password = p.password != null ? String(p.password) : '';
    if (!username || !password) { noLogin += 1; continue; }
    const k = `${host}:${port}:${username}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const cc = String(p.country || '').trim().toUpperCase();
    const code = /^[A-Z]{2}$/.test(cc) ? (cc === 'UK' ? 'GB' : cc) : '';
    rows.push({
      type: socks ? 'SOCKS5' : 'HTTP',
      host, port, username, password,
      label: `Node4 • ${kind} Datacenter${code ? ` • ${code}` : ''} • ${host}`,
      country: code || null
    });
  }
  return { rows, total, skippedType, skippedProtocol, noLogin };
}

// GET /geo/countries: { countries: [{ code (lowercase), name, cityCount, availableIps }] }.
function node4Countries(json) {
  const d = node4Data(json);
  const list = Array.isArray(d && d.countries) ? d.countries : (Array.isArray(d) ? d : []);
  const out = [];
  const seen = new Set();
  for (const c of list) {
    const raw = String((c && c.code) || '').trim().toUpperCase();
    const code = raw === 'UK' ? 'GB' : raw;
    if (!/^[A-Z]{2}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    out.push({ key: code, label: String((c && c.name) || '').trim() || code });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------------------
// ProxyEmpire (panel.proxyempire.io/api/v2, OpenAPI 3.0.3 "ProxyEmpire API" v2.0.0 read 2026-11-10).
// POST /proxy-list returns ready lines (format 1 = user:pass@host:port, up to 3000 a call) with the
// location and the rotation in the username; GET /user says which packages the account has. Datacenter
// takes a country only; Static Residential takes no targeting and no rotation (422 otherwise). Built
// from the docs only: never checked against a live account.
const PROXYEMPIRE_POOLS = Object.freeze({
  residential: { type: 'residential', name: 'Rotating Residential', targeting: 'full' },
  mobile: { type: 'mobile', name: 'Rotating Mobile', targeting: 'full' },
  datacenter: { type: 'datacenter', name: 'Rotating Datacenter', targeting: 'country' },
  'static-resi': { type: 'static-resi', name: 'Static Residential', targeting: 'none' }
});
const PROXYEMPIRE_MAX_LIFE = 120; // session_lifetime runs from 1 to 120 minutes

// Region and city values are lowercase words joined with '+' ("new+york").
function proxyEmpirePlace(v) {
  return String(v || '').trim().toLowerCase().split(/\s+/).filter(Boolean).join('+');
}

// The POST /proxy-list body for one pull, and what it makes: random (one rotating line), sticky (How
// many above 1, each line held until ProxyEmpire rotates it or its device goes offline), custom (Keep
// same IP, up to 120 minutes) or fixed (Static Residential). Throws, before any call, on targeting the
// pool refuses.
function proxyEmpireBody({ pool, country, state, city, zip, asn, count, life, max = 1000 } = {}) {
  const p = PROXYEMPIRE_POOLS[String(pool || '').toLowerCase()];
  if (!p) throw new Error('ProxyEmpire: pick Rotating Residential, Rotating Mobile, Rotating Datacenter or Static Residential.');
  const rawCc = String(country || '').trim();
  let cc = rawCc.toLowerCase();
  if (rawCc && !/^[a-z]{2}$/.test(cc)) throw new Error(`ProxyEmpire: "${rawCc}" is not a country code.`);
  const region = proxyEmpirePlace(state);
  const town = proxyEmpirePlace(city);
  const zipCode = String(zip || '').trim();
  const asnRaw = String(asn || '').trim();
  const asnNum = asnRaw.replace(/^AS/i, '');
  const minutes = Number.parseInt(String(life == null ? '' : life), 10);
  const lifeSet = Number.isFinite(minutes) && minutes > 0;
  const n = Math.max(1, Math.min(max, Number.parseInt(String(count), 10) || 1));
  const body = { proxy_type: p.type, format: 1, length: n };
  if (p.targeting === 'none') {
    if (cc || region || town || zipCode || asnRaw) throw new Error('ProxyEmpire: Static Residential takes no location. Clear Country, State, City, ZIP and ASN.');
    if (lifeSet) throw new Error('ProxyEmpire: Static Residential IPs are fixed. Leave Keep same IP blank.');
    return { body, mode: 'fixed', name: p.name, lifeMin: 0 };
  }
  if (p.targeting === 'country' && (region || town || zipCode || asnRaw)) throw new Error('ProxyEmpire: Rotating Datacenter takes a country only. Clear State, City, ZIP and ASN.');
  if ((region || town) && !cc) throw new Error('ProxyEmpire: pick a country before a state or city.');
  if (zipCode && !cc) throw new Error('ProxyEmpire: a ZIP code needs a country.');
  if (zipCode && !/^[A-Za-z0-9 -]{2,12}$/.test(zipCode)) throw new Error(`ProxyEmpire: "${zipCode}" is not a ZIP code.`);
  if (asnRaw && !/^\d{1,10}$/.test(asnNum)) throw new Error('ProxyEmpire: an ASN is digits only, for example 7922.');
  // The Datacenter country list names the UK uk; the other pools use gb.
  if (cc === 'gb' && p.type === 'datacenter') cc = 'uk';
  else if (cc === 'uk' && p.type !== 'datacenter') cc = 'gb';
  if (cc) body.country = cc;
  if (region) body.region = region;
  if (town) body.city = town;
  if (zipCode) body.zip = zipCode;
  if (asnNum) body.asn = asnNum;
  let mode;
  if (lifeSet) {
    mode = 'custom';
    body.ip_rotation_type = 'custom';
    body.session_lifetime = Math.min(PROXYEMPIRE_MAX_LIFE, minutes);
  } else if (n > 1) {
    mode = 'sticky';
    body.ip_rotation_type = 'sticky';
  } else {
    mode = 'random';
    body.ip_rotation_type = 'random';
  }
  return { body, mode, name: p.name, lifeMin: body.session_lifetime || 0 };
}

// GET /user: { message, data: { residential, mobile, datacenter, "static-resi", "private-resi" } },
// each slot null or { proxy_username, proxy_password, bandwidth, provider_availability }. `found` is
// false when the reply has no data object at all.
function proxyEmpireSlot(json, pool) {
  const j = parseJsonBody(json);
  const data = j && j.data && typeof j.data === 'object' && !Array.isArray(j.data) ? j.data : null;
  if (!data) return { found: false, slot: null };
  const p = PROXYEMPIRE_POOLS[String(pool || '').toLowerCase()];
  const slot = data[p ? p.type : String(pool || '')];
  return { found: true, slot: slot && typeof slot === 'object' ? slot : null };
}

// A failed call, as a fixed message: the token is never echoed. 422 carries Laravel's
// { message, errors: { field: [text] } }, whose first text is shown.
function proxyEmpireErrorMessage(error, poolName = 'proxy') {
  const status = error && error.status;
  const text = String((error && error.message) || '');
  if (status === 401) return 'ProxyEmpire rejected the API token. Create a new one under Settings, API Tokens.';
  if (status === 403) {
    return /not active/i.test(text)
      ? 'ProxyEmpire: your account is not active. Check the panel.'
      : 'ProxyEmpire: this token is missing a permission the pull needs. Create a token with the read ability (and create, if ProxyEmpire asks for it).';
  }
  if (status === 422) {
    if (/no active package/i.test(text)) return `ProxyEmpire: this account has no ${poolName} package.`;
    const m = /"errors"\s*:\s*\{\s*"[^"]*"\s*:\s*\[\s*"((?:[^"\\]|\\.)*)"/.exec(text) || /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
    const why = m ? m[1].replace(/\\(.)/g, '$1').replace(/[.\s]+$/, '').slice(0, 160) : 'the request was not valid';
    return `ProxyEmpire refused the request: ${why}.`;
  }
  if (status === 429) {
    const s = retryAfterSeconds(error && (error.headers || { 'retry-after': error.retryAfter }), text);
    return `ProxyEmpire: too many proxy-list requests. Wait ${s ? `${s} second${s === 1 ? '' : 's'}` : 'a minute'} and pull again.`;
  }
  if (Number(status) >= 500) return `ProxyEmpire: the API failed (HTTP ${status}). Try again later.`;
  if (status) return `ProxyEmpire: the API answered HTTP ${status}. Try again later.`;
  if (/timed out/i.test(text)) return 'ProxyEmpire did not answer in time. Try again in a moment.';
  return 'ProxyEmpire: could not reach the API. Check your connection and try again.';
}

// GET /countries?connection_type=<pool>: { countries: [{ name, code }], counts, provider_availability }.
function proxyEmpireCountries(json) {
  const j = parseJsonBody(json);
  const list = Array.isArray(j && j.countries) ? j.countries : (Array.isArray(j && j.data && j.data.countries) ? j.data.countries : []);
  const out = [];
  const seen = new Set();
  for (const c of list) {
    const code = String((c && c.code) || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    out.push({ key: code, label: String((c && c.name) || '').trim() || code });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------------------
// MountProxies (api.mountproxies.com/api, Swagger 2.0 v1.0.0 read 2026-11-10). GET
// /proxies?api_key=<KEY>&output=json lists every proxy with its login and keys: { success, data: [{
// proxy_ip, http_port, username, password, modem_key, subscription_key, api_key, cellular_network,
// location, auto_renew_at, expire_at, billing_cycle, ... }] }. Each item echoes the account api_key,
// so a row keeps none of the keys. HTTP only: the API gives no SOCKS5 port. Built from the docs only.
function mountProxiesList(body) {
  const j = parseJsonBody(body);
  return j && j.success === true && Array.isArray(j.data) ? j.data.filter((p) => p && typeof p === 'object') : null;
}

// expire_at is a date, or "N/A" for a plan that renews.
function mountProxiesExpiry(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? { day: s.slice(0, 10), ms } : null;
}

function mountProxiesRows(body, { now = Date.now() } = {}) {
  const list = mountProxiesList(body);
  if (!list) return { rows: [], total: 0, expired: 0, noLogin: 0, error: 'MountProxies: the API reported a failure. Try again later.' };
  const rows = [];
  const seen = new Set();
  let expired = 0; let noLogin = 0;
  for (const p of list) {
    const ends = mountProxiesExpiry(p.expire_at);
    if (ends && ends.ms <= now) { expired += 1; continue; }
    const host = String(p.proxy_ip || '').trim();
    const port = Number.parseInt(String(p.http_port), 10);
    if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    const username = p.username != null ? String(p.username) : '';
    const password = p.password != null ? String(p.password) : '';
    // A modem set to IP authorization only has no login to store.
    if (!username || !password) { noLogin += 1; continue; }
    const k = `${host}:${port}:${username}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const carrier = String(p.cellular_network || '').trim();
    const place = String(p.location || '').trim();
    rows.push({
      type: 'HTTP',
      host, port, username, password,
      label: ['MountProxies', carrier, place, String(port)].filter(Boolean).join(' • ') + (ends ? ` • until ${ends.day}` : ''),
      country: 'US'
    });
  }
  return { rows, total: list.length, expired, noLogin, error: '' };
}

// The keys Rotate IP needs for one stored proxy, matched by IP, port and username; null when the
// account no longer lists it. Only main holds these, for the length of one rotation.
function mountProxiesRotateTarget(body, { host, port, username } = {}) {
  const list = mountProxiesList(body);
  if (!list) return null;
  const h = String(host || '').trim();
  const pt = Number(port);
  const u = String(username || '');
  const p = list.find((x) => String(x.proxy_ip || '').trim() === h && Number(x.http_port) === pt && String(x.username == null ? '' : x.username) === u);
  if (!p) return null;
  const sub = String(p.subscription_key == null ? '' : p.subscription_key).trim();
  const modem = String(p.modem_key == null ? '' : p.modem_key).trim();
  return sub || modem ? { subscriptionKey: sub, modemKey: modem } : null;
}

// ---------------------------------------------------------------------------------------
// Massive (docs.joinmassive.com, read 2026-11-10). Residential gateway network.joinmassive.com (HTTP
// 65534, SOCKS5 65533); ISP isp.joinmassive.com:8000 for both, with no targeting. The targeting rides in
// the username as dash-separated key-value pairs, any order:
// {USER}-country-US-subdivision-NY-city-New%20York-session-abc-sessionttl-60. The proxy password is the
// account's API token. Built from the docs only: never checked against a live account.
const MASSIVE_MAX_TTL = 1440; // sessionttl: minutes, default 15, not extended by use

// The bare login from a pasted username: everything before the first targeting key.
function massiveBaseUser(raw) {
  const s = String(raw || '').trim();
  const m = /-(country|session|type|subaccount)-/i.exec(s);
  return (m ? s.slice(0, m.index) : s).trim();
}

// City names are GeoNames English names, URL-encoded; a dash is encoded too, so a name like
// Winston-Salem cannot split the dash-separated username.
function massiveCity(v) {
  return encodeURIComponent(String(v || '').trim()).replace(/-/g, '%2D');
}

function massiveUsername(base, { type, country, subdivision, city, zip, asn, session, ttlMin } = {}) {
  const parts = [base];
  const cc = String(country || '').trim().toUpperCase();
  if (cc) {
    parts.push('country', cc);
    const sub = String(subdivision || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (sub) parts.push('subdivision', sub);
    // With a ZIP code Massive ignores the city, so only one is sent.
    const z = String(zip || '').trim().replace(/\s+/g, '');
    const ct = String(city || '').trim();
    if (z) parts.push('zipcode', encodeURIComponent(z).replace(/-/g, '%2D'));
    else if (ct) parts.push('city', massiveCity(ct));
    const a = String(asn || '').trim().replace(/^AS/i, '');
    if (/^\d{1,10}$/.test(a)) parts.push('asn', a);
  }
  if (type) parts.push('type', type);
  const sid = String(session || '').trim();
  if (sid) {
    parts.push('session', sid);
    const t = Number.parseInt(String(ttlMin == null ? '' : ttlMin), 10);
    if (Number.isFinite(t) && t > 0) parts.push('sessionttl', String(Math.min(MASSIVE_MAX_TTL, t)));
  }
  return parts.join('-');
}

// ---------------------------------------------------------------------------------------
// iProxy.online Console API (iproxy.online/api/console/v1, Swagger specs/console/Console-API.yaml and the
// guide at iproxy.online/docs-api-console, read 2026-11-10). GET /proxy-access lists every proxy access
// on the user's phones; GET /actionlinks?action=changeip lists each phone's change-IP link, a plain GET
// that needs no key ("changeip command has been sent"); GET /connections names the phones. One phone
// is one connection, so all its proxy accesses change IP together. Built from the docs only.
function iproxyList(body, field) {
  const j = parseJsonBody(body);
  return j && Array.isArray(j[field]) ? j[field].filter((x) => x && typeof x === 'object') : [];
}

// connection_id -> its newest change-IP link. Only an https:// link that does not carry the user's API
// key is kept: it becomes the proxy's rotationUrl, which members with proxies.reveal can see.
function iproxyChangeIpLinks(body, { key = '' } = {}) {
  const out = new Map();
  const newest = new Map();
  for (const l of iproxyList(body, 'action_links')) {
    if (l.action != null && String(l.action).toLowerCase() !== 'changeip') continue;
    const link = String(l.link || '').trim();
    const conn = String(l.connection_id == null ? '' : l.connection_id);
    if (!conn || !/^https:\/\/[^\s]+$/i.test(link)) continue;
    if (key && key.length >= 4 && (link.includes(key) || link.includes(encodeURIComponent(key)))) continue;
    const at = Date.parse(String(l.created_at || '')) || 0;
    if (newest.has(conn) && newest.get(conn) > at) continue;
    newest.set(conn, at);
    out.set(conn, link);
  }
  return out;
}

// connection_id -> { name, country, planEndsAt } from GET /connections (or the guide's /connection).
function iproxyConnections(body) {
  const out = new Map();
  for (const c of iproxyList(body, 'connections')) {
    const id = String(c.id == null ? '' : c.id);
    if (!id) continue;
    const info = c.basic_info && typeof c.basic_info === 'object' ? c.basic_info : {};
    const app = c.app_data && typeof c.app_data === 'object' ? c.app_data : {};
    const plan = c.plan_info && typeof c.plan_info === 'object' && c.plan_info.active_plan && typeof c.plan_info.active_plan === 'object' ? c.plan_info.active_plan : null;
    const cc = String(app.ip_country_code || '').trim().toUpperCase();
    out.set(id, { name: String(info.name || '').trim(), country: /^[A-Z]{2}$/.test(cc) ? (cc === 'UK' ? 'GB' : cc) : '', planEndsAt: plan ? plan.expires_at : null, active: Boolean(plan) });
  }
  return out;
}

// Rows for one protocol: user:pass accesses only, not turned off, not expired. Counts say why the rest
// were left out, and how many phones with rows have no change-IP link.
function iproxyRows(accessesBody, linksBody, connectionsBody, { socks = false, now = Date.now(), key = '' } = {}) {
  const accesses = iproxyList(accessesBody, 'proxy_accesses');
  const links = iproxyChangeIpLinks(linksBody, { key });
  const phones = iproxyConnections(connectionsBody);
  const want = socks ? 'socks5' : 'http';
  const rows = [];
  const seen = new Set();
  const noLinkPhones = new Set();
  let inactive = 0; let noAuth = 0; let wrongProtocol = 0;
  for (const a of accesses) {
    const ends = a.expires_at ? Date.parse(String(a.expires_at)) : NaN;
    if (a.deactivated_at || (Number.isFinite(ends) && ends <= now)) { inactive += 1; continue; }
    if (String(a.listen_service || '').toLowerCase() !== want) { wrongProtocol += 1; continue; }
    const auth = a.auth && typeof a.auth === 'object' ? a.auth : {};
    const username = auth.login != null ? String(auth.login) : '';
    const password = auth.password != null ? String(auth.password) : '';
    if (String(a.auth_type || '').toLowerCase() !== 'userpass' || !username || !password) { noAuth += 1; continue; }
    const host = String(a.hostname || a.ip || '').trim();
    const port = Number.parseInt(String(a.port), 10);
    if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    const k = `${host}:${port}:${username}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const conn = String(a.connection_id == null ? '' : a.connection_id);
    const phone = phones.get(conn) || { name: '', country: '' };
    const link = links.get(conn) || null;
    if (!link) noLinkPhones.add(conn || k);
    const what = String(a.description || '').replace(/\s+/g, ' ').trim().slice(0, 60) || (a.id != null ? `#${a.id}` : '');
    rows.push({
      type: socks ? 'SOCKS5' : 'HTTP',
      host, port, username, password,
      label: ['iProxy', phone.name, what, phone.country].filter(Boolean).join(' • '),
      country: phone.country || null,
      rotationUrl: link
    });
  }
  return { rows, total: accesses.length, inactive, noAuth, wrongProtocol, noLinkPhones: noLinkPhones.size };
}

module.exports = {
  ipBurgerBaseUser,
  ipBurgerUsername,
  proxy302Token,
  proxy302CountryId,
  proxy302Row, proxy302AreaId, proxy302PurchaseQuery,
  rapidProxySid,
  froxyBasePassword,
  medianMs,
  LIVEPROXIES_GATEWAY, LIVEPROXIES_SID_MAX,
  liveProxiesBaseUser,
  liveProxiesUsername,
  liveProxiesStickyHost,
  pickGeoConsensus,
  mobileProxySpaceRows, mobileProxySpaceCountries,
  proxySolutionsPage,
  rapidProxyUsername,
  NOVADA_ZONES, NOVADA_MAX_SESSTIME,
  novadaUsername,
  PROXIESSX_POOLS,
  proxiesSxSid,
  proxiesSxUsername,
  proxiesSxProxyCreds, proxiesSxStock, PROXIESSX_MOBILE_COUNTRIES, PROXIESSX_MAX_SESSIONS,
  liveProxiesListUrl,
  liveProxiesRows,
  liveProxiesPlanLabel,
  parseIpRoyalLine,
  ipRoyalLifetime,
  ipRoyalLocation,
  pickIpRoyalPort,
  ipRoyalCountriesView,
  ipRoyalErrorMessage,
  ipRoyalMaxCount, ipRoyalCountRefused, ipRoyalLifetimeFromMinutes,
  placeToken,
  oxylabsBaseUser, oxylabsUsername, OXYLABS_MAX_SESSTIME,
  decodoBaseUser, decodoUsername, DECODO_MAX_DURATION,
  brightDataZoneUser, brightDataUsername, brightDataRouteIps, brightDataState, US_STATE_CODES,
  apifyUsername,
  anyIpPlace,
  GEOJS_URL,
  normalizeGeoJs,
  PROXY_SELLER_ORDER_TYPES,
  proxySellerOrderRows,
  summarizeProxySellerOrders,
  PROXY_SELLER_PAGE_SIZE, proxySellerPageInfo,
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
  froxyPassword, froxyPastedPool, FROXY_TYPE_WORDS,
  packetStreamPassword, packetStreamCountry, PACKETSTREAM_COUNTRIES,
  airproxyRows, AIRPROXY_COUNTRY,
  catProxiesResiUsername,
  catProxiesPremiumPassword, catProxiesPremiumSession, catProxiesPremiumLifetime,
  CATPROXIES_MOBILE_TTLS, catProxiesMobileTtl,
  catProxiesMobileUsername,
  catProxiesCreds,
  parseProxidizePerProxy,
  proxidizeNextPage, collectProxidizePerProxy,
  proxidizeGeoToken,
  proxidizePerGbUsername,
  proxmintUsername, proxmintPickProduct,
  databayUsername, databayZone,
  ipfoxyUsername, mangoProxyRows,
  mangoProxyPlace, mangoProxyAsn, mangoProxyCollect, MANGOPROXY_BATCH_MAX, mangoProxyCountryPage,
  twoExtractBaseUser, twoExtractCountry, twoExtractUsername,
  gonzoProxyBaseLogin, gonzoProxyUsername, gonzoProxyTtl,
  SIMPLYPROXIES_NETWORKS, simplyProxiesUsername,
  coroniumRows, coroniumExpiryMs,
  singaporeMobileProxyRows,
  gsocksProxyIds, gsocksListRows, gsocksAuthSchemes,
  proxyBonanzaRows,
  proxy6Page,
  catProxiesIspRows, catProxiesDatacenterRows,
  retryAfterWait, vendorErrorText, vendorErrorCode, parseVendorProxyString, collectVendorStrings,
  PROXYBRAZIL_KEY, proxyBrazilRows, proxyBrazilErrorMessage, proxyBrazilRotateRefusal,
  proxyUdpFlagCountry, proxyUdpSubscriptions, proxyUdpRows, proxyUdpFindSubscription, proxyUdpRotateOutcome,
  ZOKOL_ISPS, zokolRows, zokolRotateRefusal,
  RESIPROX_POOLS, resiProxPool, resiProxCountries, resiProxRow,
  SIMPLYNODE_POOLS, SIMPLYNODE_RESET_PORTS, simplyNodeTrafficValue, simplyNodeSubaccountPick, simplyNodeCountries, simplyNodeProxyBody, simplyNodeRow,
  retryAfterSeconds,
  NODE4_GATEWAY_PRODUCTS, NODE4_CALL_MAX, node4GatewayBody, node4GatewayRows, node4StaticRows, node4Countries,
  PROXYEMPIRE_POOLS, proxyEmpireBody, proxyEmpireSlot, proxyEmpireErrorMessage, proxyEmpireCountries,
  mountProxiesRows, mountProxiesRotateTarget,
  massiveBaseUser, massiveUsername,
  iproxyChangeIpLinks, iproxyConnections, iproxyRows
};
