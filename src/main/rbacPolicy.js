'use strict';
// ---------------------------------------------------------------------------
// Softglaze Enterprise — RBAC Policy Layer (credential-redaction middleware)
//
// The app already enforces role RANK gating (see permissions.js / requirePermission
// in ipcHandlers). This module adds the COMPLEMENTARY policy layer the Enterprise
// tier needs: a strict, centralized redaction policy so an OPERATOR can USE a
// resource (launch a profile through its proxy) but can NEVER read the raw secret
// values behind it — proxy credentials, token strings, or cookie dumps.
//
// Wire `redactForRole(role, kind, record)` into any serializer that returns
// secret-bearing data to the renderer. It is pure + defensive (unknown role ⇒
// treated as the most-restricted Operator).
// ---------------------------------------------------------------------------

const ROLE_RANK = { OPERATOR: 1, MANAGER: 2, ADMIN: 3, OWNER: 4, SUPER_ADMIN: 5 };

// Minimum rank allowed to see the RAW value of each sensitive resource kind.
// Operators are below all of these, so they are completely blocked.
const RAW_VALUE_MIN_RANK = {
  proxyCredentials: ROLE_RANK.MANAGER, // host:port may show; user/pass never to Operator
  tokenString: ROLE_RANK.ADMIN,        // API/integration tokens
  cookieDump: ROLE_RANK.MANAGER        // raw cookie JSON exports
};

const REDACTED = '••••••••';

function rankOf(role) {
  return ROLE_RANK[String(role || '').toUpperCase()] || 0;
}

// Can this role read the raw value of `kind`?
function canReadRaw(role, kind) {
  const need = RAW_VALUE_MIN_RANK[kind];
  if (!need) return true; // unknown kind ⇒ not classified as sensitive
  return rankOf(role) >= need;
}

// Redact a record for a role. Returns a SHALLOW COPY with sensitive fields masked
// when the role lacks clearance — the raw object is never mutated.
function redactForRole(role, kind, record) {
  if (!record || typeof record !== 'object') return record;
  if (canReadRaw(role, kind)) return record;

  const out = { ...record, _redacted: true };
  switch (kind) {
    case 'proxyCredentials':
      // Connectivity stays usable in the UI; the secrets are blanked.
      if ('username' in out) out.username = out.username ? REDACTED : '';
      if ('password' in out) out.password = out.password ? REDACTED : '';
      out.hasUsername = Boolean(record.username);
      out.hasPassword = Boolean(record.password);
      break;
    case 'tokenString':
      if ('token' in out) out.token = out.token ? REDACTED : '';
      if ('apiKey' in out) out.apiKey = out.apiKey ? REDACTED : '';
      if ('secretKey' in out) out.secretKey = out.secretKey ? REDACTED : '';
      break;
    case 'cookieDump':
      // An Operator may know cookies EXIST (count) but never read their values.
      out.cookies = undefined;
      out.cookieCount = Array.isArray(record.cookies) ? record.cookies.length : (record.cookieCount || 0);
      break;
    default:
      break;
  }
  return out;
}

// Hard guard for export-style actions (cookie dump download, raw proxy reveal).
// Throws FORBIDDEN when the role is below clearance — call this in the handler
// BEFORE assembling any raw payload.
function assertCanReveal(role, kind) {
  if (!canReadRaw(role, kind)) {
    const e = new Error(`Your role cannot reveal ${kind}.`);
    e.code = 'FORBIDDEN';
    throw e;
  }
}

module.exports = { ROLE_RANK, RAW_VALUE_MIN_RANK, rankOf, canReadRaw, redactForRole, assertCanReveal };
