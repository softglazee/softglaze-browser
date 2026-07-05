'use strict';
// Regression tests for the UA / Client-Hints version-coherence guard in
// browserEngine.buildUserAgentBundle.
//
// audit finding (MED-HIGH): the fingerprint generator pins a per-profile Chrome
// version from a fixed pool (capped at 149). The engine used to report THAT pinned
// major in the UA string + Sec-CH-UA regardless of the binary it actually launched.
// On a machine whose real Chrome auto-updated past the pool (150+), the reported
// major (149) then contradicted the real binary's TLS ClientHello / JA4 / HTTP-2
// SETTINGS / JS feature-set — a hard, deterministic bot signal. The guard now clamps
// the reported major AND full version to the actually-launched binary whenever that
// version is readable, honoring the pin only as a fallback when it is not.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildUserAgentBundle } = require('../src/main/browserEngine');

const baseProfile = {
  os: 'Windows',
  osVersion: '11',
  browserBrand: 'Chrome',
  browserVersion: '149.0.7827.155', // pinned from the generator pool
};

// Helper: pull the Chromium/Google-Chrome brand entries out of the CH metadata.
function chromiumBrand(meta) {
  return meta.brands.find((b) => b.brand === 'Chromium' || b.brand === 'Google Chrome');
}
function chromiumFull(meta) {
  return meta.fullVersionList.find((b) => b.brand === 'Chromium' || b.brand === 'Google Chrome');
}

test('THE BUG: pinned 149 but real binary 152 → reports 152, never 149', () => {
  const { userAgent, userAgentMetadata } = buildUserAgentBundle(
    baseProfile, 152, '152.0.8100.60', 12345
  );
  assert.match(userAgent, /Chrome\/152\.0\.0\.0/, 'UA must advertise the real binary major');
  assert.doesNotMatch(userAgent, /149/, 'UA must NOT leak the stale pinned major');
  assert.equal(chromiumBrand(userAgentMetadata).version, '152', 'Sec-CH-UA brand major must match binary');
  assert.equal(chromiumFull(userAgentMetadata).version, '152.0.8100.60', 'full-version-list must be the real build');
});

test('pin matches the real binary → pinned version is honored', () => {
  const { userAgent, userAgentMetadata } = buildUserAgentBundle(
    baseProfile, 149, '149.0.7827.155', 12345
  );
  assert.match(userAgent, /Chrome\/149\.0\.0\.0/);
  assert.equal(chromiumBrand(userAgentMetadata).version, '149');
  assert.equal(chromiumFull(userAgentMetadata).version, '149.0.7827.155');
});

test("blank/'Auto' pin → tracks the real binary (unchanged legacy behavior)", () => {
  for (const v of ['Auto', '', undefined]) {
    const { userAgent, userAgentMetadata } = buildUserAgentBundle(
      { ...baseProfile, browserVersion: v }, 152, '152.0.8100.60', 1
    );
    assert.match(userAgent, /Chrome\/152\.0\.0\.0/, `browserVersion=${JSON.stringify(v)} must track the binary`);
    assert.equal(chromiumBrand(userAgentMetadata).version, '152');
  }
});

test('degraded read (binary version unreadable) → falls back to the pin', () => {
  // realFullVersion='' models browser.version() returning something unparseable; the
  // realMajor fallback (125) is a guess we must NOT report over a usable pin.
  const { userAgent, userAgentMetadata } = buildUserAgentBundle(
    baseProfile, 125, '', 1
  );
  assert.match(userAgent, /Chrome\/149\.0\.0\.0/, 'with no binary read, the pin is the best guess');
  assert.doesNotMatch(userAgent, /125/, 'must not report the internal 125 fallback guess');
  assert.equal(chromiumFull(userAgentMetadata).version, '149.0.7827.155');
});

test('no pin AND no binary read → uses the internal fallback major only as last resort', () => {
  const { userAgent } = buildUserAgentBundle(
    { ...baseProfile, browserVersion: 'Auto' }, 125, '', 1
  );
  assert.match(userAgent, /Chrome\/125\.0\.0\.0/);
});

test('Chromium-brand (Edge) tokens also clamp to the real binary major', () => {
  const { userAgent, userAgentMetadata } = buildUserAgentBundle(
    { ...baseProfile, browserBrand: 'Edge' }, 152, '152.0.8100.60', 7
  );
  // Edge tracks the Chromium major 1:1, and it must be the REAL major (152), not 149.
  assert.match(userAgent, /Chrome\/152\.0\.0\.0/);
  assert.match(userAgent, /Edg\/152\.0\.0\.0/, 'Edg/ token must match the real binary major');
  assert.doesNotMatch(userAgent, /149/);
  const edge = userAgentMetadata.brands.find((b) => b.brand === 'Microsoft Edge');
  assert.ok(edge, 'Edge brand present in Sec-CH-UA');
  assert.equal(edge.version, '152');
});

test('the full version in the UA string is always frozen to <major>.0.0.0 (UA reduction)', () => {
  const { userAgent } = buildUserAgentBundle(baseProfile, 152, '152.0.8100.60', 1);
  // UA reduction: minor/build/patch are .0.0.0 in the UA string; the true build only
  // appears in the full-version-list client hint (asserted above).
  assert.match(userAgent, /Chrome\/152\.0\.0\.0 /);
});
