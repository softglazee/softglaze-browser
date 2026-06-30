import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderSync, Loader2, Check, AlertTriangle, Lock, RefreshCw, ShieldCheck, ChevronDown } from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';

// End-to-end encrypted cloud sync. The bucket is an EXTERNAL service you host;
// this card configures the endpoint + a sync passphrase, shows honest status,
// and runs a sync. Nothing is faked: with no endpoint it says "disabled", and a
// run only reports success when the main process confirms it.
function statusTone(s, t) {
  if (!s || !s.configured) return { color: '#9ca3af', label: t('sync.toneDisabled') };
  if (!s.unlocked) return { color: '#f59e0b', label: t('sync.toneLocked') };
  if (!s.enabled) return { color: '#9ca3af', label: t('sync.tonePaused') };
  return { color: '#10b981', label: t('sync.toneActive') };
}

export default function SyncSettings() {
  const { t } = useTranslation('cmpSettingsB');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showConfig, setShowConfig] = useState(false);

  const [baseUrl, setBaseUrl] = useState('');
  const [namespace, setNamespace] = useState('softglaze');
  const [token, setToken] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [unlockPass, setUnlockPass] = useState('');

  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const s = await softglazeApi.sync.status();
      setStatus(s);
      setEnabled(Boolean(s.enabled));
      setNamespace(s.namespace || 'softglaze');
      if (!s.configured) setShowConfig(true);
    } catch (e) { setErr(e.message || t('sync.errLoadStatus')); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  if (loading) return null;

  const tone = statusTone(status, t);

  async function saveConfig() {
    setErr(''); setMsg(''); setBusy('save');
    try {
      const payload = { baseUrl: baseUrl.trim(), namespace: (namespace.trim() || 'softglaze'), enabled };
      if (token) payload.token = token;
      if (passphrase) payload.passphrase = passphrase;
      const s = await softglazeApi.sync.configure(payload);
      setStatus(s); setToken(''); setPassphrase(''); setShowConfig(false);
      setMsg(s.unlocked ? t('sync.msgConfiguredUnlocked') : t('sync.msgSavedEnterPassphrase'));
    } catch (e) { setErr(e.message || t('sync.errSaveSettings')); }
    finally { setBusy(''); }
  }

  async function unlock() {
    setErr(''); setMsg(''); setBusy('unlock');
    try {
      const s = await softglazeApi.sync.configure({ passphrase: unlockPass });
      setStatus(s); setUnlockPass('');
      if (s.unlocked) setMsg(t('sync.msgUnlocked')); else setErr(t('sync.errUnlockCheckPassphrase'));
    } catch (e) { setErr(e.message || t('sync.errIncorrectPassphrase')); }
    finally { setBusy(''); }
  }

  async function runNow() {
    setErr(''); setMsg(''); setBusy('run');
    try {
      const r = await softglazeApi.sync.run({});
      if (r.ok) setMsg(t('sync.msgSynced', { pushed: r.pushed, pulled: r.pulled, created: r.created }) + (r.conflicts ? t('sync.msgSyncedConflicts', { count: r.conflicts }) : '') + '.');
      else if (r.locked) setErr(t('sync.errLockedEnterPassphrase'));
      else if (r.skipped) setErr(r.reason || t('sync.errNotActive'));
      else setErr(r.error || t('sync.errSyncFailed'));
      setStatus(await softglazeApi.sync.status());
    } catch (e) { setErr(e.message || t('sync.errSyncFailed')); }
    finally { setBusy(''); }
  }

  const inputCls = 'w-full h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary';
  const labelCls = 'block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2';

  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-lg grid place-items-center shrink-0" style={{ background: 'color-mix(in srgb, #14b8a6 14%, transparent)', border: '1px solid color-mix(in srgb, #14b8a6 24%, transparent)' }}><FolderSync className="w-5 h-5 text-teal-400" /></span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('sync.title')} <span className="text-[10px] font-medium text-muted-foreground align-middle">{t('sync.titleBadge')}</span></h3>
            <p className="text-xs text-muted-foreground">{t('sync.subtitle')}</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0" style={{ background: `color-mix(in srgb, ${tone.color} 14%, transparent)`, color: tone.color, border: `1px solid color-mix(in srgb, ${tone.color} 26%, transparent)` }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone.color }} />{tone.label}
        </span>
      </div>

      {/* Status line */}
      {status?.configured && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
          <div className="rounded-lg bg-elevated border border-border px-3 py-2"><div className="text-muted-foreground text-[10px] uppercase tracking-wider">{t('sync.statEndpoint')}</div><div className="text-foreground truncate font-mono">{status.endpointHost || '—'}</div></div>
          <div className="rounded-lg bg-elevated border border-border px-3 py-2"><div className="text-muted-foreground text-[10px] uppercase tracking-wider">{t('sync.statPending')}</div><div className="text-foreground">{t('sync.pendingProfiles', { count: status.pendingCount })}</div></div>
          <div className="rounded-lg bg-elevated border border-border px-3 py-2"><div className="text-muted-foreground text-[10px] uppercase tracking-wider">{t('sync.statLastSynced')}</div><div className="text-foreground">{status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : t('sync.never')}</div></div>
          <div className="rounded-lg bg-elevated border border-border px-3 py-2"><div className="text-muted-foreground text-[10px] uppercase tracking-wider">{t('sync.statNamespace')}</div><div className="text-foreground truncate font-mono">{status.namespace}</div></div>
        </div>
      )}

      {status?.lastError && (
        <div className="mt-3 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-[12px] text-red-400">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{status.lastError}</span>
        </div>
      )}

      {/* Not configured → explicit disabled notice */}
      {!status?.configured && !showConfig && (
        <div className="mt-4 px-3 py-2.5 rounded-lg bg-elevated border border-border text-[12px] text-muted-foreground">
          {t('sync.disabledNotice')}
        </div>
      )}

      {/* Configured & locked → unlock with passphrase */}
      {status?.configured && !status?.unlocked && (
        <div className="mt-4">
          <label className={labelCls}><Lock className="w-3 h-3 inline mr-1" />{t('sync.unlockLabel')}</label>
          <div className="flex items-center gap-2">
            <input type="password" className={inputCls + ' font-mono'} value={unlockPass} onChange={(e) => setUnlockPass(e.target.value)} placeholder={t('sync.unlockPlaceholder')} />
            <button onClick={unlock} disabled={busy === 'unlock' || !unlockPass} className="h-10 px-4 rounded-lg text-[12.5px] font-semibold bg-secondary hover:bg-secondary/70 text-foreground flex items-center gap-1.5 disabled:opacity-60">
              {busy === 'unlock' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} {t('sync.unlockBtn')}
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {status?.configured && status?.unlocked && status?.enabled && (
          <button onClick={runNow} disabled={busy === 'run'} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12.5px] font-semibold text-white bg-gradient-to-br from-teal-500 to-emerald-600 hover:from-teal-400 hover:to-emerald-500 shadow-lg shadow-teal-500/25 disabled:opacity-60">
            {busy === 'run' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} {t('sync.syncNow')}
          </button>
        )}
        <button onClick={() => setShowConfig((v) => !v)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] text-muted-foreground hover:bg-secondary">
          <ChevronDown className={`w-4 h-4 transition-transform ${showConfig ? 'rotate-180' : ''}`} /> {status?.configured ? t('sync.reconfigure') : t('sync.configure')}
        </button>
      </div>

      {/* Configure form */}
      {showConfig && (
        <div className="mt-4 pt-4 border-t border-border space-y-3.5">
          <div>
            <label className={labelCls}>{t('sync.endpointLabel')}</label>
            <input className={inputCls + ' font-mono'} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://sync.example.com/bucket" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t('sync.tokenLabel')}</label>
              <input type="password" className={inputCls + ' font-mono'} value={token} onChange={(e) => setToken(e.target.value)} placeholder={status?.hasToken ? t('sync.tokenPlaceholderSaved') : t('sync.tokenPlaceholder')} />
            </div>
            <div>
              <label className={labelCls}>{t('sync.namespaceLabel')}</label>
              <input className={inputCls + ' font-mono'} value={namespace} onChange={(e) => setNamespace(e.target.value)} placeholder="softglaze" />
            </div>
          </div>
          <div>
            <label className={labelCls}>{t('sync.passphraseLabel')}</label>
            <input type="password" className={inputCls + ' font-mono'} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder={status?.configured ? t('sync.passphrasePlaceholderConfigured') : t('sync.passphrasePlaceholder')} />
            <p className="text-[11px] text-amber-400 mt-1.5 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /> {t('sync.passphraseWarning')}</p>
          </div>
          <label className="flex items-center gap-2.5 text-[12.5px] text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-teal-500" />
            {t('sync.enableSync')}
          </label>
          <div className="flex items-center gap-2">
            <button onClick={saveConfig} disabled={busy === 'save'} className="h-9 px-5 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 text-white font-semibold text-[12.5px] flex items-center gap-2 disabled:opacity-60 shadow-lg shadow-teal-500/25">
              {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : t('sync.save')}
            </button>
            {status?.configured && <button onClick={() => setShowConfig(false)} className="h-9 px-3 rounded-lg text-[12.5px] text-muted-foreground hover:bg-secondary">{t('sync.cancel')}</button>}
          </div>
        </div>
      )}

      {msg && <p className="mt-3 text-[12px] text-emerald-400 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" />{msg}</p>}
      {err && <p className="mt-3 text-[12px] text-red-400">{err}</p>}
    </div>
  );
}
