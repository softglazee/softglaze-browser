import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, X, Loader2, AlertTriangle, HardDrive } from 'lucide-react';
import Button from '@/components/ui/Button.jsx';
import { useDialog } from '@/lib/useDialog.js';
import { softglazeApi } from '@/lib/softglazeApi.js';

function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

// Confirm moving a profile to Trash, with the choice to also wipe its on-disk
// browser data (cookies / cache / logins) now. Shows the storage size first so
// the decision is informed.
export default function DeleteProfileModal({ profile, onClose, onDeleted }) {
  const { t } = useTranslation('cmpModalsA');
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [wipe, setWipe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { dialogRef } = useDialog({ onClose });

  useEffect(() => {
    let alive = true;
    softglazeApi.profiles.storageInfo(profile.id)
      .then((d) => alive && setInfo(d))
      .catch(() => alive && setInfo({ exists: false, bytes: 0, files: 0 }))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [profile.id]);

  const confirm = async () => {
    setBusy(true); setError('');
    try {
      await softglazeApi.profiles.delete(profile.id, { removeLocalData: wipe });
      onDeleted();
    } catch (e) { setError(e.message || t('deleteProfile.failed')); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('deleteProfile.title')} tabIndex={-1} className="w-full max-w-md rounded border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-surface">
          <div className="flex items-center gap-3">
            <div className="bg-red-500/10 p-1.5 rounded border border-red-500/20"><Trash2 className="w-5 h-5 text-red-400" /></div>
            <h2 className="text-foreground font-bold text-sm uppercase tracking-wide">{t('deleteProfile.title')}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-muted hover:text-foreground rounded hover:bg-muted-dark transition"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-foreground">{t('deleteProfile.confirmBefore')} <strong className="text-foreground">{profile.title}</strong> {t('deleteProfile.confirmAfter')}</p>

          <div className="rounded border border-border bg-surface px-4 py-3 text-sm flex items-center gap-3">
            <HardDrive className="w-4 h-4 text-muted shrink-0" />
            {loading ? (
              <span className="text-muted flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('deleteProfile.readingData')}</span>
            ) : info && info.exists ? (
              <span className="text-foreground">{t('deleteProfile.storedData')} <strong>{formatBytes(info.bytes)}</strong> <span className="text-muted">{t('deleteProfile.storedFiles', { count: info.files, files: info.files.toLocaleString() })}</span></span>
            ) : (
              <span className="text-muted">{t('deleteProfile.noData')}</span>
            )}
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={wipe} onChange={(e) => setWipe(e.target.checked)} className="h-4 w-4 mt-0.5 accent-red-500" />
            <span className="text-sm text-foreground">
              {t('deleteProfile.alsoDelete')}
              <span className="block text-xs text-muted mt-0.5">{t('deleteProfile.alsoDeleteHint')}</span>
            </span>
          </label>

          {wipe && (
            <div className="flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {t('deleteProfile.irreversible')}
            </div>
          )}

          {error && <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border bg-surface">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>{t('deleteProfile.cancel')}</Button>
          <Button size="sm" variant="danger" onClick={confirm} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1.5" />}
            {wipe ? t('deleteProfile.confirmWipe') : t('deleteProfile.confirmMove')}
          </Button>
        </div>
      </div>
    </div>
  );
}
