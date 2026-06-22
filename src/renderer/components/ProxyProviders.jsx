import { useEffect, useMemo, useState } from 'react';
import {
  Boxes, ExternalLink, KeyRound, Loader2, Check, Activity, RefreshCw, ShieldCheck, Zap, X
} from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';

// ---------------------------------------------------------------------------
// Softglaze Provider Core — integrated proxy-vendor marketplace.
//
// A static catalog of partner vendors. `referral` links out through our platform
// (replace the ?ref=softglaze placeholder with each partner's real affiliate URL
// when the programs are live). `tokenSync` providers hide the host form and show
// a secure "Proxy Token" + Sync mechanic; the rest show the rotating-engine form.
// lucide ships no brand logos, so each card uses a branded initials tile.
// ---------------------------------------------------------------------------
export const PROVIDERS = [
  { key: 'ipfoxy', name: 'IPFoxy', initials: 'IF', color: '#f97316', tokenSync: true, referral: 'https://www.ipfoxy.com/?ref=softglaze', gateway: { host: 'gate.ipfoxy.io', port: 6200, type: 'HTTP' } },
  { key: 'brightdata', name: 'Bright Data', initials: 'BD', color: '#00b4d8', bdpm: true, apiSync: true, referral: 'https://brightdata.com/?ref=softglaze', gateway: { host: 'brd.superproxy.io', port: 22225, type: 'HTTP' } },
  { key: 'oxylabs', name: 'Oxylabs', initials: 'OX', color: '#7c5cff', apiSync: true, referral: 'https://oxylabs.io/?ref=softglaze', gateway: { host: 'pr.oxylabs.io', port: 7777, type: 'HTTP' } },
  { key: 'smartproxy', name: 'Smartproxy', initials: 'SP', color: '#ff6b35', apiSync: true, referral: 'https://smartproxy.com/?ref=softglaze', gateway: { host: 'gate.smartproxy.com', port: 7000, type: 'HTTP' } },
  { key: 'lumiproxy', name: 'LumiProxy', initials: 'LP', color: '#22c55e', tokenSync: true, referral: 'https://www.lumiproxy.com/?ref=softglaze', gateway: { host: 'gate.lumiproxy.com', port: 8000, type: 'HTTP' } },
  { key: 'proxy302', name: 'Proxy302', initials: '302', color: '#3b82f6', tokenSync: true, referral: 'https://www.proxy302.com/?ref=softglaze', gateway: { host: 'gate.proxy302.com', port: 2000, type: 'HTTP' } },
  { key: 'mangoproxy', name: 'MangoProxy', initials: 'MP', color: '#f59e0b', tokenSync: true, referral: 'https://www.mangoproxy.com/?ref=softglaze', gateway: { host: 'gate.mangoproxy.com', port: 8000, type: 'HTTP' } },
  { key: 'kookeey', name: 'kookeey', initials: 'KK', color: '#ec4899', tokenSync: true, referral: 'https://www.kookeey.com/?ref=softglaze', gateway: { host: 'gate.kookeey.com', port: 1000, type: 'HTTP' } },
  { key: 'luna', name: 'Luna Proxy', initials: 'LN', color: '#8b5cf6', tokenSync: true, referral: 'https://www.lunaproxy.com/?ref=softglaze', gateway: { host: 'gate.lunaproxy.com', port: 12233, type: 'HTTP' } },
  { key: 'ipburger', name: 'IP Burger', initials: 'IB', color: '#ef4444', referral: 'https://www.ipburger.com/?ref=softglaze', gateway: { host: 'gate.ipburger.com', port: 8080, type: 'HTTP' } },
  { key: 'tisocks', name: 'TiSocks', initials: 'TS', color: '#14b8a6', referral: 'https://tisocks.net/?ref=softglaze', gateway: { host: 'gate.tisocks.net', port: 1080, type: 'SOCKS5' } },
  { key: 'shopsocks5', name: 'ShopSocks5', initials: 'SS', color: '#6366f1', referral: 'https://shopsocks5.com/?ref=softglaze', gateway: { host: 'gate.shopsocks5.com', port: 1080, type: 'SOCKS5' } }
];

export default function ProxyProviders({ onSynced }) {
  const [selectedKey, setSelectedKey] = useState(PROVIDERS[0].key);
  const provider = useMemo(() => PROVIDERS.find((p) => p.key === selectedKey) || PROVIDERS[0], [selectedKey]);

  // Affiliate-link overrides set by the Owner/Super Admin in Settings → Monetization.
  // The marketplace "Purchase" / "Visit dashboard" button uses the configured link
  // when present, otherwise the built-in default below.
  const [affiliateLinks, setAffiliateLinks] = useState({});
  const referral = affiliateLinks[provider.key] || provider.referral;

  const [form, setForm] = useState({ host: '', port: '', username: '', password: '', token: '', bdpm: false, apiToken: '', zone: '' });
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [err, setErr] = useState('');

  // Pull the Owner-configured affiliate links once (best-effort; falls back to
  // built-in referral URLs if unavailable).
  useEffect(() => {
    softglazeApi.monetization.getLinks()
      .then((r) => setAffiliateLinks(r && r.links ? r.links : {}))
      .catch(() => {});
  }, []);

  // Re-prime the workspace whenever the active provider changes.
  useEffect(() => {
    setForm({ host: provider.gateway.host, port: String(provider.gateway.port), username: '', password: '', token: '', bdpm: false, apiToken: '', zone: '' });
    setCheckResult(null);
    setSyncResult(null);
    setErr('');
  }, [provider]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function handleCheck() {
    setErr(''); setCheckResult(null); setChecking(true);
    try {
      const r = await softglazeApi.proxies.check({
        type: provider.gateway.type, host: form.host, port: form.port, username: form.username, password: form.password
      });
      setCheckResult(r);
    } catch (e) { setErr(e.message || 'Could not check the proxy.'); }
    finally { setChecking(false); }
  }

  async function handleSync() {
    setErr(''); setSyncResult(null);
    if (!form.token.trim()) { setErr('Enter your provider token to sync.'); return; }
    setSyncing(true);
    try {
      const r = await softglazeApi.proxies.syncVendorPool({ provider: provider.key, token: form.token.trim(), bdpm: form.bdpm });
      setSyncResult(r);
      if (typeof onSynced === 'function') onSynced();
    } catch (e) { setErr(e.message || 'Could not sync proxies.'); }
    finally { setSyncing(false); }
  }

  // Live API sync for wired vendors (Bright Data / Oxylabs / Smartproxy). Bright
  // Data needs its API token (+ zone); Oxylabs/Smartproxy verify the username &
  // password from the rotating form against the vendor gateway.
  async function handleApiSync() {
    setErr(''); setSyncResult(null);
    if (provider.key === 'brightdata' && !form.apiToken.trim()) { setErr('Enter your Bright Data API token.'); return; }
    if (provider.key !== 'brightdata' && !form.username.trim()) { setErr('Enter the proxy username above first.'); return; }
    setSyncing(true);
    try {
      const r = await softglazeApi.proxies.syncVendorPool({
        provider: provider.key,
        token: form.apiToken.trim(),
        username: form.username.trim(),
        password: form.password,
        zone: form.zone.trim(),
        bdpm: form.bdpm
      });
      setSyncResult(r);
      if (typeof onSynced === 'function') onSynced();
    } catch (e) { setErr(e.message || 'Live sync failed.'); }
    finally { setSyncing(false); }
  }

  const inputCls = 'w-full h-10 bg-background border border-border rounded px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary transition';

  return (
    <Card className="bg-surface border-border flex flex-1 min-h-0 rounded shadow-xl overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] flex-1 min-h-0">
        {/* LEFT — provider grid */}
        <div className="border-b lg:border-b-0 lg:border-r border-border bg-card/40 flex flex-col min-h-0">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
            <Boxes className="w-4 h-4 text-primary" />
            <span className="text-[13px] font-semibold text-foreground">Proxy Providers</span>
            <span className="ml-auto text-[10.5px] text-muted-foreground">{PROVIDERS.length} integrated</span>
          </div>
          <div className="overflow-y-auto p-2 grid grid-cols-2 lg:grid-cols-1 gap-1.5">
            {PROVIDERS.map((p) => {
              const active = p.key === selectedKey;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setSelectedKey(p.key)}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors border ${active ? 'bg-primary/10 border-primary/30' : 'border-transparent hover:bg-card'}`}
                >
                  <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${p.color} 16%, transparent)`, color: p.color, border: `1px solid color-mix(in srgb, ${p.color} 28%, transparent)` }}>
                    <ProviderLogo k={p.key} className="w-5 h-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[12.5px] font-medium truncate ${active ? 'text-foreground' : 'text-muted-foreground'}`}>{p.name}</span>
                    <span className="block text-[10px] text-muted-foreground/70">{p.tokenSync ? 'Token sync' : 'Rotating gateway'}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* RIGHT — dynamic configuration workspace */}
        <div className="overflow-y-auto p-5 min-h-0">
          {/* Promo banner */}
          <div className="rounded-xl p-5 mb-5 relative overflow-hidden" style={{ background: `linear-gradient(120deg, color-mix(in srgb, ${provider.color} 22%, var(--card)), var(--card))`, border: `1px solid color-mix(in srgb, ${provider.color} 30%, transparent)` }}>
            <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full opacity-20" style={{ background: provider.color, filter: 'blur(36px)' }} />
            <div className="relative z-10 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="w-12 h-12 rounded-xl grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${provider.color} 20%, transparent)`, color: provider.color, border: `1px solid color-mix(in srgb, ${provider.color} 34%, transparent)` }}>
                  <ProviderLogo k={provider.key} className="w-7 h-7" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-foreground font-display">{provider.name}</h3>
                  <p className="text-[12px] text-muted-foreground">Premium proxies, synced straight into Softglaze Provider Core.</p>
                </div>
              </div>
              <a
                href={referral}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 h-10 rounded-lg text-[13px] font-semibold text-white shadow-lg shrink-0"
                style={{ background: provider.color, boxShadow: `0 10px 30px -10px ${provider.color}` }}
              >
                <Zap className="w-4 h-4" />
                {provider.tokenSync ? `Purchase at ${provider.name}` : `Visit ${provider.name} Dashboard`}
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {err && <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 flex items-start gap-2"><X className="w-4 h-4 mt-0.5 shrink-0" />{err}</div>}

          {provider.tokenSync ? (
            /* ---- Token Sync mechanic ---- */
            <div className="space-y-4 max-w-2xl">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><KeyRound className="w-3.5 h-3.5 text-violet-400" /> Proxy Token</label>
                  <span className={`text-[11px] font-mono ${form.token.length > 50 ? 'text-red-400' : 'text-muted-foreground'}`}>{form.token.length} / 50</span>
                </div>
                <input
                  type="password"
                  value={form.token}
                  maxLength={50}
                  autoComplete="off"
                  onChange={(e) => set('token', e.target.value)}
                  placeholder={`Paste your ${provider.name} account token`}
                  className={inputCls + ' font-mono'}
                />
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleSync} disabled={syncing} className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 disabled:opacity-60 shadow-lg shadow-emerald-500/25">
                  {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Sync proxy
                </button>
              </div>
              <p className="text-[12px] text-muted-foreground leading-relaxed bg-card border border-border rounded-lg px-3.5 py-3">
                Entering the provider partner token will automatically synchronize your purchased proxies into Softglaze. You can view or update synchronized items globally by clicking <span className="text-foreground font-medium">Sync proxy</span>.
              </p>
            </div>
          ) : (
            /* ---- Rotating engine configuration form ---- */
            <div className="space-y-4 max-w-2xl">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-4">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Host : Port (rotating gateway)</label>
                  <input value={form.host} onChange={(e) => set('host', e.target.value)} className={inputCls + ' font-mono'} placeholder="gateway host" />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Port</label>
                  <input value={form.port} onChange={(e) => set('port', e.target.value)} className={inputCls + ' font-mono'} placeholder="port" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Proxy Username</label>
                  <input value={form.username} onChange={(e) => set('username', e.target.value)} className={inputCls + ' font-mono'} placeholder="username" autoComplete="off" />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Proxy Password</label>
                  <input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} className={inputCls + ' font-mono'} placeholder="password" autoComplete="off" />
                </div>
              </div>

              {/* Bright Data BDPM specialized toggle */}
              {provider.bdpm && (
                <label className="flex items-start gap-2.5 text-[12.5px] text-muted-foreground cursor-pointer bg-card border border-border rounded-lg px-3.5 py-3">
                  <input type="checkbox" checked={form.bdpm} onChange={(e) => set('bdpm', e.target.checked)} className="accent-primary mt-0.5" />
                  <span><span className="text-foreground font-medium">BDPM-Session:</span> Select only when utilizing a Bright Data BDPM proxy configuration path.</span>
                </label>
              )}

              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={handleCheck} disabled={checking} className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-[13px] font-semibold bg-secondary hover:bg-secondary/70 text-foreground border border-border disabled:opacity-60">
                  {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />} Check Proxy
                </button>
                {checkResult && (
                  checkResult.success ? (
                    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-emerald-400"><ShieldCheck className="w-4 h-4" /> {checkResult.ip || 'OK'}{checkResult.country ? ` · ${checkResult.country}` : ''}{typeof checkResult.latencyMs === 'number' ? ` · ${checkResult.latencyMs}ms` : ''}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-red-400" title={checkResult.error}><X className="w-4 h-4" /> {String(checkResult.error || 'Failed').slice(0, 60)}</span>
                  )
                )}
              </div>
              <p className="text-[11.5px] text-muted-foreground italic">Tip: a rotating gateway uses the same host:port for every session — your username/password (or sticky-session token) selects the exit IP.</p>

              {/* Live API sync for wired vendors */}
              {provider.apiSync && (
                <div className="mt-1 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">Live</span>
                    <span className="text-[13px] font-semibold text-foreground">API Sync</span>
                  </div>
                  {provider.key === 'brightdata' ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">API Token</label>
                          <input type="password" value={form.apiToken} onChange={(e) => set('apiToken', e.target.value)} className={inputCls + ' font-mono'} placeholder="Bright Data API token" autoComplete="off" />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Zone <span className="normal-case text-muted-foreground/60">(optional)</span></label>
                          <input value={form.zone} onChange={(e) => set('zone', e.target.value)} className={inputCls + ' font-mono'} placeholder="auto-detected from username" />
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground">Pulls the zone's routable IPs via Bright Data's API and pins each to the super-proxy gateway using the username &amp; password above.</p>
                    </div>
                  ) : (
                    <p className="text-[11.5px] text-muted-foreground">Verifies the <span className="text-foreground font-medium">username &amp; password</span> above against the {provider.name} gateway with a live request, then adds the working endpoint.</p>
                  )}
                  <button onClick={handleApiSync} disabled={syncing} className="mt-3 inline-flex items-center gap-2 h-10 px-5 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 disabled:opacity-60 shadow-lg shadow-emerald-500/25">
                    {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Sync via API
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Sync result */}
          {syncResult && (
            <div className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 max-w-2xl">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-emerald-400 mb-1.5"><Check className="w-4 h-4" /> {syncResult.provider} synced into Softglaze Provider Core</div>
              <div className="grid grid-cols-3 gap-3 text-[12px] font-mono text-muted-foreground">
                <div>Returned: {syncResult.total}</div>
                <div className="text-emerald-400">Added: {syncResult.created?.length ?? 0}</div>
                <div className="text-amber-400">Existing: {syncResult.skipped?.length ?? 0}</div>
              </div>
              {syncResult.simulated && <p className="mt-2 text-[11px] text-amber-400/90">Simulation: these entries demonstrate the sync pipeline. Live vendor-API wiring drops in behind the same flow.</p>}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// Local lightweight Card wrapper to avoid an extra import cycle; mirrors the
// page's card surface.
function Card({ className = '', children }) {
  return <div className={className}>{children}</div>;
}

// Distinctive, ORIGINAL stylized marks per provider (not the vendors' actual
// trademarked logos). They inherit the tile's brand color via `currentColor`, so
// dropping in a real brand SVG later is a one-spot swap per provider.
export function ProviderLogo({ k, className = 'w-6 h-6' }) {
  const line = { className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const solid = { className, viewBox: '0 0 24 24', fill: 'currentColor', stroke: 'none' };
  switch (k) {
    case 'brightdata': // globe + meridian orbit
      return (<svg {...line}><circle cx="12" cy="12" r="7.5" /><path d="M4.5 12h15" /><path d="M12 4.5c2.6 2.2 2.6 12.8 0 15M12 4.5c-2.6 2.2-2.6 12.8 0 15" /></svg>);
    case 'oxylabs': // ring + node
      return (<svg {...line}><circle cx="12" cy="12" r="7" /><circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none" /></svg>);
    case 'smartproxy': // shield check
      return (<svg {...line}><path d="M12 3l7 2.5V11c0 4.2-2.9 7.3-7 8.5C7.9 18.3 5 15.2 5 11V5.5z" /><path d="M9 12l2 2 4-4" /></svg>);
    case 'ipfoxy': // fox head
      return (<svg {...line}><path d="M5 4l3.6 3M19 4l-3.6 3" /><path d="M6 7l6 12 6-12-6 2.4z" /><path d="M10.6 12.4h2.8" /></svg>);
    case 'lumiproxy': // sun / lumen
      return (<svg {...line}><circle cx="12" cy="12" r="4" /><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.4 5.4l1.8 1.8M16.8 16.8l1.8 1.8M18.6 5.4l-1.8 1.8M7.2 16.8l-1.8 1.8" /></svg>);
    case 'proxy302': // bolt
      return (<svg {...solid}><path d="M13 2L5 13h5l-1 9 8-12h-5z" /></svg>);
    case 'mangoproxy': // mango + leaf
      return (<svg {...line}><path d="M12 3.5c5 2 6.8 6.5 5.3 11C16 18.7 12 21 8.2 19.4 4.7 17.9 4.2 12.6 6.6 8.7 8 6.2 10 4.4 12 3.5z" /><path d="M12 4.5c1 2.4 1 4.8 0 7.2" /></svg>);
    case 'kookeey': // key
      return (<svg {...line}><circle cx="8.5" cy="8.5" r="4" /><path d="M11.3 11.3L20 20M16.5 16.5l2-2" /></svg>);
    case 'luna': // crescent
      return (<svg {...solid}><path d="M20 13.6A8 8 0 1 1 10.4 4a6.5 6.5 0 0 0 9.6 9.6z" /></svg>);
    case 'ipburger': // burger
      return (<svg {...line}><path d="M4 9c1-3.2 4.2-5 8-5s7 1.8 8 5" /><path d="M4 12.5h16" /><path d="M5 16h14a2.2 2.2 0 0 1-2.2 2.2H7.2A2.2 2.2 0 0 1 5 16z" /></svg>);
    case 'tisocks': // sock
      return (<svg {...line}><path d="M10 3v8l-3.2 3.2a3.6 3.6 0 0 0 5.1 5.1l4.1-4.1-3-3V3z" /><path d="M10 3h5" /></svg>);
    case 'shopsocks5': // shopping bag
      return (<svg {...line}><path d="M6.5 8h11l-1 11.5H7.5z" /><path d="M9 8a3 3 0 0 1 6 0" /></svg>);
    default:
      return (<svg {...line}><circle cx="12" cy="12" r="7" /></svg>);
  }
}
