import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Gift, Loader2, ShieldCheck } from 'lucide-react';
import Button from '@/components/ui/Button.jsx';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/Dialog.jsx';
import Input from '@/components/ui/Input.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

// Fetches public free-proxy lists, tests each candidate through itself, drops dead ones and any
// that leak the real IP, and adds up to limit to a "Free proxies" group. Quick generate uses them
// only when that group or provider is chosen. The warnings show every time before starting.
const selectCls = 'h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40';
const labelCls = 'block text-xs font-medium text-muted mb-1.5';

export default function FreeProxiesDialog({ open, onOpenChange, onAdded }) {
  const { t } = useTranslation('proxies');
  const [protocol, setProtocol] = useState('http');
  const [country, setCountry] = useState('');
  const [limit, setLimit] = useState(10);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  // Live progress while a search runs.
  useEffect(() => {
    if (!open) return undefined;
    const off = softglazeApi.proxies.onFreeProgress((p) => {
      if (!p || !mounted.current) return;
      if (p.phase === 'fetch') setProgress({ phase: 'fetch' });
      else if (p.phase === 'check') setProgress({ phase: 'check', total: p.total || 0, checked: p.checked || 0, found: p.found || 0 });
    });
    return () => { try { off && off(); } catch (e) { /* ignore */ } };
  }, [open]);

  // Reset when the dialog is opened again.
  useEffect(() => {
    if (open && !running) { setResult(null); setErr(''); setProgress(null); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setErr(''); setResult(null); setProgress({ phase: 'fetch' }); setRunning(true);
    const cc = country.trim().toUpperCase();
    if (cc && !/^[A-Z]{2}$/.test(cc)) { setErr(t('free.errors.country')); setRunning(false); setProgress(null); return; }
    try {
      const r = await softglazeApi.proxies.freeHarvest({ protocol, country: cc || undefined, limit: Number(limit) || 10 });
      if (!mounted.current) return;
      setResult(r);
      if (r && r.added > 0 && onAdded) onAdded();
    } catch (e) {
      if (mounted.current) setErr((e && e.message) || t('free.errors.failed'));
    } finally {
      if (mounted.current) { setRunning(false); setProgress(null); }
    }
  }

  async function cancel() {
    try { await softglazeApi.proxies.freeCancel(); } catch (e) { /* the search ends on its own */ }
  }

  const stoppedText = (s) => ({
    limit: t('free.stopped.limit'),
    time: t('free.stopped.time'),
    cancelled: t('free.stopped.cancelled'),
    exhausted: t('free.stopped.exhausted')
  }[s] || '');

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!running) onOpenChange(v); }}>
      <DialogContent title={t('free.title')} className="rounded border-border bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Gift className="h-4 w-4 text-primary" />{t('free.title')}</DialogTitle>
          <DialogDescription>{t('free.description')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <div role="note" className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[12px] text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <ul className="list-disc space-y-1 pl-4">
              <li>{t('free.warn.strangers')}</li>
              <li>{t('free.warn.quality')}</li>
              <li>{t('free.warn.legal')}</li>
            </ul>
          </div>
          <div className="flex gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-[12px] text-emerald-300">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t('free.checks')}</span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={labelCls} htmlFor="free-protocol">{t('free.protocol')}</label>
              <select id="free-protocol" className={selectCls} value={protocol} onChange={(e) => setProtocol(e.target.value)} disabled={running}>
                <option value="http">HTTP</option>
                <option value="socks5">SOCKS5</option>
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="free-country">{t('free.country')}</label>
              <Input id="free-country" value={country} maxLength={2} placeholder={t('free.countryPlaceholder')} onChange={(e) => setCountry(e.target.value.toUpperCase())} disabled={running} />
            </div>
            <div>
              <label className={labelCls} htmlFor="free-limit">{t('free.limit')}</label>
              <Input id="free-limit" type="number" min={1} max={100} value={limit} onChange={(e) => setLimit(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} disabled={running} />
            </div>
          </div>

          {running && progress && (
            <div aria-live="polite">
              <div className="mb-1.5 flex items-center justify-between text-[11.5px] text-muted">
                <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {progress.phase === 'fetch' ? t('free.progress.fetching') : t('free.progress.checking', { checked: progress.checked, total: progress.total, found: progress.found })}
                </span>
              </div>
              {progress.phase === 'check' && progress.total > 0 && (
                <div className="h-1.5 overflow-hidden rounded-full bg-background">
                  <div className="h-full bg-primary transition-all duration-200" style={{ width: `${Math.min(100, Math.round((progress.found / Math.max(1, Number(limit))) * 100))}%` }} />
                </div>
              )}
            </div>
          )}

          {err && <p className="text-[12px] text-red-400">{err}</p>}

          {result && (
            <div className={`rounded-lg border px-3 py-2.5 text-[12px] ${result.added > 0 ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>
              <div className="font-medium">{t('free.result.added', { added: result.added, requested: result.requested })}</div>
              <div className="mt-1 text-muted">
                {t('free.result.checked', { checked: result.checked, total: result.total })}
                {' · '}{t('free.result.rejected', { dead: result.rejected?.dead || 0, leak: result.rejected?.transparent || 0, country: result.rejected?.country || 0 })}
              </div>
              {stoppedText(result.stopped) && <div className="mt-1 text-muted">{stoppedText(result.stopped)}</div>}
              {result.limitReached && <div className="mt-1">{t('free.result.planLimit')}</div>}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {running
            ? <Button variant="secondary" onClick={cancel}>{t('free.cancel')}</Button>
            : <Button variant="ghost" onClick={() => onOpenChange(false)}>{result ? t('free.done') : t('free.close')}</Button>}
          {!running && <Button variant="primary" onClick={start}><Gift className="h-4 w-4" />{result ? t('free.again') : t('free.start')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
