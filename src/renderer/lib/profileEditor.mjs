// Pure helpers for the profile editor (ProfilesPage.jsx), kept apart so they can be unit tested.

// Same limit and case-insensitive matching as assignTagToProfiles in main.
export const TAG_MAX_LENGTH = 40;

// The Tags box takes "vip, warm, vip ,," and main stores a JSON array, so the text is split on
// commas, trimmed, cut to 40 characters, and empties and duplicates (any case) are dropped; the
// first spelling wins. An array (a profile opened for editing) goes through the same cleanup.
export function parseTagInput(value) {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(',');
  const out = [];
  const seen = new Set();
  for (const part of parts) {
    const tag = String(part ?? '').trim().slice(0, TAG_MAX_LENGTH);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

// A saved profile's tag array as the text the Tags box shows.
export function tagsToInput(tags) {
  if (Array.isArray(tags)) return parseTagInput(tags).join(', ');
  return typeof tags === 'string' ? tags : '';
}

// What the Check network box may say about a proxies.check result. Main returns
// { success: false, error } for a dead proxy instead of throwing, so only success === true counts
// as working. Values the check did not return stay null (shown as unknown), never filled in.
export function proxyCheckView(result) {
  if (!result || typeof result !== 'object') return null;
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  if (result.success !== true) return { ok: false, error: text(result.error) };
  const ms = Number(result.latencyMs);
  return {
    ok: true,
    ip: text(result.ip),
    country: text(result.country),
    city: text(result.city),
    latencyMs: result.latencyMs != null && Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : null
  };
}

// The rotation pool the editor saves: the ticked proxies in the order the list shows them (the
// order round-robin follows), dropping ids that are no longer in the list.
export function rotationPoolIds(proxies, selectedIds) {
  const chosen = new Set((Array.isArray(selectedIds) ? selectedIds : []).map((id) => String(id)));
  return (Array.isArray(proxies) ? proxies : [])
    .filter((p) => p && p.id != null && chosen.has(String(p.id)))
    .map((p) => Number(p.id));
}

// Checks the editor's Cookie box before saving. The importer in main (profile:import-cookies)
// reads JSON (an array, or { cookies: [...] }) and Netscape cookies.txt; every cookie needs a name
// and a domain or URL. Returns { empty: true } for a blank box, { format, count } for text it can
// import, or { error } with a key under profiles:cookieErrors. Name=Value pairs carry no domain,
// so they are refused instead of being stored for a guessed site.
export function checkEditorCookies(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { empty: true };

  if (raw.startsWith('[') || raw.startsWith('{')) {
    let data;
    try { data = JSON.parse(raw); } catch (e) { return { error: 'jsonInvalid' }; }
    if (data && !Array.isArray(data) && Array.isArray(data.cookies)) data = data.cookies;
    if (!Array.isArray(data)) return { error: 'jsonShape' };
    const count = data.filter((c) => c && typeof c === 'object' && c.name && (c.domain || c.url)).length;
    return count ? { format: 'json', count } : { error: 'noDomain' };
  }

  let count = 0;
  for (let line of raw.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    if (line.startsWith('#HttpOnly_')) line = line.slice('#HttpOnly_'.length);
    else if (line.startsWith('#')) continue;
    let parts = line.split('\t');
    if (parts.length < 7) parts = line.split(/\s+/);
    if (parts.length >= 7 && parts[0] && parts[5]) count += 1;
  }
  if (count) return { format: 'netscape', count };

  const pairs = raw.split(/[;\r\n]+/).map((s) => s.trim()).filter(Boolean);
  if (pairs.length && pairs.every((s) => /^[^=\s]+=/.test(s))) return { error: 'nameValue' };
  return { error: 'unrecognised' };
}
