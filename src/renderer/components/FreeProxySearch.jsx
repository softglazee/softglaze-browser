import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Gift, Loader2, ShieldCheck, Square } from 'lucide-react';
import Button from '@/components/ui/Button.jsx';
import Input from '@/components/ui/Input.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

// The free-proxy search: downloads the public lists, tests each candidate through itself, drops dead
// ones and any that leak the real IP, and saves up to the limit. A search still running from an
// earlier visit to the page is picked up from its progress frames, so Stop still reaches it.
const selectCls = 'h-10 w-full rounded border border-border bg-input-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50';
const labelCls = 'mb-1.5 block text-xs font-medium text-muted-foreground';

export default function FreeProxySearch({ onAdded }) {
  const { t } = useTranslation('proxies');
  const [protocol, setProtocol] = useState('http');
  const [country, setCountry] = useState('');
  const [limit, setLimit] = useState(10);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false); // a search started elsewhere is still running in main
  const mounted = useRef(true);
  const ownRun = useRef(false); // this component's own search call is pending
  const onAddedRef = useRef(onAdded);
  onAddedRef.current = onAdded;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const off = softglazeApi.proxies.onFreeProgress((p) => {
      if (!p || !mounted.current) return;
      if (p.phase === 'fetch' || p.phase === 'check') {
        setRunning(true);
        setBusy(false);
        setProgress(p.phase === 'fetch' ? { phase: 'fetch' } : { phase: 'check', total: p.total || 0, checked: p.checked || 0, found: p.found || 0 });
      } else if (p.phase === 'done' && !ownRun.current) {
        // A search picked up from an earlier visit: its call resolved elsewhere, so finish here.
        setRunning(false);
        setProgress(null);
        setResult(p);
        if (p.added > 0 && onAddedRef.current) onAddedRef.current();
      }
    });
    return () => { try { if (off) off(); } catch (e) { /* ignore */ } };
  }, []);

  async function start() {
    setErr(''); setResult(null); setBusy(false);
    const cc = country.trim().toUpperCase();
    if (cc && !/^[A-Z]{2}$/.test(cc)) { setErr(t('free.errors.country')); return; }
    ownRun.current = true;
    setProgress({ phase: 'fetch' });
    setRunning(true);
    try {
      const r = await softglazeApi.proxies.freeHarvest({ protocol, country: cc || undefined, limit: Number(limit) || 10 });
      if (!mounted.current) return;
      setResult(r);
      if (r && r.added > 0 && onAddedRef.current) onAddedRef.current();
    } catch (e) {
      if (!mounted.current) return;
      if (e && e.code === 'BUSY') setBusy(true);
      else setErr((e && e.message) || t('free.errors.failed'));
    } finally {
      ownRun.current = false;
      if (mounted.current) { setRunning(false); setProgress(null); }
    }
  }

  async function cancel() {
    try { await softglazeApi.proxies.freeCancel(); } catch (e) { /* the search ends on its own */ }
    if (mounted.current) setBusy(false);
  }

  const stoppedText = (s) => ({
    limit: t('free.stopped.limit'),
    time: t('free.stopped.time'),
    cancelled: t('free.stopped.cancelled'),
    exhausted: t('free.stopped.exhausted')
  }[s] || '');

  const barPct = progress && progress.phase === 'check'
    ? Math.min(100, Math.round((progress.found / Math.max(1, Number(limit))) * 100))
    : 0;

  return (
    <section aria-labelledby="free-search-title" className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="free-search-title" className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Gift className="h-4 w-4 text-primary" aria-hidden="true" />{t('freePage.searchTitle')}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('free.description')}</p>
        </div>
        <p className="flex max-w-md items-start gap-1.5 text-xs text-success">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{t('free.checks')}</span>
        </p>
      </div>

      <form
        className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
        onSubmit={(e) => { e.preventDefault(); if (!running) start(); }}
      >
        <div>
          <label className={labelCls} htmlFor="free-protocol">{t('free.protocol')}</label>
          <select id="free-protocol" className={selectCls} value={protocol} onChange={(e) => setProtocol(e.target.value)} disabled={running}>
            <option value="http">HTTP</option>
            <option value="socks5">SOCKS5</option>
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="free-country">{t('free.country')}</label>
          <Input id="free-country" value={country} maxLength={2} placeholder={t('free.countryPlaceholder')} onChange={(e) => setCountry(e.target.value.toUpperCase())} disabled={running} className="h-10" />
        </div>
        <div>
          <label className={labelCls} htmlFor="free-limit">{t('free.limit')}</label>
          <Input id="free-limit" type="number" min={1} max={100} value={limit} onChange={(e) => setLimit(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} disabled={running} className="h-10" />
        </div>
        {running
          ? <Button type="button" variant="secondary" onClick={cancel} className="h-10"><Square className="h-3.5 w-3.5" aria-hidden="true" />{t('free.cancel')}</Button>
          : <Button type="submit" variant="primary" className="h-10"><Gift className="h-4 w-4" aria-hidden="true" />{result ? t('free.again') : t('free.start')}</Button>}
      </form>

      {running && progress && (
        <div className="mt-3" aria-live="polite">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            {progress.phase === 'fetch' ? t('free.progress.fetching') : t('free.progress.checking', { checked: progress.checked, total: progress.total, found: progress.found })}
          </div>
          {progress.phase === 'check' && progress.total > 0 && (
            <div className="h-1.5 overflow-hidden rounded-full bg-background" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={barPct}>
              <div className="h-full bg-primary transition-all duration-200" style={{ width: `${barPct}%` }} />
            </div>
          )}
        </div>
      )}

      {busy && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning" role="status">
          <span>{t('freePage.busy')}</span>
          <Button type="button" size="sm" variant="secondary" onClick={cancel}>{t('freePage.stopIt')}</Button>
        </div>
      )}

      {err && <p className="mt-3 text-xs text-destructive" role="alert">{err}</p>}

      {result && !running && (
        <div className={`mt-3 rounded border px-3 py-2.5 text-xs ${result.added > 0 ? 'border-success/30 bg-success/10 text-success' : 'border-warning/30 bg-warning/10 text-warning'}`} role="status">
          <div className="font-medium">{t('free.result.added', { added: result.added, requested: result.requested })}</div>
          <div className="mt-1 text-muted-foreground">
            {t('free.result.checked', { checked: result.checked, total: result.total })}
            {' · '}{t('free.result.rejected', { dead: result.rejected?.dead || 0, leak: result.rejected?.transparent || 0, country: result.rejected?.country || 0 })}
          </div>
          {stoppedText(result.stopped) && <div className="mt-1 text-muted-foreground">{stoppedText(result.stopped)}</div>}
          {result.limitReached && <div className="mt-1">{t('free.result.planLimit')}</div>}
        </div>
      )}
    </section>
  );
}
