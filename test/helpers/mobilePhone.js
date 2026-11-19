'use strict';
// A phone for tests: the phone side of the protocol built only from @softglaze/protocol (the same
// vendored bundle the desktop uses) and `ws`. It pairs from the QR text, links, opens Noise IK
// sessions, sends commands, and opens sealed envelopes, like the SoftGlaze phone app's relay client.
// Also: startLocalRelay() runs the real relay from the SoftGlaze-Mobile repository as a child process.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createInterface } = require('node:readline');
const WebSocket = require('ws');
const { P } = require('../../src/main/mobile/protocol');

const MOBILE_REPO = process.env.SG_MOBILE_REPO || 'D:/SoftGlaze-Mobile';
const RELAY_DIR = path.join(MOBILE_REPO, 'relay');

function relayAvailable() {
  return fs.existsSync(path.join(RELAY_DIR, 'dist', 'main.js')) && fs.existsSync(path.join(RELAY_DIR, 'node_modules'))
    && fs.existsSync(path.join(MOBILE_REPO, 'packages', 'protocol', 'dist', 'index.js'));
}

async function startLocalRelay(env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-desktop-relay-'));
  const log = [];
  const proc = spawn(process.execPath, [path.join(RELAY_DIR, 'dist', 'main.js')], {
    cwd: RELAY_DIR,
    env: { ...process.env, RELAY_PORT: '0', RELAY_BIND: '127.0.0.1', RELAY_PUBLIC_HOST: '127.0.0.1', RELAY_DATA_DIR: dataDir, RELAY_LOG_LEVEL: 'debug', RELAY_CONNECTS_PER_IP_PER_MIN: '1000', ...env }
  });
  proc.stderr.on('data', (d) => log.push(String(d)));
  const port = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`relay did not start: ${log.join('').slice(0, 500)}`)), 15000);
    createInterface({ input: proc.stdout }).on('line', (l) => {
      log.push(l);
      const m = /"event":"relay.listening".*"port":(\d+)/.exec(l);
      if (m) { clearTimeout(t); resolve(Number(m[1])); }
    });
    proc.on('exit', (code) => { clearTimeout(t); reject(new Error(`relay exited ${code}: ${log.join('\n').slice(0, 800)}`)); });
  });
  return {
    port,
    url: `ws://127.0.0.1:${port}/v1`,
    host: '127.0.0.1',
    log,
    dataDir,
    async stop() {
      proc.kill();
      await new Promise((r) => setTimeout(r, 200));
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

class TestPhone {
  constructor({ url, host = '127.0.0.1', name = 'Test Phone', identity = P.generateIdentity() }) {
    this.url = url;
    this.host = host;
    this.identity = identity;
    this.device = { name, platform: 'android', appVersion: '1.0.0' };
    this.frames = [];
    this.waiters = [];
    this.messages = []; // opened inner messages from the PC
    this.msgWaiters = [];
    this.session = null;
    this.pc = null; // { mailboxId, dhPub }
    this.seen = new P.SeenCache();
    this.n = 0;
    this.errors = [];
  }

  async connect() {
    this.frames = [];
    this.ws = new WebSocket(this.url);
    this.ws.on('message', (d) => this._onFrame(JSON.parse(String(d))));
    this.ws.on('error', () => {});
    const ch = await this.waitFrame((f) => f.t === 'challenge');
    this.ws.send(JSON.stringify(P.buildAuthFrame(this.identity, ch.nonce, 'phone', this.host)));
    return this.waitFrame((f) => f.t === 'ready' || f.t === 'error');
  }

  _onFrame(f) {
    if (f.t === 'msg' && !f.ticket && this.pc) {
      try {
        const env = P.fromBase64Url(f.env);
        const kind = P.peekEnvelope(env).kind;
        let msg = null;
        if (kind === P.EnvelopeKind.SessionResp) {
          if (this.pendingSession) { this.session = this.pendingSession.finish(env); this.pendingSession = null; this._emitFrame({ t: 'session' }); }
        } else if (kind === P.EnvelopeKind.Session) {
          msg = this.session.open(env, { seen: this.seen });
        } else if (kind === P.EnvelopeKind.Sealed) {
          msg = P.openSealed({ recipient: this.identity, envelope: env, seen: this.seen, resolveSender: (kid) => (kid === P.keyId(this.pc.dhPub) ? this.pc.dhPub : null) }).message;
          msg = { ...msg, sealed: true };
        }
        if (f.qid && f.qid !== 'live') this.ws.send(JSON.stringify({ t: 'got', qid: f.qid }));
        if (msg) {
          this.messages.push(msg);
          this.msgWaiters = this.msgWaiters.filter((w) => (w.pred(msg) ? (w.resolve(msg), false) : true));
        }
      } catch (e) {
        this.errors.push(e);
      }
      return;
    }
    this._emitFrame(f);
  }

  _emitFrame(f) {
    this.frames.push(f);
    this.waiters = this.waiters.filter((w) => (w.pred(f) ? (w.resolve(f), false) : true));
  }

  waitFrame(pred, ms = 5000) {
    const hit = this.frames.find(pred);
    if (hit) { this.frames.splice(this.frames.indexOf(hit), 1); return Promise.resolve(hit); }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('phone waitFrame timed out')), ms);
      this.waiters.push({ pred, resolve: (f) => { clearTimeout(t); const i = this.frames.indexOf(f); if (i >= 0) this.frames.splice(i, 1); resolve(f); } });
    });
  }

  waitMessage(pred, ms = 5000) {
    const hit = this.messages.find(pred);
    if (hit) { this.messages.splice(this.messages.indexOf(hit), 1); return Promise.resolve(hit); }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`phone waitMessage timed out (have: ${this.messages.map((m) => m.type).join(',')}; errors: ${this.errors.map((e) => e.code || e.message).join(',')})`)), ms);
      this.msgWaiters.push({ pred, resolve: (m) => { clearTimeout(t); const i = this.messages.indexOf(m); if (i >= 0) this.messages.splice(i, 1); resolve(m); } });
    });
  }

  send(frame) { this.ws.send(JSON.stringify(frame)); }
  nextId() { return `p${++this.n}`; }

  // Scans the QR text, runs the handshake, returns the 6-digit code the phone shows.
  async pair(qrText) {
    const payload = P.decodePairingPayload(qrText);
    const start = P.startPairing({ payload, identity: this.identity, device: this.device });
    this.send({ t: 'pair_send', id: this.nextId(), ticket: start.pairingId, env: P.toBase64Url(start.envelope) });
    const ack = await this.waitFrame((f) => f.t === 'ack');
    if (ack.status !== 'delivered') throw new Error(`pair_send ${ack.status} ${ack.reason}`);
    const reply = await this.waitFrame((f) => f.t === 'msg' && f.ticket === start.pairingId);
    const r = start.finish(P.fromBase64Url(reply.env));
    this.session = r.session;
    this.pc = { mailboxId: payload.pcMailboxId, dhPub: payload.pcDhPub };
    return r.sas;
  }

  link() { this.send({ t: 'link', peer: this.pc.mailboxId }); }

  // A fresh Noise IK session (what the phone does after every reconnect).
  async openSession() {
    const s = P.startSession({ identity: this.identity, peerDhPub: this.pc.dhPub });
    this.pendingSession = s;
    await this.sendEnv(s.envelope);
    await this.waitFrame((f) => f.t === 'session');
    return this.session;
  }

  async sendEnv(env) {
    const id = this.nextId();
    this.send({ t: 'send', id, to: this.pc.mailboxId, env: P.toBase64Url(env) });
    return this.waitFrame((f) => f.t === 'ack' && f.id === id);
  }

  async command(body, { sealed = false } = {}) {
    const msg = P.createMessage('command', body);
    const env = sealed ? P.sealTo({ sender: this.identity, recipientDhPub: this.pc.dhPub, message: msg }) : this.session.seal(msg);
    const ack = await this.sendEnv(env);
    return { msg, ack };
  }

  async result(cmd, ms = 8000) {
    return this.waitMessage((m) => m.type === 'result' && m.body.re === cmd.msg.id, ms);
  }

  async close() {
    if (!this.ws) return;
    const ws = this.ws;
    this.ws = null;
    await new Promise((r) => { ws.once('close', r); ws.close(); setTimeout(r, 500); });
    await new Promise((r) => setTimeout(r, 50));
  }
}

module.exports = { TestPhone, startLocalRelay, relayAvailable, MOBILE_REPO };
