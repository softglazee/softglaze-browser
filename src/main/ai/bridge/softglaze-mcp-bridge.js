#!/usr/bin/env node
'use strict';
// SoftGlaze MCP stdio bridge: for AI apps that can only start a local command (Claude Desktop's
// claude_desktop_config.json, .mcpb extensions, older clients). It reads MCP JSON-RPC messages from
// stdin, one per line, forwards each to the SoftGlaze app's Streamable HTTP endpoint, and writes the
// replies to stdout. It has no dependencies, so the app can run it with its own executable
// (ELECTRON_RUN_AS_NODE=1) and a .mcpb can ship it as a single file.
//
//   SOFTGLAZE_TOKEN    required: an AI token from the SoftGlaze AI page (sgai_...)
//   SOFTGLAZE_MCP_URL  optional: default http://127.0.0.1:8080/mcp
//
// Everything the bridge logs goes to stderr; stdout carries only MCP messages.
const http = require('node:http');
const https = require('node:https');
const readline = require('node:readline');

const MCP_URL = process.env.SOFTGLAZE_MCP_URL || 'http://127.0.0.1:8080/mcp';
const TOKEN = (process.env.SOFTGLAZE_TOKEN || '').trim();

let sessionId = null;
let protocolVersion = null;
let initializing = null; // promise while the initialize request is in flight
let closing = false;
const pending = new Set();

function log(...args) {
  process.stderr.write(`[softglaze-bridge] ${args.join(' ')}\n`);
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function errorReply(id, message, code = -32000) {
  if (id === undefined || id === null) return;
  write({ jsonrpc: '2.0', id, error: { code, message } });
}

function request(method, body, extraHeaders = {}) {
  const url = new URL(MCP_URL);
  const lib = url.protocol === 'https:' ? https : http;
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/json, text/event-stream',
    ...extraHeaders
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(body);
  }
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  if (protocolVersion) headers['Mcp-Protocol-Version'] = protocolVersion;
  return new Promise((resolve, reject) => {
    const req = lib.request({ method, hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, headers }, resolve);
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

// Reads an SSE stream and emits each event's data as a message.
function pipeSse(res, onMessage) {
  return new Promise((resolve) => {
    let buffer = '';
    let data = [];
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (line === '') {
          if (data.length) {
            const text = data.join('\n');
            data = [];
            try { onMessage(JSON.parse(text)); } catch (e) { log('skipped a malformed event'); }
          }
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''));
        }
      }
    });
    res.on('end', resolve);
    res.on('close', resolve);
    res.on('error', resolve);
  });
}

function readAll(res) {
  return new Promise((resolve) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { text += c; });
    res.on('end', () => resolve(text));
    res.on('error', () => resolve(text));
  });
}

function emitMessages(value, onMessage) {
  if (Array.isArray(value)) value.forEach(onMessage);
  else if (value) onMessage(value);
}

async function forward(message) {
  const isInit = message && message.method === 'initialize';
  if (!isInit && initializing) { try { await initializing; } catch (e) { /* reported below */ } }
  const body = JSON.stringify(message);
  const onMessage = (m) => {
    if (isInit && m && m.result && m.result.protocolVersion) protocolVersion = m.result.protocolVersion;
    write(m);
  };
  let res;
  try {
    res = await request('POST', body);
  } catch (e) {
    errorReply(message.id, `SoftGlaze is not reachable at ${MCP_URL}. Open the SoftGlaze app and switch on SoftGlaze AI. (${e.code || e.message})`);
    return;
  }
  if (isInit && res.headers['mcp-session-id']) sessionId = String(res.headers['mcp-session-id']);
  const type = String(res.headers['content-type'] || '');
  if (res.statusCode === 202) { res.resume(); return; }
  if (res.statusCode === 404 && sessionId && !isInit) {
    res.resume();
    sessionId = null;
    errorReply(message.id, 'The SoftGlaze session ended (the app restarted or AI was switched off). Reconnect the SoftGlaze server in your AI app.');
    return;
  }
  if (type.includes('text/event-stream')) { await pipeSse(res, onMessage); return; }
  const text = await readAll(res);
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = null; }
  if (res.statusCode >= 400) {
    const msg = parsed && (parsed.message || (parsed.error && parsed.error.message)) ? (parsed.message || parsed.error.message) : `HTTP ${res.statusCode}`;
    if (parsed && parsed.jsonrpc && parsed.error && message.id !== undefined) { write({ ...parsed, id: message.id }); return; }
    errorReply(message.id, `SoftGlaze refused the request: ${msg}`);
    return;
  }
  emitMessages(parsed, onMessage);
}

function handleLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try { message = JSON.parse(trimmed); } catch (e) { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
  const messages = Array.isArray(message) ? message : [message];
  for (const m of messages) {
    const p = forward(m).catch((e) => errorReply(m && m.id, `Bridge error: ${e.message}`));
    if (m && m.method === 'initialize') initializing = p;
    pending.add(p);
    p.finally(() => pending.delete(p));
  }
}

async function shutdown() {
  if (closing) return;
  closing = true;
  try { await Promise.race([Promise.allSettled([...pending]), new Promise((r) => setTimeout(r, 2000))]); } catch (e) { /* ignore */ }
  if (sessionId) {
    try { const res = await request('DELETE'); res.resume(); } catch (e) { /* app already gone */ }
  }
  process.exit(0);
}

if (!TOKEN) {
  log('SOFTGLAZE_TOKEN is not set. Create a token on the SoftGlaze AI page and put it in this server\'s env.');
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  if (!TOKEN) {
    try { const m = JSON.parse(line); errorReply(m && m.id, 'SOFTGLAZE_TOKEN is not set. Create a token on the SoftGlaze AI page and add it to this server\'s env.'); } catch (e) { /* ignore */ }
    return;
  }
  handleLine(line);
});
rl.on('close', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
