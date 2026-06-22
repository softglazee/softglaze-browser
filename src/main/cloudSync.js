'use strict';
// ---------------------------------------------------------------------------
// Softglaze Enterprise — End-to-End Encrypted Cloud Sync Engine  (FOUNDATION)
//
// Zero-knowledge boundary: profile state (cookies, localStorage, fingerprint
// config) is serialized and encrypted LOCALLY with a key derived from the user's
// master password BEFORE any byte leaves the device. The remote bucket only ever
// stores opaque ciphertext + a salt/iv envelope — it can never read the contents.
//
// What is real here: the crypto envelope + serialization (so the security
// boundary is concrete and testable). What is stubbed: the remote transport
// (`pushEnvelope`/`pullEnvelope`) — wire these to your bucket/API when the cloud
// tier ships. Every method is defensive and never throws raw transport errors at
// the caller.
// ---------------------------------------------------------------------------
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

  // Derive (and cache for the session) a 32-byte master key from the user's
  // password. The salt is the user's workspace salt so the key is stable across
  // devices for the same account, yet never leaves as plaintext.
  async deriveMasterKey(password, workspaceSalt) {
    if (!password) throw new Error('A master password is required to derive the sync key.');
    const salt = Buffer.isBuffer(workspaceSalt) ? workspaceSalt : Buffer.from(String(workspaceSalt || 'softglaze'), 'utf8');
    this._masterKey = await scrypt(String(password), salt, 32);
    return true;
  }

  // Serialize the syncable surface of a profile into a single plain object. This
  // is the canonical shape that gets encrypted — keep it explicit so we never
  // accidentally ship a field we didn't mean to.
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
    if (!this._masterKey) throw new Error('Master key not derived — call deriveMasterKey() first.');
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

  // Inverse of encryptPayload — decrypts an envelope back to the original object.
  decryptPayload(envelope) {
    if (!this._masterKey) throw new Error('Master key not derived — call deriveMasterKey() first.');
    if (!envelope || envelope.v !== 1) throw new Error('Unrecognized sync envelope.');
    const salt = Buffer.from(envelope.salt, 'base64');
    const iv = Buffer.from(envelope.iv, 'base64');
    const subKey = crypto.hkdfSync('sha256', this._masterKey, salt, Buffer.from('sgz-sync'), 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(subKey), iv);
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const out = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
    return JSON.parse(out.toString('utf8'));
  }

  // Push a profile's encrypted state to the remote bucket. Encryption happens
  // here, locally, BEFORE the transport sees anything — the bucket only stores the
  // opaque envelope. Returns { ok, skipped? , error? }.
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

  // Pull + decrypt a profile's state from the remote bucket.
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

module.exports = { CloudSyncEngine };
