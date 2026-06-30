// App internationalization (i18n) — offline, bundled resources.
//
// Translations ship as JSON imported straight into the Vite bundle (no HTTP
// backend), so the app stays fully local-first. The selected language is
// persisted in localStorage and mirrored onto <html lang> for accessibility,
// exactly like the theme system in lib/theme.js.
//
// Namespaces are split per page (common = app chrome + dashboard + settings
// header; one namespace per route page). All are registered here so every page
// resolves regardless of load order. (Some pages also self-register their own
// namespace via i18n.addResourceBundle for hot-reload friendliness; that call is
// a guarded no-op once this central init has run.)
//
// This module is the single source of truth for the supported-language list and
// the persistence key; lib/lang.js builds the user-facing setLang/getStoredLang
// helpers on top of it (one-way dependency — this file imports nothing from there
// to avoid a cycle). Initialization is synchronous (resources are inlined), so
// useSuspense is off and no <Suspense> fallback is ever shown for translations.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import commonEn from './locales/en/common.json';
import commonEs from './locales/es/common.json';
import proxiesEn from './locales/en/proxies.json';
import proxiesEs from './locales/es/proxies.json';
import groupsEn from './locales/en/groups.json';
import groupsEs from './locales/es/groups.json';
import extensionsEn from './locales/en/extensions.json';
import extensionsEs from './locales/es/extensions.json';
import browsersEn from './locales/en/browsers.json';
import browsersEs from './locales/es/browsers.json';
import trashEn from './locales/en/trash.json';
import trashEs from './locales/es/trash.json';
import personasEn from './locales/en/personas.json';
import personasEs from './locales/es/personas.json';
import batchImportEn from './locales/en/batchImport.json';
import batchImportEs from './locales/es/batchImport.json';
import accountEn from './locales/en/account.json';
import accountEs from './locales/es/account.json';
import membersEn from './locales/en/members.json';
import membersEs from './locales/es/members.json';
import billingEn from './locales/en/billing.json';
import billingEs from './locales/es/billing.json';
import automationEn from './locales/en/automation.json';
import automationEs from './locales/es/automation.json';
import gateEn from './locales/en/gate.json';
import gateEs from './locales/es/gate.json';
import profilesEn from './locales/en/profiles.json';
import profilesEs from './locales/es/profiles.json';
import settingsExtraEn from './locales/en/settingsExtra.json';
import settingsExtraEs from './locales/es/settingsExtra.json';

export const LANG_KEY = 'softglaze-lang';

// Languages the UI ships translations for. `native` is shown in the picker so a
// speaker recognizes their own language regardless of the current UI language.
export const SUPPORTED_LANGS = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'es', label: 'Spanish', native: 'Español' },
];

const CODES = SUPPORTED_LANGS.map((l) => l.code);

export const NAMESPACES = [
  'common', 'proxies', 'groups', 'extensions', 'browsers', 'trash', 'personas',
  'batchImport', 'account', 'members', 'billing', 'automation', 'gate', 'profiles',
  'settingsExtra',
];

export function readStoredLang() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return CODES.includes(v) ? v : 'en';
  } catch (e) {
    return 'en';
  }
}

const lng = readStoredLang();
try { document.documentElement.setAttribute('lang', lng); } catch (e) { /* SSR / no DOM */ }

i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: commonEn, proxies: proxiesEn, groups: groupsEn, extensions: extensionsEn,
      browsers: browsersEn, trash: trashEn, personas: personasEn, batchImport: batchImportEn,
      account: accountEn, members: membersEn, billing: billingEn, automation: automationEn,
      gate: gateEn, profiles: profilesEn, settingsExtra: settingsExtraEn,
    },
    es: {
      common: commonEs, proxies: proxiesEs, groups: groupsEs, extensions: extensionsEs,
      browsers: browsersEs, trash: trashEs, personas: personasEs, batchImport: batchImportEs,
      account: accountEs, members: membersEs, billing: billingEs, automation: automationEs,
      gate: gateEs, profiles: profilesEs, settingsExtra: settingsExtraEs,
    },
  },
  lng,
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: NAMESPACES,
  interpolation: { escapeValue: false }, // React already escapes against XSS
  returnNull: false,
  react: { useSuspense: false },
});

export default i18n;
