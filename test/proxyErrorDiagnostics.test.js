'use strict';
// Regression tests for proxy-check error diagnostics.
//
// Background: a health check that failed recorded only lastStatus='fail'. httpGetJson
// drained the non-2xx body unread and rejected with a fixed "IP service returned HTTP
// <n>." string, so Apify answering 403 "Monthly usage hard limit exceeded" surfaced as
// a bare 403 blamed on ipinfo.io / ip-api.com, the opposite of where the fault was. The
// reason was then dropped on the way to the DB, so after a reload the pool showed a red
// badge with nothing behind it.
//
// These read the real source rather than duplicating it, so they fail if the shipped
// logic changes. Nothing here opens a socket.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `could not find function ${name} in source`);
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

function extractConst(source, name) {
  const m = new RegExp(`^const ${name}\\s*=\\s*[^;]+;`, 'm').exec(source);
  return m ? m[0] : '';
}

function evalFunction(source, name, deps = []) {
  const ctx = { module: {}, exports: {} };
  vm.createContext(ctx);
  const preamble = deps.map((d) => extractConst(source, d)).filter(Boolean).join('\n');
  vm.runInContext(`${preamble}\n${extractFunction(source, name)}; module.exports = ${name};`, ctx);
  return ctx.module.exports;
}

const IPC = SRC('main/ipcHandlers.js');

// --- 1) the gateway is named, and its own reason survives -------------------

test('a proxy gateway 403 is attributed to the PROXY and carries its message', () => {
  const describe = evalFunction(IPC, 'describeGatewayError', ['PROXY_ERROR_BODY_LIMIT']);
  const msg = describe(403, { server: 'Apify Proxy', 'x-apify-proxy-error': 'true' },
    'Monthly usage hard limit exceeded');
  assert.match(msg, /Apify Proxy/, 'the gateway that answered must be named');
  assert.match(msg, /Monthly usage hard limit exceeded/, 'the gateway reason must survive');
  assert.doesNotMatch(msg, /IP service/, 'a gateway refusal must not be blamed on the IP service');
});

test('an x-*-proxy-error header alone is enough to attribute it to the proxy', () => {
  const describe = evalFunction(IPC, 'describeGatewayError', ['PROXY_ERROR_BODY_LIMIT']);
  const msg = describe(407, { 'x-some-proxy-error': '1' }, 'Invalid password provided.');
  assert.match(msg, /Proxy gateway/, 'no server header, but the proxy flag still identifies it');
  assert.match(msg, /Invalid password provided/);
});

test('a genuine IP-service failure is still attributed to the IP service', () => {
  const describe = evalFunction(IPC, 'describeGatewayError', ['PROXY_ERROR_BODY_LIMIT']);
  assert.match(describe(500, { server: 'nginx' }, ''), /IP service returned HTTP 500/);
});

test('an HTML error body is flattened and bounded', () => {
  const describe = evalFunction(IPC, 'describeGatewayError', ['PROXY_ERROR_BODY_LIMIT']);
  const msg = describe(403, { server: 'Apify Proxy' }, '<html><body>\n  Denied   by\n policy </body></html>');
  assert.match(msg, /Denied by policy/, 'markup stripped and whitespace collapsed');
  assert.doesNotMatch(msg, /</, 'no raw markup may reach a toast or a title attribute');

  const limit = Number((/const PROXY_ERROR_BODY_LIMIT = (\d+);/.exec(IPC) || [])[1]);
  assert.ok(limit > 0, 'PROXY_ERROR_BODY_LIMIT must exist');
  const huge = describe(403, { server: 'Apify Proxy' }, 'x'.repeat(limit * 4));
  assert.ok(huge.length < limit * 2, 'a huge body must not be pasted wholesale into the message');
});

// --- 2) credentials never reach a stored or rendered message ----------------

test('proxy credentials are scrubbed out of an error message', () => {
  const scrub = evalFunction(IPC, 'scrubProxySecrets');
  const proxy = { username: 'groups-RESIDENTIAL,session-2ebcxsk2', password: 'apify_proxy_SECRETVALUE123' };

  const withUrl = scrub('connect ECONNREFUSED http://groups-RESIDENTIAL,session-2ebcxsk2:apify_proxy_SECRETVALUE123@proxy.apify.com:8000', proxy);
  assert.doesNotMatch(withUrl, /SECRETVALUE123/, 'the password must not survive in a persisted message');
  assert.match(withUrl, /proxy\.apify\.com:8000/, 'the useful part of the error must survive');

  assert.doesNotMatch(scrub('password apify_proxy_SECRETVALUE123 rejected', proxy), /SECRETVALUE123/,
    'a credential outside a URL must be scrubbed too');

  assert.equal(scrub('Apify Proxy returned HTTP 403: Monthly usage hard limit exceeded', proxy),
    'Apify Proxy returned HTTP 403: Monthly usage hard limit exceeded',
    'a clean message must pass through untouched');
});

// --- 3) the reason is actually persisted, and cleared on success ------------

test('persistProxyHealth stores the failure reason and clears it on success', () => {
  const src = extractFunction(IPC, 'persistProxyHealth');
  assert.match(src, /lastError:/, 'the reason must be written, not dropped on the floor');
  assert.match(src, /result\.success \? null :/,
    'a passing check must CLEAR lastError, or a stale reason outlives the failure that caused it');
});

test('serializeProxy exposes lastError to the renderer', () => {
  assert.match(extractFunction(IPC, 'serializeProxy'), /lastError: proxy\.lastError \|\| null/,
    'the pool cannot show a reason the serializer does not send');
});

test('the Proxy model has somewhere to put it', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  assert.match(schema, /lastError\s+String\?/, 'schema must declare Proxy.lastError');
  const mig = path.join(__dirname, '..', 'prisma', 'migrations', '20260911000000_proxy_last_error', 'migration.sql');
  assert.ok(fs.existsSync(mig), 'an existing install needs the ALTER TABLE to gain the column');
  assert.match(fs.readFileSync(mig, 'utf8'), /ALTER TABLE "Proxy" ADD COLUMN "lastError" TEXT;/);
});

// --- 4) the drain-and-discard bug cannot come back --------------------------

test('httpGetJson no longer discards a non-2xx body', () => {
  const src = extractFunction(IPC, 'httpGetJson');
  assert.doesNotMatch(src, /IP service returned HTTP \$\{status\}/,
    'the hardcoded, mis-attributed message must be gone');
  assert.match(src, /describeGatewayError\(status, res\.headers, errBody\)/,
    'the non-2xx path must build its message from the real response');
});
