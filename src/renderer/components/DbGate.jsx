import { useEffect, useState } from 'react';
import { Database, Lock, Loader2, AlertTriangle, KeyRound, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { softglazeApi } from '@/lib/softglazeApi.js';

// Pre-Gate database unlock. When at-rest encryption is on, the database file is
// ciphertext at boot and nothing else in the app can read it — so this screen runs
// BEFORE <Gate>, collects the workspace password, and asks main to decrypt + open
// the database. Once unlocked it renders its children (the normal Gate flow). When
// encryption is off (the default) it is a transparent pass-through.
const inputCls = 'w-full h-10 bg-background/60 border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all placeholder:text-muted-dark font-mono';

export default function DbGate({ children }) {
  const { t } = useTranslation('gate');
  const [phase, setPhase] = useState('loading'); // loading | unlock | ready
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false); // "keep me signed in" (default off)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [corrupted, setCorrupted] = useState(false);

  async function evaluate() {
    try {
      const s = await softglazeApi.db.encryptionStatus();
      setPhase(s && s.enabled && !s.unlocked ? 'unlock' : 'ready');
    } catch (e) {
      // If we can't even read status, don't block the app — let the normal Gate run.
      setPhase('ready');
    }
  }
  useEffect(() => { evaluate(); }, []);
  useEffect(() => {
    (softglazeApi.auth && softglazeApi.auth.rememberStatus ? softglazeApi.auth.rememberStatus() : Promise.resolve(null))
      .then((s) => { if (s && s.enabled) setRemember(true); })
      .catch(() => {});
  }, []);

  async function unlock() {
    setErr('');
    if (!password) return setErr(t('errors.enterWorkspacePassword'));
    setBusy(true);
    try {
      const s = await softglazeApi.db.unlock(password, remember);
      if (s && s.unlocked) { setPassword(''); setPhase('ready'); }
      else setErr(t('errors.dbStillLocked'));
    } catch (e) {
      if (e.code === 'DB_MISSING') {
        setCorrupted(true);
        setErr(t('errors.dbMissing'));
      } else if (e.code === 'DB_UNLOCK_FAILED') {
        setCorrupted(true);
        setErr(e.message || t('errors.dbUnlockFailed'));
      } else {
        setErr(e.message || t('errors.couldNotUnlockDb'));
      }
    } finally { setBusy(false); }
  }

  if (phase === 'ready') return children;
  if (phase === 'loading') {
    return <div className="h-screen w-full bg-background grid place-items-center"><Loader2 className="w-6 h-6 text-muted animate-spin" /></div>;
  }

  return (
    <div className="relative h-screen w-full bg-background text-foreground font-sans grid place-items-center p-6 overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-28 left-1/3 w-[26rem] h-[26rem] rounded-full bg-primary/12 blur-[130px] animate-float-slow" />
        <div className="absolute -bottom-24 right-1/4 w-96 h-96 rounded-full bg-accent/10 blur-[130px] animate-float-slower" />
      </div>
      <div className="relative w-full max-w-[420px] animate-fade-up rounded-2xl border border-border/80 bg-card/70 backdrop-blur-xl shadow-2xl shadow-black/40 px-7 py-8">
        <div className="flex items-center gap-2.5 mb-7">
          <img src="/logos/app-source-512.png" alt="SoftGlaze" className="w-9 h-9 object-contain drop-shadow-[0_2px_10px_rgba(59,130,246,0.45)]" draggable={false} />
          <span className="font-display font-semibold tracking-tight">SoftGlaze</span>
        </div>
        <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center mb-4"><Database className="w-5 h-5" /></div>
        <h1 className="font-display text-[20px] font-semibold tracking-tight">{t('db.title')}</h1>
        <p className="text-[12.5px] text-muted mt-1 mb-6">{t('db.subtitle')}</p>

        <label className="block text-[11px] font-medium text-muted mb-1.5"><KeyRound className="w-3 h-3 inline mr-1" />{t('db.workspacePassword')}</label>
        <input
          type="password"
          className={inputCls}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('db.passwordPlaceholder')}
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') unlock(); }}
        />

        <label className="flex items-center gap-2.5 mt-4 cursor-pointer select-none">
          <button
            type="button"
            role="checkbox"
            aria-checked={remember}
            onClick={() => setRemember((r) => !r)}
            className="w-[18px] h-[18px] rounded-[5px] border grid place-items-center transition-colors shrink-0"
            style={{ borderColor: remember ? 'var(--primary)' : 'var(--border)', background: remember ? 'var(--primary)' : 'transparent' }}
          >
            {remember && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
          </button>
          <span className="text-[12px] text-muted">{t('remember.label')}</span>
        </label>

        {err && (
          <div className="mt-3 flex items-start gap-2 text-[12px] text-red-400">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{err}</span>
          </div>
        )}

        <button disabled={busy} onClick={unlock} className="mt-6 w-full h-11 rounded-xl bg-gradient-to-b from-primary to-primary-hover text-white font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-60 shadow-glow transition-all duration-200 hover:shadow-[0_10px_28px_-8px_rgba(59,130,246,0.65)] hover:-translate-y-px active:translate-y-0">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>{t('db.unlock')} <Lock className="w-4 h-4" /></>}
        </button>

        {corrupted && (
          <p className="text-[11.5px] text-muted mt-4 leading-relaxed">
            {t('db.corrupted')}
          </p>
        )}
      </div>
    </div>
  );
}
