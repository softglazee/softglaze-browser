'use strict';
// Pure mapping between desktop profile fields and the profile sync payload (@softglaze/protocol
// sync/types.ts). No I/O here.

// ---- region: desktop editor values <-> SyncRegion ----
// Desktop: timezoneType/languageType 'Custom' (with a value) | 'Real' | anything else = from the
// proxy; locationType 'Custom' (lat/lng) | 'Block' | 'Real' | else proxy; webrtc 'Real' |
// 'Disabled' | else protected through the proxy (Replace, Altered, default).
function regionFromDesktop(p) {
  const r = {};
  const tz = String(p.timezoneType || '');
  if (tz === 'Custom' && p.timezoneCustom) { r.tzMode = 'manual'; r.tz = String(p.timezoneCustom); } else r.tzMode = tz === 'Real' ? 'auto' : 'proxy';
  const lang = String(p.languageType || '');
  if (lang === 'Custom' && p.languageCustom) { r.langMode = 'manual'; r.lang = String(p.languageCustom); } else r.langMode = lang === 'Real' ? 'auto' : 'proxy';
  const loc = String(p.locationType || '');
  const lat = Number.parseFloat(p.locationLat);
  const lon = Number.parseFloat(p.locationLng);
  if (loc === 'Custom' && Number.isFinite(lat) && Number.isFinite(lon)) {
    r.geoMode = 'manual';
    r.geo = { lat, lon };
    const acc = Number.parseFloat(p.locationAcc);
    if (Number.isFinite(acc) && acc > 0) r.geo.accuracyM = acc;
  } else r.geoMode = /^block$/i.test(loc) ? 'off' : loc === 'Real' ? 'auto' : 'proxy';
  const w = String(p.webrtc || '');
  r.webrtcMode = w === 'Real' ? 'real' : w === 'Disabled' ? 'disabled' : 'proxy';
  return r;
}

// Desktop columns for a SyncRegion. Only the modes the desktop has; 'proxy' resets to the default
// (null), which follows the proxy.
function regionToDesktop(region, current = {}) {
  const out = {};
  if (!region || typeof region !== 'object') return out;
  if (region.tzMode === 'manual' && region.tz) { out.timezoneType = 'Custom'; out.timezoneCustom = String(region.tz).slice(0, 80); }
  else if (region.tzMode === 'auto') out.timezoneType = 'Real';
  else if (region.tzMode === 'proxy' && ['Custom', 'Real'].includes(current.timezoneType)) out.timezoneType = null;
  if (region.langMode === 'manual' && region.lang) { out.languageType = 'Custom'; out.languageCustom = String(region.lang).slice(0, 80); }
  else if (region.langMode === 'auto') out.languageType = 'Real';
  else if (region.langMode === 'proxy' && ['Custom', 'Real'].includes(current.languageType)) out.languageType = null;
  if (region.geoMode === 'manual' && region.geo && Number.isFinite(region.geo.lat) && Number.isFinite(region.geo.lon)) {
    out.locationType = 'Custom';
    out.locationLat = String(region.geo.lat);
    out.locationLng = String(region.geo.lon);
    if (Number.isFinite(region.geo.accuracyM)) out.locationAcc = String(region.geo.accuracyM);
  } else if (region.geoMode === 'off') out.locationType = 'Block';
  else if (region.geoMode === 'auto') out.locationType = 'Real';
  else if (region.geoMode === 'proxy' && ['Custom', 'Block', 'Real'].includes(current.locationType)) out.locationType = null;
  if (region.webrtcMode === 'real') out.webrtc = 'Real';
  else if (region.webrtcMode === 'disabled') out.webrtc = 'Disabled';
  else if (region.webrtcMode === 'proxy' && ['Real', 'Disabled'].includes(current.webrtc)) out.webrtc = null;
  return out;
}

// ---- proxy ----
function proxyFromDesktop(proxy, withPassword) {
  if (!proxy || !proxy.host || !proxy.port) return null;
  const type = String(proxy.type || 'HTTP').toLowerCase();
  const out = { type: type === 'socks5' ? 'socks5' : type === 'https' ? 'https' : 'http', host: String(proxy.host), port: Number(proxy.port) };
  if (proxy.username) out.username = String(proxy.username);
  if (withPassword && proxy.password) out.password = String(proxy.password);
  if (proxy.countryCode && /^[A-Z]{2}$/i.test(proxy.countryCode)) out.countryCode = String(proxy.countryCode).toUpperCase();
  return out;
}

// Signature of a value (to notice that the desktop changed a field the PC does not apply natively).
function signature(value) {
  return JSON.stringify(value === undefined ? null : value);
}

// ---- cookies: CDP <-> SyncCookie ----
function cookieFromCdp(c) {
  const domain = String(c.domain || '');
  const exp = Number(c.expires);
  const same = String(c.sameSite || '').toLowerCase();
  return {
    name: String(c.name || ''),
    value: String(c.value == null ? '' : c.value),
    domain,
    path: String(c.path || '/'),
    expires: c.session === true || !Number.isFinite(exp) || exp <= 0 ? null : Math.floor(exp),
    secure: Boolean(c.secure),
    httpOnly: Boolean(c.httpOnly),
    sameSite: ['lax', 'strict', 'none'].includes(same) ? same : 'unspecified',
    hostOnly: !domain.startsWith('.')
  };
}

// CDP Network.setCookies param. A host-only cookie is set through its URL (CDP makes it host-only);
// a domain cookie keeps the leading dot.
function cookieToCdp(c) {
  if (!c || !c.name || !c.domain) return null;
  const host = String(c.domain).replace(/^\./, '');
  const path = c.path || '/';
  const p = { name: String(c.name), value: String(c.value == null ? '' : c.value), path };
  if (c.hostOnly) p.url = `${c.secure ? 'https' : 'http'}://${host}${path.startsWith('/') ? path : `/${path}`}`;
  else p.domain = `.${host}`;
  p.secure = Boolean(c.secure);
  p.httpOnly = Boolean(c.httpOnly);
  if (c.sameSite === 'lax') p.sameSite = 'Lax';
  else if (c.sameSite === 'strict') p.sameSite = 'Strict';
  else if (c.sameSite === 'none') p.sameSite = 'None';
  if (c.expires != null && Number.isFinite(Number(c.expires)) && Number(c.expires) > 0) p.expires = Number(c.expires);
  return p;
}

module.exports = { regionFromDesktop, regionToDesktop, proxyFromDesktop, signature, cookieFromCdp, cookieToCdp };
