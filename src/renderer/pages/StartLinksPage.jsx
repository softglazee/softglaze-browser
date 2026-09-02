import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, Check, Loader2, Wand2, ClipboardList } from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card, CardContent } from '@/components/ui/Card.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

// Normalize a user-typed URL to an http(s) URL (prepend https:// if no scheme).
// Returns '' if it isn't http/https after normalizing.
function normalizeUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'https://' + u;
  if (!/^https?:\/\//i.test(u)) return '';
  return u;
}
// Auto-label from a URL's domain, e.g. "https://whoer.net/" -> "Whoer".
function labelFromUrl(raw) {
  const u = normalizeUrl(raw);
  if (!u) return '';
  try {
    const h = new URL(u).hostname.replace(/^www\./, '');
    const parts = h.split('.');
    const name = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : h;
  } catch (e) { return ''; }
}

// Manage the global custom links shown on every profile's browser start page,
// stored in globalSettings.startPageLinks as [{ label, url }].
export default function StartLinksPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [bulk, setBulk] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const [dirty, setDirty] = useState(false);

  const toItems = (v) => (Array.isArray(v) ? v : []).map((l) => ({ label: (l && l.label) || '', url: (l && l.url) || '' }));

  useEffect(() => {
    let live = true;
    softglazeApi.settings.getGlobal()
      .then((cfg) => { if (live) setItems(toItems(cfg && cfg.startPageLinks)); })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const markDirty = () => { setDirty(true); setSaved(false); };
  const add = () => { setItems((p) => [...p, { label: '', url: '' }]); markDirty(); };
  const removeAt = (i) => { setItems((p) => p.filter((_, idx) => idx !== i)); markDirty(); };
  const update = (i, key, val) => { setItems((p) => p.map((it, idx) => (idx === i ? { ...it, [key]: val } : it))); markDirty(); };

  // Bulk add: one URL per line (also splits on commas). Auto-labels each and skips
  // duplicates and non-http(s) entries.
  const bulkAdd = () => {
    const urls = bulk.split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (!urls.length) return;
    const existing = new Set(items.map((it) => normalizeUrl(it.url)).filter(Boolean));
    const added = [];
    let skipped = 0;
    for (const raw of urls) {
      const u = normalizeUrl(raw);
      if (!u) { skipped++; continue; }
      if (existing.has(u)) { skipped++; continue; }
      existing.add(u);
      added.push({ label: labelFromUrl(u), url: u });
    }
    if (added.length) { setItems((p) => [...p, ...added]); setBulk(''); markDirty(); }
    setErr(skipped ? `Added ${added.length}, skipped ${skipped} (duplicate or not http/https).` : '');
  };

  const autoLabelAll = () => {
    setItems((p) => p.map((it) => ({ ...it, label: it.label.trim() || labelFromUrl(it.url) })));
    markDirty();
  };

  const save = async () => {
    setSaving(true); setErr(''); setSaved(false);
    const clean = items
      .map((it) => ({ label: (String(it.label || '').trim() || labelFromUrl(it.url)).slice(0, 60), url: normalizeUrl(it.url) }))
      .filter((it) => it.url);
    try {
      await softglazeApi.settings.setGlobal({ startPageLinks: clean });
      setItems(clean); setDirty(false);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e) { setErr((e && e.message) || 'Could not save.'); }
    finally { setSaving(false); }
  };

  const validCount = useMemo(() => items.filter((it) => normalizeUrl(it.url)).length, [items]);
  const inputCls = 'bg-input-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary transition';

  return (
    <div className="p-7">
      <PageHeader
        eyebrow={t('nav.sectionWorkspace', { defaultValue: 'Workspace' })}
        title={t('startLinks.title', { defaultValue: 'Start Page Links' })}
        description={t('startLinks.desc', { defaultValue: "Links shown on every profile's browser start page, next to the built-in check-links. Each opens in a new tab through the profile's proxy (http/https only)." })}
        actions={(
          <div className="flex items-center gap-2">
            {saved && <span className="text-xs text-emerald-500 inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Saved</span>}
            <Button variant="primary" size="sm" onClick={save} disabled={saving || !dirty}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Check className="w-4 h-4 mr-1" />} Save
            </Button>
          </div>
        )}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
        {/* Editable list */}
        <Card className="bg-card border border-border rounded-xl">
          <CardContent className="p-0">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Links <span className="text-muted-foreground font-normal">· {validCount}</span></h3>
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" onClick={autoLabelAll} disabled={items.length === 0} title="Fill any empty label from its URL"><Wand2 className="w-3.5 h-3.5 mr-1" /> Auto-label</Button>
                <Button variant="ghost" size="sm" onClick={add}><Plus className="w-3.5 h-3.5 mr-1" /> Add</Button>
              </div>
            </div>
            <div className="p-4 space-y-2 max-h-[54vh] overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-8"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
              ) : items.length === 0 ? (
                <div className="text-center py-12 text-sm text-muted-foreground">No links yet. Use <span className="text-foreground font-medium">Bulk add</span> on the right, or <span className="text-foreground font-medium">Add</span>.</div>
              ) : items.map((it, i) => {
                const bad = it.url.trim() && !normalizeUrl(it.url);
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="shrink-0 w-6 text-center text-[11px] text-muted-foreground tabular-nums">{i + 1}</span>
                    <input className={`${inputCls} w-44 shrink-0`} placeholder="Label" value={it.label} onChange={(e) => update(i, 'label', e.target.value)} />
                    <input
                      className={`${inputCls} flex-1 min-w-0 ${bad ? 'border-red-500/60 focus:border-red-500' : ''}`}
                      placeholder="https://example.com"
                      value={it.url}
                      onChange={(e) => update(i, 'url', e.target.value)}
                      onBlur={() => { if (!it.label.trim() && normalizeUrl(it.url)) update(i, 'label', labelFromUrl(it.url)); }}
                    />
                    <button type="button" onClick={() => removeAt(i)} className="shrink-0 w-9 h-9 grid place-items-center rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10" title="Remove"><X className="w-4 h-4" /></button>
                  </div>
                );
              })}
            </div>
            {err && <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground">{err}</div>}
          </CardContent>
        </Card>

        {/* Bulk add */}
        <Card className="bg-card border border-border rounded-xl">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Bulk add</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">Paste multiple URLs — one per line. Each gets a label from its domain automatically; edit any label in the list. Duplicates and non-http(s) lines are skipped.</p>
            <textarea
              className={`${inputCls} w-full h-44 font-mono text-xs resize-y leading-relaxed`}
              placeholder={"whoer.net\nbrowserleaks.com\nhttps://pixelscan.net"}
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
            />
            <div className="flex items-center gap-3">
              <Button variant="primary" size="sm" onClick={bulkAdd} disabled={!bulk.trim()}><Plus className="w-3.5 h-3.5 mr-1" /> Add all</Button>
              {bulk.trim() && <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setBulk('')}>Clear</button>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
