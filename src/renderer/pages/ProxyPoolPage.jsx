import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Copy, Check, Edit, Loader2, Plus, RefreshCcw, Search, Trash2, Upload, ChevronDown, X, Globe, Wifi, ShieldCheck, ShieldOff, Server, Boxes, FolderPlus, Folder, Tag, GripVertical, FolderInput, AlertTriangle } from 'lucide-react';

// Live-checker log level → colour, health grade → colour, and a short duration format.
const CHECK_LEVEL_COLOR = { INFO: 'text-sky-300', SUCCESS: 'text-emerald-400', WARN: 'text-amber-400', ERROR: 'text-red-400' };
const GRADE_COLOR = { A: 'text-emerald-400', B: 'text-lime-400', C: 'text-amber-400', D: 'text-orange-400', F: 'text-red-400' };
function fmtDuration(ms) {
  if (ms == null) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

import EmptyState from '@/components/EmptyState.jsx';
import ProxyProviders from '@/components/ProxyProviders.jsx';
import { Donut, Legend, AreaChart } from '@/components/charts/Charts.jsx';
import { Clock, BarChart3, History } from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';
import Badge from '@/components/ui/Badge.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card, CardContent } from '@/components/ui/Card.jsx';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/Dialog.jsx';
import Input from '@/components/ui/Input.jsx';
import Textarea from '@/components/ui/Textarea.jsx';
import Pager from '@/components/ui/Pager.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { formatDateTime } from '@/lib/utils.js';

const initialProxyForm = { id: null, name: '', type: 'HTTP', host: '', port: '', username: '', password: '' };

// Friendly labels for the "auto group by provider" chips.
const PROVIDER_LABELS = {
  apify: 'Apify', shopsocks5: 'ShopSocks5', smartproxyorg: 'Smartproxy.org',
  smartproxy: 'Smartproxy', brightdata: 'Bright Data', oxylabs: 'Oxylabs', custom: 'Custom'
};
const GROUP_COLORS = ['#3b82f6', '#22c55e', '#ef4444', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4', '#84cc16'];

// A proxy's health bucket: a live check result wins; otherwise fall back to the
// persisted lastStatus. Drives both the stat-card counts and the status filter.
function proxyHealthOf(p, checkResults) {
  const r = checkResults[p.id];
  if (r) return r.success ? 'verified' : 'failed';
  if (p.lastStatus === 'ok') return 'verified';
  if (p.lastStatus === 'fail') return 'failed';
  return 'unknown';
}

// A proxy's blocklist bucket: a fresh check result wins over the persisted snapshot;
// 'unknown' if it was never DNSBL-checked.
function blacklistOf(p, checkResults) {
  const r = checkResults[p.id];
  if (r && r.blacklist && r.blacklist.checked) return r.blacklist.listed ? 'blacklisted' : 'clean';
  if (typeof p.lastBlacklisted === 'boolean') return p.lastBlacklisted ? 'blacklisted' : 'clean';
  return 'unknown';
}

// Figma-style compact stat card (tinted, glow, icon tile). When `onClick` is given
// it renders as a button and shows an accent ring while `active` (drives the filter).
function MiniStat({ icon: Icon, label, value, color, onClick, active }) {
  const { t } = useTranslation('proxies');
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
          <p className="text-[11px] text-muted-foreground mt-1 truncate">{label}{onClick && active ? ` · ${t('stats.filtering')}` : ''}</p>
        </div>
      </div>
    </Tag>
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
  const { t } = useTranslation('proxies');
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
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'verified' | 'failed' (driven by the stat cards)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [testingAll, setTestingAll] = useState(false);
  const [testSummary, setTestSummary] = useState(null);
  // Live streamed checker: progress + counts + ETA + running log.
  const [checkRun, setCheckRun] = useState(null);
  const [showCheckLog, setShowCheckLog] = useState(true); // collapse the log to keep the table large
  const checkLogRef = useRef(null);
  const loadProxiesRef = useRef(null);
  const [blacklistFilter, setBlacklistFilter] = useState('all'); // 'all' | 'clean' | 'blacklisted'
  const [proxyPolicy, setProxyPolicy] = useState('each-launch');
  // Proxy categories/groups + the active filter ('all' | 'none' | <groupId> | 'provider:<key>').
  const [groups, setGroups] = useState([]);
  const [activeGroup, setActiveGroup] = useState('all');
  const [groupModal, setGroupModal] = useState(null); // { id?, name, color } when creating/editing
  const [assignOpen, setAssignOpen] = useState(false);
  const [dragOverKey, setDragOverKey] = useState(null);
  // Auto-grouping by verified geo (Country / State / City).
  const [autoGroupLevel, setAutoGroupLevel] = useState('country');
  const [autoGrouping, setAutoGrouping] = useState(false);
  const [autoGroupMsg, setAutoGroupMsg] = useState('');
  // Phase D — proxy intelligence: latency sort, rotation tuning, scheduler, geo, history.
  const [sortBy, setSortBy] = useState('default'); // 'default' | 'fastest' | 'slowest'
  const [policyDetail, setPolicyDetail] = useState({ failoverMaxLatencyMs: 0, latencyTopN: 3 });
  const [scheduler, setScheduler] = useState({ enabled: false, minutes: 30 });
  const [showGeo, setShowGeo] = useState(false);
  const [historyProxy, setHistoryProxy] = useState(null);
  const [historyData, setHistoryData] = useState(null); // null = loading; [] = none

  useEffect(() => {
    softglazeApi.settings.getProxyPolicy()
      .then((p) => { if (p && p.default) { setProxyPolicy(p.default); setPolicyDetail({ failoverMaxLatencyMs: Number(p.failoverMaxLatencyMs) || 0, latencyTopN: Math.max(1, Number(p.latencyTopN) || 3) }); } })
      .catch(() => {});
    softglazeApi.settings.getProxyScheduler()
      .then((s) => { if (s) setScheduler({ enabled: Boolean(s.enabled), minutes: Number(s.minutes) || 30 }); })
      .catch(() => {});
  }, []);

  const isEditing = Boolean(proxyForm.id);

  // Distinct providers present in the pool (for the "auto group by provider" chips).
  const providerCounts = useMemo(() => {
    const m = {};
    for (const p of proxies) { if (p.provider) m[p.provider] = (m[p.provider] || 0) + 1; }
    return m;
  }, [proxies]);

  // Client-side filter: search text + active category (group / ungrouped / provider)
  // + the verified/failed status filter (driven by the clickable stat cards).
  const filteredProxies = useMemo(() => {
    const q = search.trim().toLowerCase();
    return proxies.filter((p) => {
      if (q) {
        const hay = `${p.name || ''} ${p.host || ''} ${p.username || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter !== 'all' && proxyHealthOf(p, checkResults) !== statusFilter) return false;
      if (blacklistFilter !== 'all' && blacklistOf(p, checkResults) !== blacklistFilter) return false;
      if (activeGroup === 'all') return true;
      if (activeGroup === 'none') return !p.proxyGroupId;
      if (typeof activeGroup === 'string' && activeGroup.startsWith('provider:')) return p.provider === activeGroup.slice(9);
      return String(p.proxyGroupId) === String(activeGroup);
    });
  }, [proxies, search, activeGroup, statusFilter, blacklistFilter, checkResults]);

  // Latency sort (live check result wins over the stored snapshot; unknown sinks last).
  const sortedProxies = useMemo(() => {
    if (sortBy === 'default') return filteredProxies;
    const lat = (p) => {
      const r = checkResults[p.id];
      const v = (r && typeof r.latencyMs === 'number') ? r.latencyMs : (typeof p.lastLatencyMs === 'number' ? p.lastLatencyMs : null);
      return v == null ? Infinity : v;
    };
    const arr = filteredProxies.slice().sort((a, b) => lat(a) - lat(b));
    return sortBy === 'slowest' ? arr.reverse() : arr;
  }, [filteredProxies, sortBy, checkResults]);

  // Geo breakdown of the whole pool by verified country (for the toggle-able panel).
  const geoBreakdown = useMemo(() => {
    const m = {};
    for (const p of proxies) { const c = p.lastCountry || t('geo.unknown'); m[c] = (m[c] || 0) + 1; }
    return Object.entries(m).map(([country, count]) => ({ country, count })).sort((a, b) => b.count - a.count);
  }, [proxies]);

  // Blocklist tallies for the filter chips (a fresh check wins over the stored value).
  const blCounts = useMemo(() => {
    let clean = 0, listed = 0;
    for (const p of proxies) { const b = blacklistOf(p, checkResults); if (b === 'clean') clean += 1; else if (b === 'blacklisted') listed += 1; }
    return { clean, listed };
  }, [proxies, checkResults]);

  // Pagination over the filtered+sorted set (keeps long lists fast; pager is pinned at
  // the bottom of the table card so you never scroll to the end to change pages).
  const pageCount = pageSize === Infinity ? 1 : Math.max(1, Math.ceil(sortedProxies.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pagedProxies = pageSize === Infinity ? sortedProxies : sortedProxies.slice((safePage - 1) * pageSize, safePage * pageSize);
  // Reset to page 1 whenever the filter/sort set changes out from under us.
  useEffect(() => { setPage(1); }, [search, activeGroup, statusFilter, blacklistFilter, pageSize, sortBy]);

  // Toggle a status filter from a stat card (clicking the active one clears it).
  const toggleStatusFilter = (s) => setStatusFilter((cur) => (cur === s ? 'all' : s));

  // Delete every proxy currently matched by the active filter/search.
  async function handleDeleteFiltered() {
    const ids = filteredProxies.map((p) => p.id);
    if (ids.length === 0) return;
    const scope = statusFilter !== 'all' ? statusFilter : (activeGroup !== 'all' ? 'filtered' : (search.trim() ? 'matching' : 'all'));
    const scopeLabel = t(`deleteFiltered.scope.${scope}`);
    if (!window.confirm(t('deleteFiltered.confirm', { count: ids.length, scope: scopeLabel }))) return;
    setBulkDeleting(true);
    setError('');
    try {
      await softglazeApi.proxies.bulkDelete(ids);
      clearSelection();
      await loadProxies();
    } catch (err) {
      setError(err.message || t('errors.deleteProxies'));
    } finally {
      setBulkDeleting(false);
    }
  }

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
      setError(err.message || t('errors.loadProxies'));
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
      setError(t('errors.copyClipboard'));
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(t('bulkDelete.confirm', { count: ids.length }))) return;
    setBulkDeleting(true);
    setError('');
    try {
      await softglazeApi.proxies.bulkDelete(ids);
      clearSelection();
      await loadProxies();
    } catch (err) {
      setError(err.message || t('errors.deleteSelected'));
    } finally {
      setBulkDeleting(false);
    }
  }

  // Deep-check the current selection (streamed, concurrent, with progress + log).
  async function handleBulkCheck() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    await startStreamCheck(ids);
  }

  // Kick off a streamed deep-check run. `ids` = a specific selection, or null/[] = all.
  async function startStreamCheck(ids) {
    setError('');
    setCheckingAll(true);
    setCheckRun({ running: true, runId: null, done: 0, total: (ids && ids.length) ? ids.length : proxies.length, percent: 0, ok: 0, fail: 0, etaMs: null, totalMs: null, logs: [] });
    try {
      const res = await softglazeApi.proxies.checkStream(ids && ids.length ? { ids } : {});
      setCheckRun((prev) => (prev ? { ...prev, runId: res && res.runId ? res.runId : null, total: res && typeof res.total === 'number' ? res.total : prev.total } : prev));
    } catch (err) {
      setError(err.message || t('errors.bulkTest'));
      setCheckingAll(false);
      setCheckRun((prev) => (prev ? { ...prev, running: false } : null));
    }
  }
  async function stopStreamCheck() {
    try { await softglazeApi.proxies.stopCheck(checkRun && checkRun.runId ? { runId: checkRun.runId } : {}); }
    catch (err) { /* the run ends on its own if the message is lost */ }
  }

  useEffect(() => { loadProxies(); loadGroups(); }, [loadProxies, loadGroups]);
  useEffect(() => { loadProxiesRef.current = loadProxies; }, [loadProxies]);

  // Subscribe once to the streamed proxy-checker progress. Each event updates the
  // progress bar/counts + appends a log line; per-proxy 'result' events also update
  // the inline row status. On finish, reload so persisted health/geo is reflected.
  useEffect(() => {
    if (!softglazeApi.proxies.onCheckProgress) return undefined;
    const off = softglazeApi.proxies.onCheckProgress((data) => {
      if (!data) return;
      setCheckRun((prev) => {
        const base = prev || { logs: [] };
        const logs = data.message ? [...base.logs.slice(-400), { level: data.level, message: data.message, ts: data.ts }] : base.logs;
        return {
          ...base,
          runId: data.runId ?? base.runId ?? null,
          running: !data.finished,
          done: data.done ?? base.done ?? 0,
          total: data.total ?? base.total ?? 0,
          percent: data.percent ?? base.percent ?? 0,
          ok: data.ok ?? base.ok ?? 0,
          fail: data.fail ?? base.fail ?? 0,
          etaMs: data.etaMs ?? (data.finished ? 0 : base.etaMs ?? null),
          totalMs: data.totalMs ?? base.totalMs ?? null,
          logs
        };
      });
      if (data.phase === 'result' && data.proxyId != null && data.result) {
        setCheckResults((prev) => ({ ...prev, [data.proxyId]: data.result }));
        applyGeoName(data.proxyId, data.result);
      }
      if (data.finished) { setCheckingAll(false); if (loadProxiesRef.current) loadProxiesRef.current(); }
    });
    return () => { try { off && off(); } catch (e) { /* ignore */ } };
  }, []);

  // Auto-scroll the checker log to the newest line.
  useEffect(() => { if (checkLogRef.current) checkLogRef.current.scrollTop = checkLogRef.current.scrollHeight; }, [checkRun && checkRun.logs && checkRun.logs.length]);

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
      setError(err.message || t('errors.saveProxy'));
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
      setError(err.message || t('errors.batchAdd'));
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

  // Deep-check every proxy (streamed, concurrent, with progress + log).
  async function handleCheckAll() {
    await startStreamCheck(null);
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
      setError(err.message || t('errors.bulkTest'));
    } finally {
      setTestingAll(false);
    }
  }

  async function applyProxyPolicy(mode) {
    setProxyPolicy(mode);
    try { await softglazeApi.settings.setProxyPolicy({ default: mode }); }
    catch (err) { setError(err.message || t('errors.savePolicy')); }
  }
  async function applyPolicyParam(patch) {
    setPolicyDetail((d) => ({ ...d, ...patch }));
    try { await softglazeApi.settings.setProxyPolicy(patch); }
    catch (err) { setError(err.message || t('errors.savePolicy')); }
  }
  async function applyScheduler(next) {
    setScheduler(next);
    try { await softglazeApi.settings.setProxyScheduler(next); }
    catch (err) { setError(err.message || t('errors.saveSchedule')); }
  }
  async function openHistory(proxy) {
    setHistoryProxy(proxy);
    setHistoryData(null);
    try { const ev = await softglazeApi.proxies.healthHistory(proxy.id); setHistoryData(Array.isArray(ev) ? ev : []); }
    catch (e) { setHistoryData([]); }
  }

  // --- Proxy groups: create / edit / delete / assign / drag-drop ---
  async function saveGroup() {
    const m = groupModal;
    if (!m) return;
    const name = (m.name || '').trim();
    if (!name) { setError(t('errors.enterGroupName')); return; }
    try {
      if (m.id) await softglazeApi.proxyGroups.update({ id: m.id, name, color: m.color });
      else await softglazeApi.proxyGroups.create({ name, color: m.color });
      setGroupModal(null);
      await loadGroups();
    } catch (err) { setError(err.message || t('errors.saveGroup')); }
  }

  async function removeGroup(g) {
    if (!window.confirm(t('groups.deleteConfirm', { name: g.name }))) return;
    try {
      await softglazeApi.proxyGroups.delete(g.id);
      if (String(activeGroup) === String(g.id)) setActiveGroup('all');
      await Promise.all([loadGroups(), loadProxies()]);
    } catch (err) { setError(err.message || t('errors.deleteGroup')); }
  }

  async function assignSelectedToGroup(groupId) {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try {
      await softglazeApi.proxyGroups.assign(ids, groupId);
      setAssignOpen(false);
      clearSelection();
      await Promise.all([loadGroups(), loadProxies()]);
    } catch (err) { setError(err.message || t('errors.moveProxies')); }
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
    } catch (err) { setError(err.message || t('errors.moveProxies')); }
  }

  // Auto-categorize proxies into Country/State/City groups from their verified geo
  // (set by the proxy health check). Run Test All first so proxies have a country.
  async function handleAutoGroup() {
    setAutoGrouping(true); setError(''); setAutoGroupMsg('');
    try {
      const r = await softglazeApi.proxies.autoGroup(autoGroupLevel);
      await Promise.all([loadGroups(), loadProxies()]);
      setAutoGroupMsg(t('autoGroup.result', { count: r?.createdGroups ?? 0, assigned: r?.assigned ?? 0 }));
    } catch (e) {
      setError(e.message || t('errors.autoGroup'));
    } finally {
      setAutoGrouping(false);
    }
  }

  function renderStatus(id) {
    if (checkingId === id) return <span className="text-xs text-muted">{t('status.checking')}</span>;
    const r = checkResults[id];
    if (!r) return <span className="text-xs text-muted-dark">—</span>;
    if (r.success) {
      const ms = r.avgMs ?? r.latencyMs;
      const grade = r.health && r.health.grade;
      return (
        <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-medium">
          <span className="text-emerald-400">{r.ip || '?'}{r.country ? ` · ${r.country}` : ''}{typeof ms === 'number' ? ` · ${ms}ms` : ''}</span>
          {grade && <span className={`font-bold ${GRADE_COLOR[grade] || 'text-foreground'}`} title={r.health.label ? `${t('checker.health')}: ${r.health.label} (${r.health.score})` : undefined}>{grade}</span>}
          {r.speed && r.speed.rating && r.speed.rating !== 'unknown' && <span className="text-muted-foreground">{t(`checker.speed.${r.speed.rating}`)}</span>}
          {r.blacklist && r.blacklist.listed
            ? <span className="inline-flex items-center gap-0.5 text-amber-400" title={`${t('checker.blacklisted')}: ${(r.blacklist.sources || []).join(', ')}`}><AlertTriangle className="h-3 w-3" /> {t('checker.blacklistShort')}</span>
            : (r.blacklist && r.blacklist.checked ? <span className="text-emerald-400/70" title={t('checker.notBlacklisted')}>{t('checker.clean')}</span> : null)}
        </span>
      );
    }
    return <span className="text-xs font-medium text-red-400" title={r.error || t('status.failed')}>{t('status.failed')}{r.error ? `: ${String(r.error).slice(0, 40)}` : ''}</span>;
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
      ? { ...p, name: `${String(p.name || '').split(' • ')[0].trim() || t('table.defaultProxyName')} • ${geo}` }
      : p)));
  }

  async function handleDelete(proxy) {
    if (!window.confirm(t('delete.confirm', { name: proxy.name }))) return;
    setError('');
    try {
      await softglazeApi.proxies.delete(proxy.id);
      await loadProxies();
    } catch (err) {
      setError(err.message || t('errors.deleteProxy'));
    }
  }

  // REAL stats derived from the proxy list + any check results. verified/failed use
  // the same health resolution as the filter so card counts match the filtered rows.
  const verifiedCount = proxies.filter((p) => proxyHealthOf(p, checkResults) === 'verified').length;
  const failedCount = proxies.filter((p) => proxyHealthOf(p, checkResults) === 'failed').length;
  const typeCounts = proxies.reduce((acc, p) => {
    const t = String(p.type || 'OTHER').toUpperCase();
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  const TYPE_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
  const typeDonut = Object.entries(typeCounts).map(([label, value], i) => ({ label, value, color: TYPE_COLORS[i % TYPE_COLORS.length] }));
  if (typeDonut.length === 0) typeDonut.push({ label: t('stats.noProxies'), value: 1, color: 'var(--elevated)' });

  return (
    <div className="flex flex-col h-full space-y-4 pb-10">
      <PageHeader
        eyebrow={t('header.eyebrow')}
        title={t('header.title')}
        description={t('header.description')}
        actions={
          view === 'custom' ? (
            <>
              <div className="flex items-center gap-2 mr-1">
                <span className="text-[11px] font-medium text-muted-foreground">{t('rotation.label')}</span>
                <select
                  value={proxyPolicy}
                  onChange={(e) => applyProxyPolicy(e.target.value)}
                  className="h-9 rounded-lg border border-border bg-card px-2 text-[12px] text-foreground"
                  title={t('rotation.tooltip')}
                >
                  <option value="each-launch">{t('rotation.eachLaunch')}</option>
                  <option value="sticky">{t('rotation.sticky')}</option>
                  <option value="failover">{t('rotation.failover')}</option>
                  <option value="latency-optimized">{t('rotation.latencyOptimized')}</option>
                </select>
                {proxyPolicy === 'failover' && (
                  <input type="number" min={0} value={policyDetail.failoverMaxLatencyMs} onChange={(e) => applyPolicyParam({ failoverMaxLatencyMs: Math.max(0, Number(e.target.value) || 0) })} title={t('rotation.failoverMaxTooltip')} placeholder={t('rotation.maxMsPlaceholder')} className="h-9 w-24 rounded-lg border border-border bg-card px-2 text-[12px] text-foreground" />
                )}
                {proxyPolicy === 'latency-optimized' && (
                  <input type="number" min={1} value={policyDetail.latencyTopN} onChange={(e) => applyPolicyParam({ latencyTopN: Math.max(1, Number(e.target.value) || 1) })} title={t('rotation.topNTooltip')} placeholder={t('rotation.topNPlaceholder')} className="h-9 w-20 rounded-lg border border-border bg-card px-2 text-[12px] text-foreground" />
                )}
              </div>
              <Button variant="secondary" onClick={handleTestAllFast} disabled={testingAll || proxies.length === 0} title={t('actions.testAllTooltip')}>
                {testingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {t('actions.testAll')}{testSummary ? ` · ${t('actions.testAllSummary', { ok: testSummary.ok, total: testSummary.total })}` : ''}
              </Button>
              <Button variant="secondary" onClick={handleCheckAll} disabled={checkingAll || proxies.length === 0}>
                {checkingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
                {t('actions.checkAll')}
              </Button>
              <Button variant="secondary" onClick={loadProxies}>
                <RefreshCcw className="h-4 w-4" />
                {t('actions.refresh')}
              </Button>
              <Button variant="secondary" onClick={() => setBatchOpen(true)}>
                <Upload className="h-4 w-4" />
                {t('actions.batchAdd')}
              </Button>
              <Button variant="primary" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                {t('actions.newProxy')}
              </Button>
            </>
          ) : null
        }
      />

      {/* Dual-view tab partition */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-elevated/60 border border-border w-fit">
        {[
          { key: 'custom', label: t('tabs.custom'), icon: Server },
          { key: 'providers', label: t('tabs.providers'), icon: Boxes }
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors ${view === key ? 'bg-card text-foreground shadow-sm border border-border' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Icon className="w-4 h-4" /> {label}
            {key === 'providers' && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 uppercase tracking-wide">{t('tabs.integrated')}</span>}
          </button>
        ))}
      </div>

      {/* STATS ROW — real counts + proxy-type donut (custom view only) */}
      {view === 'custom' && (
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MiniStat icon={Globe} label={t('stats.totalProxies')} value={proxies.length} color="#8b5cf6" onClick={() => setStatusFilter('all')} active={statusFilter === 'all'} />
          <MiniStat icon={Wifi} label={t('stats.proxyTypes')} value={Object.keys(typeCounts).length} color="#3b82f6" />
          <MiniStat icon={ShieldCheck} label={t('stats.verified')} value={verifiedCount} color="#10b981" onClick={() => toggleStatusFilter('verified')} active={statusFilter === 'verified'} />
          <MiniStat icon={ShieldOff} label={t('stats.nonVerified')} value={failedCount} color="#ef4444" onClick={() => toggleStatusFilter('failed')} active={statusFilter === 'failed'} />
        </div>
        <div className="rounded-xl bg-card border border-border p-4 flex items-center gap-4">
          <Donut data={typeDonut} size={104} thickness={16} centerLabel={proxies.length} centerSub={t('stats.total')} />
          <div className="flex-1 min-w-0"><Legend data={typeDonut} /></div>
        </div>
      </div>
      )}

      {/* LIVE CHECKER — progress bar, ETA, counts + a running log of what's happening */}
      {view === 'custom' && checkRun && (
        <div className="mb-4 rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            {checkRun.running
              ? <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
              : <ShieldCheck className="h-4 w-4 text-emerald-400" />}
            <span className="text-sm font-semibold text-foreground">{checkRun.running ? t('checker.running') : t('checker.done')}</span>
            <span className="text-[12px] text-muted-foreground">{checkRun.done}/{checkRun.total} · {checkRun.percent}%</span>
            <span className="text-[12px] text-emerald-400">{t('checker.healthy', { n: checkRun.ok })}</span>
            <span className="text-[12px] text-red-400">{t('checker.failed', { n: checkRun.fail })}</span>
            {checkRun.running && checkRun.etaMs != null && <span className="text-[12px] text-muted-foreground">{t('checker.eta')} {fmtDuration(checkRun.etaMs)}</span>}
            {!checkRun.running && checkRun.totalMs != null && <span className="text-[12px] text-muted-foreground">{fmtDuration(checkRun.totalMs)}</span>}
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setShowCheckLog((v) => !v)} title={showCheckLog ? t('checker.hideLog') : t('checker.showLog')}>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showCheckLog ? '' : '-rotate-90'}`} /> {showCheckLog ? t('checker.hideLog') : t('checker.showLog')}
              </Button>
              {checkRun.running
                ? <Button size="sm" variant="secondary" onClick={stopStreamCheck}><X className="h-3.5 w-3.5" /> {t('checker.stop')}</Button>
                : <Button size="sm" variant="ghost" onClick={() => setCheckRun(null)}><X className="h-3.5 w-3.5" /> {t('checker.dismiss')}</Button>}
            </div>
          </div>
          <div className="h-2.5 w-full rounded-full bg-elevated overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-[width] duration-300" style={{ width: `${Math.max(2, checkRun.percent)}%` }} />
          </div>
          {showCheckLog && (
            <div ref={checkLogRef} className="max-h-36 overflow-y-auto rounded-lg bg-[#0b0f17] border border-border/60 p-2.5 font-mono text-[11px] leading-relaxed">
              {(!checkRun.logs || checkRun.logs.length === 0)
                ? <p className="text-muted-foreground/60">{t('checker.idle')}</p>
                : checkRun.logs.map((l, i) => (
                  <div key={i} className="whitespace-pre-wrap break-words">
                    <span className={CHECK_LEVEL_COLOR[l.level] || 'text-foreground'}>[{l.level || 'INFO'}]</span>{' '}
                    <span className="text-foreground/90">{l.message}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {error && <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}

      {view === 'providers' && <ProxyProviders onSynced={loadProxies} />}

      {view === 'custom' && (<>
      <div className="mb-2 flex items-center gap-3 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[220px]">
          <Input
            icon={Search}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('search.placeholder')}
          />
        </div>
        {/* Blocklist filter — clean vs blacklisted (from the DNSBL check) */}
        <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5 text-[12px]">
          {[
            { key: 'all', label: t('blacklistFilter.all') },
            { key: 'clean', label: t('blacklistFilter.clean'), n: blCounts.clean },
            { key: 'blacklisted', label: t('blacklistFilter.blacklisted'), n: blCounts.listed }
          ].map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setBlacklistFilter(o.key)}
              title={o.key === 'blacklisted' ? t('blacklistFilter.blacklistedTip') : (o.key === 'clean' ? t('blacklistFilter.cleanTip') : undefined)}
              className={`inline-flex items-center gap-1 px-2.5 h-7 rounded-md font-medium transition-colors ${blacklistFilter === o.key ? (o.key === 'blacklisted' ? 'bg-amber-500/15 text-amber-400' : o.key === 'clean' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-secondary text-foreground') : 'text-muted-foreground hover:text-foreground'}`}
            >
              {o.key === 'blacklisted' && <AlertTriangle className="h-3 w-3" />}{o.label}{typeof o.n === 'number' ? <span className="opacity-60">{o.n}</span> : null}
            </button>
          ))}
        </div>
        {(statusFilter !== 'all' || activeGroup !== 'all' || blacklistFilter !== 'all' || search.trim()) && filteredProxies.length > 0 && (
          <Button size="sm" variant="danger" onClick={handleDeleteFiltered} disabled={bulkDeleting} title={t('deleteFiltered.tooltip')}>
            {bulkDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            {t('deleteFiltered.button', { scope: statusFilter !== 'all' ? t(`deleteFiltered.scope.${statusFilter}`) : (blacklistFilter !== 'all' ? t(`blacklistFilter.${blacklistFilter}`) : t('deleteFiltered.scope.filtered')), count: filteredProxies.length })}
          </Button>
        )}
      </div>

      {/* CATEGORY / GROUP BAR — filter the pool, manage groups, drag rows here to assign */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button className={chipCls('all')} onClick={() => setActiveGroup('all')}>
          <Boxes className="w-3.5 h-3.5" /> {t('filters.all')} <span className="opacity-60">{proxies.length}</span>
        </button>
        <button className={chipCls('none')} onClick={() => setActiveGroup('none')}>
          <Folder className="w-3.5 h-3.5" /> {t('filters.ungrouped')} <span className="opacity-60">{proxies.filter((p) => !p.proxyGroupId).length}</span>
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
              title={t('groups.chipTooltip')}
              className={`group/chip inline-flex items-center gap-1.5 h-8 pl-2.5 pr-2 rounded-lg text-[12px] font-medium border transition-colors cursor-pointer ${over ? 'ring-2 ring-primary border-primary' : active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-dark'}`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.color || '#3b82f6' }} />
              {g.name} <span className="opacity-60">{g.proxyCount ?? 0}</span>
              <button onClick={(e) => { e.stopPropagation(); setGroupModal({ id: g.id, name: g.name, color: g.color || '#3b82f6' }); }} className="opacity-0 group-hover/chip:opacity-100 ml-1 p-0.5 rounded hover:bg-card text-muted hover:text-foreground" title={t('groups.renameRecolor')}><Edit className="w-3 h-3" /></button>
              <button onClick={(e) => { e.stopPropagation(); removeGroup(g); }} className="opacity-0 group-hover/chip:opacity-100 p-0.5 rounded hover:bg-red-500/10 text-muted hover:text-red-400" title={t('groups.deleteGroup')}><X className="w-3 h-3" /></button>
            </div>
          );
        })}

        <button className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary transition-colors" onClick={() => setGroupModal({ name: '', color: GROUP_COLORS[groups.length % GROUP_COLORS.length] })}>
          <FolderPlus className="w-3.5 h-3.5" /> {t('groups.newGroup')}
        </button>

        {/* Auto-group by verified geo (run Test All first to populate country/state/city) */}
        <span className="w-px h-5 bg-border mx-1" />
        <select value={autoGroupLevel} onChange={(e) => setAutoGroupLevel(e.target.value)} className="h-8 rounded-lg border border-border bg-card px-2 text-[12px] text-foreground" title={t('autoGroup.granularityTooltip')}>
          <option value="country">{t('autoGroup.country')}</option>
          <option value="state">{t('autoGroup.state')}</option>
          <option value="city">{t('autoGroup.city')}</option>
        </select>
        <button onClick={handleAutoGroup} disabled={autoGrouping || proxies.length === 0} title={t('autoGroup.buttonTooltip')} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary transition-colors disabled:opacity-50">
          {autoGrouping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Boxes className="w-3.5 h-3.5" />} {t('autoGroup.button')}
        </button>
        {autoGroupMsg && <span className="text-[11px] text-emerald-400">{autoGroupMsg}</span>}

        <span className="w-px h-5 bg-border mx-1" />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="h-8 rounded-lg border border-border bg-card px-2 text-[12px] text-foreground" title={t('sort.tooltip')}>
          <option value="default">{t('sort.default')}</option>
          <option value="fastest">{t('sort.fastest')}</option>
          <option value="slowest">{t('sort.slowest')}</option>
        </select>
        <button onClick={() => setShowGeo((v) => !v)} className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium border transition-colors ${showGeo ? 'border-primary text-primary' : 'border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary'}`} title={t('geo.toggleTooltip')}>
          <BarChart3 className="w-3.5 h-3.5" /> {t('geo.button')}
        </button>
        <span className="w-px h-5 bg-border mx-1" />
        <label className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground" title={t('scheduler.tooltip')}>
          <input type="checkbox" checked={scheduler.enabled} onChange={(e) => applyScheduler({ ...scheduler, enabled: e.target.checked })} className="accent-primary" />
          <Clock className="w-3.5 h-3.5" /> {t('scheduler.autoCheckEvery')}
          <input type="number" min={1} value={scheduler.minutes} onChange={(e) => applyScheduler({ ...scheduler, minutes: Math.max(1, Number(e.target.value) || 30) })} className="h-7 w-14 rounded border border-border bg-card px-1.5 text-[12px] text-foreground" /> {t('scheduler.min')}
        </label>

        {Object.keys(providerCounts).length > 0 && (
          <>
            <span className="w-px h-5 bg-border mx-1" />
            <span className="text-[10px] uppercase tracking-wider text-muted-dark mr-1">{t('filters.byProvider')}</span>
            {Object.entries(providerCounts).map(([prov, cnt]) => (
              <button key={prov} className={chipCls(`provider:${prov}`)} onClick={() => setActiveGroup(`provider:${prov}`)}>
                <Tag className="w-3 h-3" /> {PROVIDER_LABELS[prov] || prov} <span className="opacity-60">{cnt}</span>
              </button>
            ))}
          </>
        )}
      </div>

      {showGeo && geoBreakdown.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-foreground">{t('geo.byCountry')}</span>
            <span className="text-[11px] text-muted-foreground">{t('geo.summary', { countries: geoBreakdown.length, proxies: proxies.length })}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {geoBreakdown.slice(0, 12).map((g) => (
              <div key={g.country} className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-[12px] text-muted-foreground truncate" title={g.country}>{g.country}</span>
                <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${proxies.length ? Math.round((g.count / proxies.length) * 100) : 0}%` }} />
                </div>
                <span className="w-10 text-right text-[12px] text-foreground tabular-nums">{g.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm">
          <span className="font-medium text-foreground">{t('selection.count', { count: selectedIds.size })}</span>
          <div className="w-px h-5 bg-border" />
          <Button size="sm" variant="secondary" onClick={handleBulkCheck} disabled={checkingAll || bulkDeleting}>
            {checkingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />} {t('selection.checkSelected')}
          </Button>
          <div className="relative">
            <Button size="sm" variant="secondary" onClick={() => setAssignOpen((v) => !v)} disabled={bulkDeleting}>
              <FolderInput className="h-3.5 w-3.5" /> {t('selection.moveToGroup')} <ChevronDown className="h-3.5 w-3.5" />
            </Button>
            {assignOpen && (
              <div className="absolute z-20 mt-1 w-56 max-h-64 overflow-y-auto rounded-lg border border-border bg-card shadow-xl py-1">
                {groups.length === 0 && <div className="px-3 py-2 text-[12px] text-muted">{t('selection.noGroupsYet')}</div>}
                {groups.map((g) => (
                  <button key={g.id} onClick={() => assignSelectedToGroup(g.id)} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-foreground hover:bg-secondary text-left">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.color || '#3b82f6' }} /> {g.name}
                  </button>
                ))}
                <div className="my-1 h-px bg-border" />
                <button onClick={() => assignSelectedToGroup(null)} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-muted-foreground hover:bg-secondary text-left">
                  <X className="w-3.5 h-3.5" /> {t('selection.removeFromGroup')}
                </button>
              </div>
            )}
          </div>
          <Button size="sm" variant="danger" onClick={handleBulkDelete} disabled={bulkDeleting}>
            {bulkDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} {t('selection.deleteSelected')}
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection} className="ml-auto px-2.5" title={t('selection.clearTooltip')}>
            <X className="h-4 w-4" /> {t('selection.clear')}
          </Button>
        </div>
      )}

      <Card className="bg-surface border-border flex flex-col shadow-xl flex-1 min-h-0 rounded">
        <CardContent className="p-0 overflow-auto flex-1 min-h-0 rounded">
          {loading ? (
            <div className="p-12 text-sm text-muted text-center flex flex-col items-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              {t('table.loading')}
            </div>
          ) : filteredProxies.length === 0 ? (
            <div className="p-12">
              <EmptyState title={t('table.emptyTitle')} description={t('table.emptyDescription')} />
            </div>
          ) : (
            <div className="w-full">
              <table className="w-full min-w-[1000px] border-collapse text-left text-sm whitespace-nowrap">
                <thead className="bg-surface text-muted text-xs uppercase tracking-wider font-semibold border-b border-border sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-5 py-4 w-10">
                      <input
                        type="checkbox"
                        aria-label={t('table.selectAll')}
                        className="h-4 w-4 cursor-pointer accent-primary align-middle"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected; }}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th className="px-5 py-4">{t('table.colName')}</th>
                    <th className="px-5 py-4">{t('table.colType')}</th>
                    <th className="px-5 py-4">{t('table.colEndpoint')}</th>
                    <th className="px-5 py-4">{t('table.colUsername')}</th>
                    <th className="px-5 py-4">{t('table.colGroup')}</th>
                    <th className="px-5 py-4">{t('table.colProfiles')}</th>
                    <th className="px-5 py-4">{t('table.colCreated')}</th>
                    <th className="px-5 py-4">{t('table.colStatus')}</th>
                    <th className="px-5 py-4 text-right">{t('table.colActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pagedProxies.map((proxy) => (
                    <tr key={proxy.id} draggable onDragStart={(e) => onRowDragStart(e, proxy)} className={`group/row transition-colors cursor-grab active:cursor-grabbing ${selectedIds.has(proxy.id) ? 'bg-primary/5' : 'hover:bg-card/50'}`}>
                      <td className="px-5 py-4">
                        <input
                          type="checkbox"
                          aria-label={t('table.selectRow', { name: proxy.name })}
                          className="h-4 w-4 cursor-pointer accent-primary align-middle"
                          checked={selectedIds.has(proxy.id)}
                          onChange={() => toggleSelect(proxy.id)}
                        />
                      </td>
                      <td className="px-5 py-4 font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          <span className="truncate">{proxy.name}</span>
                          <span className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 transition-opacity">
                            <button type="button" onClick={() => handleCheck(proxy)} disabled={checkingId === proxy.id} title={t('rowActions.testProxy')} className="p-1 rounded hover:bg-card text-muted hover:text-foreground disabled:opacity-50">
                              {checkingId === proxy.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
                            </button>
                            <button type="button" onClick={() => openHistory(proxy)} title={t('rowActions.healthHistory')} className="p-1 rounded hover:bg-card text-muted hover:text-foreground">
                              <History className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" onClick={() => openEdit(proxy)} title={t('rowActions.editProxy')} className="p-1 rounded hover:bg-card text-muted hover:text-foreground"><Edit className="h-3.5 w-3.5" /></button>
                            <button type="button" onClick={() => handleDelete(proxy)} title={t('rowActions.deleteProxy')} className="p-1 rounded hover:bg-red-500/10 text-muted hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                          </span>
                        </div>
                      </td>
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
                            title={t('rowActions.copyEndpoint')}
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
                          if (count > 0) return <span className="text-foreground text-xs">{t('table.profileCount', { count })}</span>;
                          return <span className="text-muted-dark">—</span>;
                        })()}
                      </td>
                      <td className="px-5 py-4 text-muted text-xs">{formatDateTime(proxy.createdAt)}</td>
                      <td className="px-5 py-4">{renderStatus(proxy.id)}</td>
                      <td className="px-5 py-4">
                        <div className={`flex justify-end gap-1.5 transition-opacity ${checkingId === proxy.id ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100'}`}>
                          <Button size="sm" variant="secondary" onClick={() => handleCheck(proxy)} disabled={checkingId === proxy.id} title={t('rowActions.testProxy')} className="px-3">
                            {checkingId === proxy.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5 mr-1" />} {t('rowActions.check')}
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
        {!loading && filteredProxies.length > 0 && (
          <div className="shrink-0 border-t border-border bg-card/95 px-4 py-2.5 rounded-b">
            <Pager total={filteredProxies.length} page={safePage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
          </div>
        )}
      </Card>
      </>)}

      {/* --- PROXY HEALTH HISTORY --- */}
      <Dialog open={!!historyProxy} onOpenChange={(o) => { if (!o) { setHistoryProxy(null); setHistoryData(null); } }}>
        <DialogContent title={t('history.dialogTitle')} className="rounded border-border bg-card">
          <DialogHeader>
            <DialogTitle>{t('history.title')}</DialogTitle>
            <DialogDescription>{historyProxy ? (historyProxy.name || `${historyProxy.host}:${historyProxy.port}`) : ''}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {historyData === null ? (
              <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : historyData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t('history.empty')}</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">{t('history.latencyOverTime')}</p>
                  <AreaChart data={historyData.filter((e) => typeof e.latencyMs === 'number').map((e) => ({ x: new Date(e.ts).toLocaleString(), y: e.latencyMs }))} height={160} />
                </div>
                <div className="flex gap-4 text-[12px] text-muted-foreground">
                  <span><span className="text-emerald-400 font-semibold">{historyData.filter((e) => e.status === 'ok').length}</span> {t('history.ok')}</span>
                  <span><span className="text-red-400 font-semibold">{historyData.filter((e) => e.status === 'fail').length}</span> {t('history.fail')}</span>
                  <span>{t('history.checks', { count: historyData.length })}</span>
                </div>
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setHistoryProxy(null); setHistoryData(null); }}>{t('history.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- CREATE / EDIT MODAL --- */}
      <Dialog open={proxyOpen} onOpenChange={setProxyOpen}>
        <DialogContent title={isEditing ? t('form.dialogTitleEdit') : t('form.dialogTitleCreate')} className="rounded border-border bg-card">
          <form onSubmit={handleSaveProxy}>
            <DialogHeader>
              <DialogTitle>{isEditing ? t('form.titleEdit') : t('form.titleCreate')}</DialogTitle>
              <DialogDescription>
                {isEditing ? t('form.descriptionEdit') : t('form.descriptionCreate')}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-5">
              <p className="text-xs text-primary italic bg-primary/10 border border-primary/20 px-3 py-2 rounded">💡 {t('form.tipPrefix')} <span className="font-mono">host:port:user:pass</span> {t('form.tipSuffix')}</p>
              <div className="grid gap-4 lg:grid-cols-2">
                <Field label={t('form.proxyName')}>
                  <Input value={proxyForm.name} onChange={(event) => updateProxyForm('name', event.target.value)} placeholder={t('form.proxyNamePlaceholder')} required />
                </Field>
                <Field label={t('form.type')}>
                  <CustomSelect value={proxyForm.type} onChange={(event) => updateProxyForm('type', event.target.value)}>
                    <option value="HTTP">HTTP</option>
                    <option value="SOCKS5">SOCKS5</option>
                  </CustomSelect>
                </Field>
              </div>
              <div className="grid gap-4 lg:grid-cols-[1fr_160px]">
                <Field label={t('form.host')}>
                  <Input value={proxyForm.host} onChange={(event) => updateProxyForm('host', event.target.value)} onPaste={handleProxyPaste} placeholder="127.0.0.1" required />
                </Field>
                <Field label={t('form.port')}>
                  <Input value={proxyForm.port} onChange={(event) => updateProxyForm('port', event.target.value)} placeholder="8080" required />
                </Field>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Field label={t('form.username')}>
                  <Input value={proxyForm.username} onChange={(event) => updateProxyForm('username', event.target.value)} placeholder={t('form.optional')} />
                </Field>
                <Field label={t('form.password')}>
                  <Input type="password" value={proxyForm.password} onChange={(event) => updateProxyForm('password', event.target.value)} placeholder={t('form.optional')} />
                </Field>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setProxyOpen(false)} disabled={saving}>{t('form.cancel')}</Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? t('form.saving') : isEditing ? t('form.saveChanges') : t('form.createProxy')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --- BATCH IMPORT MODAL --- */}
      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent title={t('batch.dialogTitle')} className="rounded border-border bg-card">
          <form onSubmit={handleBatchAdd}>
            <DialogHeader>
              <DialogTitle>{t('batch.title')}</DialogTitle>
              <DialogDescription>{t('batch.descriptionPrefix')} <code className="font-mono text-muted-foreground">host:port:username:password</code>.</DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-5">
              <Field label={t('batch.defaultType')}>
                <CustomSelect value={batchType} onChange={(event) => setBatchType(event.target.value)}>
                  <option value="HTTP">HTTP</option>
                  <option value="SOCKS5">SOCKS5</option>
                </CustomSelect>
              </Field>
              <Field label={t('batch.proxyLines')}>
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
                  <div className="font-medium text-foreground mb-2">{t('batch.resultTitle')}</div>
                  <div className="grid gap-2 text-muted sm:grid-cols-4 font-mono text-xs">
                    <div>{t('batch.total')}: {batchResult.total}</div>
                    <div className="text-emerald-400">{t('batch.created')}: {batchResult.created?.length ?? 0}</div>
                    <div className="text-amber-400">{t('batch.skipped')}: {batchResult.skipped?.length ?? 0}</div>
                    <div className="text-red-400">{t('batch.errors')}: {batchResult.errors?.length ?? 0}</div>
                  </div>
                  {batchResult.errors?.length ? (
                    <div className="mt-3 max-h-32 overflow-y-auto rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 font-mono">
                      {batchResult.errors.map((item) => (
                        <div key={`${item.line}-${item.raw}`}>{t('batch.lineError', { line: item.line, message: item.message })}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setBatchOpen(false)} disabled={saving}>{t('batch.close')}</Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? t('batch.importing') : t('batch.addProxies')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --- CREATE / EDIT PROXY GROUP MODAL --- */}
      <Dialog open={Boolean(groupModal)} onOpenChange={(o) => { if (!o) setGroupModal(null); }}>
        <DialogContent title={groupModal?.id ? t('groupModal.dialogTitleEdit') : t('groupModal.dialogTitleNew')} className="rounded border-border bg-card">
          <form onSubmit={(e) => { e.preventDefault(); saveGroup(); }}>
            <DialogHeader>
              <DialogTitle>{groupModal?.id ? t('groupModal.titleEdit') : t('groupModal.titleNew')}</DialogTitle>
              <DialogDescription>{t('groupModal.description')}</DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-5">
              <Field label={t('groupModal.groupName')}>
                <Input value={groupModal?.name || ''} onChange={(e) => setGroupModal((m) => ({ ...m, name: e.target.value }))} placeholder={t('groupModal.groupNamePlaceholder')} autoFocus required />
              </Field>
              <Field label={t('groupModal.color')}>
                <div className="flex flex-wrap gap-2">
                  {GROUP_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setGroupModal((m) => ({ ...m, color: c }))}
                      className={`w-7 h-7 rounded-full transition-transform ${groupModal?.color === c ? 'ring-2 ring-offset-2 ring-offset-card ring-white scale-110' : 'hover:scale-110'}`}
                      style={{ background: c }}
                      aria-label={t('groupModal.colorLabel', { color: c })}
                    />
                  ))}
                </div>
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setGroupModal(null)}>{t('groupModal.cancel')}</Button>
              <Button type="submit" variant="primary">{groupModal?.id ? t('groupModal.saveChanges') : t('groupModal.createGroup')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}