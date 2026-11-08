'use strict';
// "A new version is available" for the website installer (1.0.23).
//
// The website installers are not code-signed and have no update feed baked in, so updater.js keeps
// automatic updates off for them ('unsigned' / 'no-feed'), and their users never heard about a new
// version. For exactly that case this reads the website's release file and, when it names a version
// newer than this app, the Dashboard shows a notice with a link to the download page. Nothing is ever
// downloaded or installed from here: automatic installs stay limited to signed builds (updater.js).
//
// Never in the Microsoft Store package (the Store updates it) or a base build (no tenant): see
// noticeApplies. The request carries nothing about the user or this install: a plain GET with a
// fixed User-Agent, no cookies and no query string. The answer is data only: size-capped, checked
// field by field, and ignored unless it is exactly what is expected. The site's CDN sometimes
// answers with an HTML "Checking your browser" page; that is ignored and tried again next time.

const RELEASE_URL = 'https://browser.softglaze.com/release.json';
const SITE_HOST = 'browser.softglaze.com';
const DOWNLOAD_PREFIX = `https://${SITE_HOST}/`;
const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10000;
const MAX_BYTES = 16 * 1024;
const MAX_URL = 500;
const MAX_NOTES = 500;
const USER_AGENT = 'SoftGlaze-Browser-ReleaseCheck/1.0';

// "1.0.24" -> [1, 0, 24]; anything but three plain numbers -> null.
function parseVersion(value) {
  const m = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(String(value == null ? '' : value).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// Numeric, part by part (1.0.10 is newer than 1.0.9): 1, 0, -1, or null when either is not x.y.z.
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  }
  return 0;
}

const isNewer = (candidate, current) => compareVersions(candidate, current) === 1;

// The download link, only when it is a page of the website itself over https; anything else: null.
function safeDownloadUrl(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_URL || !raw.startsWith(DOWNLOAD_PREFIX)) return null;
  let u;
  try { u = new URL(raw); } catch (e) { return null; }
  if (u.protocol !== 'https:' || u.hostname !== SITE_HOST || u.port || u.username || u.password) return null;
  return u.href.startsWith(DOWNLOAD_PREFIX) ? u.href : null;
}

function cleanNotes(raw) {
  if (typeof raw !== 'string') return null;
  // Plain text only: control characters out (line breaks kept), and a short cap.
  const s = raw.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim().slice(0, MAX_NOTES).trim();
  return s || null;
}

// release.json text -> { version, url, releasedOn, sha256, notes }, or null for anything unexpected.
// Expected: { "version": "1.0.24", "releasedOn": "2026-11-20", "url": "https://browser.softglaze.com/download",
//             "sha256": "<64 hex>", "notes": "short plain text" }; version and url are required.
function parseRelease(text) {
  if (typeof text !== 'string' || text.length > MAX_BYTES) return null;
  const body = text.replace(/^﻿/, '').trim();
  if (!body.startsWith('{')) return null; // an HTML challenge page, an error page, empty
  let d;
  try { d = JSON.parse(body); } catch (e) { return null; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const parts = typeof d.version === 'string' ? parseVersion(d.version) : null;
  const url = safeDownloadUrl(d.url);
  if (!parts || !url) return null;
  return {
    version: parts.join('.'),
    url,
    releasedOn: typeof d.releasedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.releasedOn) ? d.releasedOn : null,
    sha256: typeof d.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(d.sha256) ? d.sha256.toLowerCase() : null,
    notes: cleanNotes(d.notes)
  };
}

// The website installer whose automatic updates are off for lack of a signature or a feed. The Store
// package and base builds never get the notice; a signed build with a feed updates itself instead.
function noticeApplies({ channel, disabledReason } = {}) {
  return channel === 'website' && (disabledReason === 'unsigned' || disabledReason === 'no-feed');
}

// One GET of the release file over https: no redirects followed, a hard deadline, a size cap.
function fetchReleaseText(url = RELEASE_URL, { timeoutMs = FETCH_TIMEOUT_MS, maxBytes = MAX_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { reject(new Error('bad url')); return; }
    if (u.protocol !== 'https:') { reject(new Error('the release file is read over https only')); return; }
    let done = false;
    let timer = null;
    let req = null;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(value);
    };
    const fail = (e) => { finish(reject, e); if (req) req.destroy(); };
    timer = setTimeout(() => fail(new Error('timeout')), timeoutMs);
    req = require('node:https').get(u, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); fail(new Error(`HTTP ${res.statusCode}`)); return; }
      let size = 0;
      const chunks = [];
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) { fail(new Error('the release file is too large')); return; }
        chunks.push(c);
      });
      res.on('end', () => finish(resolve, Buffer.concat(chunks).toString('utf8')));
      res.on('error', fail);
    });
    req.on('error', fail);
  });
}

// What the banner shows, and "Later": a dismissed version stays hidden until the app restarts (this
// lives in memory only); a newer version is offered again.
function createNoticeState() {
  const dismissed = new Set();
  let current = null;
  return {
    // A release newer than the app -> the state patch for the banner, or null when it was dismissed.
    offer(release) {
      if (!release || dismissed.has(release.version)) return null;
      current = release;
      return { status: 'notice', version: release.version, releaseNotes: release.notes, releasedOn: release.releasedOn, error: null };
    },
    // "Later" for the version on show (a stale click for another version changes nothing).
    dismiss(version) {
      if (!current || (version && version !== current.version)) return false;
      dismissed.add(current.version);
      current = null;
      return true;
    },
    // The checked download link of the version on show, checked again right before it is opened.
    downloadUrl() { return current ? safeDownloadUrl(current.url) : null; },
    current() { return current; }
  };
}

// Checks now and then every intervalMs, in the background; a failed or odd answer is ignored until the
// next check. deps: { fetchText, currentVersion, onNotice }. onNotice(release) gets each newer release.
function startReleaseChecks(deps, { intervalMs = CHECK_EVERY_MS } = {}) {
  let stopped = false;
  const checkNow = async () => {
    if (stopped) return null;
    let release = null;
    try { release = parseRelease(await deps.fetchText()); } catch (e) { release = null; }
    if (stopped || !release || !isNewer(release.version, deps.currentVersion())) return null;
    try { deps.onNotice(release); } catch (e) { /* the banner is optional */ }
    return release;
  };
  const first = checkNow();
  const timer = setInterval(() => { checkNow(); }, intervalMs);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return { first, checkNow, stop() { stopped = true; clearInterval(timer); } };
}

module.exports = {
  RELEASE_URL,
  CHECK_EVERY_MS,
  MAX_BYTES,
  parseVersion,
  compareVersions,
  isNewer,
  safeDownloadUrl,
  parseRelease,
  noticeApplies,
  fetchReleaseText,
  createNoticeState,
  startReleaseChecks
};
