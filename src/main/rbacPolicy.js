'use strict';
// Credential redaction by role, on top of rank gating (permissions.js): an Operator can use a
// resource but never read its raw secrets. Unknown roles count as Operator. Wrap any serializer
// that returns secrets to the renderer with redactForRole().

const ROLE_RANK = { OPERATOR: 1, MANAGER: 2, ADMIN: 3, OWNER: 4, SUPER_ADMIN: 5 };

// Minimum rank that may read each kind's raw value; Operators are below all of them.
const RAW_VALUE_MIN_RANK = {
  proxyCredentials: ROLE_RANK.MANAGER, // host:port may show; user/pass never to Operator
  tokenString: ROLE_RANK.ADMIN,        // API/integration tokens
  cookieDump: ROLE_RANK.MANAGER,       // raw cookie JSON exports and full profile archives
  twoFactorCode: ROLE_RANK.MANAGER     // live TOTP codes minted from a profile's 2FA seed
};

const REDACTED = '••••••••';

function rankOf(role) {
  return ROLE_RANK[String(role || '').toUpperCase()] || 0;
}

function canReadRaw(role, kind) {
  const need = RAW_VALUE_MIN_RANK[kind];
  // Fail closed: an unregistered kind (typo or new secret) is denied to everyone below Owner.
  if (!need) return rankOf(role) >= ROLE_RANK.OWNER;
  return rankOf(role) >= need;
}

// Returns a shallow copy with sensitive fields masked when the role lacks clearance; never mutates.
function redactForRole(role, kind, record) {
  if (!record || typeof record !== 'object') return record;
  if (canReadRaw(role, kind)) return record;

  const out = { ...record, _redacted: true };
  switch (kind) {
    case 'proxyCredentials':
      // Connectivity stays usable in the UI; the secrets are blanked.
      if ('username' in out) out.username = out.username ? REDACTED : '';
      if ('password' in out) out.password = out.password ? REDACTED : '';
      // Also blank combined host:port:user:pass strings, which per-field masking would leak, and the
      // vendor's rotation link, which often carries the account's API key.
      for (const f of ['proxyRaw', 'url', 'connectionString', 'rotationUrl']) {
        if (out[f]) out[f] = REDACTED;
      }
      out.hasUsername = Boolean(record.username);
      out.hasPassword = Boolean(record.password);
      break;
    case 'tokenString':
      if ('token' in out) out.token = out.token ? REDACTED : '';
      if ('apiKey' in out) out.apiKey = out.apiKey ? REDACTED : '';
      if ('secretKey' in out) out.secretKey = out.secretKey ? REDACTED : '';
      break;
    case 'cookieDump':
      // An Operator may see the cookie count but never the values.
      out.cookies = undefined;
      out.cookieCount = Array.isArray(record.cookies) ? record.cookies.length : (record.cookieCount || 0);
      break;
    default:
      // Unknown/unclassified sensitive kind (see canReadRaw fail-closed): blank the
      // common secret-bearing fields defensively rather than passing them through.
      for (const f of ['username', 'password', 'token', 'apiKey', 'secretKey', 'apiToken', 'proxyRaw', 'url', 'connectionString', 'cookies', 'value']) {
        if (f in out && out[f]) out[f] = REDACTED;
      }
      break;
  }
  return out;
}

// Hard guard for export-style actions (cookie dump, raw proxy reveal). Throws FORBIDDEN; call it
// before assembling any raw payload.
function assertCanReveal(role, kind) {
  if (!canReadRaw(role, kind)) {
    const e = new Error(`Your role cannot reveal ${kind}.`);
    e.code = 'FORBIDDEN';
    throw e;
  }
}

module.exports = { ROLE_RANK, RAW_VALUE_MIN_RANK, rankOf, redactForRole, assertCanReveal };
