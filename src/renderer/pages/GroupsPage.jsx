import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Folder, FolderOpen, Plus, Edit2, Trash2,
  Search, Monitor, Check, X, Tag as TagIcon, Loader2
} from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card, CardContent } from '@/components/ui/Card.jsx';
import EmptyState from '@/components/EmptyState.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

const GROUP_COLORS = ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];

// Small reusable checkbox styled like the rest of the app
const Checkbox = ({ checked, onChange }) => (
  <button
    type="button"
    onClick={onChange}
    className={`w-4 h-4 rounded border flex items-center justify-center transition ${checked ? 'bg-blue-600 border-blue-600' : 'bg-[#181a1f] border-[#3b3e48] hover:border-slate-400'}`}
  >
    {checked && <span className="w-2 h-2 bg-white rounded-sm" />}
  </button>
);

export default function GroupsPage() {
  const [groups, setGroups] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [activeGroupId, setActiveGroupId] = useState('all'); // 'all' | 'ungrouped' | number
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // Group create/edit inline state
  const [isAddingGroup, setIsAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState(GROUP_COLORS[0]);
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupColor, setEditGroupColor] = useState(GROUP_COLORS[0]);

  // Per-row tag input
  const [tagEditFor, setTagEditFor] = useState(null);
  const [tagInput, setTagInput] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [g, p] = await Promise.all([softglazeApi.groups.list(), softglazeApi.profiles.list({})]);
      setGroups(g);
      setProfiles(p);
    } catch (err) {
      setError(err.message || 'Failed to load groups.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // --- DERIVED (computed live from profiles so the UI reacts instantly) ---
  const groupMeta = useMemo(() => {
    const counts = new Map();
    const tags = new Map();
    for (const p of profiles) {
      if (p.groupId == null) continue;
      counts.set(p.groupId, (counts.get(p.groupId) || 0) + 1);
      if (!tags.has(p.groupId)) tags.set(p.groupId, new Set());
      (p.tags || []).forEach((t) => tags.get(p.groupId).add(t));
    }
    return { counts, tags };
  }, [profiles]);

  const allTags = useMemo(() => {
    const set = new Set();
    profiles.forEach((p) => (p.tags || []).forEach((t) => set.add(t)));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [profiles]);

  const ungroupedCount = useMemo(() => profiles.filter((p) => p.groupId == null).length, [profiles]);
  const activeGroup = groups.find((g) => g.id === activeGroupId);

  const filteredProfiles = useMemo(() => {
    let list = profiles;
    if (activeGroupId === 'ungrouped') list = list.filter((p) => p.groupId == null);
    else if (activeGroupId !== 'all') list = list.filter((p) => p.groupId === activeGroupId);
    if (activeTag) list = list.filter((p) => (p.tags || []).includes(activeTag));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => (p.title || '').toLowerCase().includes(q));
    }
    return list;
  }, [profiles, activeGroupId, activeTag, search]);

  // --- SELECTION ---
  const allSelected = filteredProfiles.length > 0 && selectedIds.size === filteredProfiles.length;
  const toggleSelect = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleSelectAll = () => setSelectedIds((prev) => (prev.size === filteredProfiles.length ? new Set() : new Set(filteredProfiles.map((p) => p.id))));
  const clearSelection = () => setSelectedIds(new Set());

  // --- GROUP CRUD ---
  const handleAddGroup = async (e) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    setBusy(true); setError('');
    try {
      await softglazeApi.groups.create({ name: newGroupName.trim(), color: newGroupColor });
      setNewGroupName(''); setNewGroupColor(GROUP_COLORS[0]); setIsAddingGroup(false);
      await loadAll();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const handleUpdateGroup = async (e, id) => {
    e.preventDefault();
    if (!editGroupName.trim()) return;
    setBusy(true); setError('');
    try {
      await softglazeApi.groups.update({ id, name: editGroupName.trim(), color: editGroupColor });
      setEditingGroupId(null); setEditGroupName('');
      await loadAll();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const handleDeleteGroup = async (id, name) => {
    if (!window.confirm(`Delete group "${name}"? Its profiles will become Ungrouped (the profiles themselves are not deleted).`)) return;
    setBusy(true); setError('');
    try {
      await softglazeApi.groups.delete(id);
      if (activeGroupId === id) setActiveGroupId('all');
      await loadAll();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  // --- ASSIGNMENT ---
  const handleAssign = async (ids, groupId) => {
    setBusy(true); setError('');
    try {
      await softglazeApi.groups.assign(ids, groupId === '' ? null : groupId);
      await loadAll();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const handleBulkMove = async (val) => {
    if (selectedIds.size === 0 || !val) return;
    const groupId = val === '__ungroup' ? null : Number(val);
    await handleAssign([...selectedIds], groupId);
    clearSelection();
  };

  // --- TAGS ---
  const commitTags = async (profile, nextTags) => {
    setBusy(true); setError('');
    try {
      await softglazeApi.profiles.update({ id: profile.id, tags: nextTags });
      await loadAll();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const handleAddTag = async (profile) => {
    const t = tagInput.trim();
    setTagEditFor(null); setTagInput('');
    if (!t) return;
    if ((profile.tags || []).includes(t)) return;
    await commitTags(profile, [...(profile.tags || []), t]);
  };

  const handleRemoveTag = async (profile, tag) => {
    await commitTags(profile, (profile.tags || []).filter((x) => x !== tag));
  };

  const headerTitle = activeGroupId === 'all'
    ? 'All Profiles'
    : activeGroupId === 'ungrouped'
      ? 'Ungrouped'
      : (activeGroup?.name || 'Group');

  return (
    <>
      <PageHeader
        eyebrow="Organization"
        title="Groups & Tags"
        description="Organize profiles into groups and label them with tags."
      />

      {error && <div className="mb-4 rounded-lg border border-red-900/70 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>}

      <div className="flex flex-col md:flex-row gap-6 h-[calc(100vh-160px)]">

        {/* LEFT SIDEBAR */}
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

            <button
              onClick={() => setActiveGroupId('ungrouped')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md transition ${activeGroupId === 'ungrouped' ? 'bg-blue-600/10 text-blue-400 font-medium' : 'text-[#d1d5db] hover:bg-[#24272e]'}`}
            >
              <div className="flex items-center gap-3">
                <Folder className="w-4 h-4 text-slate-500" />
                <span className="text-[13px]">Ungrouped</span>
              </div>
              <span className="text-[11px] bg-[#2a2d35] px-2 py-0.5 rounded text-[#9ca3af]">{ungroupedCount}</span>
            </button>

            <div className="my-2 border-t border-[#2d3039]"></div>

            {isAddingGroup && (
              <form onSubmit={handleAddGroup} className="mb-2 px-2 py-2 bg-[#24272e] rounded-md border border-blue-500/50 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: newGroupColor }} />
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
                </div>
                <div className="flex items-center gap-1.5 pl-5">
                  {GROUP_COLORS.map((c) => (
                    <button key={c} type="button" onClick={() => setNewGroupColor(c)} className={`w-4 h-4 rounded-full transition ${newGroupColor === c ? 'ring-2 ring-offset-1 ring-offset-[#24272e] ring-white' : ''}`} style={{ backgroundColor: c }} />
                  ))}
                </div>
              </form>
            )}

            {groups.map((group) => {
              const isEditing = editingGroupId === group.id;
              const isActive = activeGroupId === group.id;
              const count = groupMeta.counts.get(group.id) || 0;
              const tags = [...(groupMeta.tags.get(group.id) || [])];

              if (isEditing) {
                return (
                  <form key={group.id} onSubmit={(e) => handleUpdateGroup(e, group.id)} className="px-2 py-2 bg-[#24272e] rounded-md border border-blue-500/50 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: editGroupColor }} />
                      <input
                        autoFocus
                        type="text"
                        value={editGroupName}
                        onChange={(e) => setEditGroupName(e.target.value)}
                        className="bg-transparent border-none outline-none text-white text-[13px] w-full"
                      />
                      <button type="submit" className="text-emerald-400"><Check className="w-4 h-4" /></button>
                      <button type="button" onClick={() => setEditingGroupId(null)} className="text-slate-400"><X className="w-4 h-4" /></button>
                    </div>
                    <div className="flex items-center gap-1.5 pl-5">
                      {GROUP_COLORS.map((c) => (
                        <button key={c} type="button" onClick={() => setEditGroupColor(c)} className={`w-4 h-4 rounded-full transition ${editGroupColor === c ? 'ring-2 ring-offset-1 ring-offset-[#24272e] ring-white' : ''}`} style={{ backgroundColor: c }} />
                      ))}
                    </div>
                  </form>
                );
              }

              return (
                <div key={group.id} className={`group rounded-md transition cursor-pointer ${isActive ? 'bg-blue-600/10' : 'hover:bg-[#24272e]'}`}>
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <div className="flex items-center gap-3 flex-1 overflow-hidden" onClick={() => setActiveGroupId(group.id)}>
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: group.color || '#3b82f6' }} />
                      <span className={`text-[13px] truncate ${isActive ? 'text-blue-400 font-medium' : 'text-[#d1d5db]'}`}>{group.name}</span>
                    </div>
                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingGroupId(group.id); setEditGroupName(group.name); setEditGroupColor(group.color || GROUP_COLORS[0]); setIsAddingGroup(false); }}
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
                    <span className={`text-[11px] bg-[#2a2d35] px-2 py-0.5 rounded text-[#9ca3af] group-hover:hidden ${isActive ? 'bg-blue-900/40 text-blue-300' : ''}`}>{count}</span>
                  </div>
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 px-3 pb-2 pl-8">
                      {tags.slice(0, 4).map((t) => (
                        <span key={t} className="inline-flex items-center gap-1 text-[10px] bg-[#2a2d35] text-[#9ca3af] px-1.5 py-0.5 rounded">
                          <TagIcon className="w-2.5 h-2.5" />{t}
                        </span>
                      ))}
                      {tags.length > 4 && <span className="text-[10px] text-[#9ca3af]">+{tags.length - 4}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {/* RIGHT AREA */}
        <Card className="flex-1 flex flex-col bg-[#1e2025] border-[#2d3039] overflow-hidden">
          <div className="p-4 border-b border-[#2d3039] flex flex-col gap-3 bg-[#24272e]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <h2 className="text-white font-medium flex items-center gap-2">
                {headerTitle}
                <span className="text-xs bg-[#3b3e48] text-[#d1d5db] px-2 py-0.5 rounded-full">{filteredProfiles.length}</span>
              </h2>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
                <input
                  type="text"
                  placeholder="Search profiles..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="bg-[#181a1f] border border-[#3b3e48] rounded-md pl-9 pr-3 py-2 text-[13px] text-white outline-none focus:border-blue-500 w-full sm:w-64 transition"
                />
              </div>
            </div>

            {/* Tag filter bar */}
            {allTags.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-[#9ca3af] flex items-center gap-1"><TagIcon className="w-3 h-3" /> Tags:</span>
                {allTags.map((t) => (
                  <button
                    key={t}
                    onClick={() => setActiveTag(activeTag === t ? null : t)}
                    className={`text-[11px] px-2 py-0.5 rounded-full border transition ${activeTag === t ? 'bg-blue-600 border-blue-600 text-white' : 'bg-[#181a1f] border-[#3b3e48] text-[#9ca3af] hover:border-slate-400'}`}
                  >
                    {t}
                  </button>
                ))}
                {activeTag && (
                  <button onClick={() => setActiveTag(null)} className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1"><X className="w-3 h-3" /> clear</button>
                )}
              </div>
            )}
          </div>

          {/* Bulk move toolbar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[#2d3039] bg-[#1e2025]">
              <span className="text-[13px] text-white font-medium">{selectedIds.size} selected</span>
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-[12px] text-[#9ca3af]">Move to:</span>
                <select
                  disabled={busy}
                  defaultValue=""
                  onChange={(e) => { handleBulkMove(e.target.value); e.target.value = ''; }}
                  className="bg-[#181a1f] border border-[#3b3e48] rounded-md px-2 py-1.5 text-[12px] text-white outline-none focus:border-blue-500"
                >
                  <option value="" disabled>Choose group…</option>
                  <option value="__ungroup">Ungrouped</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <Button size="sm" variant="outline" disabled={busy} onClick={clearSelection} className="bg-[#181a1f] border-[#3b3e48] text-white">Clear</Button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center p-16"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
            ) : (
              <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
                <thead className="bg-[#181a1f] text-[#9ca3af] sticky top-0 z-10 shadow-sm border-b border-[#2d3039]">
                  <tr>
                    <th className="px-5 py-3 font-medium w-10"><Checkbox checked={allSelected} onChange={toggleSelectAll} /></th>
                    <th className="px-5 py-3 font-medium">Profile Name</th>
                    <th className="px-5 py-3 font-medium">Group</th>
                    <th className="px-5 py-3 font-medium">Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProfiles.length === 0 ? (
                    <tr>
                      <td colSpan="4" className="p-12">
                        <EmptyState
                          title="No profiles found"
                          description={search || activeTag ? 'No profiles match your filters.' : 'This group is empty. Move profiles here using the Group dropdown.'}
                        />
                      </td>
                    </tr>
                  ) : (
                    filteredProfiles.map((p) => (
                      <tr key={p.id} className="border-b border-[#2d3039] hover:bg-[#24272e] transition bg-[#1e2025] align-top">
                        <td className="px-5 py-3"><Checkbox checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} /></td>
                        <td className="px-5 py-3 font-medium text-white">{p.title}</td>
                        <td className="px-5 py-3">
                          <select
                            disabled={busy}
                            value={p.groupId ?? ''}
                            onChange={(e) => handleAssign([p.id], e.target.value === '' ? null : Number(e.target.value))}
                            className="bg-[#181a1f] border border-[#3b3e48] rounded-md px-2 py-1.5 text-[12px] text-white outline-none focus:border-blue-500 max-w-[160px]"
                          >
                            <option value="">Ungrouped</option>
                            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                          </select>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {(p.tags || []).map((t) => (
                              <span key={t} className="inline-flex items-center gap-1 text-[11px] bg-[#2a2d35] text-[#d1d5db] px-2 py-0.5 rounded">
                                {t}
                                <button onClick={() => handleRemoveTag(p, t)} className="text-slate-500 hover:text-red-400" title="Remove tag"><X className="w-3 h-3" /></button>
                              </span>
                            ))}
                            {tagEditFor === p.id ? (
                              <input
                                autoFocus
                                type="text"
                                value={tagInput}
                                onChange={(e) => setTagInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleAddTag(p); if (e.key === 'Escape') { setTagEditFor(null); setTagInput(''); } }}
                                onBlur={() => handleAddTag(p)}
                                placeholder="tag + Enter"
                                className="bg-[#181a1f] border border-blue-500/60 rounded px-2 py-0.5 text-[11px] text-white outline-none w-24"
                              />
                            ) : (
                              <button
                                onClick={() => { setTagEditFor(p.id); setTagInput(''); }}
                                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-blue-400 border border-dashed border-[#3b3e48] hover:border-blue-500/60 rounded px-2 py-0.5 transition"
                              >
                                <Plus className="w-3 h-3" /> tag
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}