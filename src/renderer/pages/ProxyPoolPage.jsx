import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Copy, Check, Edit, Loader2, Plus, RefreshCcw, Search, Trash2, Upload, ChevronDown, X, Globe, Wifi, ShieldCheck, ShieldOff, Server, Boxes, FolderPlus, Folder, Tag, GripVertical, FolderInput } from 'lucide-react';

import EmptyState from '@/components/EmptyState.jsx';
import ProxyProviders from '@/components/ProxyProviders.jsx';
import { Donut, Legend } from '@/components/charts/Charts.jsx';
import PageHeader from '@/components/PageHeader.jsx';
import Badge from '@/components/ui/Badge.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card, CardContent } from '@/components/ui/Card.jsx';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/Dialog.jsx';
import Input from '@/components/ui/Input.jsx';
import Textarea from '@/components/ui/Textarea.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { formatDateTime } from '@/lib/utils.js';

const initialProxyForm = { id: null, name: '', type: 'HTTP', host: '', port: '', username: '', password: '' };

// Friendly labels for the "auto group by provider" chips.
const PROVIDER_LABELS = {
  apify: 'Apify', shopsocks5: 'ShopSocks5', smartproxyorg: 'Smartproxy.org',
  smartproxy: 'Smartproxy', brightdata: 'Bright Data', oxylabs: 'Oxylabs', custom: 'Custom'
};
const GROUP_COLORS = ['#3b82f6', '#22c55e', '#ef4444', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4', '#84cc16'];

// Figma-style compact stat card (tinted, glow, icon tile).
function MiniStat({ icon: Icon, label, value, color }) {
  return (
    <div className="rounded-xl p-4 relative overflow-hidden group animate-fade-up" style={{ background: `color-mix(in srgb, ${color} 8%, var(--card))`, border: `1px solid color-mix(in srgb, ${color} 20%, transparent)` }}>
      <div className="absolute -top-5 -right-5 w-16 h-16 rounded-full opacity-10 group-hover:opacity-20 transition-opacity" style={{ background: color, filter: 'blur(18px)' }} />
      <div className="relative z-10 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 28%, transparent)` }}>
          <Icon className="w-[18px] h-[18px]" style={{ color }} />
        </div>
        <div className="min-w-0">
          <p className="text-[18px] font-bold text-foreground font-display leading-none">{value}</p>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">{label}</p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>
      {children}
    </label>
  );
}

// --- CUSTOM STYLED SELECT DROPDOWN (Max 4px rounded) ---
const CustomSelect = ({ value, onChange, className = '', children, disabled }) => (
  <div className={`relative flex items-center ${className}`}>
    <select
      value={value}
      onChange={onChange}
      disabled={disabled}
      className="w-full appearance-none bg-background border border-border rounded pl-3 pr-9 py-2 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition disabled:opacity-50 text-ellipsis overflow-hidden whitespace-nowrap cursor-pointer hover:border-muted-dark"
    >
      {children}
    </select>
    <div className="absolute right-3 pointer-events-none text-muted">
      <ChevronDown className="w-4 h-4" />
    </div>
  </div>
);

export default function ProxyPoolPage() {
  const [proxies, setProxies] = useState([]);
  const [search, setSearch] = useState('');
  const [proxyOpen, setProxyOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [proxyForm, setProxyForm] = useState(initialProxyForm);
  const [batchRaw, setBatchRaw] = useState('');
  const [batchType, setBatchType] = useState('HTTP');
  const [batchResult, setBatchResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [checkResults, setCheckResults] = useState({});
  const [checkingId, setCheckingId] = useState(null);
  const [checkingAll, setCheckingAll] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [copiedId, setCopiedId] = useState(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [view, setView] = useState('custom'); // 'custom' | 'providers'
  const [testingAll, setTestingAll] = useState(false);
  const [testSummary, setTestSummary] = useState(null);
  const [proxyPolicy, setProxyPolicy] = useState('each-launch');
  // Proxy categories/groups + the active filter ('all' | 'none' | <groupId> | 'provider:<key>').
  const [groups, setGroups] = useState([]);
  const [activeGroup, setActiveGroup] = useState('all');
  const [groupModal, setGroupModal] = useState(null); // { id?, name, color } when creating/editing
  const [assignOpen, setAssignOpen] = useState(false);
  const [dragOverKey, setDragOverKey] = useState(null);

  useEffect(() => {
    softglazeApi.settings.getProxyPolicy()
      .then((p) => { if (p && p.default) setProxyPolicy(p.default); })
      .catch(() => {});
  }, []);

  const isEditing = Boolean(proxyForm.id);

  // Distinct providers present in the pool (for the "auto group by provider" chips).
  const providerCounts = useMemo(() => {
    const m = {};
    for (const p of proxies) { if (p.provider) m[p.provider] = (m[p.provider] || 0) + 1; }
    return m;
  }, [proxies]);

  // Client-side filter: search text + the active category (group / ungrouped / provider).
  const filteredProxies = useMemo(() => {
    const q = search.trim().toLowerCase();
    return proxies.filter((p) => {
      if (q) {
        const hay = `${p.name || ''} ${p.host || ''} ${p.username || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (activeGroup === 'all') return true;
      if (activeGroup === 'none') return !p.proxyGroupId;
      if (typeof activeGroup === 'string' && activeGroup.startsWith('provider:')) return p.provider === activeGroup.slice(9);
      return String(p.proxyGroupId) === String(activeGroup);
    });
  }, [proxies, search, activeGroup]);

  const allSelected = filteredProxies.length > 0 && filteredProxies.every((p) => selectedIds.has(p.id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  const loadGroups = useCallback(async () => {
    try { const g = await softglazeApi.proxyGroups.list(); setGroups(Array.isArray(g) ? g : []); }
    catch (e) { /* groups are optional UI sugar — never block the pool */ }
  }, []);

  const loadProxies = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Fetch the full pool once; search + category filtering happen client-side so
      // the sidebar counts stay accurate and switching categories never refetches.
      const list = await softglazeApi.proxies.list({});
      setProxies(Array.isArray(list) ? list : []);
      // Drop any selected ids that no longer exist after a reload.
      setSelectedIds((prev) => {
        const live = new Set((Array.isArray(list) ? list : []).map((p) => p.id));
        const next = new Set();
        prev.forEach((id) => { if (live.has(id)) next.add(id); });
        return next;
      });
    } catch (err) {
      setError(err.message || 'Failed to load proxies.');
    } finally {
      setLoading(false);
    }
  }, []);

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(() => (allSelected ? new Set() : new Set(filteredProxies.map((p) => p.id))));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function handleCopy(proxy) {
    const endpoint = `${proxy.host}:${proxy.port}`;
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopiedId(proxy.id);
      setTimeout(() => setCopiedId((cur) => (cur === proxy.id ? null : cur)), 1200);
    } catch (err) {
      setError('Could not copy to clipboard.');
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} selected ${ids.length === 1 ? 'proxy' : 'proxies'}? Linked profiles will keep working with their proxy assignment cleared.`)) return;
    setBulkDeleting(true);
    setError('');
    try {
      await softglazeApi.proxies.bulkDelete(ids);
      clearSelection();
      await loadProxies();
    } catch (err) {
      setError(err.message || 'Failed to delete selected proxies.');
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleBulkCheck() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setCheckingAll(true);
    try {
      for (const id of ids) {
        const proxy = proxies.find((p) => p.id === id);
        if (!proxy) continue;
        setCheckingId(id);
        try {
          const result = await softglazeApi.proxies.check({ id });
          setCheckResults((prev) => ({ ...prev, [id]: result }));
          applyGeoName(id, result);
        } catch (err) {
          setCheckResults((prev) => ({ ...prev, [id]: { success: false, error: err.message } }));
        }
      }
    } finally {
      setCheckingId(null);
      setCheckingAll(false);
    }
  }

  useEffect(() => { loadProxies(); loadGroups(); }, [loadProxies, loadGroups]);

  function updateProxyForm(key, value) {
    setProxyForm((current) => ({ ...current, [key]: value }));
  }

  // Paste "host:port:user:pass" into the Host field to auto-fill every field
  // (mirrors the Add Profile page's proxy section).
  function handleProxyPaste(event) {
    const text = ((event.clipboardData && event.clipboardData.getData('text')) || '').trim();
    const parts = text.split(':');
    if (parts.length >= 2 && parts.length <= 4) {
      event.preventDefault();
      setProxyForm((current) => ({
        ...current,
        host: parts[0] || '',
        port: parts[1] || '',
        username: parts[2] || '',
        password: parts[3] || ''
      }));
    }
  }

  function openCreate() {
    setProxyForm(initialProxyForm);
    setProxyOpen(true);
  }

  function openEdit(proxy) {
    setProxyForm({ id: proxy.id, name: proxy.name || '', type: proxy.type || 'HTTP', host: proxy.host || '', port: String(proxy.port || ''), username: proxy.username || '', password: proxy.hasPassword ? '••••••••' : '' });
    setProxyOpen(true);
  }

  async function handleSaveProxy(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { name: proxyForm.name, type: proxyForm.type, host: proxyForm.host, port: proxyForm.port, username: proxyForm.username, password: proxyForm.password };
      if (isEditing) await softglazeApi.proxies.update({ id: proxyForm.id, ...payload });
      else await softglazeApi.proxies.create(payload);
      setProxyForm(initialProxyForm);
      setProxyOpen(false);
      await loadProxies();
    } catch (err) {
      setError(err.message || 'Failed to save proxy.');
    } finally {
      setSaving(false);
    }
  }

  async function handleBatchAdd(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setBatchResult(null);
    try {
      const result = await softglazeApi.proxies.batchAdd({ raw: batchRaw, type: batchType });
      setBatchResult(result);
      await loadProxies();
    } catch (err) {
      setError(err.message || 'Failed to batch add proxies.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCheck(proxy) {
    setCheckingId(proxy.id);
    try {
      const result = await softglazeApi.proxies.check({ id: proxy.id });
      setCheckResults((prev) => ({ ...prev, [proxy.id]: result }));
      applyGeoName(proxy.id, result);
    } catch (err) {
      setCheckResults((prev) => ({ ...prev, [proxy.id]: { success: false, error: err.message } }));
    } finally {
      setCheckingId(null);
    }
  }

  async function handleCheckAll() {
    setCheckingAll(true);
    try {
      for (const proxy of proxies) {
        setCheckingId(proxy.id);
        try {
          const result = await softglazeApi.proxies.check({ id: proxy.id });
          setCheckResults((prev) => ({ ...prev, [proxy.id]: result }));
          applyGeoName(proxy.id, result);
        } catch (err) {
          setCheckResults((prev) => ({ ...prev, [proxy.id]: { success: false, error: err.message } }));
        }
      }
    } finally {
      setCheckingId(null);
      setCheckingAll(false);
    }
  }

  // Concurrent bulk health test (worker-capped in main). Reflects the persisted
  // health back into the inline status after it finishes.
  async function handleTestAllFast() {
    setTestingAll(true);
    setError('');
    try {
      const summary = await softglazeApi.proxies.testAll();
      setTestSummary(summary);
      const list = await softglazeApi.proxies.list({});
      const rows = Array.isArray(list) ? list : [];
      setProxies(rows);
      const next = {};
      for (const p of rows) {
        if (p.lastStatus) next[p.id] = { success: p.lastStatus === 'ok', country: p.lastCountry, latencyMs: p.lastLatencyMs };
      }
      setCheckResults(next);
    } catch (err) {
      setError(err.message || 'Bulk test failed.');
    } finally {
      setTestingAll(false);
    }
  }

  async function applyProxyPolicy(mode) {
    setProxyPolicy(mode);
    try { await softglazeApi.settings.setProxyPolicy({ default: mode }); }
    catch (err) { setError(err.message || 'Could not save the proxy policy.'); }
  }

  // --- Proxy groups: create / edit / delete / assign / drag-drop ---
  async function saveGroup() {
    const m = groupModal;
    if (!m) return;
    const name = (m.name || '').trim();
    if (!name) { setError('Enter a group name.'); return; }
    try {
      if (m.id) await softglazeApi.proxyGroups.update({ id: m.id, name, color: m.color });
      else await softglazeApi.proxyGroups.create({ name, color: m.color });
      setGroupModal(null);
      await loadGroups();
    } catch (err) { setError(err.message || 'Could not save the group.'); }
  }

  async function removeGroup(g) {
    if (!window.confirm(`Delete group "${g.name}"? The proxies stay in the pool — they just become ungrouped.`)) return;
    try {
      await softglazeApi.proxyGroups.delete(g.id);
      if (String(activeGroup) === String(g.id)) setActiveGroup('all');
      await Promise.all([loadGroups(), loadProxies()]);
    } catch (err) { setError(err.message || 'Could not delete the group.'); }
  }

  async function assignSelectedToGroup(groupId) {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try {
      await softglazeApi.proxyGroups.assign(ids, groupId);
      setAssignOpen(false);
      clearSelection();
      await Promise.all([loadGroups(), loadProxies()]);
    } catch (err) { setError(err.message || 'Could not move the proxies.'); }
  }

  // Drag a proxy row (or, if it's part of the current selection, the whole selection)
  // onto a group chip to assign it there.
  function onRowDragStart(e, proxy) {
    const ids = selectedIds.has(proxy.id) ? Array.from(selectedIds) : [proxy.id];
    e.dataTransfer.setData('text/plain', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
  }
  async function onGroupDrop(e, groupId) {
    e.preventDefault();
    setDragOverKey(null);
    let ids = [];
    try { ids = JSON.parse(e.dataTransfer.getData('text/plain')) || []; } catch (err) { ids = []; }
    if (!Array.isArray(ids) || !ids.length) return;
    try {
      await softglazeApi.proxyGroups.assign(ids, groupId);
      clearSelection();
      await Promise.all([loadGroups(), loadProxies()]);
    } catch (err) { setError(err.message || 'Could not move the proxies.'); }
  }

  function renderStatus(id) {
    if (checkingId === id) return <span className="text-xs text-muted">Checking…</span>;
    const r = checkResults[id];
    if (!r) return <span className="text-xs text-muted-dark">—</span>;
    if (r.success) {
      return (
        <span className="text-xs font-medium text-emerald-400">
          {r.ip || '?'}{r.country ? ` · ${r.country}` : ''}{typeof r.latencyMs === 'number' ? ` · ${r.latencyMs}ms` : ''}
        </span>
      );
    }
    return <span className="text-xs font-medium text-red-400" title={r.error || 'Failed'}>Failed{r.error ? `: ${String(r.error).slice(0, 40)}` : ''}</span>;
  }

  const chipCls = (key) => `inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium border transition-colors cursor-pointer ${String(activeGroup) === String(key) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-dark'}`;

  // Mirror the backend's name enrichment so a checked proxy shows its geo immediately
  // (e.g. "ShopSocks5 • US Kirkland, Washington 98033") without a full reload.
  function applyGeoName(id, result) {
    if (!result || !result.success) return;
    const cc = String(result.country || '').toUpperCase();
    const place = [result.city, result.region].filter(Boolean).join(', ');
    const head = [cc, place].filter(Boolean).join(' ');
    const geo = `${head}${result.zip ? ` ${result.zip}` : ''}`.trim();
    if (!geo) return;
    setProxies((prev) => prev.map((p) => (p.id === id
      ? { ...p, name: `${String(p.name || '').split(' • ')[0].trim() || 'Proxy'} • ${geo}` }
      : p)));
  }

  async function handleDelete(proxy) {
    if (!window.confirm(`Delete proxy "${proxy.name}"?`)) return;
    setError('');
    try {
      await softglazeApi.proxies.delete(proxy.id);
      await loadProxies();
    } catch (err) {
      setError(err.message || 'Failed to delete proxy. Remove linked profiles or change their proxy assignment first.');
    }
  }

  // REAL stats derived from the proxy list + any check results.
  const checkList = Object.values(checkResults);
  const aliveCount = checkList.filter((r) => r && r.success).length;
  const deadCount = checkList.filter((r) => r && r.success === false).length;
  const typeCounts = proxies.reduce((acc, p) => {
    const t = String(p.type || 'OTHER').toUpperCase();
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  const TYPE_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
  const typeDonut = Object.entries(typeCounts).map(([label, value], i) => ({ label, value, color: TYPE_COLORS[i % TYPE_COLORS.length] }));
  if (typeDonut.length === 0) typeDonut.push({ label: 'No proxies', value: 1, color: 'var(--elevated)' });

  return (
    <div className="flex flex-col h-full space-y-4 pb-10">
      <PageHeader
        eyebrow="Network"
        title="Proxy Pool"
        description="Store reusable HTTP and SOCKS5 proxies locally, or sync purchased pools straight from integrated providers."
        actions={
          view === 'custom' ? (
            <>
              <div className="flex items-center gap-2 mr-1">
                <span className="text-[11px] font-medium text-muted-foreground">Rotation:</span>
                <select
                  value={proxyPolicy}
                  onChange={(e) => applyProxyPolicy(e.target.value)}
                  className="h-9 rounded-lg border border-border bg-card px-2 text-[12px] text-foreground"
                  title="How a profile's rotation pool is applied at launch"
                >
                  <option value="each-launch">Rotate each launch</option>
                  <option value="sticky">Sticky (fixed proxy)</option>
                  <option value="failover">Failover to healthy</option>
                </select>
              </div>
              <Button variant="secondary" onClick={handleTestAllFast} disabled={testingAll || proxies.length === 0} title="Concurrent health test of every proxy">
                {testingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Test All{testSummary ? ` · ${testSummary.ok}/${testSummary.total} ok` : ''}
              </Button>
              <Button variant="secondary" onClick={handleCheckAll} disabled={checkingAll || proxies.length === 0}>
                {checkingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
                Check All
              </Button>
              <Button variant="secondary" onClick={loadProxies}>
                <RefreshCcw className="h-4 w-4" />
                Refresh
              </Button>
              <Button variant="secondary" onClick={() => setBatchOpen(true)}>
                <Upload className="h-4 w-4" />
                Batch Add
              </Button>
              <Button variant="primary" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                New Proxy
              </Button>
            </>
          ) : null
        }
      />

      {/* Dual-view tab partition */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-elevated/60 border border-border w-fit">
        {[
          { key: 'custom', label: 'Custom Proxies', icon: Server },
          { key: 'providers', label: 'Proxy Providers', icon: Boxes }
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors ${view === key ? 'bg-card text-foreground shadow-sm border border-border' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Icon className="w-4 h-4" /> {label}
            {key === 'providers' && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 uppercase tracking-wide">Integrated</span>}
          </button>
        ))}
      </div>

      {/* STATS ROW — real counts + proxy-type donut (custom view only) */}
      {view === 'custom' && (
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MiniStat icon={Globe} label="Total proxies" value={proxies.length} color="#8b5cf6" />
          <MiniStat icon={Wifi} label="Proxy types" value={Object.keys(typeCounts).length} color="#3b82f6" />
          <MiniStat icon={ShieldCheck} label="Verified live" value={aliveCount} color="#10b981" />
          <MiniStat icon={ShieldOff} label="Failed checks" value={deadCount} color="#ef4444" />
        </div>
        <div className="rounded-xl bg-card border border-border p-4 flex items-center gap-4">
          <Donut data={typeDonut} size={104} thickness={16} centerLabel={proxies.length} centerSub="total" />
          <div className="flex-1 min-w-0"><Legend data={typeDonut} /></div>
        </div>
      </div>
      )}

      {error && <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}

      {view === 'providers' && <ProxyProviders onSynced={loadProxies} />}

      {view === 'custom' && (<>
      <div className="mb-2">
        <div className="relative max-w-sm">
          <Input
            icon={Search}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by proxy name, host, or username..."
          />
        </div>
      </div>

      {/* CATEGORY / GROUP BAR — filter the pool, manage groups, drag rows here to assign */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button className={chipCls('all')} onClick={() => setActiveGroup('all')}>
          <Boxes className="w-3.5 h-3.5" /> All <span className="opacity-60">{proxies.length}</span>
        </button>
        <button className={chipCls('none')} onClick={() => setActiveGroup('none')}>
          <Folder className="w-3.5 h-3.5" /> Ungrouped <span className="opacity-60">{proxies.filter((p) => !p.proxyGroupId).length}</span>
        </button>

        {groups.map((g) => {
          const active = String(activeGroup) === String(g.id);
          const over = dragOverKey === `g${g.id}`;
          return (
            <div
              key={g.id}
              onClick={() => setActiveGroup(g.id)}
              onDragOver={(e) => { e.preventDefault(); setDragOverKey(`g${g.id}`); }}
              onDragLeave={() => setDragOverKey((k) => (k === `g${g.id}` ? null : k))}
              onDrop={(e) => onGroupDrop(e, g.id)}
              title="Click to filter · drag proxies here to add them"
              className={`group/chip inline-flex items-center gap-1.5 h-8 pl-2.5 pr-2 rounded-lg text-[12px] font-medium border transition-colors cursor-pointer ${over ? 'ring-2 ring-primary border-primary' : active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-dark'}`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.color || '#3b82f6' }} />
              {g.name} <span className="opacity-60">{g.proxyCount ?? 0}</span>
              <button onClick={(e) => { e.stopPropagation(); setGroupModal({ id: g.id, name: g.name, color: g.color || '#3b82f6' }); }} className="opacity-0 group-hover/chip:opacity-100 ml-1 p-0.5 rounded hover:bg-card text-muted hover:text-foreground" title="Rename / recolor"><Edit className="w-3 h-3" /></button>
              <button onClick={(e) => { e.stopPropagation(); removeGroup(g); }} className="opacity-0 group-hover/chip:opacity-100 p-0.5 rounded hover:bg-red-500/10 text-muted hover:text-red-400" title="Delete group"><X className="w-3 h-3" /></button>
            </div>
          );
        })}

        <button className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary transition-colors" onClick={() => setGroupModal({ name: '', color: GROUP_COLORS[groups.length % GROUP_COLORS.length] })}>
          <FolderPlus className="w-3.5 h-3.5" /> New group
        </button>

        {Object.keys(providerCounts).length > 0 && (
          <>
            <span className="w-px h-5 bg-border mx-1" />
            <span className="text-[10px] uppercase tracking-wider text-muted-dark mr-1">By provider</span>
            {Object.entries(providerCounts).map(([prov, cnt]) => (
              <button key={prov} className={chipCls(`provider:${prov}`)} onClick={() => setActiveGroup(`provider:${prov}`)}>
                <Tag className="w-3 h-3" /> {PROVIDER_LABELS[prov] || prov} <span className="opacity-60">{cnt}</span>
              </button>
            ))}
          </>
        )}
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm">
          <span className="font-medium text-foreground">{selectedIds.size} selected</span>
          <div className="w-px h-5 bg-border" />
          <Button size="sm" variant="secondary" onClick={handleBulkCheck} disabled={checkingAll || bulkDeleting}>
            {checkingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />} Check selected
          </Button>
          <div className="relative">
            <Button size="sm" variant="secondary" onClick={() => setAssignOpen((v) => !v)} disabled={bulkDeleting}>
              <FolderInput className="h-3.5 w-3.5" /> Move to group <ChevronDown className="h-3.5 w-3.5" />
            </Button>
            {assignOpen && (
              <div className="absolute z-20 mt-1 w-56 max-h-64 overflow-y-auto rounded-lg border border-border bg-card shadow-xl py-1">
                {groups.length === 0 && <div className="px-3 py-2 text-[12px] text-muted">No groups yet — create one first.</div>}
                {groups.map((g) => (
                  <button key={g.id} onClick={() => assignSelectedToGroup(g.id)} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-foreground hover:bg-secondary text-left">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.color || '#3b82f6' }} /> {g.name}
                  </button>
                ))}
                <div className="my-1 h-px bg-border" />
                <button onClick={() => assignSelectedToGroup(null)} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-muted-foreground hover:bg-secondary text-left">
                  <X className="w-3.5 h-3.5" /> Remove from group
                </button>
              </div>
            )}
          </div>
          <Button size="sm" variant="danger" onClick={handleBulkDelete} disabled={bulkDeleting}>
            {bulkDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete selected
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection} className="ml-auto px-2.5" title="Clear selection">
            <X className="h-4 w-4" /> Clear
          </Button>
        </div>
      )}

      <Card className="bg-surface border-border flex flex-col shadow-xl flex-1 rounded">
        <CardContent className="p-0 overflow-auto flex-1 rounded">
          {loading ? (
            <div className="p-12 text-sm text-muted text-center flex flex-col items-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              Loading proxies...
            </div>
          ) : filteredProxies.length === 0 ? (
            <div className="p-12">
              <EmptyState title="No proxies found" description="Add a proxy manually or paste a batch of proxy strings." />
            </div>
          ) : (
            <div className="w-full overflow-auto max-h-[60vh]">
              <table className="w-full min-w-[1000px] border-collapse text-left text-sm whitespace-nowrap">
                <thead className="bg-surface text-muted text-xs uppercase tracking-wider font-semibold border-b border-border sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-5 py-4 w-10">
                      <input
                        type="checkbox"
                        aria-label="Select all proxies"
                        className="h-4 w-4 cursor-pointer accent-primary align-middle"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected; }}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th className="px-5 py-4">Name</th>
                    <th className="px-5 py-4">Type</th>
                    <th className="px-5 py-4">Endpoint</th>
                    <th className="px-5 py-4">Username</th>
                    <th className="px-5 py-4">Group</th>
                    <th className="px-5 py-4">Profiles</th>
                    <th className="px-5 py-4">Created</th>
                    <th className="px-5 py-4">Status</th>
                    <th className="px-5 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredProxies.map((proxy) => (
                    <tr key={proxy.id} draggable onDragStart={(e) => onRowDragStart(e, proxy)} className={`transition-colors cursor-grab active:cursor-grabbing ${selectedIds.has(proxy.id) ? 'bg-primary/5' : 'hover:bg-card/50'}`}>
                      <td className="px-5 py-4">
                        <input
                          type="checkbox"
                          aria-label={`Select ${proxy.name}`}
                          className="h-4 w-4 cursor-pointer accent-primary align-middle"
                          checked={selectedIds.has(proxy.id)}
                          onChange={() => toggleSelect(proxy.id)}
                        />
                      </td>
                      <td className="px-5 py-4 font-medium text-foreground">{proxy.name}</td>
                      <td className="px-5 py-4">
                        <Badge variant={proxy.type === 'SOCKS5' ? 'amber' : 'blue'}>{proxy.type}</Badge>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1.5">
                          <code className="rounded bg-background border border-border px-2 py-1 text-xs font-mono text-muted-foreground">
                            {proxy.host}:{proxy.port}
                          </code>
                          <button
                            type="button"
                            onClick={() => handleCopy(proxy)}
                            title="Copy host:port"
                            className="text-muted hover:text-foreground transition-colors p-1 rounded hover:bg-card"
                          >
                            {copiedId === proxy.id ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-muted">{proxy.username || '—'}</td>
                      <td className="px-5 py-4">
                        {proxy.groupName ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: proxy.groupColor || '#3b82f6' }} /> {proxy.groupName}
                          </span>
                        ) : <span className="text-muted-dark">—</span>}
                      </td>
                      <td className="px-5 py-4">
                        {(() => {
                          const names = proxy.profileNames || [];
                          const count = proxy.profileCount ?? names.length;
                          if (names.length > 0) {
                            return (
                              <span className="text-foreground text-xs" title={names.join(', ')}>
                                {names.slice(0, 2).join(', ')}{names.length > 2 ? ` +${names.length - 2}` : ''}
                              </span>
                            );
                          }
                          if (count > 0) return <span className="text-foreground text-xs">{count} profile{count === 1 ? '' : 's'}</span>;
                          return <span className="text-muted-dark">—</span>;
                        })()}
                      </td>
                      <td className="px-5 py-4 text-muted text-xs">{formatDateTime(proxy.createdAt)}</td>
                      <td className="px-5 py-4">{renderStatus(proxy.id)}</td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="secondary" onClick={() => handleCheck(proxy)} disabled={checkingId === proxy.id} title="Test proxy" className="px-3">
                            {checkingId === proxy.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5 mr-1" />} Check
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => openEdit(proxy)} className="px-2.5">
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(proxy)} className="px-2.5 text-red-400 hover:text-red-300 hover:bg-red-500/10">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      </>)}

      {/* --- CREATE / EDIT MODAL --- */}
      <Dialog open={proxyOpen} onOpenChange={setProxyOpen}>
        <DialogContent title={isEditing ? 'Edit proxy' : 'Create proxy'} className="rounded border-border bg-card">
          <form onSubmit={handleSaveProxy}>
            <DialogHeader>
              <DialogTitle>{isEditing ? 'Edit Proxy' : 'Create Proxy'}</DialogTitle>
              <DialogDescription>
                {isEditing ? 'Update an existing proxy. Leave the masked password unchanged to keep the current value.' : 'Add a single structured proxy to the local SQLite pool.'}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-5">
              <p className="text-xs text-primary italic bg-primary/10 border border-primary/20 px-3 py-2 rounded">💡 Tip: paste your proxy <span className="font-mono">host:port:user:pass</span> into the Host field to auto-fill every field.</p>
              <div className="grid gap-4 lg:grid-cols-2">
                <Field label="Proxy Name">
                  <Input value={proxyForm.name} onChange={(event) => updateProxyForm('name', event.target.value)} placeholder="Residential US 01" required />
                </Field>
                <Field label="Type">
                  <CustomSelect value={proxyForm.type} onChange={(event) => updateProxyForm('type', event.target.value)}>
                    <option value="HTTP">HTTP</option>
                    <option value="SOCKS5">SOCKS5</option>
                  </CustomSelect>
                </Field>
              </div>
              <div className="grid gap-4 lg:grid-cols-[1fr_160px]">
                <Field label="Host">
                  <Input value={proxyForm.host} onChange={(event) => updateProxyForm('host', event.target.value)} onPaste={handleProxyPaste} placeholder="127.0.0.1" required />
                </Field>
                <Field label="Port">
                  <Input value={proxyForm.port} onChange={(event) => updateProxyForm('port', event.target.value)} placeholder="8080" required />
                </Field>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Field label="Username">
                  <Input value={proxyForm.username} onChange={(event) => updateProxyForm('username', event.target.value)} placeholder="Optional" />
                </Field>
                <Field label="Password">
                  <Input type="password" value={proxyForm.password} onChange={(event) => updateProxyForm('password', event.target.value)} placeholder="Optional" />
                </Field>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setProxyOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Proxy'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --- BATCH IMPORT MODAL --- */}
      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent title="Batch add proxies" className="rounded border-border bg-card">
          <form onSubmit={handleBatchAdd}>
            <DialogHeader>
              <DialogTitle>Batch Add Proxies</DialogTitle>
              <DialogDescription>Paste one proxy per line. Supported format: <code className="font-mono text-muted-foreground">host:port:username:password</code>.</DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-5">
              <Field label="Default Type">
                <CustomSelect value={batchType} onChange={(event) => setBatchType(event.target.value)}>
                  <option value="HTTP">HTTP</option>
                  <option value="SOCKS5">SOCKS5</option>
                </CustomSelect>
              </Field>
              <Field label="Proxy Lines">
                <Textarea 
                  value={batchRaw} 
                  onChange={(event) => setBatchRaw(event.target.value)} 
                  rows={10} 
                  placeholder={`1.2.3.4:8080:user:pass\n5.6.7.8:9000:user2:pass2`} 
                  className="font-mono text-sm bg-background border-border"
                  required 
                />
              </Field>
              {batchResult ? (
                <div className="rounded border border-border bg-background p-4 text-sm">
                  <div className="font-medium text-foreground mb-2">Batch Result</div>
                  <div className="grid gap-2 text-muted sm:grid-cols-4 font-mono text-xs">
                    <div>Total: {batchResult.total}</div>
                    <div className="text-emerald-400">Created: {batchResult.created?.length ?? 0}</div>
                    <div className="text-amber-400">Skipped: {batchResult.skipped?.length ?? 0}</div>
                    <div className="text-red-400">Errors: {batchResult.errors?.length ?? 0}</div>
                  </div>
                  {batchResult.errors?.length ? (
                    <div className="mt-3 max-h-32 overflow-y-auto rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 font-mono">
                      {batchResult.errors.map((item) => (
                        <div key={`${item.line}-${item.raw}`}>Line {item.line}: {item.message}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setBatchOpen(false)} disabled={saving}>Close</Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Importing...' : 'Add Proxies'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --- CREATE / EDIT PROXY GROUP MODAL --- */}
      <Dialog open={Boolean(groupModal)} onOpenChange={(o) => { if (!o) setGroupModal(null); }}>
        <DialogContent title={groupModal?.id ? 'Edit group' : 'New group'} className="rounded border-border bg-card">
          <form onSubmit={(e) => { e.preventDefault(); saveGroup(); }}>
            <DialogHeader>
              <DialogTitle>{groupModal?.id ? 'Edit Proxy Group' : 'New Proxy Group'}</DialogTitle>
              <DialogDescription>Group proxies by country or purpose (e.g. USA, UK, Japan). You can target a group when batch-creating profiles.</DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-5">
              <Field label="Group Name">
                <Input value={groupModal?.name || ''} onChange={(e) => setGroupModal((m) => ({ ...m, name: e.target.value }))} placeholder="USA Proxies" autoFocus required />
              </Field>
              <Field label="Color">
                <div className="flex flex-wrap gap-2">
                  {GROUP_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setGroupModal((m) => ({ ...m, color: c }))}
                      className={`w-7 h-7 rounded-full transition-transform ${groupModal?.color === c ? 'ring-2 ring-offset-2 ring-offset-card ring-white scale-110' : 'hover:scale-110'}`}
                      style={{ background: c }}
                      aria-label={`Color ${c}`}
                    />
                  ))}
                </div>
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setGroupModal(null)}>Cancel</Button>
              <Button type="submit" variant="primary">{groupModal?.id ? 'Save Changes' : 'Create Group'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}