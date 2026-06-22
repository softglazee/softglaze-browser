import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Folder, FolderOpen, Plus, Edit2, Trash2,
  Search, Monitor, Check, X, Tag as TagIcon, Loader2, ChevronDown
} from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card, CardContent } from '@/components/ui/Card.jsx';
import EmptyState from '@/components/EmptyState.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

const GROUP_COLORS = ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];

// --- CUSTOM STYLED SELECT DROPDOWN (Max 4px rounded) ---
const CustomSelect = ({ value, onChange, className = '', children, disabled }) => (
  <div className={`relative flex items-center ${className}`}>
    <select
      value={value}
      onChange={onChange}
      disabled={disabled}
      className="w-full appearance-none bg-background border border-border rounded pl-3 pr-8 py-1.5 text-foreground text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary transition disabled:opacity-50 text-ellipsis overflow-hidden whitespace-nowrap cursor-pointer hover:border-muted-dark shadow-sm"
    >
      {children}
    </select>
    <div className="absolute right-2.5 pointer-events-none text-muted">
      <ChevronDown className="w-3.5 h-3.5" />
    </div>
  </div>
);

// Small reusable checkbox styled like the rest of the app
const Checkbox = ({ checked, onChange }) => (
  <button
    type="button"
    onClick={onChange}
    className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${checked ? 'bg-primary border-primary shadow-glow' : 'bg-background border-border hover:border-muted-dark'}`}
  >
    {checked && <span className="w-2 h-2 bg-white rounded-[2px]" />}
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
    <div className="flex flex-col h-full space-y-4 pb-10">
      <PageHeader
        eyebrow="Organization"
        title="Groups & Tags"
        description="Organize profiles into groups and label them with tags for rapid filtering."
      />

      {error && <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}

      <div className="flex flex-col md:flex-row gap-6 flex-1 min-h-0">

        {/* LEFT SIDEBAR (Groups) */}
        <Card className="w-full md:w-72 shrink-0 flex flex-col bg-surface border-border shadow-sm rounded">
          <div className="p-4 border-b border-border bg-card/50 flex justify-between items-center rounded-t">
            <h2 className="text-foreground font-semibold text-sm uppercase tracking-wider">Directories</h2>
            <button
              onClick={() => { setIsAddingGroup(true); setEditingGroupId(null); }}
              className="p-1 hover:bg-muted-dark rounded text-primary hover:text-primary-hover transition"
              title="Create new group"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            <button
              onClick={() => setActiveGroupId('all')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded transition-all ${activeGroupId === 'all' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-card hover:text-foreground'}`}
            >
              <div className="flex items-center gap-3">
                <Monitor className={`w-4 h-4 ${activeGroupId === 'all' ? 'text-primary' : 'text-muted'}`} />
                <span className="text-sm">All Profiles</span>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded font-mono ${activeGroupId === 'all' ? 'bg-primary/20 text-primary' : 'bg-background border border-border text-muted'}`}>{profiles.length}</span>
            </button>

            <button
              onClick={() => setActiveGroupId('ungrouped')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded transition-all ${activeGroupId === 'ungrouped' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-card hover:text-foreground'}`}
            >
              <div className="flex items-center gap-3">
                <Folder className={`w-4 h-4 ${activeGroupId === 'ungrouped' ? 'text-primary' : 'text-muted'}`} />
                <span className="text-sm">Ungrouped</span>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded font-mono ${activeGroupId === 'ungrouped' ? 'bg-primary/20 text-primary' : 'bg-background border border-border text-muted'}`}>{ungroupedCount}</span>
            </button>

            <div className="my-3 border-t border-border"></div>

            {/* Inline Add Group Form */}
            {isAddingGroup && (
              <form onSubmit={handleAddGroup} className="mb-2 px-3 py-3 bg-background rounded border border-primary/50 space-y-3 shadow-inner">
                <div className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: newGroupColor }} />
                  <input
                    autoFocus
                    type="text"
                    placeholder="Group name..."
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    className="bg-transparent border-none outline-none text-foreground text-sm w-full placeholder:text-muted"
                  />
                  <button type="submit" className="text-emerald-400 hover:text-emerald-300"><Check className="w-4 h-4" /></button>
                  <button type="button" onClick={() => setIsAddingGroup(false)} className="text-muted hover:text-red-400"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex items-center gap-2 pl-6">
                  {GROUP_COLORS.map((c) => (
                    <button key={c} type="button" onClick={() => setNewGroupColor(c)} className={`w-3.5 h-3.5 rounded-full transition-transform hover:scale-110 ${newGroupColor === c ? 'ring-2 ring-offset-2 ring-offset-background ring-primary' : ''}`} style={{ backgroundColor: c }} />
                  ))}
                </div>
              </form>
            )}

            {/* Render Groups */}
            {groups.map((group) => {
              const isEditing = editingGroupId === group.id;
              const isActive = activeGroupId === group.id;
              const count = groupMeta.counts.get(group.id) || 0;
              const tags = [...(groupMeta.tags.get(group.id) || [])];

              if (isEditing) {
                return (
                  <form key={group.id} onSubmit={(e) => handleUpdateGroup(e, group.id)} className="mb-2 px-3 py-3 bg-background rounded border border-primary/50 space-y-3 shadow-inner">
                    <div className="flex items-center gap-3">
                      <span className="w-3 h-3 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: editGroupColor }} />
                      <input
                        autoFocus
                        type="text"
                        value={editGroupName}
                        onChange={(e) => setEditGroupName(e.target.value)}
                        className="bg-transparent border-none outline-none text-foreground text-sm w-full"
                      />
                      <button type="submit" className="text-emerald-400"><Check className="w-4 h-4" /></button>
                      <button type="button" onClick={() => setEditingGroupId(null)} className="text-muted"><X className="w-4 h-4" /></button>
                    </div>
                    <div className="flex items-center gap-2 pl-6">
                      {GROUP_COLORS.map((c) => (
                        <button key={c} type="button" onClick={() => setEditGroupColor(c)} className={`w-3.5 h-3.5 rounded-full transition-transform hover:scale-110 ${editGroupColor === c ? 'ring-2 ring-offset-2 ring-offset-background ring-primary' : ''}`} style={{ backgroundColor: c }} />
                      ))}
                    </div>
                  </form>
                );
              }

              return (
                <div key={group.id} className={`group rounded transition-colors cursor-pointer ${isActive ? 'bg-primary/10' : 'hover:bg-card'}`}>
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <div className="flex items-center gap-3 flex-1 overflow-hidden" onClick={() => setActiveGroupId(group.id)}>
                      <span className="w-3 h-3 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: group.color || '#3b82f6' }} />
                      <span className={`text-sm truncate ${isActive ? 'text-primary font-medium' : 'text-muted-foreground'}`}>{group.name}</span>
                    </div>
                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingGroupId(group.id); setEditGroupName(group.name); setEditGroupColor(group.color || GROUP_COLORS[0]); setIsAddingGroup(false); }}
                        className="p-1.5 hover:bg-muted-dark rounded text-muted hover:text-foreground transition"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteGroup(group.id, group.name); }}
                        className="p-1.5 hover:bg-red-500/20 rounded text-muted hover:text-red-400 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded font-mono group-hover:hidden ${isActive ? 'bg-primary/20 text-primary' : 'bg-background border border-border text-muted'}`}>{count}</span>
                  </div>
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 px-3 pb-3 pl-9">
                      {tags.slice(0, 4).map((t) => (
                        <span key={t} className="inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider bg-background border border-border text-muted px-1.5 py-0.5 rounded">
                          <TagIcon className="w-2.5 h-2.5" />{t}
                        </span>
                      ))}
                      {tags.length > 4 && <span className="text-[10px] text-muted font-medium bg-background border border-border px-1.5 py-0.5 rounded">+{tags.length - 4}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {/* RIGHT AREA (Profiles Data Table) */}
        <Card className="flex-1 flex flex-col bg-surface border-border overflow-hidden shadow-sm rounded">
          <div className="p-5 border-b border-border flex flex-col gap-4 bg-card/50">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <h2 className="text-foreground font-bold tracking-tight text-lg flex items-center gap-3">
                {headerTitle}
                <span className="text-xs bg-background border border-border text-muted px-2.5 py-0.5 rounded-full font-mono">{filteredProfiles.length}</span>
              </h2>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  placeholder="Search profiles..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="bg-background border border-border rounded pl-9 pr-3 py-2 text-sm text-foreground outline-none focus:border-primary w-full sm:w-64 transition shadow-sm"
                />
              </div>
            </div>

            {/* Tag filter bar */}
            {allTags.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-xs text-muted font-medium uppercase tracking-wider flex items-center gap-1.5 mr-1"><TagIcon className="w-3 h-3" /> Filters</span>
                {allTags.map((t) => (
                  <button
                    key={t}
                    onClick={() => setActiveTag(activeTag === t ? null : t)}
                    className={`text-xs px-2.5 py-1 rounded border transition ${activeTag === t ? 'bg-primary border-primary text-white shadow-glow' : 'bg-background border-border text-muted hover:border-muted-dark hover:text-foreground'}`}
                  >
                    {t}
                  </button>
                ))}
                {activeTag && (
                  <button onClick={() => setActiveTag(null)} className="text-xs text-muted hover:text-foreground flex items-center gap-1 ml-1"><X className="w-3 h-3" /> clear</button>
                )}
              </div>
            )}
          </div>

          {/* Bulk move toolbar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-primary/5 shadow-inner transition-all animate-in fade-in slide-in-from-top-2">
              <span className="text-sm text-primary font-bold">{selectedIds.size} selected</span>
              <div className="flex items-center gap-3 ml-auto">
                <span className="text-xs text-muted font-medium uppercase tracking-wider">Move to:</span>
                <CustomSelect
                  disabled={busy}
                  value=""
                  onChange={(e) => { handleBulkMove(e.target.value); }}
                  className="w-40"
                >
                  <option value="" disabled>Choose group…</option>
                  <option value="__ungroup">Ungrouped</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </CustomSelect>
                <Button size="sm" variant="ghost" disabled={busy} onClick={clearSelection}>Clear</Button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-x-auto">
            {loading ? (
              <div className="flex flex-col items-center justify-center p-16 gap-3 text-muted">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <span className="text-sm font-medium">Loading groups...</span>
              </div>
            ) : (
              <table className="w-full min-w-[760px] border-collapse text-left text-sm whitespace-nowrap">
                <thead className="bg-surface text-muted text-xs uppercase tracking-wider font-semibold sticky top-0 z-10 shadow-sm border-b border-border">
                  <tr>
                    <th className="px-5 py-3.5 w-10 text-center"><Checkbox checked={allSelected} onChange={toggleSelectAll} /></th>
                    <th className="px-5 py-3.5">Profile Name</th>
                    <th className="px-5 py-3.5">Group Assignment</th>
                    <th className="px-5 py-3.5">Tags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
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
                      <tr key={p.id} className="hover:bg-card/50 transition-colors bg-background align-top group">
                        <td className="px-5 py-4 text-center">
                          <Checkbox checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} />
                        </td>
                        <td className="px-5 py-4 font-medium text-foreground">{p.title}</td>
                        <td className="px-5 py-4">
                          <CustomSelect
                            disabled={busy}
                            value={p.groupId ?? ''}
                            onChange={(e) => handleAssign([p.id], e.target.value === '' ? null : Number(e.target.value))}
                            className="w-[160px]"
                          >
                            <option value="">Ungrouped</option>
                            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                          </CustomSelect>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            {(p.tags || []).map((t) => (
                              <span key={t} className="inline-flex items-center gap-1.5 text-[11px] font-medium bg-surface border border-border text-muted-foreground px-2 py-1 rounded shadow-sm">
                                {t}
                                <button onClick={() => handleRemoveTag(p, t)} className="text-muted hover:text-red-400 transition-colors" title="Remove tag"><X className="w-3 h-3" /></button>
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
                                className="bg-surface border border-primary rounded px-2 py-1 text-xs text-foreground outline-none w-28 shadow-glow transition-all"
                              />
                            ) : (
                              <button
                                onClick={() => { setTagEditFor(p.id); setTagInput(''); }}
                                className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-primary border border-dashed border-border hover:border-primary/50 rounded px-2 py-1 transition bg-surface"
                              >
                                <Plus className="w-3 h-3" /> Add Tag
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
    </div>
  );
}