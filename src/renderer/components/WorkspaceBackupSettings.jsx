import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DatabaseBackup, Download, ArchiveRestore, AlertTriangle, Loader2, Check } from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';

// Encrypted, portable backup of the whole workspace (database + settings) into a
// single passphrase-protected .sgzw file, with a restore that verifies the file
// before it touches the live database.
export default function WorkspaceBackupSettings() {
  const { t } = useTranslation('cmpSettingsB');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const [backupPass, setBackupPass] = useState('');
  const [restorePass, setRestorePass] = useState('');
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { setStatus(await softglazeApi.db.encryptionStatus()); }
    catch (e) { /* status is best-effort here */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return null;

  async function backup() {
    setErr(''); setMsg('');
    if (backupPass.length < 6) return setErr(t('workspaceBackup.errPasswordMin'));
    setBusy('backup');
    try {
      const r = await softglazeApi.workspace.backup({ password: backupPass });
      if (r.cancelled) { setMsg(''); }
      else if (r.ok) {
        setBackupPass('');
        setMsg(t('workspaceBackup.msgSaved', { path: r.path, kb: (r.dbBytes / 1024).toFixed(0), count: r.settingsCount }));
        load();
      }
    } catch (e) { setErr(e.message || t('workspaceBackup.errBackupFailed')); }
    finally { setBusy(''); }
  }

  async function restore() {
    setErr(''); setMsg('');
    if (!restorePass) return setErr(t('workspaceBackup.errEnterPassword'));
    if (!confirmRestore) return setErr(t('workspaceBackup.errConfirmRestore'));
    setBusy('restore');
    try {
      const r = await softglazeApi.workspace.restore({ password: restorePass });
      if (r.cancelled) { setMsg(''); }
      else if (r.ok) {
        setRestorePass(''); setConfirmRestore(false);
        setMsg(t('workspaceBackup.msgRestored'));
      }
    } catch (e) { setErr(e.message || t('workspaceBackup.errRestoreFailed')); }
    finally { setBusy(''); }
  }

  const inputCls = 'w-full h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary font-mono';
  const labelCls = 'block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2';

  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-lg grid place-items-center shrink-0" style={{ background: 'color-mix(in srgb, #0ea5e9 14%, transparent)', border: '1px solid color-mix(in srgb, #0ea5e9 24%, transparent)' }}><DatabaseBackup className="w-5 h-5 text-sky-400" /></span>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('workspaceBackup.title')}</h3>
          <p className="text-xs text-muted-foreground">{t('workspaceBackup.subtitle')}</p>
        </div>
      </div>

      {status?.lastBackupAt && (
        <p className="mt-3 text-[12px] text-muted-foreground">{t('workspaceBackup.lastBackup')} <span className="text-foreground">{new Date(status.lastBackupAt).toLocaleString()}</span></p>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Backup */}
        <div className="rounded-lg bg-elevated border border-border p-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground mb-3"><Download className="w-4 h-4 text-sky-400" /> {t('workspaceBackup.createTitle')}</div>
          <label className={labelCls}>{t('workspaceBackup.backupPasswordLabel')}</label>
          <input type="password" className={inputCls} value={backupPass} onChange={(e) => setBackupPass(e.target.value)} placeholder={t('workspaceBackup.backupPasswordPlaceholder')} />
          <p className="text-[11px] text-muted-foreground mt-1.5">{t('workspaceBackup.backupPasswordHint')}</p>
          <button onClick={backup} disabled={busy === 'backup'} className="mt-3 h-9 px-5 rounded-lg bg-gradient-to-br from-sky-500 to-cyan-600 text-white font-semibold text-[12.5px] inline-flex items-center gap-2 disabled:opacity-60 shadow-lg shadow-sky-500/25">
            {busy === 'backup' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} {t('workspaceBackup.backupBtn')}
          </button>
        </div>

        {/* Restore */}
        <div className="rounded-lg bg-elevated border border-border p-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground mb-3"><ArchiveRestore className="w-4 h-4 text-amber-400" /> {t('workspaceBackup.restoreTitle')}</div>
          <label className={labelCls}>{t('workspaceBackup.backupPasswordLabel')}</label>
          <input type="password" className={inputCls} value={restorePass} onChange={(e) => setRestorePass(e.target.value)} placeholder={t('workspaceBackup.restorePasswordPlaceholder')} />
          <label className="flex items-start gap-2.5 text-[12px] text-muted-foreground cursor-pointer mt-3">
            <input type="checkbox" checked={confirmRestore} onChange={(e) => setConfirmRestore(e.target.checked)} className="accent-amber-500 mt-0.5" />
            <span>{t('workspaceBackup.confirmRestoreLabel')}</span>
          </label>
          <button onClick={restore} disabled={busy === 'restore'} className="mt-3 h-9 px-5 rounded-lg bg-secondary hover:bg-secondary/70 text-foreground font-semibold text-[12.5px] inline-flex items-center gap-2 disabled:opacity-60">
            {busy === 'restore' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArchiveRestore className="w-4 h-4" />} {t('workspaceBackup.restoreBtn')}
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-elevated border border-border text-[12px] text-muted-foreground">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
        <span>{t('workspaceBackup.footerNote')}</span>
      </div>

      {msg && <p className="mt-3 text-[12px] text-emerald-400 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" />{msg}</p>}
      {err && <p className="mt-3 text-[12px] text-red-400">{err}</p>}
    </div>
  );
}
