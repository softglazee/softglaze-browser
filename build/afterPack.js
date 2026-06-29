'use strict';
const path = require('node:path');
const fs = require('node:fs');

// --- Why this hook exists -------------------------------------------------
// electron-builder collects node_modules from the production dependency TREE.
// The GENERATED Prisma client lives at node_modules/.prisma/client, which is not a
// real package in anyone's package.json, so the collector drops it — no files /
// asarUnpack glob brings it back (verified: .prisma is absent from app.asar). At
// runtime @prisma/client then throws "Cannot find module '.prisma/client/default'".
//
// --- Why we copy to resources/node_modules (not app.asar.unpacked) --------
// @prisma/client is loaded with an asar LOGICAL path
// (…/resources/app.asar/node_modules/@prisma/client). Node derives its module
// search paths from that logical path, which include …/resources/node_modules but
// NOT app.asar.unpacked (Electron hides the unpacked detail). So a copy under
// app.asar.unpacked is never found; resources/node_modules IS on the search path.
//
// --- Why we ALSO copy @prisma (the whole scope) ---------------------------
// The generated .prisma/client/default.js in turn requires
// '@prisma/client/runtime/library.js'. That require resolves relative to .prisma's
// OWN location, so @prisma/client must sit BESIDE .prisma in the same node_modules
// tree. We therefore mirror both node_modules/.prisma AND node_modules/@prisma into
// resources/node_modules. The native query engine (query_engine-windows.dll.node)
// lives under .prisma and loads from real disk there — it cannot load from an asar.
// Verified end-to-end: `new PrismaClient()` instantiates from this layout.
exports.default = async function afterPack(context) {
  const projectDir = (context.packager && context.packager.projectDir) || process.cwd();
  const destRoot = path.join(context.appOutDir, 'resources', 'node_modules');
  fs.mkdirSync(destRoot, { recursive: true });

  for (const name of ['.prisma', '@prisma']) {
    const src = path.join(projectDir, 'node_modules', name);
    if (!fs.existsSync(src)) {
      console.warn(`[afterPack] node_modules/${name} not found — run \`prisma generate\` first. Skipping.`);
      continue;
    }
    const dest = path.join(destRoot, name);
    fs.rmSync(dest, { recursive: true, force: true }); // clean any stale copy
    fs.cpSync(src, dest, { recursive: true });
    console.log(`[afterPack] Copied ${name} -> ${dest}`);
  }
};
