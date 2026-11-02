'use strict';
// Proxy providers page: the provider list scrolls inside the detail card's height, trial tracking
// stays with the Super Admin, and the Account section reads plan, expiry, traffic and balance from
// each vendor's documented account endpoint.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PAGE = read('src/renderer/pages/ProxyProvidersPage.jsx');

test('the provider list scrolls inside the row the detail card sets', () => {
  assert.match(PAGE, /items-start xl:items-stretch/);
  // Size containment keeps the list out of the row height; the list region takes the rest and scrolls.
  assert.match(PAGE, /<Card className="overflow-hidden flex flex-col xl:\[contain:size\] xl:min-h-\[480px\]">/);
  assert.match(PAGE, /<div ref=\{listRef\} className="flex-1 min-h-0 overflow-auto max-h-\[60vh\] xl:max-h-none">/);
  assert.match(PAGE, /<thead className="sticky top-0 /);
  // Columns are unchanged.
  for (const col of ['colProvider', 'colState', 'colPool', 'colKind']) assert.match(PAGE, new RegExp(`t\\('table\\.${col}'\\)`), col);
});
