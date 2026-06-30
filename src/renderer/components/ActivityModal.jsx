import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { History, X, Loader2, Rocket } from 'lucide-react';
import { useDialog } from '@/lib/useDialog.js';
import Button from '@/components/ui/Button.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { formatDateTime } from '@/lib/utils.js';

export default function ActivityModal({ profileId, profileName, onClose }) {
  const { t } = useTranslation('cmpModalsA');
  const ACTION_LABEL = { launch: t('activity.actionLaunch') };
  const { dialogRef } = useDialog({ onClose });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await softglazeApi.profiles.activity(profileId)); }
    catch (err) { setError(err.message || t('activity.loadFailed')); }
    finally { setLoading(false); }
  }, [profileId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('activity.title')} tabIndex={-1} className="w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col rounded border border-border bg-card shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-surface">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-1.5 rounded border border-primary/20">
              <History className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-foreground font-bold text-sm leading-tight tracking-wide uppercase">{t('activity.title')}</h2>
              <p className="text-xs text-muted leading-tight mt-0.5">{profileName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-muted hover:text-foreground rounded hover:bg-muted-dark transition"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <span className="text-xs font-medium">{t('activity.fetching')}</span>
            </div>
          ) : error ? (
            <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
          ) : data ? (
            <div className="animate-in fade-in slide-in-from-bottom-2">
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="rounded border border-border bg-background p-4 shadow-sm">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">{t('activity.lastUsed')}</div>
                  <div className="text-sm font-semibold text-foreground">{data.lastUsedAt ? formatDateTime(data.lastUsedAt) : t('activity.never')}</div>
                </div>
                <div className="rounded border border-border bg-background p-4 shadow-sm">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">{t('activity.totalLaunches')}</div>
                  <div className="text-sm font-semibold text-foreground">{t('activity.launchTimes', { count: data.launchCount })}</div>
                </div>
              </div>

              <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted mb-3">{t('activity.recentEvents')}</h3>

              {data.logs.length === 0 ? (
                <div className="text-xs text-muted py-6 px-4 bg-background border border-border border-dashed rounded text-center">
                  {t('activity.empty')}
                </div>
              ) : (
                <div className="space-y-3">
                  {data.logs.map((l) => (
                    <div key={l.id} className="flex items-center gap-4 rounded border border-border bg-background px-4 py-3 shadow-sm hover:border-muted-dark transition-colors">
                      <Rocket className="w-4 h-4 text-emerald-400 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-foreground">{ACTION_LABEL[l.action] || l.action}</div>
                        {l.detail && <div className="text-xs text-muted truncate mt-0.5">{l.detail}</div>}
                      </div>
                      <div className="text-[10px] font-mono font-medium text-muted bg-surface px-2 py-1 rounded border border-border shrink-0">
                        {formatDateTime(l.createdAt)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end px-5 py-4 border-t border-border bg-surface">
          <Button size="sm" variant="secondary" onClick={onClose}>{t('activity.close')}</Button>
        </div>
      </div>
    </div>
  );
}