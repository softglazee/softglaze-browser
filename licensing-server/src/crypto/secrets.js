'use strict';
// AES-256-GCM seal/open for secrets stored at rest (tenant payment keys + tenant
// private signing keys). Keyed by MASTER_KEY. Format: v1:<iv>:<tag>:<ciphertext>.
const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { masterKey } = require('../env');

function seal(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

function open(sealed) {
  const [v, ivB, tagB, ctB] = String(sealed).split(':');
  if (v !== 'v1') throw new Error('Unsupported sealed value.');
  const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
}

function sealJson(obj) { return seal(JSON.stringify(obj)); }
function openJson(sealed) { return JSON.parse(open(sealed)); }

module.exports = { seal, open, sealJson, openJson };
