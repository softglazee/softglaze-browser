import { useState } from 'react';
import { Wand2, X, Loader2, Server, ListPlus, Ban } from 'lucide-react';

const inputCls = 'w-full h-10 bg-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary transition-colors';
const labelCls = 'block text-[11px] font-medium text-muted mb-1.5';

export default function QuickGenerateModal({ osPlatforms = [], groups = [], proxies = [], onClose, onGenerate }) {
  const [count, setCount] = useState(5);
  const [baseName, setBaseName] = useState('Profile');
  const [startIndex, setStartIndex] = useState(1);
  const [groupId, setGroupId] = useState('ungrouped');
  const [os, setOs] = useState(osPlatforms[0]?.id || 'Windows');
  const [randomize, setRandomize] = useState(true);
  const [proxyMode, setProxyMode] = useState('none'); // none | pool | paste
  const [distribution, setDistribution] = useState('sequential'); // sequential | random
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [err, setErr] = useState('');

  const proxyModes = [
    { id: 'none', label: 'Direct', icon: Ban },
    { id: 'pool', label: `Pool (${proxies.length})`, icon: Server },
    { id: 'paste', label: 'Paste list', icon: ListPlus }
  ];
  const start = Number(startIndex) || 1;
  const pad = (x) => String(x).padStart(3, '0');

  async function submit() {
    setErr('');
    const n = Number(count);
    if (!Number.isFinite(n) || n < 1 || n > 200) return setErr('Choose a quantity between 1 and 200.');
    if (!baseName.trim()) return setErr('Enter a base name.');
    if (proxyMode === 'pool' && proxies.length === 0) return setErr('No proxies in the pool — add some first, or paste a list.');
    if (proxyMode === 'paste' && !pasted.trim()) return setErr('Paste at least one proxy, or pick another option.');
    setBusy(true); setProgress({ done: 0, total: n });
    try {
      await onGenerate(
        { count: n, baseName: baseName.trim(), startIndex: start, groupId, os, randomize, proxyMode, distribution, pasted },
        (done, total) => setProgress({ done, total })
      );
      onClose();
    } catch (e) { setErr(e.message || 'Generation failed.'); setBusy(false); }
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onMouseDown={() => !busy && onClose()}>
      <div className="w-[500px] bg-card border border-border rounded-2xl shadow-2xl shadow-black/50" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2"><Wand2 className="w-4 h-4 text-primary" /><h2 className="font-display text-[15px] font-semibold">Quick generate</h2></div>
          <button onClick={() => !busy && onClose()} className="w-8 h-8 grid place-items-center rounded-lg text-muted hover:bg-secondary hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div><label className={labelCls}>Quantity</label><input type="number" min={1} max={200} className={inputCls} value={count} onChange={(e) => setCount(e.target.value)} /></div>
            <div className="col-span-2"><label className={labelCls}>Base name</label><input className={inputCls} value={baseName} onChange={(e) => setBaseName(e.target.value)} placeholder="Profile" /></div>
          </div>
          <p className="text-[11px] text-muted-dark -mt-2">Creates <span className="font-mono text-muted">{baseName || 'Profile'} {pad(start)}</span>, <span className="font-mono text-muted">{baseName || 'Profile'} {pad(start + 1)}</span> …</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Group</label>
              <select className={inputCls} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="ungrouped">Ungrouped</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Operating system</label>
              <select className={inputCls} value={os} onChange={(e) => setOs(e.target.value)}>
                {osPlatforms.map((o) => <option key={o.id} value={o.id}>{o.id}</option>)}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-[12.5px] text-foreground cursor-pointer">
            <input type="checkbox" checked={randomize} onChange={(e) => setRandomize(e.target.checked)} className="accent-[#6366f1]" />
            Randomize fingerprints <span className="text-muted-dark">— unique UA, GPU, MAC &amp; device each</span>
          </label>

          <div>
            <label className={labelCls}>Proxy</label>
            <div className="grid grid-cols-3 gap-2">
              {proxyModes.map((m) => (
                <button key={m.id} type="button" onClick={() => setProxyMode(m.id)} className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border text-[11.5px] transition-colors ${proxyMode === m.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted hover:border-muted-dark'}`}>
                  <m.icon className="w-4 h-4" />{m.label}
                </button>
              ))}
            </div>
          </div>

          {proxyMode === 'paste' && (
            <div>
              <label className={labelCls}>Proxies — one per line <span className="text-muted-dark">(host:port or host:port:user:pass)</span></label>
              <textarea rows={4} className={inputCls + ' h-auto py-2 font-mono text-[12px] resize-none'} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={'74.222.7.54:7957\n74.81.46.200:6288:user:pass'} />
            </div>
          )}

          {(proxyMode === 'pool' || proxyMode === 'paste') && (
            <div>
              <label className={labelCls}>Distribution</label>
              <div className="flex gap-2">
                {[['sequential', 'Round-robin'], ['random', 'Random']].map(([id, lbl]) => (
                  <button key={id} type="button" onClick={() => setDistribution(id)} className={`flex-1 h-9 rounded-lg border text-[12px] font-medium transition-colors ${distribution === id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted hover:border-muted-dark'}`}>{lbl}</button>
                ))}
              </div>
            </div>
          )}

          {err && <p className="text-[12px] text-red-400">{err}</p>}
          {busy && (
            <div>
              <div className="flex items-center justify-between text-[11.5px] text-muted mb-1.5"><span>Creating profiles…</span><span className="font-mono">{progress.done}/{progress.total}</span></div>
              <div className="h-1.5 rounded-full bg-background overflow-hidden"><div className="h-full bg-primary transition-all duration-200" style={{ width: `${pct}%` }} /></div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={() => !busy && onClose()} disabled={busy} className="h-9 px-3 rounded-lg text-[12.5px] text-muted hover:bg-secondary disabled:opacity-50">Cancel</button>
          <button onClick={submit} disabled={busy} className="h-9 px-4 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[12.5px] flex items-center gap-2 disabled:opacity-60 shadow-glow transition-colors">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}{busy ? 'Generating…' : `Generate ${Number(count) || 0}`}
          </button>
        </div>
      </div>
    </div>
  );
}