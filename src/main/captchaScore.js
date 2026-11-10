'use strict';
// CAPTCHA risk score for a profile: every factor that makes Google, Cloudflare or hCaptcha more
// likely to challenge it, from stored data only (no network), so a whole page of profiles scores
// at once. Factors carry keys and params, not text; the renderer translates them.

const { deviceGpuCoherence } = require('./fingerprintGenerator');

const AUTO = 'Based on IP';
const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_CHECK_MS = 7 * DAY_MS;

// Hosting and cloud networks. Google and Cloudflare challenge these far more often than home or
// mobile ISPs. Matched against the ISP/organisation name the proxy check stores.
const HOSTING_PATTERNS = [
  /amazon|\baws\b/, /google cloud|google llc/, /microsoft|azure/, /digitalocean/, /\bovh/, /hetzner/,
  /linode|akamai/, /vultr|choopa/, /contabo/, /leaseweb/, /\bm247\b/, /datacamp|cdn77/, /hostinger/,
  /\bionos\b/, /scaleway/, /oracle/, /alibaba|aliyun/, /tencent/, /huawei cloud/, /g-?core/, /psychz/,
  /quadranet/, /colocrossing/, /hostwinds/, /servers\.com/, /zenlayer/, /clouvider/, /packethub/,
  /hivelocity/, /interserver/, /liquid web/, /rackspace/, /equinix/, /cloudflare/, /fastly/,
  /frantech|buyvm|ponynet/, /stark industries/, /aeza/, /pq hosting/, /kamatera/, /upcloud/,
  /netcup/, /hosthatch/, /racknerd/, /\bdmit\b/, /it7 networks/, /data ?cent(er|re)/, /hosting/,
  /\bvps\b/, /dedicated server/
];

// Classifies a proxy's exit network: 'datacenter', 'residential' or null when unknown. The vendor's
// own label (name or provider) wins over the ISP name, since ISP proxies sit on home ISPs.
function ipTypeOf(proxy) {
  if (!proxy) return null;
  const label = `${proxy.name || ''} ${proxy.provider || ''}`.toLowerCase();
  if (/\b(datacenter|data center|dc)\b/.test(label)) return 'datacenter';
  if (/\b(residential|mobile|isp|4g|5g|lte)\b/.test(label)) return 'residential';
  const isp = String(proxy.lastIsp || '').toLowerCase().replace(/^as\d+\s+/, '');
  if (!isp) return null;
  return HOSTING_PATTERNS.some((re) => re.test(isp)) ? 'datacenter' : 'residential';
}

// A rotating gateway hands out a new exit per connection, so sharing it is not sharing an IP.
function isRotating(proxy) {
  return Boolean(proxy && (proxy.rotationUrl || /\brotat/i.test(`${proxy.name || ''}`)));
}

function hostOsFamily(hostOs) {
  const s = String(hostOs || '').toLowerCase();
  if (s.startsWith('win')) return 'windows';
  if (s.startsWith('mac') || s === 'darwin') return 'mac';
  if (s.startsWith('linux')) return 'linux';
  return null;
}

function profileOsFamily(os) {
  const s = String(os || '').toLowerCase();
  if (/win/.test(s)) return 'windows';
  if (/mac|os ?x/.test(s)) return 'mac';
  if (/linux|ubuntu|debian|fedora/.test(s)) return 'linux';
  return null;
}

// Cookie stores below these sizes hold almost nothing. An empty Chrome store is about 20 KB and
// Firefox pre-allocates about 96 KB.
const LITTLE_HISTORY_BYTES = { Chromium: 64 * 1024, Firefox: 192 * 1024 };
// Warm-ups (Cookie Warmer or autopilot) after which a profile counts as having real history.
const WARMED_RUNS = 3;

function gradeFor(score) {
  if (score >= 85) return { grade: 'A', level: 'low' };
  if (score >= 70) return { grade: 'B', level: 'some' };
  if (score >= 50) return { grade: 'C', level: 'high' };
  return { grade: 'D', level: 'veryHigh' };
}

// ctx: { proxy, sharedWith, settings: { blockThirdPartyCookies }, hostOs, cookieBytes, warmRuns, now }
function scoreProfile(profile, ctx = {}) {
  const p = profile || {};
  const proxy = ctx.proxy || null;
  const now = ctx.now || Date.now();
  const usesProxy = p.systemProxyBehavior !== 'DIRECT' && p.systemProxyBehavior !== 'SYSTEM_PROXY' && Boolean(proxy);
  const isFirefox = p.browserCore === 'Firefox';
  const factors = [];
  const add = (key, status, impact, params, fix) => factors.push({ key, status, impact: status === 'pass' ? 0 : impact, params: params || {}, fix: status === 'pass' ? null : (fix || null) });

  // ---- Proxy ----
  if (!usesProxy) {
    add('proxy', 'warn', 10, {}, 'assign-proxy');
  } else {
    add('proxy', 'pass', 0, { name: proxy.name || `${proxy.host}:${proxy.port}` });
    if (proxy.lastStatus === 'fail') add('proxyHealth', 'fail', 40, { error: proxy.lastError || '' }, 'swap-proxy');
    else if (!proxy.lastCheckedAt) add('proxyHealth', 'warn', 6, { never: true }, 'check-proxy');
    else if (now - new Date(proxy.lastCheckedAt).getTime() > STALE_CHECK_MS) add('proxyHealth', 'warn', 4, { days: Math.floor((now - new Date(proxy.lastCheckedAt).getTime()) / DAY_MS) }, 'check-proxy');
    else add('proxyHealth', 'pass', 0, { ms: proxy.lastLatencyMs ?? null });

    if (proxy.lastBlacklisted === true) add('blocklist', 'fail', 30, {}, 'swap-proxy');
    else if (proxy.lastBlacklisted == null) add('blocklist', 'warn', 4, {}, 'check-proxy');
    else add('blocklist', 'pass', 0);

    if (proxy.provider === 'free') add('freeProxy', 'fail', 30, {}, 'swap-proxy');

    const type = ipTypeOf(proxy);
    if (type === 'datacenter') add('ipType', 'warn', 20, { isp: String(proxy.lastIsp || '').replace(/^AS\d+\s+/i, '') }, 'swap-proxy');
    else if (type === 'residential') add('ipType', 'pass', 0, { isp: String(proxy.lastIsp || '').replace(/^AS\d+\s+/i, '') });

    const shared = Number(ctx.sharedWith) || 0;
    if (shared > 0 && !isRotating(proxy)) add('sharedProxy', shared >= 3 ? 'fail' : 'warn', shared >= 3 ? 15 : 8, { count: shared }, 'swap-proxy');
  }

  // ---- Location signals must agree with the IP ----
  const tz = p.timezoneType || AUTO;
  if (tz === AUTO) add('timezone', 'pass', 0);
  else if (tz === 'Real') add('timezone', usesProxy ? 'fail' : 'pass', 20, {}, 'tz-auto');
  else add('timezone', 'warn', usesProxy ? 8 : 5, { zone: p.timezoneCustom || '' }, 'tz-auto');

  const lang = p.languageType || AUTO;
  if (lang === AUTO) {
    add('language', 'pass', 0);
  } else {
    const m = String(p.languageCustom || '').match(/[a-z]{2,3}-([A-Z]{2})/);
    const region = m ? m[1] : null;
    const country = proxy && proxy.lastCountry ? String(proxy.lastCountry).toUpperCase() : null;
    if (usesProxy && region && country && region !== country) add('language', 'warn', 8, { region, country }, 'lang-auto');
    else if (usesProxy && !country) add('language', 'warn', 4, { unverified: true, lang: p.languageCustom || '' }, 'lang-auto');
    else add('language', 'pass', 0);
  }

  const loc = p.locationType || AUTO;
  if (loc === 'Custom' && usesProxy) add('geolocation', 'warn', 5, {}, 'geo-auto');
  else add('geolocation', 'pass', 0);

  // ---- Leaks ----
  const webrtc = p.webrtc || 'Forward';
  // Firefox profiles always run with WebRTC off (media.peerconnection.enabled false in user.js), so their
  // WebRTC setting changes nothing and is not graded. What sites see is the state "Disabled" gives a
  // Chromium profile (no RTCPeerConnection), so it carries the same small warning, without a fix: no
  // setting turns it on.
  if (isFirefox) add('webrtc', 'warn', 5, { firefox: true });
  else if (usesProxy && webrtc === 'Real') add('webrtc', 'fail', 25, {}, 'webrtc-safe');
  else if (webrtc === 'Disabled') add('webrtc', 'warn', 5, {}, 'webrtc-safe');
  // Real with no proxy: the IP WebRTC shows is the one every site already sees, so there is no mismatch
  // to flag. It is not "hidden" either, so it has its own message (the Leak check says the same).
  else if (webrtc === 'Real') add('webrtc', 'pass', 0, { mode: webrtc, noProxy: true });
  else add('webrtc', 'pass', 0, { mode: webrtc });

  // ---- Browser state ----
  if (!isFirefox) {
    if (ctx.settings && ctx.settings.blockThirdPartyCookies === true) add('thirdPartyCookies', 'warn', 15, {}, 'allow-3p-cookies');
    else add('thirdPartyCookies', 'pass', 0);
  }

  const launches = Number(p.launchCount) || 0;
  const limit = LITTLE_HISTORY_BYTES[isFirefox ? 'Firefox' : 'Chromium'];
  const bytes = typeof ctx.cookieBytes === 'number' ? ctx.cookieBytes : null;
  const ageDays = p.createdAt ? Math.floor((now - new Date(p.createdAt).getTime()) / DAY_MS) : null;
  const warmRuns = Number(ctx.warmRuns) || 0;
  const littleHistory = warmRuns < WARMED_RUNS && (bytes != null ? bytes < limit : launches < 3);
  if (littleHistory) add('history', 'warn', 10, { launches, ageDays }, 'warm-up');
  else add('history', 'pass', 0, warmRuns >= WARMED_RUNS ? { launches, warmRuns } : { launches });

  // ---- Fingerprint consistency (advice only: changing it changes the device sites know) ----
  const coh = deviceGpuCoherence({ deviceClass: p.deviceClass, os: p.os, webglRenderer: p.webglRenderer });
  if (coh.status === 'fail') add('device', 'fail', 20, { detail: coh.detail });
  else if (coh.status === 'warn' && p.webglRenderer) add('device', 'warn', 6, { detail: coh.detail });

  const host = hostOsFamily(ctx.hostOs);
  const claimed = profileOsFamily(p.os);
  if (p.deviceClass !== 'mobile' && host && claimed && host !== claimed) add('osMismatch', 'warn', 6, { claimed: p.os, host: ctx.hostOs });

  const lost = factors.reduce((sum, f) => sum + f.impact, 0);
  const score = Math.max(0, Math.min(100, 100 - lost));
  const order = { fail: 0, warn: 1, pass: 2 };
  factors.sort((a, b) => order[a.status] - order[b.status] || b.impact - a.impact);
  return {
    score,
    ...gradeFor(score),
    usesProxy,
    factors,
    fixes: [...new Set(factors.map((f) => f.fix).filter(Boolean))]
  };
}

// Fixes that only touch this profile's own settings, safe to apply together.
const PROFILE_FIELD_FIXES = Object.freeze({
  'tz-auto': { timezoneType: AUTO },
  'lang-auto': { languageType: AUTO },
  'geo-auto': { locationType: AUTO },
  'webrtc-safe': { webrtc: 'Forward' }
});

// Orders replacement proxies: working, clean, not free, not the current one; same country as the
// current one first, residential before datacenter, then fastest.
function pickReplacementProxy(candidates, current) {
  return rankReplacements(candidates, current)[0] || null;
}

// Settings a profile gets with its first proxy: a timezone taken from this computer would
// contradict the proxy, so it follows the proxy instead.
function withFirstProxy(profile) {
  const next = { ...profile, systemProxyBehavior: 'PROFILE_PROXY' };
  if ((profile.timezoneType || AUTO) === 'Real') next.timezoneType = AUTO;
  return next;
}

// The spare proxy that lowers this profile's CAPTCHA risk the most, scored with the same rules as
// the list, or null when none would help (a swap must never make a profile worse).
function bestReplacement(profile, ctx, candidates) {
  const current = scoreProfile(profile, ctx).score;
  const hadProxy = Boolean(ctx.proxy) && profile.systemProxyBehavior !== 'DIRECT' && profile.systemProxyBehavior !== 'SYSTEM_PROXY';
  const shape = hadProxy ? { ...profile } : withFirstProxy(profile);
  let best = null;
  for (const proxy of rankReplacements(candidates, ctx.proxy)) {
    const score = scoreProfile(shape, { ...ctx, proxy, sharedWith: 0 }).score;
    if (score > current && (!best || score > best.score)) best = { proxy, score, profileFields: hadProxy ? {} : { timezoneType: shape.timezoneType } };
  }
  return best;
}

function rankReplacements(candidates, current) {
  const want = current && current.lastCountry ? String(current.lastCountry).toUpperCase() : null;
  const usable = (candidates || []).filter((c) => c && c.lastStatus === 'ok' && c.lastBlacklisted !== true
    && c.provider !== 'free' && (!current || c.id !== current.id));
  const rank = (c) => [
    want && String(c.lastCountry || '').toUpperCase() === want ? 0 : 1,
    ipTypeOf(c) === 'datacenter' ? 1 : 0,
    c.lastBlacklisted === false ? 0 : 1,
    typeof c.lastLatencyMs === 'number' ? c.lastLatencyMs : 1e9
  ];
  usable.sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return a.id - b.id;
  });
  return usable;
}

module.exports = { scoreProfile, ipTypeOf, isRotating, pickReplacementProxy, bestReplacement, PROFILE_FIELD_FIXES, HOSTING_PATTERNS, WARMED_RUNS };
