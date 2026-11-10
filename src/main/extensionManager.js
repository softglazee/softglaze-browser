'use strict';

// Downloads Chrome Web Store extensions as raw .crx (avoiding the store's automation blocks), strips
// the CRX header and unzips to userData/softglaze_extensions/<chromeId> for --load-extension.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { getPrisma } = require('./database');
const { assertAllowedDownloadUrl, hostAllowed, HOSTS } = require('./downloadGuard');

// Cap the download so an oversized redirect target cannot OOM the main process.
const MAX_CRX_BYTES = 128 * 1024 * 1024;
// axios and extract-zip load lazily in downloadAndExtract(): this module is required at boot,
// so a missing optional package must only break CRX install.

// Chrome Web Store IDs are exactly 32 chars from the alphabet a-p (a base-16
// encoding of the public-key hash).
const CHROME_ID_RE = /^[a-p]{32}$/;

// Marks the one-time recommended-extension seeding as done; bump the suffix to seed new defaults.
// A user who deletes a recommended extension does not get it back while the flag stays set.
const SEED_FLAG = 'recommendedExtensionsSeeded_v3';

// The seeder sets isGlobal only on first install, so this one-time pass force-enables recommended
// extensions installed while disabled by default, then locks so later manual disables stick.
// Bump the suffix to re-run it after changing the defaults.
const RECONCILE_FLAG = 'recommendedExtensionsReconciled_v2';

// The SoftGlaze first-party extension. Loaded unpacked (--load-extension) into the
// profiles SoftGlaze launches, and nowhere else.
const SOFTGLAZE_RECORDER_ID = 'ofjommapkklakbolagajoiklgfldhlmp';

// Seeded on first run; IDs are verified against the anonymous CRX endpoint. `enable` sets the default
// isGlobal: on = injected into every profile, off = installed but dormant until the user opts in.
const RECOMMENDED_EXTENSIONS = [
  { chromeId: SOFTGLAZE_RECORDER_ID, name: 'SoftGlaze Screen Recorder', enable: true },
  // Third-party helpers stay opt-in: blockers change page and network behavior (an anti-detect
  // tradeoff) and SwitchyOmega can override the native per-profile proxy.
  { chromeId: 'hlkenndednhfkekhgcdicdfddnkalmdm', name: 'Cookie-Editor', enable: false },
  // uBlock Origin Lite (Raymond Hill), the MV3 uBlock. Until 1.0.26 this was bbdpgcaljkaaigfcomhidmneffjjjfgp,
  // which is "uBlock Origin Scope" (a different extension); it never installed, so nothing to migrate.
  { chromeId: 'ddkjiahejlhfcafbddmgiahcphecmpfh', name: 'uBlock Origin Lite', enable: false },
  { chromeId: 'onoegffbmcddafoabbeicpdebfjonkoj', name: 'Proxy SwitchyOmega 3 (MV3)', enable: false } // MV3 build
];

// Seeded by older builds and must not stay installed; removeRetiredExtensions() removes them once.
// gcaiimgaiohlnlflkjjmcohobkpbbnfi: a third-party vendor's assistant SoftGlaze has no reason to ship.
const RETIRED_EXTENSION_IDS = Object.freeze(['gcaiimgaiohlnlflkjjmcohobkpbbnfi']);
const RETIRED_CLEANUP_FLAG = 'retiredExtensionsRemoved_v1';

function extensionsRoot() {
  return path.join(app.getPath('userData'), 'softglaze_extensions');
}

// Accept a bare 32-char ID or any Chrome Web Store URL and return the id, or null.
function parseChromeId(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (CHROME_ID_RE.test(s)) return s;
  // URL forms: .../detail/<slug>/<id>, .../detail/<id>, ?id=<id>, etc.
  const match = s.match(/[a-p]{32}/);
  return match && CHROME_ID_RE.test(match[0]) ? match[0] : null;
}

// Google's CRX update endpoint; `response=redirect` 302s to the signed package on the CDN. It answers
// 204 No Content (no package) when `prodversion` is below the extension's minimum_chrome_version, so a
// fixed old version (114.0 until 1.0.26) got nothing for uBlock Origin Lite (it needs 122). Ask as the
// Chrome the extension will run in (chromeProdVersion).
function downloadUrlFor(id, prodversion = chromeProdVersion()) {
  return `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${encodeURIComponent(prodversion)}&acceptformat=crx2,crx3&x=id%3D${id}%26uc`;
}

// The newest Chrome profiles launch on: a downloaded Chrome for Testing build (profiles with extensions
// prefer one) or the installed Google Chrome. Without either, the newest version of the fingerprint
// pool (fingerprintGenerator.CHROME_VERSIONS, bumped with each release). deps is for tests.
const PRODVERSION_RE = /^\d{2,4}(\.\d{1,6}){0,3}$/;
function chromeProdVersion(deps = {}) {
  const versions = [];
  const add = (v) => { const s = String(v || '').trim(); if (PRODVERSION_RE.test(s)) versions.push(s); };
  try {
    const listDownloaded = deps.listAvailableBrowsers || (() => require('./browserEngine').listAvailableBrowsers());
    for (const b of listDownloaded() || []) add(b && b.version);
  } catch (e) { /* no downloaded builds */ }
  try {
    const findReal = deps.findRealChrome || (() => require('./browserEngine').findRealChrome());
    const real = findReal();
    add(real && real.version);
  } catch (e) { /* no installed Chrome */ }
  if (!versions.length) {
    const pool = deps.fallbackVersions || require('./fingerprintGenerator').CHROME_VERSIONS;
    for (const v of pool || []) add(v);
  }
  if (!versions.length) return FALLBACK_PRODVERSION;
  const num = (v) => v.split('.').map((n) => Number(n) || 0);
  versions.sort((a, b) => {
    const x = num(a); const y = num(b);
    for (let i = 0; i < 4; i += 1) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0);
    return 0;
  });
  return versions[0];
}
const FALLBACK_PRODVERSION = '149.0.7827.155'; // only if even the fingerprint pool is unreadable

// A .crx is a signature header ("Cr24" magic) followed by a plain ZIP; slice the header off.
// CRX2: [Cr24][u32 ver=2][u32 pubKeyLen][u32 sigLen][pubKey][sig][ZIP]
// CRX3: [Cr24][u32 ver=3][u32 headerLen][protobuf header][ZIP]
function crxToZip(buf) {
  const PK = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // local file header "PK\x03\x04"
  if (buf.length < 16 || buf.toString('ascii', 0, 4) !== 'Cr24') {
    // Not a CRX wrapper; the CDN may have served a plain ZIP.
    const at = buf.indexOf(PK);
    if (at >= 0) return buf.subarray(at);
    throw new Error('Downloaded file is not a valid CRX or ZIP package.');
  }
  const version = buf.readUInt32LE(4);
  let zipStart;
  if (version === 2) {
    const pubKeyLen = buf.readUInt32LE(8);
    const sigLen = buf.readUInt32LE(12);
    zipStart = 16 + pubKeyLen + sigLen;
  } else {
    // CRX3 (version 3) and anything newer use the header-length layout.
    const headerLen = buf.readUInt32LE(8);
    zipStart = 12 + headerLen;
  }
  if (!(zipStart > 0 && zipStart < buf.length)) throw new Error('Malformed CRX header.');
  const zip = buf.subarray(zipStart);
  // Sanity: the slice should start at a ZIP local-file header.
  if (zip.subarray(0, 4).equals(PK)) return zip;
  const at = buf.indexOf(PK);
  if (at >= 0) return buf.subarray(at);
  throw new Error('CRX did not contain a recognizable ZIP payload.');
}

// Reads name + version from the manifest, resolving __MSG_name__ via _locales/<locale>/messages.json.
async function readManifestMeta(dir) {
  let manifest = {};
  try { manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')); }
  catch (e) { return { name: null, version: null }; }

  let name = String(manifest.name || '').trim();
  const version = manifest.version ? String(manifest.version) : null;

  const msg = name.match(/^__MSG_(.+)__$/i);
  if (msg) {
    const key = msg[1];
    const locales = [manifest.default_locale, 'en', 'en_US'].filter(Boolean);
    for (const loc of locales) {
      try {
        const messages = JSON.parse(await fs.readFile(path.join(dir, '_locales', loc, 'messages.json'), 'utf8'));
        const entry = messages[key] || messages[key.toLowerCase()];
        if (entry && entry.message) { name = String(entry.message).trim(); break; }
      } catch (e) { /* try the next locale */ }
    }
  }
  return { name: name || null, version };
}

// A hostile package can carry a symlink entry (extract-zip writes it as-is) or a name that resolves
// outside the folder. Runs as extract-zip's onEntry; throwing aborts the unzip before the write.
function assertSafeZipEntry(entry, destDir) {
  const name = String((entry && entry.fileName) || '');
  const mode = ((Number(entry && entry.externalFileAttributes) || 0) >>> 16) & 0xFFFF;
  if ((mode & 0o170000) === 0o120000) throw new Error(`Refusing symlink entry "${name}" in the extension package.`);
  const root = path.resolve(destDir);
  const target = path.resolve(root, name);
  const rel = path.relative(root, target);
  if (!name || path.isAbsolute(name) || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Refusing entry "${name}" that escapes the extension folder.`);
  }
}

// After extraction: no symlink or junction may exist anywhere under the folder.
async function assertNoLinksUnder(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    const st = await fs.lstat(full);
    if (st.isSymbolicLink()) throw new Error(`Refusing linked path "${ent.name}" in the extension package.`);
    if (st.isDirectory()) await assertNoLinksUnder(full);
  }
}

// Returns { localPath, name, version }.
// deps (tests only): http (an axios stand-in), root, and chromeProdVersion's lookups.
async function downloadAndExtract(chromeId, deps = {}) {
  if (!CHROME_ID_RE.test(chromeId)) throw new Error('Invalid Chrome extension id.');
  let axios, extractZip;
  try {
    axios = deps.http || require('axios');
    extractZip = require('extract-zip');
  } catch (e) {
    throw new Error('Extension downloader is unavailable: the "axios"/"extract-zip" packages are not installed.');
  }
  const root = deps.root || extensionsRoot();
  await fs.mkdir(root, { recursive: true });

  // https-only Google-host allowlist on the URL and every redirect, plus a size cap against OOM.
  const prodversion = chromeProdVersion(deps);
  const startUrl = downloadUrlFor(chromeId, prodversion);
  assertAllowedDownloadUrl(startUrl, HOSTS.crx, 'extension download');
  let resp;
  try {
    resp = await axios.get(startUrl, {
      responseType: 'arraybuffer',
      maxRedirects: 5,
      maxContentLength: MAX_CRX_BYTES,
      maxBodyLength: MAX_CRX_BYTES,
      timeout: 60000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Softglaze' },
      validateStatus: (s) => s >= 200 && s < 400,
      beforeRedirect: (options) => {
        const proto = String(options.protocol || '').toLowerCase();
        if (proto && proto !== 'https:') throw new Error('Refusing a non-https redirect while downloading the extension.');
        const host = String(options.hostname || options.host || '').toLowerCase().replace(/:\d+$/, '');
        if (!hostAllowed(host, HOSTS.crx)) throw new Error(`Refusing extension redirect to untrusted host "${host}".`);
      }
    });
  } catch (e) {
    const status = e && e.response && e.response.status;
    throw new Error(status === 204 || status === 404
      ? 'The Chrome Web Store has no package for that ID.'
      : `Download failed: ${(e && e.message) || 'network error'}.`);
  }

  // 204: the store has no package of this extension for that Chrome version (or no such extension).
  if (resp && resp.status === 204) {
    throw new Error(`The Chrome Web Store has no package of this extension for Chrome ${prodversion}. It may need a newer Chrome: download one on the Browsers page.`);
  }
  const crxBuf = Buffer.from(resp.data || []);
  if (crxBuf.length < 16) throw new Error('Downloaded package was empty or truncated.');
  const zipBuf = crxToZip(crxBuf);

  const destDir = path.join(root, chromeId);
  const tmpZip = path.join(root, `${chromeId}.download.zip`);
  await fs.rm(destDir, { recursive: true, force: true });
  await fs.writeFile(tmpZip, zipBuf);
  try {
    await extractZip(tmpZip, { dir: destDir, onEntry: (entry) => assertSafeZipEntry(entry, destDir) }); // extract-zip needs absolute dir
    await assertNoLinksUnder(destDir);
  } catch (e) {
    await fs.rm(destDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Could not unzip the extension package: ${(e && e.message) || e}.`);
  } finally {
    await fs.rm(tmpZip, { force: true }).catch(() => {});
  }

  // Chromium refuses unpacked extensions containing the reserved _metadata folder (CRX3 signature).
  await fs.rm(path.join(destDir, '_metadata'), { recursive: true, force: true }).catch(() => {});

  if (!fsSync.existsSync(path.join(destDir, 'manifest.json'))) {
    await fs.rm(destDir, { recursive: true, force: true }).catch(() => {});
    throw new Error('The package did not contain a valid manifest.json.');
  }

  const meta = await readManifestMeta(destDir);
  return { localPath: destDir, name: meta.name, version: meta.version };
}

// On an existing record the user's isGlobal toggle is kept; only files, name and version refresh.
async function installById(chromeId, { isGlobal = true, nameFallback = null } = {}) {
  if (!CHROME_ID_RE.test(chromeId)) throw new Error('Invalid Chrome extension id.');
  const { localPath, name, version } = await downloadAndExtract(chromeId);
  const finalName = name || nameFallback || `Extension ${chromeId.slice(0, 8)}`;
  return getPrisma().extension.upsert({
    where: { chromeId },
    create: { name: finalName, chromeId, version: version || null, localPath, isGlobal },
    update: { name: finalName, version: version || null, localPath }
  });
}

// Best-effort and idempotent: present extensions are skipped, and the seed flag is set only once
// the full set is installed, so an offline first launch retries next boot.
async function seedRecommendedExtensions() {
  const db = getPrisma();
  const flag = await db.setting.findUnique({ where: { key: SEED_FLAG } }).catch(() => null);
  if (flag && flag.value === 'true') return { skipped: true };

  let installed = 0, present = 0, failed = 0;
  for (const rec of RECOMMENDED_EXTENSIONS) {
    try {
      const existing = await db.extension.findUnique({ where: { chromeId: rec.chromeId } });
      if (existing) { present++; continue; }
      await installById(rec.chromeId, { isGlobal: rec.enable, nameFallback: rec.name });
      installed++;
      console.log(`[ext-seed] installed ${rec.name} (${rec.enable ? 'enabled' : 'disabled'})`);
    } catch (e) {
      failed++;
      console.warn(`[ext-seed] skipped ${rec.name}: ${(e && e.message) || e}`);
    }
  }

  if (installed + present === RECOMMENDED_EXTENSIONS.length) {
    await db.setting.upsert({ where: { key: SEED_FLAG }, create: { key: SEED_FLAG, value: 'true' }, update: { value: 'true' } }).catch(() => {});
  }
  if (installed || failed) console.log(`[ext-seed] done - ${installed} installed, ${present} present, ${failed} failed`);
  return { installed, present, failed };
}

// seedRecommendedExtensions() never updates isGlobal on an existing row, so this one-time pass
// enables recommended rows left dormant by an older default. RECONCILE_FLAG keeps later manual
// disables intact.
async function reconcileRecommendedExtensions() {
  const db = getPrisma();
  const flag = await db.setting.findUnique({ where: { key: RECONCILE_FLAG } }).catch(() => null);
  if (flag && flag.value === 'true') return { skipped: true };

  const wantIds = RECOMMENDED_EXTENSIONS.filter((r) => r.enable).map((r) => r.chromeId);
  let enabled = 0;
  try {
    const res = await db.extension.updateMany({
      where: { chromeId: { in: wantIds }, isGlobal: false },
      data: { isGlobal: true }
    });
    enabled = (res && res.count) || 0;
  } catch (e) {
    // DB not ready / transient error - leave the flag unset so the next launch retries.
    console.warn(`[ext-reconcile] failed: ${(e && e.message) || e}`);
    return { failed: true };
  }
  await db.setting.upsert({ where: { key: RECONCILE_FLAG }, create: { key: RECONCILE_FLAG, value: 'true' }, update: { value: 'true' } }).catch(() => {});
  if (enabled) console.log(`[ext-reconcile] force-enabled ${enabled} recommended extension(s)`);
  return { enabled };
}

// Global extension folders still on disk, merged into --load-extension; missing folders are skipped.
async function resolveGlobalExtensionDirs() {
  let rows = [];
  try { rows = await getPrisma().extension.findMany({ where: { isGlobal: true } }); }
  catch (e) { return []; }
  const dirs = [];
  for (const row of rows) {
    try {
      if (row.localPath && fsSync.existsSync(path.join(row.localPath, 'manifest.json'))) {
        dirs.push(row.localPath);
      }
    } catch (e) { /* skip unreadable entries */ }
  }
  return dirs;
}

// Deletes only inside the extensions root, never an arbitrary path from the DB.
async function removeExtensionFiles(localPath, extRoot = extensionsRoot()) {
  if (!localPath) return;
  const root = path.resolve(extRoot);
  const resolved = path.resolve(localPath);
  if (resolved === root || !resolved.startsWith(root + path.sep)) return;
  await fs.rm(resolved, { recursive: true, force: true }).catch(() => {});
}

// Removes RETIRED_EXTENSION_IDS once: DB row, folder and leftover zip. The flag is set only when
// every folder is gone, so a locked file or DB error retries next launch. db and root are for tests.
async function removeRetiredExtensions({ db = getPrisma(), root = extensionsRoot() } = {}) {
  const flag = await db.setting.findUnique({ where: { key: RETIRED_CLEANUP_FLAG } }).catch(() => null);
  if (flag && flag.value === 'true') return { skipped: true };

  let removed = 0;
  try {
    for (const chromeId of RETIRED_EXTENSION_IDS) {
      const row = await db.extension.findUnique({ where: { chromeId } });
      if (row) {
        await removeExtensionFiles(row.localPath, root);
        await db.extension.delete({ where: { chromeId } });
        removed++;
      }
      // An interrupted install can leave the folder or zip behind without a row.
      const dir = path.join(root, chromeId);
      await removeExtensionFiles(dir, root);
      await removeExtensionFiles(path.join(root, `${chromeId}.download.zip`), root);
      if (fsSync.existsSync(dir)) {
        throw new Error(`could not delete the files for ${chromeId}`);
      }
    }
  } catch (e) {
    console.warn(`[ext-retire] failed, will retry next launch: ${(e && e.message) || e}`);
    return { removed, failed: true };
  }

  await db.setting.upsert({ where: { key: RETIRED_CLEANUP_FLAG }, create: { key: RETIRED_CLEANUP_FLAG, value: 'true' }, update: { value: 'true' } }).catch(() => {});
  if (removed) console.log(`[ext-retire] removed ${removed} retired extension(s)`);
  return { removed };
}

module.exports = {
  assertSafeZipEntry,
  chromeProdVersion,
  downloadUrlFor,
  downloadAndExtract,
  assertNoLinksUnder,
  RECOMMENDED_EXTENSIONS,
  RETIRED_EXTENSION_IDS,
  SOFTGLAZE_RECORDER_ID,
  parseChromeId,
  installById,
  seedRecommendedExtensions,
  reconcileRecommendedExtensions,
  resolveGlobalExtensionDirs,
  removeExtensionFiles,
  removeRetiredExtensions
};
