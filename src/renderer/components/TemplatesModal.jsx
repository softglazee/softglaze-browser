import React, { useState, useEffect, useCallback } from 'react';
import { LayoutTemplate, X, Loader2, Trash2, Plus, Save } from 'lucide-react';
import Button from '@/components/ui/Button.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

export default function TemplatesModal({ onClose, onProfilesChanged }) {
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
      setError(err.message || 'Failed to load templates.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const reset = () => { setError(''); setInfo(''); };

  const handleSave = async () => {
    reset();
    if (!saveSrcId) { setError('Pick a profile to snapshot.'); return; }
    if (!saveName.trim()) { setError('Give the template a name.'); return; }
    setBusy(true);
    try {
      await softglazeApi.templates.save(Number(saveSrcId), saveName.trim());
      setSaveName(''); setSaveSrcId('');
      setInfo('Template saved.');
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const handleDelete = async (tpl) => {
    if (!window.confirm(`Delete template "${tpl.name}"?`)) return;
    reset(); setBusy(true);
    try { await softglazeApi.templates.delete(tpl.id); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const handleCreate = async (tpl) => {
    reset();
    const title = (titles[tpl.id] || tpl.name).trim();
    if (!title) { setError('Enter a name for the new profile.'); return; }
    setBusy(true);
    try {
      await softglazeApi.templates.createProfile(tpl.id, title);
      setTitles((prev) => ({ ...prev, [tpl.id]: '' }));
      setInfo(`Created profile "${title}" from "${tpl.name}".`);
      if (onProfilesChanged) await onProfilesChanged();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-xl max-h-[88vh] overflow-hidden flex flex-col rounded-xl border border-[#2d3039] bg-[#1e2025] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2d3039]">
          <div className="flex items-center gap-2.5">
            <LayoutTemplate className="w-5 h-5 text-blue-400" />
            <h2 className="text-white font-medium text-[15px]">Profile Templates</h2>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded hover:bg-[#2a2d35] transition"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {error && <div className="rounded-lg border border-red-900/70 bg-red-950/40 px-3 py-2 text-[13px] text-red-200">{error}</div>}
          {info && <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-[13px] text-emerald-300">{info}</div>}

          {/* Save a profile as a template */}
          <div className="rounded-lg border border-[#2d3039] bg-[#181a1f] p-4">
            <h3 className="text-[13px] font-medium text-white mb-3 flex items-center gap-2"><Save className="w-4 h-4 text-[#9ca3af]" /> Save a profile as a template</h3>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={saveSrcId}
                onChange={(e) => setSaveSrcId(e.target.value)}
                className="flex-1 bg-[#1e2025] border border-[#3b3e48] rounded-md px-2 py-2 text-[13px] text-white outline-none focus:border-blue-500"
              >
                <option value="">Select a profile…</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
              <input
                type="text"
                placeholder="Template name"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                className="flex-1 bg-[#1e2025] border border-[#3b3e48] rounded-md px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
              />
              <Button size="sm" disabled={busy} onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white shrink-0">Save</Button>
            </div>
          </div>

          {/* Existing templates */}
          <div>
            <h3 className="text-[13px] font-medium text-white mb-3">Templates</h3>
            {loading ? (
              <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
            ) : templates.length === 0 ? (
              <p className="text-[13px] text-[#9ca3af] py-4">No templates yet. Snapshot a profile above to create one.</p>
            ) : (
              <div className="space-y-2">
                {templates.map((tpl) => (
                  <div key={tpl.id} className="rounded-lg border border-[#2d3039] bg-[#181a1f] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-white truncate">{tpl.name}</div>
                        <div className="text-[11px] text-[#9ca3af] mt-0.5">
                          {[tpl.summary?.os, tpl.summary?.browserCore, tpl.summary?.resolution, tpl.summary?.hasProxy ? 'proxy' : null].filter(Boolean).join(' · ') || 'Saved config'}
                        </div>
                      </div>
                      <button onClick={() => handleDelete(tpl)} className="p-1 text-slate-400 hover:text-red-400 rounded hover:bg-red-900/30 transition shrink-0"><Trash2 className="w-4 h-4" /></button>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <input
                        type="text"
                        placeholder={`${tpl.name} profile`}
                        value={titles[tpl.id] || ''}
                        onChange={(e) => setTitles((prev) => ({ ...prev, [tpl.id]: e.target.value }))}
                        className="flex-1 bg-[#1e2025] border border-[#3b3e48] rounded-md px-3 py-1.5 text-[12px] text-white outline-none focus:border-blue-500"
                      />
                      <Button size="sm" disabled={busy} onClick={() => handleCreate(tpl)} className="bg-[#2a2d35] hover:bg-[#3b3e48] text-white border border-[#3b3e48] shrink-0">
                        <Plus className="w-3.5 h-3.5 mr-1.5" /> New profile
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end px-5 py-4 border-t border-[#2d3039]">
          <Button size="sm" onClick={onClose} className="bg-[#2a2d35] hover:bg-[#3b3e48] text-white border border-[#3b3e48]">Close</Button>
        </div>
      </div>
    </div>
  );
}