import { useEffect, useState } from 'react';
import { Sparkles, Mail, Globe, Fingerprint, Smartphone, Check, ArrowRight, ArrowLeft, Loader2, X } from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { useDialog } from '@/lib/useDialog.js';

// First-run setup. Reuses the existing SMTP / proxy / profile flows behind a few
// guided steps. Shown only on a genuinely fresh workspace (no profiles yet) and
// only until completed/skipped — the "done" flag lives in global settings, so
// there's no new IPC and no migration. Every step is skippable; nothing is faked.
const inputCls = 'w-full h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary';
const labelCls = 'block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5';

// Defined at module scope (not inside the component) so it isn't a new component
// type on every render — otherwise the inputs would remount and lose focus on each
// keystroke.
function WizardShell({ icon: Icon, title, subtitle, children, onBack, footer, onSkip, err, msg }) {
  // Focus-trap + scroll-lock + focus-restore + ARIA. Escape is intentionally NOT
  // wired to close: this is a setup flow, and a stray Escape shouldn't permanently
  // skip onboarding (the X / Skip buttons remain the explicit exits).
  const { dialogRef } = useDialog({ onClose: onSkip, closeOnEscape: false });
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="relative w-full max-w-[480px] rounded-2xl bg-card border border-border shadow-2xl p-6">
        <button onClick={onSkip} title="Skip setup" className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center mb-4"><Icon className="w-5 h-5" /></div>
        <h2 className="font-display text-[19px] font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="text-[12.5px] text-muted-foreground mt-1 mb-5">{subtitle}</p>
        {children}
        {(err || msg) && <p className={`mt-3 text-[12px] ${err ? 'text-red-400' : 'text-emerald-400'}`}>{err || msg}</p>}
        <div className="mt-6 flex items-center justify-between">
          {onBack ? <button onClick={onBack} className="text-[12.5px] text-muted-foreground hover:text-foreground flex items-center gap-1.5"><ArrowLeft className="w-3.5 h-3.5" /> Back</button> : <span />}
          <div className="flex items-center gap-2">{footer}</div>
        </div>
      </div>
    </div>
  );
}

export default function OnboardingWizard() {
  const [phase, setPhase] = useState('checking'); // checking | hidden | active
  const [step, setStep] = useState(0); // 0 welcome · 1 smtp · 2 proxy · 3 profile
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const [smtp, setSmtp] = useState({ host: '', port: '587', user: '', pass: '', from: '' });
  const [proxy, setProxy] = useState({ name: '', type: 'HTTP', host: '', port: '', username: '', password: '' });
  const [proxyId, setProxyId] = useState(null);
  const [profileName, setProfileName] = useState('My first profile');
  const [deviceClass, setDeviceClass] = useState('desktop');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const g = await softglazeApi.settings.getGlobal().catch(() => ({}));
        if (g && g.onboardingDone) { if (live) setPhase('hidden'); return; }
        // Don't nag an existing workspace: if profiles already exist, mark done.
        const existing = await softglazeApi.profiles.list().catch(() => []);
        const arr = Array.isArray(existing) ? existing : (existing && (existing.items || existing.profiles || existing.rows || existing.data)) || [];
        if (arr.length > 0) {
          await softglazeApi.settings.setGlobal({ ...(g || {}), onboardingDone: true }).catch(() => {});
          if (live) setPhase('hidden');
          return;
        }
        if (live) setPhase('active');
      } catch (e) { if (live) setPhase('hidden'); }
    })();
    return () => { live = false; };
  }, []);

  async function finish() {
    try { const g = await softglazeApi.settings.getGlobal().catch(() => ({})); await softglazeApi.settings.setGlobal({ ...(g || {}), onboardingDone: true }); } catch (e) { /* best-effort */ }
    setPhase('hidden');
  }

  if (phase !== 'active') return null;

  async function saveSmtp() {
    setErr(''); setMsg(''); setBusy('smtp');
    try {
      await softglazeApi.settings.setEmail({ host: smtp.host.trim(), port: Number(smtp.port) || 587, user: smtp.user.trim(), pass: smtp.pass, from: smtp.from.trim() || smtp.user.trim() });
      setMsg('SMTP saved.'); setStep(2);
    } catch (e) { setErr(e.message || 'Could not save SMTP settings.'); }
    finally { setBusy(''); }
  }

  async function saveProxy() {
    setErr(''); setMsg(''); setBusy('proxy');
    try {
      const created = await softglazeApi.proxies.create({
        name: proxy.name.trim() || `${proxy.host}:${proxy.port}`,
        type: proxy.type, host: proxy.host.trim(), port: Number(proxy.port) || 0,
        username: proxy.username.trim() || null, password: proxy.password || null
      });
      if (created && created.id) setProxyId(created.id);
      setMsg('Proxy saved.'); setStep(3);
    } catch (e) { setErr(e.message || 'Could not save the proxy.'); }
    finally { setBusy(''); }
  }

  async function createProfile() {
    setErr(''); setMsg(''); setBusy('profile');
    try {
      const payload = { title: profileName.trim() || 'My first profile', randomFingerprint: true, deviceClass };
      if (deviceClass === 'mobile') payload.os = 'Android';
      if (proxyId) { payload.proxyId = proxyId; payload.systemProxyBehavior = 'PROFILE_PROXY'; }
      await softglazeApi.profiles.create(payload);
      await finish();
    } catch (e) { setErr(e.message || 'Could not create the profile.'); setBusy(''); }
  }

  if (step === 0) {
    return (
      <WizardShell icon={Sparkles} title="Welcome to SoftGlaze" subtitle="A quick 3-step setup gets you to your first profile. You can skip any step."
        onSkip={finish} err={err} msg={msg}
        footer={<>
          <button onClick={finish} className="text-[12.5px] text-muted-foreground hover:text-foreground px-3 py-2">Skip</button>
          <button onClick={() => { setErr(''); setMsg(''); setStep(1); }} className="h-9 px-5 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[12.5px] inline-flex items-center gap-2">Get started <ArrowRight className="w-4 h-4" /></button>
        </>}>
        <ul className="space-y-2.5 text-[13px] text-foreground">
          <li className="flex items-center gap-2.5"><Mail className="w-4 h-4 text-primary" /> Email (SMTP) — optional, for OTP codes</li>
          <li className="flex items-center gap-2.5"><Globe className="w-4 h-4 text-primary" /> Your first proxy — optional</li>
          <li className="flex items-center gap-2.5"><Fingerprint className="w-4 h-4 text-primary" /> Your first browser profile</li>
        </ul>
      </WizardShell>
    );
  }

  if (step === 1) {
    return (
      <WizardShell icon={Mail} title="Email (SMTP)" subtitle="Optional — lets the app send verification codes. You can set this later in Settings."
        onBack={() => setStep(0)} onSkip={finish} err={err} msg={msg}
        footer={<>
          <button onClick={() => { setErr(''); setMsg(''); setStep(2); }} className="text-[12.5px] text-muted-foreground hover:text-foreground px-3 py-2">Skip</button>
          <button onClick={saveSmtp} disabled={busy === 'smtp' || !smtp.host} className="h-9 px-5 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[12.5px] inline-flex items-center gap-2 disabled:opacity-60">{busy === 'smtp' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Save &amp; continue</button>
        </>}>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2"><label className={labelCls}>SMTP host</label><input className={inputCls} value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} placeholder="smtp.example.com" /></div>
            <div><label className={labelCls}>Port</label><input className={inputCls} value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: e.target.value })} placeholder="587" /></div>
          </div>
          <div><label className={labelCls}>Username</label><input className={inputCls} value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} placeholder="you@example.com" /></div>
          <div><label className={labelCls}>Password</label><input type="password" className={inputCls} value={smtp.pass} onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })} placeholder="••••••••" /></div>
        </div>
      </WizardShell>
    );
  }

  if (step === 2) {
    return (
      <WizardShell icon={Globe} title="Add your first proxy" subtitle="Optional — give each identity its own network. You can add more in the Proxy pool."
        onBack={() => setStep(1)} onSkip={finish} err={err} msg={msg}
        footer={<>
          <button onClick={() => { setErr(''); setMsg(''); setStep(3); }} className="text-[12.5px] text-muted-foreground hover:text-foreground px-3 py-2">Skip</button>
          <button onClick={saveProxy} disabled={busy === 'proxy' || !proxy.host || !proxy.port} className="h-9 px-5 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[12.5px] inline-flex items-center gap-2 disabled:opacity-60">{busy === 'proxy' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Save &amp; continue</button>
        </>}>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div><label className={labelCls}>Type</label>
              <select className={inputCls} value={proxy.type} onChange={(e) => setProxy({ ...proxy, type: e.target.value })}>
                <option value="HTTP">HTTP</option>
                <option value="SOCKS5">SOCKS5</option>
              </select>
            </div>
            <div className="col-span-2"><label className={labelCls}>Host</label><input className={inputCls} value={proxy.host} onChange={(e) => setProxy({ ...proxy, host: e.target.value })} placeholder="1.2.3.4" /></div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><label className={labelCls}>Port</label><input className={inputCls} value={proxy.port} onChange={(e) => setProxy({ ...proxy, port: e.target.value })} placeholder="8080" /></div>
            <div><label className={labelCls}>User</label><input className={inputCls} value={proxy.username} onChange={(e) => setProxy({ ...proxy, username: e.target.value })} placeholder="optional" /></div>
            <div><label className={labelCls}>Password</label><input type="password" className={inputCls} value={proxy.password} onChange={(e) => setProxy({ ...proxy, password: e.target.value })} placeholder="optional" /></div>
          </div>
        </div>
      </WizardShell>
    );
  }

  // step 3 — first profile
  return (
    <WizardShell icon={Fingerprint} title="Create your first profile" subtitle="A unique, internally-consistent fingerprint is generated for you."
      onBack={() => setStep(2)} onSkip={finish} err={err} msg={msg}
      footer={<button onClick={createProfile} disabled={busy === 'profile'} className="h-9 px-5 rounded-lg bg-gradient-to-br from-primary to-primary-hover text-white font-semibold text-[12.5px] inline-flex items-center gap-2 disabled:opacity-60">{busy === 'profile' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Create &amp; finish</button>}>
      <div className="space-y-3.5">
        <div><label className={labelCls}>Profile name</label><input className={inputCls} value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="My first profile" /></div>
        <div>
          <label className={labelCls}>Device type</label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setDeviceClass('desktop')} className={`h-10 rounded-lg border text-[12.5px] font-semibold inline-flex items-center justify-center gap-2 ${deviceClass === 'desktop' ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'}`}><Fingerprint className="w-4 h-4" /> Desktop</button>
            <button type="button" onClick={() => setDeviceClass('mobile')} className={`h-10 rounded-lg border text-[12.5px] font-semibold inline-flex items-center justify-center gap-2 ${deviceClass === 'mobile' ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'}`}><Smartphone className="w-4 h-4" /> Mobile (Android)</button>
          </div>
          {deviceClass === 'mobile' && <p className="text-[11px] text-muted-foreground mt-1.5">Android is emulated on the desktop engine — coherent UA, touch, screen &amp; GPU, but not a real device.</p>}
        </div>
        {proxyId && <p className="text-[12px] text-emerald-400 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> Your new proxy will be attached to this profile.</p>}
      </div>
    </WizardShell>
  );
}
