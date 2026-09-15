'use strict';
// Earlier builds wrote HKCU\Software\Policies\Chromium\ExtensionInstallForcelist so the
// Chrome Web Store would count active users, which force-installed the SoftGlaze
// recorder into every Chromium browser on the machine. The writer is gone; these
// tests pin the cleanup and guard against the policy ever being written again.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  FORCELIST_KEY,
  CWS_UPDATE_URL,
  parseRegValues,
  ownedForcelistValues,
  removeLegacyExtensionForcelist
} = require('../src/main/policyCleanup');
const { SOFTGLAZE_RECORDER_ID } = require('../src/main/extensionManager');

const OURS = `${SOFTGLAZE_RECORDER_ID};${CWS_UPDATE_URL}`;
const header = `\r\nHKEY_CURRENT_USER\\Software\\Policies\\Chromium\\ExtensionInstallForcelist\r\n`;
const regOutput = (...rows) => `${header}${rows.map(([n, t, d]) => `    ${n}    ${t}    ${d}`).join('\r\n')}\r\n\r\n`;

// Scripted stand-in for reg.exe: records calls and replays queued query outputs.
function fakeReg(queryOutputs) {
  const calls = [];
  const queue = [...queryOutputs];
  const reg = async (args) => {
    calls.push(args);
    if (args[0] === 'query') return queue.length ? queue.shift() : { code: 1, stdout: '' };
    return { code: 0, stdout: '' };
  };
  return { reg, calls };
}

test('parseRegValues reads name, type and data from reg query output', () => {
  const values = parseRegValues(regOutput(['100', 'REG_SZ', OURS], ['1', 'REG_SZ', 'abc;https://example.com/update']));
  assert.deepEqual(values, [
    { name: '100', type: 'REG_SZ', data: OURS },
    { name: '1', type: 'REG_SZ', data: 'abc;https://example.com/update' }
  ]);
});

test('only the exact SoftGlaze entry counts as ours', () => {
  const values = [
    { name: '100', type: 'REG_SZ', data: OURS },
    { name: '5', type: 'REG_SZ', data: `${SOFTGLAZE_RECORDER_ID};https://other.example/update` },
    { name: '6', type: 'REG_SZ', data: 'someotherextensionidxxxxxxxxxxxxxx;' + CWS_UPDATE_URL }
  ];
  assert.deepEqual(ownedForcelistValues(values, SOFTGLAZE_RECORDER_ID).map((v) => v.name), ['100']);
});

test('deletes our value and the key it leaves empty', async () => {
  const { reg, calls } = fakeReg([
    { code: 0, stdout: regOutput(['100', 'REG_SZ', OURS]) },
    { code: 0, stdout: header }
  ]);
  const res = await removeLegacyExtensionForcelist({ extensionId: SOFTGLAZE_RECORDER_ID, platform: 'win32', reg });
  assert.equal(res.removed, 1);
  assert.deepEqual(calls, [
    ['query', FORCELIST_KEY],
    ['delete', FORCELIST_KEY, '/v', '100', '/f'],
    ['query', FORCELIST_KEY],
    ['delete', FORCELIST_KEY, '/f']
  ]);
});

test('leaves other products\' values and the key in place', async () => {
  const { reg, calls } = fakeReg([
    { code: 0, stdout: regOutput(['100', 'REG_SZ', OURS], ['1', 'REG_SZ', `abcdefabcdefabcdefabcdefabcdefab;${CWS_UPDATE_URL}`]) }
  ]);
  const res = await removeLegacyExtensionForcelist({ extensionId: SOFTGLAZE_RECORDER_ID, platform: 'win32', reg });
  assert.equal(res.removed, 1);
  assert.deepEqual(calls, [['query', FORCELIST_KEY], ['delete', FORCELIST_KEY, '/v', '100', '/f']]);
});

test('does nothing when the key is absent or off Windows', async () => {
  const absent = fakeReg([{ code: 1, stdout: '' }]);
  assert.deepEqual(await removeLegacyExtensionForcelist({ extensionId: SOFTGLAZE_RECORDER_ID, platform: 'win32', reg: absent.reg }), { removed: 0 });
  assert.equal(absent.calls.length, 1);

  const mac = fakeReg([]);
  assert.deepEqual(await removeLegacyExtensionForcelist({ extensionId: SOFTGLAZE_RECORDER_ID, platform: 'darwin', reg: mac.reg }), { skipped: true });
  assert.equal(mac.calls.length, 0);
});

test('no source file writes a browser extension policy', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(js|jsx)$/.test(entry.name) || entry.name === 'policyCleanup.js') continue;
      const src = fs.readFileSync(full, 'utf8');
      if (/ExtensionInstallForcelist|ExtensionInstallAllowlist|Software\\\\Policies/.test(src)) offenders.push(path.relative(path.join(__dirname, '..'), full));
    }
  };
  walk(path.join(__dirname, '..', 'src'));
  assert.deepEqual(offenders, []);
});
