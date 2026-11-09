import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import Button from '@/components/ui/Button.jsx';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/Dialog.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

export const PROXY_EXTENSION_URL = 'https://browser.softglaze.com/proxy-extension';

// "Copy for SoftGlaze Proxy": puts the selected proxies on the clipboard as lines the SoftGlaze Proxy
// browser extension's Bulk import reads (scheme://user:pass@host:port). The main process builds the
// lines and writes the clipboard, so usernames and passwords never reach this window; it only gets
// counts. Logins go along only when the box is ticked and the member's role may see them.
function Note({ tone = 'warning', children, id }) {
  const cls = tone === 'warning'
    ? 'border-warning/30 bg-warning/10 text-warning'
    : 'border-border bg-background text-muted-foreground';
  return (
    <p id={id} role="note" className={`flex items-start gap-2 rounded border px-3 py-2 text-xs ${cls}`}>
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export default function CopyForProxyExtensionDialog({ open, onOpenChange, ids }) {
  const { t } = useTranslation('proxies');
  const [info, setInfo] = useState(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [includeCredentials, setIncludeCredentials] = useState(false);
  const [copying, setCopying] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  // Fresh state each time it opens: the box always starts unticked.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setInfo(null);
    setResult(null);
    setError('');
    setIncludeCredentials(false);
    if (!ids || ids.length === 0) return undefined;
    setLoadingInfo(true);
    softglazeApi.proxies.extensionCopyInfo(ids)
      .then((r) => { if (!cancelled) setInfo(r); })
      .catch((e) => { if (!cancelled) setError((e && e.message) || t('copyForExtension.loadError')); })
      .finally(() => { if (!cancelled) setLoadingInfo(false); });
    return () => { cancelled = true; };
  }, [open, ids, t]);

  const canInclude = Boolean(info && info.canIncludeCredentials && info.withLogin > 0);
  const credsReason = !info ? '' : (!info.canIncludeCredentials ? t('copyForExtension.credsNoRole') : (info.withLogin === 0 ? t('copyForExtension.credsNone') : ''));
  const withCreds = includeCredentials && canInclude;

  async function handleCopy() {
    setCopying(true);
    setError('');
    setResult(null);
    try {
      const r = await softglazeApi.proxies.copyForExtension(ids, withCreds);
      setResult(r);
    } catch (e) {
      setError((e && e.message) || t('copyForExtension.copyError'));
    } finally {
      setCopying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('copyForExtension.title')} className="max-w-lg rounded border-border bg-card">
        <DialogHeader>
          <DialogTitle>{t('copyForExtension.title')}</DialogTitle>
          <DialogDescription>{t('copyForExtension.description')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          {loadingInfo && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t('copyForExtension.loading')}</p>
          )}
          {info && (
            <>
              <p className="text-sm text-foreground">
                <span className="font-semibold">{t('copyForExtension.count', { count: info.count })}</span>
                {info.skipped > 0 && <span className="block text-xs text-muted-foreground mt-1">{t('copyForExtension.skipped', { count: info.skipped })}</span>}
              </p>
              <div className="grid gap-1.5">
                <label className={`flex items-start gap-2.5 text-sm ${canInclude ? 'text-foreground cursor-pointer' : 'text-muted-foreground cursor-not-allowed'}`}>
                  <input
                    type="checkbox"
                    checked={withCreds}
                    disabled={!canInclude || copying}
                    onChange={(e) => { setIncludeCredentials(e.target.checked); setResult(null); }}
                    aria-describedby={credsReason ? 'copy-ext-creds-reason' : undefined}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                  />
                  <span>{t('copyForExtension.includeCredentials')}</span>
                </label>
                {credsReason && <p id="copy-ext-creds-reason" className="pl-[26px] text-xs text-muted-foreground">{credsReason}</p>}
              </div>
              {withCreds && info.socks5WithLogin > 0 && <Note>{t('copyForExtension.socks5Note', { count: info.socks5WithLogin })}</Note>}
              {withCreds && info.socks4WithLogin > 0 && <Note>{t('copyForExtension.socks4Note', { count: info.socks4WithLogin })}</Note>}
              <Note>{t('copyForExtension.clipboardWarning')}</Note>
            </>
          )}
          {error && <p role="alert" className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
          <div role="status" aria-live="polite">
            {result && (
              <p className="flex items-start gap-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{t(result.includedCredentials ? 'copyForExtension.copiedWithCredentials' : 'copyForExtension.copied', { count: result.copied })}</span>
              </p>
            )}
          </div>
          <a href={PROXY_EXTENSION_URL} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> {t('copyForExtension.getExtension')}
          </a>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={copying}>{result ? t('copyForExtension.close') : t('copyForExtension.cancel')}</Button>
          <Button type="button" variant="primary" onClick={handleCopy} disabled={copying || loadingInfo || !info || info.count === 0}>
            {copying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            {copying ? t('copyForExtension.copying') : t('copyForExtension.copy')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
