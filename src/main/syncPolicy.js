'use strict';
// Per-profile cloud sync decision: push, pull, noop or conflict. Last-write-wins by updatedAt, but
// when both sides changed since the last sync it reports a conflict instead of clobbering the loser.

// Normalize a timestamp (Date | ISO string | epoch ms) to epoch ms, or 0.
function toMs(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

// remoteMeta { updatedAt, rev } comes from the bucket index, lastSync { syncedAt, rev } from local
// state; either may be null. Returns { action: push|pull|noop|conflict, resolution, reason }, where
// resolution is the LWW winner, or null for a real conflict the caller must resolve explicitly.
function decideProfileSync({ localUpdatedAt, remoteMeta, lastSync } = {}) {
  const local = toMs(localUpdatedAt);
  const remote = remoteMeta ? toMs(remoteMeta.updatedAt) : null;
  const syncedAt = lastSync ? toMs(lastSync.syncedAt) : 0;

  if (remote == null) return { action: 'push', resolution: 'push', reason: 'remote-absent' };

  // Compare the monotonic rev when both sides have one: it is immune to clock skew, whereas a
  // lagging clock could hide a remote change and let a local push overwrite it.
  const haveRevs = remoteMeta && remoteMeta.rev != null && lastSync && lastSync.rev != null;
  const localChanged = local > syncedAt;
  const remoteChanged = haveRevs ? (remoteMeta.rev !== lastSync.rev) : (remote > syncedAt);

  if (!localChanged && !remoteChanged) return { action: 'noop', resolution: null, reason: 'in-sync' };
  if (localChanged && !remoteChanged) return { action: 'push', resolution: 'push', reason: 'local-changed' };
  if (!localChanged && remoteChanged) return { action: 'pull', resolution: 'pull', reason: 'remote-changed' };

  // Both sides changed: never auto-pick a winner, since a skewed clock would clobber the good side.
  // resolution null makes the caller resolve it explicitly.
  return { action: 'conflict', resolution: null, reason: 'both-changed' };
}

module.exports = { decideProfileSync, toMs };
