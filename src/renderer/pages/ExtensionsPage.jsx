import React, { useState, useMemo } from 'react';
import { Puzzle, ShieldCheck, Download, Search, Check, ExternalLink, Sliders, ToggleLeft, ToggleRight, Layers } from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card, CardContent } from '@/components/ui/Card.jsx';
import Input from '@/components/ui/Input.jsx';
import EmptyState from '@/components/EmptyState.jsx';

// --- CURATED HIGH-VALUE EXTENSIONS pool ---
const SYSTEM_EXTENSIONS_POOL = [
  {
    id: 'cjpalhdlnbpafiamejdnhcphjbkeiagm',
    name: 'uBlock Origin',
    version: '1.57.2',
    category: 'Privacy & Security',
    developer: 'Raymond Hill',
    description: 'An efficient wide-spectrum content blocker. Easy on CPU and memory footprints. Crucial for reducing script tracking overhead.',
    iconUrl: 'https://lh3.googleusercontent.com/2_gS97v7Yda4W9w2McU7Z65sX9mNnO0mBNoE3-7Yk6pBwB9Z6ZpZg=s128-w128-h128',
    storeUrl: 'https://chromewebstore.google.com/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm'
  },
  {
    id: 'nkbihfbeogaeaoehlefnkodbefgpgknn',
    name: 'MetaMask',
    version: '11.16.2',
    category: 'Web3 & Crypto',
    developer: 'MetaMask Team',
    description: 'An Ethereum Wallet in your browser. Seamlessly manage multi-account multi-profile deployments without crossing wallet hardware IDs.',
    iconUrl: 'https://lh3.googleusercontent.com/8hz7Z9v8X9pYk6pBwB9Z6ZpZg=s128-w128-h128',
    storeUrl: 'https://chromewebstore.google.com/detail/metamask/nkbihfbeogaeaoehlefnkodbefgpgknn'
  },
  {
    id: 'hlnoidbnhihffbfehkicmmebcoepbefe',
    name: 'Canvas Defender',
    version: '1.2.4',
    category: 'Privacy & Security',
    developer: 'Multilogin',
    description: 'Intercepts canvas fingerprinting configurations. Adds unique structural noise offsets to alter individual drawing vectors.',
    iconUrl: 'https://lh3.googleusercontent.com/6X9mNnO0mBNoE3-7Yk6pBwB9Z6ZpZg=s128-w128-h128',
    storeUrl: 'https://chromewebstore.google.com/detail/canvas-defender/hlnoidbnhihffbfehkicmmebcoepbefe'
  },
  {
    id: 'gighmmpiobklfepjocnamgkkbiglidom',
    name: 'AdBlock',
    version: '5.16.0',
    category: 'Utilities',
    developer: 'AdBlock Team',
    description: 'Block pop-ups and annoying ads on YouTube, Facebook, and favorite websites natively across dynamic isolation profiles.',
    iconUrl: 'https://lh3.googleusercontent.com/9pYk6pBwB9Z6ZpZg=s128-w128-h128',
    storeUrl: 'https://chromewebstore.google.com/detail/adblock-%E2%80%94-best-ad-blocker/gighmmpiobklfepjocnamgkkbiglidom'
  },
  {
    id: 'fhecolocacknhbeapidgflhhbhaencca',
    name: 'Cookie-Editor',
    version: '1.13.0',
    category: 'Developer Tools',
    developer: 'Cookie-Editor Team',
    description: 'Inspect, drop, or inject profile cookies natively using standard JSON or Netscape export matrices inside your runtime parameters.',
    iconUrl: 'https://lh3.googleusercontent.com/bB9Z6ZpZg=s128-w128-h128',
    storeUrl: 'https://chromewebstore.google.com/detail/cookie-editor/fhecolocacknhbeapidgflhhbhaencca'
  },
  {
    id: 'jhncoengmabidmkiihonmiebdaidmmin',
    name: 'Proxy SwitchyOmega',
    version: '2.5.21',
    category: 'Utilities',
    developer: 'FelisCatus',
    description: 'Manage and switch between complex proxy environments quickly and easily. Fully supports fallback logic overrides.',
    iconUrl: 'https://lh3.googleusercontent.com/Yda4W9w2McU7Z=s128-w128-h128',
    storeUrl: 'https://chromewebstore.google.com/detail/proxy-switchyomega/jhncoengmabidmkiihonmiebdaidmmin'
  }
];

export default function ExtensionsPage() {
  const [extensions, setExtensions] = useState(SYSTEM_EXTENSIONS_POOL);
  const [enabledIds, setEnabledIds] = useState(new Set(['cjpalhdlnbpafiamejdnhcphjbkeiagm', 'fhecolocacknhbeapidgflhhbhaencca']));
  
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  
  // Custom Manual ID Input Field State
  const [manualId, setManualId] = useState('');
  const [installing, setInstalling] = useState(false);

  const categories = ['All', 'Privacy & Security', 'Web3 & Crypto', 'Utilities', 'Developer Tools'];

  // Filtered extensions calculation
  const filteredExtensions = useMemo(() => {
    return extensions.filter(ext => {
      const matchesSearch = ext.name.toLowerCase().includes(search.toLowerCase()) || ext.id.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = selectedCategory === 'All' || ext.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [extensions, search, selectedCategory]);

  // Toggle Global Extension Installation Status
  const handleToggleExtension = (id) => {
    setEnabledIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Mock function to simulate installing an extension from an explicit ID string
  const handleManualInstall = async (e) => {
    e.preventDefault();
    if (!manualId.trim() || manualId.length < 32) return alert('Please enter a valid 32-character Chrome Extension ID');
    
    setInstalling(true);
    // Simulating secure package fetch delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const targetId = manualId.trim();
    if (extensions.some(e => e.id === targetId)) {
      setInstalling(false);
      return alert('This extension is already present in your Team Repository.');
    }

    const customExt = {
      id: targetId,
      name: `Custom Extension (${targetId.slice(0,6)})`,
      version: '1.0.0',
      category: 'Utilities',
      developer: 'External Web Store',
      description: 'Manually imported direct enterprise archive deployment configuration matching your precise infrastructure pipeline requirements.',
      iconUrl: '',
      storeUrl: `https://chromewebstore.google.com/detail/${targetId}`
    };

    setExtensions([customExt, ...extensions]);
    setEnabledIds(prev => new Set([...prev, targetId]));
    setManualId('');
    setInstalling(false);
  };

  return (
    <>
      <PageHeader 
        eyebrow="Enterprise Repositories" 
        title="Team Extensions" 
        description="Globally distribute extensions across container profiles with uniform state sync flags."
      />

      {/* DYNAMIC TOP ACTIONS BAR */}
      <div className="flex flex-col xl:flex-row gap-4 mb-6 items-start xl:items-center justify-between">
        
        {/* Filter Selection Grid */}
        <div className="flex flex-wrap gap-2">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition ${selectedCategory === cat ? 'bg-blue-600/10 border-blue-500 text-blue-400' : 'bg-[#181a1f] border-[#3b3e48] text-[#9ca3af] hover:text-white'}`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Manual Web Store Importer Form */}
        <form onSubmit={handleManualInstall} className="w-full xl:w-auto flex flex-col sm:flex-row gap-3 items-stretch sm:items-center bg-[#1e2025] border border-[#2d3039] p-2.5 rounded-lg">
          <div className="relative flex-1 sm:w-72">
            <input
              type="text"
              placeholder="Paste Google Web Store Extension ID..."
              value={manualId}
              onChange={e => setManualId(e.target.value)}
              disabled={installing}
              className="w-full bg-[#131519] border border-[#3b3e48] rounded px-3 py-1.5 text-xs font-mono text-white outline-none focus:border-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={installing || !manualId.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 px-4 py-1.5 rounded text-xs font-medium text-white transition flex items-center justify-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            {installing ? 'Fetching...' : 'Import to Team'}
          </button>
        </form>
      </div>

      {/* SEARCH AND REPO TOTAL HINT */}
      <div className="flex items-center gap-4 bg-[#181a1f] border border-[#2d3039] px-4 py-3 rounded-xl mb-6">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
          <input
            type="text"
            placeholder="Search extensions by name or hash signature reference..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-[#131519] border border-[#3b3e48] rounded-md pl-9 pr-3 py-2 text-[13px] text-white outline-none focus:border-blue-500 transition"
          />
        </div>
        <div className="text-[12px] text-[#9ca3af] hidden sm:block whitespace-nowrap">
          Total Repositories: <span className="text-white font-semibold">{extensions.length}</span> | Enabled: <span className="text-blue-400 font-semibold">{enabledIds.size}</span>
        </div>
      </div>

      {/* CURATED GRID RENDERING PANEL */}
      {filteredExtensions.length === 0 ? (
        <EmptyState title="No Extensions Match Criteria" description="Modify your query parameters or import a direct Extension identifier archive string from the Chrome Web Store above." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredExtensions.map(ext => {
            const isGloballyEnabled = enabledIds.has(ext.id);
            return (
              <Card key={ext.id} className={`bg-[#1e2025] border transition-all flex flex-col justify-between overflow-hidden group ${isGloballyEnabled ? 'border-blue-500/40 shadow-blue-950/10 shadow-lg' : 'border-[#2d3039] hover:border-slate-500'}`}>
                <CardContent className="p-5 flex-1 flex flex-col justify-between">
                  <div>
                    {/* Header: Icon + Identification metadata */}
                    <div className="flex items-start gap-3.5">
                      <div className="w-12 h-12 rounded-xl bg-[#131519] border border-[#3b3e48] shrink-0 overflow-hidden flex items-center justify-center p-2.5 group-hover:border-slate-400 transition">
                        {ext.iconUrl ? (
                          <img src={ext.iconUrl} alt={ext.name} className="w-full h-full object-contain" onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }} />
                        ) : null}
                        <Puzzle className="w-5 h-5 text-blue-400 hidden" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-white font-semibold text-[14px] truncate" title={ext.name}>{ext.name}</h3>
                          <span className="text-[10px] bg-[#2a2d35] px-2 py-0.5 rounded text-[#9ca3af] font-medium shrink-0">{ext.category}</span>
                        </div>
                        <p className="text-[11px] text-[#9ca3af] mt-0.5">v{ext.version} • By <span className="text-slate-300">{ext.developer}</span></p>
                      </div>
                    </div>

                    {/* Mid-level description copy parameters */}
                    <p className="text-[12px] text-[#d1d5db] mt-4 line-clamp-3 leading-relaxed min-h-[54px]">
                      {ext.description}
                    </p>
                  </div>

                  {/* Operational Footer Context Block */}
                  <div className="mt-5 pt-4 border-t border-[#2d3039] flex items-center justify-between gap-4 text-[12px]">
                    <a 
                      href={ext.storeUrl} 
                      target="_blank" 
                      rel="noreferrer"
                      className="text-slate-400 hover:text-blue-400 transition flex items-center gap-1 font-mono text-[11px]"
                    >
                      ID: {ext.id.slice(0,6)}...{ext.id.slice(-4)}
                      <ExternalLink className="w-3 h-3" />
                    </a>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggleExtension(ext.id)}
                        className={`px-3 py-1.5 rounded font-medium transition flex items-center gap-1.5 text-xs ${isGloballyEnabled ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-md' : 'bg-[#3b3e48] hover:bg-[#4b4e58] text-slate-200'}`}
                      >
                        {isGloballyEnabled ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            Auto-Install Enabled
                          </>
                        ) : (
                          'Disabled Globally'
                        )}
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}