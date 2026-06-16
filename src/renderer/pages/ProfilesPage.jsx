import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Edit, Play, Plus, RefreshCcw, Search, Trash2, ArrowLeft, Settings2, Globe, Monitor, ShieldCheck, Cpu } from 'lucide-react';
import EmptyState from '@/components/EmptyState.jsx';
import PageHeader from '@/components/PageHeader.jsx';
import Badge from '@/components/ui/Badge.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card, CardContent } from '@/components/ui/Card.jsx';
import Input from '@/components/ui/Input.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { formatDateTime, safeText } from '@/lib/utils.js';

const initialProfileData = {
  id: null,
  name: '',
  browserCore: 'SunBrowser',
  browserVersion: 'Chrome 148',
  os: 'Windows',
  osVersion: 'Windows 10',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  group: 'Ungrouped',
  tags: '',
  cookie: '',
  remark: '',
  proxySetting: 'Custom',
  proxyType: 'HTTP',
  proxyString: '',
  ipChecker: 'IP2Location',
  webrtc: 'Disabled',
  timezone: 'Based on IP',
  language: 'Based on IP',
  resolution: 'Based on User-Agent',
  canvas: 'Real',
  webgl: 'Real',
  audio: 'Noise',
  mediaDevice: 'Noise',
  cpuCores: '8',
  ramGb: '8',
  deviceName: 'USER-PCR126079',
  macAddress: '00-1C-BF-AF-5A-FC'
};

export default function ProfilesPage() {
  const [profiles, setProfiles] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [launchingId, setLaunchingId] = useState(null);
  const [error, setError] = useState('');
  
  const [view, setView] = useState('list');
  const [activeTab, setActiveTab] = useState('General');
  const [pd, setPd] = useState(initialProfileData);

  const filteredProfiles = useMemo(() => profiles, [profiles]);
  const isEditing = Boolean(pd.id);
  const tabs = ['General', 'Proxy', 'Platform', 'Fingerprint', 'Advanced'];

  const loadData = useCallback(async () => {
    setLoading(true);
    try { setProfiles(await softglazeApi.profiles.list({ search })); } 
    catch (err) { setError(err.message); } 
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { loadData(); }, [loadData]);

  function openCreate() { setPd(initialProfileData); setActiveTab('General'); setView('editor'); }
  function openEdit(profile) {
    setPd({ ...initialProfileData, id: profile.id, name: profile.title || '', remark: profile.notes || '', proxyString: profile.proxyInfoString || '' });
    setActiveTab('General'); setView('editor');
  }
  function closeEditor() { setView('list'); setPd(initialProfileData); }
  const updatePd = (k, v) => setPd(prev => ({ ...prev, [k]: v }));

  async function handleSaveProfile() {
    if (!pd.name) return setError('Profile Name is required.');
    setSaving(true);
    try {
      const payload = { title: pd.name, notes: pd.remark, proxyRaw: pd.proxyString || null, systemProxyBehavior: pd.proxyString ? 'PROFILE_PROXY' : 'DIRECT', tagManagement: 0, dataDirName: pd.name };
      if (isEditing) await softglazeApi.profiles.update({ id: pd.id, ...payload });
      else await softglazeApi.profiles.create(payload);
      closeEditor(); await loadData();
    } catch (err) { setError(err.message); } 
    finally { setSaving(false); }
  }

  async function handleLaunch(profileId) {
    setLaunchingId(profileId);
    try { await softglazeApi.profiles.launch(profileId, { startUrl: 'about:blank' }); } 
    catch (err) { setError(err.message); } 
    finally { setLaunchingId(null); }
  }

  async function handleDelete(profile) {
    if (!window.confirm(`Delete profile "${profile.title}"?`)) return;
    try { await softglazeApi.profiles.delete(profile.id, { removeLocalData: false }); await loadData(); } 
    catch (err) { setError(err.message); }
  }

  if (view === 'editor') {
    return (
      <div className="w-full h-full bg-[#1e2025] text-[#d1d5db] font-sans flex flex-col rounded-xl border border-[#2d3039] overflow-hidden shadow-2xl">
        <div className="bg-[#24272e] border-b border-[#2d3039] px-4 py-3 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={closeEditor} className="p-1.5 hover:bg-[#343842] rounded text-slate-400 hover:text-white transition"><ArrowLeft className="h-5 w-5" /></button>
            <h1 className="text-[15px] font-semibold text-white">New Browser Profile</h1>
          </div>
          <div className="flex items-center gap-4 text-xs text-[#eab308] bg-[#42341b] px-3 py-1.5 rounded-md border border-[#5a4623]">
            <ShieldCheck className="h-4 w-4" /> We recommend you to bind an authenticator in [Setting] to keep your account secure.
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col lg:flex-row gap-6">
          <div className="flex-1 bg-[#24272e] rounded-lg border border-[#2d3039] overflow-hidden flex flex-col">
            <div className="flex border-b border-[#2d3039] bg-[#24272e]">
              {tabs.map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} className={`px-6 py-3 text-[13px] font-medium transition-all border-b-2 ${activeTab === tab ? 'border-blue-500 text-blue-400' : 'border-transparent text-[#9ca3af] hover:text-white'}`}>{tab}</button>
              ))}
            </div>

            <div className="p-6 space-y-6 overflow-y-auto flex-1 text-[13px]">
              {activeTab === 'General' && (
                <div className="space-y-5 max-w-3xl">
                  <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                    <label className="text-right text-[#9ca3af]">Name</label>
                    <input type="text" value={pd.name} onChange={e => updatePd('name', e.target.value)} placeholder="Optional: profile name" className="w-full bg-[#181a1f] border border-[#3b3e48] rounded px-3 py-2 text-white outline-none focus:border-blue-500" />
                  </div>
                  
                  <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                    <label className="text-right text-[#9ca3af]">Browser</label>
                    <div className="flex gap-2">
                      <select value={pd.browserCore} onChange={e => updatePd('browserCore', e.target.value)} className="bg-[#181a1f] border border-[#3b3e48] rounded px-3 py-2 text-white outline-none focus:border-blue-500 w-40">
                        <option>SunBrowser</option>
                        <option>FlowerBrowser</option>
                      </select>
                      <select value={pd.browserVersion} onChange={e => updatePd('browserVersion', e.target.value)} className="bg-[#181a1f] border border-[#3b3e48] rounded px-3 py-2 text-white outline-none focus:border-blue-500 w-40">
                        <option>Chrome 148</option><option>Chrome 147</option><option>Chrome 146</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                    <label className="text-right text-[#9ca3af]">OS</label>
                    <div className="flex gap-3">
                      {['Windows', 'Mac', 'Linux', 'Android', 'iOS'].map(os => (
                        <label key={os} className={`flex items-center gap-1.5 px-3 py-1.5 rounded cursor-pointer border ${pd.os === os ? 'bg-blue-600/20 border-blue-500 text-blue-400' : 'bg-[#181a1f] border-[#3b3e48] text-[#9ca3af]'}`}>
                          <input type="radio" checked={pd.os === os} onChange={() => updatePd('os', os)} className="hidden"/> {os}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                    <label className="text-right text-[#9ca3af]"><span className="text-red-500">*</span> Group</label>
                    <select value={pd.group} onChange={e => updatePd('group', e.target.value)} className="w-1/2 bg-[#181a1f] border border-[#3b3e48] rounded px-3 py-2 text-white outline-none focus:border-blue-500">
                      <option>Ungrouped</option><option>Lead Gen</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                    <label className="text-right text-[#9ca3af]">Cookie</label>
                    <input type="text" placeholder="Formats: JSON, Netscape, Name=Value" className="w-full bg-[#181a1f] border border-[#3b3e48] rounded px-3 py-2 text-white outline-none focus:border-blue-500" />
                  </div>
                  
                  <div className="grid grid-cols-[120px_1fr] items-start gap-4">
                    <label className="text-right text-[#9ca3af] mt-2">Remark</label>
                    <textarea value={pd.remark} onChange={e => updatePd('remark', e.target.value)} rows="3" placeholder="Enter remark" className="w-full bg-[#181a1f] border border-[#3b3e48] rounded px-3 py-2 text-white outline-none focus:border-blue-500 resize-none"></textarea>
                  </div>
                </div>
              )}

              {activeTab === 'Proxy' && (
                <div className="space-y-6 max-w-3xl">
                  <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                    <label className="text-right text-[#9ca3af]">Proxy setting</label>
                    <div className="flex bg-[#181a1f] border border-[#3b3e48] rounded w-max overflow-hidden">
                      {['Custom', 'Saved Proxies', 'Rotating Proxy', 'Proxy Provider'].map(t => (
                        <button key={t} onClick={() => updatePd('proxySetting', t)} className={`px-4 py-1.5 ${pd.proxySetting === t ? 'bg-[#3b3e48] text-white' : 'text-[#9ca3af] hover:text-white'}`}>{t}</button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                    <label className="text-right text-[#9ca3af]">Proxy type</label>
                    <div className="flex gap-2">
                      <select value={pd.proxyType} onChange={e => updatePd('proxyType', e.target.value)} className="bg-[#181a1f] border border-[#3b3e48] rounded px-3 py-2 text-white outline-none focus:border-blue-500 w-48">
                        <option>HTTP</option><option>HTTPS</option><option>SOCKS5</option>
                      </select>
                      <button className="bg-[#3b3e48] hover:bg-[#4b4e58] text-white px-4 py-2 rounded">Check the network</button>
                    </div>
                  </div>

                  <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                    <label className="text-right text-[#9ca3af]">IP checker</label>
                    <select value={pd.ipChecker} onChange={e => updatePd('ipChecker', e.target.value)} className="bg-[#181a1f] border border-[#3b3e48] rounded px-3 py-2 text-white outline-none focus:border-blue-500 w-48">
                      <option>IP2Location</option><option>IPFoxy</option><option>ip-api</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-[120px_1fr] items-start gap-4">
                    <label className="text-right text-[#9ca3af] mt-2">Host:Port</label>
                    <div className="space-y-3">
                       <textarea value={pd.proxyString} onChange={e => updatePd('proxyString', e.target.value)} rows="3" placeholder="Paste proxy here (host:port:username:password)" className="w-full bg-[#181a1f] border border-[#3b3e48] rounded px-3 py-2 text-white outline-none focus:border-blue-500 resize-none font-mono"></textarea>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'Fingerprint' && (
                <div className="space-y-4 max-w-2xl">
                  {['WebRTC', 'Timezone', 'Location', 'Language', 'Screen Resolution', 'Fonts'].map(item => (
                    <div key={item} className="grid grid-cols-[140px_1fr] items-center gap-4">
                      <label className="text-right text-[#9ca3af]">{item}</label>
                      <select className="bg-[#181a1f] border border-[#3b3e48] rounded px-3 py-1.5 text-white outline-none focus:border-blue-500 w-48">
                        <option>Default / Based on IP</option><option>Custom</option>
                      </select>
                    </div>
                  ))}
                  <div className="border-t border-[#3b3e48] my-4 pt-4"></div>
                  <h3 className="text-[#e2e8f0] font-medium mb-4">Hardware noise</h3>
                  {['Canvas', 'WebGL Image', 'AudioContext', 'Media device', 'ClientRects', 'SpeechVoices'].map(item => (
                    <div key={item} className="grid grid-cols-[140px_1fr] items-center gap-4">
                      <label className="text-right text-[#9ca3af]">{item}</label>
                      <select className="bg-[#181a1f] border border-[#3b3e48] rounded px-3 py-1.5 text-white outline-none focus:border-blue-500 w-48">
                        <option>Noise</option><option>Real</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'Advanced' && (
                <div className="space-y-4 max-w-2xl">
                  <div className="grid grid-cols-[140px_1fr] items-center gap-4">
                    <label className="text-right text-[#9ca3af]">CPU</label>
                    <select value={pd.cpuCores} onChange={e => updatePd('cpuCores', e.target.value)} className="bg-[#181a1f] border border-[#3b3e48] rounded px-3 py-1.5 text-white outline-none w-48">
                      <option value="4">4 cores</option><option value="8">8 cores</option><option value="16">16 cores</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-[140px_1fr] items-center gap-4">
                    <label className="text-right text-[#9ca3af]">RAM</label>
                    <select value={pd.ramGb} onChange={e => updatePd('ramGb', e.target.value)} className="bg-[#181a1f] border border-[#3b3e48] rounded px-3 py-1.5 text-white outline-none w-48">
                      <option value="4">4 GB</option><option value="8">8 GB</option><option value="16">16 GB</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-[140px_1fr] items-center gap-4">
                    <label className="text-right text-[#9ca3af]">Device name</label>
                    <input type="text" value={pd.deviceName} onChange={e => updatePd('deviceName', e.target.value)} className="bg-[#181a1f] border border-[#3b3e48] rounded px-3 py-1.5 text-white outline-none w-48" />
                  </div>
                  <div className="grid grid-cols-[140px_1fr] items-center gap-4">
                    <label className="text-right text-[#9ca3af]">MAC Address</label>
                    <input type="text" value={pd.macAddress} onChange={e => updatePd('macAddress', e.target.value)} className="bg-[#181a1f] border border-[#3b3e48] rounded px-3 py-1.5 text-white outline-none w-48 font-mono" />
                  </div>
                </div>
              )}
            </div>

            <div className="bg-[#24272e] border-t border-[#2d3039] p-4 flex justify-end gap-3 shrink-0">
              <button onClick={closeEditor} className="px-6 py-2 rounded bg-[#3b3e48] hover:bg-[#4b4e58] text-white text-[13px] font-medium transition">Cancel</button>
              <button onClick={handleSaveProfile} disabled={saving} className="px-6 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-[13px] font-medium transition disabled:opacity-50">OK</button>
            </div>
          </div>

          {/* Right Sidebar Overview */}
          <div className="w-80 shrink-0 bg-[#24272e] rounded-lg border border-[#2d3039] p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-[14px] font-medium text-white">Overview</h2>
              <button className="text-blue-400 hover:text-blue-300 text-[12px] flex items-center gap-1"><Settings2 className="h-3 w-3"/> New fingerprint</button>
            </div>
            
            <div className="space-y-2.5 text-[12px]">
              <div className="flex justify-between"><span className="text-[#9ca3af]">Browser</span><span className="text-white text-right">{pd.browserCore} [Auto]</span></div>
              <div className="flex justify-between"><span className="text-[#9ca3af]">User-Agent</span><span className="text-white text-right break-words w-40 leading-tight">{pd.userAgent}</span></div>
              <div className="flex justify-between"><span className="text-[#9ca3af]">WebRTC</span><span className="text-white">{pd.webrtc}</span></div>
              <div className="flex justify-between"><span className="text-[#9ca3af]">Timezone</span><span className="text-white">{pd.timezone}</span></div>
              <div className="flex justify-between"><span className="text-[#9ca3af]">Resolution</span><span className="text-white">{pd.resolution}</span></div>
              <div className="flex justify-between"><span className="text-[#9ca3af]">Canvas</span><span className="text-white">{pd.canvas}</span></div>
              <div className="flex justify-between"><span className="text-[#9ca3af]">AudioContext</span><span className="text-white">{pd.audio}</span></div>
              <div className="flex justify-between"><span className="text-[#9ca3af]">CPU</span><span className="text-white">{pd.cpuCores} cores</span></div>
              <div className="flex justify-between"><span className="text-[#9ca3af]">RAM</span><span className="text-white">{pd.ramGb} GB</span></div>
              <div className="flex justify-between"><span className="text-[#9ca3af]">MAC Address</span><span className="text-white">{pd.macAddress}</span></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- LIST VIEW ---
  return (
    <>
      <PageHeader eyebrow="Workspace" title="Profiles" description="Manage isolated local browser environments." actions={<><Button variant="outline" onClick={loadData}><RefreshCcw className="h-4 w-4" />Refresh</Button><Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-500 text-white"><Plus className="h-4 w-4" />New Profile</Button></>} />
      {error && <div className="mb-4 rounded-lg border border-red-900/70 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>}
      <Card>
        <CardContent className="p-0">
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[1120px] border-collapse text-left text-[13px]">
              <thead className="border-b border-[#2d3039] bg-[#181a1f] text-[#9ca3af]">
                <tr><th className="px-5 py-3 font-medium">Name</th><th className="px-5 py-3 font-medium">Proxy</th><th className="px-5 py-3 font-medium">Created</th><th className="px-5 py-3 text-right font-medium">Actions</th></tr>
              </thead>
              <tbody>
                {filteredProfiles.map((p) => (
                  <tr key={p.id} className="border-b border-[#2d3039] hover:bg-[#181a1f]">
                    <td className="px-5 py-3 font-medium text-white">{p.title}</td>
                    <td className="px-5 py-3 text-[#9ca3af]">{p.proxyInfoString ? p.proxyInfoString.split(':')[0] : 'Direct'}</td>
                    <td className="px-5 py-3 text-[#9ca3af]">{formatDateTime(p.createdAt)}</td>
                    <td className="px-5 py-3"><div className="flex justify-end gap-2"><Button size="sm" onClick={() => handleLaunch(p.id)} className="bg-emerald-600 text-white">Launch</Button><Button size="sm" variant="secondary" onClick={() => openEdit(p)}>Edit</Button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}