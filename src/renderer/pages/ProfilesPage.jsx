import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCcw, Search, Plus, Trash2, ArrowLeft, ShieldCheck, Settings2, Monitor, Apple, Smartphone, Terminal, ChevronDown, Check, Tag, Link2, Zap, FileSpreadsheet, Cookie, Copy, LayoutTemplate, History, Play, Square } from 'lucide-react';
import EmptyState from '@/components/EmptyState.jsx';
import PageHeader from '@/components/PageHeader.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card, CardContent } from '@/components/ui/Card.jsx';
import LeakCheckModal from '@/components/LeakCheckModal.jsx';
import CookieManagerModal from '@/components/CookieManagerModal.jsx';
import TemplatesModal from '@/components/TemplatesModal.jsx';
import ActivityModal from '@/components/ActivityModal.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { formatDateTime } from '@/lib/utils.js';

// --- CUSTOM STYLED SELECT DROPDOWN ---
const CustomSelect = ({ value, onChange, className = '', children, disabled }) => (
  <div className={`relative flex items-center ${className}`}>
    <select
      value={value}
      onChange={onChange}
      disabled={disabled}
      className="w-full appearance-none bg-background border border-border rounded pl-3 pr-9 py-2 text-zinc-100 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition disabled:opacity-50 text-ellipsis overflow-hidden whitespace-nowrap cursor-pointer hover:border-muted-dark"
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
        className={`px-3 py-1.5 text-xs transition border-r border-border last:border-0 ${value === opt ? 'bg-muted-dark text-white font-medium' : 'text-muted hover:text-zinc-200 hover:bg-surface'}`}
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
    <span className="text-zinc-300 text-sm">{label}</span>
  </label>
);

// --- HELPER COMPONENT FOR FINGERPRINT ROWS ---
const FpRow = ({ label, description, children }) => (
  <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] items-start gap-2 lg:gap-6 border-b border-border pb-5 mb-5 last:border-0 last:pb-0 last:mb-0">
    <div className="mt-1">
      <label className="text-zinc-200 font-medium text-sm block">{label}</label>
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
      "Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
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

function generateAutoUserAgent(os, uaCategory, index = 0) {
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
  browserVersion: 'Auto',
  os: 'Windows',
  osVersion: 'All Windows',
  uaCategory: 'All', 
  userAgent: 'Auto',
  group: 'Ungrouped',
  tags: '',
  cookie: '',
  remark: '',
  
  startupUrls: '',
  platformAccounts: [],

  proxySetting: 'Custom', 
  proxyType: 'HTTP', 
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
  
  cpuType: 'Real',
  cpuCores: '8',
  ramType: 'Real',
  ramGb: '8',
  deviceNameType: 'Real',
  deviceName: generateDeviceName(),
  macAddressType: 'Real',
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

export default function ProfilesPage() {
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
  const [leakProfile, setLeakProfile] = useState(null);
  const [cookieProfile, setCookieProfile] = useState(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [activityProfile, setActivityProfile] = useState(null);
  const [groups, setGroups] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [allProxies, setAllProxies] = useState([]);
  const [runningIds, setRunningIds] = useState(() => new Set());
  const [filterGroup, setFilterGroup] = useState('all');
  const [filterTag, setFilterTag] = useState('');
  const [filterProxy, setFilterProxy] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

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
  
  const isEditing = Boolean(pd.id);
  const tabs = ['General', 'Proxy', 'Platform', 'Fingerprint', 'Advanced']; 

  const currentOsObj = OS_PLATFORMS.find(o => o.id === pd.os) || OS_PLATFORMS[0];
  const browserVersionsList = pd.browserCore === 'SunBrowser' ? CHROME_VERSIONS : FIREFOX_VERSIONS;
  const filteredUAGroups = USER_AGENT_GROUPS.filter(g => g.platforms.includes(pd.os));

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [profs, grps, tgs, pxs, sess] = await Promise.all([
        softglazeApi.profiles.list({ search }),
        softglazeApi.groups.list(),
        softglazeApi.tags.list(),
        softglazeApi.proxies.list({}),
        softglazeApi.sessions.list()
      ]);
      setProfiles(profs);
      setGroups(grps);
      setAllTags(tgs);
      setAllProxies(pxs);
      setRunningIds(new Set((sess || []).map((sx) => Number(sx.id))));
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { loadData(); }, [loadData]);

  function openCreate() { 
    setPd({ ...initialProfileData, userAgent: 'Auto', macAddress: generateMac(), deviceName: generateDeviceName() }); 
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
      proxyType: profile.proxyType || 'HTTP'
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
    const newAgent = generateAutoUserAgent(pd.os, pd.uaCategory, Math.floor(Math.random() * 10000));
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

  async function handleSaveProfile() {
    if (!pd.name) return setError('Profile Name is required.');
    setSaving(true);
    try {
      const finalUA = pd.userAgent === 'Auto' ? generateAutoUserAgent(pd.os, pd.uaCategory, profiles.length) : pd.userAgent;
      const proxyRaw = constructProxyString();
      
      const payload = { 
        ...pd,
        title: pd.name, 
        notes: pd.remark, 
        proxyRaw: proxyRaw || null, 
        systemProxyBehavior: proxyRaw ? 'PROFILE_PROXY' : 'DIRECT', 
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
    try { await softglazeApi.profiles.launch(profileId, { startUrl: 'about:blank' }); } 
    catch (err) { setError(err.message); } 
  }

  async function handleClone(profileId) {
    try { await softglazeApi.profiles.clone(profileId); await loadData(); }
    catch (err) { setError(err.message); }
  }

  async function handleDelete(profileId, title) {
    if (!window.confirm(`Move "${title}" to Trash?`)) return;
    try { await softglazeApi.profiles.delete(profileId); await loadData(); }
    catch (err) { setError(err.message); }
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
    try { await softglazeApi.profiles.bulkLaunch([...selectedIds]); }
    catch (err) { setError(err.message); }
    finally { setBulkBusy(false); }
  }
  async function handleBulkClose() {
    if (selectedIds.size === 0) return;
    setBulkBusy(true); setError('');
    try { await softglazeApi.profiles.bulkClose([...selectedIds]); }
    catch (err) { setError(err.message); }
    finally { setBulkBusy(false); }
  }
  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Move ${selectedIds.size} profile(s) to Trash?`)) return;
    setBulkBusy(true); setError('');
    try { await softglazeApi.profiles.bulkDelete([...selectedIds]); clearSelection(); await loadData(); }
    catch (err) { setError(err.message); }
    finally { setBulkBusy(false); }
  }

  async function handleCheckProxy(e) {
    e.preventDefault();
    const proxyRaw = constructProxyString();
    if (pd.proxySetting === 'Custom' && (!pd.proxyHost || !pd.proxyPort)) return setError('Please enter at least Host and Port to check.');
    setCheckingProxy(true); setError(''); setProxyResult(null);
    try {
      setProxyResult(await softglazeApi.proxies.check({ type: pd.proxyType, raw: proxyRaw }));
    } catch (err) { 
      setError(err.message || 'Proxy check failed.'); 
    } finally { 
      setCheckingProxy(false); 
    }
  }

  const displayUA = pd.userAgent === 'Auto' ? generateAutoUserAgent(pd.os, pd.uaCategory, profiles.length) : pd.userAgent;

  // --- EDITOR VIEW ---
  if (view === 'editor') {
    return (
      <div className="w-full h-full bg-card text-zinc-100 font-sans flex flex-col rounded border border-border overflow-hidden shadow-2xl">
        <div className="bg-surface border-b border-border px-5 py-4 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={closeEditor} className="p-1.5 hover:bg-muted-dark rounded text-muted hover:text-white transition"><ArrowLeft className="h-5 w-5" /></button>
            <h1 className="text-lg font-bold text-white tracking-tight">{isEditing ? 'Edit Browser Profile' : 'New Browser Profile'}</h1>
          </div>
          <div className="flex items-center gap-3 text-xs text-amber-400 bg-amber-500/10 px-4 py-2 rounded border border-amber-500/20">
            <ShieldCheck className="h-4 w-4" /> Recommended: bind an authenticator in Settings to keep your account secure.
          </div>
        </div>

        {error && <div className="mx-6 mt-5 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}

        <div className="flex-1 overflow-y-auto p-6 flex flex-col xl:flex-row gap-6">
          <div className="flex-1 bg-surface rounded border border-border overflow-hidden flex flex-col min-w-0 shadow-sm">
            <div className="flex border-b border-border bg-surface overflow-x-auto shrink-0 sticky top-0 z-10 px-2 pt-2">
              {tabs.map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} className={`whitespace-nowrap px-6 py-3 text-sm font-medium transition-all border-b-2 rounded-t ${activeTab === tab ? 'border-primary text-primary bg-primary/10' : 'border-transparent text-muted hover:text-zinc-200 hover:bg-card'}`}>{tab}</button>
              ))}
            </div>

            <div className="p-6 overflow-y-auto flex-1 text-sm">
              
              {/* General Tab */}
              {activeTab === 'General' && (
                <div className="space-y-6 max-w-3xl">
                  <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-center gap-2 lg:gap-4">
                    <label className="text-left lg:text-right text-muted font-medium">Name</label>
                    <input type="text" value={pd.name} onChange={e => updatePd('name', e.target.value)} placeholder="e.g. FB Mailsi 01" className="w-full bg-background border border-border rounded px-4 py-2.5 text-zinc-100 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition" />
                  </div>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-center gap-2 lg:gap-4">
                    <label className="text-left lg:text-right text-muted font-medium">Browser</label>
                    <div className="flex flex-wrap gap-4">
                      {['SunBrowser', 'FlowerBrowser'].map(core => (
                        <div key={core} className={`flex items-center rounded border transition shadow-sm ${pd.browserCore === core ? 'border-primary bg-primary/10' : 'border-border bg-background hover:border-muted'}`}>
                          <button onClick={() => updatePd('browserCore', core)} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-100">
                            <div className={`w-4 h-4 rounded-full ${core === 'SunBrowser' ? 'bg-blue-500' : 'bg-orange-500'}`}></div>
                            {core}
                          </button>
                          <div className="w-px h-6 bg-border"></div>
                          <div className="relative">
                            <select 
                              value={pd.browserCore === core ? pd.browserVersion : (core === 'SunBrowser' ? 'Auto' : 'Auto')}
                              onChange={e => { updatePd('browserCore', core); updatePd('browserVersion', e.target.value); }}
                              className="appearance-none bg-transparent outline-none text-muted hover:text-zinc-200 px-3 pr-8 py-2 text-sm cursor-pointer"
                            >
                              {(core === 'SunBrowser' ? CHROME_VERSIONS : FIREFOX_VERSIONS).map(v => <option key={v} value={v} className="bg-surface text-zinc-100">{v}</option>)}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-center gap-2 lg:gap-4">
                    <label className="text-left lg:text-right text-muted font-medium">OS</label>
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
                              <Icon className={`w-4 h-4 ${isSelected ? 'text-primary' : 'text-zinc-300'}`} />
                            </button>
                            <div className="w-px h-6 bg-border"></div>
                            <div className="relative">
                              <select value={isSelected ? pd.osVersion : os.versions[0]} onChange={e => { updatePd('os', os.id); updatePd('osVersion', e.target.value); }} className="appearance-none bg-transparent outline-none text-muted hover:text-zinc-200 px-3 pr-8 py-2 text-sm cursor-pointer">
                                {os.versions.map(v => <option key={v} value={v} className="bg-surface text-zinc-100">{v}</option>)}
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
                    <div className="text-left lg:text-right mt-2"><label className="text-muted font-medium block">User-Agent</label></div>
                    <div className="w-full flex flex-col sm:flex-row gap-3 items-start">
                      <CustomSelect value={pd.uaCategory} onChange={e => updatePd('uaCategory', e.target.value)} className="w-full sm:w-[200px] shrink-0">
                        <option value="All">All Categories</option>
                        {filteredUAGroups.map((g, i) => <option key={i} value={g.label}>{g.label}</option>)}
                      </CustomSelect>
                      <div className="flex w-full gap-2">
                        <CustomSelect value={pd.userAgent} onChange={e => updatePd('userAgent', e.target.value)} className="flex-1 min-w-0">
                          <option value="Auto">Auto (Smart assignment from unused profiles)</option>
                          {filteredUAGroups.filter(g => pd.uaCategory === 'All' || g.label === pd.uaCategory).map((group, idx) => (
                            <optgroup key={idx} label={group.label} className="bg-surface text-primary font-semibold italic">
                              {group.options.map((ua, optIdx) => (
                                <option key={optIdx} value={ua} className="text-zinc-100 font-mono not-italic text-xs">{ua.length > 60 ? ua.slice(0, 60) + '...' : ua}</option>
                              ))}
                            </optgroup>
                          ))}
                        </CustomSelect>
                        <button type="button" onClick={handleRollAgent} title="Swap to a random User-Agent" className="shrink-0 h-10 w-10 flex items-center justify-center bg-surface hover:bg-muted-dark border border-border text-zinc-200 rounded transition"><RefreshCcw className="w-4 h-4" /></button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-center gap-2 lg:gap-4">
                    <label className="text-left lg:text-right text-muted font-medium"><span className="text-red-500 mr-1">*</span>Group</label>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <CustomSelect value={pd.group} onChange={e => updatePd('group', e.target.value)} className="w-full sm:w-[220px]">
                        <option value="Ungrouped">Ungrouped</option><option value="New">+ Add new group</option><option value="Lead Gen">Lead Gen</option>
                      </CustomSelect>
                      <div className="flex-1 flex items-center gap-2 bg-background border border-border rounded px-3 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition">
                        <Tag className="w-4 h-4 text-muted" />
                        <input type="text" value={pd.tags} onChange={e => updatePd('tags', e.target.value)} placeholder="Tags" className="w-full bg-transparent outline-none text-zinc-100 py-2.5 text-sm" />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-start gap-2 lg:gap-4">
                    <label className="text-left lg:text-right text-muted font-medium mt-2">Cookie</label>
                    <div className="w-full">
                      <textarea value={pd.cookie} onChange={e => updatePd('cookie', e.target.value)} rows="3" placeholder="Formats: JSON, Netscape, Name=Value" className="w-full bg-background border border-border rounded px-4 py-3 text-zinc-100 outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-y font-mono text-xs transition"></textarea>
                      {isEditing && <p className="text-xs text-muted mt-2 text-right italic">+ Fetched from browser memory</p>}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-start gap-2 lg:gap-4">
                    <label className="text-left lg:text-right text-muted font-medium mt-2">Remarks / Notes</label>
                    <textarea value={pd.remark} onChange={e => updatePd('remark', e.target.value)} rows="2" placeholder="Optional notes for this profile..." className="w-full bg-background border border-border rounded px-4 py-3 text-zinc-100 outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-y transition"></textarea>
                  </div>
                </div>
              )}

              {/* Proxy Tab */}
              {activeTab === 'Proxy' && (
                <div className="space-y-8 max-w-3xl">
                  <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-center gap-2 lg:gap-4">
                    <label className="text-left lg:text-right text-muted font-medium">Proxy setting</label>
                    <ButtonTabs value={pd.proxySetting} onChange={v => { updatePd('proxySetting', v); setProxyResult(null); setError(''); }} options={['Custom', 'Saved Proxies', 'Rotating Proxy']} />
                  </div>

                  {pd.proxySetting === 'Custom' && (
                    <>
                      <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-start gap-2 lg:gap-4">
                        <label className="text-left lg:text-right text-muted font-medium mt-2">Proxy type</label>
                        <div className="flex flex-col gap-4">
                          <div className="flex flex-wrap gap-3">
                            <CustomSelect value={pd.proxyType} onChange={e => updatePd('proxyType', e.target.value)} className="w-[140px]"><option value="HTTP">HTTP</option><option value="HTTPS">HTTPS</option><option value="Socks5">Socks5</option><option value="Local">Local</option></CustomSelect>
                            <CustomSelect value={pd.ipChecker} onChange={e => updatePd('ipChecker', e.target.value)} className="w-[180px]"><option value="IP2Location">IP2Location</option><option value="IPinfo">IPinfo</option></CustomSelect>
                            <Button variant="secondary" onClick={handleCheckProxy} disabled={checkingProxy} className="gap-2">
                              {checkingProxy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />} {checkingProxy ? 'Checking...' : 'Check network'}
                            </Button>
                          </div>
                          {proxyResult && (
                            <div className="text-sm bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-4 rounded w-full max-w-xl">
                              <div className="font-semibold flex items-center gap-2 mb-3"><Check className="w-4 h-4"/> Connection Successful</div>
                              <div className="grid grid-cols-3 gap-4">
                                <div><span className="text-emerald-500/70 block text-xs mb-1 uppercase tracking-wider">IP</span> {proxyResult.ip || pd.proxyHost}</div>
                                <div><span className="text-emerald-500/70 block text-xs mb-1 uppercase tracking-wider">Country</span> {proxyResult.country || 'US'}</div>
                                <div><span className="text-emerald-500/70 block text-xs mb-1 uppercase tracking-wider">Latency</span> {proxyResult.latencyMs || '120'}ms</div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-start gap-2 lg:gap-4 pt-2">
                        <label className="text-left lg:text-right text-muted font-medium mt-2"></label>
                        <div className="space-y-4 w-full">
                          <p className="text-xs text-primary italic bg-primary/10 border border-primary/20 px-3 py-2 rounded w-max mb-4">💡 Tip: Paste your proxy "host:port:user:pass" into the Host field to auto-fill.</p>
                          <div className="flex gap-4">
                            <input type="text" placeholder="Host (e.g. proxy.smartproxy.net)" value={pd.proxyHost} onChange={e => updatePd('proxyHost', e.target.value)} onPaste={handleProxyPaste} className="w-full flex-1 bg-background border border-border rounded px-4 py-2.5 text-zinc-100 outline-none focus:border-primary focus:ring-1 font-mono text-sm" />
                            <input type="text" placeholder="Port" value={pd.proxyPort} onChange={e => updatePd('proxyPort', e.target.value)} className="w-[140px] bg-background border border-border rounded px-4 py-2.5 text-zinc-100 outline-none focus:border-primary focus:ring-1 font-mono text-sm" />
                          </div>
                          <div className="flex gap-4">
                            <input type="text" placeholder="Proxy Username (Optional)" value={pd.proxyUser} onChange={e => updatePd('proxyUser', e.target.value)} className="w-full flex-1 bg-background border border-border rounded px-4 py-2.5 text-zinc-100 outline-none focus:border-primary focus:ring-1 font-mono text-sm" />
                            <input type="text" placeholder="Proxy Password (Optional)" value={pd.proxyPass} onChange={e => updatePd('proxyPass', e.target.value)} className="w-full flex-1 bg-background border border-border rounded px-4 py-2.5 text-zinc-100 outline-none focus:border-primary focus:ring-1 font-mono text-sm" />
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                  {pd.proxySetting === 'Saved Proxies' && (
                    <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-start gap-2 lg:gap-4 mt-4">
                      <label className="text-left lg:text-right text-muted font-medium mt-2">Select Proxy</label>
                      <CustomSelect value={pd.selectedSavedProxy} onChange={e => updatePd('selectedSavedProxy', e.target.value)} className="w-full max-w-md">
                        <option value="">-- Choose a saved proxy --</option>
                        {MOCK_SAVED_PROXIES.map(p => <option key={p.id} value={p.id}>{p.name} ({p.host}:{p.port})</option>)}
                      </CustomSelect>
                    </div>
                  )}
                </div>
              )}

              {/* Platform Tab */}
              {activeTab === 'Platform' && (
                <div className="space-y-8 max-w-3xl">
                  <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-start gap-2 lg:gap-4">
                    <label className="text-left lg:text-right text-muted font-medium mt-2">Startup Tabs</label>
                    <div className="w-full">
                      <textarea value={pd.startupUrls} onChange={e => updatePd('startupUrls', e.target.value)} rows="3" placeholder="https://facebook.com&#10;https://google.com&#10;(Enter one URL per line)" className="w-full bg-background border border-border rounded px-4 py-3 text-zinc-100 outline-none focus:border-primary focus:ring-1 resize-y font-mono text-sm"></textarea>
                      <p className="text-xs text-muted mt-2 italic">URLs to open automatically when the profile launches.</p>
                    </div>
                  </div>
                  <div className="w-full h-px bg-border"></div>
                  <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] items-start gap-2 lg:gap-4">
                    <div className="text-left lg:text-right mt-2">
                      <label className="text-muted font-medium block">Platform Accounts</label>
                      <button type="button" onClick={() => updatePd('platformAccounts', [...pd.platformAccounts, { platform: 'Facebook', username: '', password: '' }])} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-hover transition">
                        <Plus className="w-4 h-4" /> Add Account
                      </button>
                    </div>
                    <div className="w-full space-y-4">
                      {pd.platformAccounts.length === 0 && <div className="text-sm text-muted italic p-6 border border-dashed border-border rounded text-center bg-surface">No platform credentials added.</div>}
                      {pd.platformAccounts.map((acc, idx) => (
                        <div key={idx} className="flex flex-col sm:flex-row gap-3 items-start sm:items-center bg-background p-4 rounded border border-border shadow-sm">
                          <CustomSelect value={acc.platform} onChange={e => { const a = [...pd.platformAccounts]; a[idx].platform = e.target.value; updatePd('platformAccounts', a); }} className="w-full sm:w-[160px] shrink-0">
                            {['Facebook', 'Instagram', 'Twitter / X', 'Amazon', 'Google', 'TikTok', 'LinkedIn', 'Other'].map(opt => <option key={opt} value={opt}>{opt}</option>)}
                          </CustomSelect>
                          <input type="text" placeholder="Username / Email" value={acc.username} onChange={e => { const a = [...pd.platformAccounts]; a[idx].username = e.target.value; updatePd('platformAccounts', a); }} className="w-full sm:flex-1 bg-surface border border-border rounded px-3 py-2 text-zinc-100 outline-none focus:border-primary text-sm" />
                          <input type="password" placeholder="Password" value={acc.password} onChange={e => { const a = [...pd.platformAccounts]; a[idx].password = e.target.value; updatePd('platformAccounts', a); }} className="w-full sm:flex-1 bg-surface border border-border rounded px-3 py-2 text-zinc-100 outline-none focus:border-primary text-sm" />
                          <button type="button" onClick={() => { const a = [...pd.platformAccounts]; a.splice(idx, 1); updatePd('platformAccounts', a); }} className="p-2 text-muted hover:text-red-400 bg-surface rounded border border-transparent hover:border-red-500/30 transition"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* COMPREHENSIVE FINGERPRINT TAB */}
              {activeTab === 'Fingerprint' && (
                <div className="max-w-4xl pr-4 pb-10">
                  <h2 className="text-zinc-100 font-semibold text-base mb-6 flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-primary"/> Core Identity
                  </h2>
                  
                  <FpRow label="WebRTC" description="Controls WebRTC behavior to prevent real IP leaks while keeping compatibility.">
                    <ButtonTabs value={pd.webrtc} onChange={v => updatePd('webrtc', v)} options={['Forward', 'Replace', 'Real', 'Disabled', 'Proxy UDP']} />
                  </FpRow>

                  <FpRow label="Timezone" description="Browser timezone matches proxy location or your system.">
                    <ButtonTabs value={pd.timezoneType} onChange={v => updatePd('timezoneType', v)} options={['Based on IP', 'Real', 'Custom']} />
                    {pd.timezoneType === 'Custom' && (
                      <input type="text" placeholder="e.g. America/New_York" value={pd.timezoneCustom} onChange={e => updatePd('timezoneCustom', e.target.value)} className="w-[250px] bg-background border border-border rounded px-3 py-2 text-zinc-100 outline-none focus:border-primary mt-3 text-sm" />
                    )}
                  </FpRow>

                  <FpRow label="Location" description="Geolocation API permission behavior and coordinates.">
                    <div className="flex gap-4 items-center">
                      <ButtonTabs value={pd.locationType} onChange={v => updatePd('locationType', v)} options={['Based on IP', 'Custom', 'Block']} />
                      {pd.locationType !== 'Block' && (
                        <CustomSelect value={pd.locationPrompt} onChange={e => updatePd('locationPrompt', e.target.value)} className="w-[180px]">
                          <option value="Ask each time">Ask each time</option><option value="Always allow">Always allow</option>
                        </CustomSelect>
                      )}
                    </div>
                    {pd.locationType === 'Custom' && (
                      <div className="flex gap-3 mt-3">
                        <input type="text" placeholder="Latitude (e.g. 52.3676)" value={pd.locationLat} onChange={e => updatePd('locationLat', e.target.value)} className="w-[160px] bg-background border border-border rounded px-3 py-2 text-zinc-100 outline-none focus:border-primary text-sm" />
                        <input type="text" placeholder="Longitude (e.g. 4.9041)" value={pd.locationLng} onChange={e => updatePd('locationLng', e.target.value)} className="w-[160px] bg-background border border-border rounded px-3 py-2 text-zinc-100 outline-none focus:border-primary text-sm" />
                        <input type="text" placeholder="Accuracy (m)" value={pd.locationAcc} onChange={e => updatePd('locationAcc', e.target.value)} className="w-[120px] bg-background border border-border rounded px-3 py-2 text-zinc-100 outline-none focus:border-primary text-sm" />
                      </div>
                    )}
                  </FpRow>

                  <FpRow label="Language" description="Navigator language code for website requests.">
                    <ButtonTabs value={pd.languageType} onChange={v => updatePd('languageType', v)} options={['Based on IP', 'Custom']} />
                    {pd.languageType === 'Custom' && (
                      <input type="text" placeholder="e.g. en-US,en;q=0.9" value={pd.languageCustom} onChange={e => updatePd('languageCustom', e.target.value)} className="w-[250px] bg-background border border-border rounded px-3 py-2 text-zinc-100 outline-none focus:border-primary mt-3 text-sm" />
                    )}
                  </FpRow>

                  <FpRow label="Display Language" description="Browser internal UI language. Websites can sometimes read this.">
                    <ButtonTabs value={pd.displayLangType} onChange={v => updatePd('displayLangType', v)} options={['Based on Language', 'Real', 'Custom']} />
                    {pd.displayLangType === 'Custom' && (
                      <input type="text" placeholder="e.g. en-US" value={pd.displayLangCustom} onChange={e => updatePd('displayLangCustom', e.target.value)} className="w-[250px] bg-background border border-border rounded px-3 py-2 text-zinc-100 outline-none focus:border-primary mt-3 text-sm" />
                    )}
                  </FpRow>

                  <FpRow label="Screen Resolution" description="Dimensions reported to websites. Keep consistent with your device/OS.">
                    <div className="flex flex-col gap-4">
                      <ButtonTabs value={pd.resolutionType} onChange={v => updatePd('resolutionType', v)} options={['Random', 'Predefined', 'Custom']} />
                      {pd.resolutionType === 'Predefined' && (
                        <CustomSelect value={pd.resolutionPredefined} onChange={e => updatePd('resolutionPredefined', e.target.value)} className="w-[220px]">
                          {['1920x1080', '1366x768', '2560x1440', '1536x864', '3840x2160', '1280x720', '414x896', '375x812', '390x844'].map(r => <option key={r} value={r}>{r}</option>)}
                        </CustomSelect>
                      )}
                      {pd.resolutionType === 'Custom' && (
                        <div className="flex items-center gap-3">
                          <input type="text" placeholder="Width" value={pd.resolutionW} onChange={e => updatePd('resolutionW', e.target.value)} className="w-[120px] bg-background border border-border rounded px-3 py-2 text-zinc-100 outline-none focus:border-primary text-center text-sm" />
                          <span className="text-muted font-medium">x</span>
                          <input type="text" placeholder="Height" value={pd.resolutionH} onChange={e => updatePd('resolutionH', e.target.value)} className="w-[120px] bg-background border border-border rounded px-3 py-2 text-zinc-100 outline-none focus:border-primary text-center text-sm" />
                        </div>
                      )}
                    </div>
                  </FpRow>
                  
                  <FpRow label="Fonts" description="System fonts exposed to websites.">
                    <ButtonTabs value={pd.fontsType} onChange={v => updatePd('fontsType', v)} options={['Default', 'Custom']} />
                  </FpRow>

                  <h2 className="text-zinc-100 font-semibold text-base mt-10 mb-6 flex items-center gap-2">
                    <Settings2 className="w-5 h-5 text-orange-400"/> Hardware Noise & Graphics
                  </h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 mb-8">
                    <div className="flex items-center justify-between bg-background p-4 rounded border border-border shadow-sm">
                      <span className="text-zinc-200 text-sm font-medium">Canvas Noise</span>
                      <ToggleSwitch checked={pd.canvasNoise} onChange={v => updatePd('canvasNoise', v)} />
                    </div>
                    <div className="flex items-center justify-between bg-background p-4 rounded border border-border shadow-sm">
                      <span className="text-zinc-200 text-sm font-medium">WebGL Image Noise</span>
                      <ToggleSwitch checked={pd.webglImageNoise} onChange={v => updatePd('webglImageNoise', v)} />
                    </div>
                    <div className="flex items-center justify-between bg-background p-4 rounded border border-border shadow-sm">
                      <span className="text-zinc-200 text-sm font-medium">AudioContext Noise</span>
                      <ToggleSwitch checked={pd.audioContextNoise} onChange={v => updatePd('audioContextNoise', v)} />
                    </div>
                    <div className="flex items-center justify-between bg-background p-4 rounded border border-border shadow-sm">
                      <span className="text-zinc-200 text-sm font-medium">ClientRects Noise</span>
                      <ToggleSwitch checked={pd.clientRectsNoise} onChange={v => updatePd('clientRectsNoise', v)} />
                    </div>
                    <div className="flex items-center justify-between bg-background p-4 rounded border border-border shadow-sm">
                      <span className="text-zinc-200 text-sm font-medium">SpeechVoices Noise</span>
                      <ToggleSwitch checked={pd.speechVoicesNoise} onChange={v => updatePd('speechVoicesNoise', v)} />
                    </div>
                    <div className="flex items-center justify-between bg-background p-4 rounded border border-border shadow-sm">
                      <span className="text-zinc-200 text-sm font-medium">Media Device</span>
                      <ButtonTabs value={pd.mediaDevice} onChange={v => updatePd('mediaDevice', v)} options={['Auto', 'Edit']} />
                    </div>
                  </div>

                  <FpRow label="WebGL Metadata" description="Extremely important. Mismatched GPU and OS will flag you.">
                    <div className="flex flex-col gap-4">
                      <ButtonTabs value={pd.webglMetadata} onChange={v => updatePd('webglMetadata', v)} options={['Real', 'Custom']} />
                      {pd.webglMetadata === 'Custom' && (
                        <div className="space-y-5 bg-background p-5 rounded border border-border shadow-sm">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-primary text-sm font-semibold">Configure Custom GPU</span>
                            <Button size="sm" variant="secondary" onClick={handleRandomWebGL} className="gap-2">
                              <Zap className="w-4 h-4 text-amber-400" /> Auto Randomize
                            </Button>
                          </div>
                          <div>
                            <label className="text-muted text-xs uppercase tracking-wider font-semibold block mb-2">Vendor</label>
                            <CustomSelect value={pd.webglVendor} onChange={e => { updatePd('webglVendor', e.target.value); updatePd('webglRenderer', WEBGL_RENDERERS[e.target.value][0]); }} className="w-full">
                              {WEBGL_VENDORS.map(v => <option key={v} value={v}>{v}</option>)}
                            </CustomSelect>
                          </div>
                          <div>
                            <label className="text-muted text-xs uppercase tracking-wider font-semibold block mb-2">Renderer</label>
                            <CustomSelect value={pd.webglRenderer} onChange={e => updatePd('webglRenderer', e.target.value)} className="w-full">
                              {(WEBGL_RENDERERS[pd.webglVendor] || []).map(r => <option key={r} value={r}>{r}</option>)}
                            </CustomSelect>
                          </div>
                        </div>
                      )}
                    </div>
                  </FpRow>

                  <FpRow label="WebGPU" description="Modern replacement for WebGL in newer browsers.">
                    <ButtonTabs value={pd.webgpu} onChange={v => updatePd('webgpu', v)} options={['Based on WebGL', 'Real', 'Disabled']} />
                  </FpRow>

                  <h2 className="text-zinc-100 font-semibold text-base mt-10 mb-6 flex items-center gap-2">
                    <Monitor className="w-5 h-5 text-emerald-400"/> Hardware Configuration
                  </h2>

                  <FpRow label="CPU Cores">
                    <div className="flex items-center gap-4">
                      <ButtonTabs value={pd.cpuType} onChange={v => updatePd('cpuType', v)} options={['Real', 'Custom']} />
                      {pd.cpuType === 'Custom' && (
                        <CustomSelect value={pd.cpuCores} onChange={e => updatePd('cpuCores', e.target.value)} className="w-[140px]">
                          {['2', '4', '6', '8', '10', '12', '16'].map(v => <option key={v} value={v}>{v} cores</option>)}
                        </CustomSelect>
                      )}
                    </div>
                  </FpRow>

                  <FpRow label="RAM">
                    <div className="flex items-center gap-4">
                      <ButtonTabs value={pd.ramType} onChange={v => updatePd('ramType', v)} options={['Real', 'Custom']} />
                      {pd.ramType === 'Custom' && (
                        <CustomSelect value={pd.ramGb} onChange={e => updatePd('ramGb', e.target.value)} className="w-[140px]">
                          {['2', '4', '8', '16', '32'].map(v => <option key={v} value={v}>{v} GB</option>)}
                        </CustomSelect>
                      )}
                    </div>
                  </FpRow>

                  <FpRow label="Device Name" description="Internal identifier, mostly organizational.">
                    <div className="flex flex-col gap-4">
                      <ButtonTabs value={pd.deviceNameType} onChange={v => updatePd('deviceNameType', v)} options={['Real', 'Custom']} />
                      {pd.deviceNameType === 'Custom' && (
                        <div className="flex items-center gap-3">
                          <input type="text" value={pd.deviceName} onChange={e => updatePd('deviceName', e.target.value)} className="w-[280px] bg-background border border-border rounded px-4 py-2 text-zinc-100 outline-none focus:border-primary font-mono text-sm shadow-sm" />
                          <Button size="sm" variant="secondary" onClick={() => updatePd('deviceName', generateDeviceName())} title="Generate random device name" className="px-3 py-2">
                            <RefreshCcw className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </FpRow>

                  <FpRow label="MAC Address" description="Helps isolate profiles inside local network bounds.">
                    <div className="flex flex-col gap-4">
                      <ButtonTabs value={pd.macAddressType} onChange={v => updatePd('macAddressType', v)} options={['Real', 'Custom']} />
                      {pd.macAddressType === 'Custom' && (
                        <div className="flex items-center gap-3">
                          <input type="text" value={pd.macAddress} onChange={e => updatePd('macAddress', e.target.value)} className="w-[280px] bg-background border border-border rounded px-4 py-2 text-zinc-100 outline-none focus:border-primary font-mono text-sm shadow-sm" />
                          <Button size="sm" variant="secondary" onClick={() => updatePd('macAddress', generateMac())} title="Generate random MAC address" className="px-3 py-2">
                            <RefreshCcw className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </FpRow>

                  <h2 className="text-zinc-100 font-semibold text-base mt-10 mb-6 flex items-center gap-2">
                    <Terminal className="w-5 h-5 text-purple-400"/> Advanced Fingerprint Settings
                  </h2>

                  <FpRow label="Do Not Track">
                    <ButtonTabs value={pd.doNotTrack} onChange={v => updatePd('doNotTrack', v)} options={['Default', 'Open', 'Close']} />
                  </FpRow>
                  
                  <FpRow label="Port Scan Protection">
                    <ButtonTabs value={pd.portScanProtection} onChange={v => updatePd('portScanProtection', v)} options={['Enable', 'Close']} />
                  </FpRow>

                  <FpRow label="Hardware Acceleration">
                    <ButtonTabs value={pd.hardwareAcceleration} onChange={v => updatePd('hardwareAcceleration', v)} options={['Default', 'Open', 'Close']} />
                  </FpRow>

                  <FpRow label="Disable TLS Features">
                    <ButtonTabs value={pd.disableTls} onChange={v => updatePd('disableTls', v)} options={['Open', 'Close']} />
                  </FpRow>

                  <FpRow label="Launch Args" description="Additional raw Chromium startup arguments (e.g. --disable-notifications)">
                    <textarea value={pd.launchArgs} onChange={e => updatePd('launchArgs', e.target.value)} rows="3" placeholder="--disable-notifications&#10;--disable-gpu" className="w-full bg-background border border-border rounded px-4 py-3 text-zinc-100 outline-none focus:border-primary resize-y font-mono text-xs shadow-sm"></textarea>
                  </FpRow>

                </div>
              )}

              {/* NEW ADVANCED TAB */}
              {activeTab === 'Advanced' && (
                <div className="max-w-4xl pr-4 pb-10">
                  <h2 className="text-zinc-100 font-semibold text-base mb-6 flex items-center gap-2">
                    <Settings2 className="w-5 h-5 text-primary"/> Core Settings
                  </h2>
                  
                  <FpRow label="Extension" description="The enabled extensions from [Extensions - Team's Extensions] will be installed in the profile.">
                    <CustomSelect value={pd.advancedExt} onChange={e => updatePd('advancedExt', e.target.value)} className="w-[220px]">
                      <option value="Team">Team's Extensions</option>
                      <option value="None">No Extensions</option>
                    </CustomSelect>
                  </FpRow>

                  <FpRow label="Data Sync" description="Select the data you need to sync across devices.">
                    <div className="space-y-4">
                      <ButtonTabs value={pd.advancedSync} onChange={v => updatePd('advancedSync', v)} options={['Global', 'Customize']} />
                      {pd.advancedSync === 'Customize' && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-5 bg-background p-6 rounded border border-border shadow-sm">
                          <CustomCheckbox label="Cookie" checked={pd.syncItems.cookie} onChange={v => updateNestedPd('syncItems', 'cookie', v)} />
                          <CustomCheckbox label="Saved passwords" checked={pd.syncItems.passwords} onChange={v => updateNestedPd('syncItems', 'passwords', v)} />
                          <CustomCheckbox label="Bookmarks" checked={pd.syncItems.bookmarks} onChange={v => updateNestedPd('syncItems', 'bookmarks', v)} />
                          <CustomCheckbox label="Local storage" checked={pd.syncItems.localStorage} onChange={v => updateNestedPd('syncItems', 'localStorage', v)} />
                          <CustomCheckbox label="IndexedDB" checked={pd.syncItems.indexedDB} onChange={v => updateNestedPd('syncItems', 'indexedDB', v)} />
                          <CustomCheckbox label="Extension Data" checked={pd.syncItems.extensionData} onChange={v => updateNestedPd('syncItems', 'extensionData', v)} />
                          <CustomCheckbox label="History" checked={pd.syncItems.history} onChange={v => updateNestedPd('syncItems', 'history', v)} />
                        </div>
                      )}
                    </div>
                  </FpRow>

                  <FpRow label="Browser Settings" description="General browser behaviors and startup limits.">
                    <div className="space-y-4">
                      <ButtonTabs value={pd.advancedBrowser} onChange={v => updatePd('advancedBrowser', v)} options={['Global', 'Customize']} />
                      {pd.advancedBrowser === 'Customize' && (
                        <div className="space-y-5 bg-background p-6 rounded border border-border shadow-sm">
                          <CustomCheckbox label="Real-time match timezone and location to dynamic IP" checked={pd.browserSettings.matchTimezone} onChange={v => updateNestedPd('browserSettings', 'matchTimezone', v)} />
                          <CustomCheckbox label="Allow Chrome sign-in (Disabling logs you out of Google)" checked={pd.browserSettings.allowChromeSignIn} onChange={v => updateNestedPd('browserSettings', 'allowChromeSignIn', v)} />
                          <CustomCheckbox label="Offer to translate pages" checked={pd.browserSettings.offerTranslate} onChange={v => updateNestedPd('browserSettings', 'offerTranslate', v)} />
                          <CustomCheckbox label="Disable access to Browser Developer Tools" checked={pd.browserSettings.disableDevTools} onChange={v => updateNestedPd('browserSettings', 'disableDevTools', v)} />
                          <CustomCheckbox label="Disable installation and removal of extensions" checked={pd.browserSettings.disableExtInstall} onChange={v => updateNestedPd('browserSettings', 'disableExtInstall', v)} />
                          <CustomCheckbox label="Enable virtual camera to simulate live feed" checked={pd.browserSettings.enableVirtualCamera} onChange={v => updateNestedPd('browserSettings', 'enableVirtualCamera', v)} />
                          <CustomCheckbox label="Enable mobile simulation optimization" checked={pd.browserSettings.enableMobileSim} onChange={v => updateNestedPd('browserSettings', 'enableMobileSim', v)} />
                          
                          <div className="border-t border-border my-6 pt-6">
                            <label className="text-muted text-xs uppercase tracking-wider font-semibold block mb-3">On startup</label>
                            <CustomSelect value={pd.browserSettings.startupAction} onChange={e => updateNestedPd('browserSettings', 'startupAction', e.target.value)} className="w-full sm:w-[320px] mb-5">
                              <option value="lastPage">Continue browsing the last opened page</option>
                              <option value="blank">Open new blank tab</option>
                            </CustomSelect>
                            
                            <div className="space-y-4">
                              <CustomCheckbox label="Only open the browser with an available proxy" checked={pd.browserSettings.onlyOpenWithProxy} onChange={v => updateNestedPd('browserSettings', 'onlyOpenWithProxy', v)} />
                              <CustomCheckbox label="Only open browser when extension data is successfully loaded" checked={pd.browserSettings.onlyOpenExtLoaded} onChange={v => updateNestedPd('browserSettings', 'onlyOpenExtLoaded', v)} />
                              <CustomCheckbox label="Secure access (Warn before non-HTTPS)" checked={pd.browserSettings.secureAccess} onChange={v => updateNestedPd('browserSettings', 'secureAccess', v)} />
                              <CustomCheckbox label="Disable loading videos" checked={pd.browserSettings.disableVideos} onChange={v => updateNestedPd('browserSettings', 'disableVideos', v)} />
                            </div>
                            
                            <div className="flex items-center gap-3 mt-6 p-4 bg-surface rounded border border-border">
                              <span className="text-sm text-zinc-200">Disable loading images over</span>
                              <input type="text" value={pd.browserSettings.disableImagesLimit} onChange={e => updateNestedPd('browserSettings', 'disableImagesLimit', e.target.value)} className="w-[80px] bg-background border border-border rounded px-3 py-1.5 text-center text-zinc-100 outline-none focus:border-primary text-sm shadow-sm" />
                              <span className="text-sm text-zinc-200">KB (0 KB means no images loaded)</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </FpRow>

                  <FpRow label="Random Fingerprint" description="New fingerprint will be randomly generated on each startup, ignoring some existing settings.">
                    <ToggleSwitch checked={pd.randomFingerprint} onChange={v => updatePd('randomFingerprint', v)} />
                  </FpRow>
                </div>
              )}
            </div>

            {/* Bottom Actions */}
            <div className="bg-surface border-t border-border p-5 flex justify-end gap-3 shrink-0 rounded-b">
              <Button variant="secondary" onClick={closeEditor}>Cancel</Button>
              <Button variant="primary" onClick={handleSaveProfile} isLoading={saving}>Save Profile</Button>
            </div>
          </div>

          {/* Right Sidebar Matrix */}
          <div className="hidden lg:flex w-80 shrink-0 bg-surface rounded border border-border p-5 flex-col shadow-sm h-fit sticky top-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-sm font-semibold text-zinc-100 uppercase tracking-wider">Environment Overview</h2>
              <button className="text-primary hover:text-primary-hover transition-colors text-xs flex items-center gap-1 font-medium"><Settings2 className="h-3.5 w-3.5"/> Settings</button>
            </div>
            
            <div className="space-y-4 text-sm">
              <div className="flex justify-between items-center"><span className="text-muted">OS</span><span className="text-zinc-100 font-medium bg-background px-2 py-1 rounded border border-border">{pd.os} {pd.osVersion}</span></div>
              <div className="flex justify-between items-center"><span className="text-muted">Browser</span><span className="text-zinc-100 font-medium bg-background px-2 py-1 rounded border border-border">{pd.browserCore} {pd.browserVersion}</span></div>
              
              <div className="flex flex-col gap-2 pt-4 border-t border-border">
                <span className="text-muted text-xs uppercase tracking-wider font-semibold">Generated User-Agent</span>
                <span className="text-primary font-mono text-xs bg-primary/5 border border-primary/20 p-3 rounded break-all leading-relaxed shadow-inner max-h-40 overflow-y-auto">{displayUA}</span>
              </div>
              
              <div className="flex justify-between items-center pt-4 border-t border-border"><span className="text-muted">Timezone</span><span className="text-zinc-100 font-medium">{pd.timezoneType}</span></div>
              <div className="flex justify-between items-center"><span className="text-muted">WebRTC</span><span className="text-zinc-100 font-medium">{pd.webrtc}</span></div>
              <div className="flex justify-between items-center"><span className="text-muted">MAC</span><span className="text-zinc-200 font-mono text-xs bg-background px-2 py-1 rounded border border-border">{pd.macAddress}</span></div>
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
        eyebrow="Workspace" 
        title="Profiles" 
        actions={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowTemplates(true)}>
              <LayoutTemplate className="h-4 w-4" />
              Templates
            </Button>
            <Button variant="secondary">
              <FileSpreadsheet className="h-4 w-4" />
              Batch Create
            </Button>
            <Button variant="primary" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              New Profile
            </Button>
          </div>
        } 
      />
      {error && <div className="mb-5 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}
      
      {selectedIds.size > 0 && (
        <div className="mb-5 flex items-center gap-4 rounded border border-primary/30 bg-primary/5 px-5 py-3.5 shadow-glow shadow-primary/10 transition-all">
          <span className="text-sm text-primary font-bold">{selectedIds.size} selected</span>
          <div className="flex gap-2 ml-auto">
            <Button size="sm" disabled={bulkBusy} onClick={handleBulkLaunch} className="bg-emerald-600 hover:bg-emerald-500 text-white border-transparent">Launch</Button>
            <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={handleBulkClose}>Close</Button>
            <Button size="sm" variant="danger" disabled={bulkBusy} onClick={handleBulkDelete}>Delete</Button>
            <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={clearSelection}>Clear</Button>
          </div>
        </div>
      )}
      
      <div className="mb-6 flex flex-wrap items-center gap-3 bg-surface p-3 rounded border border-border shadow-sm">
        <CustomSelect value={filterGroup} onChange={(e) => setFilterGroup(e.target.value)} className="w-auto">
          <option value="all">All groups</option>
          <option value="ungrouped">Ungrouped</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </CustomSelect>

        <CustomSelect value={filterTag} onChange={(e) => setFilterTag(e.target.value)} className="w-auto">
          <option value="">All tags</option>
          {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
        </CustomSelect>

        <CustomSelect value={filterProxy} onChange={(e) => setFilterProxy(e.target.value)} className="w-auto">
          <option value="">All proxies</option>
          <option value="none">Direct (no proxy)</option>
          {allProxies.map((px) => <option key={px.id} value={px.id}>{px.name}</option>)}
        </CustomSelect>

        <CustomSelect value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-auto">
          <option value="all">Any status</option>
          <option value="running">Running</option>
          <option value="proxied">Has proxy</option>
          <option value="direct">No proxy</option>
        </CustomSelect>

        <div className="relative flex-1 min-w-[200px] max-w-[300px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name…" className="w-full bg-background border border-border rounded pl-9 pr-3 py-2 text-sm text-zinc-100 outline-none focus:border-primary transition shadow-sm" />
        </div>
        {(filterGroup !== 'all' || filterTag || filterProxy || filterStatus !== 'all' || search) && (
          <Button variant="ghost" size="sm" onClick={() => { setFilterGroup('all'); setFilterTag(''); setFilterProxy(''); setFilterStatus('all'); setSearch(''); }}>Clear Filters</Button>
        )}
        <span className="ml-auto text-sm text-muted font-medium bg-background px-3 py-1.5 rounded border border-border shadow-inner">{filteredProfiles.length} profiles</span>
      </div>
      
      <Card className="bg-surface border-border flex flex-col shadow-xl flex-1 rounded">
        <CardContent className="p-0 overflow-auto flex-1 rounded">
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[1120px] border-collapse text-left text-sm whitespace-nowrap">
              <thead className="bg-surface text-muted text-xs uppercase tracking-wider font-semibold border-b border-border sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-5 py-4 w-12 text-center">
                    <button type="button" onClick={toggleSelectAll} className={`w-4 h-4 mx-auto rounded border flex items-center justify-center transition ${filteredProfiles.length > 0 && selectedIds.size === filteredProfiles.length ? 'bg-primary border-primary' : 'bg-background border-border hover:border-muted'}`}>
                      {filteredProfiles.length > 0 && selectedIds.size === filteredProfiles.length && <span className="w-2 h-2 bg-white rounded-sm" />}
                    </button>
                  </th>
                  <th className="px-5 py-4">Name</th>
                  <th className="px-5 py-4">Proxy</th>
                  <th className="px-5 py-4">Created</th>
                  <th className="px-5 py-4">Last used</th>
                  <th className="px-5 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredProfiles.length === 0 && (
                  <tr>
                    <td colSpan="6" className="p-12">
                       <EmptyState title="No Profiles Found" description="Create your first isolated browser profile to get started." icon={<Monitor className="w-10 h-10 text-muted" />} />
                    </td>
                  </tr>
                )}
                {filteredProfiles.map((p) => (
                  <tr key={p.id} className="hover:bg-card/50 transition-colors group">
                    <td className="px-5 py-3.5 text-center">
                      <button type="button" onClick={() => toggleSelect(p.id)} className={`w-4 h-4 mx-auto rounded border flex items-center justify-center transition ${selectedIds.has(p.id) ? 'bg-primary border-primary' : 'bg-background border-border hover:border-muted'}`}>
                        {selectedIds.has(p.id) && <span className="w-2 h-2 bg-white rounded-sm" />}
                      </button>
                    </td>
                    <td className="px-5 py-3.5 font-medium text-zinc-100">
                      <div className="flex items-center gap-3">
                        {runningIds.has(p.id) ? (
                          <div className="relative flex h-2.5 w-2.5 shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                          </div>
                        ) : (
                          <span className="w-2.5 h-2.5 rounded-full bg-muted-dark shrink-0" />
                        )}
                        <span className="truncate max-w-[200px]">{p.title}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="bg-card border border-border px-2.5 py-1 rounded text-xs font-mono text-zinc-300 shadow-sm">
                        {p.proxyInfoString ? p.proxyInfoString.split(':')[0] : 'Direct'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-muted text-xs">{formatDateTime(p.createdAt)}</td>
                    <td className="px-5 py-3.5 text-muted">
                      <button onClick={() => setActivityProfile({ id: p.id, title: p.title })} className="inline-flex items-center gap-2 hover:text-zinc-200 transition text-xs" title="View activity">
                        <History className="h-3.5 w-3.5" />
                        {p.lastUsedAt ? formatDateTime(p.lastUsedAt) : "Never"}
                        {p.launchCount ? <span className="text-[10px] bg-card border border-border px-1.5 py-0.5 rounded font-semibold ml-1">{p.launchCount}×</span> : null}
                      </button>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex justify-end gap-1.5">
                        {runningIds.has(p.id) ? (
                          <Button size="sm" variant="danger" onClick={() => handleBulkClose([p.id])} className="px-3" title="Stop">
                            <Square className="w-3.5 h-3.5 mr-1" /> Stop
                          </Button>
                        ) : (
                          <Button size="sm" className="bg-red-600 hover:bg-red-500 text-white shadow-glow shadow-red-500/20 px-3" onClick={() => handleLaunch(p.id)} title="Launch">
                            <Play className="w-3.5 h-3.5 mr-1" /> Launch
                          </Button>
                        )}
                        
                        <div className="w-px h-6 bg-border mx-1 my-auto" />
                        
                        <Button size="sm" variant="ghost" className="px-2.5" onClick={() => openEdit(p)} title="Edit Configuration">
                          <Settings2 className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="px-2.5" onClick={() => setLeakProfile({ id: p.id, title: p.title })} title="Leak Check">
                          <ShieldCheck className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="px-2.5" onClick={() => setCookieProfile({ id: p.id, title: p.title })} title="Manage Cookies">
                          <Cookie className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="px-2.5" onClick={() => handleClone(p.id)} title="Clone Profile">
                          <Copy className="w-4 h-4" />
                        </Button>
                        
                        <div className="w-px h-6 bg-border mx-1 my-auto" />

                        <Button size="sm" variant="ghost" className="px-2.5 text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={() => handleDelete(p.id, p.title)} title="Move to Trash">
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
      {showTemplates && (
        <TemplatesModal onClose={() => setShowTemplates(false)} onProfilesChanged={loadData} />
      )}
      {activityProfile && (
        <ActivityModal profileId={activityProfile.id} profileName={activityProfile.title} onClose={() => setActivityProfile(null)} />
      )}
    </>
  );
}