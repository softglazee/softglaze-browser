import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowUpRight, Loader2, RefreshCcw, Square, Trash2, X } from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';
import EmptyState from '@/components/EmptyState.jsx';
import FreeProxySearch from '@/components/FreeProxySearch.jsx';
import Button from '@/components/ui/Button.jsx';
import Pager from '@/components/ui/Pager.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { measuredMs, speedOf } from '@/lib/proxyBuckets.mjs';
import { countryName } from '@/lib/countries.mjs';
import { deadFreeIds, filterFreeProxies, freeCountryCounts, freeStatusOf, protocolOf } from '@/lib/freeProxies.mjs';
import { formatDateTime } from '@/lib/utils.js';

// Free public proxies on their own page, apart from the paid pool: search, check, filter, delete.
// They are stored as provider 'free' proxies, which every paid view leaves out.
const selectCls = 'h-8 rounded border border-border bg-card px-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';
const STATUS_STYLE = {
  working: 'border-success/30 bg-success/10 text-success',
  dead: 'border-destructive/30 bg-destructive/10 text-destructive',
  unchecked: 'border-border bg-secondary text-muted-foreground'
};

const addressOf = (p) => `${p.host}:${p.port}`;

function timeAgo(value, t) {
  const ms = value ? new Date(value).getTime() : 0;
  if (!ms) return null;
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (!Number.isFinite(mins) || mins < 1) return t('stats.justNow');
  if (mins < 60) return t('stats.minAgo', { n: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('stats.hrAgo', { n: hrs });
  return t('stats.dayAgo', { n: Math.floor(hrs / 24) });
}

export default function FreeProxiesPage() {
  const { t, i18n } = useTranslation('proxies');
  const [proxies, setProxies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [protocol, setProtocol] = useState('all');
  const [country, setCountry] = useState('all');
  const [status, setStatus] = useState('all');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [live, setLive] = useState({}); // fresh check results by id, until the next reload
  const [checkingId, setCheckingId] = useState(null);
  const [checkRun, setCheckRun] = useState(null); // { running, done, total, ok, fail }
  const [deleting, setDeleting] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const runIdRef = useRef(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async () => {
    setError('');
    try {
      const list = await softglazeApi.proxies.list({ scope: 'free' });
      if (!mounted.current) return;
      const rows = Array.isArray(list) ? list : [];
      setProxies(rows);
      setLive({}); // the reloaded rows carry every saved check
      setSelectedIds((prev) => {
        const ids = new Set(rows.map((p) => p.id));
        const next = new Set();
        prev.forEach((id) => { if (ids.has(id)) next.add(id); });
        return next;
      });
    } catch (e) {
      if (mounted.current) setError(e.message || t('freePage.errors.load'));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  // Streamed checks report on the pool's channel; only frames of this page's run are used.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const off = softglazeApi.proxies.onCheckProgress((d) => {
      if (!d || !mounted.current || !runIdRef.current || d.runId !== runIdRef.current) return;
      if (d.phase === 'result' && d.proxyId != null && d.result) setLive((prev) => ({ ...prev, [d.proxyId]: d.result }));
      setCheckRun((prev) => (prev ? {
        running: !d.finished,
        done: d.done ?? prev.done,
        total: d.total ?? prev.total,
        ok: d.ok ?? prev.ok,
        fail: d.fail ?? prev.fail
      } : prev));
      if (d.finished) { runIdRef.current = null; loadRef.current(); }
    });
    return () => { try { if (off) off(); } catch (e) { /* ignore */ } };
  }, []);

  // A finished run's summary stays a few seconds, then goes.
  useEffect(() => {
    if (!checkRun || checkRun.running) return undefined;
    const id = setTimeout(() => setCheckRun(null), 6000);
    return () => clearTimeout(id);
  }, [checkRun]);

  const filtered = useMemo(
    () => filterFreeProxies(proxies, { protocol, country, status }, live),
    [proxies, protocol, country, status, live]
  );
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;

  // A filter change drops selected rows that are no longer shown, so a bulk action never hits hidden ones.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set((filteredRef.current || []).map((p) => p.id));
      const next = new Set();
      prev.forEach((id) => { if (visible.has(id)) next.add(id); });
      return next.size === prev.size ? prev : next;
    });
    setPage(1);
  }, [protocol, country, status]);

  const counts = useMemo(() => {
    const c = { HTTP: 0, SOCKS5: 0, working: 0, dead: 0, unchecked: 0, unknownCountry: 0 };
    for (const p of proxies) {
      c[protocolOf(p)] += 1;
      c[freeStatusOf(p, live)] += 1;
      if (!p.lastCountry) c.unknownCountry += 1;
    }
    return c;
  }, [proxies, live]);
  const countries = useMemo(() => freeCountryCounts(proxies), [proxies]);
  const deadIds = useMemo(() => deadFreeIds(proxies, live), [proxies, live]);

  const pageCount = pageSize === Infinity ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const paged = pageSize === Infinity ? filtered : filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const visibleSelected = filtered.filter((p) => selectedIds.has(p.id)).map((p) => p.id);
  const allSelected = filtered.length > 0 && visibleSelected.length === filtered.length;
  const someSelected = visibleSelected.length > 0 && !allSelected;
  const filtersActive = protocol !== 'all' || country !== 'all' || status !== 'all';
  const checkBusy = Boolean(checkRun && checkRun.running);

  function toggleRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(filtered.map((p) => p.id)));
  }

  async function checkOne(p) {
    setCheckingId(p.id);
    setError('');
    try {
      const r = await softglazeApi.proxies.check({ id: p.id });
      if (mounted.current) setLive((prev) => ({ ...prev, [p.id]: r }));
      await load();
    } catch (e) {
      if (mounted.current) setLive((prev) => ({ ...prev, [p.id]: { success: false, error: e.message } }));
    } finally {
      if (mounted.current) setCheckingId(null);
    }
  }

  async function checkMany(ids) {
    if (!ids.length || checkBusy) return;
    setError('');
    setCheckRun({ running: true, done: 0, total: ids.length, ok: 0, fail: 0 });
    try {
      const res = await softglazeApi.proxies.checkStream({ ids, concurrency: 12 });
      if (!res || !res.runId || res.total === 0) { setCheckRun(null); return; }
      runIdRef.current = res.runId;
      setCheckRun((prev) => (prev ? { ...prev, total: res.total } : prev));
    } catch (e) {
      setError(e.message || t('freePage.errors.check'));
      setCheckRun(null);
    }
  }

  async function stopCheck() {
    try { await softglazeApi.proxies.stopCheck(runIdRef.current ? { runId: runIdRef.current } : {}); } catch (e) { /* the run ends on its own */ }
  }

  async function removeIds(ids, confirmText) {
    if (!ids.length || !window.confirm(confirmText)) return;
    setDeleting(true);
    setError('');
    try {
      await softglazeApi.proxies.bulkDelete(ids);
      await load();
    } catch (e) {
      setError(e.message || t('freePage.errors.delete'));
    } finally {
      setDeleting(false);
    }
  }

  async function removeOne(p) {
    const used = Number(p.profileCount) || 0;
    const text = used > 0
      ? t('freePage.confirm.deleteUsed', { address: addressOf(p), count: used })
      : t('freePage.confirm.delete', { address: addressOf(p) });
    if (!window.confirm(text)) return;
    setError('');
    try {
      await softglazeApi.proxies.delete(p.id);
      await load();
    } catch (e) {
      setError(e.message || t('freePage.errors.delete'));
    }
  }

  function renderSpeed(p) {
    const ms = measuredMs(p, live);
    if (ms == null) return <span className="text-muted-foreground">-</span>;
    return <span className={speedOf(p, live) === 'fast' ? 'text-success' : 'text-warning'}>{ms} ms</span>;
  }

  function renderStatus(p) {
    if (checkingId === p.id) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{t('freePage.status.checking')}
        </span>
      );
    }
    const s = freeStatusOf(p, live);
    const err = s === 'dead' ? ((live[p.id] && live[p.id].error) || p.lastError) : null;
    return (
      <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[s]}`} title={err || undefined}>
        {t(`freePage.status.${s}`)}
      </span>
    );
  }

  function renderUsedBy(p) {
    const count = Number(p.profileCount) || 0;
    if (!count) return <span className="text-muted-foreground">{t('freePage.table.notUsed')}</span>;
    const names = Array.isArray(p.profileNames) ? p.profileNames : [];
    return <span className="text-foreground" title={names.join(', ') || undefined}>{t('freePage.table.usedByCount', { count })}</span>;
  }

  return (
    <div className="flex flex-col gap-4 pb-1">
      <PageHeader
        eyebrow={t('freePage.eyebrow')}
        title={t('freePage.title')}
        description={t('freePage.description')}
        actions={(
          <>
            <Link to="/proxies" className="inline-flex items-center gap-2 rounded border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground">
              {t('freePage.openPool')} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <Button variant="secondary" onClick={load}>
              <RefreshCcw className="h-4 w-4" aria-hidden="true" />{t('freePage.refresh')}
            </Button>
          </>
        )}
      />

      <div role="note" className="flex gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-warning">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-semibold">{t('freePage.warnTitle')}</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            <li>{t('free.warn.strangers')}</li>
            <li>{t('free.warn.quality')}</li>
            <li>{t('free.warn.legal')}</li>
          </ul>
        </div>
      </div>

      <FreeProxySearch onAdded={load} />

      <section aria-labelledby="free-list-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="free-list-title" className="mr-2 text-sm font-semibold text-foreground">
            {t('freePage.listTitle')}
            <span className="ml-2 text-xs font-normal text-muted-foreground">{t('freePage.listCount', { shown: filtered.length, total: proxies.length })}</span>
          </h2>
          <select aria-label={t('freePage.filters.protocol')} value={protocol} onChange={(e) => setProtocol(e.target.value)} className={selectCls}>
            <option value="all">{t('freePage.filters.protocolAll')}</option>
            <option value="HTTP">HTTP ({counts.HTTP})</option>
            <option value="SOCKS5">SOCKS5 ({counts.SOCKS5})</option>
          </select>
          <select aria-label={t('freePage.filters.country')} value={country} onChange={(e) => setCountry(e.target.value)} className={`${selectCls} max-w-[220px]`}>
            <option value="all">{t('freePage.filters.countryAll')}</option>
            {countries.map(([cc, n]) => <option key={cc} value={cc}>{countryName(cc, i18n.language)} ({n})</option>)}
            {counts.unknownCountry > 0 && <option value="unknown">{t('freePage.filters.countryUnknown')} ({counts.unknownCountry})</option>}
          </select>
          <select aria-label={t('freePage.filters.status')} value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
            <option value="all">{t('freePage.filters.statusAll')}</option>
            <option value="working">{t('freePage.status.working')} ({counts.working})</option>
            <option value="dead">{t('freePage.status.dead')} ({counts.dead})</option>
            <option value="unchecked">{t('freePage.status.unchecked')} ({counts.unchecked})</option>
          </select>
          {filtersActive && (
            <Button size="sm" variant="ghost" onClick={() => { setProtocol('all'); setCountry('all'); setStatus('all'); }}>
              {t('freePage.filters.reset')}
            </Button>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => checkMany(filtered.map((p) => p.id))} disabled={checkBusy || filtered.length === 0}>
              {checkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Activity className="h-3.5 w-3.5" aria-hidden="true" />}
              {t('freePage.actions.checkAll')}
            </Button>
            <Button size="sm" variant="danger" onClick={() => removeIds(deadIds, t('freePage.confirm.deleteDead', { count: deadIds.length }))} disabled={deleting || deadIds.length === 0}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              {t('freePage.actions.deleteDead')}{deadIds.length ? ` · ${deadIds.length}` : ''}
            </Button>
          </div>
        </div>

        {checkRun && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5 text-xs" aria-live="polite">
            {checkRun.running ? <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" /> : <Activity className="h-4 w-4 text-success" aria-hidden="true" />}
            <span className="text-foreground">
              {t(checkRun.running ? 'freePage.checkRun.running' : 'freePage.checkRun.done', { done: checkRun.done, total: checkRun.total, ok: checkRun.ok, fail: checkRun.fail })}
            </span>
            <div className="h-1.5 min-w-[120px] flex-1 overflow-hidden rounded-full bg-background">
              <div className="h-full bg-primary transition-all duration-200" style={{ width: `${checkRun.total ? Math.round((checkRun.done / checkRun.total) * 100) : 0}%` }} />
            </div>
            {checkRun.running && (
              <Button size="sm" variant="secondary" onClick={stopCheck}><Square className="h-3 w-3" aria-hidden="true" />{t('freePage.checkRun.stop')}</Button>
            )}
          </div>
        )}

        {visibleSelected.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm">
            <span className="font-medium text-foreground">{t('freePage.actions.selected', { count: visibleSelected.length })}</span>
            <Button size="sm" variant="secondary" onClick={() => checkMany(visibleSelected)} disabled={checkBusy || deleting}>
              <Activity className="h-3.5 w-3.5" aria-hidden="true" />{t('freePage.actions.checkSelected')}
            </Button>
            <Button size="sm" variant="danger" onClick={() => removeIds(visibleSelected, t('freePage.confirm.deleteSelected', { count: visibleSelected.length }))} disabled={deleting}>
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}{t('freePage.actions.deleteSelected')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} className="ml-auto">
              <X className="h-4 w-4" aria-hidden="true" />{t('freePage.actions.clear')}
            </Button>
          </div>
        )}

        {error && <div className="rounded border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{error}</div>}

        <div className="rounded-xl border border-border bg-surface">
          {loading ? (
            <div className="flex flex-col items-center gap-3 p-12 text-center text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />{t('freePage.table.loading')}
            </div>
          ) : proxies.length === 0 ? (
            <div className="p-6"><EmptyState title={t('freePage.empty.title')} description={t('freePage.empty.description')} /></div>
          ) : filtered.length === 0 ? (
            <div className="p-6"><EmptyState title={t('freePage.noMatch.title')} description={t('freePage.noMatch.description')} /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th scope="col" className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={t('freePage.table.selectAll')}
                        className="h-4 w-4 cursor-pointer align-middle accent-primary"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected; }}
                        onChange={toggleAll}
                      />
                    </th>
                    <th scope="col" className="px-4 py-3">{t('freePage.table.address')}</th>
                    <th scope="col" className="px-4 py-3">{t('freePage.table.protocol')}</th>
                    <th scope="col" className="px-4 py-3">{t('freePage.table.country')}</th>
                    <th scope="col" className="px-4 py-3">{t('freePage.table.speed')}</th>
                    <th scope="col" className="px-4 py-3">{t('freePage.table.lastCheck')}</th>
                    <th scope="col" className="px-4 py-3">{t('freePage.table.status')}</th>
                    <th scope="col" className="px-4 py-3">{t('freePage.table.usedBy')}</th>
                    <th scope="col" className="px-4 py-3 text-right">{t('freePage.table.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paged.map((p) => {
                    const address = addressOf(p);
                    const cc = String(p.lastCountry || '').toUpperCase();
                    return (
                      <tr key={p.id} className={selectedIds.has(p.id) ? 'bg-primary/5' : 'hover:bg-card/50'}>
                        <td className="px-4 py-2.5">
                          <input
                            type="checkbox"
                            aria-label={t('freePage.table.selectRow', { address })}
                            className="h-4 w-4 cursor-pointer align-middle accent-primary"
                            checked={selectedIds.has(p.id)}
                            onChange={() => toggleRow(p.id)}
                          />
                        </td>
                        <td className="px-4 py-2.5"><code className="font-mono text-xs text-foreground">{address}</code></td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{protocolOf(p)}</td>
                        <td className="px-4 py-2.5 text-xs">
                          {cc ? <span className="text-foreground" title={countryName(cc, i18n.language)}>{cc}</span> : <span className="text-muted-foreground">-</span>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs">{renderSpeed(p)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground" title={p.lastCheckedAt ? formatDateTime(p.lastCheckedAt) : undefined}>
                          {timeAgo(p.lastCheckedAt, t) || t('freePage.table.never')}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">{renderStatus(p)}</td>
                        <td className="px-4 py-2.5 text-xs">{renderUsedBy(p)}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => checkOne(p)} disabled={checkingId === p.id} aria-label={t('freePage.actions.checkAria', { address })} title={t('freePage.actions.check')} className="px-2">
                              {checkingId === p.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Activity className="h-4 w-4" aria-hidden="true" />}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => removeOne(p)} aria-label={t('freePage.actions.deleteAria', { address })} title={t('freePage.actions.delete')} className="px-2 text-destructive hover:bg-destructive/10 hover:text-destructive">
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
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
          {!loading && filtered.length > 0 && (
            <div className="border-t border-border bg-card/95 px-4 py-2.5">
              <Pager total={filtered.length} page={safePage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
