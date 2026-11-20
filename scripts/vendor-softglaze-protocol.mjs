#!/usr/bin/env node
// Vendors @softglaze/protocol (the phone <-> PC protocol shared with the SoftGlaze phone app and the
// relay) into src/main/mobile/vendor/ as ONE CommonJS file, so Electron main can require() it with
// no extra node_modules entries and no ESM loading at runtime. Nothing is reimplemented: the file is
// the package's own built dist/ plus its pinned dependencies (@noble/ciphers, @noble/curves,
// @noble/hashes, valibot), bundled by rolldown (already a dev dependency through vite).
//
// Usage:
//   node scripts/vendor-softglaze-protocol.mjs [--src D:/SoftGlaze-Mobile/packages/protocol] [--build]
//   --build   runs `npm ci && npm run build` in the protocol folder first (otherwise its dist/ must
//             be current: the script refuses when a src/ file is newer than dist/index.js).
// Writes src/main/mobile/vendor/softglaze-protocol.cjs and VENDOR.json (version, source commit,
// dependency versions, sha256), then checks that the bundle loads and exposes the expected API.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const arg = (name, def = null) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const src = resolve(arg('--src', process.env.SG_PROTOCOL_DIR || 'D:/SoftGlaze-Mobile/packages/protocol'));
const outDir = join(root, 'src', 'main', 'mobile', 'vendor');
const outFile = join(outDir, 'softglaze-protocol.cjs');

if (!existsSync(join(src, 'package.json'))) throw new Error(`No protocol package at ${src}`);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
if (process.argv.includes('--build')) {
  execFileSync(npm, ['ci'], { cwd: src, stdio: 'inherit', shell: process.platform === 'win32' });
  execFileSync(npm, ['run', 'build'], { cwd: src, stdio: 'inherit', shell: process.platform === 'win32' });
}
const distIndex = join(src, 'dist', 'index.js');
if (!existsSync(distIndex)) throw new Error('dist/index.js is missing: run with --build');
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const builtAt = statSync(distIndex).mtimeMs;
const stale = walk(join(src, 'src')).filter((f) => statSync(f).mtimeMs > builtAt);
if (stale.length) throw new Error(`dist/ is older than ${stale[0]}: run with --build`);

const pkg = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'));
const depVersions = {};
for (const dep of Object.keys(pkg.dependencies || {})) {
  depVersions[dep] = JSON.parse(readFileSync(join(src, 'node_modules', dep, 'package.json'), 'utf8')).version;
  if (depVersions[dep] !== pkg.dependencies[dep]) throw new Error(`${dep} ${depVersions[dep]} installed, ${pkg.dependencies[dep]} pinned: run with --build`);
}
let commit = null;
let protocolCommit = null; // last commit that changed the protocol folder itself
let dirty = null;
try {
  commit = execFileSync('git', ['-c', `safe.directory=*`, '-C', src, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  protocolCommit = execFileSync('git', ['-c', `safe.directory=*`, '-C', src, 'log', '-1', '--format=%H', '--', '.'], { encoding: 'utf8' }).trim() || null;
  dirty = execFileSync('git', ['-c', `safe.directory=*`, '-C', src, 'status', '--porcelain', '--', '.'], { encoding: 'utf8' }).trim() !== '';
} catch (e) { /* not a git checkout */ }

const { rolldown } = await import('rolldown');
const bundle = await rolldown({ input: distIndex, platform: 'node', treeshake: true, logLevel: 'warn' });
const banner = [
  '// @softglaze/protocol ' + pkg.version + ' (vendored, do not edit: run scripts/vendor-softglaze-protocol.mjs)',
  '// Source: SoftGlaze-Mobile packages/protocol' + (commit ? ` @ ${protocolCommit || commit}${dirty ? ' (with local changes)' : ''}` : ''),
  '// Bundled dependencies (MIT): ' + Object.entries(depVersions).map(([k, v]) => `${k} ${v}`).join(', '),
  '// noble: Copyright (c) Paul Miller (https://paulmillr.com). valibot: Copyright (c) Fabian Hiller.',
].join('\n');
mkdirSync(outDir, { recursive: true });
await bundle.write({ file: outFile, format: 'cjs', banner, sourcemap: false });
await bundle.close();
// Region comments carry the build machine's absolute paths; keep only the package-relative part.
writeFileSync(
  outFile,
  readFileSync(outFile, 'utf8').replace(/^\/\/#(region|endregion) .*?\/(?:packages\/protocol\/(dist\/)|node_modules\/)/gm, (_m, kind, dist) => `//#${kind} ${dist ? 'protocol/dist/' : ''}`),
);

const code = readFileSync(outFile);
const sha256 = createHash('sha256').update(code).digest('hex');
writeFileSync(
  join(outDir, 'VENDOR.json'),
  JSON.stringify({ package: pkg.name, version: pkg.version, sourceCommit: commit, protocolCommit, sourceDirty: dirty, dependencies: depVersions, bundle: 'softglaze-protocol.cjs', sha256, bytes: code.length }, null, 2) + '\n',
);

// Smoke check: loads in plain Node and exposes the API the desktop uses.
const req = createRequire(import.meta.url);
const P = req(outFile);
for (const name of ['generateIdentity', 'PairingOffer', 'acceptSession', 'sealTo', 'openSealed', 'buildAuthFrame', 'checkScope', 'SyncEngine', 'SyncSpaceOwner', 'SyncRelayClient', 'LeaseTable']) {
  if (!P[name]) throw new Error(`vendored bundle is missing ${name}`);
}
console.log(`vendored ${pkg.name} ${pkg.version} -> ${outFile} (${code.length} bytes, sha256 ${sha256.slice(0, 16)}...)`);
