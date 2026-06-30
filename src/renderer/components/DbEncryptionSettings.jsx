import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, Lock, KeyRound, ShieldCheck, AlertTriangle, Loader2, Check, ChevronDown } from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';

// Full-database encryption at rest (Phase 6). Honest by design: it never claims
// runtime protection it doesn't provide, it's OFF until the user opts in, and
// enabling forces an explicit acknowledgement that a lost password is unrecoverable.
export default function DbEncryptionSettings() {
  const { t } = useTranslation('cmpSettingsB');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false); // expand the enable/disable panel

  const [password, setPassword] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const s = await softglazeApi.db.encryptionStatus();
      setStatus(s);
    } catch (e) { setErr(e.message || t('dbEncryption.errReadStatus')); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  if (loading) return null;

  const enabled = Boolean(status?.enabled);

  async function enable() {
    setErr(''); setMsg('');
    if (!password) return setErr(t('dbEncryption.errEnterPassword'));
    if (!ack) return setErr(t('dbEncryption.errConfirmRisk'));
    setBusy('enable');
    try {
      const s = await softglazeApi.db.enableEncryption({ password, confirm: true });
      setStatus(s); setPassword(''); setAck(false); setOpen(false);
      setMsg(t('dbEncryption.msgEnabled'));
    } catch (e) {
      setErr(e.message || t('dbEncryption.errEnable'));
    } finally { setBusy(''); }
  }

  async function disable() {
    setErr(''); setMsg('');
    if (!password) return setErr(t('dbEncryption.errEnterPasswordConfirm'));
    setBusy('disable');
    try {
      const s = await softglazeApi.db.disableEncryption({ password });
      setStatus(s); setPassword(''); setOpen(false);
      setMsg(t('dbEncryption.msgDisabled'));
    } catch (e) {
      setErr(e.message || t('dbEncryption.errDisable'));
    } finally { setBusy(''); }
  }

  const inputCls = 'w-full h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary font-mono';
  const labelCls = 'block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2';
  const tone = enabled ? { color: '#10b981', label: t('dbEncryption.toneEncrypted') } : { color: '#9ca3af', label: t('dbEncryption.toneOff') };

  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-lg grid place-items-center shrink-0" style={{ background: 'color-mix(in srgb, #6366f1 14%, transparent)', border: '1px solid color-mix(in srgb, #6366f1 24%, transparent)' }}><Database className="w-5 h-5 text-indigo-400" /></span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('dbEncryption.title')} <span className="text-[10px] font-medium text-muted-foreground align-middle">{t('dbEncryption.titleBadge')}</span></h3>
            <p className="text-xs text-muted-foreground">{t('dbEncryption.subtitle')}</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0" style={{ background: `color-mix(in srgb, ${tone.color} 14%, transparent)`, color: tone.color, border: `1px solid color-mix(in srgb, ${tone.color} 26%, transparent)` }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone.color }} />{tone.label}
        </span>
      </div>

      {/* Honest scope statement — never overclaim */}
      <div className="mt-4 px-3 py-2.5 rounded-lg bg-elevated border border-border text-[12px] text-muted-foreground leading-relaxed">
        {t('dbEncryption.scopeBefore')} <span className="text-foreground">{t('dbEncryption.scopeRunningUnlocked')}</span>{t('dbEncryption.scopeAfter')}
      </div>

      {!enabled && (
        <div className="mt-3 flex items-start gap-2 px-3 py-2.5 rounded-lg text-[12px]" style={{ background: 'color-mix(in srgb, #6366f1 10%, transparent)', border: '1px solid color-mix(in srgb, #6366f1 22%, transparent)' }}>
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-indigo-400" />
          <span className="text-muted-foreground"><span className="text-foreground font-medium">{t('dbEncryption.recommendedLabel')}</span> {t('dbEncryption.recommendedBefore')} <span className="text-foreground">{t('dbEncryption.recommendedProxyPasswords')}</span>{t('dbEncryption.recommendedAfter')}</span>
        </div>
      )}

      {enabled && (
        <div className="mt-3 flex items-start gap-2 px-3 py-2.5 rounded-lg text-[12px]" style={{ background: 'color-mix(in srgb, #10b981 10%, transparent)', color: '#10b981', border: '1px solid color-mix(in srgb, #10b981 22%, transparent)' }}>
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{t('dbEncryption.enabledNotice')}</span>
        </div>
      )}

      <div className="mt-4">
        <button onClick={() => { setOpen((v) => !v); setErr(''); setMsg(''); }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-semibold text-foreground bg-secondary hover:bg-secondary/70">
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          {enabled ? t('dbEncryption.turnOff') : t('dbEncryption.turnOn')}
        </button>
      </div>

      {open && !enabled && (
        <div className="mt-4 pt-4 border-t border-border space-y-3.5">
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[12px] text-amber-400">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span><strong>{t('dbEncryption.readFirstLabel')}</strong> {t('dbEncryption.readFirstBefore')} <strong>{t('dbEncryption.readFirstCannotRecover')}</strong>{t('dbEncryption.readFirstAfter')}</span>
          </div>
          <div>
            <label className={labelCls}><KeyRound className="w-3 h-3 inline mr-1" />{t('dbEncryption.workspacePasswordLabel')}</label>
            <input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('dbEncryption.workspacePasswordPlaceholder')} />
          </div>
          <label className="flex items-start gap-2.5 text-[12.5px] text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={Boolean(ack)} onChange={(e) => setAck(e.target.checked)} className="accent-indigo-500 mt-0.5" />
            <span>{t('dbEncryption.ackUnrecoverable')}</span>
          </label>
          <button onClick={enable} disabled={busy === 'enable'} className="h-9 px-5 rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-600 text-white font-semibold text-[12.5px] inline-flex items-center gap-2 disabled:opacity-60 shadow-lg shadow-indigo-500/25">
            {busy === 'enable' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />} {t('dbEncryption.encryptBtn')}
          </button>
        </div>
      )}

      {open && enabled && (
        <div className="mt-4 pt-4 border-t border-border space-y-3.5">
          <p className="text-[12px] text-muted-foreground">{t('dbEncryption.disableIntro')}</p>
          <div>
            <label className={labelCls}><KeyRound className="w-3 h-3 inline mr-1" />{t('dbEncryption.workspacePasswordLabel')}</label>
            <input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('dbEncryption.workspacePasswordPlaceholder')} />
          </div>
          <button onClick={disable} disabled={busy === 'disable'} className="h-9 px-5 rounded-lg bg-secondary hover:bg-secondary/70 text-foreground font-semibold text-[12.5px] inline-flex items-center gap-2 disabled:opacity-60">
            {busy === 'disable' ? <Loader2 className="w-4 h-4 animate-spin" /> : null} {t('dbEncryption.turnOff')}
          </button>
        </div>
      )}

      {msg && <p className="mt-3 text-[12px] text-emerald-400 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" />{msg}</p>}
      {err && <p className="mt-3 text-[12px] text-red-400">{err}</p>}
    </div>
  );
}
