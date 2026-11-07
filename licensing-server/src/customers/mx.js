'use strict';
// Can this domain receive mail? MX records (a single "." MX is RFC 7505's "accepts no mail"), and
// with no MX at all the A/AAAA fallback of RFC 5321. A domain that does not exist fails. Slow or
// broken DNS fails OPEN (ok, unknown: true): a DNS hiccup must not stop real people signing up.
// Results are cached: 6 h when the domain takes mail, 30 min when it does not.
const dns = require('node:dns');

const POSITIVE_TTL = 6 * 3600 * 1000;
const NEGATIVE_TTL = 30 * 60 * 1000;
const MAX_ENTRIES = 5000;
const cache = new Map();
let resolverFactory = (timeoutMs) => new dns.promises.Resolver({ timeout: timeoutMs, tries: 2 });

function withTimeout(promise, ms) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => { const e = new Error('dns timeout'); e.code = 'ETIMEOUT'; reject(e); }, ms); })
  ]).finally(() => clearTimeout(t));
}

const NOT_FOUND = new Set(['ENOTFOUND', 'NXDOMAIN']);
const NO_DATA = new Set(['ENODATA', 'ENOTFOUND_NODATA']);

async function lookup(domain, timeoutMs) {
  const r = resolverFactory(timeoutMs);
  try {
    const mx = await withTimeout(r.resolveMx(domain), timeoutMs + 500);
    if (Array.isArray(mx) && mx.length) {
      const nullMx = mx.length === 1 && (!mx[0].exchange || mx[0].exchange === '.');
      return nullMx ? { ok: false, reason: 'null_mx' } : { ok: true };
    }
  } catch (e) {
    if (NOT_FOUND.has(e && e.code)) return { ok: false, reason: 'nxdomain' };
    if (!NO_DATA.has(e && e.code)) return { ok: true, unknown: true };
  }
  // No MX records: an A or AAAA record still receives mail (implicit MX).
  for (const fn of ['resolve4', 'resolve6']) {
    try {
      const a = await withTimeout(r[fn](domain), timeoutMs + 500);
      if (Array.isArray(a) && a.length) return { ok: true };
    } catch (e) {
      if (NOT_FOUND.has(e && e.code)) return { ok: false, reason: 'nxdomain' };
      if (!NO_DATA.has(e && e.code)) return { ok: true, unknown: true };
    }
  }
  return { ok: false, reason: 'no_mx' };
}

// -> { ok, reason?, unknown?, cached? }
async function checkMailDomain(domain, { timeoutMs = 3000, now = Date.now() } = {}) {
  const d = String(domain || '').toLowerCase();
  const hit = cache.get(d);
  if (hit && hit.expires > now) return { ...hit.result, cached: true };
  const result = await lookup(d, timeoutMs);
  if (!result.unknown) {
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(d, { result, expires: now + (result.ok ? POSITIVE_TTL : NEGATIVE_TTL) });
  }
  return result;
}

// Tests swap the resolver: factory(timeoutMs) -> { resolveMx, resolve4, resolve6 }.
function setResolverFactoryForTests(factory) { resolverFactory = factory; cache.clear(); }
function clearMxCache() { cache.clear(); }

module.exports = { checkMailDomain, setResolverFactoryForTests, clearMxCache };
