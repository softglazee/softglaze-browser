import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IdCard, Users, Sparkles, CheckCircle2, Hash, Plus, Upload, RefreshCcw, Search,
  Trash2, Edit, Loader2, X, RotateCcw, FileSpreadsheet, ChevronDown, ArrowLeft, Eye, EyeOff
} from 'lucide-react';

import EmptyState from '@/components/EmptyState.jsx';
import PageHeader from '@/components/PageHeader.jsx';
import Badge from '@/components/ui/Badge.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card, CardContent } from '@/components/ui/Card.jsx';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/Dialog.jsx';
import Input from '@/components/ui/Input.jsx';
import Pager from '@/components/ui/Pager.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { formatDateTime } from '@/lib/utils.js';

// The five fields the schema requires (NOT NULL). Marked with * in the forms.
const CORE_FIELDS = new Set(['firstName', 'lastName', 'email', 'username', 'password']);

// Every persona field, with a label and import-header aliases for auto-mapping.
const FIELD_DEFS = [
  { key: 'firstName', label: 'First name', aliases: ['first name', 'firstname', 'first', 'given name', 'fname'] },
  { key: 'lastName', label: 'Last name', aliases: ['last name', 'lastname', 'last', 'surname', 'family name', 'lname'] },
  { key: 'email', label: 'Email', aliases: ['email', 'e-mail', 'email address', 'mail'] },
  { key: 'username', label: 'Username', aliases: ['username', 'user name', 'user', 'login', 'handle', 'nick'] },
  { key: 'password', label: 'Password', aliases: ['password', 'pass', 'pwd', 'passcode'] },
  { key: 'phone', label: 'Phone', aliases: ['phone', 'phone number', 'mobile', 'cell', 'tel', 'telephone'] },
  { key: 'dateOfBirth', label: 'Date of birth', aliases: ['date of birth', 'dob', 'birthday', 'birth date', 'birthdate'] },
  { key: 'addressLine1', label: 'Address line 1', aliases: ['address line 1', 'address1', 'address 1', 'address', 'street', 'street address'] },
  { key: 'addressLine2', label: 'Address line 2', aliases: ['address line 2', 'address2', 'address 2', 'apt', 'suite', 'unit'] },
  { key: 'city', label: 'City', aliases: ['city', 'town'] },
  { key: 'state', label: 'State / Province', aliases: ['state', 'province', 'region'] },
  { key: 'zipCode', label: 'Zip / Postal', aliases: ['zip', 'zip code', 'zipcode', 'postal code', 'postcode', 'postal'] },
  { key: 'country', label: 'Country', aliases: ['country', 'nation', 'country/region'] },
  { key: 'company', label: 'Company', aliases: ['company', 'organization', 'organisation', 'employer', 'business'] },
  { key: 'label', label: 'Batch label', aliases: ['label', 'batch', 'batch label', 'tag', 'group'] }
];
const FIELD_LABEL = Object.fromEntries(FIELD_DEFS.map((f) => [f.key, f.label]));

// Form layout — fields grouped into sections (mirrors the schema's natural shape).
const FORM_GROUPS = [
  { title: 'Identity', fields: ['firstName', 'lastName', 'dateOfBirth', 'phone'] },
  { title: 'Account', fields: ['email', 'username', 'password'] },
  { title: 'Address', fields: ['addressLine1', 'addressLine2', 'city', 'state', 'zipCode', 'country'] },
  { title: 'Meta', fields: ['company', 'label'] }
];

const EMPTY_FORM = {
  id: null, label: '', firstName: '', lastName: '', email: '', username: '', password: '',
  phone: '', dateOfBirth: '', addressLine1: '', addressLine2: '', city: '', state: '',
  zipCode: '', country: '', company: ''
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Best-effort header→field guess, mirroring importParser's alias matching. Each
// header is claimed by at most one field (exact alias wins over fuzzy contains).
function autoGuessMapping(headers) {
  const used = new Set();
  const map = {};
  const nh = headers.map(norm);
  for (const def of FIELD_DEFS) {
    let idx = -1;
    for (const a of def.aliases) {
      const na = norm(a);
      const i = nh.findIndex((h, j) => h === na && !used.has(headers[j]));
      if (i >= 0) { idx = i; break; }
    }
    if (idx < 0) {
      for (const a of def.aliases) {
        const na = norm(a);
        const i = nh.findIndex((h, j) => h && !used.has(headers[j]) && (h.includes(na) || na.includes(h)));
        if (i >= 0) { idx = i; break; }
      }
    }
    if (idx >= 0) { map[def.key] = headers[idx]; used.add(headers[idx]); } else { map[def.key] = ''; }
  }
  return map;
}

// Tinted, clickable stat card (matches the Proxy Pool / Extensions cards). Shows an
// accent ring while it's the active filter.
function StatCard({ icon: Icon, label, value, color, onClick, active }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`rounded-xl p-4 relative overflow-hidden group animate-fade-up text-left w-full ${onClick ? 'cursor-pointer transition-transform hover:-translate-y-0.5' : ''}`}
      style={{ background: `color-mix(in srgb, ${color} 8%, var(--card))`, border: `1px solid ${active ? color : `color-mix(in srgb, ${color} 20%, transparent)`}`, boxShadow: active ? `0 0 0 1px ${color}` : undefined }}
    >
      <div className="absolute -top-5 -right-5 w-16 h-16 rounded-full opacity-10 group-hover:opacity-20 transition-opacity" style={{ background: color, filter: 'blur(18px)' }} />
      <div className="relative z-10 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 28%, transparent)` }}>
          <Icon className="w-[18px] h-[18px]" style={{ color }} />
        </div>
        <div className="min-w-0">
          <p className="text-[18px] font-bold text-foreground font-display leading-none">{value}</p>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">{label}{onClick && active ? ' · filtering' : ''}</p>
        </div>
      </div>
    </Tag>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}{required ? <span className="text-primary"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

// A native select styled to match the design system (used by the import mapper).
function MapSelect({ value, onChange, headers }) {
  return (
    <div className="relative flex items-center">
      <select
        value={value}
        onChange={onChange}
        className="w-full appearance-none bg-input-background border border-border rounded pl-3 pr-9 py-2 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition cursor-pointer text-ellipsis overflow-hidden whitespace-nowrap"
      >
        <option value="">— skip —</option>
        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <div className="absolute right-3 pointer-events-none text-muted-foreground"><ChevronDown className="w-4 h-4" /></div>
    </div>
  );
}

// Compose a short single-line address from the parts.
function addressOf(p) {
  return [p.addressLine1, p.addressLine2, p.city, p.state, p.zipCode, p.country].filter(Boolean).join(', ');
}

// Password cell: masked by default, click the eye to reveal (demo-vault data).
function PasswordCell({ value }) {
  const [show, setShow] = useState(false);
  if (!value) return <span className="text-muted-dark">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-[12px] text-muted-foreground">{show ? value : '••••••••'}</span>
      <button type="button" onClick={() => setShow((s) => !s)} className="text-muted-foreground hover:text-foreground" title={show ? 'Hide' : 'Reveal'}>
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </span>
  );
}

export default function PersonasPage() {
  const [personas, setPersonas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [usageFilter, setUsageFilter] = useState('all'); // 'all' | 'unused' | 'used'
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  // Manual add / edit modal
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Import modal
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState(1); // 1 = pick file, 2 = map columns
  const [preview, setPreview] = useState(null); // { fileName, headers, rows }
  const [mapping, setMapping] = useState({});
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importResult, setImportResult] = useState(null);

  const isEditing = Boolean(form.id);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await softglazeApi.personas.getAll();
      const list = Array.isArray(res?.personas) ? res.personas : [];
      setPersonas(list);
      setSelectedIds((prev) => {
        const live = new Set(list.map((p) => p.id));
        const next = new Set();
        prev.forEach((id) => { if (live.has(id)) next.add(id); });
        return next;
      });
    } catch (e) {
      setError(e.message || 'Could not load the data vault.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return personas.filter((p) => {
      if (usageFilter === 'unused' && p.usedCount > 0) return false;
      if (usageFilter === 'used' && p.usedCount === 0) return false;
      if (q) {
        const hay = `${p.firstName || ''} ${p.lastName || ''} ${p.email || ''} ${p.username || ''} ${p.label || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [personas, search, usageFilter]);

  const pageCount = pageSize === Infinity ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const paged = pageSize === Infinity ? filtered : filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  useEffect(() => { setPage(1); }, [search, usageFilter, pageSize]);

  const allSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  const totalUses = personas.reduce((acc, p) => acc + (p.usedCount || 0), 0);
  const neverUsed = personas.filter((p) => p.usedCount === 0).length;
  const everUsed = personas.length - neverUsed;
  const setFilter = (f) => setUsageFilter((cur) => (cur === f ? 'all' : f));

  function toggleSelect(id) {
    setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleSelectAll() {
    setSelectedIds(() => (allSelected ? new Set() : new Set(filtered.map((p) => p.id))));
  }
  function clearSelection() { setSelectedIds(new Set()); }

  // --- Manual add / edit ---
  function openCreate() { setForm(EMPTY_FORM); setFormError(''); setFormOpen(true); }
  function openEdit(p) {
    setForm({
      id: p.id, label: p.label || '', firstName: p.firstName || '', lastName: p.lastName || '',
      email: p.email || '', username: p.username || '', password: p.password || '', phone: p.phone || '',
      dateOfBirth: p.dateOfBirth || '', addressLine1: p.addressLine1 || '', addressLine2: p.addressLine2 || '',
      city: p.city || '', state: p.state || '', zipCode: p.zipCode || '', country: p.country || '', company: p.company || ''
    });
    setFormError('');
    setFormOpen(true);
  }
  function updateForm(key, value) { setForm((c) => ({ ...c, [key]: value })); }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const { id, ...fields } = form;
      if (id) await softglazeApi.personas.update({ id, ...fields });
      else await softglazeApi.personas.createManual(fields);
      setFormOpen(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setFormError(err.message || 'Could not save this identity.');
    } finally {
      setSaving(false);
    }
  }

  // --- Row + bulk actions ---
  async function handleDeleteOne(p) {
    if (!window.confirm(`Delete identity "${[p.firstName, p.lastName].filter(Boolean).join(' ') || p.email || p.username || 'persona'}"? This cannot be undone.`)) return;
    setError('');
    try { await softglazeApi.personas.delete({ ids: [p.id] }); await load(); }
    catch (err) { setError(err.message || 'Could not delete the identity.'); }
  }

  async function handleDeleteSelected() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} selected ${ids.length === 1 ? 'identity' : 'identities'}? This cannot be undone.`)) return;
    setBusy(true);
    setError('');
    try { await softglazeApi.personas.delete({ ids }); clearSelection(); await load(); }
    catch (err) { setError(err.message || 'Could not delete the selected identities.'); }
    finally { setBusy(false); }
  }

  async function handleResetSelected() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(`Reset the "used on" history for ${ids.length} selected ${ids.length === 1 ? 'identity' : 'identities'}? They become available on every site again.`)) return;
    setBusy(true);
    setError('');
    try { await softglazeApi.personas.clearUsed({ ids }); clearSelection(); await load(); }
    catch (err) { setError(err.message || 'Could not reset the selected identities.'); }
    finally { setBusy(false); }
  }

  // --- Excel / CSV import ---
  function openImport() {
    setImportStep(1);
    setPreview(null);
    setMapping({});
    setImportError('');
    setImportResult(null);
    setImportOpen(true);
  }

  async function handlePickFile() {
    setImportError('');
    try {
      const res = await softglazeApi.personas.previewFile();
      if (!res || res.cancelled) return;
      if (!Array.isArray(res.headers) || res.headers.length === 0 || !Array.isArray(res.rows) || res.rows.length === 0) {
        setImportError('That file has no readable header row or data rows.');
        return;
      }
      setPreview(res);
      setMapping(autoGuessMapping(res.headers));
      setImportStep(2);
    } catch (err) {
      setImportError(err.message || 'Could not read that file.');
    }
  }

  async function handleImport() {
    if (!preview) return;
    setImporting(true);
    setImportError('');
    try {
      const arr = preview.rows.map((r) => {
        const o = {};
        for (const def of FIELD_DEFS) {
          const h = mapping[def.key];
          if (h && r[h] != null && String(r[h]).trim() !== '') o[def.key] = String(r[h]).trim();
        }
        return o;
      }).filter((o) => o.firstName || o.lastName || o.email || o.username);
      if (arr.length === 0) {
        setImportError('No rows to import — map at least one of First name / Last name / Email / Username.');
        setImporting(false);
        return;
      }
      const result = await softglazeApi.personas.importBatch(arr);
      setImportResult({ created: result?.created ?? 0, skipped: preview.rows.length - arr.length });
      await load();
    } catch (err) {
      setImportError(err.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  }

  const mappedFieldCount = useMemo(() => Object.values(mapping).filter(Boolean).length, [mapping]);

  return (
    <div className="flex flex-col h-full space-y-4 pb-10">
      <PageHeader
        eyebrow="Identities"
        title="Data Vault"
        description="A reusable vault of demo identities for the Smart Autofill engine. Add them manually or import a spreadsheet; each one remembers the sites it has already been used on."
        actions={
          <>
            <Button variant="secondary" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              Refresh
            </Button>
            <Button variant="secondary" onClick={openImport}>
              <Upload className="h-4 w-4" /> Import Excel/CSV
            </Button>
            <Button variant="primary" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add manually
            </Button>
          </>
        }
      />

      {/* STATS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Total identities" value={personas.length} color="#8b5cf6" onClick={() => setUsageFilter('all')} active={usageFilter === 'all'} />
        <StatCard icon={Sparkles} label="Never used" value={neverUsed} color="#10b981" onClick={() => setFilter('unused')} active={usageFilter === 'unused'} />
        <StatCard icon={CheckCircle2} label="Used at least once" value={everUsed} color="#3b82f6" onClick={() => setFilter('used')} active={usageFilter === 'used'} />
        <StatCard icon={Hash} label="Total uses" value={totalUses} color="#f59e0b" />
      </div>

      {error && <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}

      {/* TOOLBAR */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[220px]">
          <Input icon={Search} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, email, username, or label..." />
        </div>
        {usageFilter !== 'all' && (
          <span className="text-[12px] text-muted-foreground">
            Showing {filtered.length} {usageFilter === 'unused' ? 'never-used' : 'used'} · <button className="text-primary hover:underline" onClick={() => setUsageFilter('all')}>clear</button>
          </span>
        )}
      </div>

      {/* BULK BAR */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm">
          <span className="font-medium text-foreground">{selectedIds.size} selected</span>
          <div className="w-px h-5 bg-border" />
          <Button size="sm" variant="secondary" onClick={handleResetSelected} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Reset used status
          </Button>
          <Button size="sm" variant="danger" onClick={handleDeleteSelected} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete selected
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection} className="ml-auto px-2.5" title="Clear selection">
            <X className="h-4 w-4" /> Clear
          </Button>
        </div>
      )}

      {/* TABLE */}
      <Card className="bg-surface border-border flex flex-col shadow-xl flex-1 min-h-0 rounded">
        <CardContent className="p-0 overflow-auto flex-1 min-h-0 rounded">
          {loading ? (
            <div className="p-12 text-sm text-muted-foreground text-center flex flex-col items-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-primary" /> Loading identities...
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12">
              <EmptyState
                title={personas.length === 0 ? 'Your data vault is empty' : 'No identities match your filter'}
                description={personas.length === 0
                  ? 'Add an identity manually or import an Excel/CSV sheet to start building your autofill vault.'
                  : 'Try a different search, or clear the filter.'}
              />
            </div>
          ) : (
            <div className="w-full">
              <table className="w-full min-w-[1200px] border-collapse text-left text-sm whitespace-nowrap">
                <thead className="bg-surface text-muted-foreground text-xs uppercase tracking-wider font-semibold border-b border-border sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-5 py-4 w-10">
                      <input
                        type="checkbox"
                        aria-label="Select all identities"
                        className="h-4 w-4 cursor-pointer accent-primary align-middle"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected; }}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th className="px-5 py-4">Name</th>
                    <th className="px-5 py-4">Email</th>
                    <th className="px-5 py-4">Username</th>
                    <th className="px-5 py-4">Password</th>
                    <th className="px-5 py-4">Phone</th>
                    <th className="px-5 py-4">Address</th>
                    <th className="px-5 py-4">Label</th>
                    <th className="px-5 py-4">Times used</th>
                    <th className="px-5 py-4">Created</th>
                    <th className="px-5 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paged.map((p) => {
                    const name = [p.firstName, p.lastName].filter(Boolean).join(' ') || '—';
                    return (
                      <tr key={p.id} className={`group/row transition-colors ${selectedIds.has(p.id) ? 'bg-primary/5' : 'hover:bg-card/50'}`}>
                        <td className="px-5 py-4">
                          <input
                            type="checkbox"
                            aria-label={`Select ${name}`}
                            className="h-4 w-4 cursor-pointer accent-primary align-middle"
                            checked={selectedIds.has(p.id)}
                            onChange={() => toggleSelect(p.id)}
                          />
                        </td>
                        <td className="px-5 py-4 font-medium text-foreground">{name}</td>
                        <td className="px-5 py-4 text-muted-foreground">{p.email || '—'}</td>
                        <td className="px-5 py-4 text-muted-foreground">{p.username || '—'}</td>
                        <td className="px-5 py-4"><PasswordCell value={p.password} /></td>
                        <td className="px-5 py-4 text-muted-foreground">{p.phone || '—'}</td>
                        <td className="px-5 py-4 text-muted-foreground max-w-[240px] truncate" title={addressOf(p)}>{addressOf(p) || '—'}</td>
                        <td className="px-5 py-4">{p.label ? <Badge variant="blue">{p.label}</Badge> : <span className="text-muted-dark">—</span>}</td>
                        <td className="px-5 py-4">
                          {p.usedCount > 0
                            ? <Badge variant="amber" title={p.usedOnUrls?.join(', ')}>{p.usedCount} site{p.usedCount === 1 ? '' : 's'}</Badge>
                            : <span className="text-xs text-muted-foreground">Never</span>}
                        </td>
                        <td className="px-5 py-4 text-muted-foreground text-xs">{formatDateTime(p.createdAt)}</td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-1.5 transition-opacity opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100">
                            <Button size="sm" variant="ghost" onClick={() => openEdit(p)} className="px-2.5" title="Edit identity">
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => handleDeleteOne(p)} className="px-2.5 text-red-400 hover:text-red-300 hover:bg-red-500/10" title="Delete identity">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
        {!loading && filtered.length > 0 && (
          <div className="shrink-0 border-t border-border bg-card/95 px-4 py-2.5 rounded-b">
            <Pager total={filtered.length} page={safePage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
          </div>
        )}
      </Card>

      {/* --- ADD / EDIT MODAL --- */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent title={isEditing ? 'Edit identity' : 'Add identity'} className="rounded border-border bg-card flex flex-col max-h-[88vh]">
          <form onSubmit={handleSave} className="flex flex-col min-h-0">
            <DialogHeader>
              <DialogTitle>{isEditing ? 'Edit Identity' : 'Add Identity'}</DialogTitle>
              <DialogDescription>{isEditing ? 'Update this persona\'s details.' : 'Add a single persona to your data vault. Fields marked * are required.'}</DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-6 overflow-y-auto">
              {FORM_GROUPS.map((group) => (
                <div key={group.title}>
                  <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.16em] text-primary">{group.title}</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {group.fields.map((key) => (
                      <Field key={key} label={FIELD_LABEL[key]} required={CORE_FIELDS.has(key)}>
                        <Input
                          value={form[key]}
                          onChange={(e) => updateForm(key, e.target.value)}
                          required={CORE_FIELDS.has(key)}
                          placeholder={FIELD_LABEL[key]}
                        />
                      </Field>
                    ))}
                  </div>
                </div>
              ))}
              {formError && (
                <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">{formError}</div>
              )}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving} type="button">Cancel</Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Add Identity'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --- IMPORT MODAL --- */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent title="Import identities" className="rounded border-border bg-card flex flex-col max-h-[88vh]">
          <DialogHeader>
            <DialogTitle>Import from Excel / CSV</DialogTitle>
            <DialogDescription>
              {importStep === 1
                ? 'Choose an .xlsx, .xls, or .csv file. The first row should be your column headers. Up to 1000 rows per import.'
                : `Map your columns to identity fields. Detected ${preview?.rows?.length ?? 0} row(s) in ${preview?.fileName || 'your file'}.`}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-5 overflow-y-auto">
            {importResult ? (
              <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
                <div className="font-medium text-foreground mb-1">Import complete</div>
                <div className="text-muted-foreground">
                  Added <span className="text-emerald-400 font-semibold">{importResult.created}</span> identit{importResult.created === 1 ? 'y' : 'ies'} to the vault.
                  {importResult.skipped > 0 ? ` Skipped ${importResult.skipped} empty row${importResult.skipped === 1 ? '' : 's'}.` : ''}
                </div>
              </div>
            ) : importStep === 1 ? (
              <button
                type="button"
                onClick={handlePickFile}
                className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-background/50 px-6 py-12 text-center transition-colors hover:border-primary hover:bg-primary/[0.04]"
              >
                <div className="w-12 h-12 rounded-xl grid place-items-center" style={{ background: 'color-mix(in srgb, var(--primary) 14%, transparent)' }}>
                  <FileSpreadsheet className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Choose a spreadsheet</p>
                  <p className="text-xs text-muted-foreground mt-1">.xlsx · .xls · .csv</p>
                </div>
              </button>
            ) : (
              <div className="grid gap-3">
                <div className="grid grid-cols-[1fr_1.2fr] gap-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
                  <span>Identity field</span><span>Your column</span>
                </div>
                {FIELD_DEFS.map((def) => (
                  <div key={def.key} className="grid grid-cols-[1fr_1.2fr] gap-3 items-center">
                    <span className="text-sm text-foreground">
                      {def.label}{CORE_FIELDS.has(def.key) ? <span className="text-primary"> *</span> : null}
                    </span>
                    <MapSelect
                      value={mapping[def.key] || ''}
                      onChange={(e) => setMapping((m) => ({ ...m, [def.key]: e.target.value }))}
                      headers={preview?.headers || []}
                    />
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground mt-1">{mappedFieldCount} field{mappedFieldCount === 1 ? '' : 's'} mapped. Rows with no name/email/username are skipped.</p>
              </div>
            )}
            {importError && (
              <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">{importError}</div>
            )}
          </DialogBody>
          <DialogFooter>
            {importResult ? (
              <Button variant="primary" onClick={() => setImportOpen(false)} type="button">Done</Button>
            ) : importStep === 1 ? (
              <Button variant="ghost" onClick={() => setImportOpen(false)} type="button">Cancel</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => { setImportStep(1); setPreview(null); setImportError(''); }} disabled={importing} type="button">
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
                <Button variant="primary" onClick={handleImport} disabled={importing} type="button">
                  {importing ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing...</> : <>Import {preview?.rows?.length ?? 0} row{(preview?.rows?.length ?? 0) === 1 ? '' : 's'}</>}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
