import React, { useState, useMemo } from 'react';
import { Trash2, Undo2, AlertTriangle, Search, ArchiveX } from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card, CardContent } from '@/components/ui/Card.jsx';
import EmptyState from '@/components/EmptyState.jsx';
import { formatDateTime } from '@/lib/utils.js';

// --- MOCK DATA FOR IMMEDIATE UI TESTING ---
// In a real scenario, this would be fetched via softglazeApi.profiles.listTrash()
const INITIAL_TRASH = [
  { id: 't-1', title: 'FB Old Acc 04', originalGroup: 'Lead Gen', deletedAt: new Date(Date.now() - 86400000 * 2).toISOString(), browserCore: 'SunBrowser' },
  { id: 't-2', title: 'Twitter Backup', originalGroup: 'Ungrouped', deletedAt: new Date(Date.now() - 86400000 * 5).toISOString(), browserCore: 'FlowerBrowser' },
  { id: 't-3', title: 'Amz Buyer 09', originalGroup: 'E-commerce', deletedAt: new Date(Date.now() - 3600000).toISOString(), browserCore: 'SunBrowser' },
];

export default function TrashPage() {
  const [trashItems, setTrashItems] = useState(INITIAL_TRASH);
  const [search, setSearch] = useState('');

  const filteredItems = useMemo(() => {
    if (!search.trim()) return trashItems;
    return trashItems.filter(item => item.title.toLowerCase().includes(search.toLowerCase()));
  }, [trashItems, search]);

  // --- ACTIONS ---
  const handleRestore = (id, title) => {
    // In production: await softglazeApi.profiles.restore(id)
    setTrashItems(prev => prev.filter(item => item.id !== id));
    // Optional: show a toast notification here
    console.log(`Restored profile: ${title}`);
  };

  const handlePermanentDelete = (id, title) => {
    if (!window.confirm(`WARNING: Are you sure you want to PERMANENTLY delete "${title}"? This action cannot be undone and all associated fingerprint/cookie data will be destroyed.`)) {
      return;
    }
    // In production: await softglazeApi.profiles.hardDelete(id)
    setTrashItems(prev => prev.filter(item => item.id !== id));
  };

  const handleEmptyTrash = () => {
    if (trashItems.length === 0) return;
    if (!window.confirm('WARNING: Are you sure you want to permanently delete ALL profiles in the trash? This action cannot be undone.')) {
      return;
    }
    // In production: await softglazeApi.profiles.emptyTrash()
    setTrashItems([]);
  };

  return (
    <>
      <PageHeader 
        eyebrow="Workspace" 
        title="Trash & Recovery" 
        description="Recover deleted profiles or permanently erase them from your storage."
        actions={
          <Button 
            onClick={handleEmptyTrash} 
            disabled={trashItems.length === 0}
            className="bg-red-900/30 text-red-400 hover:bg-red-900/50 hover:text-red-300 border border-red-900/50 transition-colors disabled:opacity-50"
          >
            <ArchiveX className="w-4 h-4 mr-2" />
            Empty Trash
          </Button>
        }
      />

      {/* Warning Banner */}
      <div className="mb-6 flex items-start gap-3 bg-[#42341b] border border-[#5a4623] text-[#eab308] p-4 rounded-lg">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
        <div className="text-[13px] leading-relaxed">
          <p className="font-semibold mb-1">Data Retention Policy</p>
          <p className="text-[#eab308]/80">
            Profiles moved to the trash will be retained for <strong>30 days</strong> to allow for secure rollback tracking. 
            After 30 days, they will be automatically and permanently deleted from the local database.
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex justify-between items-center mb-4">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
          <input 
            type="text" 
            placeholder="Search deleted profiles..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#181a1f] border border-[#3b3e48] rounded-md pl-9 pr-3 py-2 text-[13px] text-white outline-none focus:border-blue-500 transition"
          />
        </div>
        <div className="text-[12px] text-[#9ca3af] hidden sm:block">
          {trashItems.length} profile(s) in trash
        </div>
      </div>

      {/* Data Table */}
      <Card>
        <CardContent className="p-0">
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[800px] border-collapse text-left text-[13px]">
              <thead className="border-b border-[#2d3039] bg-[#181a1f] text-[#9ca3af]">
                <tr>
                  <th className="px-5 py-3 font-medium">Profile Name</th>
                  <th className="px-5 py-3 font-medium">Original Group</th>
                  <th className="px-5 py-3 font-medium">Deleted Date</th>
                  <th className="px-5 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="p-12">
                      <EmptyState 
                        title="Trash is empty" 
                        description={search ? "No deleted profiles match your search." : "You have no deleted profiles. Safe and clean!"} 
                        icon={<Trash2 className="w-12 h-12 text-[#3b3e48]" />}
                      />
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => (
                    <tr key={item.id} className="border-b border-[#2d3039] hover:bg-[#181a1f] transition bg-[#1e2025]">
                      <td className="px-5 py-4">
                        <div className="flex flex-col">
                          <span className="font-medium text-white">{item.title}</span>
                          <span className="text-[11px] text-[#9ca3af] mt-0.5">{item.browserCore}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-[#9ca3af]">
                        <span className="bg-[#2a2d35] px-2 py-1 rounded text-[11px]">
                          {item.originalGroup}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-[#9ca3af]">
                        {formatDateTime(item.deletedAt)}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-2">
                          <Button 
                            size="sm" 
                            onClick={() => handleRestore(item.id, item.title)}
                            className="bg-[#2a2d35] hover:bg-[#3b3e48] text-white border border-[#3b3e48]"
                            title="Restore Profile"
                          >
                            <Undo2 className="w-3.5 h-3.5 mr-1.5" />
                            Restore
                          </Button>
                          <Button 
                            size="sm" 
                            onClick={() => handlePermanentDelete(item.id, item.title)}
                            className="bg-transparent hover:bg-red-900/30 text-slate-400 hover:text-red-400 border border-transparent hover:border-red-900/50 transition"
                            title="Permanently Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}