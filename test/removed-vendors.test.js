'use strict';
// LumiProxy, Smartproxy.org and kookeey were removed from the supported providers before launch.
// Do not add them back without a new provider review.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const SOURCES = [
  'src/main/ipcHandlers.js',
  'src/main/proxyVendorUtils.js',
  'src/renderer/components/ProxyProviders.jsx',
  'src/renderer/components/QuickGenerateModal.jsx',
  'src/renderer/pages/ProxyPoolPage.jsx',
  'src/renderer/pages/BatchImportPage.jsx',
  'src/renderer/i18n/locales/en/cmpSettingsC.json',
  'src/renderer/i18n/locales/es/cmpSettingsC.json'
];

for (const file of SOURCES) {
  test(`${file} has no removed provider`, () => {
    assert.doesNotMatch(read(file), /lumiproxy|smartproxyorg|smartproxy\.org|smartproxy\.net|kookeey/i);
  });
}

// The separate connector is Decodo, formerly Smartproxy; its key stays smartproxy (1.0.27 backlog 65).
test('the separate Decodo (Smartproxy) connector is unaffected', () => {
  assert.match(read('src/main/ipcHandlers.js'), /smartproxy: fetchSmartproxyPool/);
  assert.match(read('src/renderer/components/ProxyProviders.jsx'), /key: 'smartproxy', name: 'Decodo \(Smartproxy\)'/);
});
