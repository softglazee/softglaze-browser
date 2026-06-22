'use strict';
// ---------------------------------------------------------------------------
// Softglaze Enterprise — Cloud sync conflict policy (PURE).
//
// Decides, per profile, whether to push (local -> remote), pull (remote ->
// local), do nothing, or flag a conflict. Resolution is last-write-wins by
// updatedAt, but a genuine divergence (both sides changed since the last sync)
// is reported as `conflict` so the UI can surface it instead of silently
// clobbering the loser. No Electron / DB / transport — unit-testable in isolation
// (same seam as teamPolicy / parallelRunner / syncTransport).
// ---------------------------------------------------------------------------

// Normalize a timestamp (Date | ISO string | epoch ms) to epoch ms, or 0.
function toMs(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

// localUpdatedAt : when the local profile last changed (Date | ISO | ms)
// remoteMeta     : { updatedAt, rev } from the bucket index, or null if absent
// lastSync       : { syncedAt, rev } from local sync state, or null if never synced
//
// Returns { action: 'push'|'pull'|'noop'|'conflict', resolution: 'push'|'pull'|null, reason }.
// `resolution` is the concrete operation to perform (LWW winner); for a conflict
// it is still set (the newer side wins) AND action==='conflict' so the caller can
// both resolve and report it.
function decideProfileSync({ localUpdatedAt, remoteMeta, lastSync } = {}) {
  const local = toMs(localUpdatedAt);
  const remote = remoteMeta ? toMs(remoteMeta.updatedAt) : null;
  const syncedAt = lastSync ? toMs(lastSync.syncedAt) : 0;

  // Nothing remote yet -> first upload.
  if (remote == null) return { action: 'push', resolution: 'push', reason: 'remote-absent' };

  const localChanged = local > syncedAt;
  const remoteChanged = remote > syncedAt;

  if (!localChanged && !remoteChanged) return { action: 'noop', resolution: null, reason: 'in-sync' };
  if (localChanged && !remoteChanged) return { action: 'push', resolution: 'push', reason: 'local-changed' };
  if (!localChanged && remoteChanged) return { action: 'pull', resolution: 'pull', reason: 'remote-changed' };

  // Both changed since the last sync -> conflict. LWW picks the newer side.
  const resolution = remote > local ? 'pull' : 'push';
  return { action: 'conflict', resolution, reason: 'both-changed' };
}

module.exports = { decideProfileSync, toMs };
