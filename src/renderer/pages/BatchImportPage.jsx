import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileSpreadsheet, UploadCloud, Download, AlertTriangle,
  CheckCircle2, Server, ListPlus, Terminal, Loader2, Info, FileDown, Wand2
} from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card.jsx';
import QuickGenerateModal from '@/components/QuickGenerateModal.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { quickGenProxyFields } from '@/lib/freeProxies.mjs';

// OS choices for the shared Quick Generate modal (expects [{ id }]).
const QUICK_OS_PLATFORMS = [{ id: 'Windows' }, { id: 'macOS' }, { id: 'Linux' }, { id: 'Android' }, { id: 'iOS' }];

export default function BatchImportPage() {
  const { t } = useTranslation('batchImport');
  const [activeTab, setActiveTab] = useState('file'); // 'file' | 'quick'

  // File import
  const [previewData, setPreviewData] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [fileError, setFileError] = useState('');
  const [autoBind, setAutoBind] = useState(false);
  const [autoBindSource, setAutoBindSource] = useState('paid'); // 'paid' | 'free' (working free proxies)
  const [importProgress, setImportProgress] = useState(null); // { pct, index, total }
  const [importLog, setImportLog] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState('');
  const logEndRef = useRef(null);

  // Auto-scroll the terminal log to the newest line.
  useEffect(() => { logEndRef.current?.scrollIntoView({ block: 'end' }); }, [importLog]);

  // Quick Generate uses the shared modal, identical to the Profiles page.
  const [showQuickGen, setShowQuickGen] = useState(false);
  const [savedProxies, setSavedProxies] = useState([]);
  const [freeProxies, setFreeProxies] = useState([]);
  const [groups, setGroups] = useState([]);
  const [proxyGroups, setProxyGroups] = useState([]);

  // Quick Generate needs proxies (unique assignment), profile groups (target or create inline)
  // and proxy groups / providers as a source.
  const loadGenData = () => {
    softglazeApi.proxies.list({ scope: 'paid' }).then((p) => setSavedProxies(Array.isArray(p) ? p : (p?.items || []))).catch(() => {});
    softglazeApi.proxies.list({ scope: 'free' }).then((p) => setFreeProxies(Array.isArray(p) ? p : [])).catch(() => {});
    softglazeApi.groups.list().then((g) => setGroups(Array.isArray(g) ? g : [])).catch(() => {});
    softglazeApi.proxyGroups.list().then((pg) => setProxyGroups(Array.isArray(pg) ? pg : [])).catch(() => {});
  };
  useEffect(() => { loadGenData(); }, []);

  const handleSelectFile = async () => {
    setFileError('');
    setImportResult(null);
    try {
      const result = await softglazeApi.batch.previewProfilesFromSpreadsheet();
      if (result.cancelled) return;
      setPreviewData(result);
    } catch (err) {
      setFileError(err.message || t('errors.parse'));
    }
  };

  const handleCommitImport = async () => {
    if (!previewData || !previewData.token) return;
    const total = previewData.items.length;
    setImporting(true);
    setFileError('');
    setImportLog([]);
    setImportProgress({ pct: 0, index: 0, total });

    const levelKind = (lvl) => (lvl === 'success' ? 'ok' : lvl === 'error' ? 'error' : lvl === 'warn' ? 'warn' : 'info');
    const unsubscribe = softglazeApi.batch.onImportProgress((data) => {
      if (data.message) setImportLog((lines) => [...lines, { kind: levelKind(data.level), message: data.message }]);
      if (data.phase === 'start') setImportProgress({ pct: 0, index: 0, total: data.total });
      else if (data.phase === 'item') setImportProgress({ pct: Math.round((data.index / Math.max(1, data.total)) * 100), index: data.index, total: data.total });
      else if (data.phase === 'done') setImportProgress({ pct: 100, index: data.total, total: data.total });
    });

    try {
      const result = await softglazeApi.batch.commitProfileImport(previewData.token, { autoBindByCountry: autoBind, autoBindSource });
      setImportResult(result);
      setPreviewData(null);
    } catch (err) {
      setFileError(err.message || t('errors.commit'));
      setImportLog((lines) => [...lines, { kind: 'error', message: err.message || t('errors.importFailed') }]);
    } finally {
      if (typeof unsubscribe === 'function') unsubscribe();
      setImporting(false);
    }
  };

  // Exports every profile with its proxy, group and fingerprint; the sheet round-trips via the importer.
  const handleExport = async (format = 'xlsx') => {
    setExporting(true);
    setFileError('');
    setExportNotice('');
    try {
      const res = await softglazeApi.batch.exportProfilesToFile({ format });
      if (res?.cancelled) return;
      if (res?.saved) setExportNotice(t('exportNotice', { count: res.count, path: res.path }));
    } catch (err) {
      setFileError(err.message || t('errors.export'));
    } finally {
      setExporting(false);
    }
  };

  const handleDownloadTemplate = () => {
    // Same columns as the exporter, so a template and an export are interchangeable.
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
        'Proxy Method': 'Custom', 'Proxy Protocol': 'HTTP', 'Proxy Info': 'proxy.example.com:3100:proxy-user:secret1',
        'WebRTC': 'Forward', 'Canvas': 'Noise', 'WebGL': 'Noise', 'WebGL Vendor': 'Google Inc. (NVIDIA)',
        'WebGL Renderer': 'ANGLE (NVIDIA GeForce RTX 4060)', 'AudioContext': 'Noise', 'CPU Cores': '8', 'Memory (GB)': '16',
        'Do Not Track': '0', 'Timezone Mode': 'Auto', 'Locale Mode': 'Auto', 'Geolocation Mode': 'Prompt',
        'Account Username': 'user01', 'Account Password': 'pass01', 'Open The Specified URL': 'https://example.com'
      },
      {
        'Profile Title': 'LeadGen_02', 'Group Name': 'Lead Gen',
        'Operating System': 'macOS', 'Browser Core': 'Firefox', 'Screen Resolution': '1440x900',
        'Proxy Method': 'Custom', 'Proxy Protocol': 'SOCKS5', 'Proxy Info': 'proxy.example.com:3120:proxy-user:secret2',
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

  // Same contract as the Profiles page: proxySource ('group:<id>' | 'provider:<key>' | 'free') maps
  // to proxyGroupId/provider or the free source so only that selection is assigned.
  const handleQuickGenerate = async (config, onProgress) => {
    const { count, baseName, startIndex, groupId, newGroupName, os, randomize, proxyMode, pasted, startupUrls, proxySource, proxySpeed, proxyBlacklist } = config;
    if (onProgress) onProgress(0, count);
    const { proxySource: source, proxyGroupId, provider } = quickGenProxyFields(proxySource);
    const result = await softglazeApi.profiles.batchGenerate({
      count,
      prefix: baseName,
      startIndex,
      os,
      deviceClass: /android|ios|mobile/i.test(String(os)) ? 'mobile' : 'desktop',
      randomFingerprint: randomize,
      distributeVersions: randomize,
      startupUrls,
      groupId: groupId && groupId !== 'ungrouped' ? groupId : null,
      newGroupName: newGroupName || null,
      proxyMode,
      proxySource: source, // 'paid' | 'free'
      proxyGroupId,
      provider,
      proxySpeed, // same pre-filters as the Profiles page
      proxyBlacklist,
      proxyList: pasted
    });
    if (onProgress) onProgress(result?.createdCount ?? count, count);
    loadGenData();
    return result;
  };

  return (
    <>
      <PageHeader
        eyebrow={t('header.eyebrow')}
        title={t('header.title')}
        description={t('header.description')}
        actions={
          <Button
            onClick={() => handleExport('xlsx')}
            disabled={exporting}
            className="bg-secondary hover:bg-secondary text-foreground border border-border"
          >
            {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileDown className="w-4 h-4 mr-2" />}
            {t('header.exportProfiles')}
          </Button>
        }
      />

      {exportNotice && (
        <div className="mb-4 p-3 bg-emerald-900/20 border border-emerald-900/50 rounded-lg flex items-center gap-2 text-emerald-400 text-[13px]">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {exportNotice}
        </div>
      )}

      <div className="flex border-b border-border mb-6">
        <button
          onClick={() => setActiveTab('file')}
          className={`px-6 py-3 text-[14px] font-medium transition-all border-b-2 flex items-center gap-2 ${activeTab === 'file' ? 'border-blue-500 text-blue-400' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          <FileSpreadsheet className="w-4 h-4" /> {t('tabs.importFromFile')}
        </button>
        <button
          onClick={() => setActiveTab('quick')}
          className={`px-6 py-3 text-[14px] font-medium transition-all border-b-2 flex items-center gap-2 ${activeTab === 'quick' ? 'border-blue-500 text-blue-400' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          <ListPlus className="w-4 h-4" /> {t('tabs.quickGenerate')}
        </button>
      </div>

      {activeTab === 'file' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-6">

            <Card className="bg-card border-border">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-foreground text-[15px] flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-secondary text-xs">1</span>
                  {t('step1.title')}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <p className="text-[13px] text-muted-foreground mb-4 leading-relaxed">
                  {t('step1.description')}
                </p>
                <Button onClick={handleDownloadTemplate} className="w-full bg-secondary hover:bg-secondary text-foreground border border-border">
                  <Download className="w-4 h-4 mr-2" /> {t('step1.downloadButton')}
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-foreground text-[15px] flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-secondary text-xs">2</span>
                  {t('step2.title')}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <p className="text-[13px] text-muted-foreground mb-4">
                  {t('step2.description')}
                </p>
                <Button
                  onClick={handleSelectFile}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white"
                >
                  <UploadCloud className="w-4 h-4 mr-2" /> {t('step2.selectButton')}
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
                  {t('step3.title')}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 flex-1 flex flex-col relative">

                {!previewData && !importResult && (
                  <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
                    <Server className="w-12 h-12 mb-4 text-muted-foreground" />
                    <h3 className="text-foreground font-medium mb-1">{t('awaiting.title')}</h3>
                    <p className="text-[13px]">{t('awaiting.description')}</p>
                  </div>
                )}

                {previewData && (
                  <div className="flex flex-col h-full">
                    <div className="p-4 bg-secondary border-b border-border flex justify-between items-center text-xs">
                      <div className="text-muted-foreground">
                        {t('preview.file')} <span className="font-medium text-foreground">{previewData.fileName}</span>
                        <span className="mx-2 text-muted-foreground">|</span>
                        {t('preview.validRows')} <span className="font-medium text-emerald-400">{previewData.items.length}</span>
                        <span className="mx-2 text-muted-foreground">|</span>
                        {t('preview.errors')} <span className={`font-medium ${previewData.errors.length > 0 ? 'text-red-400' : 'text-muted-foreground'}`}>{previewData.errors.length}</span>
                      </div>
                    </div>

                    {importing ? (
                      <div className="flex-1 flex flex-col p-4 gap-3 min-h-0">
                        <div>
                          <div className="flex justify-between text-[12px] text-muted-foreground mb-1.5">
                            <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" /> {t('processing.importing', { index: importProgress?.index || 0, total: importProgress?.total || 0 })}</span>
                            <span className="font-mono">{importProgress?.pct || 0}%</span>
                          </div>
                          <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 transition-all duration-200" style={{ width: `${importProgress?.pct || 0}%` }} />
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Terminal className="w-3.5 h-3.5" /> {t('processing.backendLog')}</div>
                        <div className="flex-1 min-h-[220px] bg-[#0a0d14] border border-border rounded-lg overflow-y-auto p-3 font-mono text-[11.5px] leading-relaxed">
                          {importLog.length === 0 ? (
                            <span className="text-slate-500">{t('processing.connecting')}</span>
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
                                <th className="px-4 py-2 font-medium">{t('table.row')}</th>
                                <th className="px-4 py-2 font-medium">{t('table.title')}</th>
                                <th className="px-4 py-2 font-medium">{t('table.group')}</th>
                                <th className="px-4 py-2 font-medium">{t('table.proxyMethod')}</th>
                                <th className="px-4 py-2 font-medium">{t('table.dataDir')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {previewData.items.map((item, i) => (
                                <tr key={i} className="border-b border-border hover:bg-secondary">
                                  <td className="px-4 py-2 text-muted-foreground">{item.row}</td>
                                  <td className="px-4 py-2 text-foreground font-medium">{item.title}</td>
                                  <td className="px-4 py-2 text-muted-foreground">{item.group || '-'}</td>
                                  <td className="px-4 py-2 text-muted-foreground">{item.proxyMethod}</td>
                                  <td className="px-4 py-2 text-muted-foreground">{item.dataDirName || t('table.auto')}</td>
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
                              <strong className="text-muted-foreground">{t('autoBind.label')}</strong> {t('autoBind.descPrefix')} <code className="text-emerald-400">Country</code> {t('autoBind.descSuffix')}
                            </span>
                          </label>
                          {autoBind && (
                            <div className="flex flex-wrap items-center gap-2 pl-6 text-[12px] text-muted-foreground">
                              <label htmlFor="auto-bind-source">{t('autoBind.sourceLabel')}</label>
                              <select id="auto-bind-source" value={autoBindSource} onChange={(e) => setAutoBindSource(e.target.value)} className="h-8 rounded border border-border bg-card px-2 text-[12px] text-foreground focus:border-primary focus:outline-none">
                                <option value="paid">{t('autoBind.sourcePaid')}</option>
                                <option value="free">{t('autoBind.sourceFree')}</option>
                              </select>
                              {autoBindSource === 'free' && (
                                <p role="note" className="flex w-full items-start gap-1.5 text-warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('autoBind.freeWarn')}</p>
                              )}
                            </div>
                          )}
                          <Button
                            onClick={handleCommitImport}
                            disabled={importing}
                            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
                          >
                            <CheckCircle2 className="w-4 h-4 mr-2" /> {t('commitButton', { count: previewData.items.length })}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {importResult && (
                  <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                    <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mb-4">
                      <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                    </div>
                    <h3 className="text-foreground text-lg font-medium mb-2">{t('success.title')}</h3>
                    <p className="text-[13px] text-muted-foreground max-w-md mx-auto mb-6">
                      {t('success.importedPrefix')} <strong className="text-foreground">{importResult.createdProfiles.length}</strong> {t('success.importedMiddle')}
                      {' '}<strong className="text-foreground">{importResult.createdProxies.length}</strong> {t('success.importedSuffix')}
                      {importResult.autoBound?.length ? <>{t('success.autoBoundPrefix')} <strong className="text-foreground">{importResult.autoBound.length}</strong> {t('success.autoBoundSuffix')}</> : null}.
                    </p>
                    <div className="flex gap-3">
                      <Button onClick={() => setImportResult(null)} variant="outline" className="bg-secondary border-border text-foreground">{t('success.importAnother')}</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'quick' && (
        <Card className="bg-card border-border max-w-3xl">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-foreground text-[15px] flex items-center gap-2">
              <Terminal className="w-4 h-4 text-blue-400" /> {t('quick.engineTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div className="bg-secondary border border-border p-4 rounded-lg flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-[12px] text-muted-foreground leading-relaxed">
                {t('quick.description')}
              </p>
            </div>
            <Button onClick={() => setShowQuickGen(true)} className="bg-blue-600 hover:bg-blue-500 text-white">
              <Wand2 className="w-4 h-4 mr-2" /> {t('quick.openButton')}
            </Button>
          </CardContent>
        </Card>
      )}

      {showQuickGen && (
        <QuickGenerateModal
          osPlatforms={QUICK_OS_PLATFORMS}
          groups={groups}
          proxies={savedProxies}
          freeProxies={freeProxies}
          proxyGroups={proxyGroups}
          onClose={() => setShowQuickGen(false)}
          onGenerate={handleQuickGenerate}
          onCreateGroup={async (name) => {
            const g = await softglazeApi.groups.create({ name });
            const list = await softglazeApi.groups.list().catch(() => null);
            if (Array.isArray(list)) setGroups(list);
            return g;
          }}
        />
      )}

    </>
  );
}
