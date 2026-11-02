// Writes sg-widget.js from src/main/personaAutofill.js, the same bootstrap Chromium injects via
// puppeteer, so autofill never forks between engines. Run `npm run build:firefox-ext` after
// changing personaAutofill.js; the output is committed so dev launches need no build.
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
