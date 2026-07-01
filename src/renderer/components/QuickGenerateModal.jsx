import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wand2, X, Loader2, Server, ListPlus, Ban, Link2, AlertTriangle, CheckCircle2, Zap, Turtle, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useDialog } from '@/lib/useDialog.js';

const inputCls = 'w-full h-10 bg-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary transition-colors';
const labelCls = 'block text-[11px] font-medium text-muted mb-1.5';
// Polished dropdown: hide the native OS arrow and paint an inset chevron so the icon
// isn't glued to the field edge (matches the rest of the app's styled selects).
const chevronStyle = { backgroundImage: "url(\"data:image/svg+xml;charset=utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239aa0aa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.7rem center', backgroundSize: '1rem' };
const selectCls = inputCls + ' appearance-none pr-9 cursor-pointer';

const PROVIDER_LABELS = { apify: 'Apify', shopsocks5: 'ShopSocks5', smartproxyorg: 'Smartproxy.org', smartproxy: 'Smartproxy', brightdata: 'Bright Data', oxylabs: 'Oxylabs', custom: 'Custom' };

export default function QuickGenerateModal({ osPlatforms = [], groups = [], proxies = [], proxyGroups = [], onClose, onGenerate, onCreateGroup }) {
  const { t } = useTranslation('cmpModalsC');
  const [count, setCount] = useState(5);
  const [baseName, setBaseName] = useState('Profile');
  const [startIndex, setStartIndex] = useState(1);
  const [groupId, setGroupId] = useState('ungrouped');
  const [newGroupName, setNewGroupName] = useState('');
  const [os, setOs] = useState(osPlatforms[0]?.id || 'Windows');
  const [randomize, setRandomize] = useState(true);
  const [startupUrls, setStartupUrls] = useState('');
  const [proxyMode, setProxyMode] = useState('none'); // none | pool | paste
  const [assignUnique, setAssignUnique] = useState(true); // pool: 1:1 unique vs round-robin reuse
  const [proxySource, setProxySource] = useState(''); // '' all | group:<id> | provider:<key>
  const [proxySpeed, setProxySpeed] = useState('any'); // any | fast | slow (by measured latency)
  const [proxyBlacklist, setProxyBlacklist] = useState('any'); // any | clean | blacklisted
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const { dialogRef } = useDialog({ onClose, closeOnEscape: !busy });
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);
  const [savingGroup, setSavingGroup] = useState(false);

  const proxyModes = [
    { id: 'none', label: t('quickGenerate.proxyModeDirect'), icon: Ban },
    { id: 'pool', label: t('quickGenerate.proxyModePool', { count: proxies.length }), icon: Server },
    { id: 'paste', label: t('quickGenerate.proxyModePaste'), icon: ListPlus }
  ];
  const start = Number(startIndex) || 1;
  const pad = (x) => String(x).padStart(3, '0');

  // Distinct providers present in the pool (for "create from <provider> proxies").
  const providerCounts = {};
  for (const p of proxies) { if (p.provider) providerCounts[p.provider] = (providerCounts[p.provider] || 0) + 1; }
  const providers = Object.entries(providerCounts);

  // Pool quality tallies (same thresholds as the Proxy Pool page) so the user can
  // see how many proxies match a Fast/Slow or Clean/Blacklisted filter up front.
  const SPEED_FAST_MAX_MS = 1500;
  const q = { fast: 0, slow: 0, clean: 0, blacklisted: 0 };
  for (const p of proxies) {
    const ms = typeof p.lastLatencyMs === 'number' ? p.lastLatencyMs : null;
    if (ms != null) { if (ms <= SPEED_FAST_MAX_MS) q.fast += 1; else q.slow += 1; }
    if (p.lastBlacklisted === false) q.clean += 1;
    else if (p.lastBlacklisted === true) q.blacklisted += 1;
  }

  // Map the UI proxy choice to the server-side assignment mode.
  function resolveProxyMode() {
    if (proxyMode === 'none') return 'direct';
    if (proxyMode === 'paste') return 'paste'; // unique-by-line
    return assignUnique ? 'unique' : 'pool';
  }

  // Inline "create group" — create it immediately, select it, and hide the input.
  // Falls back to the deferred create-on-generate path if onCreateGroup isn't given.
  async function saveNewGroup() {
    const name = newGroupName.trim();
    if (!name || !onCreateGroup || savingGroup) return;
    setSavingGroup(true); setErr('');
    try {
      const g = await onCreateGroup(name);
      if (g && g.id != null) { setGroupId(String(g.id)); setNewGroupName(''); }
    } catch (e) { setErr(e.message || t('quickGenerate.errCreateGroup')); }
    finally { setSavingGroup(false); }
  }

  async function submit() {
    setErr(''); setResult(null);
    const n = Number(count);
    if (!Number.isFinite(n) || n < 1 || n > 500) return setErr(t('quickGenerate.errQuantityRange'));
    if (!baseName.trim()) return setErr(t('quickGenerate.errBaseName'));
    if (groupId === '__new__' && !newGroupName.trim()) return setErr(t('quickGenerate.errNewGroupName'));
    if (proxyMode === 'pool' && proxies.length === 0) return setErr(t('quickGenerate.errNoPoolProxies'));
    if (proxyMode === 'paste' && !pasted.trim()) return setErr(t('quickGenerate.errNoPasted'));
    setBusy(true); setProgress({ done: 0, total: n });
    try {
      const r = await onGenerate(
        {
          count: n,
          baseName: baseName.trim(),
          startIndex: start,
          groupId: groupId === '__new__' ? null : groupId,
          newGroupName: groupId === '__new__' ? newGroupName.trim() : '',
          os,
          randomize,
          startupUrls: startupUrls.trim(),
          proxyMode: resolveProxyMode(),
          proxySource: proxyMode === 'pool' ? proxySource : '',
          proxySpeed: proxyMode === 'pool' ? proxySpeed : 'any',
          proxyBlacklist: proxyMode === 'pool' ? proxyBlacklist : 'any',
          pasted
        },
        (done, total) => setProgress({ done, total })
      );
      // Surface the result — especially the "capped at N proxies" notice — instead of
      // silently closing, so the user knows exactly how many profiles were created.
      if (r && (r.proxyLimited || (Array.isArray(r.errors) && r.errors.length))) {
        setResult(r); setBusy(false);
      } else {
        onClose();
      }
    } catch (e) { setErr(e.message || t('quickGenerate.errGeneration')); setBusy(false); }
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onMouseDown={() => !busy && onClose()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('quickGenerate.ariaLabel')} tabIndex={-1} className="w-[500px] max-h-[92vh] overflow-y-auto bg-card border border-border rounded-2xl shadow-2xl shadow-black/50" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card z-10">
          <div className="flex items-center gap-2"><Wand2 className="w-4 h-4 text-primary" /><h2 className="font-display text-[15px] font-semibold">{t('quickGenerate.title')}</h2></div>
          <button onClick={() => !busy && onClose()} className="w-8 h-8 grid place-items-center rounded-lg text-muted hover:bg-secondary hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div><label className={labelCls}>{t('quickGenerate.quantity')}</label><input type="number" min={1} max={500} className={inputCls} value={count} onChange={(e) => setCount(e.target.value)} /></div>
            <div className="col-span-2"><label className={labelCls}>{t('quickGenerate.baseName')}</label><input className={inputCls} value={baseName} onChange={(e) => setBaseName(e.target.value)} placeholder="Profile" /></div>
          </div>
          <p className="text-[11px] text-muted-dark -mt-2">{t('quickGenerate.createsPrefix')} <span className="font-mono text-muted">{baseName || 'Profile'}-{pad(start)}</span>, <span className="font-mono text-muted">{baseName || 'Profile'}-{pad(start + 1)}</span> …</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t('quickGenerate.group')}</label>
              <select className={selectCls} style={chevronStyle} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="ungrouped">{t('quickGenerate.ungrouped')}</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                <option value="__new__">{t('quickGenerate.createNewGroup')}</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>{t('quickGenerate.operatingSystem')}</label>
              <select className={selectCls} style={chevronStyle} value={os} onChange={(e) => setOs(e.target.value)}>
                {osPlatforms.map((o) => <option key={o.id} value={o.id}>{o.id}</option>)}
              </select>
            </div>
          </div>

          {groupId === '__new__' && (
            <div>
              <label className={labelCls}>{t('quickGenerate.newGroupName')}</label>
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveNewGroup(); } }}
                  placeholder={t('quickGenerate.newGroupPlaceholder')}
                  autoFocus
                />
                {onCreateGroup && (
                  <button type="button" onClick={saveNewGroup} disabled={savingGroup || !newGroupName.trim()} className="h-10 px-3 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[12.5px] flex items-center gap-1.5 disabled:opacity-50 shrink-0 transition-colors">
                    {savingGroup ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('quickGenerate.save')}
                  </button>
                )}
              </div>
              <p className="text-[11px] text-muted-dark mt-1">{t('quickGenerate.newGroupHint')}</p>
            </div>
          )}

          <label className="flex items-center gap-2.5 text-[12.5px] text-foreground cursor-pointer">
            <input type="checkbox" checked={randomize} onChange={(e) => setRandomize(e.target.checked)} className="accent-[#6366f1]" />
            {t('quickGenerate.uniqueFingerprint')} <span className="text-muted-dark">{t('quickGenerate.uniqueFingerprintDetail')}</span>
          </label>

          <div>
            <label className={labelCls}><Link2 className="inline w-3 h-3 mr-1 -mt-0.5" />{t('quickGenerate.startupLinks')} <span className="text-muted-dark">{t('quickGenerate.startupLinksHint')}</span></label>
            <textarea rows={2} className={inputCls + ' h-auto py-2 text-[12px] resize-none'} value={startupUrls} onChange={(e) => setStartupUrls(e.target.value)} placeholder={'https://facebook.com\nhttps://mail.google.com'} />
          </div>

          <div>
            <label className={labelCls}>{t('quickGenerate.proxy')}</label>
            <div className="grid grid-cols-3 gap-2">
              {proxyModes.map((m) => (
                <button key={m.id} type="button" onClick={() => setProxyMode(m.id)} className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border text-[11.5px] transition-colors ${proxyMode === m.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted hover:border-muted-dark'}`}>
                  <m.icon className="w-4 h-4" />{m.label}
                </button>
              ))}
            </div>
          </div>

          {proxyMode === 'pool' && (proxyGroups.length > 0 || providers.length > 0) && (
            <div>
              <label className={labelCls}>{t('quickGenerate.proxySource')}</label>
              <select className={selectCls} style={chevronStyle} value={proxySource} onChange={(e) => setProxySource(e.target.value)}>
                <option value="">{t('quickGenerate.allProxies', { count: proxies.length })}</option>
                {proxyGroups.length > 0 && (
                  <optgroup label={t('quickGenerate.optgroupGroups')}>
                    {proxyGroups.map((g) => <option key={`g${g.id}`} value={`group:${g.id}`}>{g.name} ({g.proxyCount ?? 0})</option>)}
                  </optgroup>
                )}
                {providers.length > 0 && (
                  <optgroup label={t('quickGenerate.optgroupByProvider')}>
                    {providers.map(([k, c]) => <option key={`p${k}`} value={`provider:${k}`}>{PROVIDER_LABELS[k] || k} ({c})</option>)}
                  </optgroup>
                )}
              </select>
            </div>
          )}

          {proxyMode === 'pool' && (
            <div className="space-y-2">
              <label className={labelCls}>{t('quickGenerate.quality')}</label>
              {/* Speed — narrow the pool to fast / slow proxies before assigning */}
              <div className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-[11px] text-muted-dark">{t('quickGenerate.qSpeed')}</span>
                <div className="flex-1 flex items-center gap-1 rounded-lg border border-border bg-background p-1">
                  {[
                    { key: 'any', label: t('quickGenerate.qAny'), icon: null },
                    { key: 'fast', label: t('quickGenerate.qFast'), icon: Zap, n: q.fast },
                    { key: 'slow', label: t('quickGenerate.qSlow'), icon: Turtle, n: q.slow }
                  ].map((o) => (
                    <button key={o.key} type="button" onClick={() => setProxySpeed(o.key)}
                      className={`flex-1 inline-flex items-center justify-center gap-1 h-7 rounded-md text-[11.5px] font-medium transition-colors ${proxySpeed === o.key ? (o.key === 'fast' ? 'bg-sky-500/15 text-sky-400' : o.key === 'slow' ? 'bg-orange-500/15 text-orange-400' : 'bg-secondary text-foreground') : 'text-muted hover:text-foreground'}`}>
                      {o.icon && <o.icon className="w-3 h-3" />}{o.label}{typeof o.n === 'number' ? <span className="opacity-60">{o.n}</span> : null}
                    </button>
                  ))}
                </div>
              </div>
              {/* Blocklist — clean vs flagged (from the DNSBL health check) */}
              <div className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-[11px] text-muted-dark">{t('quickGenerate.qBlocklist')}</span>
                <div className="flex-1 flex items-center gap-1 rounded-lg border border-border bg-background p-1">
                  {[
                    { key: 'any', label: t('quickGenerate.qAny'), icon: null },
                    { key: 'clean', label: t('quickGenerate.qClean'), icon: ShieldCheck, n: q.clean },
                    { key: 'blacklisted', label: t('quickGenerate.qBlacklisted'), icon: ShieldAlert, n: q.blacklisted }
                  ].map((o) => (
                    <button key={o.key} type="button" onClick={() => setProxyBlacklist(o.key)}
                      className={`flex-1 inline-flex items-center justify-center gap-1 h-7 rounded-md text-[11.5px] font-medium transition-colors ${proxyBlacklist === o.key ? (o.key === 'blacklisted' ? 'bg-amber-500/15 text-amber-400' : o.key === 'clean' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-secondary text-foreground') : 'text-muted hover:text-foreground'}`}>
                      {o.icon && <o.icon className="w-3 h-3" />}{o.label}{typeof o.n === 'number' ? <span className="opacity-60">{o.n}</span> : null}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[11px] text-muted-dark">{t('quickGenerate.qualityHint')}</p>
            </div>
          )}

          {proxyMode === 'pool' && (
            <label className="flex items-start gap-2.5 text-[12px] text-foreground cursor-pointer bg-background border border-border rounded-lg px-3 py-2.5">
              <input type="checkbox" checked={assignUnique} onChange={(e) => setAssignUnique(e.target.checked)} className="accent-[#6366f1] mt-0.5" />
              <span>
                <span className="font-medium">{t('quickGenerate.assignUnique')}</span>
                <span className="block text-[11px] text-muted-dark">{t('quickGenerate.assignUniqueDetail')}</span>
              </span>
            </label>
          )}

          {proxyMode === 'paste' && (
            <div>
              <label className={labelCls}>{t('quickGenerate.proxiesLabel')} <span className="text-muted-dark">{t('quickGenerate.proxiesLabelHint')}</span></label>
              <textarea rows={4} className={inputCls + ' h-auto py-2 font-mono text-[12px] resize-none'} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={'74.222.7.54:7957\n74.81.46.200:6288:user:pass'} />
            </div>
          )}

          {err && <p className="text-[12px] text-red-400">{err}</p>}

          {result && (
            <div className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-[12px] ${result.proxyLimited ? 'bg-amber-500/10 border border-amber-500/30 text-amber-300' : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'}`}>
              {result.proxyLimited ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}
              <span>{result.message}</span>
            </div>
          )}

          {busy && (
            <div>
              <div className="flex items-center justify-between text-[11.5px] text-muted mb-1.5"><span>{t('quickGenerate.creatingProfiles')}</span><span className="font-mono">{progress.done}/{progress.total}</span></div>
              <div className="h-1.5 rounded-full bg-background overflow-hidden"><div className="h-full bg-primary transition-all duration-200" style={{ width: `${pct}%` }} /></div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border sticky bottom-0 bg-card">
          <button onClick={() => !busy && onClose()} disabled={busy} className="h-9 px-3 rounded-lg text-[12.5px] text-muted hover:bg-secondary disabled:opacity-50">{result ? t('quickGenerate.done') : t('quickGenerate.cancel')}</button>
          {!result && (
            <button onClick={submit} disabled={busy} className="h-9 px-4 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[12.5px] flex items-center gap-2 disabled:opacity-60 shadow-glow transition-colors">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}{busy ? t('quickGenerate.generating') : t('quickGenerate.generate', { count: Number(count) || 0 })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
