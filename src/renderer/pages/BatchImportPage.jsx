import { useState } from 'react';
import { CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';
import Badge from '@/components/ui/Badge.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

export default function BatchImportPage() {
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [commitResult, setCommitResult] = useState(null);
  const [error, setError] = useState('');

  async function handlePreview() {
    if (previewing || committing) return;
    setPreviewing(true); 
    setError(''); 
    setPreview(null); 
    setCommitResult(null);
    try { 
      const res = await softglazeApi.batch.previewProfilesFromSpreadsheet();
      setPreview(res); 
    } catch (err) { 
      setError(err.message || 'Failed to preview spreadsheet.'); 
    } finally { 
      setPreviewing(false); 
    }
  }

  async function handleCommit() {
    if (!preview?.token) return;
    setCommitting(true); 
    setError(''); 
    setCommitResult(null);
    try { 
      const res = await softglazeApi.batch.commitProfileImport(preview.token);
      setCommitResult(res); 
    } catch (err) { 
      setError(err.message || 'Failed to commit import.'); 
    } finally { 
      setCommitting(false); 
    }
  }

  return (
    <div className="w-full min-h-full bg-[#0f111a] text-[#e2e8f0] p-2 font-sans rounded-xl">
      <PageHeader 
        eyebrow="Spreadsheet Workflow" 
        title="Batch Import" 
        description="Preview ixBrowser or AdsPower-style Excel/CSV templates before committing rows into SQLite storage automatically." 
      />
      
      {error && (
        <div className="mb-4 rounded-lg border border-red-900/70 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
      
      <div className="grid gap-6 xl:grid-cols-[520px_1fr]">
        {/* Left Card: File Action Dropzone */}
        <Card>
          <CardHeader>
            <CardTitle>Upload Spreadsheet</CardTitle>
            <CardDescription>Select an .xlsx, .xls, or .csv file using the secure system native file picker.</CardDescription>
          </CardHeader>
          <CardContent>
            {/* FIXED HYDRATION: Changed container from <button> to <div role="button"> to eliminate invalid nested DOM nodes */}
            <div 
              role="button" 
              tabIndex={0}
              onClick={handlePreview}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handlePreview(); }}
              className={`flex min-h-72 w-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-950 p-8 text-center transition outline-none ${
                previewing || committing 
                  ? 'opacity-60 cursor-not-allowed' 
                  : 'hover:border-slate-500 hover:bg-slate-900/40 cursor-pointer focus-visible:border-blue-500'
              }`}
            >
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900">
                <FileSpreadsheet className="h-7 w-7 text-slate-300" />
              </div>
              <div className="text-sm font-semibold text-slate-100">
                {previewing ? 'Parsing spreadsheet...' : 'Choose Spreadsheet'}
              </div>
              <p className="mt-2 max-w-sm text-xs leading-5 text-slate-500">
                The layout scanner processes structural cells down from row 4, isolating mixed configurations such as Host:Port:Username:Password smoothly.
              </p>
              
              {/* Outer click handler propagation is stopped to handle isolated element triggers cleanly */}
              <Button 
                className="mt-6 bg-blue-600 hover:bg-blue-500 text-white border-transparent" 
                disabled={previewing || committing} 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  handlePreview(); 
                }}
              >
                <Upload className="h-4 w-4" />
                {previewing ? 'Processing...' : 'Open File Picker'}
              </Button>
            </div>
          </CardContent>
        </Card>
        
        {/* Right Card: Result Verification Grid */}
        <Card>
          <CardHeader>
            <CardTitle>Preview / Commit Engine</CardTitle>
            <CardDescription>Always evaluate the layout array contents carefully. Commit structural data blocks only when tracking outputs look complete.</CardDescription>
          </CardHeader>
          <CardContent>
            {!preview ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-8 text-sm text-slate-500">
                No spreadsheet has been previewed yet. Choose an import tracking template file to run data pipeline arrays.
              </div>
            ) : preview.cancelled ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-8 text-sm text-slate-400">
                System native selection operation was cancelled.
              </div>
            ) : (
              <div className="space-y-5">
                {/* Structural Parsing Metrics Bar */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Target Document</span>
                    <span className="block mt-1 text-xs font-semibold text-slate-200 truncate">{preview.fileName || '--'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Active Sheet</span>
                    <span className="block mt-1 text-xs font-semibold text-slate-200 truncate">{preview.sheetName || '--'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Data Header Row</span>
                    <span className="block mt-1 text-xs font-semibold text-slate-200">Row {preview.headerRow || '--'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Import Load Array</span>
                    <span className="block mt-1 text-xs font-semibold text-slate-200">{preview.totalRows || 0} Lines Detected</span>
                  </div>
                </div>

                {/* Commit Confirmation Module Banner */}
                <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">Data Pipeline Status: Ready</div>
                    <p className="mt-1 text-xs text-slate-500">
                      {preview.items?.length ?? 0} valid profile rows successfully extracted and parsed. Click commit to dump records to local SQLite.
                    </p>
                  </div>
                  <Button 
                    onClick={handleCommit} 
                    disabled={committing || !preview.token} 
                    className="bg-blue-600 hover:bg-blue-500 text-white border-transparent whitespace-nowrap"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {committing ? 'Committing...' : 'Commit Import'}
                  </Button>
                </div>

                {/* Execution Commit Output Status Box */}
                {commitResult && (
                  <div className="p-4 bg-emerald-950/40 text-emerald-400 rounded-xl border border-emerald-900/60 text-sm flex flex-col gap-1.5">
                    <span className="font-bold text-white text-[15px]">Database Import Operation Complete!</span>
                    <span>• {commitResult.createdProfiles?.length ?? 0} independent automation environments successfully mapped.</span>
                    <span>• {commitResult.createdProxies?.length ?? 0} proxy network configurations written to local sqlite pool.</span>
                  </div>
                )}

                {/* Live Parsed Preview Registry Array Data Grid */}
                {preview.items?.length > 0 && (
                  <section className="pt-2">
                    <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Extracted Import Preview Layout</h3>
                    <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950">
                      <table className="w-full min-w-[600px] text-left text-xs border-collapse">
                        <thead className="sticky top-0 bg-[#161925] border-b border-slate-800 text-slate-400 font-medium">
                          <tr>
                            <th className="px-4 py-3">Excel Row</th>
                            <th className="px-4 py-3">Environment Title</th>
                            <th className="px-4 py-3">Proxy Routing Context</th>
                            <th className="px-4 py-3">Proxy Payload String</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-900 text-slate-300">
                          {preview.items.map((item, index) => (
                            <tr key={`${item.row}-${item.title}-${index}`} className="hover:bg-slate-900/40">
                              <td className="px-4 py-2.5 font-mono text-slate-500">#{item.row}</td>
                              <td className="px-4 py-2.5 font-semibold text-slate-200">{item.title}</td>
                              <td className="px-4 py-2.5">
                                <Badge variant={item.proxyMethod === 'CUSTOM' ? 'blue' : 'default'}>
                                  {item.proxyMethod}
                                </Badge>
                              </td>
                              <td className="px-4 py-2.5 font-mono text-slate-400 truncate max-w-xs">
                                {item.rawProxy || <span className="text-slate-600 font-sans italic">Direct (No Proxy Configuration Loaded)</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}