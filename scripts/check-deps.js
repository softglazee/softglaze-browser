'use strict';
/* eslint-disable no-console */
// ---------------------------------------------------------------------------
// Softglaze — dependency drift checker
//
// Scans src/** for every `require('pkg')`, `import … from 'pkg'`, bare
// `import 'pkg'`, dynamic `import('pkg')` and `export … from 'pkg'`, then fails
// (exit 1) if any imported package is not declared in package.json
// dependencies/devDependencies.
//
// This catches the class of bug Phase 0 fixed: a package that only works
// because it happens to sit in an unsaved local node_modules, and would crash a
// fresh `git clone && npm install`.
//
// Ignored specifiers: Node core builtins (with or without the `node:` prefix),
// relative/absolute paths (./ ../ /), and the package's own name. No third-party
// deps — runs on a clean checkout before `npm install`.
// ---------------------------------------------------------------------------
const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const SCAN_EXTS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);

// --- load declared dependencies --------------------------------------------
let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
} catch (e) {
  console.error('check:deps — could not read package.json:', e && e.message);
  process.exit(2);
}
const declared = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
  ...Object.keys(pkg.optionalDependencies || {}),
  ...Object.keys(pkg.peerDependencies || {})
]);
const ownName = pkg.name;
const builtins = new Set(builtinModules);

// --- helpers ----------------------------------------------------------------
// Reduce an import specifier to its installable package name, or null if it is
// not a third-party package we should validate.
function toPackageName(spec) {
  if (!spec) return null;
  if (spec.startsWith('node:')) return null;             // node:fs, node:crypto …
  if (spec.startsWith('.') || spec.startsWith('/')) return null; // relative / absolute
  if (spec.startsWith('@/')) return null;                // Vite alias '@' → src/renderer
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    if (parts.length < 2 || !parts[1]) return null;      // malformed scoped spec
    return `${parts[0]}/${parts[1]}`;                    // @scope/name
  }
  return spec.split('/')[0];                             // pkg or pkg/subpath
}

// A module specifier is a tight token: letters, digits, _ @ . / -. Restricting
// the capture to that set (no spaces/newlines/punctuation) stops the regex from
// swallowing unrelated code between two quotes. Each capture group 2 is the spec.
const SPEC = "([\\w@./-]+)";
const PATTERNS = [
  new RegExp(`\\brequire\\(\\s*(['"\`])${SPEC}\\1\\s*\\)`, 'g'),          // require('x')
  new RegExp(`\\bimport\\(\\s*(['"\`])${SPEC}\\1\\s*\\)`, 'g'),           // import('x')  (dynamic)
  new RegExp(`\\bimport\\s+[^;'"\`]*?\\bfrom\\s*(['"\`])${SPEC}\\1`, 'g'), // import a from 'x'
  new RegExp(`\\bexport\\s+[^;'"\`]*?\\bfrom\\s*(['"\`])${SPEC}\\1`, 'g'), // export … from 'x'
  new RegExp(`\\bimport\\s*(['"\`])${SPEC}\\1`, 'g')                       // import 'x'  (side-effect)
];

function specifiersIn(source) {
  const found = new Set();
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source)) !== null) {
      if (m[2]) found.add(m[2]);
    }
  }
  return found;
}

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      walk(full, out);
    } else if (ent.isFile() && SCAN_EXTS.has(path.extname(ent.name))) {
      out.push(full);
    }
  }
}

// --- scan -------------------------------------------------------------------
if (!fs.existsSync(SRC_DIR)) {
  console.error(`check:deps — source directory not found: ${SRC_DIR}`);
  process.exit(2);
}

const files = [];
walk(SRC_DIR, files);

const offenders = new Map(); // pkgName -> Set(relative file paths)
let scanned = 0;

for (const file of files) {
  let source;
  try { source = fs.readFileSync(file, 'utf8'); }
  catch (e) { continue; }
  scanned++;
  for (const spec of specifiersIn(source)) {
    const name = toPackageName(spec);
    if (!name) continue;
    if (name === ownName) continue;
    if (builtins.has(name) || builtins.has(spec)) continue;
    if (declared.has(name)) continue;
    if (!offenders.has(name)) offenders.set(name, new Set());
    offenders.get(name).add(path.relative(ROOT, file).replace(/\\/g, '/'));
  }
}

// --- report -----------------------------------------------------------------
if (offenders.size === 0) {
  console.log(`check:deps — OK. Scanned ${scanned} file(s); all imports are declared in package.json.`);
  process.exit(0);
}

console.error(`check:deps — FAIL. ${offenders.size} undeclared package(s) imported under src/:\n`);
for (const [name, where] of [...offenders.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.error(`  • ${name}`);
  for (const f of [...where].sort()) console.error(`      ${f}`);
}
console.error('\nAdd each to package.json "dependencies" (or "devDependencies") and run `npm install`.');
process.exit(1);
