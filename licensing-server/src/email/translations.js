'use strict';
// Built-in email copy in the languages after English and Spanish (those two live in defaults.js and the
// seed migration). One JSON file per language in ./i18n: "_meta" (salutation and footer lines) and
// { subject, html } per template. The plain-text part is made from the HTML, so the two never drift.
// A template missing from a language's file falls back to English (defaults.js builtIn).
//
// Language codes are what a customer row stores (account/verify.js cleanLang): the two-letter code,
// except Traditional Chinese, which is "zh-Hant" (plain "zh" is Simplified).

const fs = require('fs');
const path = require('path');

// Every language the built-in emails exist in. en and es come from defaults.js.
const EMAIL_LANGS = Object.freeze(['en', 'es', 'ar', 'de', 'fr', 'id', 'pt', 'ru', 'tr', 'ur', 'vi', 'zh', 'zh-Hant', 'ja', 'th', 'uk', 'hi', 'pl']);
const TRANSLATED_LANGS = Object.freeze(EMAIL_LANGS.filter((l) => l !== 'en' && l !== 'es'));
const RTL_LANGS = new Set(['ar', 'ur']);
// Intl locale for dates; the language code itself when it is a valid locale.
const INTL_LOCALE = { en: 'en-GB', es: 'es-ES', pt: 'pt-BR', zh: 'zh-CN', 'zh-Hant': 'zh-TW' };
// <html lang> value.
const HTML_LANG = { pt: 'pt-BR', zh: 'zh-Hans', 'zh-Hant': 'zh-Hant' };

const DIR = path.join(__dirname, 'i18n');

const decode = (s) => String(s)
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// Inline markup to text: links keep their address, other tags go.
function inlineText(html) {
  return decode(String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
      const text = label.replace(/<[^>]+>/g, '').trim();
      return text === href ? href : `${text} (${href})`;
    })
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// The email body HTML (paragraphs and lists) as plain text: a blank line between blocks, "* " for
// bullet items and "1. " for numbered ones.
function htmlToText(html) {
  const blocks = [];
  const re = /<(p|ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    const tag = m[1].toLowerCase();
    if (tag === 'p') {
      blocks.push(inlineText(m[2]));
    } else {
      const items = [...m[2].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((x) => inlineText(x[1]));
      blocks.push(items.map((it, i) => (tag === 'ol' ? `${i + 1}. ${it}` : `* ${it}`)).join('\n'));
    }
  }
  return blocks.filter(Boolean).join('\n\n');
}

let cache = null;

// { [lang]: { meta, templates: { [key]: { subject, html, text } } } } for the translated languages.
function translations() {
  if (cache) return cache;
  const out = {};
  for (const lang of TRANSLATED_LANGS) {
    let data = null;
    try {
      data = JSON.parse(fs.readFileSync(path.join(DIR, `${lang}.json`), 'utf8'));
    } catch (e) { data = null; }
    if (!data) continue;
    const { _meta: meta = {}, ...rest } = data;
    const templates = {};
    for (const [key, t] of Object.entries(rest)) {
      if (t && typeof t.subject === 'string' && typeof t.html === 'string') templates[key] = { subject: t.subject, html: t.html, text: htmlToText(t.html) };
    }
    out[lang] = { meta, templates };
  }
  cache = out;
  return out;
}

function copyFor(key, lang) {
  const t = translations()[lang];
  return t && t.templates[key] ? t.templates[key] : null;
}

function metaFor(lang) {
  const t = translations()[lang];
  return t ? t.meta : null;
}

module.exports = { EMAIL_LANGS, TRANSLATED_LANGS, RTL_LANGS, INTL_LOCALE, HTML_LANG, htmlToText, translations, copyFor, metaFor };
