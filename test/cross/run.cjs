#!/usr/bin/env node
'use strict';
// Runs the cross test (liveDesktop.cross.test.ts) with the SoftGlaze-Mobile phone app's own jest
// and jest-expo setup, so the phone code is compiled exactly as in its own tests. The phone
// repository is only read. SG_MOBILE_REPO picks it (default D:/sgm-live). Not part of npm test:
// it needs the phone app's node_modules, the built protocol package and the built relay.
//
// Jest only finds tests under its rootDir, so rootDir is this folder; the preset, the module
// folders and the "@/" alias point into the phone app.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const mobile = path.resolve(process.env.SG_MOBILE_REPO || 'D:/sgm-live');
const app = path.join(mobile, 'app');
const jestBin = path.join(app, 'node_modules', 'jest', 'bin', 'jest.js');
if (!fs.existsSync(jestBin)) {
  console.error(`No phone app jest at ${jestBin} (run npm ci in ${app}).`);
  process.exit(2);
}
const appJest = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).jest;
const slash = (p) => p.replace(/\\/g, '/');
// The jest-expo preset, expanded here (its paths are already absolute into the phone app).
const { createRequire } = require('node:module');
const preset = createRequire(path.join(app, 'package.json'))('jest-expo/jest-preset');
const { preset: _unused, ...own } = appJest;
const config = {
  ...preset,
  ...own,
  rootDir: __dirname,
  moduleDirectories: ['node_modules', slash(path.join(app, 'node_modules'))],
  moduleNameMapper: {
    ...preset.moduleNameMapper,
    '^@/assets/(.*)$': `${slash(app)}/assets/$1`,
    '^@/(.*)$': `${slash(app)}/src/$1`,
  },
  testMatch: undefined,
  testRegex: 'cross\\.test\\.ts$',
};
const r = spawnSync(process.execPath, [jestBin, '--config', JSON.stringify(config), '--runInBand', ...process.argv.slice(2)], {
  cwd: app,
  stdio: 'inherit',
  env: { ...process.env, SG_MOBILE_REPO: mobile },
});
process.exit(r.status == null ? 1 : r.status);
