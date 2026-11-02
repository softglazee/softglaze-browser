'use strict';
// E2E encrypted cloud sync (Enterprise): profile state is encrypted locally with a key derived from
// the master password before anything leaves the device; the bucket only ever stores ciphertext.
// The crypto envelope is real; the remote transport is a stub until the cloud tier ships.
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const PBKDF_SALT_LEN = 16;
const IV_LEN = 12;

class CloudSyncEngine {
  constructor(options = {}) {
    // Injected transport so this module never hard-depends on a specific backend.
    //   options.transport.put(key, buffer) -> Promise
    //   options.transport.get(key)         -> Promise<buffer|null>
    this.transport = options.transport || null;
    this.namespace = options.namespace || 'softglaze';
    this._masterKey = null; // derived per-session, never persisted
  }

  // Derive (and cache for the session) a 32-byte key from the password and a required per-workspace
  // random salt. Never fall back to a constant salt: one precomputed scrypt dictionary would then
  // cover every user, and equal passphrases would give equal keys.
  async deriveMasterKey(password, workspaceSalt) {
    if (!password) throw new Error('A master password is required to derive the sync key.');
    if (workspaceSalt === undefined || workspaceSalt === null || workspaceSalt === '') {
      throw new Error('A workspace salt is required to derive the sync key.');
    }
    const salt = Buffer.isBuffer(workspaceSalt) ? workspaceSalt : Buffer.from(String(workspaceSalt), 'utf8');
    this._masterKey = await scrypt(String(password), salt, 32);
    return true;
  }

  // The canonical shape that gets encrypted; keep it explicit so no field ships by accident.
  static serializeProfileState({ cookies = [], localStorage = {}, fingerprint = {} } = {}) {
    return {
      v: 1,
      cookies: Array.isArray(cookies) ? cookies : [],
      localStorage: localStorage && typeof localStorage === 'object' ? localStorage : {},
      fingerprint: fingerprint && typeof fingerprint === 'object' ? fingerprint : {}
    };
  }

  // Encrypt an arbitrary JSON-serializable payload with the session master key.
  // Output is a self-describing envelope: { v, salt, iv, tag, data } (all base64).
  encryptPayload(payload) {
    if (!this._masterKey) throw new Error('Master key not derived - call deriveMasterKey() first.');
    // Per-payload salt mixed into a sub-key so reused master keys never reuse a keystream.
    const salt = crypto.randomBytes(PBKDF_SALT_LEN);
    const iv = crypto.randomBytes(IV_LEN);
    const subKey = crypto.hkdfSync('sha256', this._masterKey, salt, Buffer.from('sgz-sync'), 32);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(subKey), iv);
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
    const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      v: 1,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64')
    };
  }

  decryptPayload(envelope) {
    if (!this._masterKey) throw new Error('Master key not derived - call deriveMasterKey() first.');
    if (!envelope || envelope.v !== 1) throw new Error('Unrecognized sync envelope.');
    const salt = Buffer.from(envelope.salt, 'base64');
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    // Reject off-spec envelopes before decrypting and pin authTagLength: Node accepts short GCM tags,
    // so a hostile bucket could ship a 4-byte tag and cut forgery cost from 2^128 to 2^32.
    if (tag.length !== 16 || iv.length !== IV_LEN || salt.length !== PBKDF_SALT_LEN) {
      throw new Error('Unrecognized sync envelope.');
    }
    const subKey = crypto.hkdfSync('sha256', this._masterKey, salt, Buffer.from('sgz-sync'), 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(subKey), iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
    return JSON.parse(out.toString('utf8'));
  }

  // Encryption happens here, before the transport sees anything. Returns { ok, skipped?, error? }.
  async pushProfileState(profileId, state) {
    try {
      const envelope = this.encryptPayload(CloudSyncEngine.serializeProfileState(state));
      if (!this.transport || typeof this.transport.put !== 'function') {
        return { ok: false, skipped: true, reason: 'No cloud transport configured (local-only build).' };
      }
      await this.transport.put(`${this.namespace}/${profileId}.sgz-env`, Buffer.from(JSON.stringify(envelope)));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e && e.message) || 'Sync push failed.' };
    }
  }

  async pullProfileState(profileId) {
    try {
      if (!this.transport || typeof this.transport.get !== 'function') {
        return { ok: false, skipped: true, reason: 'No cloud transport configured (local-only build).' };
      }
      const raw = await this.transport.get(`${this.namespace}/${profileId}.sgz-env`);
      if (!raw) return { ok: true, state: null };
      const envelope = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw));
      return { ok: true, state: this.decryptPayload(envelope) };
    } catch (e) {
      return { ok: false, error: (e && e.message) || 'Sync pull failed.' };
    }
  }
}

// Every device must derive the key from the same (non-secret) salt, or their ciphertext is mutually
// unreadable. A bucket salt is authoritative; else the local one (minted if absent) is published once.
// On a transport error the local salt is used, so a bucket outage never blocks unlock.
async function resolveWorkspaceSalt(transport, namespace, localSalt, persist) {
  const key = `${namespace}/workspace.salt`;
  const mint = () => crypto.randomBytes(16).toString('base64');
  const save = async (s) => {
    if (typeof persist === 'function') { try { await persist(s); } catch (e) { /* best-effort persist */ } }
  };
  let salt = localSalt || null;
  const usable = transport && typeof transport.get === 'function' && typeof transport.put === 'function';
  if (!usable) {
    if (!salt) { salt = mint(); await save(salt); }
    return salt;
  }
  try {
    const remote = await transport.get(key);
    if (remote) {
      const remoteSalt = (Buffer.isBuffer(remote) ? remote.toString('utf8') : String(remote)).trim();
      if (remoteSalt) {
        if (remoteSalt !== salt) { salt = remoteSalt; await save(salt); }
        return salt;
      }
    }
    // The bucket has no salt yet: publish ours once so future devices converge.
    if (!salt) salt = mint();
    await transport.put(key, Buffer.from(salt, 'utf8'));
    await save(salt);
    return salt;
  } catch (e) {
    // Bucket unreachable: keep the local salt (mint if needed) so unlock still works offline.
    if (!salt) { salt = mint(); await save(salt); }
    return salt;
  }
}

module.exports = { CloudSyncEngine, resolveWorkspaceSalt };
