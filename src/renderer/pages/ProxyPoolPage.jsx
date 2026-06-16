import { useCallback, useEffect, useMemo, useState } from 'react';
import { Edit, Plus, RefreshCcw, Search, Trash2, Upload } from 'lucide-react';

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
  return <label className="block"><span className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>{children}</label>;
}
function NativeSelect({ value, onChange, children }) {
  return <select value={value} onChange={onChange} className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400">{children}</select>;
}

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
    <>
      <PageHeader
        eyebrow="Network"
        title="Proxy Pool"
        description="Store reusable HTTP and SOCKS5 proxies locally. Batch input supports host:port:username:password lines."
        actions={<><Button variant="outline" onClick={loadProxies}><RefreshCcw className="h-4 w-4" />Refresh</Button><Button variant="secondary" onClick={() => setBatchOpen(true)}><Upload className="h-4 w-4" />Batch Add</Button><Button onClick={openCreate}><Plus className="h-4 w-4" />New Proxy</Button></>}
      />

      {error ? <div className="mb-4 rounded-lg border border-red-900/70 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}

      <div className="mb-4"><div className="relative max-w-2xl"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by proxy name, host, or username..." className="pl-9" /></div></div>

      <Card><CardContent className="p-0">
        {loading ? <div className="p-8 text-sm text-slate-400">Loading proxies...</div> : filteredProxies.length === 0 ? <div className="p-5"><EmptyState title="No proxies found" description="Add a proxy manually or paste a batch of proxy strings." /></div> : (
          <div className="w-full overflow-x-auto"><table className="w-full min-w-[1000px] border-collapse text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-medium">Name</th><th className="px-5 py-3 font-medium">Type</th><th className="px-5 py-3 font-medium">Endpoint</th><th className="px-5 py-3 font-medium">Username</th><th className="px-5 py-3 font-medium">Profiles</th><th className="px-5 py-3 font-medium">Created</th><th className="px-5 py-3 text-right font-medium">Actions</th></tr></thead>
            <tbody>{filteredProxies.map((proxy) => <tr key={proxy.id} className="border-b border-slate-900 transition hover:bg-slate-900/45"><td className="px-5 py-4 font-medium text-slate-100">{proxy.name}</td><td className="px-5 py-4"><Badge variant={proxy.type === 'SOCKS5' ? 'amber' : 'blue'}>{proxy.type}</Badge></td><td className="px-5 py-4"><code className="rounded bg-slate-900 px-2 py-1 text-xs text-slate-300">{proxy.host}:{proxy.port}</code></td><td className="px-5 py-4 text-slate-400">{proxy.username || '—'}</td><td className="px-5 py-4 text-slate-400">{proxy.profileCount ?? 0}</td><td className="px-5 py-4 text-slate-400">{formatDateTime(proxy.createdAt)}</td><td className="px-5 py-4"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => openEdit(proxy)}><Edit className="h-3.5 w-3.5" /></Button><Button size="sm" variant="destructive" onClick={() => handleDelete(proxy)}><Trash2 className="h-3.5 w-3.5" /></Button></div></td></tr>)}</tbody>
          </table></div>
        )}
      </CardContent></Card>

      <Dialog open={proxyOpen} onOpenChange={setProxyOpen}><DialogContent title={isEditing ? 'Edit proxy' : 'Create proxy'}><form onSubmit={handleSaveProxy}><DialogHeader><DialogTitle>{isEditing ? 'Edit Proxy' : 'Create Proxy'}</DialogTitle><DialogDescription>{isEditing ? 'Update an existing proxy. Leave the masked password unchanged to keep the current value.' : 'Add a single structured proxy to the local SQLite pool.'}</DialogDescription></DialogHeader><DialogBody className="grid gap-4"><div className="grid gap-4 lg:grid-cols-2"><Field label="Proxy Name"><Input value={proxyForm.name} onChange={(event) => updateProxyForm('name', event.target.value)} placeholder="Residential US 01" required /></Field><Field label="Type"><NativeSelect value={proxyForm.type} onChange={(event) => updateProxyForm('type', event.target.value)}><option value="HTTP">HTTP</option><option value="SOCKS5">SOCKS5</option></NativeSelect></Field></div><div className="grid gap-4 lg:grid-cols-[1fr_160px]"><Field label="Host"><Input value={proxyForm.host} onChange={(event) => updateProxyForm('host', event.target.value)} placeholder="127.0.0.1" required /></Field><Field label="Port"><Input value={proxyForm.port} onChange={(event) => updateProxyForm('port', event.target.value)} placeholder="8080" required /></Field></div><div className="grid gap-4 lg:grid-cols-2"><Field label="Username"><Input value={proxyForm.username} onChange={(event) => updateProxyForm('username', event.target.value)} placeholder="Optional" /></Field><Field label="Password"><Input type="password" value={proxyForm.password} onChange={(event) => updateProxyForm('password', event.target.value)} placeholder="Optional" /></Field></div></DialogBody><DialogFooter><Button variant="ghost" onClick={() => setProxyOpen(false)} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Proxy'}</Button></DialogFooter></form></DialogContent></Dialog>

      <Dialog open={batchOpen} onOpenChange={setBatchOpen}><DialogContent title="Batch add proxies"><form onSubmit={handleBatchAdd}><DialogHeader><DialogTitle>Batch Add Proxies</DialogTitle><DialogDescription>Paste one proxy per line. Supported format: host:port:username:password.</DialogDescription></DialogHeader><DialogBody className="grid gap-4"><Field label="Default Type"><NativeSelect value={batchType} onChange={(event) => setBatchType(event.target.value)}><option value="HTTP">HTTP</option><option value="SOCKS5">SOCKS5</option></NativeSelect></Field><Field label="Proxy Lines"><Textarea value={batchRaw} onChange={(event) => setBatchRaw(event.target.value)} rows={10} placeholder={`1.2.3.4:8080:user:pass\n5.6.7.8:9000:user2:pass2`} required /></Field>{batchResult ? <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm"><div className="font-medium text-slate-100">Batch Result</div><div className="mt-2 grid gap-2 text-slate-400 sm:grid-cols-4"><div>Total: {batchResult.total}</div><div>Created: {batchResult.created?.length ?? 0}</div><div>Skipped: {batchResult.skipped?.length ?? 0}</div><div>Errors: {batchResult.errors?.length ?? 0}</div></div>{batchResult.errors?.length ? <div className="mt-3 max-h-32 overflow-y-auto rounded border border-red-900/50 bg-red-950/30 p-3 text-xs text-red-200">{batchResult.errors.map((item) => <div key={`${item.line}-${item.raw}`}>Line {item.line}: {item.message}</div>)}</div> : null}</div> : null}</DialogBody><DialogFooter><Button variant="ghost" onClick={() => setBatchOpen(false)} disabled={saving}>Close</Button><Button type="submit" disabled={saving}>{saving ? 'Importing...' : 'Add Proxies'}</Button></DialogFooter></form></DialogContent></Dialog>
    </>
  );
}
