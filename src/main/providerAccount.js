'use strict';
// Account status per proxy provider (status, plan, expiry, traffic, balance), read from each vendor's
// documented account endpoint with the credentials saved for the pull. Only vendors whose docs
// describe such an endpoint have an adapter; the rest report "not supported" with a dashboard link.
// Parsers are pure and the HTTP call is injected, so tests run the documented sample payloads.

const { unwrapProxySeller } = require('./proxyVendorUtils');

const GIB = 1024 ** 3;
const STATUSES = new Set(['active', 'expired', 'suspended', 'unknown']);

function emptyAccount() {
  return {
    status: 'unknown', plan: null, expiresAt: null,
    trafficLeftGb: null, trafficUsedGb: null, trafficTotalGb: null,
    balance: null, currency: null, dashboardUrl: null, note: null
  };
}

// Finite number from a number or numeric string; anything else is null.
function num(v) {
  if (v == null || typeof v === 'boolean') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function round3(n) { return Math.round(n * 1000) / 1000; }
function bytesToGb(v) { const n = num(v); return n == null ? null : round3(n / GIB); }
function mbToGb(v) { const n = num(v); return n == null ? null : round3(n / 1024); }
function gbValue(v) { const n = num(v); return n == null ? null : round3(n); }

// Expiry as 'YYYY-MM-DD' when the vendor gives a date (or a date-time with no zone, whose zone is
// unknown) and as a full ISO string when the instant is exact (unix time or a zoned timestamp).
function normDate(v) {
  if (v == null || v === '' || typeof v === 'boolean') return null;
  const n = num(v);
  if (n != null) {
    if (n <= 0) return null;
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const s = String(v).trim();
  const day = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(s);
  if (day) {
    const d = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])));
    return Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(day[3]) ? null : `${day[1]}-${day[2]}-${day[3]}`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  // DD.MM.YYYY, with or without a time, as some vendors print dates.
  const eu = /^(\d{2})\.(\d{2})\.(\d{4})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.exec(s);
  if (eu) return normDate(`${eu[3]}-${eu[2]}-${eu[1]}`);
  return null;
}

function expiryMs(expiresAt) {
  if (!expiresAt) return null;
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(expiresAt) ? Date.parse(`${expiresAt}T23:59:59Z`) : Date.parse(expiresAt);
  return Number.isFinite(ms) ? ms : null;
}

// The next expiry among several plans or proxies: the earliest one still ahead, or the latest past
// one when everything has ended (which then reads as expired).
function nextExpiry(values, now = Date.now()) {
  let ahead = null; let aheadMs = Infinity; let past = null; let pastMs = -Infinity;
  for (const v of values) {
    const d = normDate(v);
    const ms = expiryMs(d);
    if (ms == null) continue;
    if (ms >= now) { if (ms < aheadMs) { ahead = d; aheadMs = ms; } } else if (ms > pastMs) { past = d; pastMs = ms; }
  }
  return ahead || past;
}

function sumOrNull(values) {
  let total = null;
  for (const v of values) { const n = num(v); if (n != null) total = (total || 0) + n; }
  return total;
}

function uniqueText(values, max = 120) {
  const seen = [];
  for (const v of values) { const s = text(v, 60); if (s && !seen.includes(s)) seen.push(s); }
  return seen.length ? seen.join(', ').slice(0, max) : null;
}

// Notes are codes the renderer translates, so main never sends English prose to the card.
const NOTE_CODES = new Set(['firstToExpire', 'summedPlans', 'noActivePlans', 'noActiveProxies', 'planSizeOnly', 'firstPageOnly', 'usedLast7Days']);

function text(v, max) {
  if (v == null || typeof v === 'object') return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

function normStatus(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (STATUSES.has(s)) return s;
  if (/^(enabled|ok|paid|running|on)$/.test(s)) return 'active';
  if (/^(ended|finished|overdue)$/.test(s)) return 'expired';
  if (/^(blocked|banned|disabled|frozen|paused|suspend)$/.test(s)) return 'suspended';
  return 'unknown';
}

// Clamp every field to its type so a strange payload can never break the card. An expiry in the
// past turns an active or unknown status into expired.
function finalizeAccount(raw, { now = Date.now(), dashboardUrl = null } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = emptyAccount();
  out.status = normStatus(r.status);
  out.plan = text(r.plan, 120);
  out.expiresAt = normDate(r.expiresAt);
  for (const k of ['trafficLeftGb', 'trafficUsedGb', 'trafficTotalGb', 'balance']) {
    const n = num(r[k]);
    out[k] = n == null ? null : (k === 'balance' ? Math.round(n * 100) / 100 : Math.max(0, round3(n)));
  }
  if (out.trafficLeftGb == null && out.trafficTotalGb != null && out.trafficUsedGb != null) {
    out.trafficLeftGb = Math.max(0, round3(out.trafficTotalGb - out.trafficUsedGb));
  }
  const cur = text(r.currency, 8);
  out.currency = out.balance != null && cur ? cur.toUpperCase() : null;
  out.note = NOTE_CODES.has(r.note) ? r.note : null;
  out.dashboardUrl = dashboardUrl;
  const ends = expiryMs(out.expiresAt);
  if (ends != null && ends < now && (out.status === 'active' || out.status === 'unknown')) out.status = 'expired';
  return out;
}

function parseJson(body) {
  if (body && typeof body === 'object') return body;
  try { return JSON.parse(String(body)); } catch (e) { return null; }
}

// ---------------------------------------------------------------------------------------------
// Secrets: keys never appear in a result or an error. Each saved secret is masked raw, URL-encoded
// and as Basic auth, plus any userinfo or Bearer/Basic value in the text.
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function secretsOf(creds) {
  const c = creds && typeof creds === 'object' ? creds : {};
  const out = [];
  for (const f of ['token', 'password', 'apiToken', 'apiUrl']) if (c[f]) out.push(String(c[f]));
  // A username is only half a secret, so short ones are left alone to keep messages readable.
  if (c.username && String(c.username).length >= 6) out.push(String(c.username));
  if (c.username && c.password) out.push(Buffer.from(`${c.username}:${c.password}`).toString('base64'));
  return out;
}

function scrubSecrets(message, secrets = []) {
  let out = String(message == null ? '' : message);
  out = out.replace(/\/\/[^/@\s]*:[^/@\s]*@/g, '//***:***@');
  out = out.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ***');
  for (const raw of secrets) {
    const v = String(raw || '');
    if (v.length < 4) continue;
    for (const form of new Set([v, encodeURIComponent(v)])) out = out.replace(new RegExp(escapeRe(form), 'gi'), '***');
  }
  return out;
}

function scrubAccount(account, secrets) {
  const out = { ...account };
  for (const k of ['plan', 'note', 'currency']) if (typeof out[k] === 'string') out[k] = scrubSecrets(out[k], secrets);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Adapters. Each one: name, dashboardUrl, needs (saved credential fields), and
// fetch(creds, get) -> raw account fields. get(url, { headers }) resolves the body text and rejects
// with an Error carrying `status` on a non-2xx reply.

const ADAPTERS = {};

function bearer(token) {
  return { Authorization: `Bearer ${String(token || '').trim()}`, Accept: 'application/json' };
}

// ---- PROXY6: every reply carries balance + currency (RUB or USD); getproxy lists per-IP expiry ----
const PROXY6_API = 'https://px6.link/api';

// Failures come back as HTTP 200 { status: "no", error_id, error }.
function proxy6ErrorMessage(errorId, error) {
  const id = num(errorId);
  if (id === 100) return 'PROXY6 rejected the saved API key. Save it again on the Pull tab.';
  if (id === 105) return 'PROXY6 refused this computer\'s IP. Your API key has an IP restriction; add this IP or remove the restriction in your account.';
  return `PROXY6: ${text(error, 120) || 'the API reported an error'}${id != null ? ` (code ${id})` : ''}.`;
}

function parseProxy6Account(body, { now = Date.now() } = {}) {
  const j = parseJson(body);
  if (!j || typeof j !== 'object') throw new Error('PROXY6: the API did not return JSON.');
  if (j.status !== 'yes') throw new Error(proxy6ErrorMessage(j.error_id, j.error));
  const list = Array.isArray(j.list) ? j.list : (j.list && typeof j.list === 'object' ? Object.values(j.list) : []);
  const active = list.filter((p) => p && typeof p === 'object' && String(p.active) === '1');
  // unixtime_end is exact; date_end has no zone, so it is the fallback.
  const ends = active.map((p) => (num(p.unixtime_end) ? num(p.unixtime_end) : p.date_end));
  return {
    status: active.length ? 'active' : 'unknown',
    expiresAt: nextExpiry(ends, now),
    balance: j.balance,
    currency: j.currency,
    note: !active.length ? 'noActiveProxies' : (num(j.list_count) >= 1000 ? 'firstPageOnly' : (active.length > 1 ? 'firstToExpire' : null))
  };
}

ADAPTERS.proxy6 = {
  name: 'PROXY6', needs: ['token'], needsLabel: 'API key', dashboardUrl: 'https://proxy6.net/user/proxy',
  async fetch(c, get, opts) {
    const key = String(c.token).trim();
    if (!/^[A-Za-z0-9_-]{6,200}$/.test(key)) throw new Error('PROXY6: the saved API key does not look right. Save it again on the Pull tab.');
    return parseProxy6Account(await get(`${PROXY6_API}/${encodeURIComponent(key)}/getproxy/?state=active&nokey&limit=1000&page=1`), opts);
  }
};

// ---- Proxmint: GET /api/v1/account, balance in USD, bandwidth per product in bytes, no end date ----
const PROXMINT_API = 'https://proxmint.com/api/v1';

function parseProxmintAccount(body) {
  const j = parseJson(body);
  if (!j || typeof j !== 'object') throw new Error('Proxmint: the API did not return JSON.');
  if (j.error) throw new Error(`Proxmint: ${text(j.error, 160)}`);
  const products = Array.isArray(j.products) ? j.products.filter((p) => p && typeof p === 'object') : [];
  const live = products.filter((p) => normStatus(p.status) === 'active');
  const counted = live.length ? live : products;
  const statuses = products.map((p) => normStatus(p.status));
  let status = 'unknown';
  if (live.length) status = 'active';
  else if (statuses.includes('suspended')) status = 'suspended';
  else if (statuses.length && statuses.every((s) => s === 'expired')) status = 'expired';
  const bw = counted.map((p) => (p.bandwidth && typeof p.bandwidth === 'object' ? p.bandwidth : {}));
  const bal = j.balance && typeof j.balance === 'object' ? j.balance : {};
  const cents = num(bal.cents);
  const balance = num(bal.usd) != null ? num(bal.usd) : (cents != null ? cents / 100 : null);
  return {
    status,
    plan: uniqueText(counted.map((p) => p.name || p.product)),
    trafficLeftGb: bytesToGb(sumOrNull(bw.map((b) => b.remainingBytes))),
    trafficUsedGb: bytesToGb(sumOrNull(bw.map((b) => b.usedBytes))),
    trafficTotalGb: bytesToGb(sumOrNull(bw.map((b) => b.limitBytes))),
    balance,
    currency: balance != null ? 'USD' : null,
    note: !products.length ? 'noActivePlans' : (counted.length > 1 ? 'summedPlans' : null)
  };
}

ADAPTERS.proxmint = {
  name: 'Proxmint', needs: ['token'], needsLabel: 'API key', dashboardUrl: 'https://proxmint.com/dashboard',
  async fetch(c, get) {
    const key = String(c.token).trim();
    if (!/^pmk_[A-Za-z0-9_-]{8,200}$/.test(key)) throw new Error('Proxmint: the saved API key does not start with pmk_. Save it again on the Pull tab.');
    return parseProxmintAccount(await get(`${PROXMINT_API}/account`, { headers: { ...bearer(key), 'User-Agent': 'SoftGlaze-Browser' } }));
  }
};

// ---- CatProxies: GET /account (balance + currency) and the saved plan (GET /orders/:id) or every
// active plan (GET /orders). Bandwidth figures are in GB; locked means the plan ran out. ----
const CATPROXIES_API = 'https://catproxies.com/api/v1/user';

function catPayload(body, what) {
  const j = parseJson(body);
  if (!j || typeof j !== 'object') throw new Error(`CatProxies ${what}: the API did not return JSON.`);
  if (j.type === 'error') throw new Error(`CatProxies ${what}: ${text(j.message, 160) || 'request failed'}`);
  return j.payload && typeof j.payload === 'object' ? j.payload : {};
}

function parseCatProxiesAccount(accountBody, ordersBody, { now = Date.now() } = {}) {
  const acct = catPayload(accountBody, 'account');
  const ord = catPayload(ordersBody, 'plans');
  const orders = (ord.order && typeof ord.order === 'object' ? [ord.order] : (Array.isArray(ord.orders) ? ord.orders : []))
    .filter((o) => o && typeof o === 'object');
  const proxyOf = (o) => (o.proxy && typeof o.proxy === 'object' ? o.proxy : {});
  const open = orders.filter((o) => o.locked !== true);
  let status = 'unknown';
  if (open.some((o) => String(o.status || '').toUpperCase() === 'CONFIRMED')) status = 'active';
  else if (orders.length && !open.length) status = 'expired';
  const counted = open.length ? open : orders;
  return {
    status,
    plan: uniqueText(counted.map((o) => o.package_title)),
    expiresAt: nextExpiry(counted.map((o) => proxyOf(o).expired_at || o.expire), now),
    trafficLeftGb: gbValue(sumOrNull(counted.map((o) => proxyOf(o).bandwidth_left))),
    trafficUsedGb: gbValue(sumOrNull(counted.map((o) => proxyOf(o).used_bandwidth))),
    trafficTotalGb: gbValue(sumOrNull(counted.map((o) => o.package_bandwidth))),
    balance: acct.balance,
    currency: acct.currency,
    note: !orders.length ? 'noActivePlans' : (counted.length > 1 ? 'summedPlans' : null)
  };
}

ADAPTERS.catproxies = {
  name: 'CatProxies', needs: ['token'], needsLabel: 'API key', dashboardUrl: 'https://catproxies.com/dashboard/my-plans/active-plans',
  async fetch(c, get, opts) {
    const key = String(c.token).trim();
    if (!/^cp_[A-Za-z0-9]{8,128}$/.test(key)) throw new Error('CatProxies: the saved API key does not start with cp_. Save it again on the Pull tab.');
    const headers = bearer(key);
    const account = await get(`${CATPROXIES_API}/account`, { headers });
    // The Plan ID saved for the pull narrows it to that plan, whose figures are live.
    const id = String(c.orderId || '').trim();
    const orders = /^[0-9a-fA-F-]{8,40}$/.test(id)
      ? await get(`${CATPROXIES_API}/orders/${encodeURIComponent(id)}`, { headers })
      : await get(`${CATPROXIES_API}/orders?page=1&pageSize=100`, { headers });
    return parseCatProxiesAccount(account, orders, opts);
  }
};

// ---- MobileProxy.Space: get_balance (no currency in the docs) and get_my_proxy (per-proxy proxy_exp) ----
// The API moved to mpsapi.com; mobileproxy.space/api.html was announced to stop after 31 Aug 2026.
const MOBILEPROXYSPACE_API = 'https://mpsapi.com/api.html';

function mpsBody(body, what) {
  const j = parseJson(body);
  if (j == null) throw new Error(`MobileProxy.Space ${what}: the API did not return JSON.`);
  if (!Array.isArray(j) && /^err/i.test(String(j.status || ''))) throw new Error(`MobileProxy.Space ${what}: ${text(j.message, 160) || 'request failed'}`);
  return j;
}

function parseMobileProxySpaceAccount(balanceBody, proxiesBody, { now = Date.now() } = {}) {
  const bal = mpsBody(balanceBody, 'balance');
  const p = mpsBody(proxiesBody, 'proxy list');
  // The HTML docs show a bare array, the OpenAPI spec { status, list }.
  const list = (Array.isArray(p) ? p : (Array.isArray(p.list) ? p.list : [])).filter((x) => x && typeof x === 'object');
  return {
    status: list.length ? 'active' : 'unknown',
    expiresAt: nextExpiry(list.map((x) => x.proxy_exp), now),
    balance: Array.isArray(bal) ? null : bal.balance,
    currency: null,
    note: !list.length ? 'noActiveProxies' : (list.length > 1 ? 'firstToExpire' : null)
  };
}

ADAPTERS.mobileproxyspace = {
  name: 'MobileProxy.Space', needs: ['token'], needsLabel: 'API token', dashboardUrl: 'https://mobileproxy.space/en/user.html',
  async fetch(c, get, opts) {
    const headers = bearer(c.token);
    const balance = await get(`${MOBILEPROXYSPACE_API}?command=get_balance`, { headers });
    const proxies = await get(`${MOBILEPROXYSPACE_API}?command=get_my_proxy`, { headers });
    return parseMobileProxySpaceAccount(balance, proxies, opts);
  }
};

// ---- Proxy Bonanza: GET userpackages.json lists the active plans with name, expiry and plan size.
// Its `bandwidth` figure is not documented as left or used, so only the plan size is shown. ----
const PROXYBONANZA_API = 'https://proxybonanza.com/api/v1';

function parseProxyBonanzaAccount(body, { now = Date.now() } = {}) {
  const j = parseJson(body);
  if (!j || typeof j !== 'object') throw new Error('Proxy Bonanza: the API did not return JSON.');
  if (j.success !== true) {
    const msg = j.data && typeof j.data === 'object' ? text(j.data.message, 160) : null;
    throw new Error(`Proxy Bonanza: ${msg || 'the API reported a failure.'}`);
  }
  const plans = (Array.isArray(j.data) ? j.data : []).filter((p) => p && typeof p === 'object');
  const pkg = (p) => (p.package && typeof p.package === 'object' ? p.package : {});
  return {
    // The endpoint lists only plans that have not expired.
    status: plans.length ? 'active' : 'unknown',
    plan: uniqueText(plans.map((p) => p.custom_name || p.name || pkg(p).name)),
    expiresAt: nextExpiry(plans.map((p) => p.expires), now),
    trafficTotalGb: bytesToGb(sumOrNull(plans.map((p) => pkg(p).bandwidth))),
    note: plans.length ? 'planSizeOnly' : 'noActivePlans'
  };
}

ADAPTERS.proxybonanza = {
  name: 'Proxy Bonanza', needs: ['token'], needsLabel: 'API key', dashboardUrl: null,
  async fetch(c, get, opts) {
    const key = String(c.token).trim();
    if (!/^[^\s!]{8,}![0-9]+$/.test(key)) throw new Error('Proxy Bonanza: the saved API key is missing its !<user id> ending. Save the full key again on the Pull tab.');
    return parseProxyBonanzaAccount(await get(`${PROXYBONANZA_API}/userpackages.json`, { headers: { Authorization: key, Accept: 'application/json' } }), opts);
  }
};

// ---- Proxies.sx: GET /v1/account (X-API-Key, scope account:read): wallet, traffic per subscription
// in GB, active flags. Traffic never expires, so there is no end date. ----
const PROXIESSX_API = 'https://api.proxies.sx/v1';

function parseProxiesSxAccount(body) {
  const j = parseJson(body);
  if (!j || typeof j !== 'object') throw new Error('Proxies.sx: the API did not return JSON.');
  if (typeof j.error === 'string' || (j.error && typeof j.error === 'object')) {
    throw new Error(`Proxies.sx: ${text(typeof j.error === 'string' ? j.error : j.error.message, 160) || 'request failed'}`);
  }
  const subs = j.subscription && typeof j.subscription === 'object' ? j.subscription : {};
  const kinds = [['shared', 'Shared'], ['private', 'Private']]
    .map(([k, label]) => ({ label, s: subs[k] && typeof subs[k] === 'object' ? subs[k] : null }))
    .filter((x) => x.s);
  const live = kinds.filter((x) => x.s.active === true);
  const counted = live.length ? live : kinds;
  const traffic = counted.map((x) => (x.s.traffic && typeof x.s.traffic === 'object' ? x.s.traffic : {}));
  const user = j.user && typeof j.user === 'object' ? j.user : {};
  const flags = j.status && typeof j.status === 'object' ? j.status : {};
  let status = 'unknown';
  if (user.isActive === false) status = 'suspended';
  else if (flags.hasActiveSubscription === true || live.length) status = 'active';
  const wallet = j.wallet && typeof j.wallet === 'object' ? j.wallet : {};
  return {
    status,
    plan: uniqueText(live.map((x) => x.label)),
    trafficLeftGb: gbValue(sumOrNull(traffic.map((t) => t.availableGB))),
    trafficUsedGb: gbValue(sumOrNull(traffic.map((t) => t.usedGB))),
    trafficTotalGb: gbValue(sumOrNull(traffic.map((t) => t.purchasedGB))),
    balance: wallet.availableBalance,
    currency: wallet.currency,
    note: counted.length > 1 ? 'summedPlans' : null
  };
}

ADAPTERS.proxiessx = {
  name: 'Proxies.sx', needs: ['token'], needsLabel: 'API key', dashboardUrl: 'https://client.proxies.sx',
  async fetch(c, get) {
    const key = String(c.token).trim();
    if (/\s/.test(key)) throw new Error('Proxies.sx: the saved API key does not look right. Save it again on the Pull tab.');
    return parseProxiesSxAccount(await get(`${PROXIESSX_API}/account`, { headers: { 'X-API-Key': key, Accept: 'application/json' } }));
  }
};

// ---- Coronium: GET /account (USDT and account credit, both USD) and GET /account/proxies, whose
// tariff_expired_at is each line's end in epoch milliseconds. Dedicated lines are not metered. ----
const CORONIUM_API = 'https://api.coronium.io/api/v3';

function coroniumJson(body, what) {
  const j = parseJson(body);
  if (j == null) throw new Error(`Coronium ${what}: the API did not return JSON.`);
  if (!Array.isArray(j) && typeof j.error === 'string') throw new Error(`Coronium ${what}: ${text(j.error, 160)}`);
  return j;
}

function parseCoroniumAccount(accountBody, proxiesBody, { now = Date.now() } = {}) {
  const a = coroniumJson(accountBody, 'account');
  const p = coroniumJson(proxiesBody, 'proxy list');
  const rows = (Array.isArray(p.data) ? p.data : []).filter((x) => x && typeof x === 'object');
  const usdt = a.usdt && typeof a.usdt === 'object' ? num(a.usdt.balance) : null;
  const balance = sumOrNull([usdt, a.accountCredit]);
  const count = num(a.proxyCount);
  const any = rows.length > 0 || (count != null && count > 0);
  return {
    status: any ? 'active' : 'unknown',
    expiresAt: nextExpiry(rows.map((r) => r.tariff_expired_at), now),
    balance,
    currency: balance != null ? 'USD' : null,
    note: !any ? 'noActiveProxies' : (rows.length > 1 ? 'firstToExpire' : null)
  };
}

ADAPTERS.coronium = {
  name: 'Coronium', needs: ['token'], needsLabel: 'API key', dashboardUrl: 'https://dashboard.coronium.io',
  async fetch(c, get, opts) {
    const headers = bearer(c.token);
    const account = await get(`${CORONIUM_API}/account`, { headers });
    const proxies = await get(`${CORONIUM_API}/account/proxies`, { headers });
    return parseCoroniumAccount(account, proxies, opts);
  }
};

// ---- Singapore Mobile Proxy: GET /proxies/my (plan, licence state, ISO expiry, GB limit and used)
// and GET /account/balance (credits; the docs name no currency). ----
const SINGAPOREMOBILEPROXY_API = 'https://singaporemobileproxy.com/api/v1';

function smpJson(body, what) {
  const j = parseJson(body);
  if (!j || typeof j !== 'object') throw new Error(`Singapore Mobile Proxy ${what}: the API did not return JSON.`);
  if (j.detail && typeof j.detail === 'object') throw new Error(`Singapore Mobile Proxy ${what}: ${text(j.detail.message, 160) || 'request failed'}`);
  return j;
}

function parseSingaporeMobileProxyAccount(proxiesBody, balanceBody, { now = Date.now() } = {}) {
  const p = smpJson(proxiesBody, 'proxy list');
  const b = smpJson(balanceBody, 'balance');
  const list = (Array.isArray(p.proxyList) ? p.proxyList : []).filter((x) => x && typeof x === 'object');
  const active = list.filter((x) => String(x.license_status || '').toUpperCase() === 'ACTIVE');
  const counted = active.length ? active : list;
  return {
    status: active.length ? 'active' : 'unknown',
    plan: uniqueText(counted.map((x) => x.package_name)),
    expiresAt: nextExpiry(counted.map((x) => x.expired_date), now),
    trafficUsedGb: gbValue(sumOrNull(counted.map((x) => x.bandwidth_used_gb))),
    trafficTotalGb: gbValue(sumOrNull(counted.map((x) => x.bandwidth_limit_gb))),
    balance: b.credits,
    currency: null,
    note: !list.length ? 'noActiveProxies' : (counted.length > 1 ? 'summedPlans' : null)
  };
}

ADAPTERS.singaporemobileproxy = {
  name: 'Singapore Mobile Proxy', needs: ['token'], needsLabel: 'API key', dashboardUrl: 'https://singaporemobileproxy.com/client/dashboard',
  async fetch(c, get, opts) {
    const headers = { 'x-api-key': String(c.token).trim(), Accept: 'application/json' };
    const proxies = await get(`${SINGAPOREMOBILEPROXY_API}/proxies/my`, { headers });
    const balance = await get(`${SINGAPOREMOBILEPROXY_API}/account/balance`, { headers });
    return parseSingaporeMobileProxyAccount(proxies, balance, opts);
  }
};

// ---- MarsProxies residential: GET /v1/residential/me gives traffic_available in GB. Traffic does
// not expire and the API reports no balance, plan or used figure for the main account. ----
const MARS_API = 'https://api.marsproxies.com';

function parseMarsProxiesAccount(body) {
  const j = parseJson(body);
  if (!j || typeof j !== 'object') throw new Error('MarsProxies: the API did not return JSON.');
  if (j.error && typeof j.error === 'object') throw new Error(`MarsProxies: ${text(j.error.message, 160) || 'request failed'}`);
  const left = gbValue(j.traffic_available);
  return { status: left != null && left > 0 ? 'active' : 'unknown', trafficLeftGb: left };
}

ADAPTERS.marsproxies = {
  name: 'MarsProxies', needs: ['token'], needsLabel: 'API token', dashboardUrl: 'https://dashboard.marsproxies.com/',
  async fetch(c, get) {
    return parseMarsProxiesAccount(await get(`${MARS_API}/v1/residential/me`, { headers: bearer(c.token) }));
  }
};

// ---- Proxidize Per GB: GET /pergb/{mobile|residential}/user-info gives bytes_used and
// bytes_available and an enabled flag; no plan, end date or balance. Both kinds are read. ----
const PROXIDIZE_API = 'https://api.proxidize.com/api/v1';

function parseProxidizeUserInfo(bodies) {
  const infos = bodies.map((b) => parseJson(b)).filter((j) => j && typeof j === 'object' && !Array.isArray(j));
  if (!infos.length) throw new Error('Proxidize: the API did not return JSON.');
  const enabled = infos.some((j) => j.enabled === true);
  return {
    status: enabled ? 'active' : (infos.every((j) => j.enabled === false) ? 'suspended' : 'unknown'),
    trafficLeftGb: bytesToGb(sumOrNull(infos.map((j) => j.bytes_available))),
    trafficUsedGb: bytesToGb(sumOrNull(infos.map((j) => j.bytes_used))),
    note: infos.length > 1 ? 'summedPlans' : null
  };
}

ADAPTERS.proxidize = {
  name: 'Proxidize', needs: ['token'], needsLabel: 'API token', dashboardUrl: 'https://www.app.proxidize.com/',
  async fetch(c, get) {
    const headers = bearer(c.token);
    const bodies = [];
    for (const kind of ['mobile', 'residential']) {
      try { bodies.push(await get(`${PROXIDIZE_API}/pergb/${kind}/user-info`, { headers })); } catch (e) {
        // A missing Per GB plan of one kind is not a failure if the other answers; a bad key is.
        if (e && (e.status === 401 || e.status === 403)) throw e;
      }
    }
    if (!bodies.length) throw new Error('Proxidize: no Per GB plan answered for this token. Per Proxy plans have no documented account endpoint.');
    return parseProxidizeUserInfo(bodies);
  }
};

// ---- Proxy-Seller: resident/package (bytes as strings, expired_at) and balance/get (summ; the docs
// name no currency). Errors arrive as HTTP 200 envelopes. The key sits in the URL path. ----
const PS_API = 'https://proxy-seller.com/personal/api/v2';

function parseProxySellerAccount(packageBody, balanceBody) {
  // A missing residential package ("Tarif not found") is not an error: per-IP customers have none.
  let pkg = null;
  if (packageBody != null) {
    try { pkg = unwrapProxySeller(packageBody, 'package check', ''); } catch (e) {
      if (!/no active residential package/i.test(String(e && e.message))) throw e;
    }
  }
  const bal = unwrapProxySeller(balanceBody, 'balance', '');
  const p = pkg && typeof pkg === 'object' ? pkg : null;
  return {
    status: p ? (p.is_active === true ? 'active' : 'unknown') : 'unknown',
    plan: p ? 'Residential' : null,
    expiresAt: p ? p.expired_at : null,
    trafficLeftGb: p ? bytesToGb(p.traffic_left) : null,
    trafficUsedGb: p ? bytesToGb(p.traffic_usage) : null,
    trafficTotalGb: p ? bytesToGb(p.traffic_limit) : null,
    balance: bal && typeof bal === 'object' ? bal.summ : null,
    currency: null,
    note: p ? null : 'noActivePlans'
  };
}

ADAPTERS.proxyseller = {
  name: 'Proxy-Seller', needs: ['token'], needsLabel: 'API key', dashboardUrl: 'https://proxy-seller.com/personal/',
  async fetch(c, get) {
    const key = String(c.token).trim();
    // The key becomes a path segment, so anything that would change the path is refused.
    if (!/^[^\s/?#%\\]{8,200}$/.test(key)) throw new Error('Proxy-Seller: the saved API key does not look right. Save it again on the Pull tab.');
    const pkg = await get(`${PS_API}/${key}/resident/package`);
    const balance = await get(`${PS_API}/${key}/balance/get`);
    return parseProxySellerAccount(pkg, balance);
  }
};

// ---- IPRoyal residential: GET /residential/me gives available_traffic (GB, the unit every
// neighbouring field uses). No used, total, end date or balance on this token. ----
const IPR_API = 'https://resi-api.iproyal.com/v1';

function parseIpRoyalAccount(body) {
  const j = parseJson(body);
  if (!j || typeof j !== 'object') throw new Error('IPRoyal: the API did not return JSON.');
  if (j.error && typeof j.error === 'object') throw new Error(`IPRoyal: ${text(j.error.message, 160) || 'request failed'}`);
  const left = gbValue(j.available_traffic);
  return { status: left != null && left > 0 ? 'active' : 'unknown', plan: 'Residential', trafficLeftGb: left };
}

ADAPTERS.iproyal = {
  name: 'IPRoyal', needs: ['token'], needsLabel: 'API token', dashboardUrl: 'https://dashboard.iproyal.com/',
  async fetch(c, get) {
    return parseIpRoyalAccount(await get(`${IPR_API}/residential/me`, { headers: bearer(c.token) }));
  }
};

// ---- Bright Data: GET /customer/balance (Bearer API key) gives balance and pending costs in USD.
// Nothing reports a plan end or traffic left. ----
const BRIGHTDATA_API = 'https://api.brightdata.com';

function parseBrightDataBalance(body) {
  const j = parseJson(body);
  if (!j || typeof j !== 'object') throw new Error('Bright Data: the API did not return JSON.');
  const balance = num(j.balance);
  return { status: 'unknown', balance, currency: balance != null ? 'USD' : null };
}

ADAPTERS.brightdata = {
  name: 'Bright Data', needs: ['apiToken'], needsLabel: 'API token', dashboardUrl: 'https://brightdata.com/cp/billing/overview',
  authMessage: 'Bright Data refused the balance request. Check the saved API token, and that its permission covers billing.',
  async fetch(c, get) {
    return parseBrightDataBalance(await get(`${BRIGHTDATA_API}/customer/balance`, { headers: bearer(c.apiToken) }));
  }
};

// ---- Gsocks: GET /client/balance (a string; no currency in the docs) and the residential and mobile
// volume endpoints (rest_volume / volume in GB). ----
const GSOCKS_API = 'https://api.gsocks.net';

function gsocksJson(body, what) {
  const j = parseJson(body);
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error(`Gsocks ${what}: the API did not return JSON.`);
  return j;
}

function parseGsocksAccount(balanceBody, volumeBodies) {
  const bal = gsocksJson(balanceBody, 'balance');
  const vols = volumeBodies.map((b) => gsocksJson(b, 'traffic'));
  const any = vols.some((v) => v.have_traffic === true);
  const used = vols.map((v) => { const total = num(v.volume); const rest = num(v.rest_volume); return total != null && rest != null ? total - rest : null; });
  return {
    status: any ? 'active' : 'unknown',
    trafficLeftGb: gbValue(sumOrNull(vols.map((v) => v.rest_volume))),
    trafficUsedGb: gbValue(sumOrNull(used)),
    trafficTotalGb: gbValue(sumOrNull(vols.map((v) => v.volume))),
    balance: bal.balance,
    currency: null,
    note: vols.filter((v) => num(v.volume)).length > 1 ? 'summedPlans' : null
  };
}

ADAPTERS.gsocks = {
  name: 'Gsocks', needs: ['token'], needsLabel: 'API key', dashboardUrl: 'https://gsocks.net/user/login',
  async fetch(c, get) {
    const key = String(c.token).trim();
    if (/\s/.test(key)) throw new Error('Gsocks: the saved API key does not look right. Save it again on the Pull tab.');
    const headers = { authorization: `key ${key}`, Accept: 'application/json' };
    const balance = await get(`${GSOCKS_API}/client/balance`, { headers });
    const volumes = [];
    for (const kind of ['residential', 'mobile']) {
      try { volumes.push(await get(`${GSOCKS_API}/proxy/${kind}-volume`, { headers })); } catch (e) {
        if (e && (e.status === 401 || e.status === 403)) throw e;
      }
    }
    return parseGsocksAccount(balance, volumes);
  }
};

// ---- MangoProxy: GET /balance (balanceUSD) and GET /traffic (total / used / available in MB per
// traffic type). Read from the vendor's OpenAPI schema. ----
const MANGOPROXY_API = 'https://backend.mangoproxy.com/public-api/v1';
const MANGO_TYPES = Object.freeze([['Residential', 'Residential'], ['Datacenter', 'Datacenter'], ['Isp', 'ISP'], ['ResidentialLight', 'Residential light']]);

function parseMangoProxyAccount(balanceBody, trafficBody) {
  const bal = parseJson(balanceBody);
  const tr = parseJson(trafficBody);
  if (!bal || typeof bal !== 'object' || !tr || typeof tr !== 'object') throw new Error('MangoProxy: the API did not return JSON.');
  const kinds = MANGO_TYPES.map(([k, label]) => ({ label, total: num(tr[`total${k}MB`]), used: num(tr[`used${k}MB`]), left: num(tr[`available${k}MB`]) }))
    .filter((x) => x.total != null || x.used != null || x.left != null);
  const bought = kinds.filter((x) => (x.total || 0) > 0);
  const counted = bought.length ? bought : kinds;
  const leftMb = sumOrNull(counted.map((x) => x.left));
  const balance = num(bal.balanceUSD);
  return {
    status: leftMb != null && leftMb > 0 ? 'active' : 'unknown',
    plan: uniqueText(bought.map((x) => x.label)),
    trafficLeftGb: mbToGb(leftMb),
    trafficUsedGb: mbToGb(sumOrNull(counted.map((x) => x.used))),
    trafficTotalGb: mbToGb(sumOrNull(counted.map((x) => x.total))),
    balance,
    currency: balance != null ? 'USD' : null,
    note: bought.length > 1 ? 'summedPlans' : null
  };
}

ADAPTERS.mangoproxy = {
  name: 'MangoProxy', needs: ['token'], needsLabel: 'API key', dashboardUrl: 'https://my.mangoproxy.com/',
  async fetch(c, get) {
    const headers = { 'x-api-key': String(c.token).trim(), Accept: 'application/json' };
    const balance = await get(`${MANGOPROXY_API}/balance`, { headers });
    const traffic = await get(`${MANGOPROXY_API}/traffic`, { headers });
    return parseMangoProxyAccount(balance, traffic);
  }
};

// ---- Node4: GET /status (read:proxies) gives ok + reason, bandwidth in MB when the plan is limited,
// and the active proxy count. The end date needs read:subscription, whose schema is not published. ----
const NODE4_API = 'https://node4.io/api/v1';

function parseNode4Account(body) {
  const j = parseJson(body);
  if (!j || typeof j !== 'object') throw new Error('Node4: the API did not return JSON.');
  if (typeof j.error === 'string' && j.error) throw new Error(`Node4: ${text(j.error, 160)}`);
  const d = j.data && typeof j.data === 'object' && !Array.isArray(j.data) ? j.data : j;
  const reason = String(d.reason == null ? '' : d.reason).toLowerCase();
  const sub = d.subscription && typeof d.subscription === 'object' ? d.subscription : {};
  let status = 'unknown';
  if (d.ok === true) status = 'active';
  else if (reason === 'user_inactive') status = 'suspended';
  else if (sub.active === false) status = normStatus(sub.status);
  const bw = d.bandwidth && typeof d.bandwidth === 'object' ? d.bandwidth : {};
  const limited = bw.limited === true;
  return {
    status,
    trafficUsedGb: mbToGb(bw.usedMb),
    trafficTotalGb: limited ? mbToGb(bw.limitMb) : null,
    trafficLeftGb: limited ? mbToGb(bw.remainingMb) : null,
    note: reason === 'no_active_proxies' ? 'noActiveProxies' : null
  };
}

ADAPTERS.node4 = {
  name: 'Node4', needs: ['token'], needsLabel: 'API key', dashboardUrl: 'https://node4.io/dashboard',
  authMessage: 'Node4 rejected the saved API key, or it lacks the read:proxies permission. Save a key with read:proxies on the Pull tab.',
  async fetch(c, get) {
    const key = String(c.token).trim();
    if (!/^n4k_[A-Za-z0-9_-]{8,200}$/.test(key)) throw new Error('Node4: the saved API key does not start with n4k_. Save it again on the Pull tab.');
    return parseNode4Account(await get(`${NODE4_API}/status`, { headers: bearer(key) }));
  }
};

// ---- ProxyEmpire: GET /user lists each package (residential, mobile, datacenter, static-resi,
// private-resi) with bandwidth in bytes; no end date (GB plans roll over) and no balance. ----
const PROXYEMPIRE_API = 'https://panel.proxyempire.io/api/v2';
const PROXYEMPIRE_SLOTS = Object.freeze([['residential', 'Rotating Residential'], ['mobile', 'Rotating Mobile'], ['datacenter', 'Rotating Datacenter'], ['static-resi', 'Static Residential'], ['private-resi', 'Private Residential']]);

function parseProxyEmpireAccount(body) {
  const j = parseJson(body);
  if (!j || typeof j !== 'object') throw new Error('ProxyEmpire: the API did not return JSON.');
  const data = j.data && typeof j.data === 'object' && !Array.isArray(j.data) ? j.data : null;
  if (!data) throw new Error(`ProxyEmpire: ${text(j.message, 160) || 'the account details came back in an unexpected shape'}`);
  const slots = PROXYEMPIRE_SLOTS.filter(([k]) => data[k] && typeof data[k] === 'object').map(([k, name]) => ({ name, bw: data[k].bandwidth && typeof data[k].bandwidth === 'object' ? data[k].bandwidth : {} }));
  // A GB in "bandwidth" is read as 2^30 bytes until ProxyEmpire says otherwise.
  return {
    status: slots.some((s) => num(s.bw.remaining) > 0) ? 'active' : 'unknown',
    plan: uniqueText(slots.map((s) => s.name)),
    trafficLeftGb: bytesToGb(sumOrNull(slots.map((s) => s.bw.remaining))),
    trafficUsedGb: bytesToGb(sumOrNull(slots.map((s) => s.bw.used))),
    trafficTotalGb: bytesToGb(sumOrNull(slots.map((s) => s.bw.total))),
    note: !slots.length ? 'noActivePlans' : (slots.length > 1 ? 'summedPlans' : null)
  };
}

ADAPTERS.proxyempire = {
  name: 'ProxyEmpire', needs: ['token'], needsLabel: 'API token', dashboardUrl: 'https://panel.proxyempire.io/',
  authMessage: 'ProxyEmpire rejected the saved API token, or it lacks the read ability. Save a token from Settings, API Tokens on the Pull tab.',
  async fetch(c, get) {
    return parseProxyEmpireAccount(await get(`${PROXYEMPIRE_API}/user`, { headers: bearer(c.token) }));
  }
};

// ---- MountProxies: GET /proxies (the key in the query string) lists each modem with expire_at,
// auto_renew_at and billing_cycle; plans are unlimited data, so there is no traffic figure. ----
const MOUNTPROXIES_API = 'https://api.mountproxies.com/api';

function parseMountProxiesAccount(body, { now = Date.now() } = {}) {
  const j = parseJson(body);
  if (!j || typeof j !== 'object') throw new Error('MountProxies: the API did not return JSON.');
  if (j.success !== true || !Array.isArray(j.data)) throw new Error('MountProxies: the API reported a failure. Try again later.');
  const list = j.data.filter((p) => p && typeof p === 'object');
  // expire_at is "N/A" on a plan that renews; auto_renew_at is then the next date.
  const dated = list.map((p) => p.expire_at).filter((v) => normDate(v));
  const ends = dated.length ? dated : list.map((p) => p.auto_renew_at);
  return {
    status: list.length ? 'active' : 'unknown',
    plan: uniqueText(list.map((p) => p.billing_cycle).filter((v) => String(v || '').trim() && String(v).trim().toUpperCase() !== 'N/A')),
    expiresAt: nextExpiry(ends, now),
    note: !list.length ? 'noActiveProxies' : (list.length > 1 ? 'firstToExpire' : null)
  };
}

ADAPTERS.mountproxies = {
  name: 'MountProxies', needs: ['token'], needsLabel: 'API key', dashboardUrl: 'https://app.mountproxies.com/',
  authMessage: 'MountProxies rejected the saved API key. Copy it again from your account page and save it on the Pull tab.',
  async fetch(c, get, opts) {
    const key = String(c.token).trim();
    if (!/^[A-Za-z0-9_-]{8,200}$/.test(key)) throw new Error('MountProxies: the saved API key does not look right. Save it again on the Pull tab.');
    return parseMountProxiesAccount(await get(`${MOUNTPROXIES_API}/proxies?api_key=${encodeURIComponent(key)}&output=json`, { headers: { Accept: 'application/json' } }), opts);
  }
};

// ---- Massive: the Reporting API (x-api-key: the API token, the proxy password) gives used_bytes
// for the past 7 days; divide by 10^9 for the dashboard's GB. No total, left, end date or balance. ----
const MASSIVE_REPORTING_API = 'https://api-network.joinmassive.com/reporting/v1';

function parseMassiveUsage(body) {
  const j = parseJson(body);
  if (j == null || typeof j !== 'object') throw new Error('Massive: the Reporting API did not return JSON.');
  // The reply's outer shape is not published: an array of rows, { data: [...] }, { usage: [...] } or one row.
  const items = Array.isArray(j) ? j : (Array.isArray(j.data) ? j.data : (Array.isArray(j.usage) ? j.usage : [j]));
  const used = sumOrNull(items.map((x) => (x && typeof x === 'object' ? x.used_bytes : null)));
  return { status: 'unknown', trafficUsedGb: used == null ? null : used / 1e9, note: used == null ? null : 'usedLast7Days' };
}

ADAPTERS.massive = {
  name: 'Massive', needs: ['password'], needsLabel: 'API token', dashboardUrl: 'https://partners.joinmassive.com/profile',
  authMessage: 'Massive rejected the saved API token. Save the token from your dashboard (Profile) as the proxy password on the Pull tab.',
  async fetch(c, get) {
    return parseMassiveUsage(await get(`${MASSIVE_REPORTING_API}/usage`, { headers: { 'x-api-key': String(c.password).trim(), Accept: 'application/json' } }));
  }
};

// Customer dashboards for providers whose API reports no account details (or needs a credential the
// app does not store), so the card can still send the user to the right page.
const DASHBOARD_URLS = Object.freeze({
  dataimpulse: 'https://app.dataimpulse.com/',
  airproxy: 'https://airproxy.io/en/accounts/profile/dashboard/',
  proxysolutions: 'https://proxy-solutions.net/lk',
  proxy302: 'https://proxy302.com/login/',
  shopsocks5: 'https://shopsocks5.com/',
  ipfoxy: 'https://app.ipfoxy.com/',
  liveproxies: 'https://liveproxies.io/dashboard/overview',
  novada: 'https://dashboard.novada.com/',
  databay: 'https://app.databay.com/'
});

function accountAdapterFor(provider) {
  const key = String(provider || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(ADAPTERS, key) ? ADAPTERS[key] : null;
}

function dashboardUrlFor(provider) {
  const key = String(provider || '').toLowerCase();
  const a = accountAdapterFor(key);
  return (a && a.dashboardUrl) || (Object.prototype.hasOwnProperty.call(DASHBOARD_URLS, key) ? DASHBOARD_URLS[key] : null);
}

function httpErrorMessage(adapter, error) {
  const name = adapter.name;
  const status = error && error.status;
  if (status === 401 || status === 403) return adapter.authMessage || `${name} rejected the saved key. Save it again on the Pull tab, then check again.`;
  if (status === 429) return `${name}: too many requests. Wait a minute and check again.`;
  if (status === 404) return `${name}: the account endpoint was not found for this key.`;
  if (/timed out/i.test(String(error && error.message))) return `${name} did not answer in time. Try again in a moment.`;
  return `${name} account check failed: ${String((error && error.message) || 'request failed').slice(0, 200)}`;
}

// Runs the provider's adapter. Unknown providers come back { supported: false } with the dashboard
// link; a vendor failure throws with every saved secret masked.
async function checkProviderAccount(provider, creds, get, { now = Date.now() } = {}) {
  const key = String(provider || '').toLowerCase();
  const adapter = accountAdapterFor(key);
  const dashboardUrl = dashboardUrlFor(key);
  if (!adapter) return { supported: false, dashboardUrl, account: null };
  const c = creds && typeof creds === 'object' ? creds : {};
  const secrets = secretsOf(c);
  const missing = adapter.needs.filter((f) => !String(c[f] == null ? '' : c[f]).trim());
  if (missing.length) {
    throw new Error(`${adapter.name}: no saved ${adapter.needsLabel}. Enter it on the Pull tab and save the credentials first.`);
  }
  let raw;
  try {
    const wrapped = async (url, opts = {}) => {
      try { return await get(url, opts); } catch (e) { const err = new Error(httpErrorMessage(adapter, e)); err.status = e && e.status; throw err; }
    };
    raw = await adapter.fetch(c, wrapped, { now });
  } catch (e) {
    throw new Error(scrubSecrets((e && e.message) || `${adapter.name} account check failed.`, secrets));
  }
  const account = scrubAccount(finalizeAccount(raw, { now, dashboardUrl }), secrets);
  return { supported: true, dashboardUrl, account };
}

module.exports = {
  ADAPTERS,
  DASHBOARD_URLS,
  emptyAccount,
  num,
  bytesToGb,
  mbToGb,
  gbValue,
  normDate,
  normStatus,
  nextExpiry,
  finalizeAccount,
  parseJson,
  secretsOf,
  scrubSecrets,
  NOTE_CODES,
  accountAdapterFor,
  dashboardUrlFor,
  checkProviderAccount,
  parsers: {
    proxy6: parseProxy6Account,
    proxmint: parseProxmintAccount,
    catproxies: parseCatProxiesAccount,
    mobileproxyspace: parseMobileProxySpaceAccount,
    proxybonanza: parseProxyBonanzaAccount,
    proxiessx: parseProxiesSxAccount,
    coronium: parseCoroniumAccount,
    singaporemobileproxy: parseSingaporeMobileProxyAccount,
    marsproxies: parseMarsProxiesAccount,
    proxidize: parseProxidizeUserInfo,
    proxyseller: parseProxySellerAccount,
    iproyal: parseIpRoyalAccount,
    brightdata: parseBrightDataBalance,
    gsocks: parseGsocksAccount,
    mangoproxy: parseMangoProxyAccount,
    node4: parseNode4Account,
    proxyempire: parseProxyEmpireAccount,
    mountproxies: parseMountProxiesAccount,
    massive: parseMassiveUsage
  }
};
