import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';

import Button from '@/components/ui/Button.jsx';
import Input from '@/components/ui/Input.jsx';
import EmptyState from '@/components/EmptyState.jsx';
import { InlineError, SUBTLE_TEXT, Segmented, TonePill, clientLabel, toneText } from '@/components/ai/AiShared.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { ACTIVITY_REFRESH_DEBOUNCE_MS, AUDIT_PAGE_SIZE, approvalPath, buildAuditQuery, createDebounced, errorText, extractRunId, filterAuditItems, formatDuration, relativeTime } from '@/lib/aiCore.mjs';
import { formatDateTime } from '@/lib/utils.js';

const OUTCOME_TONE = { ok: 'success', denied: 'warning', error: 'danger', pending: 'info' };

// `active`: this tab is the one shown. The AI page keeps a visited panel mounted while another tab
// is shown, so the table reloads when it is shown again and, while shown, on AI events.
export default function AiActivityTab({ lang, clients, active = true }) {
  const { t } = useTranslation('ai');
  const [filters, setFilters] = useState({ outcome: 'all', client: '', search: '' });
  const [searchDraft, setSearchDraft] = useState('');
  const [cursors, setCursors] = useState([null]); // cursor for each page we have seen
  const [pageIdx, setPageIdx] = useState(0);
  const [data, setData] = useState({ items: [], nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [seenClients, setSeenClients] = useState([]);
  const seq = useRef(0); // only the newest request may update the table

  // Debounce the search box so typing does not fire a request per key.
  useEffect(() => {
    const id = setTimeout(() => setFilters((f) => (f.search === searchDraft ? f : { ...f, search: searchDraft })), 300);
    return () => clearTimeout(id);
  }, [searchDraft]);

  // quiet: a background refresh keeps the rows as they are (no dimming) until the answer arrives.
  const load = useCallback(async (cursor, { quiet = false } = {}) => {
    const mine = ++seq.current;
    if (!quiet) setLoading(true);
    setError('');
    try {
      const r = await softglazeApi.ai.audit.list(buildAuditQuery(filters, cursor));
      if (mine !== seq.current) return;
      const items = Array.isArray(r) ? r : (r && Array.isArray(r.items) ? r.items : []);
      setData({ items, nextCursor: r && !Array.isArray(r) ? (r.nextCursor ?? null) : null });
      setSeenClients((prev) => {
        const s = new Set(prev);
        items.forEach((it) => { if (it && it.clientName) s.add(it.clientName); });
        return s.size === prev.length ? prev : [...s].sort();
      });
    } catch (e) {
      if (mine === seq.current) setError(errorText(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [filters]);

  // New filters start again at the newest page.
  useEffect(() => { setCursors([null]); setPageIdx(0); load(null); }, [load]);

  // The page on screen, for refreshes started by events.
  const shown = useRef({ load, cursor: null });
  useEffect(() => { shown.current = { load, cursor: cursors[pageIdx] ?? null }; }, [load, cursors, pageIdx]);
  const refreshShown = useCallback(() => { shown.current.load(shown.current.cursor, { quiet: true }); }, []);

  // Shown again after another tab: reload (the first show already loaded above).
  const wasActive = useRef(active);
  useEffect(() => {
    const was = wasActive.current;
    wasActive.current = active;
    if (active && !was) refreshShown();
  }, [active, refreshShown]);

  // While shown: a status change (an app connects, Stop all AI) or an approval change means new
  // entries; a burst reloads once.
  useEffect(() => {
    if (!active) return undefined;
    const refresh = createDebounced(refreshShown, ACTIVITY_REFRESH_DEBOUNCE_MS);
    const offStatus = softglazeApi.ai.onStatusChanged(refresh.call);
    const offApprovals = softglazeApi.ai.onApprovalsChanged(refresh.call);
    return () => {
      refresh.cancel();
      if (typeof offStatus === 'function') offStatus();
      if (typeof offApprovals === 'function') offApprovals();
    };
  }, [active, refreshShown]);

  const rows = filterAuditItems(data.items, { ...filters, outcome: filters.outcome === 'all' ? '' : filters.outcome });
  const clientOptions = useMemo(() => {
    const s = new Set(seenClients);
    (clients || []).forEach((c) => { if (c && c.clientName) s.add(c.clientName); });
    return [...s].sort();
  }, [seenClients, clients]);
  const now = Date.now();
  const filtered = filters.outcome !== 'all' || filters.client || filters.search;

  function goNext() {
    if (!data.nextCursor) return;
    const next = [...cursors.slice(0, pageIdx + 1), data.nextCursor];
    setCursors(next);
    setPageIdx(pageIdx + 1);
    load(data.nextCursor);
  }
  function goPrev() {
    if (pageIdx === 0) return;
    const i = pageIdx - 1;
    setPageIdx(i);
    load(cursors[i]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-xs">
          <Input icon={Search} value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} placeholder={t('activity.search')} aria-label={t('activity.search')} />
        </div>
        <Segmented
          label={t('activity.outcome')}
          value={filters.outcome}
          onChange={(v) => setFilters((f) => ({ ...f, outcome: v }))}
          options={[
            { value: 'all', label: t('activity.all') },
            { value: 'ok', label: t('activity.outcomes.ok') },
            { value: 'denied', label: t('activity.outcomes.denied') },
            { value: 'error', label: t('activity.outcomes.error') },
            { value: 'pending', label: t('activity.outcomes.pending') }
          ]}
        />
        <label className={`flex items-center gap-2 text-[12.5px] ${SUBTLE_TEXT}`}>
          {t('activity.app')}
          <select
            value={filters.client}
            onChange={(e) => setFilters((f) => ({ ...f, client: e.target.value }))}
            className="h-9 max-w-[12rem] cursor-pointer rounded border border-border bg-input-background px-2 text-[13px] text-foreground outline-none focus:border-primary"
          >
            <option value="">{t('activity.allApps')}</option>
            {clientOptions.map((c) => <option key={c} value={c}>{clientLabel(t, c)}</option>)}
          </select>
        </label>
        <Button className="ml-auto" variant="secondary" size="sm" onClick={() => load(cursors[pageIdx])} disabled={loading}>
          <RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /> {t('refresh')}
        </Button>
      </div>

      {error && <InlineError>{t('activity.loadError', { message: error })}</InlineError>}

      {!error && !loading && rows.length === 0 && pageIdx === 0 ? (
        <EmptyState title={filtered ? t('activity.noMatchTitle') : t('activity.emptyTitle')} description={filtered ? t('activity.noMatchBody') : t('activity.emptyBody')} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] table-fixed border-collapse text-left text-sm" aria-busy={loading}>
              <caption className="sr-only">{t('activity.caption')}</caption>
              <colgroup>
                <col className="w-[12%]" />
                <col className="w-[17%]" />
                <col className="w-[14%]" />
                <col />
                <col className="w-[14%]" />
                <col className="w-[10%]" />
              </colgroup>
              <thead className="bg-surface text-[11px] font-semibold uppercase tracking-wider text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]">
                <tr>
                  <th scope="col" className="px-4 py-3">{t('activity.colTime')}</th>
                  <th scope="col" className="px-4 py-3">{t('activity.colApp')}</th>
                  <th scope="col" className="px-4 py-3">{t('activity.colTool')}</th>
                  <th scope="col" className="px-4 py-3">{t('activity.colSummary')}</th>
                  <th scope="col" className="px-4 py-3">{t('activity.colOutcome')}</th>
                  <th scope="col" className="px-4 py-3 text-right">{t('activity.colDuration')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && rows.length === 0
                  ? Array.from({ length: 12 }).map((_, i) => (
                    <tr key={`s${i}`} aria-hidden="true"><td colSpan={6} className="h-[54px] px-4 py-2"><div className="h-5 animate-pulse rounded bg-secondary motion-reduce:animate-none" /></td></tr>
                  ))
                  : rows.map((it, i) => (
                    <tr key={it.id ?? `${it.at}-${i}`} className={loading ? 'opacity-60' : ''}>
                      <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px] text-foreground" title={formatDateTime(it.at)}>{relativeTime(it.at, now, lang) || '-'}</td>
                      <td className="px-4 py-2.5 text-[12.5px]">
                        <span className="block max-w-[11rem] truncate text-foreground" title={it.clientName || ''}>{clientLabel(t, it.clientName) || '-'}</span>
                        <span className="block max-w-[11rem] truncate text-[11.5px] text-muted-foreground" title={it.tokenName || ''}>{it.tokenName || ''}</span>
                      </td>
                      <td className="px-4 py-2.5"><code className="block truncate font-mono text-[12px] text-foreground" title={it.tool || ''}>{it.tool || '-'}</code></td>
                      <td className="px-4 py-2.5 text-[12.5px] text-foreground">
                        <span className="line-clamp-2 break-words" title={it.summary || ''}>{it.summary || ''}</span>
                        {extractRunId(it) && (
                          <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                            {t('activity.runId')} <code className="select-all font-mono text-foreground" title={extractRunId(it)}>{extractRunId(it)}</code>
                          </span>
                        )}
                        {it.outcome === 'error' && it.error && <span className="mt-0.5 block truncate text-[11.5px]" style={toneText('danger')} title={String(it.error)}>{String(it.error)}</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <TonePill tone={OUTCOME_TONE[it.outcome] || 'muted'}>{t(`activity.outcomes.${it.outcome}`, { defaultValue: it.outcome || '-' })}</TonePill>
                        {approvalPath(it) && <span className="mt-1 block text-[11px] text-muted-foreground">{t(`activity.approval.${approvalPath(it)}`)}</span>}
                      </td>
                      <td className="whitespace-nowrap py-2.5 pl-2 pr-4 text-right font-mono text-[12px] tabular-nums text-muted-foreground">{formatDuration(it.durationMs)}</td>
                    </tr>
                  ))}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-[13px] text-muted-foreground">{t('activity.pageEmpty')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-[12px] text-muted-foreground">
            <span>{t('activity.pageInfo', { page: pageIdx + 1, size: AUDIT_PAGE_SIZE })}</span>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={goPrev} disabled={loading || pageIdx === 0}><ChevronLeft className="h-3.5 w-3.5" /> {t('activity.newer')}</Button>
              <Button size="sm" variant="ghost" onClick={goNext} disabled={loading || !data.nextCursor}>{t('activity.older')} <ChevronRight className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
