import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Cookie, X, Loader2, Download, Copy, Upload, Check, Layers, AlertTriangle } from 'lucide-react';
import { useDialog } from '@/lib/useDialog.js';
import Button from '@/components/ui/Button.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

function safeName(name) {
  return String(name || 'profile').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 60) || 'profile';
}

// Compact cookie-health summary with expiry warnings.
function CookieHealth({ health }) {
  const { t } = useTranslation('cmpModalsB');
  if (!health) return null;
  const chip = (label, value, cls) => (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{value} {label}</span>
  );
  return (
    <div className="rounded border border-border bg-surface p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {chip(t('cookieManager.healthTotal'), health.total, 'bg-background text-foreground border border-border')}
        {chip(t('cookieManager.healthDomains'), health.domains, 'bg-background text-foreground border border-border')}
        {chip(t('cookieManager.healthSession'), health.session, 'bg-background text-muted border border-border')}
        {chip(t('cookieManager.healthSecure'), health.secure, 'bg-background text-muted border border-border')}
      </div>
      {(health.expired > 0 || health.expiringSoon > 0) && (
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/60">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          {health.expired > 0 && chip(t('cookieManager.healthExpired'), health.expired, 'bg-red-500/10 text-red-400 border border-red-500/30')}
          {health.expiringSoon > 0 && chip(t('cookieManager.healthExpiringSoon'), health.expiringSoon, 'bg-amber-500/10 text-amber-400 border border-amber-500/30')}
        </div>
      )}
    </div>
  );
}

export default function CookieManagerModal({ profileId, profileName, onClose }) {
  const { t } = useTranslation('cmpModalsB');
  const { dialogRef } = useDialog({ onClose });
  const [tab, setTab] = useState('export'); // 'export' | 'import'
  const [format, setFormat] = useState('json'); // 'json' | 'netscape'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [exportContent, setExportContent] = useState('');
  const [exportCount, setExportCount] = useState(null);
  const [exportHealth, setExportHealth] = useState(null);
  const [importHealth, setImportHealth] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResults, setBulkResults] = useState(null);
  const [importText, setImportText] = useState('');
  const [copied, setCopied] = useState(false);
  const fileRef = useRef(null);

  const reset = () => { setError(''); setInfo(''); };

  const handleExport = async () => {
    reset(); setBusy(true); setExportContent(''); setExportCount(null); setExportHealth(null);
    try {
      const res = await softglazeApi.profiles.exportCookies(profileId, format);
      setExportContent(res.content);
      setExportCount(res.count);
      setExportHealth(res.health || null);
      setInfo(t('cookieManager.infoExported', { count: res.count }));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const handleCopy = async () => {
    if (!exportContent) return;
    try { await navigator.clipboard.writeText(exportContent); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) { setError(t('cookieManager.errorCopyFailed')); }
  };

  const handleDownload = () => {
    if (!exportContent) return;
    const ext = format === 'netscape' ? 'txt' : 'json';
    const blob = new Blob([exportContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName(profileName)}-cookies.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setImportText(String(reader.result || '')); if (file.name.endsWith('.txt')) setFormat('netscape'); else if (file.name.endsWith('.json')) setFormat('json'); };
    reader.onerror = () => setError(t('cookieManager.errorReadFile'));
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImport = async () => {
    reset(); setBulkResults(null);
    if (!importText.trim()) { setError(t('cookieManager.errorPasteFirst')); return; }
    setBusy(true);
    try {
      const res = await softglazeApi.profiles.importCookies(profileId, importText, format);
      setImportHealth(res.health || null);
      setInfo(t('cookieManager.infoImported', { imported: res.imported, parsed: res.parsed }));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const handleBulkImport = async () => {
    reset(); setBulkResults(null);
    if (!importText.trim()) { setError(t('cookieManager.errorPasteFirst')); return; }
    setBulkBusy(true);
    try {
      const res = await softglazeApi.profiles.importCookiesToRunning(importText, format);
      setImportHealth(res.health || null);
      setBulkResults(res.results || []);
      const ok = (res.results || []).filter((r) => r.ok).length;
      setInfo(t('cookieManager.infoBulkImported', { count: res.targets, ok }));
    } catch (err) { setError(err.message); }
    finally { setBulkBusy(false); }
  };

  const tabBtn = (key, label) => (
    <button
      onClick={() => { setTab(key); reset(); }}
      className={`px-4 py-1.5 text-sm font-medium rounded transition-all ${tab === key ? 'bg-primary text-white shadow-glow' : 'text-muted hover:text-foreground hover:bg-surface'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('cookieManager.dialogLabel')} tabIndex={-1} className="w-full max-w-lg max-h-[88vh] overflow-hidden flex flex-col rounded border border-border bg-card shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-surface">
          <div className="flex items-center gap-3">
            <div className="bg-amber-500/10 p-1.5 rounded border border-amber-500/20">
              <Cookie className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-foreground font-bold text-sm leading-tight tracking-wide uppercase">{t('cookieManager.title')}</h2>
              <p className="text-xs text-muted leading-tight mt-0.5">{profileName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-muted hover:text-foreground rounded hover:bg-muted-dark transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-background/50">
          <div className="flex gap-1">{tabBtn('export', t('cookieManager.tabExport'))}{tabBtn('import', t('cookieManager.tabImport'))}</div>
          <div className="flex items-center gap-1 bg-background border border-border rounded p-1 shadow-inner">
            <button onClick={() => setFormat('json')} className={`px-3 py-1 text-xs font-semibold uppercase tracking-wider rounded transition ${format === 'json' ? 'bg-surface text-foreground shadow-sm border border-border' : 'text-muted hover:text-foreground'}`}>JSON</button>
            <button onClick={() => setFormat('netscape')} className={`px-3 py-1 text-xs font-semibold uppercase tracking-wider rounded transition ${format === 'netscape' ? 'bg-surface text-foreground shadow-sm border border-border' : 'text-muted hover:text-foreground'}`}>Netscape</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <p className="text-xs text-muted leading-relaxed bg-surface p-3 rounded border border-border">
            {t('cookieManager.runningHint')}
          </p>

          {error && <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}
          {info && <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400 font-medium flex items-center gap-2"><Check className="w-4 h-4" /> {info}</div>}

          {tab === 'export' ? (
            <>
              <Button size="md" variant="primary" disabled={busy} onClick={handleExport} className="w-full">
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                {t('cookieManager.exportButton')}
              </Button>
              {exportContent && (
                <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
                  <CookieHealth health={exportHealth} />
                  <textarea
                    readOnly
                    value={exportContent}
                    className="w-full h-48 bg-background border border-border rounded p-4 text-xs font-mono text-muted-foreground outline-none resize-none shadow-inner focus:border-primary focus:ring-1 focus:ring-primary transition"
                  />
                  <div className="flex gap-3">
                    <Button size="sm" variant="secondary" onClick={handleCopy} className="flex-1">
                      {copied ? <Check className="w-4 h-4 mr-2 text-emerald-400" /> : <Copy className="w-4 h-4 mr-2" />}
                      {copied ? t('cookieManager.copied') : t('cookieManager.copyClipboard')}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={handleDownload} className="flex-1">
                      <Download className="w-4 h-4 mr-2" /> {t('cookieManager.download', { ext: format === 'netscape' ? 'txt' : 'json' })}
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={format === 'netscape' ? '# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tTRUE\t1767225600\tsid\tabc123' : '[{ "name": "sid", "value": "abc123", "domain": ".example.com", "path": "/", "secure": true }]'}
                className="w-full h-48 bg-background border border-border rounded p-4 text-xs font-mono text-muted-foreground outline-none resize-none shadow-inner focus:border-primary focus:ring-1 focus:ring-primary transition"
              />
              <div className="flex gap-3">
                <input ref={fileRef} type="file" accept=".json,.txt" onChange={handleFile} className="hidden" />
                <Button size="sm" variant="secondary" onClick={() => fileRef.current && fileRef.current.click()} className="flex-1">
                  <Upload className="w-4 h-4 mr-2" /> {t('cookieManager.loadFile')}
                </Button>
                <Button size="sm" variant="primary" disabled={busy || bulkBusy} onClick={handleImport} className="flex-1">
                  {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  {t('cookieManager.importToProfile')}
                </Button>
              </div>
              <Button size="sm" variant="secondary" disabled={busy || bulkBusy} onClick={handleBulkImport} className="w-full">
                {bulkBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Layers className="w-4 h-4 mr-2" />}
                {t('cookieManager.importToAll')}
              </Button>

              {importHealth && <CookieHealth health={importHealth} />}

              {bulkResults && (
                <div className="rounded border border-border bg-background p-3 space-y-1.5 max-h-40 overflow-y-auto">
                  {bulkResults.map((r) => (
                    <div key={r.sessionId} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground truncate">{r.profileName}</span>
                      <span className={r.ok ? 'text-emerald-400' : 'text-red-400'}>
                        {r.ok ? t('cookieManager.resultImported', { count: r.imported }) : t('cookieManager.resultFailed')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end px-5 py-4 border-t border-border bg-surface">
          <Button size="sm" variant="secondary" onClick={onClose}>{t('cookieManager.close')}</Button>
        </div>
      </div>
    </div>
  );
}