// Free public proxies in the renderer: provider 'free' marks them (src/main/proxyScope.js is the main
// side). One set of helpers so the Free proxies page, the profile editor and Quick generate agree.
// Plain module so tests can import it.
import { proxyHealthOf } from './proxyBuckets.mjs';

export const FREE_PROVIDER = 'free';

export function isFreeProxy(p) {
  return Boolean(p) && String(p.provider || '').toLowerCase() === FREE_PROVIDER;
}

// working | dead | unchecked, from the same health rule as the pool (a fresh check wins).
export function freeStatusOf(p, live = {}) {
  const h = proxyHealthOf(p, live || {});
  if (h === 'verified') return 'working';
  if (h === 'failed') return 'dead';
  return 'unchecked';
}

// Only the free proxies whose last check passed: what Quick generate may use.
export function healthyFreeProxies(list) {
  return (Array.isArray(list) ? list : []).filter((p) => isFreeProxy(p) && p.lastStatus === 'ok');
}

export function protocolOf(p) {
  return String((p && p.type) || '').toUpperCase().startsWith('SOCKS') ? 'SOCKS5' : 'HTTP';
}

// The page's filters: protocol ('all' | 'HTTP' | 'SOCKS5'), country ('all' | 'unknown' | code) and
// status ('all' | 'working' | 'dead' | 'unchecked').
export function filterFreeProxies(list, { protocol = 'all', country = 'all', status = 'all' } = {}, live = {}) {
  return (Array.isArray(list) ? list : []).filter((p) => {
    if (protocol !== 'all' && protocolOf(p) !== protocol) return false;
    if (country === 'unknown' && p.lastCountry) return false;
    if (country !== 'all' && country !== 'unknown' && String(p.lastCountry || '').toUpperCase() !== country) return false;
    if (status !== 'all' && freeStatusOf(p, live) !== status) return false;
    return true;
  });
}

// [code, count] for the country filter, most proxies first; proxies without a country are left out.
export function freeCountryCounts(list) {
  const m = new Map();
  for (const p of Array.isArray(list) ? list : []) {
    const cc = String(p.lastCountry || '').toUpperCase();
    if (cc) m.set(cc, (m.get(cc) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function deadFreeIds(list, live = {}) {
  return (Array.isArray(list) ? list : []).filter((p) => freeStatusOf(p, live) === 'dead').map((p) => p.id);
}

// Quick generate's proxy choice ('' | 'group:<id>' | 'provider:<key>' | 'free') -> batch-generate fields.
export function quickGenProxyFields(proxySource) {
  const src = String(proxySource || '');
  if (src === 'free') return { proxySource: 'free', proxyGroupId: undefined, provider: undefined };
  return {
    proxySource: 'paid',
    proxyGroupId: src.startsWith('group:') ? src.slice(6) : undefined,
    provider: src.startsWith('provider:') ? src.slice(9) : undefined
  };
}
