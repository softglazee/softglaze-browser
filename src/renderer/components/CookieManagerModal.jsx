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
      className={`px-3 py-1.5 text-[13px] rounded-md transition ${tab === key ? 'bg-blue-600 text-white' : 'text-[#9ca3af] hover:text-white hover:bg-[#2a2d35]'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[88vh] overflow-hidden flex flex-col rounded-xl border border-[#2d3039] bg-[#1e2025] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2d3039]">
          <div className="flex items-center gap-2.5">
            <Cookie className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-white font-medium text-[15px] leading-tight">Cookies</h2>
              <p className="text-[12px] text-[#9ca3af] leading-tight">{profileName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded hover:bg-[#2a2d35] transition"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-b border-[#2d3039]">
          <div className="flex gap-1">{tabBtn('export', 'Export')}{tabBtn('import', 'Import')}</div>
          <div className="flex items-center gap-1 bg-[#181a1f] border border-[#3b3e48] rounded-md p-0.5">
            <button onClick={() => setFormat('json')} className={`px-2.5 py-1 text-[12px] rounded ${format === 'json' ? 'bg-[#2a2d35] text-white' : 'text-[#9ca3af]'}`}>JSON</button>
            <button onClick={() => setFormat('netscape')} className={`px-2.5 py-1 text-[12px] rounded ${format === 'netscape' ? 'bg-[#2a2d35] text-white' : 'text-[#9ca3af]'}`}>Netscape</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <p className="text-[12px] text-[#9ca3af]">The profile must be running — cookies are read from and written to its live browser session.</p>

          {error && <div className="rounded-lg border border-red-900/70 bg-red-950/40 px-3 py-2 text-[13px] text-red-200">{error}</div>}
          {info && <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-[13px] text-emerald-300">{info}</div>}

          {tab === 'export' ? (
            <>
              <Button size="sm" disabled={busy} onClick={handleExport} className="bg-blue-600 hover:bg-blue-500 text-white">
                {busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
                Export from session
              </Button>
              {exportContent && (
                <>
                  <textarea
                    readOnly
                    value={exportContent}
                    className="w-full h-48 bg-[#181a1f] border border-[#3b3e48] rounded-md p-3 text-[11px] font-mono text-[#d1d5db] outline-none resize-none"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={handleCopy} className="bg-[#181a1f] border-[#3b3e48] text-white">
                      {copied ? <Check className="w-3.5 h-3.5 mr-1.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}{copied ? 'Copied' : 'Copy'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleDownload} className="bg-[#181a1f] border-[#3b3e48] text-white">
                      <Download className="w-3.5 h-3.5 mr-1.5" /> Download .{format === 'netscape' ? 'txt' : 'json'}
                    </Button>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={format === 'netscape' ? '# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tTRUE\t1767225600\tsid\tabc123' : '[{ "name": "sid", "value": "abc123", "domain": ".example.com", "path": "/", "secure": true }]'}
                className="w-full h-44 bg-[#181a1f] border border-[#3b3e48] rounded-md p-3 text-[11px] font-mono text-[#d1d5db] outline-none resize-none focus:border-blue-500"
              />
              <div className="flex gap-2">
                <input ref={fileRef} type="file" accept=".json,.txt" onChange={handleFile} className="hidden" />
                <Button size="sm" variant="outline" onClick={() => fileRef.current && fileRef.current.click()} className="bg-[#181a1f] border-[#3b3e48] text-white">
                  <Upload className="w-3.5 h-3.5 mr-1.5" /> Load file
                </Button>
                <Button size="sm" disabled={busy} onClick={handleImport} className="bg-blue-600 hover:bg-blue-500 text-white">
                  {busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                  Import into session
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end px-5 py-4 border-t border-[#2d3039]">
          <Button size="sm" onClick={onClose} className="bg-[#2a2d35] hover:bg-[#3b3e48] text-white border border-[#3b3e48]">Close</Button>
        </div>
      </div>
    </div>
  );
}