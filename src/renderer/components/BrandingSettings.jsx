import React, { useEffect, useState } from 'react';
import { Palette, ShieldCheck, Loader2, Check, MonitorSmartphone, Info, Wand2 } from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { renderFooterNodes } from '@/lib/footerText.jsx';
import Switch from '@/components/ui/Switch.jsx';

// Default mirrors GLOBAL_SETTINGS_DEFAULTS.branding.footerText in the main process.
// [label](url) renders as an anchor showing the label; {year} → current year.
const DEFAULT_FOOTER = '© {year} SoftGlaze — Built by the [SoftGlaze Team](https://softglaze.com) · Developed by [Azhar Ali](https://azhar.softglaze.com)';

function Card({ icon: Icon, accent = '#3b82f6', title, description, children }) {
  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${accent} 26%, transparent)` }}>
          <Icon className="w-4 h-4" style={{ color: accent }} />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

// Footer branding (Super Admin only) + per-device "stay signed in" control.
export default function BrandingSettings() {
  const [me, setMe] = useState(null);
  const [footer, setFooter] = useState(DEFAULT_FOOTER);
  const [footerEnabled, setFooterEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const [remember, setRemember] = useState({ enabled: false, available: true, kind: null });
  const [autofill, setAutofill] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [cur, cfg, rem] = await Promise.all([
          softglazeApi.members.current().catch(() => null),
          softglazeApi.settings.getGlobal().catch(() => null),
          (softglazeApi.auth && softglazeApi.auth.rememberStatus ? softglazeApi.auth.rememberStatus() : Promise.resolve(null)).catch(() => null)
        ]);
        if (!live) return;
        setMe(cur);
        const b = (cfg && cfg.branding) || {};
        setFooter(b.footerText != null ? b.footerText : DEFAULT_FOOTER);
        setFooterEnabled(b.footerEnabled !== false);
        setAutofill(!(cfg && cfg.smartAutofill && cfg.smartAutofill.enabled === false));
        if (rem) setRemember(rem);
      } catch (e) { /* ignore */ }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, []);

  const isSuper = me && me.role === 'SUPER_ADMIN';
  const canManageAutofill = me && (me.role === 'SUPER_ADMIN' || me.role === 'OWNER');

  async function toggleAutofill(next) {
    setAutofill(next);
    try { await softglazeApi.settings.setGlobal({ smartAutofill: { enabled: next } }); }
    catch (e) { setAutofill(!next); setErr(e.message || 'Could not update Smart Autofill.'); }
  }

  async function saveFooter(nextEnabled) {
    setSaving(true); setErr(''); setSaved(false);
    const enabled = typeof nextEnabled === 'boolean' ? nextEnabled : footerEnabled;
    try {
      await softglazeApi.settings.setGlobal({ branding: { footerText: footer, footerEnabled: enabled } });
      setFooterEnabled(enabled);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) { setErr(e.message || 'Could not save the footer.'); }
    finally { setSaving(false); }
  }

  async function forgetDevice() {
    try {
      const s = await softglazeApi.auth.forget();
      setRemember(s || { enabled: false, available: true, kind: null });
    } catch (e) { /* ignore */ }
  }

  if (loading) {
    return (
      <Card icon={Palette} title="Appearance & Branding" description="Footer and per-device sign-in.">
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {/* App footer — Super Admin editable */}
      <Card icon={Palette} accent="#8b5cf6" title="App footer" description="Shown at the bottom of every page. Use {year} for the current year; links open in your browser.">
        {isSuper ? (
          <div className="space-y-3">
            <textarea
              value={footer}
              onChange={(e) => setFooter(e.target.value)}
              rows={3}
              className="w-full bg-input-background border border-border rounded-lg px-3 py-2 text-[12.5px] text-foreground outline-none focus:border-primary resize-y"
              placeholder={DEFAULT_FOOTER}
            />
            <div className="rounded-lg bg-elevated border border-border px-3 py-2 text-[11.5px] text-muted-foreground">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 block mb-1">Preview</span>
              {footer && footer.trim() ? renderFooterNodes(footer) : <span className="opacity-60">— empty —</span>}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => saveFooter()} disabled={saving} className="h-9 px-4 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[12.5px] flex items-center gap-2 disabled:opacity-60">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save footer
              </button>
              <button onClick={() => saveFooter(!footerEnabled)} disabled={saving} className="h-9 px-3 rounded-lg border border-border text-foreground text-[12.5px] hover:bg-secondary">
                {footerEnabled ? 'Hide footer' : 'Show footer'}
              </button>
              <button onClick={() => setFooter(DEFAULT_FOOTER)} disabled={saving} className="h-9 px-3 rounded-lg border border-border text-muted-foreground text-[12.5px] hover:bg-secondary">
                Reset to default
              </button>
              {saved && <span className="text-[12px] text-emerald-400 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Saved · reopens on next page load</span>}
            </div>
            {err && <p className="text-[12px] text-red-400">{err}</p>}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="rounded-lg bg-elevated border border-border px-3 py-2 text-[12px] text-muted-foreground">{renderFooterNodes(footer)}</div>
            <p className="text-[11.5px] text-muted-foreground flex items-center gap-1.5"><Info className="w-3.5 h-3.5" /> Only the Super Admin can change the footer.</p>
          </div>
        )}
      </Card>

      {/* Stay signed in — per device */}
      <Card icon={ShieldCheck} accent="#10b981" title="Stay signed in on this device" description="Skip the password on every restart. The credential is encrypted to your Windows account (DPAPI).">
        {!remember.available ? (
          <p className="text-[12.5px] text-muted-foreground flex items-center gap-2"><Info className="w-4 h-4" /> OS encryption isn't available on this device, so auto sign-in can't be enabled here.</p>
        ) : remember.enabled ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[13px] text-emerald-400"><MonitorSmartphone className="w-4 h-4" /> Auto sign-in is <span className="font-semibold">ON</span> for this device.</div>
            <p className="text-[11.5px] text-muted-foreground">This device will open the workspace without asking for the password. Turn it off to require the password again on the next start.</p>
            <button onClick={forgetDevice} className="h-9 px-4 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 font-semibold text-[12.5px] hover:bg-red-500/20">
              Forget this device
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground"><MonitorSmartphone className="w-4 h-4" /> Auto sign-in is <span className="font-semibold">off</span>.</div>
            <p className="text-[11.5px] text-muted-foreground">Tick <span className="text-foreground">“Keep me signed in on this device”</span> on the sign-in screen to enable it. Signing out always turns it off.</p>
          </div>
        )}
      </Card>

      {/* Smart Autofill — workspace toggle (Owner / Super Admin) */}
      <Card icon={Wand2} accent="#6366f1" title="Smart Autofill" description="The in-page identity widget shown on signup forms in launched Chromium profiles.">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12.5px] text-muted-foreground">{autofill ? 'Enabled — the Data Vault widget is injected into launched profiles.' : 'Disabled — no autofill widget is injected.'}</span>
          <Switch checked={autofill} disabled={!canManageAutofill} onChange={toggleAutofill} label="Toggle Smart Autofill" />
        </div>
        {!canManageAutofill && <p className="mt-2 text-[11px] text-muted-foreground">Only the Owner or Super Admin can change this.</p>}
      </Card>
    </div>
  );
}
