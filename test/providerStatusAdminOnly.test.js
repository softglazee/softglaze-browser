'use strict';
// The Needs attention and Trials cards are for our own vendor testing. Customers buy their proxies,
// so these stay on a page only the Super Admin can reach, and off the Proxy providers page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const PROVIDERS_PAGE = read('src/renderer/pages/ProxyProvidersPage.jsx');
const STATUS_PAGE = read('src/renderer/pages/ProviderStatusPage.jsx');
const SHELL = read('src/renderer/components/AppShell.jsx');
const STATES = read('src/renderer/lib/providerStates.js');

test('the Proxy providers page no longer shows the two cards', () => {
  assert.doesNotMatch(PROVIDERS_PAGE, /attention\.title|trials\.title/);
});

test('the status page holds both cards and sends everyone else away', () => {
  assert.match(STATUS_PAGE, /attention\.title/);
  assert.match(STATUS_PAGE, /trials\.title/);
  assert.match(STATUS_PAGE, /if \(roleKnown && !isSuper\) return <Navigate to="\/proxy-providers" replace \/>/);
});

test('the menu item shows only for the Super Admin', () => {
  assert.match(SHELL, /path: '\/provider-status'[^\n]*superOnly: true/);
  assert.match(SHELL, /item\.superOnly \? me\?\.role === 'SUPER_ADMIN' : canSee\(item\.featureKey\)/);
});

test('trial state and controls are hidden from everyone but the Super Admin', () => {
  assert.match(STATES, /const trial = \(isSuper && trials\[p\.key\]\) \|\| null;/);
  assert.match(PROVIDERS_PAGE, /!p\.unavailable && isSuper && \(/);
  assert.match(PROVIDERS_PAGE, /isSuper \? \[\['trial', t\('states\.trial'\)\]\] : \[\]/);
});

test('both languages have the page strings', () => {
  for (const lang of ['en', 'es']) {
    const page = JSON.parse(read(`src/renderer/i18n/locales/${lang}/providersPage.json`));
    assert.ok(page.status.title && page.status.description, lang);
    const common = JSON.parse(read(`src/renderer/i18n/locales/${lang}/common.json`));
    assert.ok(common.nav.providerStatus && common.nav.sectionAdmin, lang);
  }
});
