'use strict';
// Removes a Chromium extension policy that earlier builds wrote.
//
// Builds before this change added the per-user value
//   HKCU\Software\Policies\Chromium\ExtensionInstallForcelist  "100"
//   = "<SoftGlaze recorder id>;https://clients2.google.com/service/update2/crx"
// so the Chrome Web Store would count active users. That policy force-installs the
// extension into EVERY Chromium-based browser that reads the Chromium policy key, not
// only SoftGlaze profiles. The writer has been removed; this deletes what it left.
//
// Only a value whose data is exactly that entry is deleted. Anything else in the key
// (another product's policy) is left alone, and the key itself is removed only when
// that leaves it completely empty. Runs at every launch on Windows: it is cheap and
// idempotent, and a machine that ran an older build since will be cleaned again.

const { execFile } = require('node:child_process');

const FORCELIST_KEY = 'HKCU\\Software\\Policies\\Chromium\\ExtensionInstallForcelist';
const CWS_UPDATE_URL = 'https://clients2.google.com/service/update2/crx';

// Parse `reg query <key>` output into [{ name, type, data }].
function parseRegValues(stdout) {
  const values = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const m = /^\s{4}(.+?)\s{4}(REG_[A-Z_]+)(?:\s{4}(.*))?$/.exec(line);
    if (m) values.push({ name: m[1], type: m[2], data: (m[3] || '').trim() });
  }
  return values;
}

// `reg query <key>` lists the key itself and any subkeys as full HKEY_... lines.
function hasSubkeys(stdout) {
  return String(stdout || '').split(/\r?\n/).filter((line) => /^HKEY_/i.test(line.trim())).length > 1;
}

// The values this app wrote: the recorder id with the Web Store update URL.
function ownedForcelistValues(values, extensionId) {
  const expected = `${extensionId};${CWS_UPDATE_URL}`.toLowerCase();
  return values.filter((v) => v.type === 'REG_SZ' && v.data.toLowerCase() === expected);
}

function runReg(args) {
  return new Promise((resolve) => {
    execFile('reg', args, { windowsHide: true, timeout: 10000, encoding: 'utf8' }, (err, stdout) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout || '' });
    });
  });
}

async function removeLegacyExtensionForcelist({ extensionId, platform = process.platform, reg = runReg } = {}) {
  if (platform !== 'win32' || !extensionId) return { skipped: true };

  const query = await reg(['query', FORCELIST_KEY]);
  if (query.code !== 0) return { removed: 0 }; // the key does not exist

  const values = parseRegValues(query.stdout);
  const owned = ownedForcelistValues(values, extensionId);
  let removed = 0;
  for (const value of owned) {
    const del = await reg(['delete', FORCELIST_KEY, '/v', value.name, '/f']);
    if (del.code === 0) removed++;
  }

  if (removed > 0 && removed === values.length && !hasSubkeys(query.stdout)) {
    const again = await reg(['query', FORCELIST_KEY]);
    if (again.code === 0 && parseRegValues(again.stdout).length === 0 && !hasSubkeys(again.stdout)) {
      await reg(['delete', FORCELIST_KEY, '/f']);
    }
  }

  if (removed) console.log(`[policy-cleanup] removed ${removed} legacy Chromium extension policy value(s)`);
  return { removed };
}

module.exports = {
  FORCELIST_KEY,
  CWS_UPDATE_URL,
  parseRegValues,
  hasSubkeys,
  ownedForcelistValues,
  removeLegacyExtensionForcelist
};
