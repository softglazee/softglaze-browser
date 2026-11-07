// The editor's Do Not Track choice for any stored value: 'Open' / 'Close' / 'Default'.
// Older or imported profiles may hold on/off, 1/0, true/false, yes/no, enable(d)/disable(d) or nothing.
// Same table as src/main/doNotTrack.js (test/doNotTrack.test.js keeps the two equal).
const ON = new Set(['open', 'opened', 'on', '1', 'true', 'yes', 'enable', 'enabled']);
const OFF = new Set(['close', 'closed', 'off', '0', 'false', 'no', 'disable', 'disabled']);
const DEFAULT = new Set(['default', 'auto', 'unset']);

export function doNotTrackChoice(value) {
  if (value === true || value === 1) return 'Open';
  if (value === false || value === 0) return 'Close';
  if (value === null || value === undefined) return 'Default';
  const t = String(value).trim().toLowerCase();
  if (ON.has(t)) return 'Open';
  if (OFF.has(t)) return 'Close';
  if (DEFAULT.has(t)) return 'Default';
  const words = t.split(/[^a-z0-9]+/).filter(Boolean);
  const on = words.some((w) => ON.has(w));
  const off = words.some((w) => OFF.has(w));
  if (on && !off) return 'Open';
  if (off && !on) return 'Close';
  return 'Default';
}
