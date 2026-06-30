import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCcw, Search, Plus, Trash2, ArrowLeft, ShieldCheck, Settings2, Monitor, Apple, Smartphone, Terminal, ChevronDown, Check, Tag, Link2, Zap, FileSpreadsheet, Cookie, Copy, Dices, Shuffle, Fingerprint, LayoutTemplate, History, Play, Square, Activity, Loader2, Download, KeyRound, Combine, Lock } from 'lucide-react';
import EmptyState from '@/components/EmptyState.jsx';
import PageHeader from '@/components/PageHeader.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card, CardContent } from '@/components/ui/Card.jsx';
import LeakCheckModal from '@/components/LeakCheckModal.jsx';
import CookieManagerModal from '@/components/CookieManagerModal.jsx';
import BrowserManagerModal from '@/components/BrowserManagerModal.jsx';
import BrowserVersionSelect from '@/components/BrowserVersionSelect.jsx';
import BrowserBrandSelect, { BrandMark, BROWSER_BRANDS, normalizeBrandId } from '@/components/BrowserBrandSelect.jsx';
import ProxyRotationModal from '@/components/ProxyRotationModal.jsx';
import EnvironmentOverviewModal from '@/components/EnvironmentOverviewModal.jsx';
import DeleteProfileModal from '@/components/DeleteProfileModal.jsx';
import TemplatesModal from '@/components/TemplatesModal.jsx';
import ActivityModal from '@/components/ActivityModal.jsx';
import QuickGenerateModal from '@/components/QuickGenerateModal.jsx';
import Pager from '@/components/ui/Pager.jsx';
import CompareProfilesModal from '@/components/CompareProfilesModal.jsx';
import ShareProfileModal from '@/components/ShareProfileModal.jsx';
import { Pencil, GitCompare, Bookmark, Share2 } from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { useDialog } from '@/lib/useDialog.js';
import { formatDateTime } from '@/lib/utils.js';
import i18n from '@/i18n/index.js';
import profilesEn from '@/i18n/locales/en/profiles.json';
import profilesEs from '@/i18n/locales/es/profiles.json';

// Register this page's "profiles" namespace without touching the central i18n
// config. addResourceBundle is a no-op if the bundle already exists, so this is
// safe across hot reloads.
if (!i18n.hasResourceBundle('en', 'profiles')) i18n.addResourceBundle('en', 'profiles', profilesEn);
if (!i18n.hasResourceBundle('es', 'profiles')) i18n.addResourceBundle('es', 'profiles', profilesEs);

// Compact relative time ("just now", "5m ago", "3h ago", "2d ago"); the absolute
// timestamp stays available on hover via the cell's title.
function relTime(iso) {
  const tr = (k, opts) => i18n.t(k, { ns: 'profiles', ...opts });
  try {
    const d = new Date(iso).getTime();
    if (!d) return tr('relTime.never');
    const s = Math.max(0, Math.floor((Date.now() - d) / 1000));
    if (s < 45) return tr('relTime.justNow');
    const m = Math.floor(s / 60); if (m < 60) return tr('relTime.minutes', { count: m });
    const h = Math.floor(m / 60); if (h < 24) return tr('relTime.hours', { count: h });
    const dys = Math.floor(h / 24); if (dys < 7) return tr('relTime.days', { count: dys });
    const w = Math.floor(dys / 7); if (w < 5) return tr('relTime.weeks', { count: w });
    const mo = Math.floor(dys / 30); if (mo < 12) return tr('relTime.months', { count: mo });
    return tr('relTime.years', { count: Math.floor(dys / 365) });
  } catch (e) { return tr('relTime.never'); }
}

// --- CUSTOM STYLED SELECT DROPDOWN ---
const CustomSelect = ({ value, onChange, className = '', children, disabled }) => (
  <div className={`relative flex items-center ${className}`}>
    <select
      value={value}
      onChange={onChange}
      disabled={disabled}
      className="w-full appearance-none bg-background border border-border rounded pl-3 pr-9 py-2 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition disabled:opacity-50 text-ellipsis overflow-hidden whitespace-nowrap cursor-pointer hover:border-muted-dark"
    >
      {children}
    </select>
    <div className="absolute right-3 pointer-events-none text-muted">
      <ChevronDown className="w-4 h-4" />
    </div>
  </div>
);

// --- HELPER COMPONENT FOR TAB BUTTONS ---
const ButtonTabs = ({ value, onChange, options, className = '' }) => (
  <div className={`flex flex-wrap bg-background border border-border rounded w-max overflow-hidden ${className}`}>
    {options.map(opt => (
      <button
        key={opt}
        type="button"
        onClick={() => onChange(opt)}
        className={`px-3 py-1.5 text-xs transition border-r border-border last:border-0 ${value === opt ? 'bg-muted-dark text-foreground font-medium' : 'text-muted hover:text-foreground hover:bg-surface'}`}
      >
        {opt}
      </button>
    ))}
  </div>
);

// --- HELPER COMPONENT FOR ON/OFF TOGGLES (Hardware Noise) ---
const ToggleSwitch = ({ checked, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${checked ? 'bg-primary' : 'bg-muted-dark'}`}
  >
    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
  </button>
);

// --- HELPER COMPONENT FOR CUSTOM CHECKBOX ---
const CustomCheckbox = ({ checked, onChange, label }) => (
  <label className="flex items-center gap-2 cursor-pointer group">
    <div className={`w-4 h-4 rounded border flex items-center justify-center transition ${checked ? 'bg-primary border-primary' : 'bg-background border-border group-hover:border-muted'}`}>
      {checked && <Check className="w-3 h-3 text-white" />}
    </div>
    <span className="text-muted-foreground text-sm">{label}</span>
  </label>
);

// --- HELPER COMPONENT FOR FINGERPRINT ROWS ---
const FpRow = ({ label, description, children }) => (
  <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] items-start gap-2 lg:gap-6 border-b border-border pb-5 mb-5 last:border-0 last:pb-0 last:mb-0">
    <div className="mt-1">
      <label className="text-foreground font-medium text-sm block">{label}</label>
      {description && <p className="text-muted text-xs mt-1.5 leading-relaxed pr-4">{description}</p>}
    </div>
    <div className="w-full space-y-3">
      {children}
    </div>
  </div>
);

// --- GENERATORS ---
const generateMac = () => "XX-XX-XX-XX-XX-XX".replace(/X/g, () => "0123456789ABCDEF".charAt(Math.floor(Math.random() * 16)));
const generateDeviceName = () => "DESKTOP-" + Math.random().toString(36).substring(2, 9).toUpperCase();
// Plausible desktop core/RAM pairings (RAM scales with cores). Randomized per
// profile so the spoofed hardware is unique rather than a static 8/8.
//
// HOST_CORES is the real machine's core count (filled once from system info). We
// EXCLUDE it from the pool so a profile never spoofs to the exact value of the
// machine it was created on — otherwise the "spoofed" hardwareConcurrency is
// indistinguishable from real and looks like a leak (e.g. a 16-core PC getting a
// 16-core profile). Cross-machine the value is still plausible; locally it's
// always visibly different.
let HOST_CORES = null;
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
const generateCpuCores = () => {
  const pool = ['4', '6', '8', '8', '12', '16'].filter((c) => String(c) !== String(HOST_CORES));
  return pickOne(pool.length ? pool : ['4', '6', '8']);
};
const generateRamGb = (cores) => (Number(cores) >= 12 ? pickOne(['16', '32']) : pickOne(['8', '16']));

// --- DYNAMIC DATA GENERATORS & CONSTANTS ---
const CHROME_VERSIONS = ['Auto', ...Array.from({ length: 30 }, (_, i) => String(149 - i))];
const FIREFOX_VERSIONS = ['Auto', ...Array.from({ length: 32 }, (_, i) => String(151 - i))];

const OS_PLATFORMS = [
  { id: 'Windows', icon: Monitor, versions: ['All Windows', '11', '10', '8', '7'], logo: '/logos/windows.png' },
  { id: 'macOS', icon: Apple, versions: ['All macOS', '26', '15', '14', '13', '12', '11', '10'], logo: '/logos/macos.png' },
  { id: 'Linux', icon: Terminal, versions: ['All Linux', 'Ubuntu', 'Debian', 'Fedora', 'Arch', 'ChromeOS'], logo: '/logos/linux.png' },
  { id: 'Android', icon: Smartphone, versions: ['All Android', '15', '14', '13', '12', '11', '10', '9'], logo: '/logos/android.png' },
  { id: 'iOS', icon: Smartphone, versions: ['All iOS', '26', '18', '17', '16', '15', '14', '13', '12'], logo: '/logos/ios.png' }
];

const USER_AGENT_GROUPS = [
  { label: "Windows Desktop Browsers", platforms: ['Windows'], options: [ 
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0"
  ]},
  { label: "macOS Desktop Browsers", platforms: ['macOS'], options: [ 
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Safari/605.1.15",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  ]},
  { label: "Linux / Ubuntu / Fedora / ChromeOS", platforms: ['Linux'], options: [ 
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:151.0) Gecko/20100101 Firefox/151.0",
      "Mozilla/5.0 (X11; CrOS x86_64 14526.89.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  ]},
  { label: "Android Mobile, Brands & Tablets", platforms: ['Android'], options: [ 
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
      "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
      "Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36",
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36",
      "Mozilla/5.0 (Linux; Android 11; SM-T510) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  ]},
  { label: "iOS / iPadOS Mobile", platforms: ['iOS'], options: [ 
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (iPad; CPU OS 17_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/149.0.0.0 Mobile/15E148 Safari/604.1"
  ]},
  { label: "Bots, Scripts & Crawlers", platforms: ['Windows', 'macOS', 'Linux', 'Android', 'iOS'], options: [ 
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "curl/8.7.1",
      "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)"
  ]}
];

function osUaToken(os) {
  const v = String(os || 'Windows').toLowerCase();
  if (v.includes('mac')) return 'Macintosh; Intel Mac OS X 10_15_7';
  if (v.includes('linux')) return 'X11; Linux x86_64';
  if (v.includes('android')) return 'Linux; Android 13; Pixel 7';
  return 'Windows NT 10.0; Win64; x64';
}

// Build a Chrome User-Agent whose VERSION matches the selected browser, so the UA
// never disagrees with the real engine / Client-Hints. When chromeMajor is known
// (a concrete selected version, or the newest installed for "Auto") we synthesize
// the UA from it; otherwise we fall back to the legacy curated pool.
function generateAutoUserAgent(os, uaCategory, index = 0, chromeMajor = null) {
  if (chromeMajor) {
    const token = osUaToken(os);
    const mobile = String(os || '').toLowerCase().includes('android');
    return `Mozilla/5.0 (${token}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 ${mobile ? 'Mobile ' : ''}Safari/537.36`;
  }
  let relevantGroups = USER_AGENT_GROUPS.filter(g => g.platforms.includes(os));
  if (uaCategory !== 'All') {
    const specificGroup = relevantGroups.find(g => g.label === uaCategory);
    if (specificGroup) relevantGroups = [specificGroup];
  }
  const pool = relevantGroups.flatMap(g => g.options);
  if (!pool || pool.length === 0) return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
  return pool[index % pool.length];
}

const WEBGL_VENDORS = [
  "Google Inc. (NVIDIA)",
  "Google Inc. (Intel)",
  "Google Inc. (AMD)",
  "Apple Inc."
];

const WEBGL_RENDERERS = {
  "Google Inc. (NVIDIA)": [
    "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)"
  ],
  "Google Inc. (Intel)": [
    "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (Intel, Intel(R) HD Graphics 520 Direct3D11 vs_5_0 ps_5_0, D3D11)"
  ],
  "Google Inc. (AMD)": [
    "ANGLE (AMD, AMD Radeon RX 7900 XTX Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0, D3D11)"
  ],
  "Apple Inc.": [
    "Apple M3 Max",
    "Apple M2 Pro",
    "Apple M2",
    "Apple M1",
    "Apple GPU"
  ]
};

// --- INITIAL STATE ---
const initialProfileData = {
  id: null,
  name: '',
  browserCore: 'SunBrowser',
  browserBrand: 'Chrome',
  browserVersion: 'Auto',
  os: 'Windows',
  osVersion: 'All Windows',
  deviceClass: 'desktop', // 'desktop' | 'mobile' (Android) — drives touch + viewport at launch
  uaCategory: 'All',
  userAgent: 'Auto',
  group: 'Ungrouped',
  tags: '',
  cookie: '',
  remark: '',
  
  startupUrls: '',
  platformAccounts: [],
  twoFactorSeed: '',

  proxySetting: 'Custom',
  proxyType: 'HTTP',
  enableQuic: false,
  ipChecker: 'IP2Location',
  proxyHost: '',
  proxyPort: '',
  proxyUser: '',
  proxyPass: '',
  changeIpUrl: '',
  selectedSavedProxy: '',
  rotIp: '',
  rotCountry: '',
  rotRegion: '',
  rotCity: '',
  proxyProvider: 'Smartproxy',
  proxyApiKey: '',

  // -- COMPREHENSIVE FINGERPRINT STATES --
  webrtc: 'Forward',
  timezoneType: 'Based on IP',
  timezoneCustom: '',
  locationType: 'Based on IP',
  locationPrompt: 'Ask each time',
  locationLat: '',
  locationLng: '',
  locationAcc: '10',
  languageType: 'Based on IP',
  languageCustom: 'en-US,en;q=0.9',
  displayLangType: 'Based on Language',
  displayLangCustom: 'en-US',
  resolutionType: 'Random',
  resolutionPredefined: '1920x1080',
  resolutionW: '1920',
  resolutionH: '1080',
  fontsType: 'Default',
  
  canvasNoise: true,
  webglImageNoise: true,
  audioContextNoise: true,
  clientRectsNoise: true,
  speechVoicesNoise: true,
  mediaDevice: 'Auto',
  
  webglMetadata: 'Real',
  webglVendor: 'Google Inc. (NVIDIA)',
  webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  webgpu: 'Based on WebGL',
  
  // Spoofed by DEFAULT — never expose the real machine unless the user flips a
  // field to "Real". Concrete values are randomized per profile in openCreate().
  cpuType: 'Custom',
  cpuCores: '8',
  ramType: 'Custom',
  ramGb: '16',
  deviceNameType: 'Custom',
  deviceName: generateDeviceName(),
  macAddressType: 'Custom',
  macAddress: generateMac(),
  
  doNotTrack: 'Default',
  portScanProtection: 'Enable',
  hardwareAcceleration: 'Default',
  disableTls: 'Close',
  launchArgs: '',

  // -- ADVANCED TAB STATES --
  advancedExt: 'Team',
  advancedSync: 'Global',
  syncItems: { cookie: true, passwords: true, bookmarks: true, localStorage: true, indexedDB: true, extensionData: true, history: false },
  advancedBrowser: 'Global',
  browserSettings: {
    matchTimezone: true, allowChromeSignIn: false, offerTranslate: false, disableDevTools: false, disableExtInstall: false,
    enableVirtualCamera: false, enableMobileSim: false, startupAction: 'lastPage', onlyOpenWithProxy: false,
    onlyOpenExtLoaded: false, checkCountryMatch: false, secureAccess: false, disableVideos: false, disableImagesLimit: '0'
  },
  randomFingerprint: false,
};

const MOCK_SAVED_PROXIES = [
  { id: '1', name: 'US Rotating - SmartProxy', host: 'proxy.smartproxy.com', port: '10000', tags: 'US, Unused' },
  { id: '2', name: 'UK Datacenter - Oxylabs', host: 'uk.oxylabs.io', port: '8000', tags: 'UK, Unused' }
];

// Bulk-tag dialog for the current selection. Markup is unchanged from its former
// inline form; useDialog adds Escape/focus-trap/scroll-lock without altering it.
function TagModal({ onClose, count, tagInput, setTagInput, allTags, bulkBusy, onAssign }) {
  const { t } = useTranslation('profiles');
  const { dialogRef } = useDialog({ onClose, closeOnEscape: !bulkBusy });
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('tagModal.ariaLabel')} tabIndex={-1} className="w-full max-w-sm rounded-xl border border-border bg-card shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-foreground">{t('tagModal.title', { count })}</h3>
        <p className="text-xs text-muted-foreground mt-1">{t('tagModal.subtitle')}</p>
        <input
          list="sg-all-tags"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          placeholder={t('tagModal.placeholder')}
          className="mt-4 w-full bg-input-background border border-border rounded px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        />
        <datalist id="sg-all-tags">{allTags.map((t) => <option key={t} value={t} />)}</datalist>
        <div className="mt-4 flex gap-2 justify-end">
          <Button size="sm" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button size="sm" variant="secondary" disabled={bulkBusy || !tagInput.trim()} onClick={() => onAssign('remove')}>{t('tagModal.remove')}</Button>
          <Button size="sm" variant="primary" disabled={bulkBusy || !tagInput.trim()} onClick={() => onAssign('add')}>{t('tagModal.add')}</Button>
        </div>
      </div>
    </div>
  );
}

// Bulk-rename dialog for the current selection. Markup unchanged from its former
// inline form; useDialog adds the standard modal a11y behaviors.
function RenameModal({ onClose, count, renamePrefix, setRenamePrefix, renameStart, setRenameStart, bulkBusy, onRename }) {
  const { t } = useTranslation('profiles');
  const { dialogRef } = useDialog({ onClose, closeOnEscape: !bulkBusy });
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('renameModal.ariaLabel')} tabIndex={-1} className="w-full max-w-sm rounded-xl border border-border bg-card shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-foreground">{t('renameModal.title', { count })}</h3>
        <p className="text-xs text-muted-foreground mt-1">{t('renameModal.subtitle')}</p>
        <div className="mt-4 flex gap-2">
          <input value={renamePrefix} onChange={(e) => setRenamePrefix(e.target.value)} placeholder={t('renameModal.prefixPlaceholder')} className="flex-1 bg-input-background border border-border rounded px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
          <input type="number" min={0} value={renameStart} onChange={(e) => setRenameStart(Number(e.target.value) || 0)} className="w-20 bg-input-background border border-border rounded px-2 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary" title={t('renameModal.startNumber')} />
        </div>
        {renamePrefix.trim() && (
          <p className="mt-2 text-xs text-muted-foreground">{t('renameModal.preview')} <span className="text-foreground font-medium">{renamePrefix.trim()} {Number(renameStart) || 0}</span>, {renamePrefix.trim()} {(Number(renameStart) || 0) + 1}, …</p>
        )}
        <div className="mt-4 flex gap-2 justify-end">
          <Button size="sm" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button size="sm" variant="primary" disabled={bulkBusy || !renamePrefix.trim()} onClick={onRename}>{t('renameModal.rename')}</Button>
        </div>
      </div>
    </div>
  );
}

export default function ProfilesPage() {
  const { t } = useTranslation('profiles');
  const [profiles, setProfiles] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  
  const [view, setView] = useState('list');
  const [activeTab, setActiveTab] = useState('General');
  const [pd, setPd] = useState(initialProfileData);

  const [checkingProxy, setCheckingProxy] = useState(false);
  const [proxyResult, setProxyResult] = useState(null);

  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [launchProgress, setLaunchProgress] = useState(null); // { done, total } during a bulk launch
  const [copied2fa, setCopied2fa] = useState(null); // profileId whose code was just copied
  const [leakProfile, setLeakProfile] = useState(null);
  const [cookieProfile, setCookieProfile] = useState(null);
  const [loadingCookies, setLoadingCookies] = useState(false);
  const [showBrowserManager, setShowBrowserManager] = useState(false);
  const [rotationProfile, setRotationProfile] = useState(null);
  const [envProfile, setEnvProfile] = useState(null);
  const [previewDraft, setPreviewDraft] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showQuickGen, setShowQuickGen] = useState(false);
  const [activityProfile, setActivityProfile] = useState(null);
  const [groups, setGroups] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [allProxies, setAllProxies] = useState([]);
  const [proxyGroups, setProxyGroups] = useState([]);
  const [runningIds, setRunningIds] = useState(() => new Set());
  const [locks, setLocks] = useState({}); // profileId -> { memberName, mine } (in-use-by-another-member)
  const [installedBrowsers, setInstalledBrowsers] = useState([]);
  const [filterGroup, setFilterGroup] = useState('all');
  const [filterTag, setFilterTag] = useState('');
  const [filterProxy, setFilterProxy] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showTagModal, setShowTagModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [compareProfiles, setCompareProfiles] = useState(null); // profiles being compared
  const [filterPresets, setFilterPresets] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [renamePrefix, setRenamePrefix] = useState('');
  const [renameStart, setRenameStart] = useState(1);

  const filteredProfiles = useMemo(() => {
    let list = profiles;
    if (filterGroup === 'ungrouped') list = list.filter((p) => p.groupId == null);
    else if (filterGroup !== 'all') list = list.filter((p) => p.groupId === Number(filterGroup));
    if (filterTag) list = list.filter((p) => (p.tags || []).includes(filterTag));
    if (filterProxy === 'none') list = list.filter((p) => !p.proxyId);
    else if (filterProxy) list = list.filter((p) => p.proxyId === Number(filterProxy));
    if (filterStatus === 'running') list = list.filter((p) => runningIds.has(p.id));
    else if (filterStatus === 'proxied') list = list.filter((p) => !!p.proxyId);
    else if (filterStatus === 'direct') list = list.filter((p) => !p.proxyId);
    return list;
  }, [profiles, filterGroup, filterTag, filterProxy, filterStatus, runningIds]);

  // Universal pagination (items-per-page selector via the shared Pager).
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const pageCount = pageSize === Infinity ? 1 : Math.max(1, Math.ceil(filteredProfiles.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pagedProfiles = pageSize === Infinity ? filteredProfiles : filteredProfiles.slice((safePage - 1) * pageSize, safePage * pageSize);
  useEffect(() => { setPage(1); }, [filterGroup, filterTag, filterProxy, filterStatus, pageSize]);

  // Real, derived counts for the header subtitle + stat cards (no mock data).
  const totalCount = profiles.length;
  const runningCount = useMemo(
    () => profiles.filter((p) => runningIds.has(p.id)).length,
    [profiles, runningIds]
  );
  const proxiedCount = useMemo(
    () => profiles.filter((p) => !!p.proxyId || !!p.proxyInfoString).length,
    [profiles]
  );
  
  const isEditing = Boolean(pd.id);
  const tabs = ['General', 'Proxy', 'Platform', 'Fingerprint', 'Advanced']; 

  const currentOsObj = OS_PLATFORMS.find(o => o.id === pd.os) || OS_PLATFORMS[0];
  // Prefer the real installed Chrome majors (newest first) for SunBrowser; fall
  // back to the static list when none are detected on disk.
  const installedMajors = useMemo(() => {
    const set = new Set(installedBrowsers.map((b) => String(b.major)));
    return ['Auto', ...Array.from(set).sort((a, b) => Number(b) - Number(a))];
  }, [installedBrowsers]);
  const browserVersionsList = pd.browserCore === 'SunBrowser'
    ? (installedMajors.length > 1 ? installedMajors : CHROME_VERSIONS)
    : FIREFOX_VERSIONS;
  const filteredUAGroups = USER_AGENT_GROUPS.filter(g => g.platforms.includes(pd.os));

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [profs, grps, tgs, pxs, sess, lockMap, pgs] = await Promise.all([
        softglazeApi.profiles.list({ search }),
        softglazeApi.groups.list(),
        softglazeApi.tags.list(),
        softglazeApi.proxies.list({}),
        softglazeApi.sessions.list(),
        softglazeApi.profiles.getLocks().catch(() => ({})),
        softglazeApi.proxyGroups.list().catch(() => [])
      ]);
      setProfiles(profs);
      setGroups(grps);
      setAllTags(tgs);
      setAllProxies(pxs);
      setProxyGroups(Array.isArray(pgs) ? pgs : []);
      setRunningIds(new Set((sess || []).map((sx) => Number(sx.id))));
      setLocks(lockMap || {});
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { loadData(); }, [loadData]);

  // Learn the real machine's core count once so generated profiles never spoof to
  // the exact host value (which would look like a hardware leak — see HOST_CORES).
  useEffect(() => {
    softglazeApi.system.getInfo().then((i) => { if (i && i.cpuCount) HOST_CORES = i.cpuCount; }).catch(() => {});
  }, []);

  // Keep the running indicator / Stop button in sync. Sessions also end when the
  // user closes the browser window directly, so poll instead of relying only on
  // launch/close handlers.
  const refreshSessions = useCallback(async () => {
    try {
      const [sess, lockMap] = await Promise.all([
        softglazeApi.sessions.list(),
        softglazeApi.profiles.getLocks().catch(() => ({}))
      ]);
      setRunningIds(new Set((sess || []).map((sx) => Number(sx.id))));
      setLocks(lockMap || {});
    } catch (e) { /* transient */ }
  }, []);

  useEffect(() => {
    const t = setInterval(refreshSessions, 4000);
    return () => clearInterval(t);
  }, [refreshSessions]);

  // Live bulk-launch progress: update the counter as each profile spawns, refresh
  // the running indicators incrementally, and clear when the batch finishes.
  useEffect(() => {
    if (!softglazeApi.profiles.onBulkLaunchProgress) return undefined;
    const off = softglazeApi.profiles.onBulkLaunchProgress((p) => {
      if (!p) return;
      if (p.phase === 'start') { setLaunchProgress({ done: 0, total: p.total }); return; }
      if (p.phase === 'launched') { setLaunchProgress({ done: p.done, total: p.total }); refreshSessions(); return; }
      if (p.phase === 'done') { setLaunchProgress(null); refreshSessions(); }
    });
    return off;
  }, [refreshSessions]);

  // Load saved filter presets (stored in global Settings).
  useEffect(() => {
    softglazeApi.settings.getGlobal()
      .then((g) => { if (Array.isArray(g?.profileFilters)) setFilterPresets(g.profileFilters); })
      .catch(() => {});
  }, []);

  // Load the real Chrome builds installed on disk so the version picker only
  // offers versions that will actually launch a matching real binary.
  const refreshInstalledBrowsers = useCallback(() => {
    softglazeApi.system.listBrowsers()
      .then((r) => setInstalledBrowsers(r && Array.isArray(r.browsers) ? r.browsers : []))
      .catch(() => setInstalledBrowsers([]));
  }, []);
  useEffect(() => { refreshInstalledBrowsers(); }, [refreshInstalledBrowsers]);

  async function handleQuickGenerate(config, onProgress) {
    const { count, baseName, startIndex, groupId, newGroupName, os, randomize, proxyMode, pasted, startupUrls, proxySource } = config;
    if (onProgress) onProgress(0, count);
    // proxySource (pool mode only): '' = all, 'group:<id>', or 'provider:<key>'.
    const src = String(proxySource || '');
    const proxyGroupId = src.startsWith('group:') ? src.slice(6) : undefined;
    const provider = src.startsWith('provider:') ? src.slice(9) : undefined;
    // Server-side batch generator owns the batch-level invariants the old per-profile
    // loop could not: a UNIQUE proxy per profile (capped at availability), UNIQUE
    // fingerprints, and even Chrome-version distribution.
    const result = await softglazeApi.profiles.batchGenerate({
      count,
      prefix: baseName,
      startIndex,
      os,
      deviceClass: /android|mobile/i.test(String(os)) ? 'mobile' : 'desktop',
      randomFingerprint: randomize,
      distributeVersions: randomize,
      startupUrls,
      groupId: groupId && groupId !== 'ungrouped' ? groupId : null,
      newGroupName: newGroupName || null,
      proxyMode, // 'direct' | 'unique' | 'pool' | 'paste'
      proxyGroupId,
      provider,
      proxyList: pasted
    });
    if (onProgress) onProgress(result?.createdCount ?? count, count);
    await loadData();
    return result;
  }

  function openCreate() {
    const cores = generateCpuCores();
    setPd({
      ...initialProfileData,
      userAgent: 'Auto',
      cpuType: 'Custom', cpuCores: cores,
      ramType: 'Custom', ramGb: generateRamGb(cores),
      deviceNameType: 'Custom', deviceName: generateDeviceName(),
      macAddressType: 'Custom', macAddress: generateMac()
    });
    setActiveTab('General');
    setView('editor');
    setError('');
  }

  function openEdit(profile) {
    let pHost = '', pPort = '', pUser = '', pPass = '';
    if (profile.proxyInfoString) {
      const parts = profile.proxyInfoString.split(':');
      pHost = parts[0] || ''; pPort = parts[1] || ''; pUser = parts[2] || ''; pPass = parts[3] || '';
    }

    setPd({ 
      ...initialProfileData, 
      ...profile,
      id: profile.id, 
      name: profile.title || '', 
      remark: profile.notes || '', 
      userAgent: profile.userAgent || 'Auto',
      group: profile.group || 'Ungrouped',
      tags: profile.tags || '',
      cookie: profile.cookie || '',
      startupUrls: profile.startupUrls || '',
      platformAccounts: profile.platformAccounts || [],
      proxyHost: pHost, proxyPort: pPort, proxyUser: pUser, proxyPass: pPass,
      proxyType: profile.proxyType || 'HTTP',
      // Pre-select the linked saved proxy so editing shows it (and re-saving keeps
      // PROFILE_PROXY instead of silently reverting to DIRECT).
      proxySetting: profile.proxyId ? 'Saved Proxies' : 'Custom',
      selectedSavedProxy: profile.proxyId ? String(profile.proxyId) : ''
    });
    setActiveTab('General'); 
    setView('editor');
    setError('');
  }

  function closeEditor() { 
    setView('list'); setPd(initialProfileData); setError('');
  }

  const updatePd = (k, v) => {
    setPd(prev => {
      const nextState = { ...prev, [k]: v };
      if (k === 'os') {
        const newOsObj = OS_PLATFORMS.find(o => o.id === v);
        nextState.osVersion = newOsObj.versions[0];
        nextState.uaCategory = 'All'; nextState.userAgent = 'Auto';
        // Device class + a coherent GPU/screen follow the platform. Android is a
        // mobile device (touchscreen + small high-DPR screen + a mobile GPU); the
        // launch engine emulates the metrics, and here we keep the saved
        // fingerprint coherent so the leak check doesn't (rightly) flag a mobile
        // UA paired with a desktop GPU.
        if (v === 'Android') {
          nextState.deviceClass = 'mobile';
          nextState.resolutionType = 'Custom';
          nextState.resolutionW = '412';
          nextState.resolutionH = '915';
          nextState.webglMetadata = 'Custom';
          nextState.webglVendor = 'Google Inc. (ARM)';
          nextState.webglRenderer = 'ANGLE (ARM, Mali-G710 MC10, OpenGL ES 3.2)';
        } else {
          nextState.deviceClass = 'desktop';
          // Coming back from a mobile selection — restore a desktop GPU/screen.
          if (prev.deviceClass === 'mobile') {
            nextState.resolutionType = 'Random';
            nextState.resolutionW = '1920';
            nextState.resolutionH = '1080';
            nextState.webglMetadata = 'Real';
            nextState.webglVendor = 'Google Inc. (NVIDIA)';
            nextState.webglRenderer = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)';
          }
        }
      }
      if (k === 'browserCore') nextState.browserVersion = 'Auto'; 
      if (k === 'uaCategory') nextState.userAgent = 'Auto'; 
      return nextState;
    });
  };

  const updateNestedPd = (category, k, v) => {
    setPd(prev => ({ ...prev, [category]: { ...prev[category], [k]: v } }));
  };

  const handleRollAgent = () => {
    const newAgent = generateAutoUserAgent(pd.os, pd.uaCategory, Math.floor(Math.random() * 10000), effectiveChromeMajor);
    updatePd('userAgent', newAgent);
  };

  const handleRandomWebGL = () => {
    const vendors = Object.keys(WEBGL_RENDERERS);
    const randomVendor = vendors[Math.floor(Math.random() * vendors.length)];
    const renderers = WEBGL_RENDERERS[randomVendor];
    const randomRenderer = renderers[Math.floor(Math.random() * renderers.length)];
    updatePd('webglVendor', randomVendor);
    updatePd('webglRenderer', randomRenderer);
  };

  const handleProxyPaste = (e) => {
    const pastedText = e.clipboardData.getData('text');
    const parts = pastedText.split(':');
    if (parts.length >= 2 && parts.length <= 4) {
      e.preventDefault();
      setPd(prev => ({ ...prev, proxyHost: parts[0] || '', proxyPort: parts[1] || '', proxyUser: parts[2] || '', proxyPass: parts[3] || '' }));
    }
  };

  const constructProxyString = () => {
    if (!pd.proxyHost) return '';
    let str = `${pd.proxyHost}:${pd.proxyPort}`;
    if (pd.proxyUser) str += `:${pd.proxyUser}`;
    if (pd.proxyUser && pd.proxyPass) str += `:${pd.proxyPass}`;
    return str;
  };

  // Pull the profile's persisted cookies into the editor field. Works whether or
  // not the profile is running (the backend reads them headlessly when offline).
  async function handleLoadCookies() {
    if (!pd.id) return;
    setLoadingCookies(true);
    setError('');
    try {
      const res = await softglazeApi.profiles.exportCookies(pd.id, 'json');
      updatePd('cookie', res.content || '');
      if (!res.count) setError(t('errors.noCookies'));
    } catch (err) {
      setError(err.message || t('errors.loadCookies'));
    } finally {
      setLoadingCookies(false);
    }
  }

  async function handleSaveProfile() {
    if (!pd.name) return setError(t('errors.nameRequired'));
    setSaving(true);
    try {
      const finalUA = pd.userAgent === 'Auto' ? generateAutoUserAgent(pd.os, pd.uaCategory, profiles.length, effectiveChromeMajor) : pd.userAgent;
      // Resolve the proxy from whichever mode the user picked. The old code only
      // honored a manually-typed proxy, so selecting a SAVED proxy silently fell
      // back to DIRECT (no proxy) and leaked the real IP. Now both modes set a
      // proxy AND flip systemProxyBehavior to PROFILE_PROXY so launch applies it.
      const proxyRaw = pd.proxySetting === 'Custom' ? constructProxyString() : '';
      const savedProxyId = pd.proxySetting === 'Saved Proxies' && pd.selectedSavedProxy
        ? Number(pd.selectedSavedProxy) : null;
      const usingProxy = Boolean(proxyRaw) || Boolean(savedProxyId);

      const payload = {
        ...pd,
        title: pd.name,
        notes: pd.remark,
        proxyRaw: proxyRaw || null,
        proxyId: savedProxyId,                 // explicit: links the saved proxy (null clears it)
        systemProxyBehavior: usingProxy ? 'PROFILE_PROXY' : 'DIRECT',
        tagManagement: 0,
        dataDirName: pd.name,
        userAgent: finalUA
      };
      
      if (isEditing) await softglazeApi.profiles.update({ id: pd.id, ...payload });
      else await softglazeApi.profiles.create(payload);
      
      closeEditor(); await loadData();
    } catch (err) { setError(err.message); } 
    finally { setSaving(false); }
  }

  async function handleLaunch(profileId) {
    try {
      await softglazeApi.profiles.launch(profileId, { startUrl: 'about:blank' });
      // Refresh running state so the row flips to a Stop button immediately.
      await refreshSessions();
    } catch (err) { setError(err.message); }
  }

  async function handleClone(profileId, reroll = false) {
    try { await softglazeApi.profiles.clone(profileId, { reroll }); await loadData(); }
    catch (err) { setError(err.message); }
  }

  function handleDelete(profileId, title) {
    setDeleteTarget({ id: profileId, title });
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelectedIds((prev) => (prev.size === filteredProfiles.length ? new Set() : new Set(filteredProfiles.map((p) => p.id))));
  }
  function clearSelection() { setSelectedIds(new Set()); }

  async function handleBulkLaunch() {
    if (selectedIds.size === 0) return;
    setBulkBusy(true); setError('');
    try { await softglazeApi.profiles.bulkLaunch([...selectedIds]); await refreshSessions(); }
    catch (err) { setError(err.message); }
    finally { setBulkBusy(false); setLaunchProgress(null); }
  }
  async function handleBulkClose(ids) {
    // Called two ways: from the bulk bar (no arg → use selection) and from a
    // single row's Stop button (handleBulkClose([id])). Honor an explicit list.
    const targets = Array.isArray(ids) && ids.length ? ids : [...selectedIds];
    if (targets.length === 0) return;
    setBulkBusy(true); setError('');
    try {
      await softglazeApi.profiles.bulkClose(targets);
      await refreshSessions();
    } catch (err) { setError(err.message); }
    finally { setBulkBusy(false); }
  }
  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    if (!window.confirm(t('confirm.bulkDelete', { count: selectedIds.size }))) return;
    setBulkBusy(true); setError('');
    try { await softglazeApi.profiles.bulkDelete([...selectedIds]); clearSelection(); await loadData(); }
    catch (err) { setError(err.message); }
    finally { setBulkBusy(false); }
  }

  async function handleTagAssign(mode) {
    const tag = tagInput.trim();
    if (!tag || selectedIds.size === 0) return;
    setBulkBusy(true); setError('');
    try { await softglazeApi.profiles.tagAssign([...selectedIds], tag, mode); setShowTagModal(false); setTagInput(''); await loadData(); }
    catch (err) { setError(err.message); }
    finally { setBulkBusy(false); }
  }
  async function handleBulkRename() {
    const prefix = renamePrefix.trim();
    if (!prefix || selectedIds.size === 0) return;
    setBulkBusy(true); setError('');
    // Send ids in the current visible (filtered) order so the numbering matches the table.
    const orderedIds = filteredProfiles.filter((p) => selectedIds.has(p.id)).map((p) => p.id);
    try { await softglazeApi.profiles.bulkRename({ ids: orderedIds, prefix, start: Number(renameStart) || 1 }); setShowRenameModal(false); await loadData(); }
    catch (err) { setError(err.message); }
    finally { setBulkBusy(false); }
  }
  function openCompare() {
    const chosen = filteredProfiles.filter((p) => selectedIds.has(p.id)).slice(0, 3);
    if (chosen.length >= 2) setCompareProfiles(chosen);
  }
  function applyPreset(preset) {
    if (!preset) return;
    setFilterGroup(preset.group ?? 'all');
    setFilterTag(preset.tag ?? '');
    setFilterProxy(preset.proxy ?? '');
    setFilterStatus(preset.status ?? 'all');
    setSearch(preset.search ?? '');
  }
  async function saveCurrentPreset() {
    const name = window.prompt(t('filters.savePresetPrompt'));
    if (!name || !name.trim()) return;
    const preset = { name: name.trim().slice(0, 40), group: filterGroup, tag: filterTag, proxy: filterProxy, status: filterStatus, search };
    const next = [...filterPresets.filter((p) => p.name !== preset.name), preset];
    setFilterPresets(next);
    try { await softglazeApi.settings.setGlobal({ profileFilters: next }); } catch (err) { setError(err.message); }
  }

  // Softglaze Premium — fetch the live TOTP for a profile and copy it to the
  // clipboard, flashing a "Copied!" tooltip on its badge.
  async function handleCopy2fa(profileId) {
    setError('');
    try {
      const { token } = await softglazeApi.profiles.get2faToken(profileId);
      await navigator.clipboard.writeText(token);
      setCopied2fa(profileId);
      setTimeout(() => setCopied2fa((cur) => (cur === profileId ? null : cur)), 1500);
    } catch (err) { setError(err.message || t('errors.gen2fa')); }
  }

  // Softglaze Premium — launch selected profiles as one Master + Slave windows.
  async function handleSynchronize() {
    if (selectedIds.size < 2) { setError(t('errors.syncMin')); return; }
    setBulkBusy(true); setError('');
    try {
      await softglazeApi.profiles.bulkSynchronize([...selectedIds]);
      await refreshSessions();
    } catch (err) { setError(err.message || t('errors.syncFailed')); }
    finally { setBulkBusy(false); }
  }

  async function handleCheckProxy(e) {
    e.preventDefault();
    const proxyRaw = constructProxyString();
    if (pd.proxySetting === 'Custom' && (!pd.proxyHost || !pd.proxyPort)) return setError(t('errors.proxyHostPort'));
    setCheckingProxy(true); setError(''); setProxyResult(null);
    try {
      setProxyResult(await softglazeApi.proxies.check({ type: pd.proxyType, raw: proxyRaw }));
    } catch (err) {
      setError(err.message || t('errors.proxyCheckFailed'));
    } finally { 
      setCheckingProxy(false); 
    }
  }

  // Resolve the Chrome major that will actually launch: a concrete selected
  // version, else the newest installed build ("Auto"). Used so every generated /
  // previewed UA matches the engine and never trips the pre-launch UA check.
  const effectiveChromeMajor = (() => {
    const v = String(pd.browserVersion || '').trim();
    const m = v.match(/^(\d+)/);
    if (m) return Number(m[1]);
    const majors = installedBrowsers.map((b) => Number(b.major)).filter(Boolean);
    return majors.length ? Math.max(...majors) : null;
  })();

  // The engine launches the REAL Chrome binary for the selected version, so the
  // preview UA must follow it (not a stale random UA). 'Auto' → newest installed.
  const displayUA = (() => {
    if (pd.userAgent && pd.userAgent !== 'Auto') return pd.userAgent;
    return generateAutoUserAgent(pd.os, pd.uaCategory, profiles.length, effectiveChromeMajor);
  })();

  // --- EDITOR VIEW ---
  if (view === 'editor') {
    return (
      <div className="w-full h-full bg-card text-foreground font-sans flex flex-col rounded border border-border overflow-hidden shadow-2xl">
        <div className="bg-surface border-b border-border px-5 py-4 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={closeEditor} className="p-1.5 hover:bg-muted-dark rounded text-muted hover:text-foreground transition"><ArrowLeft className="h-5 w-5" /></button>
            <h1 className="text-lg font-bold text-foreground tracking-tight">{isEditing ? t('editor.titleEdit') : t('editor.titleNew')}</h1>
          </div>
          <div className="flex items-center gap-3 text-xs text-amber-400 bg-amber-500/10 px-4 py-2 rounded border border-amber-500/20">
            <ShieldCheck className="h-4 w-4" /> {t('editor.authBanner')}
          </div>
        </div>

        {error && <div className="mx-6 mt-5 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}

        <div className="flex-1 overflow-y-auto p-6 flex flex-col xl:flex-row gap-6">
          <div className="flex-1 bg-surface rounded border border-border overflow-hidden flex flex-col min-w-0 shadow-sm">
            <div className="flex border-b border-border bg-surface overflow-x-auto shrink-0 sticky top-0 z-10 px-2 pt-2">
              {tabs.map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} className={`whitespace-nowrap px-6 py-3 text-sm font-medium transition-all border-b-2 rounded-t ${activeTab === tab ? 'border-primary text-primary bg-primary/10' : 'border-transparent text-muted hover:text-foreground hover:bg-card'}`}>{t(`tabs.${tab.toLowerCase()}`)}</button>
              ))}
            </div>

            <div className="p-6 overflow-y-auto flex-1 text-sm">
              
              {/* General Tab */}
              {activeTab === 'General' && (
                <div className="space-y-6 max-w-3xl">
                  <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-center gap-2 lg:gap-4">
                    <label htmlFor="pf-general-name" className="text-left lg:text-right text-muted font-medium">{t('general.name')}</label>
                    <input id="pf-general-name" type="text" value={pd.name} onChange={e => updatePd('name', e.target.value)} placeholder={t('general.namePlaceholder')} className="w-full bg-background border border-border rounded px-4 py-2.5 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary transition" />
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-center gap-2 lg:gap-4">
                    <label className="text-left lg:text-right text-muted font-medium">{t('general.browser')}</label>
                    <div className="flex flex-wrap gap-4">
                      {['SunBrowser', 'FlowerBrowser'].map(core => (
                        <div key={core} className={`flex items-center rounded border transition shadow-sm ${pd.browserCore === core ? 'border-primary bg-primary/10' : 'border-border bg-background hover:border-muted'}`}>
                          <button onClick={() => updatePd('browserCore', core)} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-foreground">
                            <div className={`w-4 h-4 rounded-full ${core === 'SunBrowser' ? 'bg-blue-500' : 'bg-orange-500'}`}></div>
                            {core}
                          </button>
                          <div className="w-px h-6 bg-border"></div>
                          <BrowserVersionSelect
                            core={core}
                            value={pd.browserCore === core ? pd.browserVersion : 'Auto'}
                            onChange={(v) => { updatePd('browserCore', core); updatePd('browserVersion', v); }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  {pd.browserCore === 'SunBrowser' && (
                    <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] gap-2 lg:gap-4">
                      <span />
                      <div>
                        <p className="text-xs text-muted">
                          {installedBrowsers.length > 0
                            ? t('general.installedBuilds', { count: installedBrowsers.length })
                            : t('general.noBuilds')}
                        </p>
                        <button type="button" onClick={() => setShowBrowserManager(true)} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary-hover transition">
                          <Download className="w-3.5 h-3.5" /> {t('general.downloadMore')}
                        </button>
                      </div>
                    </div>
                  )}
                  {pd.browserCore === 'SunBrowser' && (
                    <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] gap-2 lg:gap-4">
                      <label className="text-left lg:text-right text-muted font-medium pt-2">{t('general.identity')}</label>
                      <div>
                        <BrowserBrandSelect value={pd.browserBrand || 'Chrome'} onChange={(v) => updatePd('browserBrand', v)} />
                        <p className="mt-2 text-xs text-muted">
                          {t('general.identityHelpPre')}<span className="text-foreground">{t('general.identityHelpEmph')}</span>{t('general.identityHelpPost')}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-center gap-2 lg:gap-4">
                    <label className="text-left lg:text-right text-muted font-medium">{t('general.os')}</label>
                    <div className="flex flex-wrap gap-3">
                      {OS_PLATFORMS.map(os => {
                        const Icon = os.icon;
                        const isSelected = pd.os === os.id;
                        return (
                          <div key={os.id} className={`flex items-center rounded border transition shadow-sm ${isSelected ? 'border-primary bg-primary/10' : 'border-border bg-background hover:border-muted'}`}>
                            <button onClick={() => updatePd('os', os.id)} className="flex items-center gap-2 px-3 py-2">
                              <div className={`flex items-center justify-center w-4 h-4 rounded border ${isSelected ? 'bg-primary border-primary' : 'border-muted'}`}>
                                {isSelected && <Check className="w-3 h-3 text-white" />}
                              </div>
                              <Icon className={`w-4 h-4 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                            </button>
                            <div className="w-px h-6 bg-border"></div>
                            <div className="relative">
                              <select value={isSelected ? pd.osVersion : os.versions[0]} onChange={e => { updatePd('os', os.id); updatePd('osVersion', e.target.value); }} className="appearance-none bg-transparent outline-none text-muted hover:text-foreground px-3 pr-8 py-2 text-sm cursor-pointer">
                                {os.versions.map(v => <option key={v} value={v} className="bg-surface text-foreground">{v}</option>)}
                              </select>
                              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="w-full h-px bg-border"></div>

                  <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-start gap-2 lg:gap-4">
                    <div className="text-left lg:text-right mt-2"><label className="text-muted font-medium block">{t('general.userAgent')}</label></div>
                    <div className="w-full flex flex-col sm:flex-row gap-3 items-start">
                      <CustomSelect value={pd.uaCategory} onChange={e => updatePd('uaCategory', e.target.value)} className="w-full sm:w-[200px] shrink-0">
                        <option value="All">{t('general.allCategories')}</option>
                        {filteredUAGroups.map((g, i) => <option key={i} value={g.label}>{g.label}</option>)}
                      </CustomSelect>
                      <div className="flex w-full gap-2">
                        <CustomSelect value={pd.userAgent} onChange={e => updatePd('userAgent', e.target.value)} className="flex-1 min-w-0">
                          <option value="Auto">{t('general.uaAuto')}</option>
                          {filteredUAGroups.filter(g => pd.uaCategory === 'All' || g.label === pd.uaCategory).map((group, idx) => (
                            <optgroup key={idx} label={group.label} className="bg-surface text-primary font-semibold italic">
                              {group.options.map((ua, optIdx) => (
                                <option key={optIdx} value={ua} className="text-foreground font-mono not-italic text-xs">{ua.length > 60 ? ua.slice(0, 60) + '...' : ua}</option>
                              ))}
                            </optgroup>
                          ))}
                        </CustomSelect>
                        <button type="button" onClick={handleRollAgent} title={t('general.swapUa')} className="shrink-0 h-10 w-10 flex items-center justify-center bg-surface hover:bg-muted-dark border border-border text-foreground rounded transition"><RefreshCcw className="w-4 h-4" /></button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-center gap-2 lg:gap-4">
                    <label className="text-left lg:text-right text-muted font-medium"><span className="text-red-500 mr-1">*</span>{t('general.group')}</label>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <CustomSelect value={pd.group} onChange={e => updatePd('group', e.target.value)} className="w-full sm:w-[220px]">
                        <option value="Ungrouped">{t('general.ungrouped')}</option><option value="New">{t('general.addNewGroup')}</option><option value="Lead Gen">Lead Gen</option>
                      </CustomSelect>
                      <div className="flex-1 flex items-center gap-2 bg-background border border-border rounded px-3 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition">
                        <Tag className="w-4 h-4 text-muted" />
                        <input type="text" value={pd.tags} onChange={e => updatePd('tags', e.target.value)} placeholder={t('general.tagsPlaceholder')} className="w-full bg-transparent outline-none text-foreground py-2.5 text-sm" />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-start gap-2 lg:gap-4">
                    <label htmlFor="pf-general-cookie" className="text-left lg:text-right text-muted font-medium mt-2">{t('general.cookie')}</label>
                    <div className="w-full">
                      <textarea id="pf-general-cookie" value={pd.cookie} onChange={e => updatePd('cookie', e.target.value)} rows="3" placeholder={t('general.cookiePlaceholder')} className="w-full bg-background border border-border rounded px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-y font-mono text-xs transition"></textarea>
                      {isEditing && (
                        <div className="flex items-center justify-end gap-3 mt-2">
                          <button type="button" onClick={handleLoadCookies} disabled={loadingCookies} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary-hover disabled:opacity-50 transition">
                            {loadingCookies ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Cookie className="w-3.5 h-3.5" />}
                            {t('general.loadCookies')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-start gap-2 lg:gap-4">
                    <label htmlFor="pf-general-remark" className="text-left lg:text-right text-muted font-medium mt-2">{t('general.remarks')}</label>
                    <textarea id="pf-general-remark" value={pd.remark} onChange={e => updatePd('remark', e.target.value)} rows="2" placeholder={t('general.remarksPlaceholder')} className="w-full bg-background border border-border rounded px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-y transition"></textarea>
                  </div>
                </div>
              )}

              {/* Proxy Tab */}
              {activeTab === 'Proxy' && (
                <div className="space-y-8 max-w-3xl">
                  <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-center gap-2 lg:gap-4">
                    <label className="text-left lg:text-right text-muted font-medium">{t('proxy.setting')}</label>
                    <ButtonTabs value={pd.proxySetting} onChange={v => { updatePd('proxySetting', v); setProxyResult(null); setError(''); }} options={['Custom', 'Saved Proxies', 'Rotating Proxy']} />
                  </div>

                  {pd.proxySetting === 'Custom' && (
                    <>
                      <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-start gap-2 lg:gap-4">
                        <label className="text-left lg:text-right text-muted font-medium mt-2">{t('proxy.type')}</label>
                        <div className="flex flex-col gap-4">
                          <div className="flex flex-wrap gap-3">
                            <CustomSelect value={pd.proxyType} onChange={e => updatePd('proxyType', e.target.value)} className="w-[140px]"><option value="HTTP">HTTP</option><option value="HTTPS">HTTPS</option><option value="Socks5">Socks5</option><option value="Local">Local</option></CustomSelect>
                            <CustomSelect value={pd.ipChecker} onChange={e => updatePd('ipChecker', e.target.value)} className="w-[180px]"><option value="IP2Location">IP2Location</option><option value="IPinfo">IPinfo</option></CustomSelect>
                            <Button variant="secondary" onClick={handleCheckProxy} disabled={checkingProxy} className="gap-2">
                              {checkingProxy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />} {checkingProxy ? t('proxy.checking') : t('proxy.checkNetwork')}
                            </Button>
                          </div>
                          {proxyResult && (
                            <div className="text-sm bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-4 rounded w-full max-w-xl">
                              <div className="font-semibold flex items-center gap-2 mb-3"><Check className="w-4 h-4"/> {t('proxy.connectionOk')}</div>
                              <div className="grid grid-cols-3 gap-4">
                                <div><span className="text-emerald-500/70 block text-xs mb-1 uppercase tracking-wider">{t('proxy.ip')}</span> {proxyResult.ip || pd.proxyHost}</div>
                                <div><span className="text-emerald-500/70 block text-xs mb-1 uppercase tracking-wider">{t('proxy.country')}</span> {proxyResult.country || 'US'}</div>
                                <div><span className="text-emerald-500/70 block text-xs mb-1 uppercase tracking-wider">{t('proxy.latency')}</span> {proxyResult.latencyMs || '120'}ms</div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-start gap-2 lg:gap-4 pt-2">
                        <label className="text-left lg:text-right text-muted font-medium mt-2"></label>
                        <div className="space-y-4 w-full">
                          <p className="text-xs text-primary italic bg-primary/10 border border-primary/20 px-3 py-2 rounded w-max mb-4">{t('proxy.pasteTip')}</p>
                          <div className="flex gap-4">
                            <input type="text" placeholder={t('proxy.hostPlaceholder')} value={pd.proxyHost} onChange={e => updatePd('proxyHost', e.target.value)} onPaste={handleProxyPaste} className="w-full flex-1 bg-background border border-border rounded px-4 py-2.5 text-foreground outline-none focus:border-primary focus:ring-1 font-mono text-sm" />
                            <input type="text" placeholder={t('proxy.portPlaceholder')} value={pd.proxyPort} onChange={e => updatePd('proxyPort', e.target.value)} className="w-[140px] bg-background border border-border rounded px-4 py-2.5 text-foreground outline-none focus:border-primary focus:ring-1 font-mono text-sm" />
                          </div>
                          <div className="flex gap-4">
                            <input type="text" placeholder={t('proxy.userPlaceholder')} value={pd.proxyUser} onChange={e => updatePd('proxyUser', e.target.value)} className="w-full flex-1 bg-background border border-border rounded px-4 py-2.5 text-foreground outline-none focus:border-primary focus:ring-1 font-mono text-sm" />
                            <input type="text" placeholder={t('proxy.passPlaceholder')} value={pd.proxyPass} onChange={e => updatePd('proxyPass', e.target.value)} className="w-full flex-1 bg-background border border-border rounded px-4 py-2.5 text-foreground outline-none focus:border-primary focus:ring-1 font-mono text-sm" />
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                  {pd.proxySetting === 'Saved Proxies' && (
                    <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-start gap-2 lg:gap-4 mt-4">
                      <label className="text-left lg:text-right text-muted font-medium mt-2">{t('proxy.selectProxy')}</label>
                      <CustomSelect value={pd.selectedSavedProxy} onChange={e => updatePd('selectedSavedProxy', e.target.value)} className="w-full max-w-md">
                        <option value="">{t('proxy.chooseSaved')}</option>
                        {allProxies.map(p => <option key={p.id} value={p.id}>{p.name} ({p.type} · {p.host}:{p.port})</option>)}
                      </CustomSelect>
                      {allProxies.length === 0 && <p className="text-xs text-muted-foreground mt-2 col-start-2">{t('proxy.noSaved')}</p>}
                    </div>
                  )}

                  {/* Network — per-profile HTTP/3 (QUIC) toggle */}
                  <div className="w-full h-px bg-border"></div>
                  <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-start gap-2 lg:gap-4">
                    <label className="text-left lg:text-right text-muted font-medium mt-2">{t('proxy.network')}</label>
                    <div className="w-full">
                      <div className="flex items-start gap-3 bg-background border border-border rounded px-4 py-3.5">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={pd.enableQuic === true}
                          onClick={() => updatePd('enableQuic', !pd.enableQuic)}
                          className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 mt-0.5"
                          style={{ background: pd.enableQuic ? '#22c55e' : 'var(--switch-background, #3f3f46)' }}
                          title={pd.enableQuic ? t('proxy.quicDisableTitle') : t('proxy.quicEnableTitle')}
                        >
                          <span
                            className={`inline-block transform rounded-full bg-white shadow transition-transform ${pd.enableQuic ? 'translate-x-5' : 'translate-x-1'}`}
                            style={{ height: 18, width: 18 }}
                          />
                        </button>
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-foreground">{t('proxy.quicLabel')}</span>
                          <p className="text-xs text-amber-400/90 mt-1 leading-relaxed">
                            {t('proxy.quicWarning')}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Platform Tab */}
              {activeTab === 'Platform' && (
                <div className="space-y-8 max-w-3xl">
                  <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-start gap-2 lg:gap-4">
                    <label htmlFor="pf-platform-startup" className="text-left lg:text-right text-muted font-medium mt-2">{t('platform.startupTabs')}</label>
                    <div className="w-full">
                      <textarea id="pf-platform-startup" value={pd.startupUrls} onChange={e => updatePd('startupUrls', e.target.value)} rows="3" placeholder={t('platform.startupPlaceholder')} className="w-full bg-background border border-border rounded px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-1 resize-y font-mono text-sm"></textarea>
                      <p className="text-xs text-muted mt-2 italic">{t('platform.startupHint')}</p>
                    </div>
                  </div>
                  <div className="w-full h-px bg-border"></div>
                  <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-start gap-2 lg:gap-4">
                    <div className="text-left lg:text-right mt-2">
                      <label className="text-muted font-medium block">{t('platform.accounts')}</label>
                      <button type="button" onClick={() => updatePd('platformAccounts', [...pd.platformAccounts, { platform: 'Facebook', username: '', password: '' }])} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-hover transition">
                        <Plus className="w-4 h-4" /> {t('platform.addAccount')}
                      </button>
                    </div>
                    <div className="w-full space-y-4">
                      {pd.platformAccounts.length === 0 && <div className="text-sm text-muted italic p-6 border border-dashed border-border rounded text-center bg-surface">{t('platform.noCredentials')}</div>}
                      {pd.platformAccounts.map((acc, idx) => (
                        <div key={idx} className="flex flex-col sm:flex-row gap-3 items-start sm:items-center bg-background p-4 rounded border border-border shadow-sm">
                          <CustomSelect value={acc.platform} onChange={e => { const a = [...pd.platformAccounts]; a[idx].platform = e.target.value; updatePd('platformAccounts', a); }} className="w-full sm:w-[160px] shrink-0">
                            {['Facebook', 'Instagram', 'Twitter / X', 'Amazon', 'Google', 'TikTok', 'LinkedIn', 'Other'].map(opt => <option key={opt} value={opt}>{opt === 'Other' ? t('platform.platformOther') : opt}</option>)}
                          </CustomSelect>
                          <input type="text" placeholder={t('platform.usernamePlaceholder')} value={acc.username} onChange={e => { const a = [...pd.platformAccounts]; a[idx].username = e.target.value; updatePd('platformAccounts', a); }} className="w-full sm:flex-1 bg-surface border border-border rounded px-3 py-2 text-foreground outline-none focus:border-primary text-sm" />
                          <input type="password" placeholder={t('platform.passwordPlaceholder')} value={acc.password} onChange={e => { const a = [...pd.platformAccounts]; a[idx].password = e.target.value; updatePd('platformAccounts', a); }} className="w-full sm:flex-1 bg-surface border border-border rounded px-3 py-2 text-foreground outline-none focus:border-primary text-sm" />
                          <button type="button" onClick={() => { const a = [...pd.platformAccounts]; a.splice(idx, 1); updatePd('platformAccounts', a); }} className="p-2 text-muted hover:text-red-400 bg-surface rounded border border-transparent hover:border-red-500/30 transition"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="w-full h-px bg-border"></div>

                  {/* Softglaze Premium — native 2FA vault */}
                  <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-start gap-2 lg:gap-4">
                    <div className="text-left lg:text-right mt-2">
                      <label htmlFor="pf-platform-2fa" className="text-muted font-medium flex items-center gap-1.5 lg:justify-end"><KeyRound className="w-3.5 h-3.5 text-violet-400" /> {t('platform.twoFactor')}</label>
                      <span className="inline-block mt-1 text-[10px] font-semibold uppercase tracking-wider text-violet-400/80">{t('platform.premium')}</span>
                    </div>
                    <div className="w-full">
                      <input
                        id="pf-platform-2fa"
                        type="text"
                        value={pd.twoFactorSeed || ''}
                        onChange={e => updatePd('twoFactorSeed', e.target.value)}
                        placeholder={t('platform.twoFactorPlaceholder')}
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full bg-background border border-border rounded px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-1 font-mono text-sm tracking-wide"
                      />
                      <p className="text-xs text-muted mt-2 italic">{t('platform.twoFactorHint')}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* COMPREHENSIVE FINGERPRINT TAB */}
              {activeTab === 'Fingerprint' && (
                <div className="max-w-4xl pr-4 pb-10">
                  <div className="flex items-center gap-2.5 mb-6">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in srgb, #3b82f6 14%, transparent)' }}>
                      <ShieldCheck className="w-4 h-4 text-blue-400" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-foreground">{t('fp.coreIdentity')}</h2>
                      <p className="text-xs text-muted-foreground">{t('fp.coreIdentitySub')}</p>
                    </div>
                  </div>

                  <FpRow label={t('fp.webrtc')} description={t('fp.webrtcDesc')}>
                    <ButtonTabs value={pd.webrtc} onChange={v => updatePd('webrtc', v)} options={['Forward', 'Replace', 'Real', 'Disabled', 'Proxy UDP']} />
                  </FpRow>

                  <FpRow label={t('fp.timezone')} description={t('fp.timezoneDesc')}>
                    <ButtonTabs value={pd.timezoneType} onChange={v => updatePd('timezoneType', v)} options={['Based on IP', 'Real', 'Custom']} />
                    {pd.timezoneType === 'Custom' && (
                      <input type="text" placeholder={t('fp.timezonePlaceholder')} value={pd.timezoneCustom} onChange={e => updatePd('timezoneCustom', e.target.value)} className="w-[250px] bg-background border border-border rounded px-3 py-2 text-foreground outline-none focus:border-primary mt-3 text-sm" />
                    )}
                  </FpRow>

                  <FpRow label={t('fp.location')} description={t('fp.locationDesc')}>
                    <div className="flex gap-4 items-center">
                      <ButtonTabs value={pd.locationType} onChange={v => updatePd('locationType', v)} options={['Based on IP', 'Custom', 'Block']} />
                      {pd.locationType !== 'Block' && (
                        <CustomSelect value={pd.locationPrompt} onChange={e => updatePd('locationPrompt', e.target.value)} className="w-[180px]">
                          <option value="Ask each time">{t('fp.askEachTime')}</option><option value="Always allow">{t('fp.alwaysAllow')}</option>
                        </CustomSelect>
                      )}
                    </div>
                    {pd.locationType === 'Custom' && (
                      <div className="flex gap-3 mt-3">
                        <input type="text" placeholder={t('fp.latPlaceholder')} value={pd.locationLat} onChange={e => updatePd('locationLat', e.target.value)} className="w-[160px] bg-background border border-border rounded px-3 py-2 text-foreground outline-none focus:border-primary text-sm" />
                        <input type="text" placeholder={t('fp.lngPlaceholder')} value={pd.locationLng} onChange={e => updatePd('locationLng', e.target.value)} className="w-[160px] bg-background border border-border rounded px-3 py-2 text-foreground outline-none focus:border-primary text-sm" />
                        <input type="text" placeholder={t('fp.accPlaceholder')} value={pd.locationAcc} onChange={e => updatePd('locationAcc', e.target.value)} className="w-[120px] bg-background border border-border rounded px-3 py-2 text-foreground outline-none focus:border-primary text-sm" />
                      </div>
                    )}
                  </FpRow>

                  <FpRow label={t('fp.language')} description={t('fp.languageDesc')}>
                    <ButtonTabs value={pd.languageType} onChange={v => updatePd('languageType', v)} options={['Based on IP', 'Custom']} />
                    {pd.languageType === 'Custom' && (
                      <input type="text" placeholder="e.g. en-US,en;q=0.9" value={pd.languageCustom} onChange={e => updatePd('languageCustom', e.target.value)} className="w-[250px] bg-background border border-border rounded px-3 py-2 text-foreground outline-none focus:border-primary mt-3 text-sm" />
                    )}
                  </FpRow>

                  <FpRow label={t('fp.displayLanguage')} description={t('fp.displayLanguageDesc')}>
                    <ButtonTabs value={pd.displayLangType} onChange={v => updatePd('displayLangType', v)} options={['Based on Language', 'Real', 'Custom']} />
                    {pd.displayLangType === 'Custom' && (
                      <input type="text" placeholder="e.g. en-US" value={pd.displayLangCustom} onChange={e => updatePd('displayLangCustom', e.target.value)} className="w-[250px] bg-background border border-border rounded px-3 py-2 text-foreground outline-none focus:border-primary mt-3 text-sm" />
                    )}
                  </FpRow>

                  <FpRow label={t('fp.screenResolution')} description={t('fp.screenResolutionDesc')}>
                    <div className="flex flex-col gap-4">
                      <ButtonTabs value={pd.resolutionType} onChange={v => updatePd('resolutionType', v)} options={['Random', 'Predefined', 'Custom']} />
                      {pd.resolutionType === 'Predefined' && (
                        <CustomSelect value={pd.resolutionPredefined} onChange={e => updatePd('resolutionPredefined', e.target.value)} className="w-[220px]">
                          {['1920x1080', '1366x768', '2560x1440', '1536x864', '3840x2160', '1280x720', '414x896', '375x812', '390x844'].map(r => <option key={r} value={r}>{r}</option>)}
                        </CustomSelect>
                      )}
                      {pd.resolutionType === 'Custom' && (
                        <div className="flex items-center gap-3">
                          <input type="text" placeholder={t('fp.width')} value={pd.resolutionW} onChange={e => updatePd('resolutionW', e.target.value)} className="w-[120px] bg-background border border-border rounded px-3 py-2 text-foreground outline-none focus:border-primary text-center text-sm" />
                          <span className="text-muted font-medium">x</span>
                          <input type="text" placeholder={t('fp.height')} value={pd.resolutionH} onChange={e => updatePd('resolutionH', e.target.value)} className="w-[120px] bg-background border border-border rounded px-3 py-2 text-foreground outline-none focus:border-primary text-center text-sm" />
                        </div>
                      )}
                    </div>
                  </FpRow>

                  <FpRow label={t('fp.fonts')} description={t('fp.fontsDesc')}>
                    <ButtonTabs value={pd.fontsType} onChange={v => updatePd('fontsType', v)} options={['Default', 'Custom']} />
                  </FpRow>

                  <div className="flex items-center gap-2.5 mt-10 mb-6">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in srgb, #f59e0b 14%, transparent)' }}>
                      <Settings2 className="w-4 h-4 text-amber-400" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-foreground">{t('fp.hardwareNoise')}</h2>
                      <p className="text-xs text-muted-foreground">{t('fp.hardwareNoiseSub')}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 mb-8">
                    <div className="flex items-center justify-between bg-background p-4 rounded border border-border shadow-sm">
                      <span className="text-foreground text-sm font-medium">{t('fp.canvasNoise')}</span>
                      <ToggleSwitch checked={pd.canvasNoise} onChange={v => updatePd('canvasNoise', v)} />
                    </div>
                    <div className="flex items-center justify-between bg-background p-4 rounded border border-border shadow-sm">
                      <span className="text-foreground text-sm font-medium">{t('fp.webglImageNoise')}</span>
                      <ToggleSwitch checked={pd.webglImageNoise} onChange={v => updatePd('webglImageNoise', v)} />
                    </div>
                    <div className="flex items-center justify-between bg-background p-4 rounded border border-border shadow-sm">
                      <span className="text-foreground text-sm font-medium">{t('fp.audioContextNoise')}</span>
                      <ToggleSwitch checked={pd.audioContextNoise} onChange={v => updatePd('audioContextNoise', v)} />
                    </div>
                    <div className="flex items-center justify-between bg-background p-4 rounded border border-border shadow-sm">
                      <span className="text-foreground text-sm font-medium">{t('fp.clientRectsNoise')}</span>
                      <ToggleSwitch checked={pd.clientRectsNoise} onChange={v => updatePd('clientRectsNoise', v)} />
                    </div>
                    <div className="flex items-center justify-between bg-background p-4 rounded border border-border shadow-sm">
                      <span className="text-foreground text-sm font-medium">{t('fp.speechVoicesNoise')}</span>
                      <ToggleSwitch checked={pd.speechVoicesNoise} onChange={v => updatePd('speechVoicesNoise', v)} />
                    </div>
                    <div className="flex items-center justify-between bg-background p-4 rounded border border-border shadow-sm">
                      <span className="text-foreground text-sm font-medium">{t('fp.mediaDevice')}</span>
                      <ButtonTabs value={pd.mediaDevice} onChange={v => updatePd('mediaDevice', v)} options={['Auto', 'Edit']} />
                    </div>
                  </div>

                  <FpRow label={t('fp.webglMetadata')} description={t('fp.webglMetadataDesc')}>
                    <div className="flex flex-col gap-4">
                      <ButtonTabs value={pd.webglMetadata} onChange={v => updatePd('webglMetadata', v)} options={['Real', 'Custom']} />
                      {pd.webglMetadata === 'Custom' && (
                        <div className="space-y-5 bg-background p-5 rounded border border-border shadow-sm">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-primary text-sm font-semibold">{t('fp.configureGpu')}</span>
                            <Button size="sm" variant="secondary" onClick={handleRandomWebGL} className="gap-2">
                              <Zap className="w-4 h-4 text-amber-400" /> {t('fp.autoRandomize')}
                            </Button>
                          </div>
                          <div>
                            <label className="text-muted text-xs uppercase tracking-wider font-semibold block mb-2">{t('fp.vendor')}</label>
                            <CustomSelect value={pd.webglVendor} onChange={e => { updatePd('webglVendor', e.target.value); updatePd('webglRenderer', WEBGL_RENDERERS[e.target.value][0]); }} className="w-full">
                              {WEBGL_VENDORS.map(v => <option key={v} value={v}>{v}</option>)}
                            </CustomSelect>
                          </div>
                          <div>
                            <label className="text-muted text-xs uppercase tracking-wider font-semibold block mb-2">{t('fp.renderer')}</label>
                            <CustomSelect value={pd.webglRenderer} onChange={e => updatePd('webglRenderer', e.target.value)} className="w-full">
                              {(WEBGL_RENDERERS[pd.webglVendor] || []).map(r => <option key={r} value={r}>{r}</option>)}
                            </CustomSelect>
                          </div>
                        </div>
                      )}
                    </div>
                  </FpRow>

                  <FpRow label={t('fp.webgpu')} description={t('fp.webgpuDesc')}>
                    <ButtonTabs value={pd.webgpu} onChange={v => updatePd('webgpu', v)} options={['Based on WebGL', 'Real', 'Disabled']} />
                  </FpRow>

                  <div className="flex items-center gap-2.5 mt-10 mb-6">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in srgb, #10b981 14%, transparent)' }}>
                      <Monitor className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-foreground">{t('fp.hardwareConfig')}</h2>
                      <p className="text-xs text-muted-foreground">{t('fp.hardwareConfigSub')}</p>
                    </div>
                  </div>

                  <FpRow label={t('fp.cpuCores')}>
                    <div className="flex items-center gap-4">
                      <ButtonTabs value={pd.cpuType} onChange={v => updatePd('cpuType', v)} options={['Real', 'Custom']} />
                      {pd.cpuType === 'Custom' && (
                        <CustomSelect value={pd.cpuCores} onChange={e => updatePd('cpuCores', e.target.value)} className="w-[140px]">
                          {['2', '4', '6', '8', '10', '12', '16'].map(v => <option key={v} value={v}>{t('fp.coresUnit', { count: Number(v) })}</option>)}
                        </CustomSelect>
                      )}
                    </div>
                  </FpRow>

                  <FpRow label={t('fp.ram')}>
                    <div className="flex items-center gap-4">
                      <ButtonTabs value={pd.ramType} onChange={v => updatePd('ramType', v)} options={['Real', 'Custom']} />
                      {pd.ramType === 'Custom' && (
                        <CustomSelect value={pd.ramGb} onChange={e => updatePd('ramGb', e.target.value)} className="w-[140px]">
                          {['2', '4', '8', '16', '32'].map(v => <option key={v} value={v}>{t('fp.gbUnit', { value: v })}</option>)}
                        </CustomSelect>
                      )}
                    </div>
                  </FpRow>

                  <FpRow label={t('fp.deviceName')} description={t('fp.deviceNameDesc')}>
                    <div className="flex flex-col gap-4">
                      <ButtonTabs value={pd.deviceNameType} onChange={v => updatePd('deviceNameType', v)} options={['Real', 'Custom']} />
                      {pd.deviceNameType === 'Custom' && (
                        <div className="flex items-center gap-3">
                          <input type="text" value={pd.deviceName} onChange={e => updatePd('deviceName', e.target.value)} className="w-[280px] bg-background border border-border rounded px-4 py-2 text-foreground outline-none focus:border-primary font-mono text-sm shadow-sm" />
                          <Button size="sm" variant="secondary" onClick={() => updatePd('deviceName', generateDeviceName())} title={t('fp.genDeviceName')} className="px-3 py-2">
                            <RefreshCcw className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </FpRow>

                  <FpRow label={t('fp.macAddress')} description={t('fp.macAddressDesc')}>
                    <div className="flex flex-col gap-4">
                      <ButtonTabs value={pd.macAddressType} onChange={v => updatePd('macAddressType', v)} options={['Real', 'Custom']} />
                      {pd.macAddressType === 'Custom' && (
                        <div className="flex items-center gap-3">
                          <input type="text" value={pd.macAddress} onChange={e => updatePd('macAddress', e.target.value)} className="w-[280px] bg-background border border-border rounded px-4 py-2 text-foreground outline-none focus:border-primary font-mono text-sm shadow-sm" />
                          <Button size="sm" variant="secondary" onClick={() => updatePd('macAddress', generateMac())} title={t('fp.genMac')} className="px-3 py-2">
                            <RefreshCcw className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </FpRow>

                  <div className="flex items-center gap-2.5 mt-10 mb-6">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in srgb, #8b5cf6 14%, transparent)' }}>
                      <Terminal className="w-4 h-4 text-purple-400" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-foreground">{t('fp.advancedSettings')}</h2>
                      <p className="text-xs text-muted-foreground">{t('fp.advancedSettingsSub')}</p>
                    </div>
                  </div>

                  <FpRow label={t('fp.doNotTrack')}>
                    <ButtonTabs value={pd.doNotTrack} onChange={v => updatePd('doNotTrack', v)} options={['Default', 'Open', 'Close']} />
                  </FpRow>

                  <FpRow label={t('fp.portScanProtection')}>
                    <ButtonTabs value={pd.portScanProtection} onChange={v => updatePd('portScanProtection', v)} options={['Enable', 'Close']} />
                  </FpRow>

                  <FpRow label={t('fp.hardwareAcceleration')}>
                    <ButtonTabs value={pd.hardwareAcceleration} onChange={v => updatePd('hardwareAcceleration', v)} options={['Default', 'Open', 'Close']} />
                  </FpRow>

                  <FpRow label={t('fp.disableTls')}>
                    <ButtonTabs value={pd.disableTls} onChange={v => updatePd('disableTls', v)} options={['Open', 'Close']} />
                  </FpRow>

                  <FpRow label={t('fp.launchArgs')} description={t('fp.launchArgsDesc')}>
                    <textarea value={pd.launchArgs} onChange={e => updatePd('launchArgs', e.target.value)} rows="3" placeholder="--disable-notifications&#10;--disable-gpu" className="w-full bg-background border border-border rounded px-4 py-3 text-foreground outline-none focus:border-primary resize-y font-mono text-xs shadow-sm"></textarea>
                  </FpRow>

                </div>
              )}

              {/* NEW ADVANCED TAB */}
              {activeTab === 'Advanced' && (
                <div className="max-w-4xl pr-4 pb-10">
                  <div className="flex items-center gap-2.5 mb-6">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in srgb, #3b82f6 14%, transparent)' }}>
                      <Settings2 className="w-4 h-4 text-blue-400" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-foreground">{t('advanced.coreSettings')}</h2>
                      <p className="text-xs text-muted-foreground">{t('advanced.coreSettingsSub')}</p>
                    </div>
                  </div>

                  <FpRow label={t('advanced.extension')} description={t('advanced.extensionDesc')}>
                    <CustomSelect value={pd.advancedExt} onChange={e => updatePd('advancedExt', e.target.value)} className="w-[220px]">
                      <option value="Team">{t('advanced.teamExtensions')}</option>
                      <option value="None">{t('advanced.noExtensions')}</option>
                    </CustomSelect>
                  </FpRow>

                  <FpRow label={t('advanced.dataSync')} description={t('advanced.dataSyncDesc')}>
                    <div className="space-y-4">
                      <ButtonTabs value={pd.advancedSync} onChange={v => updatePd('advancedSync', v)} options={['Global', 'Customize']} />
                      {pd.advancedSync === 'Customize' && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-5 bg-background p-6 rounded border border-border shadow-sm">
                          <CustomCheckbox label={t('advanced.syncCookie')} checked={pd.syncItems.cookie} onChange={v => updateNestedPd('syncItems', 'cookie', v)} />
                          <CustomCheckbox label={t('advanced.syncPasswords')} checked={pd.syncItems.passwords} onChange={v => updateNestedPd('syncItems', 'passwords', v)} />
                          <CustomCheckbox label={t('advanced.syncBookmarks')} checked={pd.syncItems.bookmarks} onChange={v => updateNestedPd('syncItems', 'bookmarks', v)} />
                          <CustomCheckbox label={t('advanced.syncLocalStorage')} checked={pd.syncItems.localStorage} onChange={v => updateNestedPd('syncItems', 'localStorage', v)} />
                          <CustomCheckbox label={t('advanced.syncIndexedDB')} checked={pd.syncItems.indexedDB} onChange={v => updateNestedPd('syncItems', 'indexedDB', v)} />
                          <CustomCheckbox label={t('advanced.syncExtensionData')} checked={pd.syncItems.extensionData} onChange={v => updateNestedPd('syncItems', 'extensionData', v)} />
                          <CustomCheckbox label={t('advanced.syncHistory')} checked={pd.syncItems.history} onChange={v => updateNestedPd('syncItems', 'history', v)} />
                        </div>
                      )}
                    </div>
                  </FpRow>

                  <FpRow label={t('advanced.browserSettings')} description={t('advanced.browserSettingsDesc')}>
                    <div className="space-y-4">
                      <ButtonTabs value={pd.advancedBrowser} onChange={v => updatePd('advancedBrowser', v)} options={['Global', 'Customize']} />
                      {pd.advancedBrowser === 'Customize' && (
                        <div className="space-y-5 bg-background p-6 rounded border border-border shadow-sm">
                          <CustomCheckbox label={t('advanced.matchTimezone')} checked={pd.browserSettings.matchTimezone} onChange={v => updateNestedPd('browserSettings', 'matchTimezone', v)} />
                          <CustomCheckbox label={t('advanced.allowChromeSignIn')} checked={pd.browserSettings.allowChromeSignIn} onChange={v => updateNestedPd('browserSettings', 'allowChromeSignIn', v)} />
                          <CustomCheckbox label={t('advanced.offerTranslate')} checked={pd.browserSettings.offerTranslate} onChange={v => updateNestedPd('browserSettings', 'offerTranslate', v)} />
                          <CustomCheckbox label={t('advanced.disableDevTools')} checked={pd.browserSettings.disableDevTools} onChange={v => updateNestedPd('browserSettings', 'disableDevTools', v)} />
                          <CustomCheckbox label={t('advanced.disableExtInstall')} checked={pd.browserSettings.disableExtInstall} onChange={v => updateNestedPd('browserSettings', 'disableExtInstall', v)} />
                          <CustomCheckbox label={t('advanced.enableVirtualCamera')} checked={pd.browserSettings.enableVirtualCamera} onChange={v => updateNestedPd('browserSettings', 'enableVirtualCamera', v)} />
                          <CustomCheckbox label={t('advanced.enableMobileSim')} checked={pd.browserSettings.enableMobileSim} onChange={v => updateNestedPd('browserSettings', 'enableMobileSim', v)} />

                          <div className="border-t border-border my-6 pt-6">
                            <label className="text-muted text-xs uppercase tracking-wider font-semibold block mb-3">{t('advanced.onStartup')}</label>
                            <CustomSelect value={pd.browserSettings.startupAction} onChange={e => updateNestedPd('browserSettings', 'startupAction', e.target.value)} className="w-full sm:w-[320px] mb-5">
                              <option value="lastPage">{t('advanced.startupLastPage')}</option>
                              <option value="blank">{t('advanced.startupBlank')}</option>
                            </CustomSelect>

                            <div className="space-y-4">
                              <CustomCheckbox label={t('advanced.onlyOpenWithProxy')} checked={pd.browserSettings.onlyOpenWithProxy} onChange={v => updateNestedPd('browserSettings', 'onlyOpenWithProxy', v)} />
                              <CustomCheckbox label={t('advanced.onlyOpenExtLoaded')} checked={pd.browserSettings.onlyOpenExtLoaded} onChange={v => updateNestedPd('browserSettings', 'onlyOpenExtLoaded', v)} />
                              <CustomCheckbox label={t('advanced.secureAccess')} checked={pd.browserSettings.secureAccess} onChange={v => updateNestedPd('browserSettings', 'secureAccess', v)} />
                              <CustomCheckbox label={t('advanced.disableVideos')} checked={pd.browserSettings.disableVideos} onChange={v => updateNestedPd('browserSettings', 'disableVideos', v)} />
                            </div>

                            <div className="flex items-center gap-3 mt-6 p-4 bg-surface rounded border border-border">
                              <span className="text-sm text-foreground">{t('advanced.disableImagesOver')}</span>
                              <input type="text" value={pd.browserSettings.disableImagesLimit} onChange={e => updateNestedPd('browserSettings', 'disableImagesLimit', e.target.value)} className="w-[80px] bg-background border border-border rounded px-3 py-1.5 text-center text-foreground outline-none focus:border-primary text-sm shadow-sm" />
                              <span className="text-sm text-foreground">{t('advanced.disableImagesUnit')}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </FpRow>

                  <FpRow label={t('advanced.randomFingerprint')} description={t('advanced.randomFingerprintDesc')}>
                    <ToggleSwitch checked={pd.randomFingerprint} onChange={v => updatePd('randomFingerprint', v)} />
                  </FpRow>
                </div>
              )}
            </div>

            {/* Bottom Actions */}
            <div className="bg-surface border-t border-border p-5 flex justify-end gap-3 shrink-0 rounded-b">
              <Button variant="secondary" onClick={() => setPreviewDraft(pd)}><Fingerprint className="w-4 h-4 mr-1.5" /> {t('editor.previewEnvironment')}</Button>
              <div className="flex-1" />
              <Button variant="secondary" onClick={closeEditor}>{t('common.cancel')}</Button>
              <Button variant="primary" onClick={handleSaveProfile} isLoading={saving}>{t('editor.saveProfile')}</Button>
            </div>
          </div>

          {/* Right Sidebar Matrix */}
          <div className="hidden lg:flex w-80 shrink-0 bg-surface rounded border border-border p-5 flex-col shadow-sm h-fit sticky top-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">{t('env.overview')}</h2>
              <button className="text-primary hover:text-primary-hover transition-colors text-xs flex items-center gap-1 font-medium"><Settings2 className="h-3.5 w-3.5"/> {t('env.settings')}</button>
            </div>
            
            <div className="space-y-1 text-sm max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
              {(() => {
                const EnvRow = ({ k, v, mono }) => (
                  <div className="flex justify-between items-start gap-3 py-1.5">
                    <span className="text-muted text-xs shrink-0">{k}</span>
                    <span className={`text-foreground font-medium text-right text-xs ${mono ? 'font-mono break-all' : ''}`}>{v}</span>
                  </div>
                );
                const EnvHead = ({ children }) => (
                  <div className="text-[10px] uppercase tracking-wider font-bold text-primary/80 pt-3 pb-1 border-t border-border mt-2 first:mt-0 first:border-t-0 first:pt-0">{children}</div>
                );
                const deviceMem = Math.min(8, Number(pd.ramGb) || 8); // Chrome caps deviceMemory at 8
                const proxyText = pd.proxySetting === 'Custom' && pd.proxyHost
                  ? `${pd.proxyType} ${pd.proxyHost}:${pd.proxyPort || ''}`
                  : (pd.selectedSavedProxy ? t('env.savedProxy') : t('env.directNoProxy'));
                const noiseTag = (on) => on === false ? t('env.real') : t('env.noise');
                return (
                  <>
                    <EnvHead>{t('env.headBrowserOs')}</EnvHead>
                    <EnvRow k={t('env.browser')} v={`${pd.browserCore} ${pd.browserVersion}`} />
                    <EnvRow k={t('env.os')} v={`${pd.os} ${pd.osVersion}`} />
                    <div className="flex flex-col gap-1.5 py-1.5">
                      <span className="text-muted text-xs">{t('env.userAgent')}</span>
                      <span className="text-primary font-mono text-[11px] bg-primary/5 border border-primary/20 p-2.5 rounded break-all leading-relaxed max-h-28 overflow-y-auto">{displayUA}</span>
                    </div>

                    <EnvHead>{t('env.headLocale')}</EnvHead>
                    <EnvRow k={t('env.timezone')} v={pd.timezoneType === 'Custom' ? pd.timezoneCustom : pd.timezoneType} />
                    <EnvRow k={t('env.language')} v={pd.languageType === 'Custom' ? pd.languageCustom : pd.languageType} />
                    <EnvRow k={t('env.location')} v={pd.locationType === 'Custom' ? `${pd.locationLat || '?'}, ${pd.locationLng || '?'}` : pd.locationType} />
                    <EnvRow k={t('env.displayLang')} v={pd.displayLangType} />

                    <EnvHead>{t('env.headScreenFonts')}</EnvHead>
                    <EnvRow k={t('env.resolution')} v={pd.resolutionType === 'Real' ? t('env.real') : `${pd.resolutionW}×${pd.resolutionH}`} />
                    <EnvRow k={t('env.fonts')} v={pd.fontsType} />

                    <EnvHead>{t('env.headGraphics')}</EnvHead>
                    <EnvRow k={t('env.webglVendor')} v={pd.webglVendor} />
                    <EnvRow k={t('env.webglRenderer')} v={pd.webglRenderer} mono />
                    <EnvRow k={t('env.webgpu')} v={pd.webgpu} />

                    <EnvHead>{t('env.headHardware')}</EnvHead>
                    <EnvRow k={t('env.cpuCores')} v={t('fp.coresUnit', { count: Number(pd.cpuCores) })} />
                    <EnvRow k={t('env.ram')} v={t('fp.gbUnit', { value: pd.ramGb })} />
                    <EnvRow k={t('env.deviceMemory')} v={t('env.deviceMemoryValue', { value: deviceMem })} />

                    <EnvHead>{t('env.headNoise')}</EnvHead>
                    <EnvRow k={t('env.canvas')} v={noiseTag(pd.canvasNoise)} />
                    <EnvRow k={t('env.webglImage')} v={noiseTag(pd.webglImageNoise)} />
                    <EnvRow k={t('env.audioContext')} v={noiseTag(pd.audioContextNoise)} />
                    <EnvRow k={t('env.clientRects')} v={noiseTag(pd.clientRectsNoise)} />
                    <EnvRow k={t('env.mediaDevice')} v={pd.mediaDevice} />
                    <EnvRow k={t('env.doNotTrack')} v={pd.doNotTrack} />
                    <EnvRow k={t('env.portScan')} v={pd.portScanProtection} />

                    <EnvHead>{t('env.headNetworkDevice')}</EnvHead>
                    <EnvRow k={t('env.proxy')} v={proxyText} mono />
                    <EnvRow k={t('env.webrtc')} v={pd.webrtc} />
                    <EnvRow k={t('env.deviceName')} v={pd.deviceName} mono />
                    <EnvRow k={t('env.mac')} v={pd.macAddress} mono />
                  </>
                );
              })()}
              <button onClick={() => setPreviewDraft(pd)} className="w-full mt-3 text-xs text-primary hover:text-primary-hover border border-primary/20 hover:border-primary/40 rounded py-2 transition flex items-center justify-center gap-1.5">
                <Fingerprint className="w-3.5 h-3.5" /> {t('env.openFullPreview')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- LIST VIEW ---
  return (
    <>
      <PageHeader
        eyebrow={t('header.eyebrow')}
        title={t('header.title')}
        description={t('header.description', { total: totalCount, running: runningCount })}
        actions={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowTemplates(true)}>
              <LayoutTemplate className="h-4 w-4" />
              {t('header.templates')}
            </Button>
            <Button variant="secondary" onClick={() => setShowQuickGen(true)}>
              <FileSpreadsheet className="h-4 w-4" />
              {t('header.batchCreate')}
            </Button>
            <Button
              variant="primary"
              onClick={openCreate}
              className="bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-lg shadow-lg shadow-blue-500/25 hover:from-blue-500 hover:to-blue-600"
            >
              <Plus className="h-4 w-4" />
              {t('header.newProfile')}
            </Button>
          </div>
        }
      />

      {/* Tinted glow stat cards — REAL derived counts only */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div
          className="rounded-xl p-4 flex items-center gap-3 animate-fade-up"
          style={{
            background: 'color-mix(in srgb, #3b82f6 8%, var(--card))',
            border: '1px solid color-mix(in srgb, #3b82f6 22%, transparent)',
          }}
        >
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'color-mix(in srgb, #3b82f6 14%, transparent)' }}
          >
            <Monitor className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground font-display leading-none">{totalCount}</p>
            <p className="text-xs text-muted-foreground mt-1">{t('stats.totalProfiles')}</p>
          </div>
        </div>

        <div
          className="rounded-xl p-4 flex items-center gap-3 animate-fade-up"
          style={{
            background: 'color-mix(in srgb, #10b981 8%, var(--card))',
            border: '1px solid color-mix(in srgb, #10b981 22%, transparent)',
          }}
        >
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'color-mix(in srgb, #10b981 14%, transparent)' }}
          >
            <Activity className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground font-display leading-none">{runningCount}</p>
            <p className="text-xs text-muted-foreground mt-1">{t('stats.runningNow')}</p>
          </div>
        </div>

        <div
          className="rounded-xl p-4 flex items-center gap-3 animate-fade-up"
          style={{
            background: 'color-mix(in srgb, #8b5cf6 8%, var(--card))',
            border: '1px solid color-mix(in srgb, #8b5cf6 22%, transparent)',
          }}
        >
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'color-mix(in srgb, #8b5cf6 14%, transparent)' }}
          >
            <ShieldCheck className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground font-display leading-none">{proxiedCount}</p>
            <p className="text-xs text-muted-foreground mt-1">{t('stats.withProxy')}</p>
          </div>
        </div>
      </div>
      {error && <div className="mb-5 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}
      
      {selectedIds.size > 0 && (
        <div className="mb-5 flex items-center gap-4 rounded-xl border border-primary/30 bg-primary/5 px-5 py-3.5 shadow-glow shadow-primary/10 transition-all">
          <span className="text-sm text-primary font-bold">{t('bulk.selected', { count: selectedIds.size })}</span>
          {launchProgress && (
            <span className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
              {t('bulk.launching', { done: launchProgress.done, total: launchProgress.total })}
            </span>
          )}
          <div className="flex gap-2 ml-auto">
            <Button size="sm" disabled={bulkBusy} onClick={handleBulkLaunch} className="bg-emerald-600 hover:bg-emerald-500 text-white border-transparent">{t('bulk.launch')}</Button>
            <Button size="sm" disabled={bulkBusy || selectedIds.size < 2} onClick={handleSynchronize} className="bg-violet-600 hover:bg-violet-500 text-white border-transparent" title={t('bulk.synchronizeTitle')}><Combine className="w-3.5 h-3.5 mr-1" /> {t('bulk.synchronize')}</Button>
            <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={handleBulkClose}>{t('bulk.close')}</Button>
            <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => setShowTagModal(true)} title={t('bulk.tagTitle')}><Tag className="w-3.5 h-3.5 mr-1" /> {t('bulk.tag')}</Button>
            <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => { setRenameStart(1); setShowRenameModal(true); }} title={t('bulk.renameTitle')}><Pencil className="w-3.5 h-3.5 mr-1" /> {t('bulk.rename')}</Button>
            <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => setShowShareModal(true)} title={t('bulk.shareTitle')}><Share2 className="w-3.5 h-3.5 mr-1" /> {t('bulk.share')}</Button>
            <Button size="sm" variant="secondary" disabled={bulkBusy || selectedIds.size < 2} onClick={openCompare} title={t('bulk.compareTitle')}><GitCompare className="w-3.5 h-3.5 mr-1" /> {t('bulk.compare')}</Button>
            <Button size="sm" variant="danger" disabled={bulkBusy} onClick={handleBulkDelete}>{t('bulk.delete')}</Button>
            <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={clearSelection}>{t('bulk.clear')}</Button>
          </div>
        </div>
      )}
      
      <div className="mb-6 flex flex-wrap items-center gap-3 bg-card p-3 rounded-xl border border-border hover:border-border-strong transition-colors">
        <CustomSelect value={filterGroup} onChange={(e) => setFilterGroup(e.target.value)} className="w-auto">
          <option value="all">{t('filters.allGroups')}</option>
          <option value="ungrouped">{t('filters.ungrouped')}</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </CustomSelect>

        <CustomSelect value={filterTag} onChange={(e) => setFilterTag(e.target.value)} className="w-auto">
          <option value="">{t('filters.allTags')}</option>
          {allTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
        </CustomSelect>

        <CustomSelect value={filterProxy} onChange={(e) => setFilterProxy(e.target.value)} className="w-auto">
          <option value="">{t('filters.allProxies')}</option>
          <option value="none">{t('filters.directNoProxy')}</option>
          {allProxies.map((px) => <option key={px.id} value={px.id}>{px.name}</option>)}
        </CustomSelect>

        <CustomSelect value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-auto">
          <option value="all">{t('filters.anyStatus')}</option>
          <option value="running">{t('filters.running')}</option>
          <option value="proxied">{t('filters.hasProxy')}</option>
          <option value="direct">{t('filters.noProxy')}</option>
        </CustomSelect>

        <div className="relative flex-1 min-w-[200px] max-w-[300px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('filters.searchPlaceholder')} className="w-full bg-input-background border border-border rounded pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary transition" />
        </div>
        {(filterGroup !== 'all' || filterTag || filterProxy || filterStatus !== 'all' || search) && (
          <Button variant="ghost" size="sm" onClick={() => { setFilterGroup('all'); setFilterTag(''); setFilterProxy(''); setFilterStatus('all'); setSearch(''); }}>{t('filters.clearFilters')}</Button>
        )}
        {filterPresets.length > 0 && (
          <CustomSelect value="" onChange={(e) => applyPreset(filterPresets.find((x) => x.name === e.target.value))} className="w-auto">
            <option value="">{t('filters.savedFilters')}</option>
            {filterPresets.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </CustomSelect>
        )}
        <Button variant="ghost" size="sm" onClick={saveCurrentPreset} title={t('filters.savePresetTitle')}><Bookmark className="w-3.5 h-3.5 mr-1" /> {t('filters.save')}</Button>
        <span className="ml-auto text-sm text-muted-foreground font-medium bg-elevated px-3 py-1.5 rounded-lg border border-border">{t('filters.profileCount', { count: filteredProfiles.length })}</span>
      </div>
      
      <Card className="bg-card border border-border hover:border-border-strong transition-colors flex flex-col flex-1 rounded-xl">
        <CardContent className="p-0 overflow-auto flex-1 rounded-xl">
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[1120px] border-collapse text-left text-sm whitespace-nowrap">
              <thead className="bg-elevated text-muted-foreground text-[10px] uppercase tracking-wider font-semibold border-b border-border sticky top-0 z-10">
                <tr>
                  <th className="px-5 py-4 w-12 text-center">
                    <button type="button" onClick={toggleSelectAll} className={`w-4 h-4 mx-auto rounded border flex items-center justify-center transition ${filteredProfiles.length > 0 && selectedIds.size === filteredProfiles.length ? 'bg-primary border-primary' : 'bg-input-background border-border hover:border-border-strong'}`}>
                      {filteredProfiles.length > 0 && selectedIds.size === filteredProfiles.length && <span className="w-2 h-2 bg-white rounded-sm" />}
                    </button>
                  </th>
                  <th className="px-5 py-4">{t('table.name')}</th>
                  <th className="px-5 py-4">{t('table.proxy')}</th>
                  <th className="px-5 py-4">{t('table.created')}</th>
                  <th className="px-5 py-4">{t('table.lastUsed')}</th>
                  <th className="px-5 py-4 text-right">{t('table.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredProfiles.length === 0 && (
                  <tr>
                    <td colSpan="6" className="p-12">
                       <EmptyState title={t('table.emptyTitle')} description={t('table.emptyDesc')} icon={<Monitor className="w-10 h-10 text-muted" />} />
                    </td>
                  </tr>
                )}
                {pagedProfiles.map((p) => (
                  <tr key={p.id} className="border-b border-border hover:bg-secondary/50 transition-colors group">
                    <td className="px-5 py-3.5 text-center">
                      <button type="button" onClick={() => toggleSelect(p.id)} className={`w-4 h-4 mx-auto rounded border flex items-center justify-center transition ${selectedIds.has(p.id) ? 'bg-primary border-primary' : 'bg-input-background border-border hover:border-border-strong'}`}>
                        {selectedIds.has(p.id) && <span className="w-2 h-2 bg-white rounded-sm" />}
                      </button>
                    </td>
                    <td className="px-5 py-3.5 font-medium text-foreground">
                      <div className="flex items-center gap-3">
                        {runningIds.has(p.id) ? (
                          <div className="relative flex h-2.5 w-2.5 shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                          </div>
                        ) : (
                          <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground/40 shrink-0" />
                        )}
                        {p.browserBrand && normalizeBrandId(p.browserBrand) !== 'Chrome' && (
                          <span
                            className="shrink-0"
                            style={{ color: (BROWSER_BRANDS.find((b) => b.id === normalizeBrandId(p.browserBrand)) || {}).accent }}
                            title={t('row.presentsAs', { brand: normalizeBrandId(p.browserBrand) })}
                          >
                            <BrandMark id={p.browserBrand} className="w-3.5 h-3.5" />
                          </span>
                        )}
                        <span className="truncate max-w-[200px]">{p.title}</span>
                        {(p.deviceClass === 'mobile' || /android/i.test(p.os || '')) && (
                          <span
                            title={t('row.mobileTitle')}
                            className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-teal-500/12 text-teal-400 border border-teal-500/25"
                          >
                            <Smartphone className="w-3 h-3" /> {t('row.mobile')}
                          </span>
                        )}
                        {locks[p.id] && !locks[p.id].mine && (
                          <span
                            title={t('row.inUseBy', { member: locks[p.id].memberName || t('row.anotherMember') })}
                            className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-500/12 text-amber-400 border border-amber-500/25"
                          >
                            <Lock className="w-3 h-3" /> {locks[p.id].memberName || t('row.inUse')}
                          </span>
                        )}
                        {p.twoFactorSeed && (
                          <button
                            type="button"
                            onClick={() => handleCopy2fa(p.id)}
                            title={t('row.copy2fa')}
                            className="relative shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-violet-500/12 text-violet-300 border border-violet-500/25 hover:bg-violet-500/20 transition"
                          >
                            {copied2fa === p.id ? <><Check className="w-3 h-3" /> {t('row.copied')}</> : <><KeyRound className="w-3 h-3" /> {t('row.twoFa')}</>}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        {p.proxy && p.proxy.lastStatus && (
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ background: p.proxy.lastStatus === 'ok' ? '#10b981' : (p.proxy.lastStatus === 'fail' ? '#ef4444' : '#9ca3af') }}
                            title={`${t('row.proxyStatus')} ${p.proxy.lastStatus}${p.proxy.lastLatencyMs != null ? ` · ${p.proxy.lastLatencyMs}ms` : ''}${p.proxy.lastCountry ? ` · ${p.proxy.lastCountry}` : ''}`}
                          />
                        )}
                        {p.proxyInfoString ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            <Link2 className="w-3 h-3" />
                            {p.proxyInfoString.split(':')[0]}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium bg-secondary text-muted-foreground border border-border">
                            {t('row.direct')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground text-xs">{formatDateTime(p.createdAt)}</td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      <button onClick={() => setActivityProfile({ id: p.id, title: p.title })} className="inline-flex items-center gap-2 hover:text-foreground transition text-xs" title={t('row.viewActivity')}>
                        <History className="h-3.5 w-3.5" />
                        <span title={p.lastUsedAt ? formatDateTime(p.lastUsedAt) : t('row.neverUsed')}>{p.lastUsedAt ? relTime(p.lastUsedAt) : t('relTime.never')}</span>
                        {p.launchCount ? <span className="text-[10px] bg-elevated border border-border px-1.5 py-0.5 rounded font-semibold ml-1">{p.launchCount}×</span> : null}
                      </button>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex justify-end gap-1.5">
                        {runningIds.has(p.id) ? (
                          <Button size="sm" variant="danger" onClick={() => handleBulkClose([p.id])} className="px-3" title={t('actions.stop')}>
                            <Square className="w-3.5 h-3.5 mr-1" /> {t('actions.stop')}
                          </Button>
                        ) : (locks[p.id] && !locks[p.id].mine) ? (
                          <Button size="sm" variant="ghost" disabled className="px-3 opacity-60 cursor-not-allowed" title={t('actions.inUseTitle', { member: locks[p.id].memberName || t('row.anotherMember') })}>
                            <Lock className="w-3.5 h-3.5 mr-1" /> {t('row.inUse')}
                          </Button>
                        ) : (
                          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white shadow-glow shadow-emerald-500/20 px-3" onClick={() => handleLaunch(p.id)} title={t('actions.launch')}>
                            <Play className="w-3.5 h-3.5 mr-1" /> {t('actions.launch')}
                          </Button>
                        )}

                        <div className="w-px h-6 bg-border mx-1 my-auto" />

                        <Button size="sm" variant="ghost" className="px-2.5" onClick={() => setEnvProfile(p)} title={t('actions.environmentOverview')}>
                          <Fingerprint className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="px-2.5" onClick={() => openEdit(p)} title={t('actions.editConfig')}>
                          <Settings2 className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="px-2.5" onClick={() => setLeakProfile({ id: p.id, title: p.title })} title={t('actions.leakCheck')}>
                          <ShieldCheck className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="px-2.5" onClick={() => setCookieProfile({ id: p.id, title: p.title })} title={t('actions.manageCookies')}>
                          <Cookie className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="px-2.5" onClick={() => setRotationProfile({ id: p.id, title: p.title })} title={t('actions.proxyRotation')}>
                          <Shuffle className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="px-2.5" onClick={() => handleClone(p.id)} title={t('actions.cloneSame')}>
                          <Copy className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="px-2.5" onClick={() => handleClone(p.id, true)} title={t('actions.cloneNew')}>
                          <Dices className="w-4 h-4" />
                        </Button>

                        <div className="w-px h-6 bg-border mx-1 my-auto" />

                        <Button size="sm" variant="ghost" className="px-2.5 text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={() => handleDelete(p.id, p.title)} title={t('actions.moveToTrash')}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
        {filteredProfiles.length > 0 && (
          <div className="shrink-0 border-t border-border bg-card/95 px-4 py-2.5 rounded-b-xl">
            <Pager total={filteredProfiles.length} page={safePage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
          </div>
        )}
      </Card>

      {leakProfile && (
        <LeakCheckModal
          profileId={leakProfile.id}
          profileName={leakProfile.title}
          onClose={() => setLeakProfile(null)}
        />
      )}
      {cookieProfile && (
        <CookieManagerModal
          profileId={cookieProfile.id}
          profileName={cookieProfile.title}
          onClose={() => setCookieProfile(null)}
        />
      )}
      {rotationProfile && (
        <ProxyRotationModal
          profileId={rotationProfile.id}
          profileName={rotationProfile.title}
          onClose={() => setRotationProfile(null)}
        />
      )}
      {envProfile && (
        <EnvironmentOverviewModal profile={envProfile} onClose={() => setEnvProfile(null)} />
      )}
      {previewDraft && (
        <EnvironmentOverviewModal profile={previewDraft} onClose={() => setPreviewDraft(null)} />
      )}
      {deleteTarget && (
        <DeleteProfileModal
          profile={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => { setDeleteTarget(null); loadData(); }}
        />
      )}
      {showTemplates && (
        <TemplatesModal onClose={() => setShowTemplates(false)} onProfilesChanged={loadData} />
      )}
      {showQuickGen && (
        <QuickGenerateModal osPlatforms={OS_PLATFORMS} groups={groups} proxies={allProxies} proxyGroups={proxyGroups} onClose={() => setShowQuickGen(false)} onGenerate={handleQuickGenerate} onCreateGroup={async (name) => { const g = await softglazeApi.groups.create({ name }); await loadData(); return g; }} />
      )}
      {showBrowserManager && (
        <BrowserManagerModal onClose={() => setShowBrowserManager(false)} onInstalled={refreshInstalledBrowsers} />
      )}
      {activityProfile && (
        <ActivityModal profileId={activityProfile.id} profileName={activityProfile.title} onClose={() => setActivityProfile(null)} />
      )}
      {showTagModal && (
        <TagModal
          onClose={() => setShowTagModal(false)}
          count={selectedIds.size}
          tagInput={tagInput}
          setTagInput={setTagInput}
          allTags={allTags}
          bulkBusy={bulkBusy}
          onAssign={handleTagAssign}
        />
      )}
      {showRenameModal && (
        <RenameModal
          onClose={() => setShowRenameModal(false)}
          count={selectedIds.size}
          renamePrefix={renamePrefix}
          setRenamePrefix={setRenamePrefix}
          renameStart={renameStart}
          setRenameStart={setRenameStart}
          bulkBusy={bulkBusy}
          onRename={handleBulkRename}
        />
      )}
      {showShareModal && (
        <ShareProfileModal profileIds={[...selectedIds]} onClose={() => setShowShareModal(false)} />
      )}
      {compareProfiles && (
        <CompareProfilesModal profiles={compareProfiles} onClose={() => setCompareProfiles(null)} />
      )}
    </>
  );
}