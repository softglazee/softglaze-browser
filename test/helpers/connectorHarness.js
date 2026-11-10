'use strict';
// Runs one vendor section of src/main/ipcHandlers.js (which needs electron, so it cannot be required)
// against a stubbed transport. A connector test answers each request from fixtures built from the
// vendor's documented shapes; nothing reaches a provider.

const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const U = require('../../src/main/proxyVendorUtils');

const ROOT = path.join(__dirname, '..', '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');
const locale = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', lang, 'cmpSettingsC.json'), 'utf8'));
const LOCALES = { en: locale('en'), es: locale('es') };

function between(from, to) {
  const a = IPC.indexOf(from);
  const b = IPC.indexOf(to, a + 1);
  if (a < 0 || b <= a) throw new Error(`section ${from} .. ${to} must exist`);
  return IPC.slice(a, b);
}
function fnSrc(name) {
  const m = new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\r?\\n\\}\\r?\\n`).exec(IPC);
  if (!m) throw new Error(`${name} must exist`);
  return m[0];
}

// The shared helpers every connector uses: normCountryCode, clampPoolCount, gatewayPullPlan,
// MINTED_PULL_MAX, LIST_IMPORT_MAX and limitListRows.
const CORE = `${between('function normCountryCode(', '// ---- Apify Residential')}\n${fnSrc('limitListRows')}`;

// A failed request as httpRequestText rejects it: "HTTP <status> <first 200 characters of the body>",
// with the status, Retry-After and the request id on the error.
function httpError(status, body = '', extra = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return Object.assign(new Error(`HTTP ${status} ${text.slice(0, 200).trim()}`.trim()), { status, ...extra });
}

// load({ from, to, names, route, saved }) lifts the section between the two markers and returns the
// named functions plus `calls`, every request made ({ url, method, headers, body, timeoutMs }).
// route(call) returns the reply body (a string or an object, sent as JSON) or throws httpError(...).
// saved maps a provider key to what readSavedProviderCreds would return.
function load({ from, to, names, route, saved = {} }) {
  const calls = [];
  const httpRequestText = async (url, options = {}) => {
    const call = { url, method: options.method || 'GET', headers: options.headers || {}, body: options.body, timeoutMs: options.timeoutMs };
    calls.push(call);
    const out = await route(call);
    return typeof out === 'string' ? out : JSON.stringify(out);
  };
  const logs = [];
  const scoped = {
    ...U,
    httpRequestText,
    crypto: nodeCrypto,
    readSavedProviderCreds: async (p) => saved[String(p || '').toLowerCase()] || null,
    console: { warn: (...a) => logs.push(a.join(' ')), log: () => {}, error: (...a) => logs.push(a.join(' ')) }
  };
  const keys = Object.keys(scoped);
  // eslint-disable-next-line no-new-func
  const api = new Function(...keys, `${CORE}\n${between(from, to)}\nreturn { ${names.join(', ')} };`)(...keys.map((k) => scoped[k]));
  return { ...api, calls, logs };
}

// The provider-API rotation hook and the rotation-link tables (apiRotationProvider, PROVIDER_ROTATORS,
// proxyCanRotate, ROTATION_LINK_TIMEOUT_MS, rotationLinkTimeoutMs, ROTATION_LINK_REFUSALS,
// rotationLinkRefusal), with the vendor rotators stubbed.
function loadRotation() {
  const deps = {
    ...U,
    rotateDataImpulseSticky: async () => ({ ok: true, provider: 'dataimpulse' }),
    rotateProxyUdp: async () => ({ ok: true, provider: 'proxyudp' }),
    rotateSimplyNodeSession: async () => ({ ok: true, provider: 'simplynode' })
  };
  const src = `${fnSrc('isDataImpulseSticky')}\n${between('function apiRotationProvider(', '// Plan stats plus a live geo breakdown')}`;
  const keys = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  return new Function(...keys, `${src}\nreturn { apiRotationProvider, PROVIDER_ROTATORS, proxyCanRotate, ROTATION_LINK_TIMEOUT_MS, rotationLinkTimeoutMs, rotationLinkRefusal };`)(...keys.map((k) => deps[k]));
}

// The PROVIDERS line of a connector in ProxyProviders.jsx.
function providerLine(key) {
  const line = UI.split(/\r?\n/).find((l) => l.includes(`{ key: '${key}',`));
  if (!line) throw new Error(`${key} must be a PROVIDERS entry`);
  return line;
}

module.exports = { ROOT, IPC, UI, LOCALES, U, between, fnSrc, httpError, load, loadRotation, providerLine };
