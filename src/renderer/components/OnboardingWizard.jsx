import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Mail, Globe, Fingerprint, Smartphone, Check, ArrowRight, ArrowLeft, Loader2, X } from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { useDialog } from '@/lib/useDialog.js';
import { loadCurrentMember } from '@/lib/usePermissions.js';
import { ONBOARDING_STEPS, onboardingStepDenials } from '@/lib/memberPermissions.mjs';
import i18n from '@/i18n/index.js';
import cmpOverlaysEn from '@/i18n/locales/en/cmpOverlays.json';
import cmpOverlaysEs from '@/i18n/locales/es/cmpOverlays.json';

// Registers cmpOverlays without touching the central i18n config; the guard keeps it safe across
// hot reloads and the CommandPalette's identical registration.
if (!i18n.hasResourceBundle('en', 'cmpOverlays')) i18n.addResourceBundle('en', 'cmpOverlays', cmpOverlaysEn);
if (!i18n.hasResourceBundle('es', 'cmpOverlays')) i18n.addResourceBundle('es', 'cmpOverlays', cmpOverlaysEs);

// First-run setup over the existing SMTP / proxy / profile flows; every step is skippable. Each member
// has their own "done" flag (main: the Owner's is globalSettings.onboardingDone, every other member's is
// in memberOnboarding), so finishing or skipping it hides it for that member only. The Owner is not
// shown it on a workspace that already has profiles. A step the member's role cannot do is skipped and
// shown greyed out on the welcome screen with the reason as its tooltip; with no step left, no wizard.
const inputCls = 'w-full h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary';
const labelCls = 'block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5';

// Module scope so it is not a new component type each render, which would remount the inputs
// and drop focus on every keystroke.
function WizardShell({ icon: Icon, title, subtitle, children, onBack, footer, onSkip, err, msg }) {
  const { t } = useTranslation('cmpOverlays');
  // Escape deliberately does not close: a stray Escape must not skip onboarding for good;
  // X and Skip are the explicit exits.
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
  const { t: tc } = useTranslation('common');
  const [phase, setPhase] = useState('checking'); // checking | hidden | active
  const [step, setStep] = useState('welcome'); // welcome · smtp · proxy · profile
  // Why each step is off for this member (onboardingStepDenials), null when it is on.
  const [denied, setDenied] = useState({ smtp: null, proxy: null, profile: null });
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
        // main returns this member's own flag (the Owner's is the workspace's).
        const g = await softglazeApi.settings.getGlobal().catch(() => ({}));
        if (g && g.onboardingDone) { if (live) setPhase('hidden'); return; }
        const me = await loadCurrentMember();
        const d = onboardingStepDenials(me);
        // Nothing here this member may set up: no wizard (and no flag, so it can show once they may).
        if (ONBOARDING_STEPS.every((k) => d[k])) { if (live) setPhase('hidden'); return; }
        // Don't nag an existing workspace: the Owner (single-user mode included) who already has profiles
        // is marked done. Other members have their own flag, which main already set for members who used
        // the app before 1.0.26, so a new member is shown the wizard even when profiles are shared with them.
        if (me === null || (me && me.role === 'OWNER')) {
          const existing = await softglazeApi.profiles.list().catch(() => []);
          const arr = Array.isArray(existing) ? existing : (existing && (existing.items || existing.profiles || existing.rows || existing.data)) || [];
          if (arr.length > 0) {
            // Only the flag: main merges it in.
            await softglazeApi.settings.setGlobal({ onboardingDone: true }).catch(() => {});
            if (live) setPhase('hidden');
            return;
          }
        }
        if (live) { setDenied(d); setPhase('active'); }
      } catch (e) { if (live) setPhase('hidden'); }
    })();
    return () => { live = false; };
  }, []);

  async function finish() {
    try { await softglazeApi.settings.setGlobal({ onboardingDone: true }); } catch (e) { /* best-effort */ }
    setPhase('hidden');
  }

  if (phase !== 'active') return null;

  // The steps this member may do, in order; the others are skipped.
  const order = ONBOARDING_STEPS.filter((k) => !denied[k]);
  const nextOf = (k) => order[order.indexOf(k) + 1] || null;
  const backOf = (k) => order[order.indexOf(k) - 1] || 'welcome';
  const goNext = (k) => { const n = nextOf(k); if (n) setStep(n); else finish(); };
  // The same wording as every other control a member may not use (usePermissions).
  const reasonText = (d) => {
    if (!d) return null;
    if (d.kind === 'feature') return tc(d.feature === 'proxies' ? 'perm.proxiesHidden' : 'perm.profilesHidden');
    if (d.kind === 'loading') return tc('perm.checking');
    if (d.kind === 'inactive') return tc('perm.inactive');
    if (d.kind === 'revoked') return tc('perm.turnedOff');
    if (d.role === 'OWNER') return tc('perm.ownerOnly');
    return tc('perm.needsRole', { role: tc(`roles.${d.role}`) });
  };

  async function saveSmtp() {
    setErr(''); setMsg(''); setBusy('smtp');
    try {
      await softglazeApi.settings.setEmail({ host: smtp.host.trim(), port: Number(smtp.port) || 587, user: smtp.user.trim(), pass: smtp.pass, from: smtp.from.trim() || smtp.user.trim() });
      setMsg(t('wizard.msg.smtpSaved')); goNext('smtp');
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
      setMsg(t('wizard.msg.proxySaved')); goNext('proxy');
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

  if (step === 'welcome') {
    // A step this member cannot do stays in the list, greyed out, with the reason as its tooltip (and for
    // screen readers), the way a disabled control explains itself (GuardedButton).
    const welcomeStep = (key, Icon, label) => {
      const why = reasonText(denied[key]);
      if (!why) return <li key={key} className="flex items-center gap-2.5"><Icon className="w-4 h-4 text-primary" /> {label}</li>;
      return (
        <li key={key} className="flex items-center gap-2.5 opacity-50" title={why}>
          <Icon className="w-4 h-4 text-muted-foreground" aria-hidden="true" /> {label}<span className="sr-only"> ({why})</span>
        </li>
      );
    };
    return (
      <WizardShell icon={Sparkles} title={t('wizard.welcome.title')} subtitle={order.length === ONBOARDING_STEPS.length ? t('wizard.welcome.subtitle') : t('wizard.welcome.subtitleShort', { count: order.length })}
        onSkip={finish} err={err} msg={msg}
        footer={<>
          <button onClick={finish} className="text-[12.5px] text-muted-foreground hover:text-foreground px-3 py-2">{t('wizard.skip')}</button>
          <button onClick={() => { setErr(''); setMsg(''); setStep(order[0]); }} className="h-9 px-5 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[12.5px] inline-flex items-center gap-2">{t('wizard.welcome.getStarted')} <ArrowRight className="w-4 h-4" /></button>
        </>}>
        <ul className="space-y-2.5 text-[13px] text-foreground">
          {welcomeStep('smtp', Mail, t('wizard.welcome.stepEmail'))}
          {welcomeStep('proxy', Globe, t('wizard.welcome.stepProxy'))}
          {welcomeStep('profile', Fingerprint, t('wizard.welcome.stepProfile'))}
        </ul>
        {order.length < ONBOARDING_STEPS.length && <p className="mt-3 text-[11.5px] text-muted-foreground">{t('wizard.welcome.unavailable')}</p>}
      </WizardShell>
    );
  }

  if (step === 'smtp') {
    return (
      <WizardShell icon={Mail} title={t('wizard.smtp.title')} subtitle={t('wizard.smtp.subtitle')}
        onBack={() => setStep(backOf('smtp'))} onSkip={finish} err={err} msg={msg}
        footer={<>
          <button onClick={() => { setErr(''); setMsg(''); goNext('smtp'); }} className="text-[12.5px] text-muted-foreground hover:text-foreground px-3 py-2">{t('wizard.skip')}</button>
          <button onClick={saveSmtp} disabled={busy === 'smtp' || !smtp.host} className="h-9 px-5 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[12.5px] inline-flex items-center gap-2 disabled:opacity-60">{busy === 'smtp' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} {t(nextOf('smtp') ? 'wizard.saveAndContinue' : 'wizard.saveAndFinish')}</button>
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

  if (step === 'proxy') {
    return (
      <WizardShell icon={Globe} title={t('wizard.proxy.title')} subtitle={t('wizard.proxy.subtitle')}
        onBack={() => setStep(backOf('proxy'))} onSkip={finish} err={err} msg={msg}
        footer={<>
          <button onClick={() => { setErr(''); setMsg(''); goNext('proxy'); }} className="text-[12.5px] text-muted-foreground hover:text-foreground px-3 py-2">{t('wizard.skip')}</button>
          <button onClick={saveProxy} disabled={busy === 'proxy' || !proxy.host || !proxy.port} className="h-9 px-5 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[12.5px] inline-flex items-center gap-2 disabled:opacity-60">{busy === 'proxy' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} {t(nextOf('proxy') ? 'wizard.saveAndContinue' : 'wizard.saveAndFinish')}</button>
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

  // the first profile (always the last step when it is on)
  return (
    <WizardShell icon={Fingerprint} title={t('wizard.profile.title')} subtitle={t('wizard.profile.subtitle')}
      onBack={() => setStep(backOf('profile'))} onSkip={finish} err={err} msg={msg}
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
