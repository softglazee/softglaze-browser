// Provider key -> bundled logo URL. Logos live in src/renderer/assets/providers/<key>.<ext> and
// Vite bundles them (relative URLs work under file://; no runtime network). A key without a file
// falls back to a monogram tile; adding <key>.png is all a new logo needs.

// Eager URL-only glob in the Vite 5+ form (the old as: 'url' option is gone).
const modules = import.meta.glob(
  '../assets/providers/*.{png,svg,ico,webp,jpg,jpeg}',
  { eager: true, query: '?url', import: 'default' }
);

/** @type {Record<string, string>} key -> bundled asset URL */
const PROVIDER_LOGOS = {};

for (const [filePath, url] of Object.entries(modules)) {
  // '../assets/providers/proxmint.png' -> 'proxmint'
  const file = filePath.split('/').pop() || '';
  const key = file.replace(/\.[^.]+$/, '');
  if (key) PROVIDER_LOGOS[key] = url;
}

/**
 * The bundled asset URL for a provider key, or undefined if none exists.
 * @param {string} key
 * @returns {string | undefined}
 */
export function getLogo(key) {
  return key ? PROVIDER_LOGOS[key] : undefined;
}
