'use strict';
// SQLite does not guarantee result column names without AS. CI saw a column come back keyed as
// "passwordHash" with its quotes, so every raw read that uses a column by name must alias it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

function rawSelects(src) {
  return [...src.matchAll(/\$queryRawUnsafe\(\s*[`']\s*(SELECT [\s\S]*?) FROM /g)].map((m) => m[1]);
}

for (const file of ['src/main/database.js', 'src/main/proxySecrets.js', 'test/proxyPasswordSeal.test.js']) {
  test(`${file}: raw SELECT columns are aliased`, () => {
    const selects = rawSelects(read(file));
    assert.ok(selects.length > 0, 'found raw selects');
    for (const sel of selects) {
      const cols = sel.replace(/^SELECT /, '').split(',');
      for (const col of cols) assert.match(col, /\sAS\s/i, `no AS in: ${sel}`);
    }
  });
}
