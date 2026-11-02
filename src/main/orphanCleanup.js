'use strict';
// Start-up cleanup of profile browsers left running by a previous app run (crash, kill,
// power loss), done SAFELY.
//
// The app records each profile browser's PID in %TEMP%\softglaze_active_pids.json and
// used to kill every listed PID at the next start with process.kill(pid, 9), without
// checking what that PID is now. After a crash or a power cut the file survives, Windows
// reuses PIDs, and the next start could force-close unrelated programs (an editor, a
// game, Excel) and lose their unsaved work.
//
// Now a listed PID is only killed when the process that holds it RIGHT NOW is a browser
// executable whose command line points at that profile's own data folder (recorded with
// the PID), or - for entries written by older versions, which only stored the number -
// at the SoftGlaze profile root. Anything else is left alone.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PID_FILE = path.join(os.tmpdir(), 'softglaze_active_pids.json');
const PROFILE_ROOT_MARKER = 'softglaze_profiles';
const BROWSER_EXE = /^(chrome|chromium|msedge|brave|firefox)(\.exe)?$/i;

// Accepts both the old format ([123, 456]) and the new one ([{ pid, dir }]).
function parseTrackedPids(content) {
  let raw;
  try { raw = JSON.parse(String(content || '').trim() || '[]'); } catch (e) { return []; }
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (Number.isInteger(item) && item > 0) out.push({ pid: item, dir: null });
    else if (item && Number.isInteger(item.pid) && item.pid > 0) out.push({ pid: item.pid, dir: item.dir ? String(item.dir) : null });
  }
  return out;
}

const norm = (s) => String(s || '').replace(/\//g, '\\').toLowerCase();

// rows: [{ pid, name, commandLine }] for the PIDs that are alive now.
// Returns the PIDs that are verifiably a SoftGlaze profile browser.
function selectVerifiedPids(entries, rows, marker = PROFILE_ROOT_MARKER) {
  const byPid = new Map((rows || []).map((r) => [Number(r.pid), r]));
  const keep = [];
  for (const e of entries || []) {
    const row = byPid.get(Number(e.pid));
    if (!row) continue; // not running any more
    if (!BROWSER_EXE.test(path.basename(String(row.name || '')))) continue;
    const cmd = norm(row.commandLine);
    if (!cmd) continue; // cannot see its command line: do not guess
    const needle = e.dir ? norm(e.dir) : norm(marker);
    if (needle && cmd.includes(needle)) keep.push(Number(e.pid));
  }
  return [...new Set(keep)];
}

// Live process rows for the given PIDs (Windows: one CIM query; elsewhere: ps).
function queryProcesses(pids, execFile) {
  const ids = [...new Set((pids || []).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return Promise.resolve([]);
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // PIDs are validated integers, so the filter string cannot be injected.
      const filter = ids.map((n) => `ProcessId=${n}`).join(' OR ');
      const ps = `Get-CimInstance Win32_Process -Filter "${filter}" | ForEach-Object { "$($_.ProcessId)\`t$($_.Name)\`t$($_.CommandLine)" }`;
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 12000, windowsHide: true }, (err, stdout) => {
        if (err || !stdout) return resolve([]);
        resolve(stdout.split(/\r?\n/).filter(Boolean).map((line) => {
          const [pid, name, ...rest] = line.split('\t');
          return { pid: Number.parseInt(pid, 10), name, commandLine: rest.join('\t') };
        }).filter((r) => Number.isInteger(r.pid)));
      });
    } else {
      execFile('ps', ['-o', 'pid=,comm=,args=', '-p', ids.join(',')], { encoding: 'utf8', timeout: 8000 }, (err, stdout) => {
        if (err || !stdout) return resolve([]);
        resolve(stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
          const m = /^(\d+)\s+(\S+)\s+(.*)$/.exec(l);
          return m ? { pid: Number(m[1]), name: m[2], commandLine: m[3] } : null;
        }).filter(Boolean));
      });
    }
  });
}

// Kill only verified leftovers, then clear the file. Never throws.
async function killTrackedOrphans({ pidFile = PID_FILE, execFile = require('node:child_process').execFile, kill = (pid) => process.kill(pid, 9), log = console } = {}) {
  if (!fs.existsSync(pidFile)) return { killed: [], skipped: 0 };
  let entries = [];
  try { entries = parseTrackedPids(fs.readFileSync(pidFile, 'utf8')); } catch (e) { entries = []; }
  let killed = [];
  try {
    if (entries.length) {
      const rows = await queryProcesses(entries.map((e) => e.pid), execFile);
      killed = selectVerifiedPids(entries, rows);
      for (const pid of killed) { try { kill(pid); } catch (e) { /* already gone */ } }
      const skipped = entries.length - killed.length;
      if (killed.length || skipped) {
        log.log(`[Startup] Tracked browser PIDs: ${killed.length} leftover profile browser(s) closed, ${skipped} skipped (gone or no longer a SoftGlaze browser).`);
      }
    }
  } finally {
    try { fs.unlinkSync(pidFile); } catch (e) { /* ignore */ }
  }
  return { killed, skipped: entries.length - killed.length };
}

module.exports = { PID_FILE, parseTrackedPids, selectVerifiedPids, killTrackedOrphans };
