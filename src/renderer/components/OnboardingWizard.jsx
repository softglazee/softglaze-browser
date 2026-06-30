import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Mail, Globe, Fingerprint, Smartphone, Check, ArrowRight, ArrowLeft, Loader2, X } from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { useDialog } from '@/lib/useDialog.js';
import i18n from '@/i18n/index.js';
import cmpOverlaysEn from '@/i18n/locales/en/cmpOverlays.json';
import cmpOverlaysEs from '@/i18n/locales/es/cmpOverlays.json';

// Register the "cmpOverlays" namespace without touching the central i18n config.
// addResourceBundle is a no-op if the bundle already exists, so this is safe across
// hot reloads (and the CommandPalette performing the same registration).
if (!i18n.hasResourceBundle('en', 'cmpOverlays')) i18n.addResourceBundle('en', 'cmpOverlays', cmpOverlaysEn);
if (!i18n.hasResourceBundle('es', 'cmpOverlays')) i18n.addResourceBundle('es', 'cmpOverlays', cmpOverlaysEs);

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
  const { t } = useTranslation('cmpOverlays');
  // Focus-trap + scroll-lock + focus-restore + ARIA. Escape is intentionally NOT
  // wired to close: this is a setup flow, and a stray Escape shouldn't permanently
  // skip onboarding (the X / Skip buttons remain the explicit exits).
  const { dialogRef } = useDialog({ onClose: onSkip, closeOnEscape: false });
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="relative w-full max-w-[480px] rounded-2xl bg-card border border-border shadow-2xl p-6">
        <button onClick={onSkip} title={t('wizard.skipTitle')} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center mb-4"><Icon className="w-5 h-5" /></div>
        <h2 className="font-display text-[19px] font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="text-[12.5px] text-muted-foreground mt-1 mb-5">{subtitle}</p>
        {children}
        {(err || msg) && <p className={`mt-3 text-[12px] ${err ? 'text-red-400' : 'text-emerald-400'}`}>{err || msg}</p>}
        <div className="mt-6 flex items-center justify-between">
          {onBack ? <button onClick={onBack} className="text-[12.5px] text-muted-foreground hover:text-foreground flex items-center gap-1.5"><ArrowLeft className="w-3.5 h-3.5" /> {t('wizard.back')}</button> : <span />}
          <div className="flex items-center gap-2">{footer}</div>
        </div>
      </div>
    </div>
  );
}

export default function OnboardingWizard() {
  const { t } = useTranslation('cmpOverlays');
  const [phase, setPhase] = useState('checking'); // checking | hidden | active
  const [step, setStep] = useState(0); // 0 welcome · 1 smtp · 2 proxy · 3 profile
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const [smtp, setSmtp] = useState({ host: '', port: '587', user: '', pass: '', from: '' });
  const [proxy, setProxy] = useState({ name: '', type: 'HTTP', host: '', port: '', username: '', password: '' });
  const [proxyId, setProxyId] = useState(null);
  const [profileName, setProfileName] = useState(t('wizard.profile.defaultName'));
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
      setMsg(t('wizard.msg.smtpSaved')); setStep(2);
    } catch (e) { setErr(e.message || t('wizard.err.smtpSaveFailed')); }
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
      setMsg(t('wizard.msg.proxySaved')); setStep(3);
    } catch (e) { setErr(e.message || t('wizard.err.proxySaveFailed')); }
    finally { setBusy(''); }
  }

  async function createProfile() {
    setErr(''); setMsg(''); setBusy('profile');
    try {
      const payload = { title: profileName.trim() || t('wizard.profile.defaultName'), randomFingerprint: true, deviceClass };
      if (deviceClass === 'mobile') payload.os = 'Android';
      if (proxyId) { payload.proxyId = proxyId; payload.systemProxyBehavior = 'PROFILE_PROXY'; }
      await softglazeApi.profiles.create(payload);
      await finish();
    } catch (e) { setErr(e.message || t('wizard.err.profileCreateFailed')); setBusy(''); }
  }

  if (step === 0) {
    return (
      <WizardShell icon={Sparkles} title={t('wizard.welcome.title')} subtitle={t('wizard.welcome.subtitle')}
        onSkip={finish} err={err} msg={msg}
        footer={<>
          <button onClick={finish} className="text-[12.5px] text-muted-foreground hover:text-foreground px-3 py-2">{t('wizard.skip')}</button>
          <button onClick={() => { setErr(''); setMsg(''); setStep(1); }} className="h-9 px-5 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[12.5px] inline-flex items-center gap-2">{t('wizard.welcome.getStarted')} <ArrowRight className="w-4 h-4" /></button>
        </>}>
        <ul className="space-y-2.5 text-[13px] text-foreground">
          <li className="flex items-center gap-2.5"><Mail className="w-4 h-4 text-primary" /> {t('wizard.welcome.stepEmail')}</li>
          <li className="flex items-center gap-2.5"><Globe className="w-4 h-4 text-primary" /> {t('wizard.welcome.stepProxy')}</li>
          <li className="flex items-center gap-2.5"><Fingerprint className="w-4 h-4 text-primary" /> {t('wizard.welcome.stepProfile')}</li>
        </ul>
      </WizardShell>
    );
  }

  if (step === 1) {
    return (
      <WizardShell icon={Mail} title={t('wizard.smtp.title')} subtitle={t('wizard.smtp.subtitle')}
        onBack={() => setStep(0)} onSkip={finish} err={err} msg={msg}
        footer={<>
          <button onClick={() => { setErr(''); setMsg(''); setStep(2); }} className="text-[12.5px] text-muted-foreground hover:text-foreground px-3 py-2">{t('wizard.skip')}</button>
          <button onClick={saveSmtp} disabled={busy === 'smtp' || !smtp.host} className="h-9 px-5 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[12.5px] inline-flex items-center gap-2 disabled:opacity-60">{busy === 'smtp' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} {t('wizard.saveAndContinue')}</button>
        </>}>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2"><label className={labelCls}>{t('wizard.smtp.host')}</label><input className={inputCls} value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} placeholder={t('wizard.smtp.hostPlaceholder')} /></div>
            <div><label className={labelCls}>{t('wizard.smtp.port')}</label><input className={inputCls} value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: e.target.value })} placeholder={t('wizard.smtp.portPlaceholder')} /></div>
          </div>
          <div><label className={labelCls}>{t('wizard.smtp.username')}</label><input className={inputCls} value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} placeholder={t('wizard.smtp.usernamePlaceholder')} /></div>
          <div><label className={labelCls}>{t('wizard.smtp.password')}</label><input type="password" className={inputCls} value={smtp.pass} onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })} placeholder={t('wizard.smtp.passwordPlaceholder')} /></div>
        </div>
      </WizardShell>
    );
  }

  if (step === 2) {
    return (
      <WizardShell icon={Globe} title={t('wizard.proxy.title')} subtitle={t('wizard.proxy.subtitle')}
        onBack={() => setStep(1)} onSkip={finish} err={err} msg={msg}
        footer={<>
          <button onClick={() => { setErr(''); setMsg(''); setStep(3); }} className="text-[12.5px] text-muted-foreground hover:text-foreground px-3 py-2">{t('wizard.skip')}</button>
          <button onClick={saveProxy} disabled={busy === 'proxy' || !proxy.host || !proxy.port} className="h-9 px-5 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[12.5px] inline-flex items-center gap-2 disabled:opacity-60">{busy === 'proxy' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} {t('wizard.saveAndContinue')}</button>
        </>}>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div><label className={labelCls}>{t('wizard.proxy.type')}</label>
              <select className={inputCls} value={proxy.type} onChange={(e) => setProxy({ ...proxy, type: e.target.value })}>
                <option value="HTTP">HTTP</option>
                <option value="SOCKS5">SOCKS5</option>
              </select>
            </div>
            <div className="col-span-2"><label className={labelCls}>{t('wizard.proxy.host')}</label><input className={inputCls} value={proxy.host} onChange={(e) => setProxy({ ...proxy, host: e.target.value })} placeholder={t('wizard.proxy.hostPlaceholder')} /></div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><label className={labelCls}>{t('wizard.proxy.port')}</label><input className={inputCls} value={proxy.port} onChange={(e) => setProxy({ ...proxy, port: e.target.value })} placeholder={t('wizard.proxy.portPlaceholder')} /></div>
            <div><label className={labelCls}>{t('wizard.proxy.user')}</label><input className={inputCls} value={proxy.username} onChange={(e) => setProxy({ ...proxy, username: e.target.value })} placeholder={t('wizard.proxy.userPlaceholder')} /></div>
            <div><label className={labelCls}>{t('wizard.proxy.password')}</label><input type="password" className={inputCls} value={proxy.password} onChange={(e) => setProxy({ ...proxy, password: e.target.value })} placeholder={t('wizard.proxy.passwordPlaceholder')} /></div>
          </div>
        </div>
      </WizardShell>
    );
  }

  // step 3 — first profile
  return (
    <WizardShell icon={Fingerprint} title={t('wizard.profile.title')} subtitle={t('wizard.profile.subtitle')}
      onBack={() => setStep(2)} onSkip={finish} err={err} msg={msg}
      footer={<button onClick={createProfile} disabled={busy === 'profile'} className="h-9 px-5 rounded-lg bg-gradient-to-br from-primary to-primary-hover text-white font-semibold text-[12.5px] inline-flex items-center gap-2 disabled:opacity-60">{busy === 'profile' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {t('wizard.profile.createAndFinish')}</button>}>
      <div className="space-y-3.5">
        <div><label className={labelCls}>{t('wizard.profile.name')}</label><input className={inputCls} value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder={t('wizard.profile.namePlaceholder')} /></div>
        <div>
          <label className={labelCls}>{t('wizard.profile.deviceType')}</label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setDeviceClass('desktop')} className={`h-10 rounded-lg border text-[12.5px] font-semibold inline-flex items-center justify-center gap-2 ${deviceClass === 'desktop' ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'}`}><Fingerprint className="w-4 h-4" /> {t('wizard.profile.desktop')}</button>
            <button type="button" onClick={() => setDeviceClass('mobile')} className={`h-10 rounded-lg border text-[12.5px] font-semibold inline-flex items-center justify-center gap-2 ${deviceClass === 'mobile' ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'}`}><Smartphone className="w-4 h-4" /> {t('wizard.profile.mobile')}</button>
          </div>
          {deviceClass === 'mobile' && <p className="text-[11px] text-muted-foreground mt-1.5">{t('wizard.profile.mobileNote')}</p>}
        </div>
        {proxyId && <p className="text-[12px] text-emerald-400 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> {t('wizard.profile.proxyAttached')}</p>}
      </div>
    </WizardShell>
  );
}
