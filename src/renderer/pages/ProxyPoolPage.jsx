import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Edit, Loader2, Plus, RefreshCcw, Search, Trash2, Upload, ChevronDown } from 'lucide-react';

import EmptyState from '@/components/EmptyState.jsx';
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
      className="w-full appearance-none bg-background border border-border rounded pl-3 pr-9 py-2 text-zinc-100 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition disabled:opacity-50 text-ellipsis overflow-hidden whitespace-nowrap cursor-pointer hover:border-muted-dark"
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

  const isEditing = Boolean(proxyForm.id);
  const filteredProxies = useMemo(() => proxies, [proxies]);

  const loadProxies = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setProxies(await softglazeApi.proxies.list({ search }));
    } catch (err) {
      setError(err.message || 'Failed to load proxies.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { loadProxies(); }, [loadProxies]);

  function updateProxyForm(key, value) {
    setProxyForm((current) => ({ ...current, [key]: value }));
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

  return (
    <div className="flex flex-col h-full space-y-4 pb-10">
      <PageHeader
        eyebrow="Network"
        title="Proxy Pool"
        description="Store reusable HTTP and SOCKS5 proxies locally. Batch input supports host:port:username:password lines."
        actions={
          <>
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
        }
      />

      {error && <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}

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
                    <tr key={proxy.id} className="hover:bg-card/50 transition-colors">
                      <td className="px-5 py-4 font-medium text-zinc-100">{proxy.name}</td>
                      <td className="px-5 py-4">
                        <Badge variant={proxy.type === 'SOCKS5' ? 'amber' : 'blue'}>{proxy.type}</Badge>
                      </td>
                      <td className="px-5 py-4">
                        <code className="rounded bg-background border border-border px-2 py-1 text-xs font-mono text-zinc-300">
                          {proxy.host}:{proxy.port}
                        </code>
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
                  <Input value={proxyForm.host} onChange={(event) => updateProxyForm('host', event.target.value)} placeholder="127.0.0.1" required />
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
              <DialogDescription>Paste one proxy per line. Supported format: <code className="font-mono text-zinc-300">host:port:username:password</code>.</DialogDescription>
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
                  <div className="font-medium text-zinc-100 mb-2">Batch Result</div>
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