#!/usr/bin/env node
// Locale checker for the desktop renderer translations.
//
//   node tools/i18n/check-locale.mjs <code|all> [--partial] [--quiet] [--json]
//
// Compares src/renderer/i18n/locales/<code>/*.json against locales/en:
//   - valid UTF-8 JSON, no BOM (2-space indent is a warning)
//   - same files, same keys, same nesting, same key order
//   - plural keys: the English base (x_one / x_other) must exist with every form the language
//     needs (Intl.PluralRules categories); _zero is always allowed
//   - identical placeholder sets: {{x}}, $t(...), <0></0>, <tag>, %s / %d
//   - banned words (English words, common cognates and translations)
//   - empty strings
//   - strings identical to English longer than 20 characters (warning)
// --partial: missing files are a warning (use while a translation is in progress).
// Exit code 1 when any error is found.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(HERE, '..', '..', 'src', 'renderer', 'i18n', 'locales');

export const ALL_CODES = [
  'en', 'es', 'ar', 'de', 'fr', 'id', 'pt-BR', 'ru', 'tr', 'ur', 'vi',
  'zh-Hans', 'zh-Hant', 'ja', 'th', 'uk', 'hi', 'pl',
];

const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];
const PLURAL_RE = new RegExp(`^(.+)_(${PLURAL_SUFFIXES.join('|')})$`);
// 'many' in these languages only triggers for exact millions (1 000 000); missing is a warning.
const SOFT_MANY = new Set(['es', 'fr', 'pt-BR', 'pt', 'it', 'ca']);

// Banned terms. Latin words match on word boundaries (\p{L}-aware); `prefix` entries match the
// start of a word (so "anonym" catches anonymous, anonyme, anonim...). Non-Latin entries match
// anywhere in the string.
const BANNED = [
  // English
  { re: 'anti-?detect\\p{L}*', why: 'antidetect' },
  { re: 'undetectable', why: 'undetectable' },
  { re: 'bypass\\p{L}*', why: 'bypass' },
  { re: 'evad(e|es|ed|ing)|evasion', why: 'evade' },
  { re: 'spoof\\p{L}*', why: 'spoof' },
  { re: 'stealth\\p{L}*', why: 'stealth' },
  { re: '(un)?ban(s|ned|ning)?', why: 'ban' },
  { re: 'fakes?|faked|faking', why: 'fake' },
  { re: 'anonym\\p{L}*|anonim\\p{L}*|anónim\\p{L}*|anônim\\p{L}*|anonyme?\\p{L}*', why: 'anonymous' },
  // Latin-script cognates and transliterations
  { re: 'antid[ée]tec\\p{L}*|antidetec\\p{L}*|antidetek\\p{L}*|anty-?detek\\p{L}*', why: 'antidetect' },
  { re: 'ind[ée]tectable\\p{L}*|indetect[áa]vel|nicht nachweisbar|niewykrywaln\\p{L}*|tespit edilemez\\p{L}*|tidak terdeteksi|không thể phát hiện', why: 'undetectable' },
  { re: 'contourn\\p{L}*', why: 'bypass' },
  { re: 'fejk\\p{L}*', why: 'fake' },
  { re: 'ẩn danh|vô danh', why: 'anonymous' },
  { re: 'tarnkappe\\p{L}*|furtif\\p{L}*|furtiv\\p{L}*|sigil\\p{L}*', why: 'stealth' },
  { re: 'gebannt|bannir|bannis\\p{L}*|banido|banir|banimento|zbanowa\\p{L}*|banla\\p{L}*', why: 'ban' },
].map((b) => ({ ...b, rx: new RegExp(`(?<![\\p{L}\\p{N}])(?:${b.re})(?![\\p{L}\\p{N}])`, 'iu') }));

// Non-Latin scripts: substring match. Errors.
const BANNED_ANY = [
  { s: ['антидетект', 'анти-детект', 'антидетек'], why: 'antidetect' },
  { s: ['反检测', '反偵測', '反侦测', '反檢測', '防检测', 'アンチディテクト', 'アンチ検出', 'ป้องกันการตรวจจับ', 'एंटीडिटेक्ट', 'اینٹی ڈیٹیکٹ', 'مضاد للكشف', 'مكافحة الكشف'], why: 'antidetect' },
  { s: ['неотслежив', 'необнаруж', 'невиявл', '无法检测', '無法偵測', '検出不可', '検出されない', 'ตรวจจับไม่ได้', 'अनडिटेक्टेबल', 'غير قابل للكشف'], why: 'undetectable' },
  { s: ['обход', 'обійти', 'обхід', '绕过', '繞過', 'バイパス', 'บายพาส', 'बायपास', 'بائی پاس'], why: 'bypass' },
  { s: ['规避', '規避', 'หลบเลี่ยง', 'चकमा', 'تهرب', 'التهرب'], why: 'evade' },
  { s: ['спуф', 'подделыв', '伪造', '偽造', '欺骗', '欺騙', 'なりすま', 'スプーフ', 'ปลอมแปลง', 'स्पूफ', 'انتحال', 'سپوف'], why: 'spoof' },
  { s: ['стелс', 'скрытн', '隐身', '隱身', 'ステルス', 'สเตลท์', 'स्टेल्थ', 'التخفي', 'اسٹیلتھ'], why: 'stealth' },
  { s: ['забан', 'разбан', '封禁', 'बैन'], why: 'ban' },
  { s: ['фейк', 'поддельн', 'фальшив', 'підробн', '假的', '虚假', '虛假', '偽の', 'フェイク', 'नकली', 'फ़र्ज़ी', 'مزيف', 'جعلی'], why: 'fake' },
  { s: ['анонимн', 'анонімн', '匿名', 'ไม่ระบุตัวตน', 'नामरहित', 'गुमनाम', 'अनाम', 'گمنام'], why: 'anonymous' },
];
// Words that are often fine ("block", "hidden", "restriction") but can be a banned meaning. Warnings.
const BANNED_SOFT = [
  { s: ['бан ', 'бана', 'баном', '封鎖', 'แบน', 'حظر', 'محظور', 'ปลอม', '隐形', '隱形'], why: 'ban/fake/stealth (check meaning)' },
];

// Placeholders: {{x}} (inner whitespace ignored), $t(...), <0>, </0>, <tag ...>, </tag>, <br/>, %s, %d.
const PH_RE = /\{\{\s*([^{}]*?)\s*\}\}|\$t\([^()]*\)|<\/?[A-Za-z0-9][A-Za-z0-9-]*\s*\/?>|<[A-Za-z][A-Za-z0-9-]*\s[^<>]*>|%[sdif]/g;

export function placeholders(str) {
  const out = [];
  if (typeof str !== 'string') return out;
  for (const m of str.matchAll(PH_RE)) {
    if (m[1] !== undefined) out.push(`{{${m[1].replace(/\s+/g, '')}}}`);
    else out.push(m[0].replace(/\s+/g, ' '));
  }
  return out.sort();
}

function multisetDiff(a, b) {
  const count = new Map();
  for (const x of a) count.set(x, (count.get(x) || 0) + 1);
  for (const x of b) count.set(x, (count.get(x) || 0) - 1);
  const missing = []; const extra = [];
  for (const [k, v] of count) {
    if (v > 0) missing.push(k);
    if (v < 0) extra.push(k);
  }
  return { missing, extra };
}

export function bannedHits(str) {
  if (typeof str !== 'string') return [];
  const hits = [];
  for (const b of BANNED) {
    const m = str.match(b.rx);
    if (m) hits.push(`${b.why} ("${m[0]}")`);
  }
  const lower = str.toLowerCase();
  for (const b of BANNED_ANY) {
    const s = b.s.find((x) => lower.includes(x.toLowerCase()));
    if (s) hits.push(`${b.why} ("${s.trim()}")`);
  }
  return hits;
}

export function softBannedHits(str) {
  if (typeof str !== 'string') return [];
  const lower = str.toLowerCase();
  const hits = [];
  for (const b of BANNED_SOFT) {
    const s = b.s.find((x) => lower.includes(x.toLowerCase()));
    if (s) hits.push(`${b.why} ("${s.trim()}")`);
  }
  return hits;
}

export function pluralCategories(code) {
  try {
    return new Intl.PluralRules(code).resolvedOptions().pluralCategories;
  } catch {
    return ['one', 'other'];
  }
}

// Flatten to [{ path, value }] in document order. Arrays use numeric segments.
function flatten(obj, prefix = [], out = []) {
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => flatten(v, [...prefix, String(i)], out));
  } else if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) flatten(obj[k], [...prefix, k], out);
  } else {
    out.push({ path: prefix, value: obj });
  }
  return out;
}

// Collect objects (node paths) and their key order, for nesting/order checks.
function objectNodes(obj, prefix = [], out = new Map()) {
  if (obj && typeof obj === 'object') {
    out.set(prefix.join('.'), { keys: Object.keys(obj), isArray: Array.isArray(obj) });
    for (const k of Object.keys(obj)) objectNodes(obj[k], [...prefix, k], out);
  }
  return out;
}

// English plural bases at one object level: base -> set of suffixes present.
function pluralBases(keys) {
  const bases = new Map();
  for (const k of keys) {
    const m = k.match(PLURAL_RE);
    if (m) {
      if (!bases.has(m[1])) bases.set(m[1], new Set());
      bases.get(m[1]).add(m[2]);
    }
  }
  // A base is plural only when English has _other (or _one) for it.
  for (const [b, s] of bases) if (!s.has('other') && !s.has('one')) bases.delete(b);
  return bases;
}

function normalizeOrder(keys, bases) {
  const seq = [];
  for (const k of keys) {
    const m = k.match(PLURAL_RE);
    const id = m && bases.has(m[1]) ? `${m[1]}_#plural` : k;
    if (seq[seq.length - 1] !== id) seq.push(id);
  }
  return seq;
}

function readJson(file, problems, rel) {
  const buf = fs.readFileSync(file);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    problems.error(rel, 'file starts with a UTF-8 BOM');
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    problems.error(rel, 'file is not valid UTF-8');
    return null;
  }
  text = text.replace(/^﻿/, '');
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    problems.error(rel, `invalid JSON: ${e.message}`);
    return null;
  }
  const pretty = JSON.stringify(data, null, 2);
  if (text.replace(/\r\n/g, '\n').trimEnd() !== pretty) {
    problems.warn(rel, 'not formatted as 2-space JSON.stringify output (run it through JSON.stringify(x, null, 2))');
  }
  return data;
}

function looksTranslatable(s) {
  // Strip placeholders, URLs, code-ish tokens; what is left must contain words.
  const rest = s.replace(PH_RE, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/[\w.-]+\.[a-z]{2,4}\b/gi, ' ');
  return (rest.match(/\p{L}{3,}/gu) || []).length >= 3;
}

export function checkLocaleFile(code, enData, data, rel, problems) {
  const enNodes = objectNodes(enData);
  const nodes = objectNodes(data);
  const cats = pluralCategories(code);

  for (const [nodePath, enNode] of enNodes) {
    const where = (k) => (nodePath ? `${nodePath}.${k}` : k);
    const node = nodes.get(nodePath);
    if (!node) continue; // reported by the parent level as a type mismatch / missing key
    if (enNode.isArray !== node.isArray) {
      problems.error(rel, `${nodePath || '(root)'}: ${enNode.isArray ? 'array' : 'object'} expected`);
      continue;
    }
    const bases = enNode.isArray ? new Map() : pluralBases(enNode.keys);
    const have = new Set(node.keys);
    const enHave = new Set(enNode.keys);

    // Missing non-plural keys.
    for (const k of enNode.keys) {
      const m = k.match(PLURAL_RE);
      if (m && bases.has(m[1])) continue;
      if (!have.has(k)) problems.error(rel, `${where(k)}: missing key`);
    }
    // Plural bases: required categories.
    for (const [base] of bases) {
      for (const c of cats) {
        const key = `${base}_${c}`;
        if (have.has(key)) continue;
        if (c === 'many' && SOFT_MANY.has(code)) {
          problems.warn(rel, `${where(key)}: plural form "many" missing (used for 1 000 000); add it equal to _other`);
        } else {
          problems.error(rel, `${where(key)}: missing plural form "${c}" (needed by ${code})`);
        }
      }
    }
    // Extra keys.
    for (const k of node.keys) {
      if (enHave.has(k)) continue;
      const m = k.match(PLURAL_RE);
      if (m && bases.has(m[1])) {
        const suf = m[2];
        if (suf === 'zero' || cats.includes(suf) || bases.get(m[1]).has(suf)) continue;
        problems.error(rel, `${where(k)}: plural form "${suf}" is not used by ${code} (forms: ${cats.join(', ')})`);
        continue;
      }
      problems.error(rel, `${where(k)}: extra key (not in English)`);
    }
    // Order.
    if (!enNode.isArray) {
      const a = normalizeOrder(enNode.keys, bases);
      const b = normalizeOrder(node.keys.filter((k) => {
        const m = k.match(PLURAL_RE);
        return enHave.has(k) || (m && bases.has(m[1]));
      }), bases);
      const shared = new Set(b);
      const aa = a.filter((x) => shared.has(x));
      if (aa.join('\u0000') !== b.join('\u0000')) {
        const i = aa.findIndex((x, n) => x !== b[n]);
        problems.error(rel, `${nodePath || '(root)'}: key order differs from English (first at "${String(b[i]).replace('_#plural', '_*')}", English has "${String(aa[i]).replace('_#plural', '_*')}")`);
      }
    }
  }

  // Values.
  const enFlat = new Map(flatten(enData).map((e) => [e.path.join('.'), e.value]));
  for (const { path: p, value } of flatten(data)) {
    const key = p.join('.');
    let enValue = enFlat.get(key);
    let pluralVariant = false;
    if (enValue === undefined) {
      const last = p[p.length - 1];
      const m = String(last).match(PLURAL_RE);
      if (!m) continue; // extra key, reported above
      const parent = p.slice(0, -1).join('.');
      const pre = parent ? `${parent}.` : '';
      enValue = enFlat.get(`${pre}${m[1]}_other`) ?? enFlat.get(`${pre}${m[1]}_one`);
      if (enValue === undefined) continue;
      pluralVariant = true;
    }
    if (typeof enValue !== typeof value) {
      problems.error(rel, `${key}: type ${typeof value}, English is ${typeof enValue}`);
      continue;
    }
    if (typeof value !== 'string') continue;
    if (value.trim() === '' && enValue.trim() !== '') {
      problems.error(rel, `${key}: empty string`);
      continue;
    }
    // Placeholders. Plural forms may drop {{count}} (e.g. "one file", Arabic dual) -> warning.
    const isPluralKey = PLURAL_RE.test(String(p[p.length - 1]));
    const { missing, extra } = multisetDiff(placeholders(enValue), placeholders(value));
    const softMissing = isPluralKey ? missing.filter((x) => x === '{{count}}') : [];
    const hardMissing = missing.filter((x) => !softMissing.includes(x));
    const missingUnique = [...new Set(hardMissing)];
    const extraUnique = [...new Set(extra)];
    // A placeholder that appears in both, just a different number of times, is a warning.
    const enSet = new Set(placeholders(enValue));
    const trSet = new Set(placeholders(value));
    const realMissing = missingUnique.filter((x) => !trSet.has(x));
    const realExtra = extraUnique.filter((x) => !enSet.has(x));
    if (realMissing.length) problems.error(rel, `${key}: missing placeholder(s) ${realMissing.join(' ')}`);
    if (realExtra.length) problems.error(rel, `${key}: unknown placeholder(s) ${realExtra.join(' ')}`);
    const countOnly = [...missingUnique, ...extraUnique].filter((x) => enSet.has(x) && trSet.has(x));
    if (countOnly.length) problems.warn(rel, `${key}: placeholder used a different number of times: ${[...new Set(countOnly)].join(' ')}`);
    if (softMissing.length && !trSet.has('{{count}}')) problems.warn(rel, `${key}: plural form without {{count}}`);
    // Banned words.
    if (code !== 'en') {
      const hits = bannedHits(value);
      if (hits.length) problems.error(rel, `${key}: banned word ${hits.join(', ')}`);
      const soft = softBannedHits(value).filter((h) => !hits.includes(h));
      if (soft.length) problems.warn(rel, `${key}: possible banned word ${soft.join(', ')}`);
    }
    // Untranslated.
    if (code !== 'en' && !pluralVariant && value === enValue && value.length > 20 && looksTranslatable(value)) {
      problems.warn(rel, `${key}: identical to English (${value.length} chars)`);
    }
  }
}

function makeProblems() {
  const errors = []; const warnings = [];
  return {
    errors, warnings,
    error: (file, msg) => errors.push({ file, msg }),
    warn: (file, msg) => warnings.push({ file, msg }),
  };
}

export function checkLocale(code, { root = DEFAULT_ROOT, partial = false } = {}) {
  const problems = makeProblems();
  const enDir = path.join(root, 'en');
  const dir = path.join(root, code);
  const stats = { files: 0, strings: 0, expectedFiles: 0 };
  const enFiles = fs.readdirSync(enDir).filter((f) => f.endsWith('.json')).sort();
  stats.expectedFiles = enFiles.length;
  if (!fs.existsSync(dir)) {
    problems.error(code, 'locale folder missing');
    return { code, ...problems, stats };
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    if (!enFiles.includes(f)) problems.error(`${code}/${f}`, 'file does not exist in English');
  }
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') && fs.statSync(path.join(dir, f)).isFile()) {
      problems.warn(`${code}/${f}`, 'non-JSON file in the locale folder (it is not loaded; remove it before commit)');
    }
  }
  for (const f of enFiles) {
    const rel = `${code}/${f}`;
    const enData = readJson(path.join(enDir, f), makeProblems(), `en/${f}`);
    if (!fs.existsSync(path.join(dir, f))) {
      if (code !== 'en') (partial ? problems.warn : problems.error)(rel, 'file missing');
      continue;
    }
    const data = readJson(path.join(dir, f), problems, rel);
    if (data == null || enData == null) continue;
    stats.files += 1;
    stats.strings += flatten(data).filter((e) => typeof e.value === 'string').length;
    if (code === 'en') {
      // English is the reference: only report banned words as warnings.
      for (const { path: p, value } of flatten(data)) {
        const hits = bannedHits(value);
        if (hits.length) problems.warn(rel, `${p.join('.')}: English source uses ${hits.join(', ')}; translations must use neutral wording`);
      }
      continue;
    }
    checkLocaleFile(code, enData, data, rel, problems);
  }
  return { code, ...problems, stats };
}

function main(argv) {
  const args = argv.filter((a) => !a.startsWith('--'));
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const target = args[0];
  if (!target) {
    console.error('usage: node tools/i18n/check-locale.mjs <code|all> [--partial] [--quiet] [--json] [--root=<dir>]');
    return 2;
  }
  const rootFlag = argv.find((a) => a.startsWith('--root='));
  const root = rootFlag ? path.resolve(rootFlag.slice(7)) : DEFAULT_ROOT;
  let codes;
  if (target === 'all') {
    codes = fs.readdirSync(root).filter((d) => d !== 'en' && fs.statSync(path.join(root, d)).isDirectory());
  } else {
    codes = target.split(',');
  }
  const results = codes.map((c) => checkLocale(c, { root, partial: flags.has('--partial') }));
  if (flags.has('--json')) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) {
      const status = r.errors.length ? 'FAIL' : 'OK';
      console.log(`\n== ${r.code}: ${status}  files ${r.stats.files}/${r.stats.expectedFiles}, strings ${r.stats.strings}, errors ${r.errors.length}, warnings ${r.warnings.length}`);
      const limit = flags.has('--all-lines') ? Infinity : 200;
      r.errors.slice(0, limit).forEach((e) => console.log(`  ERROR ${e.file}: ${e.msg}`));
      if (r.errors.length > limit) console.log(`  ... ${r.errors.length - limit} more errors (--all-lines)`);
      if (!flags.has('--quiet')) {
        r.warnings.slice(0, limit).forEach((w) => console.log(`  warn  ${w.file}: ${w.msg}`));
        if (r.warnings.length > limit) console.log(`  ... ${r.warnings.length - limit} more warnings (--all-lines)`);
      }
    }
    const failed = results.filter((r) => r.errors.length).map((r) => r.code);
    console.log(`\n${failed.length ? `FAILED: ${failed.join(' ')}` : 'All checked locales pass.'}`);
  }
  return results.some((r) => r.errors.length) ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.exitCode = main(process.argv.slice(2));
}
