'use strict';
// The "Recommended proxy deals" card on Free (1.0.27). The list comes only from our own licensing server
// (GET /v1/partner-deals); the app runs no third-party code, opens a deal in the system browser and the server
// counts the click (no personal data). Pure, so node:test covers it.

const DISCLOSURE = 'Partner offer. SoftGlaze may earn a commission.';
const MAX_DEALS = 6;

const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

function httpsUrl(v) {
  if (typeof v !== 'string' || v.length > 500) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : null;
  } catch (_) { return null; }
}

// The server answer ({ deals: [...] } or an array) -> clean deals; anything without a title or an https link is
// dropped.
function normalizeDeals(raw) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.deals) ? raw.deals : []);
  const out = [];
  const seen = new Set();
  for (const d of list) {
    if (!d || typeof d !== 'object') continue;
    const id = text(String(d.id == null ? '' : d.id), 64);
    const title = text(d.title, 120);
    const url = httpsUrl(d.url);
    if (!id || !title || !url || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title,
      vendor: text(d.vendor, 80),
      description: text(d.description, 300),
      url,
      code: text(d.code, 60) || null,
      badge: text(d.badge, 40) || null,
      logoUrl: httpsUrl(d.logoUrl)
    });
    if (out.length >= MAX_DEALS) break;
  }
  return out;
}

// Up to `count` deals, rotating day by day (the seed is the local day), so the card does not always lead with
// the same partner.
function pickDeals(deals, { count = 3, seed = '' } = {}) {
  const list = Array.isArray(deals) ? deals : [];
  if (list.length <= count) return list.slice();
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const start = h % list.length;
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(list[(start + i) % list.length]);
  return out;
}

module.exports = { DISCLOSURE, MAX_DEALS, normalizeDeals, pickDeals, httpsUrl };
