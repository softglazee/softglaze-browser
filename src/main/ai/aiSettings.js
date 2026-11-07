'use strict';
// SoftGlaze AI settings (Setting 'aiSettings'). Pure validation; storage is passed in.
//   enabled             AI server on/off (off by default)
//   approvalMode        per scope: 'never' (read only) | 'ask-hour' | 'ask-always'
//   pageDomainAllowList sites page tools may act on; empty = any site (still asks per profile)
//   expertMode          shows the Expert tool (get_cdp_endpoint) to full-scope Owner tokens
//   extraAllowedHosts   extra Host names the server answers to, e.g. host.docker.internal for n8n
//                       in Docker. The server still listens on 127.0.0.1 only.
// The port lives in the Local API config (one server serves /api/v1 and /mcp).

const SETTINGS_KEY = 'aiSettings';
const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  approvalMode: Object.freeze({ read: 'never', operate: 'ask-hour', full: 'ask-always' }),
  pageDomainAllowList: Object.freeze([]),
  expertMode: false,
  extraAllowedHosts: Object.freeze([])
});
const MODE_CHOICES = Object.freeze({
  read: ['never', 'ask-hour', 'ask-always'],
  operate: ['ask-hour', 'ask-always'],
  full: ['ask-hour', 'ask-always']
});
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
const ALWAYS_ALLOWED_HOSTS = Object.freeze(['127.0.0.1', 'localhost', '[::1]']);

function clone(s) {
  return {
    enabled: Boolean(s.enabled),
    approvalMode: { ...s.approvalMode },
    pageDomainAllowList: [...s.pageDomainAllowList],
    expertMode: Boolean(s.expertMode),
    extraAllowedHosts: [...s.extraAllowedHosts]
  };
}

// Stored value -> complete settings; unknown or invalid values fall back to the defaults.
function normalizeStored(raw) {
  const s = clone(DEFAULT_SETTINGS);
  if (!raw || typeof raw !== 'object') return s;
  s.enabled = raw.enabled === true;
  const m = raw.approvalMode || {};
  for (const scope of Object.keys(MODE_CHOICES)) if (MODE_CHOICES[scope].includes(m[scope])) s.approvalMode[scope] = m[scope];
  try { s.pageDomainAllowList = normalizeDomains(raw.pageDomainAllowList || []); } catch (e) { s.pageDomainAllowList = []; }
  s.expertMode = raw.expertMode === true;
  try { s.extraAllowedHosts = normalizeHosts(raw.extraAllowedHosts || []); } catch (e) { s.extraAllowedHosts = []; }
  return s;
}

function normalizeDomains(list) {
  if (!Array.isArray(list)) throw new Error('pageDomainAllowList must be a list of domains.');
  const out = [];
  for (const raw of list) {
    const d = String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, '').replace(/\.$/, '');
    if (!d) continue;
    if (!HOSTNAME.test(d)) throw new Error(`"${raw}" is not a domain (example: example.com).`);
    if (!out.includes(d)) out.push(d);
  }
  if (out.length > 200) throw new Error('The page-domain allow list holds at most 200 domains.');
  return out;
}

function normalizeHosts(list) {
  if (!Array.isArray(list)) throw new Error('extraAllowedHosts must be a list of host names.');
  const out = [];
  for (const raw of list) {
    const h = String(raw || '').trim().toLowerCase().replace(/:\d+$/, '');
    if (!h) continue;
    if (h === '*' || h === '0.0.0.0' || h.includes('*')) throw new Error('Wildcards are not allowed in extra allowed hosts.');
    if (!HOSTNAME.test(h)) throw new Error(`"${raw}" is not a host name (example: host.docker.internal).`);
    if (ALWAYS_ALLOWED_HOSTS.includes(h)) continue;
    if (!out.includes(h)) out.push(h);
  }
  if (out.length > 10) throw new Error('At most 10 extra allowed hosts.');
  return out;
}

// Applies a patch from the AI page. ctx.isOwner gates Expert mode and extra hosts.
function applyPatch(current, patch, { isOwner = false } = {}) {
  const next = clone(normalizeStored(current));
  const p = (patch && typeof patch === 'object') ? patch : {};
  if (p.approvalMode !== undefined) {
    if (!p.approvalMode || typeof p.approvalMode !== 'object') throw new Error('approvalMode must be an object.');
    for (const [scope, mode] of Object.entries(p.approvalMode)) {
      if (!MODE_CHOICES[scope]) throw new Error(`Unknown scope "${scope}".`);
      if (!MODE_CHOICES[scope].includes(mode)) {
        throw new Error(scope === 'read'
          ? 'Read approval must be never, ask-hour or ask-always.'
          : `"Never ask" is only for read-only tools; ${scope} must be ask-hour or ask-always.`);
      }
      next.approvalMode[scope] = mode;
    }
  }
  if (p.pageDomainAllowList !== undefined) next.pageDomainAllowList = normalizeDomains(p.pageDomainAllowList);
  if (p.expertMode !== undefined) {
    if (!isOwner) throw new Error('Only the Owner can turn Expert mode on or off.');
    next.expertMode = Boolean(p.expertMode);
  }
  if (p.extraAllowedHosts !== undefined) {
    if (!isOwner) throw new Error('Only the Owner can change the extra allowed hosts.');
    next.extraAllowedHosts = normalizeHosts(p.extraAllowedHosts);
  }
  if (p.enabled !== undefined) next.enabled = Boolean(p.enabled);
  return next;
}

function parsePort(value) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) throw new Error('The port must be a number from 1024 to 65535.');
  return n;
}

module.exports = {
  SETTINGS_KEY,
  DEFAULT_SETTINGS,
  MODE_CHOICES,
  ALWAYS_ALLOWED_HOSTS,
  normalizeStored,
  normalizeDomains,
  normalizeHosts,
  applyPatch,
  parsePort
};
