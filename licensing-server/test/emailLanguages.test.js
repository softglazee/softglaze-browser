'use strict';
// Built-in emails in all 18 app languages: every translation is complete and safe to send, the
// customer's language picks it, and an admin's edit of the English row still wins.
const test = require('node:test');
const assert = require('node:assert/strict');

const { EMAIL_LANGS, TRANSLATED_LANGS, htmlToText, translations } = require('../src/email/translations');
const { builtIn, allDefaultRows, defaultRows, BUILT_IN_KEYS, LANGS, SEED_LANGS } = require('../src/email/defaults');
const { renderEmail, varsFor, unknownPlaceholders, unsafeHtml, greetingFor } = require('../src/email/render');
const { getTemplate } = require('../src/email/templates');
const { cleanLang } = require('../src/account/verify');

const FORBIDDEN = /\b(antidetect|anti-detect|undetectable|bypass|evade|spoof\w*|stealth|ban|banned|fake|anonymous)\b/i;
const ACTIVE = BUILT_IN_KEYS.filter((k) => k !== 'locks_tomorrow'); // retired, never sent
const placeholders = (s) => [...String(s).matchAll(/\{\{\s*([A-Za-z]+)\s*\}\}/g)].map((m) => m[1]).sort();
const tags = (s) => [...String(s).matchAll(/<\/?([a-z0-9]+)\b[^>]*>/gi)].map((m) => m[0].replace(/>[\s\S]*$/, '>'));

test('the email languages match the app languages (two-letter codes, zh-Hant kept apart)', () => {
  assert.equal(EMAIL_LANGS.length, 18);
  assert.deepEqual(LANGS, EMAIL_LANGS);
  assert.deepEqual(SEED_LANGS, ['en', 'es']);
  for (const tag of ['en', 'es-MX', 'ar', 'de-AT', 'fr', 'id', 'pt-BR', 'ru', 'tr', 'ur', 'vi', 'zh-Hans', 'zh-Hant', 'ja', 'th', 'uk', 'hi', 'pl']) {
    assert.ok(EMAIL_LANGS.includes(cleanLang(tag)), tag);
  }
  assert.equal(cleanLang('zh-TW'), 'zh-Hant');
  assert.equal(cleanLang('zh-CN'), 'zh');
});

test('every translated language has every active email, with the English placeholders and markup', () => {
  const all = translations();
  for (const lang of TRANSLATED_LANGS) {
    assert.ok(all[lang], `${lang}: file`);
    const m = all[lang].meta;
    for (const k of ['greetingNamed', 'greetingNoName', 'sentBy', 'unsub', 'unsubLink', 'essential', 'purchase']) assert.ok(m[k], `${lang}: _meta.${k}`);
    assert.match(m.greetingNamed, /\{\{name\}\}/);
    assert.deepEqual(placeholders(m.sentBy), ['company', 'email']);
    for (const key of ACTIVE) {
      const en = builtIn(key, 'en');
      const t = builtIn(key, lang);
      assert.equal(t.lang, lang, `${lang}/${key}`);
      assert.deepEqual(placeholders(t.subject + t.html), placeholders(en.subject + en.html), `${lang}/${key}: placeholders`);
      assert.deepEqual(tags(t.html), tags(en.html), `${lang}/${key}: markup`);
      assert.deepEqual(unknownPlaceholders(t.subject, t.html, t.text), []);
      assert.ok(!unsafeHtml(t.html));
      const text = `${t.subject}\n${t.html}\n${t.text}`;
      assert.ok(!FORBIDDEN.test(text), `${lang}/${key}: forbidden word`);
      assert.ok(!/[–—]/.test(text), `${lang}/${key}: no em/en dash`);
      assert.notEqual(t.subject, en.subject, `${lang}/${key}: translated`);
    }
  }
});

test('the plain-text part is made from the HTML', () => {
  const html = '<p>{{greeting}}</p>\n<p>Steps:</p>\n<ol>\n<li><strong>One.</strong> First</li>\n<li>Get it: <a href="{{downloadUrl}}">{{downloadUrl}}</a></li>\n</ol>\n<ul>\n<li>a &amp; b</li>\n</ul>\n<p>Link <a href="https://x.y/">here</a></p>';
  assert.equal(htmlToText(html), '{{greeting}}\n\nSteps:\n\n1. One. First\n2. Get it: {{downloadUrl}}\n\n* a & b\n\nLink here (https://x.y/)');
});

test('the seed migration rows stay English and Spanish only; the table gets every language', () => {
  assert.deepEqual([...new Set(defaultRows().map((r) => r.lang))].sort(), ['en', 'es']);
  const langs = new Set(allDefaultRows().filter((r) => r.key === 'welcome').map((r) => r.lang));
  assert.deepEqual([...langs].sort(), [...EMAIL_LANGS].sort());
  // The retired template is only in English and Spanish.
  assert.deepEqual(allDefaultRows().filter((r) => r.key === 'locks_tomorrow').map((r) => r.lang).sort(), ['en', 'es']);
});

test('rendering in a translated language: salutation, footer, date, lang and dir', () => {
  const settings = { email: { companyName: 'SoftGlaze' } };
  const vars = varsFor({ customer: { name: 'Ahmed Ali', email: 'a@example.com', lang: 'ar', trialEndsAt: new Date('2026-12-01T00:00:00Z') }, settings, lang: 'ar', unsubscribeUrl: 'https://x.y/u' });
  assert.equal(vars.greeting, greetingFor('Ahmed Ali', 'ar'));
  assert.ok(vars.greeting.includes('Ahmed'));
  assert.notEqual(vars.name, 'there');
  const out = renderEmail({ ...builtIn('welcome', 'ar'), category: 'lifecycle' }, vars);
  assert.match(out.html, /<html lang="ar" dir="rtl">/);
  assert.ok(out.html.includes(translations().ar.meta.unsubLink));
  assert.ok(!out.text.includes('This email was sent by'));
  const zh = renderEmail({ ...builtIn('welcome', 'zh-Hant'), category: 'lifecycle' }, varsFor({ customer: { lang: 'zh-Hant' }, settings, lang: 'zh-Hant' }));
  assert.match(zh.html, /<html lang="zh-Hant">/);
  // English and Spanish are unchanged.
  assert.equal(greetingFor('', 'en'), 'Hi there,');
  assert.equal(greetingFor('Ana López', 'es'), 'Hola, Ana:');
});

test('getTemplate: the tenant row, then the built-in translation, unless the admin edited English', async () => {
  const rows = new Map();
  const db = { emailTemplate: { findUnique: async ({ where }) => { const w = where.tenantId_key_lang; return rows.get(`${w.key}:${w.lang}`) || null; } } };
  // Nothing in the table yet: the built-in German copy.
  assert.equal((await getTemplate(db, 't', 'welcome', 'de')).subject, builtIn('welcome', 'de').subject);
  // The English row is still the built-in copy: German wins.
  rows.set('welcome:en', { ...builtIn('welcome', 'en'), isDefault: true });
  assert.equal((await getTemplate(db, 't', 'welcome', 'de')).lang, 'de');
  // The admin changed English: their text wins until they edit the German row.
  rows.set('welcome:en', { ...builtIn('welcome', 'en'), subject: 'Edited', isDefault: false });
  assert.equal((await getTemplate(db, 't', 'welcome', 'de')).subject, 'Edited');
  rows.set('welcome:de', { ...builtIn('welcome', 'de'), subject: 'Bearbeitet', isDefault: false });
  assert.equal((await getTemplate(db, 't', 'welcome', 'de')).subject, 'Bearbeitet');
  // An unknown language is English.
  assert.equal((await getTemplate(db, 't', 'welcome', 'xx')).subject, 'Edited');
});
