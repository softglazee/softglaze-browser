'use strict';

// Registrable domain of a URL or host, so www., learn. and signup.example.com are one site (multi-step
// signups, Data Vault "already used here"). Cheap public-suffix rule: keep three labels under a short
// generic SLD in a ccTLD (example.co.uk) or a shared hosting parent (shop.myshopify.com).
const SHARED_HOSTING = new Set([
  'myshopify.com', 'github.io', 'gitlab.io', 'herokuapp.com', 'vercel.app', 'netlify.app',
  'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com', 'appspot.com', 'azurewebsites.net',
  'cloudfront.net', 'wordpress.com', 'blogspot.com', 'wixsite.com', 'webflow.io',
  'squarespace.com', 'tumblr.com', 'substack.com', 'onrender.com', 'fly.dev', 'glitch.me',
  'repl.co', 'ngrok.io', 'ngrok-free.app', 'framer.website', 'carrd.co'
]);

function hostOf(value) {
  let s = String(value == null ? '' : value).trim().toLowerCase();
  if (!s) return '';
  const hasScheme = /^[a-z][a-z0-9+.-]*:/.test(s);
  if (hasScheme && !/^https?:\/\//.test(s)) return ''; // file:, about:, chrome: ... have no site
  if (!hasScheme) s = 'http://' + s;
  try { return new URL(s).hostname; } catch (e) { return ''; }
}

function siteKeyOf(value) {
  const h = hostOf(value);
  if (!h) return '';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':') || h.startsWith('[')) return h; // IP literal
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  let keep = (tld.length === 2 && /^(co|com|net|org|gov|edu|ac|ne|or|go)$/.test(sld)) ? 3 : 2;
  if (SHARED_HOSTING.has(parts.slice(-keep).join('.'))) keep += 1;
  return parts.slice(-Math.min(keep, parts.length)).join('.');
}

module.exports = { siteKeyOf };
