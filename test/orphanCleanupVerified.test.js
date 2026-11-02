'use strict';
// Audit 2 Nov 2026 #8: at start-up the app force-closed EVERY PID listed in
// %TEMP%\softglaze_active_pids.json with no check. After a crash or power cut those PIDs
// can belong to other programs (Windows reuses them), which then lost unsaved work.
// A PID is now killed only when it is verifiably a SoftGlaze profile browser.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseTrackedPids, selectVerifiedPids, killTrackedOrphans } = require('../src/main/orphanCleanup');

const ROOT = path.join(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'src', 'main', 'main.js'), 'utf8');
const ENGINE = fs.readFileSync(path.join(ROOT, 'src', 'main', 'browserEngine.js'), 'utf8');
const DIR_A = 'C:\\Users\\x\\AppData\\Roaming\\softglaze-browser\\softglaze_profiles\\Profile-01';

test('old (bare numbers) and new ({pid, dir}) PID files are both read; junk is ignored', () => {
  assert.deepEqual(parseTrackedPids('[101, 102]'), [{ pid: 101, dir: null }, { pid: 102, dir: null }]);
  assert.deepEqual(parseTrackedPids(JSON.stringify([{ pid: 7, dir: DIR_A }])), [{ pid: 7, dir: DIR_A }]);
  assert.deepEqual(parseTrackedPids('not json'), []);
  assert.deepEqual(parseTrackedPids('{"a":1}'), []);
  assert.deepEqual(parseTrackedPids('[-1, "x", {"pid": 0}]'), []);
});

test('only a browser whose command line points at the recorded profile folder is selected', () => {
  const entries = [
    { pid: 10, dir: DIR_A },             // still our Chrome
    { pid: 11, dir: DIR_A },             // PID reused by Excel
    { pid: 12, dir: DIR_A },             // PID reused by the user's own Chrome
    { pid: 13, dir: null },              // legacy entry, our Chrome (marker match)
    { pid: 14, dir: null },              // legacy entry, someone else's Chrome
    { pid: 15, dir: DIR_A }              // gone
  ];
  const rows = [
    { pid: 10, name: 'chrome.exe', commandLine: `"C:\\x\\chrome.exe" --user-data-dir=${DIR_A} --flag` },
    { pid: 11, name: 'EXCEL.EXE', commandLine: `"C:\\Office\\EXCEL.EXE" ${DIR_A}` },
    { pid: 12, name: 'chrome.exe', commandLine: '"C:\\Program Files\\Google\\Chrome\\chrome.exe" --profile-directory=Default' },
    { pid: 13, name: 'chrome.exe', commandLine: '--user-data-dir=C:/data/softglaze_profiles/P2' },
    { pid: 14, name: 'chrome.exe', commandLine: '--user-data-dir=C:/Users/x/Chrome' }
  ];
  assert.deepEqual(selectVerifiedPids(entries, rows), [10, 13]);
});

test('a process whose command line cannot be read is never killed', () => {
  assert.deepEqual(selectVerifiedPids([{ pid: 20, dir: DIR_A }], [{ pid: 20, name: 'chrome.exe', commandLine: '' }]), []);
});

test('killTrackedOrphans kills only verified PIDs and always clears the file', async () => {
  const file = path.join(os.tmpdir(), `sg-pids-test-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify([{ pid: 10, dir: DIR_A }, { pid: 11, dir: DIR_A }]));
  const killed = [];
  const fakeExec = (cmd, args, opts, cb) => {
    const out = process.platform === 'win32'
      ? `10\tchrome.exe\t--user-data-dir=${DIR_A}\r\n11\tnotepad.exe\tnotepad.exe\r\n`
      : `10 chrome --user-data-dir=${DIR_A}\n11 notepad notepad\n`;
    cb(null, out);
  };
  const res = await killTrackedOrphans({ pidFile: file, execFile: fakeExec, kill: (p) => killed.push(p), log: { log() {} } });
  assert.deepEqual(killed, [10]);
  assert.deepEqual(res.killed, [10]);
  assert.equal(fs.existsSync(file), false);
});

test('main.js no longer kills PIDs blindly; the engine records the profile folder', () => {
  assert.ok(!/pids\.forEach\(pid => \{ try \{ process\.kill\(pid, 9\)/.test(MAIN), 'the blind kill loop is gone');
  assert.match(MAIN, /await killTrackedOrphans\(\);/);
  assert.match(ENGINE, /trackPid\(pid, userDataDir\);/);
  assert.match(ENGINE, /pids\.push\(\{ pid, dir: userDataDir \? String\(userDataDir\) : null \}\);/);
});
