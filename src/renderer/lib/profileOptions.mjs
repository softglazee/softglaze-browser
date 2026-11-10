// The profile editor's side of src/main/profileOptions.js: the same meanings for the options that change
// how a profile launches, so the editor, the Environment Overview and the launch agree.
// test/profileOptions.test.js checks every mirrored function against main's.

const lower = (v) => String(v == null ? '' : v).trim().toLowerCase();

// ---- WebRTC (mirrors webrtcMode) ----
export const WEBRTC_MODES = Object.freeze(['Forward', 'Replace', 'Real', 'Disabled']);
// The mode a stored value launches as: the retired "Proxy UDP" (and old import words) are Forward.
export function webrtcMode(stored) {
  return WEBRTC_MODES.includes(stored) ? stored : 'Forward';
}

// ---- Hardware acceleration (mirrors hardwareAccelerationChoice) ----
export function hardwareAccelerationChoice(value) {
  const t = lower(value);
  if (!t) return 'Default';
  if (/disable|off|close/.test(t)) return 'Off';
  if (/^(on|open|opened|enable|enabled|force|forced|true|yes|1)$/.test(t)) return 'On';
  return 'Default';
}

// ---- Chrome version (mirrors chromeVersionPin) ----
// A version picked in the editor is a bare major ("157"); "Auto" and a generated profile's full
// version ("149.0.7827.155") are not picks.
export function chromeVersionPin(value) {
  const m = /^\s*(\d{2,4})\s*$/.exec(String(value == null ? '' : value));
  return m ? Number(m[1]) : null;
}

// ---- Location (mirrors geolocationPermission) ----
export function geolocationPermission(profile = {}) {
  if (lower(profile.locationType) === 'block') return 'denied';
  if (/^always/.test(lower(profile.locationPrompt))) return 'granted';
  return 'prompt';
}

// ---- Display language (mirrors normalizeLocaleTag) ----
export function normalizeLocaleTag(value) {
  const s = String(value == null ? '' : value).trim().replace(/_/g, '-');
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(s)) return null;
  return s.split('-').map((part, i) => {
    if (i === 0) return part.toLowerCase();
    if (part.length === 2) return part.toUpperCase();
    if (part.length === 4) return part[0].toUpperCase() + part.slice(1).toLowerCase();
    return part.toLowerCase();
  }).join('-');
}

// ---- Media devices (mirrors parseMediaCounts) ----
export const MEDIA_COUNT_MAX = 4;
export function parseMediaCounts(value) {
  let o = value;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) { o = null; } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) o = {};
  const n = (v) => {
    const x = Number.parseInt(String(v), 10);
    return Number.isFinite(x) ? Math.min(MEDIA_COUNT_MAX, Math.max(0, x)) : 1;
  };
  return { mic: n(o.mic), spk: n(o.spk), cam: n(o.cam) };
}

// ---- Fonts (mirrors parseFontList) ----
const FONT_NAME_RE = /^[^"'`\\,;{}()<>[\]\u0000-\u001f]{1,64}$/;
export function parseFontList(value) {
  let items = value;
  if (typeof items === 'string') {
    const s = items.trim();
    if (s.startsWith('[')) { try { items = JSON.parse(s); } catch (e) { items = s.split(/[\r\n,]+/); } }
    else items = s.split(/[\r\n,]+/);
  }
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of items) {
    const name = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
    if (!name || !FONT_NAME_RE.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= 1000) break;
  }
  return out;
}

export function fontOsKey(os) {
  const v = lower(os);
  if (v.includes('mac') || v.includes('os x')) return 'macOS';
  if (v.includes('android')) return 'Android';
  if (/linux|ubuntu|debian|fedora|arch|chromeos|chrome os/.test(v)) return 'Linux';
  return 'Windows';
}

// ---- Device name and MAC address (mirrors normalizeMac, macAddressError, deviceNameError) ----
export function normalizeMac(value) {
  const s = String(value == null ? '' : value).trim();
  if (!/^[0-9a-f:.\-\s]+$/i.test(s)) return null;
  const h = s.replace(/[:.\-\s]/g, '');
  if (!/^[0-9a-f]{12}$/i.test(h)) return null;
  return h.toUpperCase().match(/../g).join(':');
}

export function macAddressError(value) {
  const m = normalizeMac(value);
  if (!m) return 'format';
  if (m === '00:00:00:00:00:00' || m === 'FF:FF:FF:FF:FF:FF') return 'zero';
  if (Number.parseInt(m.slice(0, 2), 16) & 1) return 'multicast';
  return null;
}

export function deviceNameError(value, os) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return 'empty';
  if (fontOsKey(os) === 'Windows') {
    if (s.length > 15) return 'length';
    if (!/^[A-Za-z0-9-]+$/.test(s) || /^\d+$/.test(s)) return 'characters';
    return null;
  }
  if (s.length > 63) return 'length';
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._'-]*$/.test(s)) return 'characters';
  return null;
}

// ---- User-Agent (mirrors uaFamily and uaChromeMajor) ----
export function uaFamily(ua) {
  const s = String(ua || '');
  if (!s.trim()) return 'other';
  if (/bot\b|bot\/|crawl|spider|slurp|curl\/|wget\/|python|httpclient|okhttp|java\/|go-http|headless|phantomjs|facebookexternalhit|bingpreview|mediapartners|lighthouse/i.test(s)) return 'bot';
  if (/iPhone|iPad|iPod|CriOS\/|FxiOS\/|EdgiOS\//i.test(s)) return 'webkit';
  if (/Firefox\//i.test(s) && !/Chrom(e|ium)\//i.test(s)) return 'firefox';
  if (/Chrom(e|ium)\/\d+/i.test(s)) return 'chromium';
  if (/Version\/[\d.]+.*Safari\//i.test(s)) return 'webkit';
  return 'other';
}

export function uaChromeMajor(ua) {
  const m = /Chrom(?:e|ium)\/(\d+)/i.exec(String(ua || ''));
  return m ? Number(m[1]) : null;
}

// Why a picked User-Agent does not match the browser that will really launch, or null:
//   { kind: 'engine', family }   Chromium launches but the UA names another browser (or a bot).
//   { kind: 'version', uaMajor, launchMajor }  a Chrome UA of another version than the one launched.
//   { kind: 'firefoxIgnored' }   Firefox launches and keeps its own UA (it only takes a Firefox UA).
export function userAgentWarning(ua, browserCore, launchMajor) {
  const s = String(ua || '').trim();
  if (!s || /^auto$/i.test(s)) return null;
  const family = uaFamily(s);
  if (lower(browserCore) === 'firefox') return family === 'firefox' ? null : { kind: 'firefoxIgnored', family };
  if (family !== 'chromium') return { kind: 'engine', family };
  const uaMajor = uaChromeMajor(s);
  if (uaMajor && launchMajor && uaMajor !== Number(launchMajor)) return { kind: 'version', uaMajor, launchMajor: Number(launchMajor) };
  return null;
}

// ---- WebGPU (mirrors webgpuInfoFromWebgl) ----
export function webgpuInfoFromWebgl(vendor, renderer) {
  const r = `${vendor || ''} ${renderer || ''}`.toLowerCase();
  if (!r.trim()) return null;
  const arch = (rules) => { for (const [re, name] of rules) if (re.test(r)) return name; return ''; };
  if (/nvidia|geforce|quadro/.test(r)) {
    return { vendor: 'nvidia', architecture: arch([[/rtx\s*50\d\d/, 'blackwell'], [/rtx\s*40\d\d/, 'lovelace'], [/rtx\s*30\d\d|rtx\s*a\d{3,4}/, 'ampere'], [/rtx\s*20\d\d|gtx\s*16\d\d/, 'turing'], [/gtx\s*10\d\d/, 'pascal'], [/gtx\s*9\d\d/, 'maxwell']]) };
  }
  if (/apple/.test(r)) return { vendor: 'apple', architecture: 'metal-3' };
  if (/\bamd\b|radeon|\bati\b/.test(r)) {
    return { vendor: 'amd', architecture: arch([[/rx\s*9\d{3}/, 'rdna-4'], [/rx\s*7\d{3}/, 'rdna-3'], [/rx\s*6\d{3}/, 'rdna-2'], [/rx\s*5\d{3}/, 'rdna-1'], [/vega/, 'gcn-5'], [/rx\s*[45]\d\d\b/, 'gcn-4'], [/radeon\s*\(tm\)\s*graphics|radeon graphics/, 'rdna-2']]) };
  }
  if (/intel/.test(r)) {
    return { vendor: 'intel', architecture: arch([[/\barc\b/, 'gen-12hp'], [/iris(\(r\))?\s*xe|uhd graphics 7\d\d|\bxe graphics/, 'gen-12lp'], [/(uhd|hd) graphics 6\d\d|plus graphics 6\d\d/, 'gen-9'], [/iris(\(r\))?\s*plus graphics/, 'gen-11']]) };
  }
  if (/mali|\barm\b/.test(r)) {
    return { vendor: 'arm', architecture: arch([[/mali-g(57|68|77|78|310|510|610|615|710|715|720)\b/, 'valhall'], [/mali-g(31|51|52|71|72|76)\b/, 'bifrost'], [/mali-t\d/, 'midgard']]) };
  }
  if (/adreno|qualcomm/.test(r)) {
    return { vendor: 'qualcomm', architecture: arch([[/adreno[^\d]*8\d\d/, 'adreno-8xx'], [/adreno[^\d]*7\d\d/, 'adreno-7xx'], [/adreno[^\d]*6\d\d/, 'adreno-6xx'], [/adreno[^\d]*5\d\d/, 'adreno-5xx']]) };
  }
  return null;
}

// Whether a profile's WebGL reports a GPU other than the real one, the way the launch decides it:
// "Custom" with a vendor, or any profile that claims another OS than this computer's.
export function webglSpoofed(profile = {}, hostOs = 'Windows') {
  const custom = lower(profile.webglMetadata) === 'custom' && profile.webglVendor && !/^(real|auto|default|based)/i.test(String(profile.webglVendor));
  if (custom) return true;
  const claimed = fontOsKey(profile.os || hostOs);
  return claimed !== fontOsKey(hostOs);
}

// The editor's word for a stored WebGPU value, as the launch reads it.
export function webgpuChoice(value) {
  const t = String(value == null ? '' : value).trim();
  if (/disabled?/i.test(t)) return 'Disabled';
  if (/^real$/i.test(t)) return 'Real';
  return 'Based on WebGL';
}
