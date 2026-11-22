'use strict';
// Template rendering. Placeholders are {{name}}; values are HTML-escaped in the HTML part, newlines
// are dropped from the subject, and an unknown placeholder renders as nothing (the admin API refuses
// to save a template that uses one). The HTML body is wrapped in one plain, table-based layout with
// the footer and, unless the email is essential, the unsubscribe link.

const { EMAIL_LANGS, RTL_LANGS, INTL_LOCALE, HTML_LANG, metaFor } = require('./translations');

const PLACEHOLDERS = Object.freeze([
  'name', 'greeting', 'email', 'trialEndsAt', 'daysLeft', 'plan', 'downloadUrl', 'unsubscribeUrl',
  'supportEmail', 'appName', 'companyName', 'companyAddress', 'code', 'codeMinutes', 'term'
]);
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z]+)\s*\}\}/g;

const escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function fill(str, vars, enc) {
  return String(str || '').replace(PLACEHOLDER_RE, (_, k) => (Object.prototype.hasOwnProperty.call(vars, k) && vars[k] != null ? enc(String(vars[k])) : ''));
}

function unknownPlaceholders(...parts) {
  const out = new Set();
  for (const p of parts) for (const m of String(p || '').matchAll(PLACEHOLDER_RE)) if (!PLACEHOLDERS.includes(m[1])) out.add(m[1]);
  return [...out];
}

// Admin-written HTML goes into real inboxes; refuse what has no place in an email.
function unsafeHtml(html) {
  const s = String(html || '');
  return /<\s*(script|iframe|object|embed|form|input|button|link|meta|base)\b/i.test(s)
    || /\son[a-z]+\s*=/i.test(s)
    || /(href|src)\s*=\s*["']?\s*(javascript|vbscript|data):/i.test(s);
}

function formatDate(d, lang) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  let locale = INTL_LOCALE[lang] || (EMAIL_LANGS.includes(lang) ? lang : 'en-GB');
  try { Intl.DateTimeFormat.supportedLocalesOf([locale]); } catch (e) { locale = 'en-GB'; }
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function firstName(name) {
  const n = String(name || '').trim();
  return n ? n.split(/\s+/)[0].slice(0, 60) : '';
}

function greetingFor(name, lang) {
  const n = firstName(name);
  if (lang === 'es') return n ? `Hola, ${n}:` : 'Hola:';
  const meta = metaFor(lang);
  if (meta && meta.greetingNamed && meta.greetingNoName) return n ? meta.greetingNamed.replace(/\{\{\s*name\s*\}\}/g, () => n) : meta.greetingNoName;
  return n ? `Hi ${n},` : 'Hi there,';
}

const FOOTER = {
  en: { sentBy: (c, e) => `This email was sent by ${c} to ${e}.`, unsub: 'Do not want these emails?', unsubLink: 'Unsubscribe', essential: 'You get this email because this address was entered in the app.', purchase: 'You get this email because this address was used for a purchase on our website.' },
  es: { sentBy: (c, e) => `Este correo lo envía ${c} a ${e}.`, unsub: '¿No quieres recibir estos correos?', unsubLink: 'Darte de baja', essential: 'Recibes este correo porque alguien escribió esta dirección en la aplicación.', purchase: 'Recibes este correo porque esta dirección se usó para una compra en nuestra web.' }
};
// Footer lines of a translated language (translations.js _meta), else English.
function footerFor(lang) {
  if (FOOTER[lang]) return FOOTER[lang];
  const m = metaFor(lang);
  if (!m || !m.sentBy || !m.unsub || !m.unsubLink || !m.essential || !m.purchase) return FOOTER.en;
  return {
    sentBy: (c, e) => m.sentBy.replace(/\{\{\s*company\s*\}\}/g, () => c).replace(/\{\{\s*email\s*\}\}/g, () => e),
    unsub: m.unsub, unsubLink: m.unsubLink, essential: m.essential, purchase: m.purchase
  };
}
// Essential emails sent for a website purchase, not for something typed into the app.
const PURCHASE_KEYS = new Set(['activation_code']);
const essentialLine = (f, key) => (PURCHASE_KEYS.has(key) ? f.purchase : f.essential);

function layout(bodyHtml, { lang, vars, category, key }) {
  const f = footerFor(lang);
  const lines = [escapeHtml(f.sentBy(vars.companyName || 'SoftGlaze', vars.email || ''))];
  if (category === 'essential') lines.push(escapeHtml(essentialLine(f, key)));
  if (category !== 'essential' && vars.unsubscribeUrl) {
    lines.push(`${escapeHtml(f.unsub)} <a href="${escapeHtml(vars.unsubscribeUrl)}" style="color:#4b5563;">${escapeHtml(f.unsubLink)}</a>`);
  }
  if (category === 'marketing' && vars.companyAddress) lines.push(escapeHtml(vars.companyAddress));
  return `<!doctype html>
<html lang="${HTML_LANG[lang] || lang}"${RTL_LANGS.has(lang) ? ' dir="rtl"' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(vars.appName || 'SoftGlaze')}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;">
<tr><td style="padding:24px 28px 8px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:18px;font-weight:700;color:#111827;">${escapeHtml(vars.appName || 'SoftGlaze')}</td></tr>
<tr><td style="padding:8px 28px 24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;">
${bodyHtml}
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;"><tr><td style="padding:16px 28px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#4b5563;">
${lines.join('<br>')}
</td></tr></table>
</td></tr></table>
</body></html>`;
}

function textFooter({ lang, vars, category, key }) {
  const f = footerFor(lang);
  const lines = ['', '--', f.sentBy(vars.companyName || 'SoftGlaze', vars.email || '')];
  if (category === 'essential') lines.push(essentialLine(f, key));
  if (category !== 'essential' && vars.unsubscribeUrl) lines.push(`${f.unsub} ${f.unsubLink}: ${vars.unsubscribeUrl}`);
  if (category === 'marketing' && vars.companyAddress) lines.push(vars.companyAddress);
  return lines.join('\n');
}

// template: { subject, html, text, category, lang }; vars: placeholder values (already formatted).
function renderEmail(template, vars) {
  const lang = EMAIL_LANGS.includes(template.lang) ? template.lang : 'en';
  const category = template.category || 'lifecycle';
  const subject = fill(template.subject, vars, (s) => s).replace(/[\r\n]+/g, ' ').trim().slice(0, 250);
  const key = template.key || null;
  const html = layout(fill(template.html, vars, escapeHtml), { lang, vars, category, key });
  const text = fill(template.text, vars, (s) => s) + '\n' + textFooter({ lang, vars, category, key });
  return { subject, html, text };
}

// Placeholder values for a customer. ctx: { customer, settings, unsubscribeUrl, now, plan, code, codeMinutes, lang }
function varsFor({ customer = {}, settings, unsubscribeUrl = '', now = Date.now(), plan = '', code, codeMinutes, lang } = {}) {
  const email = settings && settings.email ? settings.email : {};
  const l = lang || customer.lang || 'en';
  const trialEnds = customer.trialEndsAt ? new Date(customer.trialEndsAt) : null;
  return {
    name: firstName(customer.name) || (l === 'en' ? 'there' : ''),
    greeting: greetingFor(customer.name, l),
    email: customer.email || '',
    trialEndsAt: formatDate(trialEnds, l),
    daysLeft: trialEnds ? String(Math.max(0, Math.ceil((trialEnds.getTime() - now) / 86400000))) : '',
    plan: plan || (customer.tier ? customer.tier.charAt(0).toUpperCase() + customer.tier.slice(1) : 'Enterprise'),
    downloadUrl: email.downloadUrl || '',
    unsubscribeUrl,
    supportEmail: email.supportEmail || '',
    appName: email.appName || 'SoftGlaze Browser',
    companyName: email.companyName || 'SoftGlaze',
    companyAddress: email.companyAddress || '',
    code: code || '',
    codeMinutes: codeMinutes != null ? String(codeMinutes) : '',
    term: ''
  };
}

module.exports = { PLACEHOLDERS, renderEmail, varsFor, unknownPlaceholders, unsafeHtml, escapeHtml, formatDate, greetingFor };
