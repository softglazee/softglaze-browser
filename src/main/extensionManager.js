'use strict';

// ---------------------------------------------------------------------------
// Softglaze Extension Manager
//
// Downloads Chrome Web Store extensions as raw .crx packages (bypassing the
// store's automation blocks), strips the CRX signature header to expose the
// inner ZIP, and unzips each into userData/softglaze_extensions/<chromeId>.
// browserEngine then mounts the unzipped folders into launched profiles via
// Chromium's --load-extension switch.
// ---------------------------------------------------------------------------
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { getPrisma } = require('./database');
// axios + extract-zip are required lazily inside downloadAndExtract() so a
// missing optional package degrades CRX install instead of bricking app startup
// (extensionManager is required at boot by ipcHandlers).

// Chrome Web Store IDs are exactly 32 chars from the alphabet a–p (a base-16
// encoding of the public-key hash).
const CHROME_ID_RE = /^[a-p]{32}$/;

// Setting key that records the one-time recommended-extension seeding has run.
// Bumped to _v2 when the SoftGlaze Screen Recorder was added so existing installs
// seed the new extension once. installById is idempotent (already-present ones are
// skipped), and a user who later deletes a recommended extension won't see it
// return because the (bumped) flag stays set.
const SEED_FLAG = 'recommendedExtensionsSeeded_v2';

// The SoftGlaze first-party extension — always injected into every profile and
// (best-effort) force-installed from the Web Store so active users are counted.
const SOFTGLAZE_RECORDER_ID = 'ofjommapkklakbolagajoiklgfldhlmp';

// Curated set auto-installed on first run. IDs are verified to download from the
// anonymous CRX endpoint. `enable` decides the default isGlobal:
//   • on  → injected into every profile (low-footprint, complementary tools)
//   • off → installed but dormant; user opts in per their anti-detect strategy
//     (content blockers change page/network behavior; SwitchyOmega can override
//     Softglaze's native per-profile proxy).
const RECOMMENDED_EXTENSIONS = [
  { chromeId: SOFTGLAZE_RECORDER_ID, name: 'SoftGlaze Screen Recorder', enable: true },
  { chromeId: 'gcaiimgaiohlnlflkjjmcohobkpbbnfi', name: 'AdsPower Assistant', enable: true },
  { chromeId: 'hlkenndednhfkekhgcdicdfddnkalmdm', name: 'Cookie-Editor', enable: true },
  { chromeId: 'cjpalhdlnbpafiamejdnhcphjbkeiagm', name: 'uBlock Origin', enable: false },
  { chromeId: 'padekgcemlokbadohgkifijomclgjgif', name: 'Proxy SwitchyOmega', enable: false }
];

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

// The Google-internal CRX endpoint. `response=redirect` bounces us to the real
// signed package on the CDN; axios follows the redirect automatically.
function downloadUrlFor(id) {
  return `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=114.0&acceptformat=crx2,crx3&x=id%3D${id}%26uc`;
}

// CRX → ZIP. A .crx is a small signature header ("Cr24" magic) followed by a
// standard ZIP. We slice off the header so any ordinary unzip can read it.
//   CRX2: [Cr24][u32 ver=2][u32 pubKeyLen][u32 sigLen][pubKey][sig][ZIP]
//   CRX3: [Cr24][u32 ver=3][u32 headerLen][protobuf header][ZIP]
function crxToZip(buf) {
  const PK = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // local file header "PK\x03\x04"
  if (buf.length < 16 || buf.toString('ascii', 0, 4) !== 'Cr24') {
    // Not a CRX wrapper — maybe the CDN already handed us a plain ZIP.
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

// Resolve a human-readable name + version from the unzipped manifest, including
// localized __MSG_name__ tokens via _locales/<locale>/messages.json.
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

// Download a CRX by id, strip its header, and unzip it into a named folder.
// Returns { localPath, name, version }.
async function downloadAndExtract(chromeId) {
  if (!CHROME_ID_RE.test(chromeId)) throw new Error('Invalid Chrome extension id.');
  let axios, extractZip;
  try {
    axios = require('axios');
    extractZip = require('extract-zip');
  } catch (e) {
    throw new Error('Extension downloader is unavailable: the "axios"/"extract-zip" packages are not installed.');
  }
  const root = extensionsRoot();
  await fs.mkdir(root, { recursive: true });

  let resp;
  try {
    resp = await axios.get(downloadUrlFor(chromeId), {
      responseType: 'arraybuffer',
      maxRedirects: 5,
      timeout: 60000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Softglaze' },
      validateStatus: (s) => s >= 200 && s < 400
    });
  } catch (e) {
    const status = e && e.response && e.response.status;
    throw new Error(status === 204 || status === 404
      ? 'The Chrome Web Store has no package for that ID.'
      : `Download failed: ${(e && e.message) || 'network error'}.`);
  }

  const crxBuf = Buffer.from(resp.data);
  if (crxBuf.length < 16) throw new Error('Downloaded package was empty or truncated.');
  const zipBuf = crxToZip(crxBuf);

  const destDir = path.join(root, chromeId);
  const tmpZip = path.join(root, `${chromeId}.download.zip`);
  await fs.rm(destDir, { recursive: true, force: true });
  await fs.writeFile(tmpZip, zipBuf);
  try {
    await extractZip(tmpZip, { dir: destDir }); // extract-zip needs absolute dir
  } catch (e) {
    await fs.rm(destDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Could not unzip the extension package: ${(e && e.message) || e}.`);
  } finally {
    await fs.rm(tmpZip, { force: true }).catch(() => {});
  }

  // Chromium refuses to load unpacked extensions that contain the reserved
  // "_metadata" folder (the CRX3 signature payload). Strip it so the unpacked
  // load stays clean.
  await fs.rm(path.join(destDir, '_metadata'), { recursive: true, force: true }).catch(() => {});

  if (!fsSync.existsSync(path.join(destDir, 'manifest.json'))) {
    await fs.rm(destDir, { recursive: true, force: true }).catch(() => {});
    throw new Error('The package did not contain a valid manifest.json.');
  }

  const meta = await readManifestMeta(destDir);
  return { localPath: destDir, name: meta.name, version: meta.version };
}

// Download + unzip an extension and persist (or refresh) its DB record. Used by
// the install IPC handler and the recommended-set seeder. On an existing record
// the user's isGlobal toggle is preserved; only the files/name/version refresh.
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

// One-time, best-effort install of the recommended team extensions. Idempotent:
// already-present extensions are skipped, and the run only locks (sets the seed
// flag) once the full set is in place — so an offline first launch simply retries
// on the next boot instead of permanently skipping the seed.
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
  if (installed || failed) console.log(`[ext-seed] done — ${installed} installed, ${present} present, ${failed} failed`);
  return { installed, present, failed };
}

// All currently-global extension folders that still exist on disk. Passed to the
// browser engine at launch and merged into --load-extension. Missing folders are
// skipped (an extension can be deleted off disk without breaking a launch).
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

// Remove an extension's unzipped folder. Guarded so we only ever delete inside
// our own extensions root, never an arbitrary path from the DB.
async function removeExtensionFiles(localPath) {
  if (!localPath) return;
  const root = path.resolve(extensionsRoot());
  const resolved = path.resolve(localPath);
  if (resolved === root || !resolved.startsWith(root + path.sep)) return;
  await fs.rm(resolved, { recursive: true, force: true }).catch(() => {});
}

module.exports = {
  CHROME_ID_RE,
  RECOMMENDED_EXTENSIONS,
  SOFTGLAZE_RECORDER_ID,
  extensionsRoot,
  parseChromeId,
  downloadAndExtract,
  installById,
  seedRecommendedExtensions,
  resolveGlobalExtensionDirs,
  removeExtensionFiles
};
