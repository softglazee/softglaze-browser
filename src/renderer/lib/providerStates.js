import { useCallback, useEffect, useMemo, useState } from 'react';

import { PROVIDERS } from '@/components/ProxyProviders.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

// Per-provider state, built only from real data: the pool (each row is tagged with the provider
// it was pulled from), which providers have a saved key (no secret values are kept), and for the
// Super Admin, the test trials recorded in globalSettings.proxyProviderTrials.

const DAY = 86400000;

function kindOf(p) {
  if (p.unavailable) return 'unavailable';
  if (p.tokenSync) return 'tokenSync';
  if (p.geoSync) return 'geoPull';
  if (p.apiSync) return 'apiSync';
  return 'gateway';
}

// 'YYYY-MM-DD' -> local midnight Date (null when blank or malformed).
export function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
export function daysUntil(day) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((day.getTime() - today.getTime()) / DAY);
}
export function shortDate(day, lang) {
  try { return day.toLocaleDateString(lang, { day: 'numeric', month: 'short', year: day.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }); }
  catch (e) { return day.toDateString(); }
}

// Status colours come from the theme tokens. Text tinted toward the foreground keeps
// contrast in both light and dark (pure amber/red on white is too faint).
export const TONE = {
  success: 'var(--success)',
  trial: 'var(--chart-2)',
  warning: 'var(--warning)',
  danger: 'var(--destructive)',
  muted: 'var(--muted-foreground)'
};
export const toneText = (tone) => ({ color: `color-mix(in srgb, ${TONE[tone]} 70%, var(--foreground))` });

export function useProviderStates() {
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [proxies, setProxies] = useState([]);
  const [creds, setCreds] = useState({}); // key -> { found, hasKey } (no secret values kept)
  const [credsHidden, setCredsHidden] = useState(false);
  const [trials, setTrials] = useState({});
  const [me, setMe] = useState(undefined); // undefined until known

  useEffect(() => {
    let live = true;
    softglazeApi.members.current().then((m) => { if (live) setMe(m || null); }).catch(() => { if (live) setMe(null); });
    return () => { live = false; };
  }, []);

  // Trial tracking is our own vendor testing, so only the Super Admin ever sees it.
  // Customers buy their proxies; for them no provider is ever "on trial".
  const isSuper = Boolean(me && me.role === 'SUPER_ADMIN');
  const roleKnown = me !== undefined;

  const load = useCallback(async () => {
    setLoadErr('');
    try {
      const [list, cfg, credPairs] = await Promise.all([
        softglazeApi.proxies.list(),
        softglazeApi.settings.getGlobal().catch(() => null),
        Promise.all(PROVIDERS.map((p) => Promise.resolve()
          .then(() => softglazeApi.proxies.getProviderCreds(p.key))
          .then((c) => [p.key, c, null])
          .catch((e) => [p.key, null, e])))
      ]);
      setProxies(Array.isArray(list) ? list : []);
      const next = {};
      let denied = 0;
      for (const [key, c, e] of credPairs) {
        if (e) { denied += 1; continue; }
        next[key] = { found: Boolean(c && c.found), hasKey: Boolean(c && (c.token || c.apiToken || c.password || c.apiUrl)) };
      }
      setCreds(next);
      setCredsHidden(denied === PROVIDERS.length);
      const raw = cfg && cfg.proxyProviderTrials && typeof cfg.proxyProviderTrials === 'object' ? cfg.proxyProviderTrials : {};
      const tr = {};
      for (const [k, v] of Object.entries(raw)) if (v && typeof v === 'object') tr[k] = v;
      setTrials(tr);
    } catch (e) {
      setLoadErr(e && e.message ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const poolBy = useMemo(() => {
    const m = {};
    for (const px of proxies) {
      const k = px && px.provider ? String(px.provider).toLowerCase() : null;
      if (!k) continue;
      const s = m[k] || (m[k] = { total: 0, ok: 0, fail: 0, unchecked: 0, last: null, rows: [] });
      s.total += 1;
      if (px.lastStatus === 'ok') s.ok += 1; else if (px.lastStatus === 'fail') s.fail += 1; else s.unchecked += 1;
      const at = px.createdAt ? new Date(px.createdAt).getTime() : 0;
      if (at && (!s.last || at > s.last)) s.last = at;
      s.rows.push(px);
    }
    return m;
  }, [proxies]);

  const rows = useMemo(() => PROVIDERS.map((p) => {
    const pool = poolBy[p.key] || { total: 0, ok: 0, fail: 0, unchecked: 0, last: null, rows: [] };
    const c = creds[p.key];
    const keySaved = Boolean(c && c.found);
    const trial = (isSuper && trials[p.key]) || null;
    let state;
    if (p.unavailable) state = 'unavailable';
    else if (trial) state = 'trial';
    else if (pool.total > 0 && !keySaved && !credsHidden) state = 'needsKey';
    else if (keySaved || pool.total > 0) state = 'connected';
    else state = 'notSetUp';
    return { p, pool, keySaved, trial, state, kind: kindOf(p) };
  }), [poolBy, creds, trials, credsHidden, isSuper]);

  return { loading, setLoading, loadErr, proxies, credsHidden, load, rows, isSuper, roleKnown };
}
