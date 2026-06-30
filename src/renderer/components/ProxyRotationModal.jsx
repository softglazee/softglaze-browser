import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Shuffle, X, Loader2, Check, Repeat, Dices } from 'lucide-react';
import { useDialog } from '@/lib/useDialog.js';
import Button from '@/components/ui/Button.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

// Configure a proxy-rotation pool for one profile. The profile keeps its own
// browser data dir (cookies persist) while the exit IP rotates across the pool.
export default function ProxyRotationModal({ profileId, profileName, onClose }) {
  const { t } = useTranslation('cmpModalsB');
  const { dialogRef } = useDialog({ onClose });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState('round-robin');
  const [selected, setSelected] = useState(() => new Set());
  const [proxies, setProxies] = useState([]);

  useEffect(() => {
    let alive = true;
    softglazeApi.proxies.getRotation(profileId)
      .then((cfg) => {
        if (!alive) return;
        setEnabled(cfg.enabled);
        setMode(cfg.mode);
        setSelected(new Set(cfg.proxyIds));
        setProxies(cfg.proxies);
      })
      .catch((e) => alive && setError(e.message || t('proxyRotation.errorLoad')))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [profileId]);

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const save = async () => {
    setSaving(true); setError(''); setInfo('');
    try {
      await softglazeApi.proxies.setRotation({
        id: profileId,
        enabled,
        mode,
        proxyIds: Array.from(selected)
      });
      setInfo(t('proxyRotation.infoSaved'));
    } catch (e) { setError(e.message || t('proxyRotation.errorSave')); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('proxyRotation.dialogLabel')} tabIndex={-1} className="w-full max-w-lg max-h-[88vh] overflow-hidden flex flex-col rounded border border-border bg-card shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-surface">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-1.5 rounded border border-primary/20">
              <Shuffle className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-foreground font-bold text-sm leading-tight tracking-wide uppercase">{t('proxyRotation.title')}</h2>
              <p className="text-xs text-muted leading-tight mt-0.5">{profileName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-muted hover:text-foreground rounded hover:bg-muted-dark transition"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <p className="text-xs text-muted leading-relaxed bg-surface p-3 rounded border border-border">
            {t('proxyRotation.intro')}
          </p>

          {error && <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}
          {info && <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400 font-medium flex items-center gap-2"><Check className="w-4 h-4" /> {info}</div>}

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted py-8 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> {t('proxyRotation.loading')}</div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setEnabled((v) => !v)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors ${enabled ? 'bg-primary' : 'bg-muted-dark'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
                <span className="text-sm font-medium text-foreground">{enabled ? t('proxyRotation.enabled') : t('proxyRotation.disabled')}</span>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode('round-robin')}
                  className={`flex-1 flex items-center justify-center gap-2 rounded border px-3 py-2 text-sm transition ${mode === 'round-robin' ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted hover:text-foreground'}`}
                >
                  <Repeat className="w-4 h-4" /> {t('proxyRotation.roundRobin')}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('random')}
                  className={`flex-1 flex items-center justify-center gap-2 rounded border px-3 py-2 text-sm transition ${mode === 'random' ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted hover:text-foreground'}`}
                >
                  <Dices className="w-4 h-4" /> {t('proxyRotation.random')}
                </button>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted">{t('proxyRotation.pool', { count: selected.size })}</span>
                </div>
                {proxies.length === 0 ? (
                  <p className="text-sm text-muted py-6 text-center">{t('proxyRotation.noProxies')}</p>
                ) : (
                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {proxies.map((p) => (
                      <label key={p.id} className={`flex items-center gap-3 rounded border px-3 py-2 cursor-pointer transition ${selected.has(p.id) ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-surface'}`}>
                        <input type="checkbox" className="h-4 w-4 accent-primary" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                        <span className="text-sm text-foreground truncate flex-1">{p.name}</span>
                        <span className="text-xs font-mono text-muted">{p.host}:{p.port}</span>
                        {p.lastCountry && <span className="text-[10px] uppercase tracking-wider text-muted bg-surface border border-border rounded px-1.5 py-0.5">{p.lastCountry}</span>}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border bg-surface">
          <Button size="sm" variant="secondary" onClick={onClose}>{t('proxyRotation.close')}</Button>
          <Button size="sm" variant="primary" disabled={saving || loading} onClick={save}>
            {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null} {t('proxyRotation.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
