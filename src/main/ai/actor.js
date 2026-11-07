'use strict';
// Who a call acts as. An AI or Local API request runs inside run(actor, fn), so every permission
// check, ownership stamp and activity-log row inside it uses the token's member, never whoever is
// signed in to the app window. Outside run() current() is null and the window's member applies.
//
// actor: { memberId: number | null, tokenId, tokenName, clientName, via: 'ai' | 'api' }
// memberId is null only in single-user mode (no members exist), where the app treats everyone as
// the owner; the auth layer never builds a null-member actor once a team exists.
const { AsyncLocalStorage } = require('node:async_hooks');

const store = new AsyncLocalStorage();

function run(actor, fn) {
  if (!actor || typeof actor !== 'object') throw new TypeError('actor must be an object');
  return store.run(Object.freeze({ ...actor }), fn);
}

function current() {
  return store.getStore() || null;
}

// Short tag that marks API and AI actions in the activity log, e.g. "[via AI: Claude Code]".
function label(actor) {
  const a = actor || current();
  if (!a) return null;
  const who = String(a.clientName || a.tokenName || 'token').replace(/[\r\n\]]+/g, ' ').trim().slice(0, 60);
  return a.via === 'api' ? `[via Local API: ${who}]` : `[via AI: ${who}]`;
}

// Marks an activity-log detail with the API/AI tag. Unchanged outside an actor context.
function tagDetail(detail) {
  const tag = label();
  if (!tag) return detail;
  if (detail && typeof detail === 'object') return { ...detail, via: tag };
  return detail ? `${tag} ${detail}` : tag;
}

module.exports = { run, current, label, tagDetail };
