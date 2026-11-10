// Names for a proxy's provider tag (Proxy.provider) where the window groups or filters by it: the Proxy
// pool's provider chips and filter, and Quick generate's proxy source. Pure, so test/ runs it.

// A connector names each pulled proxy "<Vendor> • <details>", so the part before the first " • " is the
// vendor's name as it was when the proxy was pulled. '' for a name without that separator.
export function pulledVendorName(proxyName) {
  const s = String(proxyName == null ? '' : proxyName);
  const at = s.indexOf(' • ');
  return at > 0 ? s.slice(0, at).trim() : '';
}

// tag -> the vendor name the first of its proxies was pulled with.
export function pulledProviderNames(proxies) {
  const out = {};
  for (const p of Array.isArray(proxies) ? proxies : []) {
    const tag = p && p.provider ? String(p.provider) : '';
    if (!tag || out[tag]) continue;
    const name = pulledVendorName(p.name);
    if (name) out[tag] = name;
  }
  return out;
}

// The label of a tag: its connector's name (names: tag -> name), else, for a provider that was removed
// from the app, the vendor name its proxies were pulled with (pulled), else the tag itself. Never blank.
export function providerTagLabel(tag, names = {}, pulled = {}) {
  const key = String(tag == null ? '' : tag);
  const own = (m) => (m && Object.prototype.hasOwnProperty.call(m, key) && m[key] ? String(m[key]) : '');
  return own(names) || own(pulled) || key;
}
