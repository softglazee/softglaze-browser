// Generate the Firefox extension's widget from the single source of truth
// (src/main/personaAutofill.js). The SAME bootstrap that Chromium injects via
// puppeteer is written out as sg-widget.js, so the autofill behavior (form
// detection, field matching, human typing, Shadow-DOM UI) never forks between
// engines. sg-bridge.js provides the window.__sgPersona* surface it expects.
//
//   npm run build:firefox-ext
//
// The output IS committed so the unpacked dev-launch path works without a build
// step; re-run this whenever personaAutofill.js changes (and before signing).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { buildAutofillBootstrap } = require(resolve(here, '../src/main/personaAutofill.js'));

const out = resolve(here, '../src/firefox-extension/sg-widget.js');
const header =
  '/* GENERATED from src/main/personaAutofill.js — DO NOT EDIT.\n' +
  '   Run `npm run build:firefox-ext` to regenerate. */\n';
writeFileSync(out, header + buildAutofillBootstrap() + '\n');
console.log('Wrote ' + out);
