import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Globe, Info, Loader2, RefreshCw, Server, Trophy } from 'lucide-react';

import { PROVIDERS, ProviderLogo } from '@/components/ProxyProviders.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card } from '@/components/ui/Card.jsx';
import { toneText } from '@/lib/providerStates.js';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { cn, formatDateTime } from '@/lib/utils.js';

// Per-vendor success rate, speed and blocklist rate from the workspace's own proxy checks
// (main/vendorScoreboard.js builds the rows). A collapsible section on the Proxy providers page.

const OPEN_KEY = 'sg.providers.scoreboardOpen';

function readOpen() {
  try { return window.localStorage.getItem(OPEN_KEY) !== '0'; } catch (e) { return true; }
}
function writeOpen(on) {
  try { window.localStorage.setItem(OPEN_KEY, on ? '1' : '0'); } catch (e) { /* storage blocked */ }
}

const BY_KEY = Object.fromEntries(PROVIDERS.map((p) => [p.key, p]));

// Pill text is tinted toward the foreground (toneText) so amber and green stay readable in light mode.
const LEVEL_STYLE = {
  good: 'border-success/30 bg-success/10',
  fair: 'border-warning/30 bg-warning/10',
  poor: 'border-destructive/30 bg-destructive/10'
};
const LEVEL_TONE = { good: 'success', fair: 'warning', poor: 'danger' };

// Sort value per column, and whether the first click sorts high to low (the better end first).
const COLUMNS = [
  { key: 'vendor', value: (r, label) => label.toLowerCase(), firstDir: 'asc', align: 'left' },
  { key: 'score', value: (r) => r.score, firstDir: 'desc', align: 'left' },
  { key: 'success', value: (r) => r.successPct, firstDir: 'desc', align: 'right' },
  { key: 'speed', value: (r) => r.medianMs, firstDir: 'asc', align: 'right' },
  { key: 'blocklisted', value: (r) => r.blocklistedPct, firstDir: 'asc', align: 'right' },
  { key: 'datacenter', value: (r) => r.datacenterPct, firstDir: 'asc', align: 'right' },
  { key: 'blocks', value: (r) => r.blocks, firstDir: 'asc', align: 'right' },
  { key: 'proxies', value: (r) => r.proxies, firstDir: 'desc', align: 'right' },
  { key: 'lastChecked', value: (r) => (r.lastCheckedAt ? Date.parse(r.lastCheckedAt) : null), firstDir: 'desc', align: 'right' }
];

// Rows without a value always sort last; ties keep the server's order (best score first).
function sortRows(rows, sort, labelOf) {
  const col = COLUMNS.find((c) => c.key === sort.key) || COLUMNS[1];
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, v: col.value(r, labelOf(r)) }))
    .sort((a, b) => {
      const an = a.v == null;
      const bn = b.v == null;
      if (an !== bn) return an ? 1 : -1;
      if (!an && a.v !== b.v) return (a.v < b.v ? -1 : 1) * sign;
      return a.i - b.i;
    })
    .map((x) => x.r);
}

function NoData({ t }) {
  return (
    <>
      <span aria-hidden="true" className="text-muted-foreground">-</span>
      <span className="sr-only">{t('noData')}</span>
    </>
  );
}

function VendorTile({ r }) {
  const p = BY_KEY[r.key];
  if (r.kind !== 'vendor' || !p) {
    const Icon = r.kind === 'free' ? Globe : Server;
    return (
      <span className="w-7 h-7 rounded-lg grid place-items-center shrink-0 border border-border bg-surface text-muted-foreground">
        <Icon className="w-4 h-4" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="w-7 h-7 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${p.color} 14%, transparent)`, color: `color-mix(in srgb, ${p.color} 80%, var(--foreground))`, border: `1px solid color-mix(in srgb, ${p.color} 28%, transparent)` }}>
      <ProviderLogo k={p.key} className="w-4 h-4" />
    </span>
  );
}

function ScorePill({ r, t, days, min }) {
  if (r.score == null) {
    return (
      <span title={t('notEnoughTitle', { count: r.checks, days, min })} className="inline-flex items-center whitespace-nowrap rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        {t('notEnough')}
      </span>
    );
  }
  const level = t(`level.${r.level}`);
  return (
    <span title={t('scoreTitle', { level, score: r.score })} style={toneText(LEVEL_TONE[r.level])} className={cn('inline-flex min-w-[2.75rem] justify-center rounded-full border px-2 py-0.5 text-xs font-bold tabular-nums', LEVEL_STYLE[r.level])}>
      <span className="sr-only">{level}: </span>{r.score}
    </span>
  );
}

export default function VendorScoreboard({ onSelect }) {
  const { t, i18n } = useTranslation('scoreboard');
  const lang = i18n.language || 'en';
  const [open, setOpen] = useState(readOpen);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hidden, setHidden] = useState(false);
  const [sort, setSort] = useState({ key: 'score', dir: 'desc' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await softglazeApi.proxies.vendorScoreboard();
      setData(res && Array.isArray(res.rows) ? res : { rows: [] });
    } catch (e) {
      // Members without the proxy permission do not get the section at all.
      if (e && e.code === 'FORBIDDEN') setHidden(true);
      else setError(e && e.message ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (open && !data) load(); }, [open, data, load]);

  const fmt = useMemo(() => {
    const pct = new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 0 });
    const num = new Intl.NumberFormat(lang);
    let when;
    try { when = new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { when = null; }
    return {
      pct: (n) => pct.format(n / 100),
      num: (n) => num.format(n),
      when: (iso) => (when ? when.format(new Date(iso)) : formatDateTime(iso))
    };
  }, [lang]);

  const labelOf = useCallback((r) => {
    if (r.kind === 'own') return t('own');
    if (r.kind === 'free') return t('free');
    return (BY_KEY[r.key] && BY_KEY[r.key].name) || r.name || r.key;
  }, [t]);

  const rows = useMemo(() => sortRows(data ? data.rows : [], sort, labelOf), [data, sort, labelOf]);

  if (hidden) return null;

  const days = (data && data.windowDays) || 7;
  const min = (data && data.minChecks) || 10;

  function toggle() {
    setOpen((v) => { writeOpen(!v); return !v; });
  }

  function sortBy(col) {
    setSort((s) => (s.key === col.key ? { key: col.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: col.key, dir: col.firstDir }));
  }

  return (
    <Card className="overflow-hidden" aria-labelledby="vendor-scoreboard-title">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <h2 id="vendor-scoreboard-title" className="min-w-0">
          <button
            type="button"
            aria-expanded={open}
            aria-controls="vendor-scoreboard-body"
            title={open ? t('hide') : t('show')}
            onClick={toggle}
            className="flex items-center gap-2 rounded text-left text-[15px] font-semibold text-foreground font-display outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', !open && '-rotate-90')} aria-hidden="true" />
            <Trophy className="w-4 h-4 text-primary" aria-hidden="true" />
            {t('title')}
          </button>
        </h2>
        {/* A minimum width moves the note under the title in a narrow window instead of squeezing it. */}
        <p className="min-w-[12rem] flex-1 text-[12.5px] text-muted-foreground">{t('note', { days })}</p>
        {open && (
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} aria-hidden="true" /> {t('refresh')}
          </Button>
        )}
      </div>

      {open && (
        <div id="vendor-scoreboard-body" className="border-t border-border">
          {error && (
            <div role="alert" className="m-4 rounded border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {t('loadError', { message: error })}
            </div>
          )}
          {!data && !error && (
            <p className="flex items-center justify-center gap-2 py-8 text-[13px] text-muted-foreground" role="status">
              <Loader2 className="w-4 h-4 animate-spin text-primary" aria-hidden="true" /> {t('loading')}
            </p>
          )}
          {data && rows.length === 0 && (
            <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">{t('empty')}</p>
          )}
          {data && rows.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-[12.5px]">
                  <thead className="bg-surface text-muted-foreground text-[11px] uppercase tracking-wide font-semibold border-b border-border">
                    <tr>
                      {COLUMNS.map((col) => {
                        const active = sort.key === col.key;
                        const SortIcon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
                        return (
                          <th
                            key={col.key}
                            scope="col"
                            aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                            className={cn('px-3 py-2.5 align-bottom', col.align === 'right' && 'text-right')}
                          >
                            <button
                              type="button"
                              onClick={() => sortBy(col)}
                              title={t('sortBy', { column: t(`col.${col.key}`) })}
                              className={cn('inline-flex items-center gap-1 rounded uppercase tracking-wide outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary', col.align === 'right' && 'flex-row-reverse text-right', active && 'text-foreground')}
                            >
                              {t(`col.${col.key}`)}
                              <SortIcon className={cn('w-3 h-3 shrink-0', !active && 'opacity-40')} aria-hidden="true" />
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((r) => {
                      const label = labelOf(r);
                      const canOpen = Boolean(onSelect && r.kind === 'vendor' && BY_KEY[r.key]);
                      // The site list truncates to the column (w-0 min-w-full) instead of widening it.
                      const sites = r.topSites.map((s) => `${s.site} (${fmt.num(s.count)})`).join(', ');
                      return (
                        <tr key={r.key} className="hover:bg-secondary/60 transition-colors">
                          <th scope="row" className="px-3 py-2 text-left font-normal">
                            <span className="flex items-center gap-2.5">
                              <VendorTile r={r} />
                              {canOpen ? (
                                <button type="button" onClick={() => onSelect(r.key)} title={t('openProvider', { name: label })} className="text-left text-[13px] font-medium text-foreground rounded outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary">
                                  {label}
                                </button>
                              ) : (
                                <span className="text-[13px] font-medium text-foreground">{label}</span>
                              )}
                            </span>
                          </th>
                          <td className="px-3 py-2"><ScorePill r={r} t={t} days={days} min={min} /></td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.successPct != null ? <span className="text-foreground">{fmt.pct(r.successPct)}</span> : <NoData t={t} />}
                            <span className="block text-[11px] text-muted-foreground">{t('checks', { count: r.checks })}</span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                            {r.medianMs != null ? t('ms', { ms: fmt.num(r.medianMs) }) : <NoData t={t} />}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.blocklistedPct != null
                              ? <span className="text-foreground" style={r.blocklistedPct > 0 ? toneText('danger') : undefined}>{fmt.pct(r.blocklistedPct)}</span>
                              : <NoData t={t} />}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.datacenterPct != null ? fmt.pct(r.datacenterPct) : <NoData t={t} />}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            <span className="text-foreground" style={r.blocks > 0 ? toneText('warning') : undefined}>{fmt.num(r.blocks)}</span>
                            {sites && (
                              <span className="block w-0 min-w-full truncate text-[11px] text-muted-foreground" title={t('topSites', { sites })}>{sites}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {fmt.num(r.proxies)}
                            {r.workingPct != null && (
                              <span className="block text-[11px] text-muted-foreground">{t('working', { pct: fmt.pct(r.workingPct) })}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap text-muted-foreground">
                            {r.lastCheckedAt
                              ? <time dateTime={r.lastCheckedAt} title={formatDateTime(r.lastCheckedAt)}>{fmt.when(r.lastCheckedAt)}</time>
                              : t('never')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col gap-1 border-t border-border px-4 py-2.5 text-[11.5px] text-muted-foreground">
                <p className="flex items-start gap-2">
                  <Info className="mt-0.5 w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{t('scoreHelp', { min })}</span>
                </p>
                {data.truncated && <p className="pl-5">{t('truncated', { max: fmt.num(data.maxEvents) })}</p>}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
