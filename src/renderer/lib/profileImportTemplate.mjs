// The profile import template (Batch Import > Download template): the exporter's column names
// (EXPORT_COLUMNS in src/main/ipcHandlers.js; the export also has Browser Brand and Created At, the
// template also has Cookie), so a template and an export are interchangeable, with sample values the
// importer reads back (src/main/importParser.js; test/profileImportTemplate.test.js imports this
// file through the real parser).
//
// Do Not Track takes the editor's words, as the exporter writes them: Default (keep the browser's own
// setting), Open (on) or Close (off). The importer also reads 1 / 0, on / off and true / false, but
// 0 means Close, not Default.

export const TEMPLATE_HEADERS = Object.freeze([
  'Profile Title', 'Group Name', 'Notes', 'Data Dir Name',
  'Operating System', 'Browser Core', 'User-Agent', 'Screen Resolution',
  'Proxy Method', 'Proxy Protocol', 'Proxy Info', 'Proxy Host', 'Proxy Port', 'Proxy Username', 'Proxy Password', 'Proxy Rotation URL',
  'WebRTC', 'Canvas', 'WebGL', 'WebGL Vendor', 'WebGL Renderer', 'AudioContext', 'CPU Cores', 'Memory (GB)', 'Do Not Track',
  'Timezone Mode', 'Timezone', 'Locale Mode', 'Locale', 'Geolocation Mode', 'Latitude', 'Longitude',
  'Account Username', 'Account Password', '2FA Key', 'Cookie', 'Open The Specified URL'
]);

export const TEMPLATE_ROWS = Object.freeze([
  {
    'Profile Title': 'LeadGen_01', 'Group Name': 'Lead Gen', 'Notes': 'Batch 1',
    'Operating System': 'Windows', 'Browser Core': 'Chrome', 'Screen Resolution': '1920x1080',
    'Proxy Method': 'Custom', 'Proxy Protocol': 'HTTP', 'Proxy Info': 'proxy.example.com:3100:proxy-user:secret1',
    'WebRTC': 'Forward', 'Canvas': 'Noise', 'WebGL': 'Noise', 'WebGL Vendor': 'Google Inc. (NVIDIA)',
    'WebGL Renderer': 'ANGLE (NVIDIA GeForce RTX 4060)', 'AudioContext': 'Noise', 'CPU Cores': '8', 'Memory (GB)': '16',
    'Do Not Track': 'Default', 'Timezone Mode': 'Auto', 'Locale Mode': 'Auto', 'Geolocation Mode': 'Prompt',
    'Account Username': 'user01', 'Account Password': 'pass01', 'Open The Specified URL': 'https://example.com'
  },
  {
    'Profile Title': 'LeadGen_02', 'Group Name': 'Lead Gen',
    'Operating System': 'macOS', 'Browser Core': 'Firefox', 'Screen Resolution': '1440x900',
    'Proxy Method': 'Custom', 'Proxy Protocol': 'SOCKS5', 'Proxy Info': 'proxy.example.com:3120:proxy-user:secret2',
    'Proxy Rotation URL': 'https://provider.example/api/rotate?token=abc',
    'WebRTC': 'Block', 'Canvas': 'Noise', 'WebGL': 'Real', 'AudioContext': 'Real', 'CPU Cores': '4', 'Memory (GB)': '8',
    'Do Not Track': 'Open', 'Timezone Mode': 'Manual', 'Timezone': 'Europe/Berlin', 'Locale Mode': 'Manual', 'Locale': 'de-DE,de;q=0.9',
    'Geolocation Mode': 'Custom', 'Latitude': '52.52', 'Longitude': '13.405',
    'Account Username': 'user02', 'Account Password': 'pass02', '2FA Key': 'JBSWY3DPEHPK3PXP'
  },
  {
    'Profile Title': 'Testing_03', 'Group Name': 'Testing', 'Notes': 'No proxy (direct)',
    'Operating System': 'Windows', 'Browser Core': 'Chrome', 'Proxy Method': 'Direct',
    'Do Not Track': 'Close'
  }
].map((row) => Object.freeze(row)));

// CSV text (no BOM; the page adds one so Excel reads it as UTF-8).
export function templateCsv(headers = TEMPLATE_HEADERS, rows = TEMPLATE_ROWS) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows.map((o) => headers.map((h) => o[h] ?? ''))]
    .map((row) => row.map(esc).join(',')).join('\r\n');
}
