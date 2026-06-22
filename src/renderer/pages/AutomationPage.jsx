import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Wand2, Bot, Flame, History, Plus, Loader2, Play, Square, X, Search,
  Trash2, Clock, CheckCircle2, Workflow, Sparkles, GripVertical
} from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

const TABS = [
  { key: 'macros', label: 'My Macros', icon: Workflow },
  { key: 'warmer', label: 'Cookie Warmer', icon: Flame },
  { key: 'history', label: 'Task History', icon: History }
];

const LEVEL_COLOR = {
  INFO: 'text-sky-400',
  SUCCESS: 'text-emerald-400',
  WARN: 'text-amber-400',
  ERROR: 'text-red-400'
};

export default function AutomationPage() {
  const [tab, setTab] = useState('macros');

  return (
    <div className="flex flex-col h-full pb-10">
      <PageHeader
        eyebrow="Softglaze Pro Features"
        title="Automation"
        description="No-code macros, AI-driven cookie warming, and a log of every background task."
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-elevated/60 border border-border w-fit mb-5">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors ${
              tab === key ? 'bg-card text-foreground shadow-sm border border-border' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'macros' && <MacrosPanel />}
      {tab === 'warmer' && <WarmerPanel />}
      {tab === 'history' && <HistoryPanel />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// My Macros
// ---------------------------------------------------------------------------
function MacrosPanel() {
  const [macros, setMacros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showBuilder, setShowBuilder] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await softglazeApi.automation.getMacros();
      setMacros(Array.isArray(rows) ? rows : []);
    } catch (e) { setErr(e.message || 'Could not load macros.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function remove(id) {
    setErr('');
    try { await softglazeApi.automation.deleteMacro(id); setMacros((m) => m.filter((x) => x.id !== id)); }
    catch (e) { setErr(e.message || 'Could not delete macro.'); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          Build reusable, no-code workflows that run inside a profile (navigate, click, type, wait).
        </p>
        <button
          onClick={() => setShowBuilder(true)}
          className="shrink-0 inline-flex items-center gap-2 h-9 px-4 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-violet-500 to-indigo-600 hover:from-violet-400 hover:to-indigo-500 shadow shadow-indigo-500/25"
        >
          <Plus className="w-4 h-4" /> Create Macro
        </button>
      </div>

      {err && <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">{err}</div>}

      {loading ? (
        <div className="grid place-items-center py-16"><Loader2 className="w-5 h-5 text-muted-foreground animate-spin" /></div>
      ) : macros.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 py-14 grid place-items-center text-center">
          <Workflow className="w-8 h-8 text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-foreground">No macros yet</p>
          <p className="text-[12.5px] text-muted-foreground mt-1">Create your first no-code workflow to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {macros.map((m) => (
            <div key={m.id} className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
              <span className="w-10 h-10 rounded-lg grid place-items-center shrink-0 bg-indigo-500/10 border border-indigo-500/20">
                <Bot className="w-5 h-5 text-indigo-400" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-foreground truncate">{m.name}</span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">{m.stepCount} steps</span>
                </div>
                {m.description && <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2">{m.description}</p>}
                <p className="text-[10.5px] text-muted-foreground/70 mt-1.5">Updated {fmt(m.updatedAt)}</p>
              </div>
              <button onClick={() => remove(m.id)} title="Delete" className="shrink-0 text-muted-foreground hover:text-red-400 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {showBuilder && <MacroBuilderModal onClose={() => setShowBuilder(false)} onSaved={() => { setShowBuilder(false); load(); }} />}
    </div>
  );
}

// Placeholder drag-and-drop workflow builder. The canvas/palette are scaffolded
// (the real DnD engine lands in a later milestone); name + description + the
// step list are persisted now so saved macros round-trip through the database.
function MacroBuilderModal({ onClose, onSaved }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const PALETTE = ['Navigate to URL', 'Click element', 'Type text', 'Wait (ms)', 'Scroll', 'Screenshot'];

  async function save() {
    setErr('');
    if (!name.trim()) { setErr('Give the macro a name.'); return; }
    setBusy(true);
    try {
      await softglazeApi.automation.saveMacro({ name: name.trim(), description: description.trim(), steps: [] });
      onSaved();
    } catch (e) { setErr(e.message || 'Could not save macro.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onMouseDown={onClose}>
      <div className="w-full max-w-3xl rounded-2xl bg-card border border-border shadow-2xl overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg grid place-items-center bg-violet-500/12 border border-violet-500/20"><Wand2 className="w-4 h-4 text-violet-400" /></span>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Workflow Builder</h3>
              <p className="text-[11px] text-muted-foreground">Drag-and-drop builder · Softglaze Pro</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">Macro name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Daily Amazon login" className="w-full h-9 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">Description</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this macro do?" className="w-full h-9 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary" />
            </div>
          </div>

          {/* Scaffolded DnD canvas */}
          <div className="grid grid-cols-[200px_1fr] gap-3">
            <div className="rounded-xl border border-border bg-elevated/50 p-3">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">Step palette</p>
              <div className="space-y-1.5">
                {PALETTE.map((p) => (
                  <div key={p} className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-card border border-border text-[12px] text-foreground cursor-grab opacity-80">
                    <GripVertical className="w-3.5 h-3.5 text-muted-foreground" /> {p}
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-dashed border-border bg-card/40 grid place-items-center text-center p-6 min-h-[220px]">
              <div>
                <Sparkles className="w-7 h-7 text-violet-400 mx-auto mb-2" />
                <p className="text-[13px] font-medium text-foreground">Drag steps here to build your flow</p>
                <p className="text-[11.5px] text-muted-foreground mt-1 max-w-xs">The visual canvas is coming soon. Saved macros store their step array and will open here once the builder ships.</p>
              </div>
            </div>
          </div>

          {err && <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">{err}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={save} disabled={busy} className="h-9 px-5 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-violet-500 to-indigo-600 hover:from-violet-400 hover:to-indigo-500 disabled:opacity-50 inline-flex items-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Save macro
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cookie Warmer
// ---------------------------------------------------------------------------
function WarmerPanel() {
  const [profiles, setProfiles] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [minutes, setMinutes] = useState(5);
  const [search, setSearch] = useState('');
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [err, setErr] = useState('');
  const logRef = useRef(null);

  useEffect(() => {
    softglazeApi.profiles.list({}).then((rows) => setProfiles(Array.isArray(rows) ? rows : [])).catch(() => setProfiles([]));
  }, []);

  // Subscribe to live warm-up progress for the whole panel lifetime.
  useEffect(() => {
    const off = softglazeApi.automation.onWarmerProgress((data) => {
      if (!data) return;
      setLogs((prev) => [...prev.slice(-300), data]);
      if (data.done) setRunning(false);
    });
    return () => { try { off && off(); } catch (e) { /* ignore */ } };
  }, []);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logs]);

  const filtered = profiles.filter((p) => !search || String(p.title || '').toLowerCase().includes(search.toLowerCase()));

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function start() {
    setErr('');
    const ids = [...selected];
    if (ids.length === 0) { setErr('Select at least one profile to warm up.'); return; }
    setRunning(true);
    setLogs([]);
    try {
      await softglazeApi.automation.startWarmer({ profileIds: ids, minutes: Number(minutes) || 5 });
    } catch (e) {
      setErr(e.message || 'Could not start the warm-up.');
      setRunning(false);
    }
  }

  const profileName = (id) => {
    const p = profiles.find((x) => Number(x.id) === Number(id));
    return p ? p.title : `Profile ${id}`;
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.1fr] gap-4">
      {/* Controls */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-lg grid place-items-center bg-orange-500/12 border border-orange-500/20"><Flame className="w-5 h-5 text-orange-400" /></span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">AI Cookie Warmer</h3>
            <p className="text-[11.5px] text-muted-foreground">Builds organic cookies & history by browsing real sites.</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">Warm-up duration (minutes)</label>
            <input type="number" min={1} max={120} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="w-full h-9 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary" />
          </div>
          <div className="shrink-0 self-end">
            <button
              onClick={start}
              disabled={running}
              className="h-9 px-5 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-orange-500 to-rose-600 hover:from-orange-400 hover:to-rose-500 shadow shadow-orange-500/25 disabled:opacity-60 inline-flex items-center gap-2"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {running ? 'Warming…' : 'Start AI Warm-up'}
            </button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Profiles ({selected.size} selected)</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="h-7 w-40 bg-input-background border border-border rounded-lg pl-7 pr-2 text-[12px] text-foreground outline-none focus:border-primary" />
            </div>
          </div>
          <div className="rounded-lg border border-border bg-elevated/40 max-h-[320px] overflow-y-auto divide-y divide-border/60">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">No profiles found.</div>
            ) : filtered.map((p) => (
              <label key={p.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-secondary/50">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} className="accent-orange-500" />
                <span className="text-[12.5px] text-foreground truncate flex-1">{p.title}</span>
                <span className="text-[10.5px] text-muted-foreground">#{p.id}</span>
              </label>
            ))}
          </div>
        </div>

        {err && <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">{err}</div>}
      </div>

      {/* Live console */}
      <div className="rounded-xl border border-border bg-[#0b0f17] overflow-hidden flex flex-col min-h-[360px]">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60 bg-elevated/30">
          <span className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
          </span>
          <span className="text-[11.5px] font-medium text-muted-foreground ml-1">Warm-up console</span>
          {running && <span className="ml-auto text-[10.5px] text-emerald-400 inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> live</span>}
        </div>
        <div ref={logRef} className="flex-1 overflow-y-auto p-3 font-mono text-[11.5px] leading-relaxed">
          {logs.length === 0 ? (
            <p className="text-muted-foreground/60">[ idle ] Select profiles, set a duration, and start the warm-up to see live progress.</p>
          ) : logs.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap break-words">
              <span className="text-muted-foreground/50">{ts(l.ts)} </span>
              <span className={LEVEL_COLOR[l.level] || 'text-foreground'}>[{l.level || 'INFO'}]</span>{' '}
              {l.profileId != null && <span className="text-violet-300">{profileName(l.profileId)}: </span>}
              <span className="text-foreground/90">{l.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task History
// ---------------------------------------------------------------------------
function HistoryPanel() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    softglazeApi.automation.getHistory()
      .then((rows) => setHistory(Array.isArray(rows) ? rows : []))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="grid place-items-center py-16"><Loader2 className="w-5 h-5 text-muted-foreground animate-spin" /></div>;

  if (history.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/40 py-14 grid place-items-center text-center">
        <History className="w-8 h-8 text-muted-foreground mb-3" />
        <p className="text-sm font-medium text-foreground">No tasks have run yet</p>
        <p className="text-[12.5px] text-muted-foreground mt-1">Cookie-warmer runs will appear here.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <table className="w-full text-[12.5px]">
        <thead className="bg-elevated/40 text-muted-foreground">
          <tr className="text-left">
            <th className="px-4 py-2.5 font-semibold">Task</th>
            <th className="px-4 py-2.5 font-semibold">Profiles</th>
            <th className="px-4 py-2.5 font-semibold">Duration</th>
            <th className="px-4 py-2.5 font-semibold">Status</th>
            <th className="px-4 py-2.5 font-semibold">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {history.map((h, i) => (
            <tr key={h.runId || i} className="text-foreground">
              <td className="px-4 py-2.5 inline-flex items-center gap-2"><Flame className="w-3.5 h-3.5 text-orange-400" /> AI Cookie Warm-up</td>
              <td className="px-4 py-2.5 text-muted-foreground">{Array.isArray(h.profileIds) ? h.profileIds.length : 0}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{h.minutes} min</td>
              <td className="px-4 py-2.5">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${
                  h.status === 'completed' ? 'bg-emerald-500/12 text-emerald-400' : 'bg-sky-500/12 text-sky-400'
                }`}>
                  {h.status === 'completed' ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                  {h.status || 'running'}
                </span>
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">{fmt(h.finishedAt || h.startedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- helpers ---
function fmt(value) {
  if (!value) return '—';
  try { return new Date(value).toLocaleString(); } catch (e) { return '—'; }
}
function ts(value) {
  try { return new Date(value || Date.now()).toLocaleTimeString(); } catch (e) { return ''; }
}
