// SoftGlaze AI approvals: the queue behind the app-wide dialog and the Approvals tab.
// Framework-free (.mjs) so node:test exercises it directly.
//
// Rules: one queue, oldest first, one dialog at a time (never stacked). An approval that reaches
// its deadline leaves the queue; main denies it on its own clock (spec §5: 2 minutes = denied).

export const APPROVAL_TIMEOUT_MS = 120000;
export const DECISIONS = Object.freeze(['allow-once', 'allow-hour', 'deny']);

function toMs(v) {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  return Date.parse(String(v));
}

// Adds private bookkeeping (_key, _createdMs, _deadline, _receivedMs) to an approval object from
// main. Returns null for anything without an id. A missing expiresAt falls back to createdAt + 2 min.
export function normalizeApproval(raw, receivedAt = Date.now()) {
  if (!raw || typeof raw !== 'object' || raw.id == null || raw.id === '') return null;
  const created = toMs(raw.createdAt);
  const createdMs = Number.isFinite(created) ? created : receivedAt;
  const exp = toMs(raw.expiresAt);
  const deadline = Number.isFinite(exp) ? exp : createdMs + APPROVAL_TIMEOUT_MS;
  return { ...raw, _key: String(raw.id), _createdMs: createdMs, _deadline: deadline, _receivedMs: receivedAt };
}

// Adds or refreshes one approval. Duplicates (the event and the list both carry it) merge in
// place; anything already past its deadline is ignored. Oldest first.
export function enqueue(queue, raw, now = Date.now()) {
  const a = normalizeApproval(raw, now);
  if (!a || a._deadline <= now) return queue;
  const i = queue.findIndex((x) => x._key === a._key);
  if (i >= 0) {
    const next = queue.slice();
    next[i] = { ...queue[i], ...a, _receivedMs: Math.min(queue[i]._receivedMs, a._receivedMs) };
    return next;
  }
  return [...queue, a].sort((x, y) => x._createdMs - y._createdMs);
}

export function removeApproval(queue, id) {
  const k = String(id);
  const next = queue.filter((a) => a._key !== k);
  return next.length === queue.length ? queue : next;
}

// Splits the queue into what is still open and what timed out (the caller tells the user).
export function pruneExpired(queue, now = Date.now()) {
  const kept = [];
  const expired = [];
  for (const a of queue) (a._deadline <= now ? expired : kept).push(a);
  return { queue: expired.length ? kept : queue, expired };
}

// Applies ai.approvals.list(). Local items the server no longer lists are dropped (answered or
// cancelled elsewhere), except ones received after the request went out: the reply may predate them.
export function syncFromServer(queue, list, requestedAt, now = Date.now()) {
  const items = Array.isArray(list) ? list : [];
  const serverKeys = new Set(items.filter((x) => x && x.id != null).map((x) => String(x.id)));
  let next = queue.filter((a) => serverKeys.has(a._key) || a._receivedMs > requestedAt);
  for (const raw of items) next = enqueue(next, raw, now);
  return pruneExpired(next, now).queue;
}

// The approval the dialog shows: the oldest one the user has not put aside with "Decide later".
export function currentApproval(queue, hiddenKeys) {
  return queue.find((a) => !(hiddenKeys && hiddenKeys.has(a._key))) || null;
}

export function secondsLeft(a, now = Date.now()) {
  if (!a) return 0;
  return Math.max(0, Math.ceil((a._deadline - now) / 1000));
}

// 1 = just arrived, 0 = time is up. Drives the countdown bar.
export function fractionLeft(a, now = Date.now()) {
  if (!a) return 0;
  const total = a._deadline - a._createdMs;
  if (!(total > 0)) return 0;
  return Math.min(1, Math.max(0, (a._deadline - now) / total));
}

export function formatCountdown(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function urgency(sec) {
  if (sec <= 10) return 'urgent';
  if (sec <= 30) return 'soon';
  return 'calm';
}

// Screen readers hear the countdown only when it crosses 30 s and 10 s, never every second.
export function crossedThreshold(prevSec, sec) {
  for (const mark of [30, 10]) if (prevSec > mark && sec <= mark) return mark;
  return null;
}

// A respond() failure that means the approval is gone (answered elsewhere, timed out, cancelled
// by Stop all AI): drop it from the queue instead of keeping a dead dialog open.
export function isGoneError(e) {
  if (!e) return false;
  const code = String(e.code || '').toUpperCase();
  if (['NOT_FOUND', 'EXPIRED', 'APPROVAL_GONE', 'APPROVAL_EXPIRED', 'APPROVAL_NOT_FOUND'].includes(code)) return true;
  return /\b(not found|expired|no longer|already (answered|decided|resolved))\b/i.test(String(e.message || ''));
}

export function isDecision(d) {
  return DECISIONS.includes(d);
}
