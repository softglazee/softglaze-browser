'use strict';
// Free public proxies live in the same Proxy table as paid ones; provider 'free' is the only marker.
// Every paid view and count goes through these filters, so free proxies show only on their own page
// and reach a profile only when the user picks them on purpose.

const FREE_PROVIDER = 'free';
const FREE_GROUP_NAME = 'Free proxies';
const SCOPES = Object.freeze(['paid', 'free', 'all']);

// Anything unknown is the paid side, so a caller that forgets the option never sees free proxies.
function normalizeProxyScope(scope) {
  const s = String(scope || '').toLowerCase();
  return SCOPES.includes(s) ? s : 'paid';
}

// Prisma's `not` skips NULL rows, so untagged (hand-added) proxies need their own branch.
function proxyScopeWhere(scope) {
  const s = normalizeProxyScope(scope);
  if (s === 'free') return { provider: FREE_PROVIDER };
  if (s === 'all') return undefined;
  return { OR: [{ provider: null }, { provider: { not: FREE_PROVIDER } }] };
}

// AND of the non-empty parts; undefined when nothing is left.
function andWhere(...parts) {
  const list = parts.filter((p) => p && typeof p === 'object' && Object.keys(p).length);
  if (list.length === 0) return undefined;
  return list.length === 1 ? list[0] : { AND: list };
}

function withProxyScope(where, scope) {
  return andWhere(where, proxyScopeWhere(scope));
}

function isFreeProxy(proxy) {
  return Boolean(proxy) && String(proxy.provider || '').toLowerCase() === FREE_PROVIDER;
}

// The group the free search files its proxies into.
function isFreeProxyGroup(group) {
  return Boolean(group) && group.name === FREE_GROUP_NAME && group.autoCreated === true;
}

// Paid view of the proxy groups: counts only paid proxies and hides a group that holds nothing
// but free proxies. `freeByGroup` maps group id -> number of free proxies in it.
function paidGroupView(groups, freeByGroup = {}) {
  const out = [];
  for (const g of Array.isArray(groups) ? groups : []) {
    const total = Number(g.proxyCount) || 0;
    const free = Number(freeByGroup[g.id]) || 0;
    if (isFreeProxyGroup(g) || (free > 0 && free >= total)) continue;
    out.push({ ...g, proxyCount: Math.max(0, total - free) });
  }
  return out;
}

// Quick generate's candidate filter. The free source is used only when chosen (or through the
// older provider "free" pick) and then only proxies whose last check passed; anything else is the
// paid pool, narrowed to a group or provider when one is given.
function batchProxySourceWhere({ source, proxyGroupId, provider } = {}) {
  const prov = provider ? String(provider).toLowerCase() : '';
  if (String(source || '').toLowerCase() === 'free' || prov === FREE_PROVIDER) {
    return { provider: FREE_PROVIDER, lastStatus: 'ok' };
  }
  return andWhere(
    proxyScopeWhere('paid'),
    proxyGroupId !== undefined ? { proxyGroupId } : null,
    prov ? { provider: prov } : null
  );
}

// Batch import's auto-bind pool: the paid pool unless free proxies are chosen, then working ones only.
function autoBindPoolWhere(source) {
  return String(source || '').toLowerCase() === 'free'
    ? { provider: FREE_PROVIDER, lastStatus: 'ok' }
    : proxyScopeWhere('paid');
}

module.exports = {
  FREE_PROVIDER,
  FREE_GROUP_NAME,
  normalizeProxyScope,
  proxyScopeWhere,
  andWhere,
  withProxyScope,
  isFreeProxy,
  isFreeProxyGroup,
  paidGroupView,
  batchProxySourceWhere,
  autoBindPoolWhere
};
