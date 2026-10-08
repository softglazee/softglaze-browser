'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { siteKeyOf } = require('../src/main/siteKey');

test('subdomains of one site share a site key', () => {
  for (const u of ['https://learn.buildium.com/affiliates/', 'https://www.buildium.com/free-trial/customize/', 'buildium.com', 'learn.buildium.com']) {
    assert.equal(siteKeyOf(u), 'buildium.com', u);
  }
  assert.equal(siteKeyOf('https://www.shop.example.co.uk/x'), 'example.co.uk');
  assert.equal(siteKeyOf('https://my.site.com.au/'), 'site.com.au');
  assert.equal(siteKeyOf('http://127.0.0.1:8799/page2.html'), '127.0.0.1');
});

test('shared hosting keeps each owner separate', () => {
  assert.equal(siteKeyOf('https://alpha.myshopify.com/account'), 'alpha.myshopify.com');
  assert.notEqual(siteKeyOf('https://alpha.myshopify.com/'), siteKeyOf('https://beta.myshopify.com/'));
  assert.equal(siteKeyOf('https://user.github.io/app'), 'user.github.io');
  assert.equal(siteKeyOf('https://myshopify.com/'), 'myshopify.com');
});

test('non-web URLs have no site', () => {
  assert.equal(siteKeyOf('file:///C:/x.html'), '');
  assert.equal(siteKeyOf('about:blank'), '');
  assert.equal(siteKeyOf(''), '');
  assert.equal(siteKeyOf(null), '');
});

test('the Data Vault "already used" filter matches by site, not exact host', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/main/ipcHandlers.js'), 'utf8');
  assert.match(src, /const site = siteKeyOf\(host\) \|\| host;/);
  assert.match(src, /parseUsedOnUrls\(p\.usedOnUrls\)\.some\(\(h\) => h === host \|\| siteKeyOf\(h\) === site\)/);
  const engine = fs.readFileSync(path.join(__dirname, '../src/main/browserEngine.js'), 'utf8');
  assert.match(engine, /const \{ siteKeyOf \} = require\('\.\/siteKey'\);/, 'the active identity uses the same rule');
});
