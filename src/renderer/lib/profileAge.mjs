// Compact profile age for the Profiles list ("12d", "4mo", "2y") and whether the warm-up has run
// often enough to count as real history.

const DAY_MS = 24 * 60 * 60 * 1000;

// Same threshold as WARMED_RUNS in src/main/captchaScore.js, where it lets the history factor pass.
export const WARMED_RUNS = 3;

// { unit: 'd' | 'mo' | 'y', count, days } or null for a missing or invalid date.
export function ageParts(createdAt, now = Date.now()) {
  if (!createdAt) return null;
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return null;
  const days = Math.max(0, Math.floor((now - t) / DAY_MS));
  if (days < 60) return { unit: 'd', count: days, days };
  if (days < 365) return { unit: 'mo', count: Math.floor(days / 30), days };
  return { unit: 'y', count: Math.floor(days / 365), days };
}

export function warmRuns(stat) {
  return stat ? Math.max(0, Number(stat.runs) || 0) : 0;
}

export function isWarmed(stat) {
  return warmRuns(stat) >= WARMED_RUNS;
}
