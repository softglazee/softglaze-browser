import { useEffect, useState } from 'react';
import { Coins, Link2, ShieldCheck, ExternalLink, Loader2, CheckCircle2, Save } from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';
import IpProvidersSettings from '@/components/IpProvidersSettings.jsx';
import { PROVIDERS, ProviderLogo } from '@/components/ProxyProviders.jsx';

// ---------------------------------------------------------------------------
// Monetization — a single Owner/Super-Admin home for the app's revenue wiring.
//   1. Affiliate & Referral Links — the partner URLs the marketplace "Purchase"
//      buttons (Proxy pool → Providers) link out to.
//   2. Reseller API credentials — the relocated IP-provider master keys (the
//      vendors the operator resells), which self-gate to the Super Admin.
// New monetization methods drop straight into this section.
// ---------------------------------------------------------------------------
export default function MonetizationSettings() {
  const [me, setMe] = useState(undefined); // undefined = loading

  // Owner / Super Admin only (single-user mode counts as the owner).
  const allowed = me !== undefined && (!me || me.role === 'OWNER' || me.role === 'SUPER_ADMIN');

  useEffect(() => {
    softglazeApi.members.current().then((m) => setMe(m || null)).catch(() => setMe(null));
  }, []);

  if (me === undefined) return null;
  if (!allowed) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Coins className="w-4 h-4 text-amber-400" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Monetization</h2>
      </div>

      <AffiliateLinksCard />

      {/* Relocated here from its standalone slot: reseller master API credentials
          (renders only for the Super Admin). */}
      <IpProvidersSettings />
    </div>
  );
}

// Per-provider affiliate URL editor. Persists a single { providerKey: url }
// override map; a blank field clears the override so the button uses the
// built-in Softglaze default.
function AffiliateLinksCard() {
  const [links, setLinks] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    softglazeApi.monetization.getLinks()
      .then((r) => setLinks(r && r.links ? { ...r.links } : {}))
      .catch((e) => setErr(e.message || 'Could not load affiliate links.'))
      .finally(() => setLoading(false));
  }, []);

  const setOne = (key, value) => setLinks((prev) => ({ ...prev, [key]: value }));

  async function save() {
    setSaving(true); setErr(''); setSavedMsg('');
    try {
      // Drop blanks so they fall back to the default; trim the rest.
      const payload = {};
      for (const [k, v] of Object.entries(links)) {
        const t = (v || '').trim();
        if (t) payload[k] = t;
      }
      const r = await softglazeApi.monetization.setLinks({ links: payload });
      setLinks(r && r.links ? { ...r.links } : {});
      setSavedMsg('Saved. Marketplace buttons now use your links.');
      setTimeout(() => setSavedMsg(''), 2500);
    } catch (e) {
      setErr(e.message || 'Could not save affiliate links.');
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'flex-1 min-w-0 h-9 bg-input-background border border-border rounded-lg px-3 text-[12.5px] font-mono text-foreground placeholder:text-muted-foreground outline-none focus:border-primary';

  return (
    <div className="rounded-xl bg-card border border-border p-5">
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <span className="w-10 h-10 rounded-lg grid place-items-center shrink-0 bg-amber-500/12 border border-amber-500/20">
          <Link2 className="w-5 h-5 text-amber-400" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            Affiliate &amp; Referral Links
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/12 text-violet-300 border border-violet-500/20">
              <ShieldCheck className="w-3 h-3" /> Owner only
            </span>
          </h3>
          <p className="text-xs text-muted-foreground">Your partner URLs for the Proxy marketplace &ldquo;Purchase&rdquo; buttons. Leave blank to use the Softglaze default.</p>
        </div>
      </div>

      {err && <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">{err}</div>}

      {loading ? (
        <div className="grid place-items-center py-10"><Loader2 className="w-5 h-5 text-muted-foreground animate-spin" /></div>
      ) : (
        <div className="mt-4 space-y-2">
          {PROVIDERS.map((p) => {
            const val = links[p.key] ?? '';
            const custom = (val || '').trim().length > 0;
            const effective = (val || '').trim() || p.referral;
            return (
              <div key={p.key} className="flex items-center gap-3 rounded-lg border border-border bg-elevated/50 px-3 py-2.5">
                <span
                  className="w-8 h-8 rounded-lg grid place-items-center shrink-0"
                  style={{ background: `color-mix(in srgb, ${p.color} 16%, transparent)`, color: p.color, border: `1px solid color-mix(in srgb, ${p.color} 28%, transparent)` }}
                >
                  <ProviderLogo k={p.key} className="w-5 h-5" />
                </span>
                <span className="w-28 shrink-0 min-w-0">
                  <span className="block text-[13px] font-medium text-foreground truncate">{p.name}</span>
                  <span className={`block text-[10px] ${custom ? 'text-emerald-400' : 'text-muted-foreground'}`}>{custom ? 'Custom link' : 'Default link'}</span>
                </span>
                <input
                  type="url"
                  value={val}
                  onChange={(e) => setOne(p.key, e.target.value)}
                  placeholder={p.referral}
                  autoComplete="off"
                  spellCheck={false}
                  className={inputCls}
                />
                <a
                  href={effective}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open ${p.name} link`}
                  className="shrink-0 w-9 h-9 grid place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-muted-dark transition"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            );
          })}
        </div>
      )}

      {!loading && (
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Save links'}
          </button>
          {savedMsg && <span className="text-[12px] text-emerald-400 inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> {savedMsg}</span>}
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
        These links power the &ldquo;Purchase at&hellip;&rdquo; / &ldquo;Visit dashboard&rdquo; buttons on the Proxy pool &rarr; Providers tab. They are public referral URLs only — proxy tokens and credentials are never affected.
      </p>
    </div>
  );
}
