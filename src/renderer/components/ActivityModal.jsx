import React, { useState, useEffect, useCallback } from 'react';
import { History, X, Loader2, Rocket } from 'lucide-react';
import Button from '@/components/ui/Button.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { formatDateTime } from '@/lib/utils.js';

const ACTION_LABEL = { launch: 'Launched' };

export default function ActivityModal({ profileId, profileName, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await softglazeApi.profiles.activity(profileId)); }
    catch (err) { setError(err.message || 'Failed to load activity.'); }
    finally { setLoading(false); }
  }, [profileId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col rounded-xl border border-[#2d3039] bg-[#1e2025] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2d3039]">
          <div className="flex items-center gap-2.5">
            <History className="w-5 h-5 text-blue-400" />
            <div>
              <h2 className="text-white font-medium text-[15px] leading-tight">Activity</h2>
              <p className="text-[12px] text-[#9ca3af] leading-tight">{profileName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded hover:bg-[#2a2d35] transition"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
          ) : error ? (
            <div className="rounded-lg border border-red-900/70 bg-red-950/40 px-3 py-2 text-[13px] text-red-200">{error}</div>
          ) : data ? (
            <>
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="rounded-lg border border-[#2d3039] bg-[#181a1f] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-[#9ca3af]">Last used</div>
                  <div className="text-[13px] text-white mt-1">{data.lastUsedAt ? formatDateTime(data.lastUsedAt) : 'Never'}</div>
                </div>
                <div className="rounded-lg border border-[#2d3039] bg-[#181a1f] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-[#9ca3af]">Launches</div>
                  <div className="text-[13px] text-white mt-1">{data.launchCount}</div>
                </div>
              </div>
              <h3 className="text-[12px] uppercase tracking-wide text-[#9ca3af] mb-2">History</h3>
              {data.logs.length === 0 ? (
                <p className="text-[13px] text-[#9ca3af] py-4">No recorded activity yet. Launch this profile to start tracking.</p>
              ) : (
                <div className="space-y-2">
                  {data.logs.map((l) => (
                    <div key={l.id} className="flex items-center gap-3 rounded-lg border border-[#2d3039] bg-[#181a1f] px-3 py-2">
                      <Rocket className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] text-white">{ACTION_LABEL[l.action] || l.action}</div>
                        {l.detail && <div className="text-[11px] text-[#9ca3af] truncate">{l.detail}</div>}
                      </div>
                      <div className="text-[11px] text-[#9ca3af] shrink-0">{formatDateTime(l.createdAt)}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>

        <div className="flex items-center justify-end px-5 py-4 border-t border-[#2d3039]">
          <Button size="sm" onClick={onClose} className="bg-[#2a2d35] hover:bg-[#3b3e48] text-white border border-[#3b3e48]">Close</Button>
        </div>
      </div>
    </div>
  );
}