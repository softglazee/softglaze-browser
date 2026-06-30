import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, Undo2, AlertTriangle, Search, ArchiveX, Loader2 } from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card, CardContent } from '@/components/ui/Card.jsx';
import EmptyState from '@/components/EmptyState.jsx';
import { formatDateTime } from '@/lib/utils.js';
import { softglazeApi } from '@/lib/softglazeApi.js';
import i18n from '@/i18n/index.js';
import trashEn from '@/i18n/locales/en/trash.json';
import trashEs from '@/i18n/locales/es/trash.json';

// Register this page's "trash" namespace without touching the central i18n
// config (which only bundles the "common" namespace). addResourceBundle is a
// no-op if the bundle already exists, so this is safe across hot reloads.
if (!i18n.hasResourceBundle('en', 'trash')) i18n.addResourceBundle('en', 'trash', trashEn);
if (!i18n.hasResourceBundle('es', 'trash')) i18n.addResourceBundle('es', 'trash', trashEs);

// --- HELPER COMPONENT FOR CUSTOM CHECKBOX ---
const Checkbox = ({ checked, onChange }) => (
  <button
    type="button"
    onClick={onChange}
    className={`w-4 h-4 rounded border flex items-center justify-center transition ${checked ? 'bg-blue-600 border-blue-600' : 'bg-secondary border-border hover:border-muted-dark'}`}
  >
    {checked && <span className="w-2 h-2 bg-white rounded-sm" />}
  </button>
);

export default function TrashPage() {
  const { t } = useTranslation('trash');
  const [trashItems, setTrashItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [removeLocalData, setRemoveLocalData] = useState(false);

  const loadTrash = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setTrashItems(await softglazeApi.profiles.listTrash());
    } catch (err) {
      setError(err.message || t('errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTrash(); }, [loadTrash]);

  const filteredItems = useMemo(() => {
    if (!search.trim()) return trashItems;
    const q = search.toLowerCase();
    return trashItems.filter((item) => (item.title || '').toLowerCase().includes(q));
  }, [trashItems, search]);

  const allSelected = filteredItems.length > 0 && selectedIds.size === filteredItems.length;

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelectedIds((prev) => (prev.size === filteredItems.length ? new Set() : new Set(filteredItems.map((i) => i.id))));
  };
  const clearSelection = () => setSelectedIds(new Set());

  const handleRestore = async (id) => {
    setBusy(true); setError('');
    try { await softglazeApi.profiles.restore(id); await loadTrash(); clearSelection(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const handlePurge = async (id, title) => {
    if (!window.confirm(t(removeLocalData ? 'confirm.purgeWithData' : 'confirm.purge', { title }))) return;
    setBusy(true); setError('');
    try { await softglazeApi.profiles.purge(id, { removeLocalData }); await loadTrash(); clearSelection(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const handleBulkRestore = async () => {
    if (selectedIds.size === 0) return;
    setBusy(true); setError('');
    try { await softglazeApi.profiles.bulkRestore([...selectedIds]); await loadTrash(); clearSelection(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const handleBulkPurge = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(t(removeLocalData ? 'confirm.bulkPurgeWithData' : 'confirm.bulkPurge', { count: selectedIds.size }))) return;
    setBusy(true); setError('');
    try { await softglazeApi.profiles.bulkPurge([...selectedIds], { removeLocalData }); await loadTrash(); clearSelection(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const handleEmptyTrash = async () => {
    if (trashItems.length === 0) return;
    if (!window.confirm(t(removeLocalData ? 'confirm.emptyTrashWithData' : 'confirm.emptyTrash', { count: trashItems.length }))) return;
    setBusy(true); setError('');
    try { await softglazeApi.profiles.bulkPurge(trashItems.map((i) => i.id), { removeLocalData }); await loadTrash(); clearSelection(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader
        eyebrow={t('header.eyebrow')}
        title={t('header.title')}
        description={t('header.description')}
        actions={
          <Button
            onClick={handleEmptyTrash}
            disabled={trashItems.length === 0 || busy}
            className="bg-red-900/30 text-red-400 hover:bg-red-900/50 hover:text-red-300 border border-red-900/50 transition-colors disabled:opacity-50"
          >
            <ArchiveX className="w-4 h-4 mr-2" />
            {t('actions.emptyTrash')}
          </Button>
        }
      />

      {error && <div className="mb-4 rounded-lg border border-red-900/70 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>}

      {/* Warning Banner */}
      <div className="mb-6 flex items-start gap-3 bg-amber-500/10 border border-amber-500/25 text-amber-600 dark:text-amber-400 p-4 rounded-lg">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
        <div className="text-[13px] leading-relaxed">
          <p className="font-semibold mb-1">{t('warning.title')}</p>
          <p className="opacity-80">
            {t('warning.body')}
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder={t('toolbar.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-secondary border border-border rounded-md pl-9 pr-3 py-2 text-[13px] text-foreground outline-none focus:border-blue-500 transition"
          />
        </div>
        <label className="flex items-center gap-2 text-[12px] text-muted-foreground cursor-pointer select-none">
          <Checkbox checked={removeLocalData} onChange={() => setRemoveLocalData((v) => !v)} />
          {t('toolbar.eraseLocalData')}
        </label>
      </div>

      {/* Bulk toolbar */}
      {selectedIds.size > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <span className="text-[13px] text-foreground font-medium">{t('bulk.selected', { count: selectedIds.size })}</span>
          <div className="flex gap-2 ml-auto">
            <Button size="sm" disabled={busy} onClick={handleBulkRestore} className="bg-secondary hover:bg-secondary text-foreground border border-border">
              <Undo2 className="w-3.5 h-3.5 mr-1.5" /> {t('actions.restore')}
            </Button>
            <Button size="sm" disabled={busy} onClick={handleBulkPurge} className="bg-red-900/30 text-red-400 hover:bg-red-900/50 border border-red-900/50">
              <Trash2 className="w-3.5 h-3.5 mr-1.5" /> {t('actions.deleteForever')}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={clearSelection} className="bg-secondary border-border text-foreground">{t('actions.clear')}</Button>
          </div>
        </div>
      )}

      {/* Data Table */}
      <Card>
        <CardContent className="p-0">
          <div className="w-full overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center p-16"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
            ) : (
              <table className="w-full min-w-[800px] border-collapse text-left text-[13px]">
                <thead className="border-b border-border bg-secondary text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 w-10"><Checkbox checked={allSelected} onChange={toggleSelectAll} /></th>
                    <th className="px-5 py-3 font-medium">{t('table.profileName')}</th>
                    <th className="px-5 py-3 font-medium">{t('table.proxy')}</th>
                    <th className="px-5 py-3 font-medium">{t('table.deletedDate')}</th>
                    <th className="px-5 py-3 font-medium text-right">{t('table.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="p-12">
                        <EmptyState
                          title={t('empty.title')}
                          description={search ? t('empty.noMatch') : t('empty.none')}
                          icon={<Trash2 className="w-12 h-12 text-muted-foreground" />}
                        />
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item) => (
                      <tr key={item.id} className="border-b border-border hover:bg-secondary transition bg-card">
                        <td className="px-5 py-4"><Checkbox checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)} /></td>
                        <td className="px-5 py-4">
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">{item.title}</span>
                            <span className="text-[11px] text-muted-foreground mt-0.5">{item.os || item.browserCore || t('table.defaultBrowser')}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-muted-foreground">
                          <span className="bg-secondary px-2 py-1 rounded text-[11px] font-mono">
                            {item.proxyInfoString ? item.proxyInfoString.split(':')[0] : t('table.directProxy')}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-muted-foreground">{formatDateTime(item.deletedAt)}</td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() => handleRestore(item.id)}
                              className="bg-secondary hover:bg-secondary text-foreground border border-border"
                              title={t('actions.restoreTitle')}
                            >
                              <Undo2 className="w-3.5 h-3.5 mr-1.5" />
                              {t('actions.restore')}
                            </Button>
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() => handlePurge(item.id, item.title)}
                              className="bg-transparent hover:bg-red-900/30 text-muted-foreground hover:text-red-400 border border-transparent hover:border-red-900/50 transition"
                              title={t('actions.purgeTitle')}
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
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}