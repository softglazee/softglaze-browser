'use strict';
// The PC's phone-companion identity: an X25519 key pair (Noise static key) and an Ed25519 key pair
// (relay mailbox). Generated once, kept in the Setting table with the secret keys sealed by
// safeStorage (secretStore.seal: DPAPI / Keychain / libsecret). Fails closed: without OS
// encryption nothing is generated or stored, and the companion stays off.
const { P } = require('./protocol');

// store: { read(key, fallback) -> Promise, write(key, value) -> Promise }
// sealer: { seal(text) -> text, open(text) -> text ('' when it cannot be opened) }
async function loadOrCreateIdentity({ store, sealer, key, now = Date.now }) {
  const saved = await store.read(key, null);
  if (saved && typeof saved === 'object' && typeof saved.sealed === 'string') {
    const plain = sealer.open(saved.sealed);
    if (!plain) {
      const e = new Error('The phone pairing keys of this computer cannot be read (the Windows user or its keys changed). Pair your phones again after resetting them in Settings > Phones.');
      e.code = 'MOBILE_KEYS_UNREADABLE';
      throw e;
    }
    const identity = P.importIdentity(JSON.parse(plain));
    if (saved.mailboxId && saved.mailboxId !== identity.mailboxId) throw new Error('Stored phone pairing keys do not match their mailbox.');
    return { identity, created: false, createdAt: saved.createdAt || null };
  }
  const identity = P.generateIdentity();
  const sealed = sealer.seal(JSON.stringify(P.exportIdentity(identity))); // throws without OS encryption
  const createdAt = new Date(now()).toISOString();
  await store.write(key, { v: 1, sealed, mailboxId: identity.mailboxId, createdAt });
  return { identity, created: true, createdAt };
}

// Forget the keys (Reset in Settings > Phones). Every paired phone must pair again.
async function resetIdentity({ store, key }) {
  await store.write(key, null);
}

// Stable id of this PC install for sync stamps and lease holders (what peer.mjs uses).
function pcDeviceId(identity) {
  return `pc-${identity.mailboxId.slice(0, 8)}`;
}

module.exports = { loadOrCreateIdentity, resetIdentity, pcDeviceId };
