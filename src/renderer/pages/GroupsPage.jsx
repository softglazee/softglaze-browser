import React, { useState, useMemo } from 'react';
import { 
  Folder, FolderOpen, Plus, MoreVertical, Edit2, Trash2, 
  Search, Monitor, GripVertical, Check, X
} from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card, CardContent } from '@/components/ui/Card.jsx';
import EmptyState from '@/components/EmptyState.jsx';
import { formatDateTime } from '@/lib/utils.js';

// --- MOCK DATA FOR IMMEDIATE UI TESTING ---
const INITIAL_GROUPS = [
  { id: 'g-1', name: 'Lead Gen', createdAt: new Date(Date.now() - 86400000).toISOString() },
  { id: 'g-2', name: 'Crypto', createdAt: new Date(Date.now() - 172800000).toISOString() },
  { id: 'g-3', name: 'E-commerce', createdAt: new Date().toISOString() },
];

const INITIAL_PROFILES = [
  { id: 'p-1', title: 'FB Alpha 01', groupId: 'g-1', proxy: 'US Rotating', status: 'Ready' },
  { id: 'p-2', title: 'FB Alpha 02', groupId: 'g-1', proxy: 'US Rotating', status: 'Ready' },
  { id: 'p-3', title: 'Twitter Main', groupId: 'g-2', proxy: 'UK Datacenter', status: 'Ready' },
  { id: 'p-4', title: 'Amazon Buyer', groupId: 'g-3', proxy: 'DE Residential', status: 'Ready' },
  { id: 'p-5', title: 'Test Profile', groupId: null, proxy: 'Direct', status: 'Ready' }, // Ungrouped
];

export default function GroupsPage() {
  const [groups, setGroups] = useState(INITIAL_GROUPS);
  const [profiles, setProfiles] = useState(INITIAL_PROFILES);
  
  const [activeGroupId, setActiveGroupId] = useState('all'); // 'all', 'ungrouped', or specific group ID
  const [search, setSearch] = useState('');
  
  // Modal / Inline Edit States
  const [isAddingGroup, setIsAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [editGroupName, setEditGroupName] = useState('');
  
  // Drag & Drop State for visual feedback
  const [dragOverGroupId, setDragOverGroupId] = useState(null);

  // --- DERIVED DATA ---
  const activeGroup = groups.find(g => g.id === activeGroupId);
  
  const filteredProfiles = useMemo(() => {
    let filtered = profiles;
    
    // Filter by Group
    if (activeGroupId === 'ungrouped') {
      filtered = filtered.filter(p => !p.groupId);
    } else if (activeGroupId !== 'all') {
      filtered = filtered.filter(p => p.groupId === activeGroupId);
    }
    
    // Filter by Search
    if (search.trim()) {
      filtered = filtered.filter(p => p.title.toLowerCase().includes(search.toLowerCase()));
    }
    
    return filtered;
  }, [profiles, activeGroupId, search]);

  // --- GROUP CRUD OPERATIONS ---
  const handleAddGroup = (e) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    
    const newGroup = {
      id: `g-${Date.now()}`,
      name: newGroupName.trim(),
      createdAt: new Date().toISOString()
    };
    
    setGroups([...groups, newGroup]);
    setNewGroupName('');
    setIsAddingGroup(false);
  };

  const handleUpdateGroup = (e, id) => {
    e.preventDefault();
    if (!editGroupName.trim()) return;
    
    setGroups(groups.map(g => g.id === id ? { ...g, name: editGroupName.trim() } : g));
    setEditingGroupId(null);
    setEditGroupName('');
  };

  const handleDeleteGroup = (id, name) => {
    if (!window.confirm(`Are you sure you want to delete the group "${name}"? Profiles inside will become "Ungrouped".`)) return;
    
    // Move profiles to ungrouped
    setProfiles(profiles.map(p => p.groupId === id ? { ...p, groupId: null } : p));
    // Remove group
    setGroups(groups.filter(g => g.id !== id));
    if (activeGroupId === id) setActiveGroupId('all');
  };

  // --- DRAG AND DROP LOGIC ---
  const handleDragStart = (e, profileId) => {
    e.dataTransfer.setData('profileId', profileId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, groupId) => {
    e.preventDefault(); // Necessary to allow dropping
    e.dataTransfer.dropEffect = 'move';
    if (dragOverGroupId !== groupId) {
      setDragOverGroupId(groupId);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOverGroupId(null);
  };

  const handleDrop = (e, targetGroupId) => {
    e.preventDefault();
    setDragOverGroupId(null);
    
    const profileId = e.dataTransfer.getData('profileId');
    if (!profileId) return;

    // The logic: if target is 'ungrouped', set to null. Otherwise set to the target group ID.
    const newGroupId = targetGroupId === 'ungrouped' ? null : (targetGroupId === 'all' ? undefined : targetGroupId);
    
    if (newGroupId !== undefined) {
      setProfiles(prev => prev.map(p => p.id === profileId ? { ...p, groupId: newGroupId } : p));
    }
  };

  return (
    <>
      <PageHeader 
        eyebrow="Organization" 
        title="Groups Management" 
        description="Categorize and manage your browser profiles efficiently."
      />
      
      <div className="flex flex-col md:flex-row gap-6 h-[calc(100vh-140px)]">
        
        {/* LEFT SIDEBAR: FOLDERS */}
        <Card className="w-full md:w-72 shrink-0 flex flex-col bg-[#1e2025] border-[#2d3039]">
          <div className="p-4 border-b border-[#2d3039] flex justify-between items-center">
            <h2 className="text-white font-medium text-[14px]">Directories</h2>
            <button 
              onClick={() => { setIsAddingGroup(true); setEditingGroupId(null); }}
              className="p-1 hover:bg-[#2a2d35] rounded text-blue-400 hover:text-blue-300 transition"
              title="Create new group"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {/* Native Droppable Area: All Profiles (Doesn't change group, just views them) */}
            <button 
              onClick={() => setActiveGroupId('all')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md transition ${activeGroupId === 'all' ? 'bg-blue-600/10 text-blue-400 font-medium' : 'text-[#d1d5db] hover:bg-[#24272e]'}`}
            >
              <div className="flex items-center gap-3">
                <Monitor className="w-4 h-4" />
                <span className="text-[13px]">All Profiles</span>
              </div>
              <span className="text-[11px] bg-[#2a2d35] px-2 py-0.5 rounded text-[#9ca3af]">{profiles.length}</span>
            </button>

            {/* Native Droppable Area: Ungrouped */}
            <div 
              onDragOver={(e) => handleDragOver(e, 'ungrouped')}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, 'ungrouped')}
              className={`rounded-md transition-colors ${dragOverGroupId === 'ungrouped' ? 'bg-blue-600/20 border border-blue-500 border-dashed' : 'border border-transparent'}`}
            >
              <button 
                onClick={() => setActiveGroupId('ungrouped')}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md transition ${activeGroupId === 'ungrouped' ? 'bg-blue-600/10 text-blue-400 font-medium' : 'text-[#d1d5db] hover:bg-[#24272e]'}`}
              >
                <div className="flex items-center gap-3">
                  <Folder className="w-4 h-4 text-slate-500" />
                  <span className="text-[13px]">Ungrouped</span>
                </div>
                <span className="text-[11px] bg-[#2a2d35] px-2 py-0.5 rounded text-[#9ca3af]">
                  {profiles.filter(p => !p.groupId).length}
                </span>
              </button>
            </div>

            <div className="my-2 border-t border-[#2d3039]"></div>

            {/* Inline Add Group Form */}
            {isAddingGroup && (
              <form onSubmit={handleAddGroup} className="flex items-center gap-2 mb-2 px-2 py-2 bg-[#24272e] rounded-md border border-blue-500/50">
                <Folder className="w-4 h-4 text-blue-400 shrink-0" />
                <input 
                  autoFocus
                  type="text" 
                  placeholder="Group name..." 
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  className="bg-transparent border-none outline-none text-white text-[13px] w-full"
                />
                <button type="submit" className="text-emerald-400 hover:text-emerald-300"><Check className="w-4 h-4" /></button>
                <button type="button" onClick={() => setIsAddingGroup(false)} className="text-slate-400 hover:text-red-400"><X className="w-4 h-4" /></button>
              </form>
            )}

            {/* Dynamic Custom Groups */}
            {groups.map(group => {
              const isEditing = editingGroupId === group.id;
              const isActive = activeGroupId === group.id;
              const isDragTarget = dragOverGroupId === group.id;
              const profileCount = profiles.filter(p => p.groupId === group.id).length;

              return (
                <div 
                  key={group.id}
                  onDragOver={(e) => handleDragOver(e, group.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, group.id)}
                  className={`rounded-md transition-colors ${isDragTarget ? 'bg-blue-600/20 border border-blue-500 border-dashed' : 'border border-transparent'}`}
                >
                  {isEditing ? (
                    <form onSubmit={(e) => handleUpdateGroup(e, group.id)} className="flex items-center gap-2 px-2 py-2 bg-[#24272e] rounded-md border border-blue-500/50">
                      <FolderOpen className="w-4 h-4 text-blue-400 shrink-0" />
                      <input 
                        autoFocus
                        type="text" 
                        value={editGroupName}
                        onChange={(e) => setEditGroupName(e.target.value)}
                        className="bg-transparent border-none outline-none text-white text-[13px] w-full"
                      />
                      <button type="submit" className="text-emerald-400"><Check className="w-4 h-4" /></button>
                      <button type="button" onClick={() => setEditingGroupId(null)} className="text-slate-400"><X className="w-4 h-4" /></button>
                    </form>
                  ) : (
                    <div className={`group flex items-center justify-between px-3 py-2.5 rounded-md transition cursor-pointer ${isActive ? 'bg-blue-600/10 text-blue-400 font-medium' : 'text-[#d1d5db] hover:bg-[#24272e]'}`}>
                      <div className="flex items-center gap-3 flex-1 overflow-hidden" onClick={() => setActiveGroupId(group.id)}>
                        {isActive ? <FolderOpen className="w-4 h-4 shrink-0" /> : <Folder className="w-4 h-4 shrink-0" />}
                        <span className="text-[13px] truncate">{group.name}</span>
                      </div>
                      
                      {/* Hover Actions */}
                      <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity gap-1">
                        <button 
                          onClick={(e) => { e.stopPropagation(); setEditingGroupId(group.id); setEditGroupName(group.name); setIsAddingGroup(false); }}
                          className="p-1 hover:bg-[#3b3e48] rounded text-slate-400 hover:text-white transition"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleDeleteGroup(group.id, group.name); }}
                          className="p-1 hover:bg-red-900/30 rounded text-slate-400 hover:text-red-400 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      
                      {/* Count Badge (hides on hover to make room for actions) */}
                      <span className={`text-[11px] bg-[#2a2d35] px-2 py-0.5 rounded text-[#9ca3af] group-hover:hidden ${isActive ? 'bg-blue-900/40 text-blue-300' : ''}`}>
                        {profileCount}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {/* RIGHT AREA: PROFILES IN GROUP */}
        <Card className="flex-1 flex flex-col bg-[#1e2025] border-[#2d3039] overflow-hidden">
          <div className="p-4 border-b border-[#2d3039] flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#24272e]">
            <div>
              <h2 className="text-white font-medium flex items-center gap-2">
                {activeGroupId === 'all' ? 'All Profiles' : activeGroupId === 'ungrouped' ? 'Ungrouped' : activeGroup?.name}
                <span className="text-xs bg-[#3b3e48] text-[#d1d5db] px-2 py-0.5 rounded-full">{filteredProfiles.length}</span>
              </h2>
              <p className="text-xs text-[#9ca3af] mt-1">Drag and drop rows into folders on the left to move them.</p>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
                <input 
                  type="text" 
                  placeholder="Search in group..." 
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="bg-[#181a1f] border border-[#3b3e48] rounded-md pl-9 pr-3 py-2 text-[13px] text-white outline-none focus:border-blue-500 w-full sm:w-64 transition"
                />
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-x-auto">
            <table className="w-full min-w-[600px] border-collapse text-left text-[13px]">
              <thead className="bg-[#181a1f] text-[#9ca3af] sticky top-0 z-10 shadow-sm border-b border-[#2d3039]">
                <tr>
                  <th className="px-5 py-3 font-medium w-10"></th>
                  <th className="px-5 py-3 font-medium">Profile Name</th>
                  <th className="px-5 py-3 font-medium">Current Group</th>
                  <th className="px-5 py-3 font-medium">Proxy</th>
                </tr>
              </thead>
              <tbody>
                {filteredProfiles.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="p-12">
                      <EmptyState 
                        title="No profiles found" 
                        description={search ? "No profiles match your search." : "This group is empty. Drag and drop profiles here."} 
                      />
                    </td>
                  </tr>
                ) : (
                  filteredProfiles.map((p) => {
                    const profileGroup = groups.find(g => g.id === p.groupId);
                    return (
                      <tr 
                        key={p.id} 
                        draggable
                        onDragStart={(e) => handleDragStart(e, p.id)}
                        className="border-b border-[#2d3039] hover:bg-[#24272e] transition group bg-[#1e2025]"
                      >
                        <td className="px-3 py-3 cursor-grab active:cursor-grabbing text-slate-500 group-hover:text-blue-400">
                          <GripVertical className="w-4 h-4 mx-auto" />
                        </td>
                        <td className="px-5 py-3 font-medium text-white">{p.title}</td>
                        <td className="px-5 py-3 text-[#9ca3af]">
                          <span className="flex items-center gap-1.5 bg-[#2a2d35] px-2 py-1 rounded w-max text-[11px]">
                            <Folder className="w-3 h-3 text-slate-400" />
                            {profileGroup ? profileGroup.name : 'Ungrouped'}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-[#9ca3af]">{p.proxy}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>

      </div>
    </>
  );
}