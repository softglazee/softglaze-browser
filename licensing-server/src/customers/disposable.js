'use strict';
// Disposable ("temp mail") domains: the vendored open-source list in src/data/disposable-domains.json
// (CC0, refreshed by scripts/update-disposable.js), plus the owner's own block and allow lists from
// the tenant settings (email.domainBlocklist / email.domainAllowlist) and EMAIL_DOMAIN_ALLOWLIST.
// A domain matches when it or any parent domain is listed (x.mailinator.com is mailinator.com);
// the allowlist wins.
const path = require('node:path');
const fs = require('node:fs');
const { liveEnv } = require('../env');

let listed = null;
let meta = null;

function load() {
  if (listed) return;
  const file = path.join(__dirname, '..', 'data', 'disposable-domains.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  listed = new Set(doc.domains || []);
  meta = { source: doc.source, licence: doc.licence, upstreamCommit: doc.upstreamCommit, fetchedAt: doc.fetchedAt, count: listed.size };
}

function parents(domain) {
  const labels = String(domain || '').toLowerCase().split('.').filter(Boolean);
  const out = [];
  for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join('.'));
  return out;
}

function toSet(list) {
  const arr = Array.isArray(list) ? list : String(list || '').split(',');
  return new Set(arr.map((d) => String(d).trim().toLowerCase().replace(/^@/, '')).filter(Boolean));
}

// opts: { allow: string[], block: string[] } from the tenant settings.
function isDisposableDomain(domain, opts = {}) {
  load();
  const allow = toSet([...(opts.allow || []), ...toSet(liveEnv('EMAIL_DOMAIN_ALLOWLIST') || '')]);
  const block = toSet(opts.block || []);
  const chain = parents(domain);
  if (chain.some((d) => allow.has(d))) return false;
  return chain.some((d) => listed.has(d) || block.has(d));
}

function listInfo() {
  load();
  return { ...meta };
}

module.exports = { isDisposableDomain, listInfo, parents };
