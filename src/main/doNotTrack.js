'use strict';
// Do Not Track: one meaning for every place that reads or writes a profile's choice.
//
// The profile editor stores 'Open' / 'Close' / 'Default' (the words the website uses too). Batch import,
// the API and older profiles may carry on / off, 1 / 0, true / false, yes / no or enable(d) / disable(d).
//   Open    DNT on. The browser's own setting is switched on, so the browser itself sends DNT: 1 and
//           reports navigator.doNotTrack "1".
//   Close   DNT off. The browser's own setting is switched off: Chromium sends no header and reports
//           null, Firefox sends no header and reports "unspecified".
//   Default Nothing is changed: the browser keeps its own setting (off in a new profile). If SoftGlaze
//           had switched the setting on for this profile before, that is undone (see dntPrefToWrite).
const fs = require('node:fs/promises');
const path = require('node:path');

const ON = new Set(['open', 'opened', 'on', '1', 'true', 'yes', 'enable', 'enabled']);
const OFF = new Set(['close', 'closed', 'off', '0', 'false', 'no', 'disable', 'disabled']);
const DEFAULT = new Set(['default', 'auto', 'unset']);

// 'Open' | 'Close' | 'Default', or null when the value is empty or not understood.
function parseDoNotTrack(value) {
  if (value === true || value === 1) return 'Open';
  if (value === false || value === 0) return 'Close';
  if (value === null || value === undefined) return null;
  const t = String(value).trim().toLowerCase();
  if (!t) return null;
  if (ON.has(t)) return 'Open';
  if (OFF.has(t)) return 'Close';
  if (DEFAULT.has(t)) return 'Default';
  // Phrases from other tools' exports ("DNT enabled", "Turn on"): decided on whole words, never on a
  // substring ("none" contains "on"), and not at all when a phrase says both.
  const words = t.split(/[^a-z0-9]+/).filter(Boolean);
  const on = words.some((w) => ON.has(w));
  const off = words.some((w) => OFF.has(w));
  if (on && !off) return 'Open';
  if (off && !on) return 'Close';
  if (!on && !off && words.some((w) => DEFAULT.has(w))) return 'Default';
  return null;
}

// The stored form: the editor's word for any understood value, 'Default' for anything else.
function doNotTrackChoice(value) {
  return parseDoNotTrack(value) || 'Default';
}

// What a launch applies: '1' (on), '0' (off) or null (leave the browser's own setting alone).
function doNotTrackFlag(value) {
  const choice = parseDoNotTrack(value);
  if (choice === 'Open') return '1';
  if (choice === 'Close') return '0';
  return null;
}

// Records, inside the browser profile folder, the DNT value SoftGlaze last wrote into the browser's own
// settings. Without it, a profile set back from Open to Default would keep sending DNT, because the
// browser stores the setting. Websites cannot see this file.
const DNT_MARKER = '.softglaze-dnt';

// The browser setting to write for this launch: '1' (on), '0' (off) or null (write nothing).
// Open / Close: their value, remembered in the marker. Default: nothing, unless SoftGlaze had switched
// the setting on for this profile, which is then switched back off (the browser's own default). A
// setting the user made inside the browser (no marker) is never touched. Best-effort: a marker that
// cannot be read or written never stops a launch.
async function dntPrefToWrite(userDataDir, flag) {
  const explicit = flag === '1' || flag === '0';
  if (!userDataDir) return explicit ? flag : null;
  const marker = path.join(String(userDataDir), DNT_MARKER);
  if (explicit) {
    try {
      await fs.mkdir(path.dirname(marker), { recursive: true });
      await fs.writeFile(marker, flag);
    } catch (e) { /* best-effort */ }
    return flag;
  }
  let last = null;
  try { last = (await fs.readFile(marker, 'utf8')).trim(); } catch (e) { return null; }
  try { await fs.unlink(marker); } catch (e) { /* best-effort */ }
  return last === '1' ? '0' : null;
}

module.exports = { parseDoNotTrack, doNotTrackChoice, doNotTrackFlag, dntPrefToWrite, DNT_MARKER };
