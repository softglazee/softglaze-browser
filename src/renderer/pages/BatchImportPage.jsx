import React, { useState, useEffect, useRef } from 'react';
import {
  FileSpreadsheet, UploadCloud, Download, AlertTriangle,
  CheckCircle2, Server, ListPlus, Terminal, Loader2, Info, FileDown
} from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

export default function BatchImportPage() {
  const [activeTab, setActiveTab] = useState('file'); // 'file' | 'quick'
  
  // --- FILE IMPORT STATES ---
  const [previewData, setPreviewData] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [fileError, setFileError] = useState('');
  const [autoBind, setAutoBind] = useState(false);
  const [importProgress, setImportProgress] = useState(null); // { pct, index, total }
  const [importLog, setImportLog] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState('');
  const logEndRef = useRef(null);

  // Auto-scroll the terminal log to the newest line.
  useEffect(() => { logEndRef.current?.scrollIntoView({ block: 'end' }); }, [importLog]);

  // --- QUICK GENERATE STATES ---
  const [quickForm, setQuickForm] = useState({
    prefix: 'Profile',
    count: 10,
    os: 'Windows',
    browserCore: 'SunBrowser',
    browserVersion: 'Auto',
    randomFp: true,          // unique fingerprint per profile (critical)
    proxyMode: 'direct'      // 'direct' | 'pool'
  });
  const [generating, setGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState(0);
  const [generateResult, setGenerateResult] = useState(null);
  const [installedBrowsers, setInstalledBrowsers] = useState([]);
  const [savedProxies, setSavedProxies] = useState([]);

  // Load installed Chrome versions + saved proxies so Quick Generate can assign
  // real versions and round-robin a proxy pool.
  useEffect(() => {
    softglazeApi.system.listBrowsers().then((b) => setInstalledBrowsers(Array.isArray(b) ? b : [])).catch(() => {});
    softglazeApi.proxies.list({}).then((p) => setSavedProxies(Array.isArray(p) ? p : (p?.items || []))).catch(() => {});
  }, []);

  // --- FILE IMPORT LOGIC ---
  const handleSelectFile = async () => {
    setFileError('');
    setImportResult(null);
    try {
      // Calls the Electron dialog & parser backend logic
      const result = await softglazeApi.batch.previewProfilesFromSpreadsheet();
      if (result.cancelled) return;
      setPreviewData(result);
    } catch (err) {
      setFileError(err.message || 'Failed to parse the file. Ensure it is a valid spreadsheet.');
    }
  };

  const handleCommitImport = async () => {
    if (!previewData || !previewData.token) return;
    const total = previewData.items.length;
    setImporting(true);
    setFileError('');
    setImportLog([]);
    setImportProgress({ pct: 0, index: 0, total });

    // Subscribe to the backend's live progress stream (terminal log + bar).
    const levelKind = (lvl) => (lvl === 'success' ? 'ok' : lvl === 'error' ? 'error' : lvl === 'warn' ? 'warn' : 'info');
    const unsubscribe = softglazeApi.batch.onImportProgress((data) => {
      if (data.message) setImportLog((lines) => [...lines, { kind: levelKind(data.level), message: data.message }]);
      if (data.phase === 'start') setImportProgress({ pct: 0, index: 0, total: data.total });
      else if (data.phase === 'item') setImportProgress({ pct: Math.round((data.index / Math.max(1, data.total)) * 100), index: data.index, total: data.total });
      else if (data.phase === 'done') setImportProgress({ pct: 100, index: data.total, total: data.total });
    });

    try {
      const result = await softglazeApi.batch.commitProfileImport(previewData.token, { autoBindByCountry: autoBind });
      setImportResult(result);
      setPreviewData(null); // Clear preview once committed
    } catch (err) {
      setFileError(err.message || 'Failed to commit profiles to database.');
      setImportLog((lines) => [...lines, { kind: 'error', message: err.message || 'Import failed.' }]);
    } finally {
      if (typeof unsubscribe === 'function') unsubscribe();
      setImporting(false);
    }
  };

  // Export every profile (+ its mapped proxy/group/fingerprint) via a native save
  // dialog to an Excel/CSV sheet that round-trips back through the importer.
  const handleExport = async (format = 'xlsx') => {
    setExporting(true);
    setFileError('');
    setExportNotice('');
    try {
      const res = await softglazeApi.batch.exportProfilesToFile({ format });
      if (res?.cancelled) return;
      if (res?.saved) setExportNotice(`Exported ${res.count} profile${res.count === 1 ? '' : 's'} to ${res.path}`);
    } catch (err) {
      setFileError(err.message || 'Failed to export profiles.');
    } finally {
      setExporting(false);
    }
  };

  const handleDownloadTemplate = () => {
    // The full symmetrical column blueprint (same matrix the exporter produces),
    // so a downloaded template + an export are interchangeable.
    const headers = [
      'Profile Title', 'Group Name', 'Notes', 'Data Dir Name',
      'Operating System', 'Browser Core', 'User-Agent', 'Screen Resolution',
      'Proxy Method', 'Proxy Protocol', 'Proxy Info', 'Proxy Host', 'Proxy Port', 'Proxy Username', 'Proxy Password', 'Proxy Rotation URL',
      'WebRTC', 'Canvas', 'WebGL', 'WebGL Vendor', 'WebGL Renderer', 'AudioContext', 'CPU Cores', 'Memory (GB)', 'Do Not Track',
      'Timezone Mode', 'Timezone', 'Locale Mode', 'Locale', 'Geolocation Mode', 'Latitude', 'Longitude',
      'Account Username', 'Account Password', '2FA Key', 'Cookie', 'Open The Specified URL'
    ];
    const rowObjs = [
      {
        'Profile Title': 'LeadGen_01', 'Group Name': 'Lead Gen', 'Notes': 'Batch 1',
        'Operating System': 'Windows', 'Browser Core': 'Chrome', 'Screen Resolution': '1920x1080',
        'Proxy Method': 'Custom', 'Proxy Protocol': 'HTTP', 'Proxy Info': 'isp.smartproxy.net:3100:smart-user_area-US:secret1',
        'WebRTC': 'Forward', 'Canvas': 'Noise', 'WebGL': 'Noise', 'WebGL Vendor': 'Google Inc. (NVIDIA)',
        'WebGL Renderer': 'ANGLE (NVIDIA GeForce RTX 4060)', 'AudioContext': 'Noise', 'CPU Cores': '8', 'Memory (GB)': '16',
        'Do Not Track': '0', 'Timezone Mode': 'Auto', 'Locale Mode': 'Auto', 'Geolocation Mode': 'Prompt',
        'Account Username': 'user01', 'Account Password': 'pass01', 'Open The Specified URL': 'https://example.com'
      },
      {
        'Profile Title': 'LeadGen_02', 'Group Name': 'Lead Gen',
        'Operating System': 'macOS', 'Browser Core': 'Firefox', 'Screen Resolution': '1440x900',
        'Proxy Method': 'Custom', 'Proxy Protocol': 'SOCKS5', 'Proxy Info': 'isp.smartproxy.net:3120:smart-user_area-DE:secret2',
        'Proxy Rotation URL': 'https://provider.example/api/rotate?token=abc',
        'WebRTC': 'Block', 'Canvas': 'Noise', 'WebGL': 'Real', 'AudioContext': 'Real', 'CPU Cores': '4', 'Memory (GB)': '8',
        'Do Not Track': '1', 'Timezone Mode': 'Manual', 'Timezone': 'Europe/Berlin', 'Locale Mode': 'Manual', 'Locale': 'de-DE,de;q=0.9',
        'Geolocation Mode': 'Custom', 'Latitude': '52.52', 'Longitude': '13.405',
        'Account Username': 'user02', 'Account Password': 'pass02', '2FA Key': 'JBSWY3DPEHPK3PXP'
      },
      {
        'Profile Title': 'Testing_03', 'Group Name': 'Testing', 'Notes': 'No proxy (direct)',
        'Operating System': 'Windows', 'Browser Core': 'Chrome', 'Proxy Method': 'Direct'
      }
    ];
    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers, ...rowObjs.map((o) => headers.map((h) => o[h] ?? ''))]
      .map((row) => row.map(esc).join(',')).join('\r\n');
    // Prepend a UTF-8 BOM so Excel opens it with correct encoding.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'softglaze-profiles-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // --- QUICK GENERATE LOGIC ---
  const handleQuickGenerate = async (e) => {
    e.preventDefault();
    if (quickForm.count < 1 || quickForm.count > 500) {
      return alert('Please enter a valid count between 1 and 500.');
    }

    setGenerating(true);
    setGenerateProgress(0);
    setGenerateResult(null);
    let successCount = 0;
    let failCount = 0;

    // Round-robin pool assignment: cycle through saved proxies so each profile
    // gets its own IP instead of all sharing one.
    const pool = quickForm.proxyMode === 'pool' ? savedProxies : [];

    // We loop and hit the standard create endpoint.
    // (In a massive scale app, you'd write a dedicated `profiles.batchCreate` IPC handler).
    for (let i = 1; i <= quickForm.count; i++) {
      try {
        // Pad the number (e.g., 01, 02, 10)
        const paddedNum = String(i).padStart(String(quickForm.count).length, '0');
        const assignedProxy = pool.length ? pool[(i - 1) % pool.length] : null;
        await softglazeApi.profiles.create({
          title: `${quickForm.prefix}-${paddedNum}`,
          notes: 'Auto-generated via Quick Batch',
          os: quickForm.os,
          browserCore: quickForm.browserCore,
          browserVersion: quickForm.browserVersion,
          // Each profile gets its OWN freshly generated fingerprint (GPU, cores,
          // screen, canvas seed, etc.) — without this every quick profile would be
          // an identical clone, which defeats the whole purpose.
          randomFingerprint: quickForm.randomFp,
          proxyId: assignedProxy ? assignedProxy.id : null,
          systemProxyBehavior: assignedProxy ? 'PROFILE_PROXY' : 'DIRECT',
          tagManagement: 0,
          dataDirName: `${quickForm.prefix}-${paddedNum}`,
        });
        successCount++;
      } catch (err) {
        failCount++;
      }
      setGenerateProgress(Math.round((i / quickForm.count) * 100));
    }

    setGenerating(false);
    setGenerateResult({ success: successCount, failed: failCount });
  };

  return (
    <>
      <PageHeader
        eyebrow="Automation"
        title="Batch Profile Creation"
        description="Rapidly deploy multiple browser environments via spreadsheet or sequential generation."
        actions={
          <Button
            onClick={() => handleExport('xlsx')}
            disabled={exporting}
            className="bg-secondary hover:bg-secondary text-foreground border border-border"
          >
            {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileDown className="w-4 h-4 mr-2" />}
            Export Profiles
          </Button>
        }
      />

      {exportNotice && (
        <div className="mb-4 p-3 bg-emerald-900/20 border border-emerald-900/50 rounded-lg flex items-center gap-2 text-emerald-400 text-[13px]">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {exportNotice}
        </div>
      )}

      {/* TABS */}
      <div className="flex border-b border-border mb-6">
        <button
          onClick={() => setActiveTab('file')}
          className={`px-6 py-3 text-[14px] font-medium transition-all border-b-2 flex items-center gap-2 ${activeTab === 'file' ? 'border-blue-500 text-blue-400' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          <FileSpreadsheet className="w-4 h-4" /> Import from File
        </button>
        <button
          onClick={() => setActiveTab('quick')}
          className={`px-6 py-3 text-[14px] font-medium transition-all border-b-2 flex items-center gap-2 ${activeTab === 'quick' ? 'border-blue-500 text-blue-400' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          <ListPlus className="w-4 h-4" /> Quick Generate
        </button>
      </div>

      {/* --- TAB 1: IMPORT FROM SPREADSHEET --- */}
      {activeTab === 'file' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-6">
            
            {/* Step 1 */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-foreground text-[15px] flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-secondary text-xs">1</span>
                  Download Template
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <p className="text-[13px] text-muted-foreground mb-4 leading-relaxed">
                  To ensure smooth parsing, please use our standardized Excel or CSV template. Fill in your profile names, proxies, and fingerprint rules.
                </p>
                <Button onClick={handleDownloadTemplate} className="w-full bg-secondary hover:bg-secondary text-foreground border border-border">
                  <Download className="w-4 h-4 mr-2" /> Download .XLSX Template
                </Button>
              </CardContent>
            </Card>

            {/* Step 2 */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-foreground text-[15px] flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-secondary text-xs">2</span>
                  Upload & Preview
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <p className="text-[13px] text-muted-foreground mb-4">
                  Select your filled spreadsheet. We will parse it locally and check for formatting errors before saving.
                </p>
                <Button 
                  onClick={handleSelectFile} 
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white"
                >
                  <UploadCloud className="w-4 h-4 mr-2" /> Select File
                </Button>

                {fileError && (
                  <div className="mt-4 p-3 bg-red-900/20 border border-red-900/50 rounded-lg flex items-start gap-2 text-red-400 text-xs">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <p>{fileError}</p>
                  </div>
                )}
              </CardContent>
            </Card>

          </div>

          <div className="lg:col-span-2">
            <Card className="bg-card border-border h-full min-h-[400px] flex flex-col">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-foreground text-[15px] flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-secondary text-xs">3</span>
                  Preview & Commit Data
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 flex-1 flex flex-col relative">
                
                {/* STATE: Waiting for file */}
                {!previewData && !importResult && (
                  <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
                    <Server className="w-12 h-12 mb-4 text-muted-foreground" />
                    <h3 className="text-foreground font-medium mb-1">Awaiting Data</h3>
                    <p className="text-[13px]">Select a file to preview your structured profiles here.</p>
                  </div>
                )}

                {/* STATE: Previewing Data */}
                {previewData && (
                  <div className="flex flex-col h-full">
                    <div className="p-4 bg-secondary border-b border-border flex justify-between items-center text-xs">
                      <div className="text-muted-foreground">
                        File: <span className="font-medium text-foreground">{previewData.fileName}</span>
                        <span className="mx-2 text-muted-foreground">|</span>
                        Valid Rows: <span className="font-medium text-emerald-400">{previewData.items.length}</span>
                        <span className="mx-2 text-muted-foreground">|</span>
                        Errors: <span className={`font-medium ${previewData.errors.length > 0 ? 'text-red-400' : 'text-muted-foreground'}`}>{previewData.errors.length}</span>
                      </div>
                    </div>
                    
                    {importing ? (
                      /* STATE: Live processing — progress bar + scrolling terminal log */
                      <div className="flex-1 flex flex-col p-4 gap-3 min-h-0">
                        <div>
                          <div className="flex justify-between text-[12px] text-muted-foreground mb-1.5">
                            <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" /> Importing… {importProgress?.index || 0}/{importProgress?.total || 0}</span>
                            <span className="font-mono">{importProgress?.pct || 0}%</span>
                          </div>
                          <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 transition-all duration-200" style={{ width: `${importProgress?.pct || 0}%` }} />
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Terminal className="w-3.5 h-3.5" /> Backend processing log</div>
                        <div className="flex-1 min-h-[220px] bg-[#0a0d14] border border-border rounded-lg overflow-y-auto p-3 font-mono text-[11.5px] leading-relaxed">
                          {importLog.length === 0 ? (
                            <span className="text-slate-500">Connecting to the import engine…</span>
                          ) : importLog.map((line, i) => (
                            <div key={i} className={line.kind === 'error' ? 'text-red-400' : line.kind === 'warn' ? 'text-amber-400' : line.kind === 'ok' ? 'text-emerald-400' : 'text-blue-300'}>
                              <span className="text-slate-600 select-none">{'$ '}</span>{line.message}
                            </div>
                          ))}
                          <div ref={logEndRef} />
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 overflow-x-auto">
                          <table className="w-full text-left text-[12px] min-w-[600px]">
                            <thead className="bg-secondary text-muted-foreground sticky top-0 shadow-sm border-b border-border">
                              <tr>
                                <th className="px-4 py-2 font-medium">Row</th>
                                <th className="px-4 py-2 font-medium">Title</th>
                                <th className="px-4 py-2 font-medium">Group</th>
                                <th className="px-4 py-2 font-medium">Proxy Method</th>
                                <th className="px-4 py-2 font-medium">Data Dir</th>
                              </tr>
                            </thead>
                            <tbody>
                              {previewData.items.map((item, i) => (
                                <tr key={i} className="border-b border-border hover:bg-secondary">
                                  <td className="px-4 py-2 text-muted-foreground">{item.row}</td>
                                  <td className="px-4 py-2 text-foreground font-medium">{item.title}</td>
                                  <td className="px-4 py-2 text-muted-foreground">{item.group || '—'}</td>
                                  <td className="px-4 py-2 text-muted-foreground">{item.proxyMethod}</td>
                                  <td className="px-4 py-2 text-muted-foreground">{item.dataDirName || 'Auto'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div className="p-4 border-t border-border bg-card space-y-3">
                          <label className="flex items-start gap-2.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={autoBind}
                              onChange={(e) => setAutoBind(e.target.checked)}
                              className="h-4 w-4 mt-0.5 cursor-pointer accent-emerald-500"
                            />
                            <span className="text-[12px] text-muted-foreground leading-relaxed">
                              <strong className="text-muted-foreground">Auto-bind proxies by country</strong> — for rows without their own proxy, assign a saved proxy whose health-checked country matches the row's <code className="text-emerald-400">Country</code> column (round-robin across matches).
                            </span>
                          </label>
                          <Button
                            onClick={handleCommitImport}
                            disabled={importing}
                            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
                          >
                            <CheckCircle2 className="w-4 h-4 mr-2" /> Commit {previewData.items.length} Profiles
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* STATE: Success Result */}
                {importResult && (
                  <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                    <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mb-4">
                      <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                    </div>
                    <h3 className="text-foreground text-lg font-medium mb-2">Import Successful</h3>
                    <p className="text-[13px] text-muted-foreground max-w-md mx-auto mb-6">
                      Successfully imported <strong className="text-foreground">{importResult.createdProfiles.length}</strong> profiles
                      and mapped <strong className="text-foreground">{importResult.createdProxies.length}</strong> new proxies
                      {importResult.autoBound?.length ? <> · auto-bound <strong className="text-foreground">{importResult.autoBound.length}</strong> by country</> : null}.
                    </p>
                    <div className="flex gap-3">
                      <Button onClick={() => setImportResult(null)} variant="outline" className="bg-secondary border-border text-foreground">Import Another</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* --- TAB 2: QUICK GENERATE --- */}
      {activeTab === 'quick' && (
        <Card className="bg-card border-border max-w-3xl">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-foreground text-[15px] flex items-center gap-2">
              <Terminal className="w-4 h-4 text-blue-400" /> Sequential Generation Engine
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            
            <div className="bg-secondary border border-border p-4 rounded-lg flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-[12px] text-muted-foreground leading-relaxed">
                Quick generate allows you to spin up multiple profiles instantly without a spreadsheet. The system will automatically append a sequential number (e.g. 01, 02) to your prefix and assign entirely unique User-Agents mathematically mapped to your selected OS.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-muted-foreground text-[13px] font-medium block">Profile Name Prefix</label>
                <input 
                  type="text" 
                  value={quickForm.prefix}
                  onChange={(e) => setQuickForm({ ...quickForm, prefix: e.target.value })}
                  placeholder="e.g. FB-Farming"
                  disabled={generating}
                  className="w-full bg-secondary border border-border rounded px-3 py-2 text-foreground outline-none focus:border-blue-500 transition disabled:opacity-50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-muted-foreground text-[13px] font-medium block">Number of Profiles to Create</label>
                <input 
                  type="number" 
                  min="1" 
                  max="500"
                  value={quickForm.count}
                  onChange={(e) => setQuickForm({ ...quickForm, count: Number(e.target.value) })}
                  disabled={generating}
                  className="w-full bg-secondary border border-border rounded px-3 py-2 text-foreground outline-none focus:border-blue-500 transition disabled:opacity-50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-muted-foreground text-[13px] font-medium block">Target OS Array</label>
                <select 
                  value={quickForm.os}
                  onChange={(e) => setQuickForm({ ...quickForm, os: e.target.value })}
                  disabled={generating}
                  className="w-full bg-secondary border border-border rounded px-3 py-2 text-foreground outline-none focus:border-blue-500 disabled:opacity-50"
                >
                  <option value="Windows">Windows (All)</option>
                  <option value="macOS">macOS (All)</option>
                  <option value="Linux">Linux (All)</option>
                  <option value="Android">Android Mobile</option>
                  <option value="iOS">iOS Mobile</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-muted-foreground text-[13px] font-medium block">Browser Kernel</label>
                <select 
                  value={quickForm.browserCore}
                  onChange={(e) => setQuickForm({ ...quickForm, browserCore: e.target.value })}
                  disabled={generating}
                  className="w-full bg-secondary border border-border rounded px-3 py-2 text-foreground outline-none focus:border-blue-500 disabled:opacity-50"
                >
                  <option value="SunBrowser">SunBrowser (Chrome-based)</option>
                  <option value="FlowerBrowser">FlowerBrowser (Firefox-based)</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-muted-foreground text-[13px] font-medium block">Browser Version</label>
                <select
                  value={quickForm.browserVersion}
                  onChange={(e) => setQuickForm({ ...quickForm, browserVersion: e.target.value })}
                  disabled={generating}
                  className="w-full bg-secondary border border-border rounded px-3 py-2 text-foreground outline-none focus:border-blue-500 disabled:opacity-50"
                >
                  <option value="Auto">Auto (newest installed)</option>
                  {installedBrowsers.map((b) => (
                    <option key={b.version || b.major} value={String(b.major)}>{`Chrome ${b.major}${b.version ? ` (${b.version})` : ''}`}</option>
                  ))}
                </select>
                {installedBrowsers.length === 0 && (
                  <p className="text-[11px] text-amber-400/80">No installed browsers detected in /chrome — profiles will use the bundled engine.</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-muted-foreground text-[13px] font-medium block">Proxy Assignment</label>
                <select
                  value={quickForm.proxyMode}
                  onChange={(e) => setQuickForm({ ...quickForm, proxyMode: e.target.value })}
                  disabled={generating}
                  className="w-full bg-secondary border border-border rounded px-3 py-2 text-foreground outline-none focus:border-blue-500 disabled:opacity-50"
                >
                  <option value="direct">Direct — no proxy</option>
                  <option value="pool">Round-robin from saved proxies ({savedProxies.length})</option>
                </select>
                {quickForm.proxyMode === 'pool' && savedProxies.length === 0 && (
                  <p className="text-[11px] text-amber-400/80">No saved proxies — add some in Proxy Pool first, or profiles will be created direct.</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-muted-foreground text-[13px] font-medium block">Fingerprint</label>
                <label className="flex items-center gap-2.5 cursor-pointer select-none bg-secondary border border-border rounded px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={quickForm.randomFp}
                    onChange={(e) => setQuickForm({ ...quickForm, randomFp: e.target.checked })}
                    disabled={generating}
                    className="h-4 w-4 cursor-pointer accent-blue-500"
                  />
                  <span className="text-[12px] text-muted-foreground">Unique randomized fingerprint per profile</span>
                </label>
              </div>
            </div>

            {/* Preview Hint */}
            <div className="p-3 bg-secondary rounded border border-border text-[12px] font-mono text-muted-foreground">
              Example Outputs: <span className="text-blue-400">{quickForm.prefix}-01</span>, <span className="text-blue-400">{quickForm.prefix}-02</span> ...
            </div>

            {generating && (
              <div className="space-y-2 pt-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Generating Profiles...</span>
                  <span>{generateProgress}%</span>
                </div>
                <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 transition-all duration-200" style={{ width: `${generateProgress}%` }}></div>
                </div>
              </div>
            )}

            {generateResult && (
              <div className="p-4 bg-emerald-900/20 border border-emerald-900/50 rounded-lg text-emerald-400 text-[13px] flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Successfully created <strong>{generateResult.success}</strong> profiles. {generateResult.failed > 0 && `(${generateResult.failed} failed).`}
              </div>
            )}

            <Button 
              onClick={handleQuickGenerate} 
              disabled={generating || quickForm.count < 1}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white mt-4"
            >
              {generating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing...</> : `Generate ${quickForm.count} Profiles`}
            </Button>

          </CardContent>
        </Card>
      )}

    </>
  );
}