// Small pure helpers shared by renderer pages. Kept framework-free (and .mjs) so the
// node:test suite can import and exercise them directly.

// Parse a number typed into an <input type="number">. An empty or non-numeric value
// falls back; anything else is rounded and clamped into [min, max].
export function clampNumber(raw, { min = -Infinity, max = Infinity, fallback = 0 } = {}) {
  const s = String(raw == null ? '' : raw).trim();
  const n = s === '' ? NaN : Number(s);
  const v = Number.isFinite(n) ? Math.round(n) : fallback;
  return Math.min(max, Math.max(min, v));
}

// The selected ids that are still among `visibleRows`, in row order. Bulk actions use
// this so a row hidden by a filter or a search is never acted on.
export function intersectSelection(selected, visibleRows) {
  const sel = selected instanceof Set ? selected : new Set(selected || []);
  return (visibleRows || []).filter((r) => r && sel.has(r.id)).map((r) => r.id);
}

// Request-sequence guard: each call to next() returns a ticket; only the newest ticket
// isLatest(). Used to drop stale async responses that resolve out of order.
export function createSeqGuard() {
  let seq = 0;
  return {
    next() { seq += 1; return seq; },
    isLatest(ticket) { return ticket === seq; }
  };
}
