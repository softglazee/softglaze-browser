import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, Check, Loader2 } from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card, CardContent } from '@/components/ui/Card.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

// Manage the global custom links shown on every profile's browser start page
// (next to the built-in whoer/browserleaks check-links). Stored in
// globalSettings.startPageLinks as [{ label, url }]. Edited locally, saved on the
// button (not per-keystroke). Rendering into the start page (http(s)-only + escaped)
// happens server-side in browserEngine.generateStartPage.
export default function StartLinksPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  const toItems = (v) => (Array.isArray(v) ? v : []).map((l) => ({ label: (l && l.label) || '', url: (l && l.url) || '' }));

  useEffect(() => {
    let live = true;
    softglazeApi.settings.getGlobal()
      .then((cfg) => { if (live) setItems(toItems(cfg && cfg.startPageLinks)); })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const add = () => setItems((prev) => [...prev, { label: '', url: '' }]);
  const removeAt = (i) => setItems((prev) => prev.filter((_, idx) => idx !== i));
  const update = (i, key, val) => setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [key]: val } : it)));

  const save = async () => {
    setSaving(true); setErr(''); setSaved(false);
    const clean = items
      .map((it) => ({ label: String(it.label || '').trim().slice(0, 60), url: String(it.url || '').trim() }))
      .filter((it) => it.url);
    try {
      await softglazeApi.settings.setGlobal({ startPageLinks: clean });
      setItems(clean);
      setSaved(true); setTimeout(() => setSaved(false), 1800);
    } catch (e) { setErr((e && e.message) || 'Could not save.'); }
    finally { setSaving(false); }
  };

  const inputCls = 'bg-input-background border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary transition';

  return (
    <div className="p-7">
      <PageHeader
        eyebrow={t('nav.sectionWorkspace', { defaultValue: 'Workspace' })}
        title={t('startLinks.title', { defaultValue: 'Start Page Links' })}
        description={t('startLinks.desc', { defaultValue: "Custom links shown on every profile's browser start page, next to the built-in check-links. Each opens in a new tab through the profile's proxy (http/https only)." })}
      />
      <Card className="bg-card border border-border rounded-xl max-w-3xl">
        <CardContent className="p-5 space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : (
            <>
              {items.length === 0 && <p className="text-sm text-muted-foreground">No custom links yet — add one below.</p>}
              {items.map((it, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input className={`${inputCls} w-48`} placeholder="Label (e.g. My Dashboard)" value={it.label} onChange={(e) => update(i, 'label', e.target.value)} />
                  <input className={`${inputCls} flex-1 min-w-[240px]`} placeholder="https://example.com" value={it.url} onChange={(e) => update(i, 'url', e.target.value)} />
                  <button type="button" onClick={() => removeAt(i)} className="shrink-0 w-9 h-9 grid place-items-center rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10" title="Remove"><X className="w-4 h-4" /></button>
                </div>
              ))}
              <div className="flex items-center gap-2 pt-2">
                <Button variant="ghost" size="sm" onClick={add}><Plus className="w-3.5 h-3.5 mr-1" /> Add link</Button>
                <Button variant="primary" size="sm" onClick={save} disabled={saving}>{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save links</Button>
                {saved && <span className="text-xs text-emerald-500 inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Saved</span>}
                {err && <span className="text-xs text-red-500">{err}</span>}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
