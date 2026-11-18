'use strict';
// SMTP through nodemailer. Settings come from SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and
// SMTP_FROM, re-read from config/.env when it changes (env.liveEnv), so the owner's set-smtp script
// takes effect without a restart. Nothing here logs or returns the password.
const crypto = require('node:crypto');
const { liveEnv } = require('../env');

let nodemailer = null;
let cached = { fingerprint: null, transporter: null };
let override = null; // tests: { sendMail(msg) -> Promise<{ messageId }> }

function smtpConfig() {
  const host = liveEnv('SMTP_HOST');
  const user = liveEnv('SMTP_USER');
  const pass = liveEnv('SMTP_PASS');
  const from = liveEnv('SMTP_FROM') || user;
  if (!host || !user || !pass || !from) return null;
  const port = Number(liveEnv('SMTP_PORT') || 465);
  return { host, port, secure: port === 465, user, pass, from };
}

function isConfigured() {
  return Boolean(override) || Boolean(smtpConfig());
}

// What the admin diagnostics may show: never the password or the user's full address.
function publicConfig() {
  if (override) return { configured: true, host: 'test-transport' };
  const c = smtpConfig();
  if (!c) return { configured: false };
  return { configured: true, host: c.host, port: c.port, secure: c.secure, from: c.from };
}

function getTransporter() {
  if (override) return override;
  const c = smtpConfig();
  if (!c) return null;
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(c)).digest('hex');
  if (cached.fingerprint !== fingerprint) {
    if (!nodemailer) nodemailer = require('nodemailer');
    if (cached.transporter && typeof cached.transporter.close === 'function') cached.transporter.close();
    cached = {
      fingerprint,
      transporter: nodemailer.createTransport({
        host: c.host,
        port: c.port,
        secure: c.secure,
        requireTLS: !c.secure,
        auth: { user: c.user, pass: c.pass },
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 30000,
        dnsTimeout: 10000
      })
    };
  }
  return cached.transporter;
}

function fromAddress() {
  const c = smtpConfig();
  return c ? c.from : 'SoftGlaze <no-reply@softglaze.com>';
}

// Drops the cached transporter so the next send builds a fresh one (after a dropped connection).
function resetTransporter() {
  const t = cached.transporter;
  cached = { fingerprint: null, transporter: null };
  if (t && typeof t.close === 'function') { try { t.close(); } catch { /* already closed */ } }
}

// Connection-level failures (the server dropped or never answered the connection). A 5xx reply is
// never transient, whatever the code says.
const TRANSIENT_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNRESET', 'EDNS']);
function isTransient(err) {
  if (!err || !TRANSIENT_CODES.has(err.code)) return false;
  return !(Number(err.responseCode) >= 500);
}

// Quick retries for a send someone is waiting on: 1 s, then 3 s. A retry only starts while the send
// has taken less than RETRY_BUDGET_MS in all, so a slow timeout is not repeated behind an HTTP request.
let retryDelaysMs = [1000, 3000];
const RETRY_BUDGET_MS = 12000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// msg: { to, subject, html, text, replyTo, unsubscribeUrl }. Resolves { messageId }.
// opts.retry: retry transient connection errors (with a fresh transporter) before giving up.
async function sendMail(msg, opts = {}) {
  const started = Date.now();
  const delays = opts.retry ? retryDelaysMs : [];
  for (let i = 0; ; i++) {
    try {
      return await sendOnce(msg);
    } catch (e) {
      if (!isTransient(e)) throw e;
      resetTransporter();
      if (i >= delays.length || Date.now() - started + delays[i] > RETRY_BUDGET_MS) throw e;
      await sleep(delays[i]);
    }
  }
}

async function sendOnce(msg) {
  const t = getTransporter();
  if (!t) { const e = new Error('Email is not configured on this server.'); e.code = 'NOT_CONFIGURED'; throw e; }
  const mail = {
    from: fromAddress(),
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    ...(msg.replyTo ? { replyTo: msg.replyTo } : {})
  };
  if (msg.unsubscribeUrl) {
    // RFC 2369 List-Unsubscribe + RFC 8058 one-click: mail providers POST "List-Unsubscribe=One-Click"
    // to the same URL.
    mail.list = { unsubscribe: { url: msg.unsubscribeUrl, comment: 'Unsubscribe' } };
    mail.headers = { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
  }
  const info = await t.sendMail(mail);
  return { messageId: info && info.messageId ? String(info.messageId) : null };
}

// 5xx SMTP replies and malformed recipients will not succeed on a retry.
function isPermanent(err) {
  if (!err) return false;
  if (err.code === 'NOT_CONFIGURED') return false;
  if (err.code === 'EENVELOPE' || err.code === 'EMESSAGE') return true;
  return Number(err.responseCode) >= 500 && Number(err.responseCode) < 600 && err.code !== 'EAUTH';
}

// Short, secret-free description for the send log.
function describeError(err) {
  if (!err) return 'unknown error';
  const parts = [err.code, err.responseCode, err.response || err.message].filter(Boolean).map(String);
  return parts.join(' ').replace(/\s+/g, ' ').slice(0, 500);
}

function setTransportForTests(t) { override = t; }
function setRetryDelaysForTests(d) { retryDelaysMs = d; }

module.exports = {
  smtpConfig, isConfigured, publicConfig, sendMail, isPermanent, isTransient, describeError, resetTransporter,
  setTransportForTests, setRetryDelaysForTests, getTransporter
};
