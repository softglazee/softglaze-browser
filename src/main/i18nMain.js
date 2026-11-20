'use strict';
// Main-process strings (context menu, file dialogs) in the app language. Texts live in the same
// locale folder as the renderer's, namespace "main": src/renderer/i18n/locales/<code>/main.json
// (packaged through build.files). The renderer reports the active language over
// LANGUAGE_CHANNEL at start and on every switch; before that the OS locale is used. Missing
// languages or keys fall back to English.

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'renderer', 'i18n', 'locales');
const LANGUAGE_CHANNEL = 'i18n:language';
const CODES = ['en', 'es', 'ar', 'de', 'fr', 'id', 'pt-BR', 'ru', 'tr', 'ur', 'vi', 'zh-Hans', 'zh-Hant', 'ja', 'th', 'uk', 'hi', 'pl'];

const cache = new Map();
let current = null;

// Same rules as the renderer's langs.mjs matchLang (zh-CN -> zh-Hans, zh-TW/HK -> zh-Hant, pt -> pt-BR).
function matchLang(tag) {
  if (!tag || typeof tag !== 'string') return null;
  const lower = tag.trim().replace(/_/g, '-').toLowerCase();
  if (!lower) return null;
  const exact = CODES.find((c) => c.toLowerCase() === lower);
  if (exact) return exact;
  const [base, ...rest] = lower.split('-');
  if (base === 'zh') return rest.includes('hant') || rest.some((p) => ['tw', 'hk', 'mo'].includes(p)) ? 'zh-Hant' : 'zh-Hans';
  if (base === 'pt') return 'pt-BR';
  return CODES.find((c) => c === base) || null;
}

function load(code) {
  if (cache.has(code)) return cache.get(code);
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, code, 'main.json'), 'utf8'));
  } catch (e) { /* not translated yet: English is used per key */ }
  cache.set(code, data);
  return data;
}

function lookup(data, key) {
  return key.split('.').reduce((o, p) => (o && typeof o === 'object' ? o[p] : undefined), data);
}

function osLanguage() {
  try {
    const { app } = require('electron');
    return matchLang(app.getLocale()) || 'en';
  } catch (e) {
    return 'en';
  }
}

function getLanguage() {
  return current || osLanguage();
}

function setLanguage(code) {
  const next = matchLang(code);
  if (next) current = next;
  return getLanguage();
}

// t('dialogs.backupTitle'), t('x', { name }) - {{name}} placeholders, like i18next.
function t(key, vars, lang) {
  const code = lang ? (matchLang(lang) || 'en') : getLanguage();
  let s = lookup(load(code), key);
  if (typeof s !== 'string' || !s) s = lookup(load('en'), key);
  if (typeof s !== 'string') return key;
  return vars ? s.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k]))) : s;
}

// The renderer tells us its language (preload: softglaze.ui.setLanguage).
function registerLanguageChannel(ipcMain) {
  ipcMain.on(LANGUAGE_CHANNEL, (_event, code) => { setLanguage(code); });
}

module.exports = { t, getLanguage, setLanguage, matchLang, registerLanguageChannel, LANGUAGE_CHANNEL, LOCALES_DIR };
