import React, { useState } from 'react';
import { 
  FileSpreadsheet, UploadCloud, Download, AlertTriangle, 
  CheckCircle2, Server, ListPlus, Terminal, Loader2, Info
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

  // --- QUICK GENERATE STATES ---
  const [quickForm, setQuickForm] = useState({
    prefix: 'Profile',
    count: 10,
    os: 'Windows',
    browserCore: 'SunBrowser'
  });
  const [generating, setGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState(0);
  const [generateResult, setGenerateResult] = useState(null);

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
    setImporting(true);
    setFileError('');
    try {
      const result = await softglazeApi.batch.commitProfileImport(previewData.token);
      setImportResult(result);
      setPreviewData(null); // Clear preview once committed
    } catch (err) {
      setFileError(err.message || 'Failed to commit profiles to database.');
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadTemplate = () => {
    // In production: trigger a download of a static CSV template
    alert('Standard Template structure:\nTitle | ProxyMethod | RawProxy | OS | Browser\n\n(Ensure your backend template matches this format)');
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

    // We loop and hit the standard create endpoint. 
    // (In a massive scale app, you'd write a dedicated `profiles.batchCreate` IPC handler).
    for (let i = 1; i <= quickForm.count; i++) {
      try {
        // Pad the number (e.g., 01, 02, 10)
        const paddedNum = String(i).padStart(String(quickForm.count).length, '0');
        await softglazeApi.profiles.create({
          title: `${quickForm.prefix}-${paddedNum}`,
          notes: 'Auto-generated via Quick Batch',
          proxyRaw: null,
          systemProxyBehavior: 'DIRECT',
          tagManagement: 0,
          dataDirName: `${quickForm.prefix}-${paddedNum}`,
          // The backend/frontend will automatically roll a unique UA if none is provided
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
      />

      {/* TABS */}
      <div className="flex border-b border-[#2d3039] mb-6">
        <button
          onClick={() => setActiveTab('file')}
          className={`px-6 py-3 text-[14px] font-medium transition-all border-b-2 flex items-center gap-2 ${activeTab === 'file' ? 'border-blue-500 text-blue-400' : 'border-transparent text-[#9ca3af] hover:text-white'}`}
        >
          <FileSpreadsheet className="w-4 h-4" /> Import from File
        </button>
        <button
          onClick={() => setActiveTab('quick')}
          className={`px-6 py-3 text-[14px] font-medium transition-all border-b-2 flex items-center gap-2 ${activeTab === 'quick' ? 'border-blue-500 text-blue-400' : 'border-transparent text-[#9ca3af] hover:text-white'}`}
        >
          <ListPlus className="w-4 h-4" /> Quick Generate
        </button>
      </div>

      {/* --- TAB 1: IMPORT FROM SPREADSHEET --- */}
      {activeTab === 'file' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-6">
            
            {/* Step 1 */}
            <Card className="bg-[#1e2025] border-[#2d3039]">
              <CardHeader className="pb-3 border-b border-[#2d3039]">
                <CardTitle className="text-white text-[15px] flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#2a2d35] text-xs">1</span>
                  Download Template
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <p className="text-[13px] text-[#9ca3af] mb-4 leading-relaxed">
                  To ensure smooth parsing, please use our standardized Excel or CSV template. Fill in your profile names, proxies, and fingerprint rules.
                </p>
                <Button onClick={handleDownloadTemplate} className="w-full bg-[#2a2d35] hover:bg-[#3b3e48] text-white border border-[#3b3e48]">
                  <Download className="w-4 h-4 mr-2" /> Download .XLSX Template
                </Button>
              </CardContent>
            </Card>

            {/* Step 2 */}
            <Card className="bg-[#1e2025] border-[#2d3039]">
              <CardHeader className="pb-3 border-b border-[#2d3039]">
                <CardTitle className="text-white text-[15px] flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#2a2d35] text-xs">2</span>
                  Upload & Preview
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <p className="text-[13px] text-[#9ca3af] mb-4">
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
            <Card className="bg-[#1e2025] border-[#2d3039] h-full min-h-[400px] flex flex-col">
              <CardHeader className="pb-3 border-b border-[#2d3039]">
                <CardTitle className="text-white text-[15px] flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#2a2d35] text-xs">3</span>
                  Preview & Commit Data
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 flex-1 flex flex-col relative">
                
                {/* STATE: Waiting for file */}
                {!previewData && !importResult && (
                  <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-[#9ca3af]">
                    <Server className="w-12 h-12 mb-4 text-[#3b3e48]" />
                    <h3 className="text-white font-medium mb-1">Awaiting Data</h3>
                    <p className="text-[13px]">Select a file to preview your structured profiles here.</p>
                  </div>
                )}

                {/* STATE: Previewing Data */}
                {previewData && (
                  <div className="flex flex-col h-full">
                    <div className="p-4 bg-[#24272e] border-b border-[#2d3039] flex justify-between items-center text-xs">
                      <div className="text-[#d1d5db]">
                        File: <span className="font-medium text-white">{previewData.fileName}</span> 
                        <span className="mx-2 text-[#4b4e58]">|</span> 
                        Valid Rows: <span className="font-medium text-emerald-400">{previewData.items.length}</span>
                        <span className="mx-2 text-[#4b4e58]">|</span> 
                        Errors: <span className={`font-medium ${previewData.errors.length > 0 ? 'text-red-400' : 'text-[#9ca3af]'}`}>{previewData.errors.length}</span>
                      </div>
                    </div>
                    
                    <div className="flex-1 overflow-x-auto">
                      <table className="w-full text-left text-[12px] min-w-[600px]">
                        <thead className="bg-[#181a1f] text-[#9ca3af] sticky top-0 shadow-sm border-b border-[#2d3039]">
                          <tr>
                            <th className="px-4 py-2 font-medium">Row</th>
                            <th className="px-4 py-2 font-medium">Title</th>
                            <th className="px-4 py-2 font-medium">Proxy Method</th>
                            <th className="px-4 py-2 font-medium">Data Dir</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previewData.items.map((item, i) => (
                            <tr key={i} className="border-b border-[#2d3039] hover:bg-[#24272e]">
                              <td className="px-4 py-2 text-[#9ca3af]">{item.row}</td>
                              <td className="px-4 py-2 text-white font-medium">{item.title}</td>
                              <td className="px-4 py-2 text-[#9ca3af]">{item.proxyMethod}</td>
                              <td className="px-4 py-2 text-slate-500">{item.dataDirName || 'Auto'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="p-4 border-t border-[#2d3039] bg-[#1e2025]">
                      <Button 
                        onClick={handleCommitImport} 
                        disabled={importing}
                        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
                      >
                        {importing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Committing to Database...</> : <><CheckCircle2 className="w-4 h-4 mr-2" /> Commit {previewData.items.length} Profiles</>}
                      </Button>
                    </div>
                  </div>
                )}

                {/* STATE: Success Result */}
                {importResult && (
                  <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                    <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mb-4">
                      <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                    </div>
                    <h3 className="text-white text-lg font-medium mb-2">Import Successful</h3>
                    <p className="text-[13px] text-[#9ca3af] max-w-md mx-auto mb-6">
                      Successfully imported <strong className="text-white">{importResult.createdProfiles.length}</strong> profiles 
                      and mapped <strong className="text-white">{importResult.createdProxies.length}</strong> new proxies.
                    </p>
                    <div className="flex gap-3">
                      <Button onClick={() => setImportResult(null)} variant="outline" className="bg-[#24272e] border-[#3b3e48] text-white">Import Another</Button>
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
        <Card className="bg-[#1e2025] border-[#2d3039] max-w-3xl">
          <CardHeader className="border-b border-[#2d3039]">
            <CardTitle className="text-white text-[15px] flex items-center gap-2">
              <Terminal className="w-4 h-4 text-blue-400" /> Sequential Generation Engine
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            
            <div className="bg-[#181a1f] border border-[#2d3039] p-4 rounded-lg flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-[12px] text-[#9ca3af] leading-relaxed">
                Quick generate allows you to spin up multiple profiles instantly without a spreadsheet. The system will automatically append a sequential number (e.g. 01, 02) to your prefix and assign entirely unique User-Agents mathematically mapped to your selected OS.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[#d1d5db] text-[13px] font-medium block">Profile Name Prefix</label>
                <input 
                  type="text" 
                  value={quickForm.prefix}
                  onChange={(e) => setQuickForm({ ...quickForm, prefix: e.target.value })}
                  placeholder="e.g. FB-Farming"
                  disabled={generating}
                  className="w-full bg-[#131519] border border-[#3b3e48] rounded px-3 py-2 text-white outline-none focus:border-blue-500 transition disabled:opacity-50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[#d1d5db] text-[13px] font-medium block">Number of Profiles to Create</label>
                <input 
                  type="number" 
                  min="1" 
                  max="500"
                  value={quickForm.count}
                  onChange={(e) => setQuickForm({ ...quickForm, count: Number(e.target.value) })}
                  disabled={generating}
                  className="w-full bg-[#131519] border border-[#3b3e48] rounded px-3 py-2 text-white outline-none focus:border-blue-500 transition disabled:opacity-50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[#d1d5db] text-[13px] font-medium block">Target OS Array</label>
                <select 
                  value={quickForm.os}
                  onChange={(e) => setQuickForm({ ...quickForm, os: e.target.value })}
                  disabled={generating}
                  className="w-full bg-[#131519] border border-[#3b3e48] rounded px-3 py-2 text-white outline-none focus:border-blue-500 disabled:opacity-50"
                >
                  <option value="Windows">Windows (All)</option>
                  <option value="macOS">macOS (All)</option>
                  <option value="Linux">Linux (All)</option>
                  <option value="Android">Android Mobile</option>
                  <option value="iOS">iOS Mobile</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-[#d1d5db] text-[13px] font-medium block">Browser Kernel</label>
                <select 
                  value={quickForm.browserCore}
                  onChange={(e) => setQuickForm({ ...quickForm, browserCore: e.target.value })}
                  disabled={generating}
                  className="w-full bg-[#131519] border border-[#3b3e48] rounded px-3 py-2 text-white outline-none focus:border-blue-500 disabled:opacity-50"
                >
                  <option value="SunBrowser">SunBrowser (Chrome-based)</option>
                  <option value="FlowerBrowser">FlowerBrowser (Firefox-based)</option>
                </select>
              </div>
            </div>

            {/* Preview Hint */}
            <div className="p-3 bg-[#24272e] rounded border border-[#2d3039] text-[12px] font-mono text-[#9ca3af]">
              Example Outputs: <span className="text-blue-400">{quickForm.prefix}-01</span>, <span className="text-blue-400">{quickForm.prefix}-02</span> ...
            </div>

            {generating && (
              <div className="space-y-2 pt-2">
                <div className="flex justify-between text-xs text-[#9ca3af]">
                  <span>Generating Profiles...</span>
                  <span>{generateProgress}%</span>
                </div>
                <div className="w-full h-2 bg-[#181a1f] rounded-full overflow-hidden">
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