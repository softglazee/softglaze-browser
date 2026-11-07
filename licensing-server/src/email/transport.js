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

// msg: { to, subject, html, text, replyTo, unsubscribeUrl }. Resolves { messageId }.
async function sendMail(msg) {
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

module.exports = { smtpConfig, isConfigured, publicConfig, sendMail, isPermanent, describeError, setTransportForTests, getTransporter };
