'use strict';
// Contradictions a site can see the moment a profile opens, checked before launch so they can be
// fixed first. Only clear mismatches count; the full picture is the CAPTCHA score.

const { scoreProfile } = require('./captchaScore');
const { deviceGpuCoherence } = require('./fingerprintGenerator');

function uaOsFamily(ua) {
  const s = String(ua || '');
  if (/Android/i.test(s)) return 'android';
  if (/iPhone|iPad|iPod/i.test(s)) return 'ios';
  if (/Windows NT/i.test(s)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(s)) return 'mac';
  if (/Linux|X11|CrOS/i.test(s)) return 'linux';
  return null;
}

function profileOsFamily(os) {
  const s = String(os || '').toLowerCase();
  if (/android/.test(s)) return 'android';
  if (/ios|iphone|ipad/.test(s)) return 'ios';
  if (/win/.test(s)) return 'windows';
  if (/mac|os ?x/.test(s)) return 'mac';
  if (/linux|ubuntu|debian|fedora|chrome ?os/.test(s)) return 'linux';
  return null;
}

// A phone screen is narrow and portrait; a desktop one is at least 1024x600.
function screenMismatch(profile) {
  if (!profile.resolutionType || profile.resolutionType === 'Real') return null;
  const w = Number.parseInt(profile.resolutionW, 10);
  const h = Number.parseInt(profile.resolutionH, 10);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  const mobile = profile.deviceClass === 'mobile' || profileOsFamily(profile.os) === 'android';
  if (mobile && (w > 1100 || w > h)) return { width: w, height: h, device: 'mobile' };
  if (!mobile && (w < 1024 || h < 600)) return { width: w, height: h, device: 'desktop' };
  return null;
}

// Returns [{ key, severity: 'fail' | 'warn', params, fix }]; 'fail' issues are worth stopping for.
function preLaunchIssues(profile, ctx = {}) {
  const p = profile || {};
  const issues = [];

  const ua = String(p.userAgent || '').trim();
  if (ua && ua !== 'Auto') {
    const claimed = uaOsFamily(ua);
    const os = profileOsFamily(p.os);
    if (claimed && os && claimed !== os) issues.push({ key: 'uaOs', severity: 'fail', params: { ua: claimed, os: p.os }, fix: null });
  }

  const gpu = deviceGpuCoherence({ deviceClass: p.deviceClass, os: p.os, webglRenderer: p.webglRenderer });
  if (gpu.status === 'fail') issues.push({ key: 'gpuOs', severity: 'fail', params: { os: p.os || '' }, fix: null });

  const screen = screenMismatch(p);
  if (screen) issues.push({ key: 'screen', severity: 'fail', params: screen, fix: null });

  const score = scoreProfile(p, ctx);
  const factor = (key) => score.factors.find((f) => f.key === key);
  const lang = factor('language');
  if (lang && lang.status === 'warn' && !lang.params.unverified) issues.push({ key: 'language', severity: 'fail', params: lang.params, fix: 'lang-auto' });
  const tz = factor('timezone');
  if (tz && tz.status === 'fail') issues.push({ key: 'timezone', severity: 'fail', params: {}, fix: 'tz-auto' });
  const webrtc = factor('webrtc');
  if (webrtc && webrtc.status === 'fail') issues.push({ key: 'webrtc', severity: 'fail', params: {}, fix: 'webrtc-safe' });
  const health = factor('proxyHealth');
  if (health && health.status === 'fail') issues.push({ key: 'proxyDead', severity: 'fail', params: {}, fix: 'swap-proxy' });

  return issues;
}

module.exports = { preLaunchIssues, uaOsFamily, profileOsFamily, screenMismatch };
