import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutTemplate, X, Loader2, Trash2, Plus, Save } from 'lucide-react';
import { useDialog } from '@/lib/useDialog.js';
import Button from '@/components/ui/Button.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

export default function TemplatesModal({ onClose, onProfilesChanged }) {
  const { t } = useTranslation('cmpModalsB');
  const { dialogRef } = useDialog({ onClose });
  const [templates, setTemplates] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const [saveSrcId, setSaveSrcId] = useState('');
  const [saveName, setSaveName] = useState('');
  const [titles, setTitles] = useState({}); // templateId -> new profile title

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [t, p] = await Promise.all([softglazeApi.templates.list(), softglazeApi.profiles.list({})]);
      setTemplates(t);
      setProfiles(p);
    } catch (err) {
      setError(err.message || t('templates.errorLoad'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const reset = () => { setError(''); setInfo(''); };

  const handleSave = async () => {
    reset();
    if (!saveSrcId) { setError(t('templates.errorPickProfile')); return; }
    if (!saveName.trim()) { setError(t('templates.errorNameRequired')); return; }
    setBusy(true);
    try {
      await softglazeApi.templates.save(Number(saveSrcId), saveName.trim());
      setSaveName(''); setSaveSrcId('');
      setInfo(t('templates.infoSaved'));
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const handleDelete = async (tpl) => {
    if (!window.confirm(t('templates.deleteConfirm', { name: tpl.name }))) return;
    reset(); setBusy(true);
    try { await softglazeApi.templates.delete(tpl.id); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const handleCreate = async (tpl) => {
    reset();
    const title = (titles[tpl.id] || tpl.name).trim();
    if (!title) { setError(t('templates.errorProfileName')); return; }
    setBusy(true);
    try {
      await softglazeApi.templates.createProfile(tpl.id, title);
      setTitles((prev) => ({ ...prev, [tpl.id]: '' }));
      setInfo(t('templates.infoCreated', { title, name: tpl.name }));
      if (onProfilesChanged) await onProfilesChanged();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('templates.dialogLabel')} tabIndex={-1} className="w-full max-w-xl max-h-[88vh] overflow-hidden flex flex-col rounded-xl border border-border bg-popover shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <LayoutTemplate className="w-5 h-5 text-blue-400" />
            <h2 className="text-foreground font-medium text-[15px]">{t('templates.title')}</h2>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-secondary transition"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {error && <div className="rounded-lg border border-red-900/70 bg-red-950/40 px-3 py-2 text-[13px] text-red-200">{error}</div>}
          {info && <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-[13px] text-emerald-300">{info}</div>}

          {/* Save a profile as a template */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-[13px] font-medium text-foreground mb-3 flex items-center gap-2"><Save className="w-4 h-4 text-muted-foreground" /> {t('templates.saveSectionTitle')}</h3>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={saveSrcId}
                onChange={(e) => setSaveSrcId(e.target.value)}
                className="flex-1 bg-secondary border border-border rounded-md px-2 py-2 text-[13px] text-foreground outline-none focus:border-blue-500"
              >
                <option value="">{t('templates.selectProfile')}</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
              <input
                type="text"
                placeholder={t('templates.templateNamePlaceholder')}
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                className="flex-1 bg-secondary border border-border rounded-md px-3 py-2 text-[13px] text-foreground outline-none focus:border-blue-500"
              />
              <Button size="sm" disabled={busy} onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white shrink-0">{t('templates.saveButton')}</Button>
            </div>
          </div>

          {/* Existing templates */}
          <div>
            <h3 className="text-[13px] font-medium text-foreground mb-3">{t('templates.listTitle')}</h3>
            {loading ? (
              <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
            ) : templates.length === 0 ? (
              <p className="text-[13px] text-muted-foreground py-4">{t('templates.empty')}</p>
            ) : (
              <div className="space-y-2">
                {templates.map((tpl) => (
                  <div key={tpl.id} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-foreground truncate">{tpl.name}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {[tpl.summary?.os, tpl.summary?.browserCore, tpl.summary?.resolution, tpl.summary?.hasProxy ? t('templates.proxyTag') : null].filter(Boolean).join(' · ') || t('templates.savedConfig')}
                        </div>
                      </div>
                      <button onClick={() => handleDelete(tpl)} className="p-1 text-muted-foreground hover:text-red-400 rounded hover:bg-red-900/30 transition shrink-0"><Trash2 className="w-4 h-4" /></button>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <input
                        type="text"
                        placeholder={t('templates.newProfilePlaceholder', { name: tpl.name })}
                        value={titles[tpl.id] || ''}
                        onChange={(e) => setTitles((prev) => ({ ...prev, [tpl.id]: e.target.value }))}
                        className="flex-1 bg-secondary border border-border rounded-md px-3 py-1.5 text-[12px] text-foreground outline-none focus:border-blue-500"
                      />
                      <Button size="sm" disabled={busy} onClick={() => handleCreate(tpl)} className="bg-secondary hover:bg-elevated text-foreground border border-border shrink-0">
                        <Plus className="w-3.5 h-3.5 mr-1.5" /> {t('templates.newProfileButton')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end px-5 py-4 border-t border-border">
          <Button size="sm" onClick={onClose} className="bg-secondary hover:bg-elevated text-foreground border border-border">{t('templates.close')}</Button>
        </div>
      </div>
    </div>
  );
}