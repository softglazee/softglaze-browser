'use strict';
// Where a profile's browser data lives on disk, and the two rules that keep a new profile clean:
//   1. A new profile never takes a folder name that was used before. The name always gets a
//      random suffix, and it must be free in the database and on disk. The fingerprint seed also
//      derives from this name, so reusing one would bring back the old fingerprint as well.
//   2. Deleting a profile for good erases its data in every engine's folder.

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

// A folder can stay locked for a moment after the browser exits on Windows, so retry.
const RM_OPTIONS = Object.freeze({ recursive: true, force: true, maxRetries: 8, retryDelay: 400 });

function firefoxDirName(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function profileDataPaths(root, name) {
  return [path.join(root, name), path.join(root, 'firefox', firefoxDirName(name))];
}

async function pathExists(p) {
  try { await fsp.access(p); return true; } catch (e) { return false; }
}

async function folderExists(root, name) {
  for (const p of profileDataPaths(root, name)) {
    if (await pathExists(p)) return true;
  }
  return false;
}

async function uniqueDataDirName({ root, base, isTaken }) {
  for (let i = 0; i < 25; i += 1) {
    const candidate = `${base}-${crypto.randomBytes(3).toString('hex')}`;
    if (!(await isTaken(candidate)) && !(await folderExists(root, candidate))) return candidate;
  }
  return `${base}-${crypto.randomUUID()}`;
}

// Returns { clean, leftover }: leftover lists any path that could not be removed.
async function wipeProfileData(root, name, { rm = fsp.rm } = {}) {
  const leftover = [];
  for (const p of profileDataPaths(root, name)) {
    try { await rm(p, RM_OPTIONS); } catch (e) { /* checked below */ }
    if (await pathExists(p)) leftover.push(p);
  }
  return { clean: leftover.length === 0, leftover };
}

module.exports = { firefoxDirName, profileDataPaths, folderExists, uniqueDataDirName, wipeProfileData };
