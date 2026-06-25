import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Copy, Check, Edit, Loader2, Plus, RefreshCcw, Search, Trash2, Upload, ChevronDown, X, Globe, Wifi, ShieldCheck, ShieldOff, Server, Boxes } from 'lucide-react';

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

  useEffect(() => {
    softglazeApi.settings.getProxyPolicy()
      .then((p) => { if (p && p.default) setProxyPolicy(p.default); })
      .catch(() => {});
  }, []);

  const isEditing = Boolean(proxyForm.id);
  const filteredProxies = useMemo(() => proxies, [proxies]);

  const allSelected = proxies.length > 0 && proxies.every((p) => selectedIds.has(p.id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  const loadProxies = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await softglazeApi.proxies.list({ search });
      setProxies(list);
      // Drop any selected ids that no longer exist after a reload.
      setSelectedIds((prev) => {
        const live = new Set(list.map((p) => p.id));
        const next = new Set();
        prev.forEach((id) => { if (live.has(id)) next.add(id); });
        return next;
      });
    } catch (err) {
      setError(err.message || 'Failed to load proxies.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(() => (allSelected ? new Set() : new Set(proxies.map((p) => p.id))));
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
        } catch (err) {
          setCheckResults((prev) => ({ ...prev, [id]: { success: false, error: err.message } }));
        }
      }
    } finally {
      setCheckingId(null);
      setCheckingAll(false);
    }
  }

  useEffect(() => { loadProxies(); }, [loadProxies]);

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
      const list = await softglazeApi.proxies.list({ search });
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

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm">
          <span className="font-medium text-foreground">{selectedIds.size} selected</span>
          <div className="w-px h-5 bg-border" />
          <Button size="sm" variant="secondary" onClick={handleBulkCheck} disabled={checkingAll || bulkDeleting}>
            {checkingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />} Check selected
          </Button>
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
            <div className="w-full overflow-x-auto">
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
                    <th className="px-5 py-4">Profiles</th>
                    <th className="px-5 py-4">Created</th>
                    <th className="px-5 py-4">Status</th>
                    <th className="px-5 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredProxies.map((proxy) => (
                    <tr key={proxy.id} className={`transition-colors ${selectedIds.has(proxy.id) ? 'bg-primary/5' : 'hover:bg-card/50'}`}>
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
                      <td className="px-5 py-4 text-muted">{proxy.profileCount ?? 0}</td>
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
    </div>
  );
}