import React from 'react';

// The footer main seeds (ipcHandlers globalSettings.branding.footerText). While a workspace keeps it,
// the window shows it in its own language (common shell.footerDefault); a footer the Super Admin
// wrote is shown as written.
export const DEFAULT_FOOTER_TEXT = '© {year} SoftGlaze - Built by the [SoftGlaze Team](https://softglaze.com) · Developed by [Azhar Ali](https://azhar.softglaze.com)';
// Earlier defaults main seeded (June to September 2026). setGlobalSettings stores the defaults with any
// saved setting, so a workspace from then may still hold one; it is the default footer too.
export const LEGACY_DEFAULT_FOOTER_TEXTS = Object.freeze([
  '© {year} SoftGlaze \u2014 Built by the SoftGlaze Team (https://softglaze.com) · Developed by Azhar Ali (https://azhar.softglaze.com)',
  '© {year} SoftGlaze \u2014 Built by the [SoftGlaze Team](https://softglaze.com) · Developed by [Azhar Ali](https://azhar.softglaze.com)'
]);
export function footerTextFor(text, t) {
  const isDefault = text === DEFAULT_FOOTER_TEXT || LEGACY_DEFAULT_FOOTER_TEXTS.includes(text);
  return isDefault ? t('shell.footerDefault', { defaultValue: DEFAULT_FOOTER_TEXT }) : text;
}

// Renders {year}, [label](https://) as a label-only link, and bare https URLs without the scheme.
// Shared by FooterBar and the Settings preview so both always match.
export function renderFooterNodes(text, linkClass = 'text-primary hover:underline') {
  const resolved = String(text || '').replace(/\{year\}/g, String(new Date().getFullYear()));
  const nodes = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+)/g;
  let last = 0; let m; let key = 0;
  while ((m = re.exec(resolved)) !== null) {
    if (m.index > last) nodes.push(<span key={key++}>{resolved.slice(last, m.index)}</span>);
    if (m[1] && m[2]) {
      nodes.push(<a key={key++} href={m[2]} target="_blank" rel="noreferrer" className={linkClass}>{m[1]}</a>);
    } else {
      const url = m[3];
      nodes.push(<a key={key++} href={url} target="_blank" rel="noreferrer" className={linkClass}>{url.replace(/^https?:\/\//, '')}</a>);
    }
    last = re.lastIndex;
  }
  if (last < resolved.length) nodes.push(<span key={key++}>{resolved.slice(last)}</span>);
  return nodes;
}
