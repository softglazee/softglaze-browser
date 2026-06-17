import React, { useState, useRef } from 'react';
import { Cookie, X, Loader2, Download, Copy, Upload, Check } from 'lucide-react';
import Button from '@/components/ui/Button.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

function safeName(name) {
  return String(name || 'profile').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 60) || 'profile';
}

export default function CookieManagerModal({ profileId, profileName, onClose }) {
  const [tab, setTab] = useState('export'); // 'export' | 'import'
  const [format, setFormat] = useState('json'); // 'json' | 'netscape'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [exportContent, setExportContent] = useState('');
  const [exportCount, setExportCount] = useState(null);
  const [importText, setImportText] = useState('');
  const [copied, setCopied] = useState(false);
  const fileRef = useRef(null);

  const reset = () => { setError(''); setInfo(''); };

  const handleExport = async () => {
    reset(); setBusy(true); setExportContent(''); setExportCount(null);
    try {
      const res = await softglazeApi.profiles.exportCookies(profileId, format);
      setExportContent(res.content);
      setExportCount(res.count);
      setInfo(`Exported ${res.count} cookie(s).`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const handleCopy = async () => {
    if (!exportContent) return;
    try { await navigator.clipboard.writeText(exportContent); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) { setError('Copy failed.'); }
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
    reader.onerror = () => setError('Could not read file.');
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImport = async () => {
    reset();
    if (!importText.trim()) { setError('Paste or load cookies first.'); return; }
    setBusy(true);
    try {
      const res = await softglazeApi.profiles.importCookies(profileId, importText, format);
      setInfo(`Imported ${res.imported} of ${res.parsed} parsed cookie(s) into the live session.`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const tabBtn = (key, label) => (
    <button
      onClick={() => { setTab(key); reset(); }}
      className={`px-4 py-1.5 text-sm font-medium rounded transition-all ${tab === key ? 'bg-primary text-white shadow-glow' : 'text-muted hover:text-zinc-100 hover:bg-surface'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[88vh] overflow-hidden flex flex-col rounded border border-border bg-card shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-surface">
          <div className="flex items-center gap-3">
            <div className="bg-amber-500/10 p-1.5 rounded border border-amber-500/20">
              <Cookie className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-zinc-100 font-bold text-sm leading-tight tracking-wide uppercase">Manage Cookies</h2>
              <p className="text-xs text-muted leading-tight mt-0.5">{profileName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-muted hover:text-zinc-100 rounded hover:bg-muted-dark transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-background/50">
          <div className="flex gap-1">{tabBtn('export', 'Export')}{tabBtn('import', 'Import')}</div>
          <div className="flex items-center gap-1 bg-background border border-border rounded p-1 shadow-inner">
            <button onClick={() => setFormat('json')} className={`px-3 py-1 text-xs font-semibold uppercase tracking-wider rounded transition ${format === 'json' ? 'bg-surface text-zinc-100 shadow-sm border border-border' : 'text-muted hover:text-zinc-200'}`}>JSON</button>
            <button onClick={() => setFormat('netscape')} className={`px-3 py-1 text-xs font-semibold uppercase tracking-wider rounded transition ${format === 'netscape' ? 'bg-surface text-zinc-100 shadow-sm border border-border' : 'text-muted hover:text-zinc-200'}`}>Netscape</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <p className="text-xs text-muted leading-relaxed bg-surface p-3 rounded border border-border">
            The profile must be running — cookies are read from and written to its live browser session.
          </p>

          {error && <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}
          {info && <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400 font-medium flex items-center gap-2"><Check className="w-4 h-4" /> {info}</div>}

          {tab === 'export' ? (
            <>
              <Button size="md" variant="primary" disabled={busy} onClick={handleExport} className="w-full">
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                Export from live session
              </Button>
              {exportContent && (
                <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
                  <textarea
                    readOnly
                    value={exportContent}
                    className="w-full h-48 bg-background border border-border rounded p-4 text-xs font-mono text-zinc-300 outline-none resize-none shadow-inner focus:border-primary focus:ring-1 focus:ring-primary transition"
                  />
                  <div className="flex gap-3">
                    <Button size="sm" variant="secondary" onClick={handleCopy} className="flex-1">
                      {copied ? <Check className="w-4 h-4 mr-2 text-emerald-400" /> : <Copy className="w-4 h-4 mr-2" />}
                      {copied ? 'Copied!' : 'Copy to Clipboard'}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={handleDownload} className="flex-1">
                      <Download className="w-4 h-4 mr-2" /> Download .{format === 'netscape' ? 'txt' : 'json'}
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
                className="w-full h-48 bg-background border border-border rounded p-4 text-xs font-mono text-zinc-300 outline-none resize-none shadow-inner focus:border-primary focus:ring-1 focus:ring-primary transition"
              />
              <div className="flex gap-3">
                <input ref={fileRef} type="file" accept=".json,.txt" onChange={handleFile} className="hidden" />
                <Button size="sm" variant="secondary" onClick={() => fileRef.current && fileRef.current.click()} className="flex-1">
                  <Upload className="w-4 h-4 mr-2" /> Load file
                </Button>
                <Button size="sm" variant="primary" disabled={busy} onClick={handleImport} className="flex-1">
                  {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Import to session
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end px-5 py-4 border-t border-border bg-surface">
          <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}