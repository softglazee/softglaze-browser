// The profile editor stores its choices as English values ("Forward", "Based on IP"...): they are what
// main and saved profiles read, so they never change. This maps each value to its label key in the
// profiles namespace (opt.*), used by the editor's choice buttons and the environment summary.
// English labels equal the values, so the English editor looks exactly as before.
export const OPTION_LABEL_KEYS = Object.freeze({
  Forward: 'opt.forward',
  Replace: 'opt.replace',
  Real: 'opt.real',
  Disabled: 'opt.disabled',
  'Based on IP': 'opt.basedOnIp',
  Custom: 'opt.custom',
  Block: 'opt.block',
  'Based on Language': 'opt.basedOnLanguage',
  Random: 'opt.random',
  Predefined: 'opt.predefined',
  Default: 'opt.default',
  Auto: 'opt.auto',
  Edit: 'opt.edit',
  'Based on WebGL': 'opt.basedOnWebgl',
  Open: 'opt.open',
  Close: 'opt.close',
  Enable: 'opt.enable',
  Global: 'opt.global',
  Customize: 'opt.customize'
});

// t: the profiles namespace's t. Values without a label (a typed timezone, a version number) pass through.
export function optionLabel(t, value) {
  const key = OPTION_LABEL_KEYS[value];
  return key ? t(key, { defaultValue: value }) : value;
}

// "All Windows", "All macOS"...: the first entry of each OS's version list.
export function osVersionLabel(t, os, version) {
  return /^All /.test(String(version || '')) ? t('opt.allVersions', { os, defaultValue: String(version) }) : version;
}
