import { useCallback, useEffect, useState } from 'react';
import { Network, Loader2, Check, ExternalLink, ChevronDown, KeyRound, ShieldCheck } from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';

// Brand accent + initials per provider (lucide has no brand glyphs).
const BRAND = {
  'Bright Data': { color: '#00b4d8', initials: 'BD' },
  Oxylabs: { color: '#7c5cff', initials: 'OX' },
  Smartproxy: { color: '#ff6b35', initials: 'SP' },
  IPRoyal: { color: '#22c55e', initials: 'IPR' },
  Webshare: { color: '#3b82f6', initials: 'WS' },
  Asocks: { color: '#f59e0b', initials: 'AS' }
};
const brandOf = (name) => BRAND[name] || { color: '#64748b', initials: (name || '?').slice(0, 2).toUpperCase() };

export default function IpProvidersSettings() {
  const [me, setMe] = useState(undefined); // undefined = loading
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await softglazeApi.ipProviders.getAll();
      setProviders(Array.isArray(res?.providers) ? res.providers : []);
    } catch (e) {
      setErr(e.message || 'Could not load IP providers.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    softglazeApi.members.current().then((m) => setMe(m || null)).catch(() => setMe(null));
  }, []);
  useEffect(() => { if (me?.role === 'SUPER_ADMIN') load(); }, [me, load]);

  // Super Admin only — invisible to owners and everyone else.
  if (me === undefined) return null;
  if (me?.role !== 'SUPER_ADMIN') return null;

  const enabledCount = providers.filter((p) => p.status === 'ENABLED').length;

  function patchProvider(updated) {
    setProviders((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
  }

  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-lg grid place-items-center shrink-0" style={{ background: 'color-mix(in srgb, #6366f1 14%, transparent)', border: '1px solid color-mix(in srgb, #6366f1 24%, transparent)' }}>
            <Network className="w-5 h-5 text-indigo-400" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              IP Provider Settings
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20"><ShieldCheck className="w-3 h-3" /> Super Admin</span>
            </h3>
            <p className="text-xs text-muted-foreground">Master API credentials for the proxy vendors you resell.</p>
          </div>
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0">{enabledCount}/{providers.length} enabled</span>
      </div>

      {err && <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">{err}</div>}

      {loading ? (
        <div className="grid place-items-center py-10"><Loader2 className="w-5 h-5 text-muted animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4">
          {providers.map((p) => <ProviderCard key={p.id} provider={p} onChange={patchProvider} onError={setErr} />)}
        </div>
      )}
    </div>
  );
}

function ProviderCard({ provider, onChange, onError }) {
  const brand = brandOf(provider.name);
  const [expanded, setExpanded] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  const enabled = provider.status === 'ENABLED';

  async function toggle() {
    onError('');
    setBusy('toggle');
    try {
      const updated = await softglazeApi.ipProviders.toggleStatus({ id: provider.id, status: enabled ? 'DISABLED' : 'ENABLED' });
      onChange(updated);
    } catch (e) { onError(e.message || 'Could not update status.'); }
    finally { setBusy(''); }
  }

  async function save() {
    onError(''); setMsg('');
    setBusy('save');
    try {
      const payload = { id: provider.id };
      if (apiKey) payload.apiKey = apiKey;
      if (secretKey) payload.secretKey = secretKey;
      const updated = await softglazeApi.ipProviders.updateCredentials(payload);
      onChange(updated);
      setApiKey(''); setSecretKey('');
      setMsg('Saved.');
      setTimeout(() => setMsg(''), 1500);
    } catch (e) { onError(e.message || 'Could not save credentials.'); }
    finally { setBusy(''); }
  }

  const inputCls = 'w-full h-9 bg-input-background border border-border rounded-lg px-3 text-[12.5px] font-mono text-foreground placeholder:text-muted-foreground outline-none focus:border-primary';

  return (
    <div className="rounded-xl border border-border bg-elevated/60 overflow-hidden">
      <div className="flex items-center gap-3 p-3.5">
        <span className="w-9 h-9 rounded-lg grid place-items-center text-[11px] font-bold shrink-0" style={{ background: `color-mix(in srgb, ${brand.color} 16%, transparent)`, color: brand.color, border: `1px solid color-mix(in srgb, ${brand.color} 28%, transparent)` }}>
          {brand.initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-foreground truncate">{provider.name}</span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold" style={enabled ? { background: 'color-mix(in srgb, #22c55e 14%, transparent)', color: '#22c55e' } : { background: 'var(--secondary)', color: 'var(--muted-foreground)' }}>
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <span className="text-[10.5px] text-muted-foreground">
            {provider.hasApiKey ? `Key: ${provider.apiKeyMasked}` : 'No API key set'}
          </span>
        </div>

        {/* Status toggle switch */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={busy === 'toggle'}
          onClick={toggle}
          className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 disabled:opacity-60"
          style={{ background: enabled ? '#22c55e' : 'var(--switch-background, #3f3f46)' }}
          title={enabled ? 'Disable' : 'Enable'}
        >
          <span className={`inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-1'}`} style={{ height: 18, width: 18 }} />
        </button>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-3.5 py-2 text-[11.5px] text-muted-foreground hover:text-foreground border-t border-border transition-colors"
      >
        <span className="flex items-center gap-1.5"><KeyRound className="w-3.5 h-3.5" /> Configure API credentials</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="px-3.5 pb-3.5 pt-1 space-y-2.5 border-t border-border">
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">API Key</label>
            <input type="password" autoComplete="off" className={inputCls} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={provider.hasApiKey ? `${provider.apiKeyMasked} (leave blank to keep)` : 'Paste API key'} />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">Secret Key <span className="text-muted-dark normal-case">(if required)</span></label>
            <input type="password" autoComplete="off" className={inputCls} value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder={provider.hasSecretKey ? `${provider.secretKeyMasked} (leave blank to keep)` : 'Paste secret key'} />
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            {provider.referralLink ? (
              <a href={provider.referralLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: brand.color }}>
                <ExternalLink className="w-3 h-3" /> {provider.name} dashboard
              </a>
            ) : <span />}
            <div className="flex items-center gap-2">
              {msg && <span className="text-[11px] text-emerald-400 flex items-center gap-1"><Check className="w-3.5 h-3.5" />{msg}</span>}
              <button onClick={save} disabled={busy === 'save' || (!apiKey && !secretKey)} className="h-8 px-4 rounded-lg text-[12px] font-semibold text-white bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 shadow shadow-blue-500/25 disabled:opacity-50 flex items-center gap-1.5">
                {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {!expanded && provider.referralLink && (
        <a href={provider.referralLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-3.5 pb-3 text-[11px] font-medium" style={{ color: brand.color }}>
          <ExternalLink className="w-3 h-3" /> Get API keys at {provider.name} dashboard
        </a>
      )}
    </div>
  );
}
