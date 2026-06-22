import { useCallback, useEffect, useState } from 'react';
import {
  CreditCard, ShieldCheck, Loader2, Check, ExternalLink,
  AlertTriangle, Sparkles, Users, ArrowUpRight, X, Clock, Wallet
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { softglazeApi } from '@/lib/softglazeApi.js';

function statusTone(license) {
  if (!license) return { color: '#9ca3af', label: 'Loading…' };
  if (license.isExempt) return { color: '#10b981', label: 'Source owner' };
  switch (license.state) {
    case 'paid': return { color: '#10b981', label: license.endsAt ? `Active · until ${new Date(license.endsAt).toLocaleDateString()}` : 'Active' };
    case 'trialing': return { color: '#3b82f6', label: `Trial · ${license.daysLeftTrial}d left` };
    case 'grace': return { color: '#f59e0b', label: `Grace · ${license.daysLeftGrace}d left` };
    case 'banned': return { color: '#ef4444', label: 'Subscription ended' };
    default: return { color: license.isPaid ? '#10b981' : '#f59e0b', label: license.isPaid ? 'Active' : `Trial · ${license.daysLeft}d left` };
  }
}

export default function BillingSettings() {
  const [me, setMe] = useState(null);
  const [license, setLicense] = useState(null);
  const [seats, setSeats] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [cur, lic, seatUsage] = await Promise.all([
        softglazeApi.members.current().catch(() => null),
        softglazeApi.license.get().catch(() => null),
        softglazeApi.team.seatUsage().catch(() => null)
      ]);
      setMe(cur); setLicense(lic); setSeats(seatUsage);
    } catch (e) { /* ignore */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return null;
  const role = me?.role;
  // The Super Admin is the source owner — exempt from the trial/subscription
  // system, so they never see the Subscription card (only the gateway config).
  const showSubscription = role === 'OWNER' || !me;
  const showGateway = role === 'SUPER_ADMIN';
  if (!showSubscription && !showGateway) return null;

  return (
    <div className="space-y-4">
      {showSubscription && <SubscriptionCard license={license} seats={seats} />}
      {showGateway && <PaymentGatewayCard />}
      {showGateway && <ManualPaymentsCard />}
    </div>
  );
}

// Compact subscription summary for the Settings page. The full plan comparison,
// checkout and redeem flow now live on the dedicated Billing page (/billing) —
// this card shows status at a glance and links there.
function SubscriptionCard({ license, seats }) {
  const navigate = useNavigate();
  const tone = statusTone(license);

  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-lg grid place-items-center shrink-0" style={{ background: 'color-mix(in srgb, #3b82f6 14%, transparent)', border: '1px solid color-mix(in srgb, #3b82f6 24%, transparent)' }}><CreditCard className="w-5 h-5 text-blue-400" /></span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Subscription</h3>
            <p className="text-xs text-muted-foreground capitalize">SoftGlaze Browser · {license?.tier || 'pro'} plan</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0" style={{ background: `color-mix(in srgb, ${tone.color} 14%, transparent)`, color: tone.color, border: `1px solid color-mix(in srgb, ${tone.color} 26%, transparent)` }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone.color }} />{tone.label}
        </span>
      </div>

      {license?.isGrace && (
        <div className="mt-4 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[12px] text-amber-400">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Your {license.type === 'trial' ? 'free trial' : 'subscription'} has ended — {license.daysLeftGrace} grace day{license.daysLeftGrace === 1 ? '' : 's'} left. Renew on the Billing page to keep access.</span>
        </div>
      )}
      {license?.isBanned && (
        <div className="mt-4 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Your subscription has ended and profile launching is locked. Subscribe or enter a purchase code on the Billing page.</span>
        </div>
      )}
      {license?.isTrial && !license?.isGrace && (
        <p className="mt-4 text-[12px] text-muted-foreground flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-amber-400" /> Free trial — {license.daysLeftTrial} day{license.daysLeftTrial === 1 ? '' : 's'} remaining.</p>
      )}

      {seats && seats.total >= 0 && (
        <div className="mt-4 flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-elevated/50 border border-border">
          <div className="flex items-center gap-2 text-[12.5px] text-foreground">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span>Team seats</span>
          </div>
          <span className={`text-[12.5px] font-semibold ${seats.full ? 'text-amber-400' : 'text-foreground'}`}>{seats.used} / {seats.total} used</span>
        </div>
      )}

      <button onClick={() => navigate('/billing')} className="mt-4 w-full inline-flex items-center justify-center gap-2 h-10 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 shadow-lg shadow-blue-500/25">
        Manage subscription &amp; plans <ArrowUpRight className="w-4 h-4" />
      </button>
    </div>
  );
}

// Super-Admin payment-method configuration. Renders one editable block per
// provider (Cryptomus / Stripe / PayPal / Wise / Manual), driven by the metadata
// the main process returns — so adding a provider in payments.js surfaces here
// automatically. Secret values are never sent back to the renderer.
function PaymentGatewayCard() {
  const [config, setConfig] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { setConfig(await softglazeApi.payments.getConfig()); }
    catch (e) { setErr(e.message || 'Could not load payment settings.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="flex items-center gap-3 mb-1">
        <span className="w-10 h-10 rounded-lg grid place-items-center shrink-0" style={{ background: 'color-mix(in srgb, #f59e0b 14%, transparent)', border: '1px solid color-mix(in srgb, #f59e0b 24%, transparent)' }}><ShieldCheck className="w-5 h-5 text-amber-400" /></span>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Payment methods</h3>
          <p className="text-xs text-muted-foreground">Super Admin only. Enable the methods shown to owners at checkout and store each provider&rsquo;s keys.</p>
        </div>
      </div>

      {err && <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">{err}</div>}

      {!config ? (
        <div className="grid place-items-center py-10"><Loader2 className="w-5 h-5 text-muted-foreground animate-spin" /></div>
      ) : (
        <div className="mt-4 space-y-3">
          {config.providers.map((p) => <ProviderConfig key={p.id} provider={p} onSaved={load} />)}
        </div>
      )}

      <p className="mt-4 text-[11px] text-muted-foreground leading-relaxed">
        Keys are encrypted at rest on this machine and never leave it. Checkout is poll-based (no webhooks), so cross-install enforcement still needs the licensing backend. Wise &amp; Manual are approved by you under &ldquo;Pending payments&rdquo; below.
      </p>
    </div>
  );
}

// One provider's editable config. Holds its own field state; secret fields show a
// "stored" hint and a blank submit keeps the existing secret.
function ProviderConfig({ provider, onSaved }) {
  const [enabled, setEnabled] = useState(Boolean(provider.enabled));
  const [values, setValues] = useState(() => {
    const v = {};
    provider.fields.forEach((f) => { v[f.key] = f.secret ? '' : (f.value || ''); });
    return v;
  });
  const [stored, setStored] = useState(() => {
    const h = {};
    provider.fields.forEach((f) => { if (f.secret) h[f.key] = Boolean(f.has); });
    return h;
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const setField = (key, val) => setValues((prev) => ({ ...prev, [key]: val }));

  async function save() {
    setBusy('save'); setErr(''); setMsg('');
    try {
      const payloadValues = {};
      provider.fields.forEach((f) => { payloadValues[f.key] = values[f.key]; });
      await softglazeApi.payments.setConfig({ id: provider.id, enabled, values: payloadValues });
      // Mark secrets that were just set as stored, then clear the inputs.
      setStored((prev) => {
        const n = { ...prev };
        provider.fields.forEach((f) => { if (f.secret && values[f.key]) n[f.key] = true; });
        return n;
      });
      setValues((prev) => {
        const n = { ...prev };
        provider.fields.forEach((f) => { if (f.secret) n[f.key] = ''; });
        return n;
      });
      setMsg('Saved.');
      onSaved && onSaved();
    } catch (e) { setErr(e.message || 'Could not save.'); }
    finally { setBusy(''); }
  }

  async function test() {
    setBusy('test'); setErr(''); setMsg('');
    try {
      const r = await softglazeApi.payments.validate({ id: provider.id });
      if (r.ok) setMsg('Connection looks good ✓');
      else setErr(r.error || 'Validation failed — check the keys.');
    } catch (e) { setErr(e.message || 'Validation failed.'); }
    finally { setBusy(''); }
  }

  const inputCls = 'w-full h-9 bg-input-background border border-border rounded-lg px-3 text-[12.5px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary';
  const labelCls = 'block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5';

  return (
    <div className="rounded-lg border border-border bg-elevated/40 overflow-hidden">
      {/* Header row: label + kind badge + enable toggle */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          <span className="text-[13px] font-semibold text-foreground">{provider.label}</span>
          <span className={`text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full ${provider.kind === 'manual' ? 'bg-amber-500/15 text-amber-400' : 'bg-blue-500/15 text-blue-400'}`}>
            {provider.kind === 'manual' ? 'Manual' : 'Automated'}
          </span>
          {enabled && <span className="text-[10px] text-emerald-400 inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> on</span>}
        </button>
        <label className="flex items-center gap-2 text-[11.5px] text-muted-foreground cursor-pointer shrink-0">
          <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setOpen(true); }} className="accent-blue-500" />
          Enabled
        </label>
      </div>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/60 pt-3">
          {provider.docsUrl && (
            <a href={provider.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary hover:text-primary-hover"><ExternalLink className="w-3 h-3" /> Documentation</a>
          )}
          {provider.fields.map((f) => (
            <div key={f.key}>
              <label className={labelCls}>{f.label}</label>
              {f.type === 'select' ? (
                <select className={inputCls} value={values[f.key]} onChange={(e) => setField(f.key, e.target.value)}>
                  {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea rows={3} className={inputCls.replace('h-9', 'min-h-[64px] py-2')} value={values[f.key]} onChange={(e) => setField(f.key, e.target.value)} placeholder={f.placeholder || ''} />
              ) : (
                <input
                  type={f.secret ? 'password' : 'text'}
                  className={inputCls + (f.secret ? ' font-mono' : '')}
                  value={values[f.key]}
                  onChange={(e) => setField(f.key, e.target.value)}
                  placeholder={f.secret ? (stored[f.key] ? '•••••••• (leave blank to keep current)' : (f.placeholder || 'Paste the key')) : (f.placeholder || '')}
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </div>
          ))}

          <div className="flex items-center gap-2 pt-1">
            <button onClick={save} disabled={busy === 'save'} className="h-8 px-4 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 text-white font-semibold text-[12px] flex items-center gap-1.5 disabled:opacity-60">
              {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save
            </button>
            {provider.kind === 'automated' && (
              <button onClick={test} disabled={busy === 'test'} className="h-8 px-3 rounded-lg text-[12px] text-muted-foreground hover:bg-secondary border border-border flex items-center gap-1.5 disabled:opacity-50">
                {busy === 'test' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />} Test connection
              </button>
            )}
          </div>

          {msg && <p className="text-[11.5px] text-emerald-400 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" />{msg}</p>}
          {err && <p className="text-[11.5px] text-red-400">{err}</p>}
        </div>
      )}
    </div>
  );
}

// Super-Admin review queue for manual (Wise / bank-transfer / custom) payments.
// Approving grants the buyer's plan; nothing is auto-trusted from the renderer.
function ManualPaymentsCard() {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { setItems(await softglazeApi.payments.manualList()); }
    catch (e) { setErr(e.message || 'Could not load manual payments.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function resolve(id, action) {
    setBusy(`${id}:${action}`); setErr('');
    try { await softglazeApi.payments.manualResolve({ id, action }); await load(); }
    catch (e) { setErr(e.message || 'Could not update that payment.'); }
    finally { setBusy(''); }
  }

  if (!items || items.length === 0) return null;
  const tone = (s) => s === 'approved' ? 'text-emerald-400' : s === 'rejected' ? 'text-red-400' : 'text-amber-400';

  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="flex items-center gap-3 mb-3">
        <span className="w-10 h-10 rounded-lg grid place-items-center shrink-0" style={{ background: 'color-mix(in srgb, #f59e0b 14%, transparent)', border: '1px solid color-mix(in srgb, #f59e0b 24%, transparent)' }}><Wallet className="w-5 h-5 text-amber-400" /></span>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Pending payments</h3>
          <p className="text-xs text-muted-foreground">Manual (Wise / bank transfer) submissions awaiting your approval.</p>
        </div>
      </div>

      {err && <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">{err}</div>}

      <div className="space-y-2">
        {items.map((m) => (
          <div key={m.id} className="flex items-center gap-3 rounded-lg border border-border bg-elevated/40 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] text-foreground truncate">
                {m.ownerName || `Owner #${m.ownerId ?? '—'}`} · <span className="capitalize">{m.tier}</span> · {m.providerLabel || m.provider}
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                {m.amount ? `${m.currency || ''} ${m.amount}` : ''}{m.reference ? ` · ref: ${m.reference}` : ''}{m.note ? ` · ${m.note}` : ''}
              </div>
            </div>
            {m.status === 'pending' ? (
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => resolve(m.id, 'approve')} disabled={busy === `${m.id}:approve`} className="h-8 px-3 rounded-lg text-[12px] font-semibold text-white bg-emerald-600 hover:bg-emerald-500 flex items-center gap-1.5 disabled:opacity-60">
                  {busy === `${m.id}:approve` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Approve
                </button>
                <button onClick={() => resolve(m.id, 'reject')} disabled={busy === `${m.id}:reject`} className="h-8 px-3 rounded-lg text-[12px] font-semibold text-muted-foreground hover:bg-secondary border border-border flex items-center gap-1.5 disabled:opacity-60">
                  {busy === `${m.id}:reject` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />} Reject
                </button>
              </div>
            ) : (
              <span className={`text-[11.5px] font-semibold capitalize inline-flex items-center gap-1 shrink-0 ${tone(m.status)}`}>
                {m.status === 'pending' ? <Clock className="w-3.5 h-3.5" /> : m.status === 'approved' ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                {m.status}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
