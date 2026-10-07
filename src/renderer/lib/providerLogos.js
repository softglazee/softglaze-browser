// providerLogos.js
// ---------------------------------------------------------------------------
// A build-time map of proxy-provider `key` -> bundled logo asset URL.
//
// The real brand logos live in src/renderer/assets/providers/<key>.<ext>
// (png / svg / ico / webp), fetched from each vendor's own site. They are
// bundled by Vite via import.meta.glob, so every logo is hashed, copied into
// the build output, and referenced by a relative URL that works under the
// Electron file:// origin. No network access at runtime.
//
// If a provider has no asset file, its key simply won't appear in the map and
// <ProviderLogo> falls back to a monogram tile. Dropping a new <key>.png into
// the providers folder is all it takes to add a logo - no code change here.
// ---------------------------------------------------------------------------

// Eager, URL-only glob. `query: '?url' + import: 'default'` is the current
// Vite 5+/8 form (the old `as: 'url'` was removed).
const modules = import.meta.glob(
  '../assets/providers/*.{png,svg,ico,webp,jpg,jpeg}',
  { eager: true, query: '?url', import: 'default' }
);

/** @type {Record<string, string>} key -> bundled asset URL */
export const PROVIDER_LOGOS = {};

for (const [filePath, url] of Object.entries(modules)) {
  // '../assets/providers/proxmint.png' -> 'proxmint'
  const file = filePath.split('/').pop() || '';
  const key = file.replace(/\.[^.]+$/, '');
  if (key) PROVIDER_LOGOS[key] = url;
}

/**
 * True when a bundled logo asset exists for this provider key.
 * @param {string} key
 * @returns {boolean}
 */
export function hasLogo(key) {
  return !!key && Object.prototype.hasOwnProperty.call(PROVIDER_LOGOS, key);
}

/**
 * The bundled asset URL for a provider key, or undefined if none exists.
 * @param {string} key
 * @returns {string | undefined}
 */
export function getLogo(key) {
  return key ? PROVIDER_LOGOS[key] : undefined;
}

export default PROVIDER_LOGOS;
