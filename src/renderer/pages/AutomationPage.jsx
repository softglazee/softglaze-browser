import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Wand2, Bot, Flame, History, Plus, Loader2, Play, Pause, Square, X, Search,
  Trash2, Clock, CheckCircle2, Workflow, Sparkles, GripVertical, Pencil, MousePointer2,
  Layers, FileSpreadsheet, XCircle, AlertTriangle
} from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { useDialog } from '@/lib/useDialog.js';
import i18n from '@/i18n/index.js';
import automationEn from '@/i18n/locales/en/automation.json';
import automationEs from '@/i18n/locales/es/automation.json';

// Register this page's "automation" namespace without touching the central i18n
// config (which only bundles the "common" namespace). addResourceBundle is a
// no-op if the bundle already exists, so this is safe across hot reloads.
if (!i18n.hasResourceBundle('en', 'automation')) i18n.addResourceBundle('en', 'automation', automationEn);
if (!i18n.hasResourceBundle('es', 'automation')) i18n.addResourceBundle('es', 'automation', automationEs);

const TABS = [
  { key: 'macros', label: 'My Macros', icon: Workflow },
  { key: 'parallel', label: 'Parallel Runs', icon: Layers },
  { key: 'warmer', label: 'Cookie Warmer', icon: Flame },
  { key: 'history', label: 'Task History', icon: History }
];

// Suggested sites for the Cookie Warmer dropdown (users can also add custom URLs).
const PRESET_SITES = [
  { url: 'https://www.google.com/', label: 'google.com' },
  { url: 'https://www.youtube.com/', label: 'youtube.com' },
  { url: 'https://www.amazon.com/', label: 'amazon.com' },
  { url: 'https://www.wikipedia.org/', label: 'wikipedia.org' },
  { url: 'https://www.reddit.com/', label: 'reddit.com' },
  { url: 'https://www.bing.com/', label: 'bing.com' },
  { url: 'https://www.cnn.com/', label: 'cnn.com' },
  { url: 'https://www.ebay.com/', label: 'ebay.com' },
  { url: 'https://www.linkedin.com/', label: 'linkedin.com' },
  { url: 'https://weather.com/', label: 'weather.com' }
];
const CLICK_LABELS = { none: 'Just browse', random: 'Random clicks', links: 'Browse links' };

// Macro step types — the single source of truth for the editor's add-menu and the
// per-step field inputs. Mirrors what the engine's runMacro understands.
const MACRO_STEP_TYPES = [
  { type: 'goto', label: 'Go to URL', fields: [{ key: 'url', label: 'URL', placeholder: 'https://example.com' }] },
  { type: 'click', label: 'Click', fields: [{ key: 'selector', label: 'CSS selector', placeholder: '#submit, .btn' }] },
  { type: 'type', label: 'Type text', fields: [{ key: 'selector', label: 'Selector', placeholder: 'input[name="email"]' }, { key: 'value', label: 'Text to type' }] },
  { type: 'keypress', label: 'Press key', fields: [{ key: 'key', label: 'Key', placeholder: 'Enter' }] },
  { type: 'scroll', label: 'Scroll', fields: [{ key: 'steps', label: 'Scroll amount', kind: 'number', placeholder: '4' }] },
  { type: 'wait', label: 'Wait', fields: [{ key: 'ms', label: 'Milliseconds', kind: 'number', placeholder: '1000' }] },
  { type: 'move', label: 'Move mouse', fields: [{ key: 'selector', label: 'Selector (or use X/Y)', placeholder: '.target' }, { key: 'x', label: 'X', kind: 'number' }, { key: 'y', label: 'Y', kind: 'number' }] },
  { type: 'hover', label: 'Hover', fields: [{ key: 'selector', label: 'Selector', placeholder: '.menu' }, { key: 'ms', label: 'Dwell ms', kind: 'number', placeholder: '800' }] }
];
const STEP_LABEL = Object.fromEntries(MACRO_STEP_TYPES.map((s) => [s.type, s.label]));

function defaultStep(type) {
  const step = { type };
  if (type === 'scroll') step.steps = 4;
  if (type === 'wait') step.ms = 1000;
  if (type === 'hover') step.ms = 800;
  return step;
}

function stepSummary(step, t) {
  // `t` is the "automation" namespace translator; fall back to English literals
  // if it's not provided (e.g. called outside a component).
  const tr = (key, fallback) => (t ? t(key) : fallback);
  switch (step.type) {
    case 'goto': return step.url || tr('stepSummary.noUrl', '(no URL)');
    case 'click': return step.selector || tr('stepSummary.noSelector', '(no selector)');
    case 'type': return `${step.selector || tr('stepSummary.selectorFallback', '(selector)')} ← "${step.value || ''}"`;
    case 'keypress': return step.key || 'Enter';
    case 'scroll': return `${step.steps || 4}×`;
    case 'wait': return `${step.ms || 0} ms`;
    case 'move': return step.selector || (step.x != null && step.x !== '' ? `${step.x}, ${step.y}` : tr('stepSummary.target', '(target)'));
    case 'hover': return `${step.selector || tr('stepSummary.selectorFallback', '(selector)')} · ${step.ms || 800} ms`;
    default: return '';
  }
}

// Coerce an editor step into the runner shape (numeric fields → numbers, drop blanks).
function coerceStep(s) {
  const def = MACRO_STEP_TYPES.find((d) => d.type === s.type);
  const out = { type: s.type };
  for (const f of (def ? def.fields : [])) {
    const v = s[f.key];
    if (v === undefined || v === null || v === '') continue;
    out[f.key] = f.kind === 'number' ? Number(v) : v;
  }
  return out;
}

const LEVEL_COLOR = {
  INFO: 'text-sky-400',
  SUCCESS: 'text-emerald-400',
  WARN: 'text-amber-400',
  ERROR: 'text-red-400'
};

export default function AutomationPage() {
  const { t } = useTranslation('automation');
  const [tab, setTab] = useState('macros');

  return (
    <div className="flex flex-col h-full pb-10">
      <PageHeader
        eyebrow={t('header.eyebrow')}
        title={t('header.title')}
        description={t('header.description')}
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-elevated/60 border border-border w-fit mb-5">
        {TABS.map(({ key, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors ${
              tab === key ? 'bg-card text-foreground shadow-sm border border-border' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="w-4 h-4" /> {t(`tabs.${key}`)}
          </button>
        ))}
      </div>

      {tab === 'macros' && <MacrosPanel />}
      {tab === 'parallel' && <ParallelPanel />}
      {tab === 'warmer' && <WarmerPanel />}
      {tab === 'history' && <HistoryPanel />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// My Macros
// ---------------------------------------------------------------------------
function MacrosPanel() {
  const { t } = useTranslation('automation');
  const [macros, setMacros] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [targetProfile, setTargetProfile] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | macro object
  const [runState, setRunState] = useState(null); // { macro, profileId, profileName }
  const [showSchedule, setShowSchedule] = useState(false);
  const [recording, setRecording] = useState(null); // { profileId, sessionId }
  const [busyRec, setBusyRec] = useState(false);
  const [saveRec, setSaveRec] = useState(null); // { profileId, sessionId } — pending stop-and-save
  const [recName, setRecName] = useState(() => t('saveRecording.placeholder'));

  const load = useCallback(async () => {
    try {
      const rows = await softglazeApi.automation.getMacros();
      setMacros(Array.isArray(rows) ? rows : []);
    } catch (e) { setErr(e.message || t('macros.errors.loadMacros')); }
    finally { setLoading(false); }
  }, [t]);

  const loadProfiles = useCallback(async () => {
    try {
      const data = await softglazeApi.profiles.list({});
      const rows = Array.isArray(data) ? data : (data && (data.profiles || data.rows)) || [];
      setProfiles(rows);
      setTargetProfile((cur) => (cur || (rows.length ? String(rows[0].id) : '')));
    } catch (e) { /* non-fatal — the selector just stays empty */ }
  }, []);

  useEffect(() => { load(); loadProfiles(); }, [load, loadProfiles]);

  async function remove(id) {
    setErr('');
    try { await softglazeApi.automation.deleteMacro(id); setMacros((m) => m.filter((x) => x.id !== id)); }
    catch (e) { setErr(e.message || t('macros.errors.deleteMacro')); }
  }

  function openRun(macro) {
    if (!targetProfile) { setErr(t('macros.errors.chooseProfile')); return; }
    if ((macro.stepCount || 0) === 0) { setErr(t('macros.errors.noSteps')); return; }
    setErr(''); setNotice('');
    const p = profiles.find((x) => Number(x.id) === Number(targetProfile));
    setRunState({ macro, profileId: Number(targetProfile), profileName: p ? (p.title || t('macros.profileFallback', { id: p.id })) : t('macros.profileFallback', { id: targetProfile }) });
  }

  async function toggleRecording() {
    setErr(''); setNotice('');
    // Stopping: open the in-app save modal. Electron's <webview>/renderer does not
    // support window.prompt(), so we collect the macro name with our own dialog.
    if (recording) { setRecName(t('saveRecording.placeholder')); setSaveRec(recording); return; }
    setBusyRec(true);
    try {
      if (!targetProfile) { setErr(t('macros.errors.chooseProfileRecord')); return; }
      const res = await softglazeApi.automation.startRecording({ profileId: Number(targetProfile) });
      setRecording({ profileId: Number(targetProfile), sessionId: res.sessionId });
      setNotice(t('macros.recordingStarted'));
    } catch (e) { setErr(e.message || t('macros.errors.recordingFailed')); }
    finally { setBusyRec(false); }
  }

  // Finish a recording opened in the save modal. save=true persists under recName;
  // save=false stops and discards the captured steps. Either way recording ends.
  async function finishRecording(save) {
    const rec = saveRec;
    if (!rec) return;
    setBusyRec(true); setErr('');
    try {
      const res = await softglazeApi.automation.stopRecording({
        profileId: rec.profileId,
        sessionId: rec.sessionId,
        saveAs: save && recName.trim() ? recName.trim() : undefined
      });
      setRecording(null);
      setSaveRec(null);
      if (res.saved) { setNotice(t('macros.savedNotice', { name: res.saved.name, count: res.count })); load(); }
      else setNotice(t('macros.stoppedNotice', { count: res.count }));
    } catch (e) { setErr(e.message || t('macros.errors.recordingFailed')); }
    finally { setBusyRec(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground max-w-md">
          {t('macros.intro')}
        </p>
        <div className="flex items-center gap-2">
          <select
            value={targetProfile}
            onChange={(e) => setTargetProfile(e.target.value)}
            className="h-9 rounded-lg border border-border bg-card px-2 text-[12px] text-foreground max-w-[180px]"
            title={t('macros.profileSelectTitle')}
          >
            {profiles.length === 0 && <option value="">{t('macros.noProfiles')}</option>}
            {profiles.map((p) => <option key={p.id} value={String(p.id)}>{p.title || t('macros.profileFallback', { id: p.id })}</option>)}
          </select>
          <button
            onClick={toggleRecording}
            disabled={busyRec || (!recording && !targetProfile)}
            className={`shrink-0 inline-flex items-center gap-2 h-9 px-3 rounded-lg text-[13px] font-semibold border transition-colors ${recording ? 'bg-red-500/15 border-red-500/40 text-red-400' : 'bg-card border-border text-foreground hover:border-primary'}`}
          >
            {busyRec ? <Loader2 className="w-4 h-4 animate-spin" /> : (recording ? <Square className="w-4 h-4" /> : <span className="w-2.5 h-2.5 rounded-full bg-red-500" />)}
            {recording ? t('macros.stopAndSave') : t('macros.record')}
          </button>
          <button
            onClick={() => setShowSchedule(true)}
            className="shrink-0 inline-flex items-center gap-2 h-9 px-3 rounded-lg text-[13px] font-semibold bg-card border border-border text-foreground hover:border-primary"
          >
            <Clock className="w-4 h-4" /> {t('macros.schedule')}
          </button>
          <button
            onClick={() => setEditing('new')}
            className="shrink-0 inline-flex items-center gap-2 h-9 px-4 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-violet-500 to-indigo-600 hover:from-violet-400 hover:to-indigo-500 shadow shadow-indigo-500/25"
          >
            <Plus className="w-4 h-4" /> {t('macros.createMacro')}
          </button>
        </div>
      </div>

      {err && <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">{err}</div>}
      {notice && <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[12px] text-emerald-400">{notice}</div>}

      {loading ? (
        <div className="grid place-items-center py-16"><Loader2 className="w-5 h-5 text-muted-foreground animate-spin" /></div>
      ) : macros.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 py-14 grid place-items-center text-center">
          <Workflow className="w-8 h-8 text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-foreground">{t('macros.emptyTitle')}</p>
          <p className="text-[12.5px] text-muted-foreground mt-1">{t('macros.emptyHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {macros.map((m) => (
            <div key={m.id} className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
              <span className="w-10 h-10 rounded-lg grid place-items-center shrink-0 bg-indigo-500/10 border border-indigo-500/20">
                <Bot className="w-5 h-5 text-indigo-400" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-foreground truncate">{m.name}</span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">{t('macros.stepsBadge', { count: m.stepCount })}</span>
                </div>
                {m.description && <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2">{m.description}</p>}
                <p className="text-[10.5px] text-muted-foreground/70 mt-1.5">{t('macros.updated', { date: fmt(m.updatedAt) })}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => openRun(m)}
                  disabled={!targetProfile || (m.stepCount || 0) === 0}
                  title={(m.stepCount || 0) === 0 ? t('macros.runTitleNoSteps') : t('macros.runTitleReady')}
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] font-semibold bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Play className="w-3.5 h-3.5" /> {t('macros.run')}
                </button>
                <button onClick={() => setEditing(m)} title={t('macros.editSteps')} className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] font-semibold bg-card border border-border text-foreground hover:border-primary">
                  <Pencil className="w-3.5 h-3.5" /> {t('macros.edit')}
                </button>
                <button onClick={() => remove(m.id)} title={t('macros.delete')} className="text-muted-foreground hover:text-red-400 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <MacroEditorModal macro={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {runState && <MacroRunModal {...runState} onClose={() => { setRunState(null); load(); }} />}
      {showSchedule && <ScheduleModal macros={macros} profiles={profiles} onClose={() => setShowSchedule(false)} />}

      {/* Stop-and-save recording dialog (replaces window.prompt, unsupported in Electron). */}
      {saveRec && (
        <SaveRecordingModal
          recName={recName}
          setRecName={setRecName}
          busyRec={busyRec}
          onClose={() => setSaveRec(null)}
          onFinish={finishRecording}
        />
      )}
    </div>
  );
}

// Stop-and-save recording dialog, as its own component so useDialog (and its
// body-scroll-lock + focus-trap) only run while the modal is actually open.
function SaveRecordingModal({ recName, setRecName, busyRec, onClose, onFinish }) {
  const { t } = useTranslation('automation');
  const { dialogRef } = useDialog({ onClose, closeOnEscape: !busyRec });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onMouseDown={() => { if (!busyRec) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('saveRecording.ariaLabel')} tabIndex={-1} className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">{t('saveRecording.title')}</h3>
          <p className="text-[11px] text-muted-foreground">{t('saveRecording.subtitle')}</p>
        </div>
        <div className="p-5">
          <input
            autoFocus
            value={recName}
            onChange={(e) => setRecName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && recName.trim() && !busyRec) onFinish(true); }}
            placeholder={t('saveRecording.placeholder')}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary"
          />
        </div>
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-border">
          <button onClick={() => onFinish(false)} disabled={busyRec} className="h-9 px-3 rounded-lg text-[12.5px] font-semibold border border-border text-muted-foreground hover:text-foreground disabled:opacity-50">{t('saveRecording.discard')}</button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} disabled={busyRec} className="h-9 px-3 rounded-lg text-[12.5px] font-semibold border border-border text-foreground hover:bg-secondary disabled:opacity-50">{t('saveRecording.cancel')}</button>
            <button onClick={() => onFinish(true)} disabled={busyRec || !recName.trim()} className="h-9 px-4 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-violet-500 to-indigo-600 hover:from-violet-400 hover:to-indigo-500 disabled:opacity-50 inline-flex items-center gap-1.5">
              {busyRec && <Loader2 className="w-4 h-4 animate-spin" />} {t('saveRecording.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Macro scheduler — pick a macro + target profiles + interval and persist the
// timed run (Setting.macroSchedule). The main process fires it on its own timer.
function ScheduleModal({ macros, profiles, onClose }) {
  const { t } = useTranslation('automation');
  const [enabled, setEnabled] = useState(false);
  const [macroId, setMacroId] = useState('');
  const [everyMinutes, setEveryMinutes] = useState(60);
  const [profileIds, setProfileIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { dialogRef } = useDialog({ onClose, closeOnEscape: !busy });

  useEffect(() => {
    softglazeApi.automation.getSchedule()
      .then((s) => {
        if (!s) return;
        setEnabled(Boolean(s.enabled));
        setMacroId(s.macroId ? String(s.macroId) : '');
        setEveryMinutes(Number(s.everyMinutes) || 60);
        setProfileIds(Array.isArray(s.profileIds) ? s.profileIds.map(Number) : []);
      })
      .catch(() => {});
  }, []);

  function toggleProfile(id) {
    setProfileIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function save() {
    setErr(''); setBusy(true);
    try {
      await softglazeApi.automation.setSchedule({
        enabled,
        macroId: macroId ? Number(macroId) : null,
        everyMinutes: Number(everyMinutes) || 60,
        profileIds
      });
      onClose();
    } catch (e) { setErr(e.message || t('scheduleModal.errors.save')); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onMouseDown={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('scheduleModal.ariaLabel')} tabIndex={-1} className="w-full max-w-lg rounded-2xl bg-card border border-border shadow-2xl overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg grid place-items-center bg-indigo-500/12 border border-indigo-500/20"><Clock className="w-4 h-4 text-indigo-400" /></span>
            <div>
              <h3 className="text-sm font-semibold text-foreground">{t('scheduleModal.title')}</h3>
              <p className="text-[11px] text-muted-foreground">{t('scheduleModal.subtitle')}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          {err && <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">{err}</div>}

          <label className="flex items-center gap-2 text-[13px] text-foreground">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-indigo-500" />
            {t('scheduleModal.enable')}
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">{t('scheduleModal.macroLabel')}</label>
              <select value={macroId} onChange={(e) => setMacroId(e.target.value)} className="w-full h-9 bg-input-background border border-border rounded-lg px-2 text-[13px] text-foreground">
                <option value="">{t('scheduleModal.selectMacro')}</option>
                {macros.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">{t('scheduleModal.everyMinutes')}</label>
              <input type="number" min="1" value={everyMinutes} onChange={(e) => setEveryMinutes(e.target.value)} className="w-full h-9 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground" />
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">{t('scheduleModal.targetProfiles')}</label>
            <div className="max-h-40 overflow-auto rounded-lg border border-border divide-y divide-border">
              {profiles.length === 0 && <p className="px-3 py-2 text-[12px] text-muted-foreground">{t('scheduleModal.noProfiles')}</p>}
              {profiles.map((p) => (
                <label key={p.id} className="flex items-center gap-2 px-3 py-2 text-[12.5px] text-foreground cursor-pointer hover:bg-elevated/50">
                  <input type="checkbox" checked={profileIds.includes(Number(p.id))} onChange={() => toggleProfile(Number(p.id))} className="accent-indigo-500" />
                  {p.title || t('scheduleModal.profileFallback', { id: p.id })}
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="h-9 px-4 rounded-lg text-[13px] font-semibold bg-card border border-border text-foreground hover:border-primary">{t('scheduleModal.cancel')}</button>
            <button onClick={save} disabled={busy} className="h-9 px-4 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-violet-500 to-indigo-600 hover:from-violet-400 hover:to-indigo-500 disabled:opacity-50 inline-flex items-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} {t('scheduleModal.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Visual macro editor — add/edit/remove steps with native drag-to-reorder.
// Used for both Create and Edit (preloads the macro's steps when given one).
function MacroEditorModal({ macro, onClose, onSaved }) {
  const { t } = useTranslation('automation');
  const [name, setName] = useState(macro?.name || '');
  const [description, setDescription] = useState(macro?.description || '');
  const [steps, setSteps] = useState(() => (macro?.steps ? macro.steps.map((s) => ({ ...s })) : []));
  const [addType, setAddType] = useState('goto');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const dragFrom = useRef(null);
  const { dialogRef } = useDialog({ onClose, closeOnEscape: !busy });

  const addStep = () => setSteps((prev) => [...prev, defaultStep(addType)]);
  const removeStep = (i) => setSteps((prev) => prev.filter((_, idx) => idx !== i));
  const updateStep = (i, patch) => setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const changeType = (i, type) => setSteps((prev) => prev.map((s, idx) => (idx === i ? defaultStep(type) : s)));
  function reorder(from, to) {
    setSteps((prev) => {
      if (from == null || to == null || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function save() {
    setErr('');
    if (!name.trim()) { setErr(t('editorModal.errors.name')); return; }
    setBusy(true);
    try {
      await softglazeApi.automation.saveMacro({ id: macro?.id, name: name.trim(), description: description.trim(), steps: steps.map(coerceStep) });
      onSaved();
    } catch (e) { setErr(e.message || t('editorModal.errors.save')); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onMouseDown={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={macro ? t('editorModal.ariaEdit') : t('editorModal.ariaCreate')} tabIndex={-1} className="w-full max-w-2xl rounded-2xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col max-h-[88vh]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg grid place-items-center bg-violet-500/12 border border-violet-500/20"><Wand2 className="w-4 h-4 text-violet-400" /></span>
            <div>
              <h3 className="text-sm font-semibold text-foreground">{macro ? t('editorModal.titleEdit') : t('editorModal.titleCreate')}</h3>
              <p className="text-[11px] text-muted-foreground">{t('editorModal.subtitle')}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">{t('editorModal.nameLabel')}</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('editorModal.namePlaceholder')} className="w-full h-9 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">{t('editorModal.descriptionLabel')}</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('editorModal.descriptionPlaceholder')} className="w-full h-9 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('editorModal.stepsLabel', { count: steps.length })}</label>
              <div className="flex items-center gap-1.5">
                <select value={addType} onChange={(e) => setAddType(e.target.value)} className="h-8 bg-input-background border border-border rounded-lg px-2 text-[12px] text-foreground">
                  {MACRO_STEP_TYPES.map((s) => <option key={s.type} value={s.type}>{t(`stepTypes.${s.type}`)}</option>)}
                </select>
                <button onClick={addStep} className="h-8 px-2.5 rounded-lg border border-border text-[12px] text-foreground hover:bg-secondary inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> {t('editorModal.addStep')}</button>
              </div>
            </div>

            {steps.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-card/40 py-8 grid place-items-center text-center text-[12px] text-muted-foreground">{t('editorModal.noSteps')}</div>
            ) : (
              <div className="space-y-2">
                {steps.map((s, i) => {
                  const def = MACRO_STEP_TYPES.find((d) => d.type === s.type) || MACRO_STEP_TYPES[0];
                  return (
                    <div
                      key={i}
                      draggable
                      onDragStart={() => { dragFrom.current = i; }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => { reorder(dragFrom.current, i); dragFrom.current = null; }}
                      className="rounded-lg border border-border bg-elevated/40 p-2.5 flex items-start gap-2"
                    >
                      <span className="mt-1 text-muted-foreground cursor-grab active:cursor-grabbing" title={t('editorModal.dragToReorder')}><GripVertical className="w-4 h-4" /></span>
                      <span className="mt-1 text-[10px] font-mono text-muted-foreground w-5 text-center">{i + 1}</span>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <select value={s.type} onChange={(e) => changeType(i, e.target.value)} className="h-7 bg-input-background border border-border rounded px-1.5 text-[12px] text-foreground">
                          {MACRO_STEP_TYPES.map((d) => <option key={d.type} value={d.type}>{t(`stepTypes.${d.type}`)}</option>)}
                        </select>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {def.fields.map((f) => {
                            const fieldLabel = t(`stepFields.${s.type}.${f.key}`);
                            const fieldPlaceholder = f.placeholder ? t(`stepFields.${s.type}.${f.key}Placeholder`) : fieldLabel;
                            return (
                              <input
                                key={f.key}
                                type={f.kind === 'number' ? 'number' : 'text'}
                                value={s[f.key] ?? ''}
                                onChange={(e) => updateStep(i, { [f.key]: e.target.value })}
                                placeholder={fieldPlaceholder}
                                title={fieldLabel}
                                className="h-7 bg-input-background border border-border rounded px-2 text-[12px] text-foreground outline-none focus:border-primary"
                              />
                            );
                          })}
                        </div>
                      </div>
                      <button onClick={() => removeStep(i)} title={t('editorModal.removeStep')} className="mt-0.5 shrink-0 w-7 h-7 grid place-items-center rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {err && <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">{err}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground">{t('editorModal.cancel')}</button>
          <button onClick={save} disabled={busy} className="h-9 px-5 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-violet-500 to-indigo-600 hover:from-violet-400 hover:to-indigo-500 disabled:opacity-50 inline-flex items-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} {t('editorModal.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Live macro run — streams per-step progress, highlights the current step, and
// offers Pause / Resume / Stop while it runs.
function MacroRunModal({ macro, profileId, profileName, onClose }) {
  const { t } = useTranslation('automation');
  const steps = Array.isArray(macro.steps) ? macro.steps : [];
  const [statuses, setStatuses] = useState(() => steps.map(() => 'pending'));
  const [current, setCurrent] = useState(-1);
  const [log, setLog] = useState([]);
  const [phase, setPhase] = useState('running'); // running | paused | done
  const [summary, setSummary] = useState(null);
  const [err, setErr] = useState('');
  const [runId, setRunId] = useState(null);
  const logRef = useRef(null);
  const { dialogRef } = useDialog({ onClose, closeOnEscape: phase === 'done' });

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  useEffect(() => {
    let live = true;
    const off = softglazeApi.automation.onMacroProgress((data) => {
      if (!live || !data) return;
      if (data.kind === 'start') {
        setRunId(data.runId);
        setLog((l) => [...l, { level: 'INFO', msg: t('runModal.logStarted', { name: data.name, total: data.total, profile: profileName }) }]);
      } else if (data.kind === 'step') {
        setCurrent(data.index);
        setStatuses((prev) => { const n = [...prev]; if (n[data.index] !== undefined) n[data.index] = data.status === 'running' ? 'running' : data.status; return n; });
        const stepLabel = t(`stepTypes.${data.type}`, { defaultValue: data.type });
        if (data.status === 'running') setLog((l) => [...l, { level: 'INFO', msg: t('runModal.logStepRunning', { label: stepLabel, summary: stepSummary(data.step || {}, t) }) }]);
        else if (data.status === 'error') setLog((l) => [...l, { level: 'ERROR', msg: t('runModal.logStepError', { label: stepLabel, error: data.error || t('runModal.logStepFailed') }) }]);
      } else if (data.kind === 'done') {
        setPhase('done');
        setSummary({ ok: data.ok, ran: data.ran, total: data.total, aborted: data.aborted });
        setLog((l) => [...l, { level: data.aborted ? 'WARN' : (data.ok ? 'SUCCESS' : 'WARN'), msg: data.aborted ? t('runModal.logStopped') : t('runModal.logFinished', { ran: data.ran, total: data.total }) }]);
      }
    });
    softglazeApi.automation.runMacro({ macroId: macro.id, profileId, continueOnError: true })
      .catch((e) => { if (live) { setErr(e.message || t('runModal.errors.run')); setPhase('done'); } });
    return () => { live = false; try { off && off(); } catch (e) { /* ignore */ } };
  }, [macro.id, profileId, profileName, t]);

  async function control(action) {
    if (!runId) return;
    try { await softglazeApi.automation.controlMacro({ runId, action }); } catch (e) { /* ignore */ }
    if (action === 'pause') setPhase('paused');
    else if (action === 'resume') setPhase('running');
  }

  const ICONS = {
    running: <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />,
    ok: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
    error: <XCircle className="w-3.5 h-3.5 text-red-400" />
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onMouseDown={phase === 'done' ? onClose : undefined}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('runModal.ariaLabel', { name: macro.name })} tabIndex={-1} className="w-full max-w-2xl rounded-2xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col max-h-[88vh]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg grid place-items-center bg-emerald-500/12 border border-emerald-500/20"><MousePointer2 className="w-4 h-4 text-emerald-400" /></span>
            <div>
              <h3 className="text-sm font-semibold text-foreground">{macro.name}</h3>
              <p className="text-[11px] text-muted-foreground">{t('runModal.runningOn', { profile: profileName })}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          {err && <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">{err}</div>}

          <div className="space-y-1.5">
            {steps.map((s, i) => (
              <div key={i} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${current === i && phase !== 'done' ? 'border-amber-500/40 bg-amber-500/5' : 'border-border'}`}>
                <span className="w-4 grid place-items-center">{ICONS[statuses[i]] || <span className="text-[10px] font-mono text-muted-foreground">{i + 1}</span>}</span>
                <span className="text-[12px] text-foreground">{t(`stepTypes.${s.type}`, { defaultValue: s.type })}</span>
                <span className="text-[11px] text-muted-foreground truncate">{stepSummary(s, t)}</span>
              </div>
            ))}
          </div>

          <div ref={logRef} className="rounded-lg border border-border bg-[#0b0f17] p-2.5 font-mono text-[11px] max-h-40 overflow-y-auto">
            {log.length === 0 ? <p className="text-muted-foreground/60">{t('runModal.starting')}</p> : log.map((l, i) => (
              <div key={i} className={LEVEL_COLOR[l.level] || 'text-foreground/90'}>{l.msg}</div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-border">
          <div className="text-[12px] text-muted-foreground">
            {phase === 'done'
              ? (summary
                  ? (summary.aborted
                      ? t('runModal.stopped')
                      : (summary.ok
                          ? t('runModal.summaryCompleted', { ran: summary.ran, total: summary.total })
                          : t('runModal.summaryRan', { ran: summary.ran, total: summary.total })))
                  : t('runModal.finished'))
              : (phase === 'paused' ? t('runModal.paused') : t('runModal.running'))}
          </div>
          <div className="flex items-center gap-2">
            {phase !== 'done' && (
              <>
                {phase === 'paused'
                  ? <button onClick={() => control('resume')} disabled={!runId} className="h-9 px-3 rounded-lg text-[12.5px] font-semibold border border-border text-foreground hover:bg-secondary inline-flex items-center gap-1.5 disabled:opacity-50"><Play className="w-4 h-4" /> {t('runModal.resume')}</button>
                  : <button onClick={() => control('pause')} disabled={!runId} className="h-9 px-3 rounded-lg text-[12.5px] font-semibold border border-border text-foreground hover:bg-secondary inline-flex items-center gap-1.5 disabled:opacity-50"><Pause className="w-4 h-4" /> {t('runModal.pause')}</button>}
                <button onClick={() => control('stop')} disabled={!runId} className="h-9 px-3 rounded-lg text-[12.5px] font-semibold text-white bg-red-600 hover:bg-red-500 inline-flex items-center gap-1.5 disabled:opacity-50"><Square className="w-4 h-4" /> {t('runModal.stop')}</button>
              </>
            )}
            {phase === 'done' && <button onClick={onClose} className="h-9 px-4 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-violet-500 to-indigo-600 hover:from-violet-400 hover:to-indigo-500">{t('runModal.close')}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parallel Runs — run one macro across many profiles with a live, redacted
// per-profile status stream (frames arrive via the relay → run-progress channel).
// ---------------------------------------------------------------------------
const PAR_STATE = {
  queued: { label: 'Queued', cls: 'text-muted-foreground bg-secondary', Icon: Clock },
  launching: { label: 'Launching', cls: 'text-sky-400 bg-sky-500/12', Icon: Loader2, spin: true },
  running: { label: 'Running', cls: 'text-amber-400 bg-amber-500/12', Icon: Loader2, spin: true },
  passed: { label: 'Passed', cls: 'text-emerald-400 bg-emerald-500/12', Icon: CheckCircle2 },
  failed: { label: 'Failed', cls: 'text-red-400 bg-red-500/12', Icon: XCircle }
};
const PAR_LEVEL_COLOR = {
  queued: 'text-muted-foreground', launching: 'text-sky-400', running: 'text-amber-400',
  passed: 'text-emerald-400', failed: 'text-red-400', done: 'text-violet-300'
};

function ParallelPanel() {
  const { t } = useTranslation('automation');
  const [macros, setMacros] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [macroId, setMacroId] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [concurrency, setConcurrency] = useState(3);
  const [search, setSearch] = useState('');
  const [running, setRunning] = useState(false);
  const [statuses, setStatuses] = useState({}); // profileId -> last payload
  const [logs, setLogs] = useState([]);
  const [summary, setSummary] = useState(null);
  const [dataBinding, setDataBinding] = useState(null); // { token, fileName, headers, rowCount }
  const [err, setErr] = useState('');
  const logRef = useRef(null);

  useEffect(() => {
    softglazeApi.automation.getMacros().then((rows) => setMacros(Array.isArray(rows) ? rows : [])).catch(() => setMacros([]));
    softglazeApi.profiles.list({}).then((rows) => {
      const list = Array.isArray(rows) ? rows : (rows && (rows.profiles || rows.rows)) || [];
      setProfiles(list);
    }).catch(() => setProfiles([]));
  }, []);

  // Default the macro selector to the first macro once loaded.
  useEffect(() => { setMacroId((cur) => cur || (macros.length ? String(macros[0].id) : '')); }, [macros]);

  // Live per-profile progress for the panel's lifetime.
  useEffect(() => {
    const off = softglazeApi.automation.onRunProgress((frame) => {
      if (!frame || !frame.payload) return;
      const p = frame.payload;
      setLogs((prev) => [...prev.slice(-400), { ...p, ts: frame.ts }]);
      if (p.state === 'done' && p.profileId == null) {
        setRunning(false);
        setSummary({ total: p.total, passed: p.passed, failed: p.failed, error: p.error });
        return;
      }
      if (p.profileId != null) setStatuses((prev) => ({ ...prev, [p.profileId]: p }));
    });
    return () => { try { off && off(); } catch (e) { /* ignore */ } };
  }, []);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logs]);

  const filtered = profiles.filter((p) => !search || String(p.title || '').toLowerCase().includes(search.toLowerCase()));
  const selectedProfiles = profiles.filter((p) => selected.has(p.id));

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function selectAll() { setSelected(new Set(filtered.map((p) => p.id))); }
  function clearAll() { setSelected(new Set()); }

  async function bindData() {
    setErr('');
    try {
      const res = await softglazeApi.automation.pickDataFile();
      if (!res || res.cancelled) return;
      setDataBinding({ token: res.token, fileName: res.fileName, headers: res.headers || [], rowCount: res.rowCount || 0 });
    } catch (e) { setErr(e.message || t('parallel.errors.readSpreadsheet')); }
  }

  async function start() {
    setErr('');
    const ids = [...selected];
    if (!macroId) { setErr(t('parallel.errors.chooseMacro')); return; }
    if (ids.length === 0) { setErr(t('parallel.errors.selectProfile')); return; }
    setRunning(true); setLogs([]); setStatuses({}); setSummary(null);
    try {
      await softglazeApi.automation.runParallel({
        macroId: Number(macroId),
        profileIds: ids,
        concurrency: Number(concurrency) || 3,
        continueOnError: true,
        closeWhenDone: true,
        dataToken: dataBinding ? dataBinding.token : undefined
      });
    } catch (e) {
      setErr(e.message || t('parallel.errors.startRun'));
      setRunning(false);
    }
  }

  const profileName = (id) => {
    const p = profiles.find((x) => Number(x.id) === Number(id));
    return p ? p.title : t('parallel.profileFallback', { id });
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.1fr] gap-4">
      {/* Controls */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-lg grid place-items-center bg-indigo-500/12 border border-indigo-500/20"><Layers className="w-5 h-5 text-indigo-400" /></span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('parallel.title')}</h3>
            <p className="text-[11.5px] text-muted-foreground">{t('parallel.subtitle')}</p>
          </div>
        </div>

        <div className="flex items-end gap-3">
          <div className="flex-1 min-w-0">
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">{t('parallel.macroLabel')}</label>
            <select
              value={macroId}
              onChange={(e) => setMacroId(e.target.value)}
              className="w-full h-9 rounded-lg border border-border bg-card px-2 text-[12.5px] text-foreground"
            >
              {macros.length === 0 && <option value="">{t('parallel.noMacros')}</option>}
              {macros.map((m) => <option key={m.id} value={String(m.id)}>{t('parallel.macroOption', { name: m.name, count: m.stepCount })}</option>)}
            </select>
          </div>
          <div className="w-24 shrink-0">
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">{t('parallel.concurrency')}</label>
            <input type="number" min={1} max={10} value={concurrency} onChange={(e) => setConcurrency(e.target.value)} className="w-full h-9 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary" />
          </div>
        </div>

        {/* Optional data binding */}
        <div className="rounded-lg border border-border bg-elevated/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <FileSpreadsheet className="w-4 h-4 text-muted-foreground shrink-0" />
              {dataBinding ? (
                <span className="text-[12px] text-foreground truncate">
                  {t('parallel.dataBound', { fileName: dataBinding.fileName, count: dataBinding.rowCount })}
                </span>
              ) : (
                <span className="text-[12px] text-muted-foreground">{t('parallel.dataHint')}</span>
              )}
            </div>
            {dataBinding ? (
              <button onClick={() => setDataBinding(null)} className="text-muted-foreground hover:text-red-400 transition-colors" title={t('parallel.clearDataBinding')}><X className="w-4 h-4" /></button>
            ) : (
              <button onClick={bindData} className="shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11.5px] font-semibold bg-card border border-border text-foreground hover:border-primary">{t('parallel.bindData')}</button>
            )}
          </div>
          {dataBinding && dataBinding.headers.length > 0 && (
            <p className="text-[10.5px] text-muted-foreground mt-1.5 truncate">{t('parallel.columnsPrefix', { columns: dataBinding.headers.join(', ') })} <span className="font-mono text-foreground/80">{'{{Column}}'}</span> {t('parallel.columnsSuffix')}</p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('parallel.profilesLabel', { count: selected.size })}</label>
            <div className="flex items-center gap-2">
              <button onClick={selectAll} className="text-[10.5px] text-muted-foreground hover:text-foreground">{t('parallel.selectAll')}</button>
              <span className="text-muted-foreground/40">·</span>
              <button onClick={clearAll} className="text-[10.5px] text-muted-foreground hover:text-foreground">{t('parallel.clear')}</button>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('parallel.searchPlaceholder')} className="h-7 w-36 bg-input-background border border-border rounded-lg pl-7 pr-2 text-[12px] text-foreground outline-none focus:border-primary" />
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-elevated/40 max-h-[280px] overflow-y-auto divide-y divide-border/60">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">{t('parallel.noProfiles')}</div>
            ) : filtered.map((p) => (
              <label key={p.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-secondary/50">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} className="accent-indigo-500" />
                <span className="text-[12.5px] text-foreground truncate flex-1">{p.title}</span>
                <span className="text-[10.5px] text-muted-foreground">#{p.id}</span>
              </label>
            ))}
          </div>
          {dataBinding && dataBinding.rowCount !== selected.size && selected.size > 0 && (
            <p className="text-[10.5px] text-amber-400 mt-1.5 inline-flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> {t('parallel.rowMismatch', { rows: dataBinding.rowCount, profiles: selected.size })}
            </p>
          )}
        </div>

        <button
          onClick={start}
          disabled={running || !macroId || selected.size === 0}
          className="w-full h-10 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-violet-500 to-indigo-600 hover:from-violet-400 hover:to-indigo-500 shadow shadow-indigo-500/25 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {running ? t('parallel.running') : t('parallel.runOn', { count: selected.size || 0 })}
        </button>

        {err && <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">{err}</div>}
      </div>

      {/* Live status + console */}
      <div className="space-y-3">
        {/* Per-profile status grid */}
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-[11.5px] font-semibold text-muted-foreground">{t('parallel.runStatus')}</span>
            {summary && (
              <span className="text-[11px] text-muted-foreground">
                <span className="text-emerald-400 font-semibold">{summary.passed}</span> {t('parallel.summaryPassed')} · <span className="text-red-400 font-semibold">{summary.failed}</span> {t('parallel.summaryFailed')} · {t('parallel.summaryTotal', { total: summary.total })}
              </span>
            )}
          </div>
          {selectedProfiles.length === 0 ? (
            <p className="text-[12px] text-muted-foreground/60 px-1 py-3">{t('parallel.watchHint')}</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[260px] overflow-y-auto">
              {selectedProfiles.map((p) => {
                const st = statuses[p.id];
                const stateKey = (st && st.state) || 'queued';
                const meta = PAR_STATE[stateKey] || PAR_STATE.queued;
                const Icon = meta.Icon;
                return (
                  <div key={p.id} className="flex items-center gap-2 rounded-lg border border-border bg-elevated/40 px-3 py-2">
                    <span className={`w-6 h-6 rounded grid place-items-center shrink-0 ${meta.cls}`}>
                      <Icon className={`w-3.5 h-3.5 ${meta.spin ? 'animate-spin' : ''}`} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] text-foreground truncate">{p.title}</p>
                      <p className="text-[10.5px] text-muted-foreground truncate">
                        {t(`parallel.states.${stateKey}`, { defaultValue: meta.label })}
                        {st && (st.ran != null && st.total != null) ? ` · ${t('parallel.steps', { ran: st.ran, total: st.total })}` : ''}
                        {st && st.error ? ` · ${st.error}` : ''}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Console */}
        <div className="rounded-xl border border-border bg-[#0b0f17] overflow-hidden flex flex-col min-h-[220px]">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60 bg-elevated/30">
            <span className="flex gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
            </span>
            <span className="text-[11.5px] font-medium text-muted-foreground ml-1">{t('parallel.runConsole')}</span>
            {running && <span className="ml-auto text-[10.5px] text-emerald-400 inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> {t('parallel.live')}</span>}
          </div>
          <div ref={logRef} className="flex-1 overflow-y-auto p-3 font-mono text-[11.5px] leading-relaxed max-h-[300px]">
            {logs.length === 0 ? (
              <p className="text-muted-foreground/60">{t('parallel.consoleIdle')}</p>
            ) : logs.map((l, i) => (
              <div key={i} className="whitespace-pre-wrap break-words">
                <span className="text-muted-foreground/50">{ts(l.ts)} </span>
                <span className={PAR_LEVEL_COLOR[l.state] || 'text-foreground'}>[{(l.state || 'info').toUpperCase()}]</span>{' '}
                {l.profileId != null && <span className="text-violet-300">{l.profileName || profileName(l.profileId)}: </span>}
                <span className="text-foreground/90">
                  {l.state === 'done'
                    ? (l.error
                        ? t('parallel.logRunFinishedError', { passed: l.passed, total: l.total, error: l.error })
                        : t('parallel.logRunFinished', { passed: l.passed, total: l.total }))
                    : (l.message || l.error || (l.ran != null && l.total != null ? t('parallel.steps', { ran: l.ran, total: l.total }) : l.state))}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cookie Warmer
// ---------------------------------------------------------------------------
function WarmerPanel() {
  const { t } = useTranslation('automation');
  const [profiles, setProfiles] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState(null);
  const [logs, setLogs] = useState([]);
  const [err, setErr] = useState('');
  const logRef = useRef(null);

  // Per-site plan: each row visited for `seconds`, doing `clickMode` behaviour.
  // Seeded with a few suggestions so the panel works out-of-the-box and is editable.
  const [sites, setSites] = useState(() => PRESET_SITES.slice(0, 4).map((s) => ({ ...s, seconds: 30, clickMode: 'none' })));
  const [presetPick, setPresetPick] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [loop, setLoop] = useState(false);
  const [keepOpen, setKeepOpen] = useState(false);

  useEffect(() => {
    softglazeApi.profiles.list({}).then((rows) => setProfiles(Array.isArray(rows) ? rows : [])).catch(() => setProfiles([]));
  }, []);

  // Subscribe to live warm-up progress for the whole panel lifetime.
  useEffect(() => {
    const off = softglazeApi.automation.onWarmerProgress((data) => {
      if (!data) return;
      setLogs((prev) => [...prev.slice(-300), data]);
      if (data.done) setRunning(false);
    });
    return () => { try { off && off(); } catch (e) { /* ignore */ } };
  }, []);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logs]);

  const filtered = profiles.filter((p) => !search || String(p.title || '').toLowerCase().includes(search.toLowerCase()));

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function addPreset() {
    const p = PRESET_SITES.find((s) => s.url === presetPick);
    if (!p) return;
    setSites((prev) => [...prev, { url: p.url, label: p.label, seconds: 30, clickMode: 'none' }]);
    setPresetPick('');
  }

  function addCustom() {
    const raw = customUrl.trim();
    if (!raw) return;
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let label = url;
    try { label = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { /* keep url */ }
    setSites((prev) => [...prev, { url, label, seconds: 30, clickMode: 'none' }]);
    setCustomUrl('');
  }

  function updateSite(i, patch) { setSites((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s))); }
  function removeSite(i) { setSites((prev) => prev.filter((_, idx) => idx !== i)); }

  async function start() {
    setErr('');
    const ids = [...selected];
    if (ids.length === 0) { setErr(t('warmer.errors.selectProfile')); return; }
    if (sites.length === 0) { setErr(t('warmer.errors.addSite')); return; }
    setRunning(true);
    setLogs([]);
    try {
      const payload = {
        profileIds: ids,
        loop,
        keepOpen,
        sites: sites.map((s) => ({ url: s.url, label: s.label, seconds: Number(s.seconds) || 30, clickMode: s.clickMode || 'none' }))
      };
      const res = await softglazeApi.automation.startWarmer(payload);
      setRunId(res && res.runId ? res.runId : null);
    } catch (e) {
      setErr(e.message || t('warmer.errors.startWarmup'));
      setRunning(false);
    }
  }

  async function stop(force) {
    try { await softglazeApi.automation.stopWarmer({ runId, force: Boolean(force) }); }
    catch (e) { setErr(e.message || t('warmer.errors.stopWarmup')); }
  }

  const profileName = (id) => {
    const p = profiles.find((x) => Number(x.id) === Number(id));
    return p ? p.title : t('warmer.profileFallback', { id });
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.1fr] gap-4">
      {/* Controls */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-lg grid place-items-center bg-orange-500/12 border border-orange-500/20"><Flame className="w-5 h-5 text-orange-400" /></span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('warmer.title')}</h3>
            <p className="text-[11.5px] text-muted-foreground">{t('warmer.subtitle')}</p>
          </div>
        </div>

        {/* Sites to visit */}
        <div className="space-y-2">
          <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('warmer.sitesLabel', { count: sites.length })}</label>

          {/* Add a suggested site */}
          <div className="flex items-center gap-2">
            <select value={presetPick} onChange={(e) => setPresetPick(e.target.value)} className="h-8 flex-1 min-w-0 bg-input-background border border-border rounded-lg px-2 text-[12px] text-foreground outline-none focus:border-primary">
              <option value="">{t('warmer.addSuggested')}</option>
              {PRESET_SITES.map((p) => <option key={p.url} value={p.url}>{p.label}</option>)}
            </select>
            <button onClick={addPreset} disabled={!presetPick} className="h-8 px-2.5 rounded-lg border border-border text-[12px] text-foreground hover:bg-secondary disabled:opacity-50 inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> {t('warmer.add')}</button>
          </div>
          {/* Add a custom URL */}
          <div className="flex items-center gap-2">
            <input value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addCustom(); }} placeholder={t('warmer.customPlaceholder')} className="h-8 flex-1 min-w-0 bg-input-background border border-border rounded-lg px-3 text-[12px] text-foreground outline-none focus:border-primary" />
            <button onClick={addCustom} disabled={!customUrl.trim()} className="h-8 px-2.5 rounded-lg border border-border text-[12px] text-foreground hover:bg-secondary disabled:opacity-50 inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> {t('warmer.add')}</button>
          </div>

          {/* Configured sites — per-site dwell time + behaviour */}
          <div className="rounded-lg border border-border bg-elevated/40 divide-y divide-border/60 max-h-[240px] overflow-y-auto">
            {sites.length === 0 ? (
              <div className="px-3 py-5 text-center text-[12px] text-muted-foreground">{t('warmer.noSites')}</div>
            ) : sites.map((s, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] text-foreground truncate">{s.label}</span>
                  <span className="block text-[10px] text-muted-foreground truncate">{s.url}</span>
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <input type="number" min={3} max={600} value={s.seconds} onChange={(e) => updateSite(i, { seconds: e.target.value })} title={t('warmer.secondsTitle')} className="w-14 h-7 bg-input-background border border-border rounded px-1.5 text-[11.5px] text-center text-foreground outline-none focus:border-primary" />
                  <span className="text-[10px] text-muted-foreground">{t('warmer.secondsUnit')}</span>
                </div>
                <select value={s.clickMode} onChange={(e) => updateSite(i, { clickMode: e.target.value })} title={t('warmer.behaviourTitle')} className="h-7 shrink-0 bg-input-background border border-border rounded px-1.5 text-[11.5px] text-foreground outline-none focus:border-primary">
                  {Object.keys(CLICK_LABELS).map((k) => <option key={k} value={k}>{t(`clickLabels.${k}`)}</option>)}
                </select>
                <button onClick={() => removeSite(i)} title={t('warmer.remove')} className="shrink-0 w-7 h-7 grid place-items-center rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10"><X className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>

          {/* Options */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1">
            <label className="flex items-center gap-2 text-[12px] text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} className="accent-orange-500" /> {t('warmer.loopUntilStopped')}
            </label>
            <label className="flex items-center gap-2 text-[12px] text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={keepOpen} onChange={(e) => setKeepOpen(e.target.checked)} className="accent-orange-500" /> {t('warmer.keepOpen')}
            </label>
          </div>
          <p className="text-[10.5px] text-muted-foreground/80">{t('warmer.cookieNote')}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {!running ? (
            <button onClick={start} className="h-9 px-5 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-orange-500 to-rose-600 hover:from-orange-400 hover:to-rose-500 shadow shadow-orange-500/25 inline-flex items-center gap-2">
              <Play className="w-4 h-4" /> {t('warmer.startWarmup')}
            </button>
          ) : (
            <>
              <span className="inline-flex items-center gap-2 h-9 px-2 text-[12.5px] text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin text-orange-400" /> {t('warmer.warming')}</span>
              <button onClick={() => stop(false)} className="h-9 px-4 rounded-lg text-[13px] font-semibold border border-border text-foreground hover:bg-secondary inline-flex items-center gap-2"><Square className="w-4 h-4" /> {t('warmer.stop')}</button>
              <button onClick={() => stop(true)} className="h-9 px-4 rounded-lg text-[13px] font-semibold text-white bg-red-600 hover:bg-red-500 inline-flex items-center gap-2"><X className="w-4 h-4" /> {t('warmer.forceStop')}</button>
            </>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('warmer.profilesLabel', { count: selected.size })}</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('warmer.searchPlaceholder')} className="h-7 w-40 bg-input-background border border-border rounded-lg pl-7 pr-2 text-[12px] text-foreground outline-none focus:border-primary" />
            </div>
          </div>
          <div className="rounded-lg border border-border bg-elevated/40 max-h-[320px] overflow-y-auto divide-y divide-border/60">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">{t('warmer.noProfiles')}</div>
            ) : filtered.map((p) => (
              <label key={p.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-secondary/50">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} className="accent-orange-500" />
                <span className="text-[12.5px] text-foreground truncate flex-1">{p.title}</span>
                <span className="text-[10.5px] text-muted-foreground">#{p.id}</span>
              </label>
            ))}
          </div>
        </div>

        {err && <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">{err}</div>}
      </div>

      {/* Live console */}
      <div className="rounded-xl border border-border bg-[#0b0f17] overflow-hidden flex flex-col min-h-[360px]">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60 bg-elevated/30">
          <span className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
          </span>
          <span className="text-[11.5px] font-medium text-muted-foreground ml-1">{t('warmer.warmupConsole')}</span>
          {running && <span className="ml-auto text-[10.5px] text-emerald-400 inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> {t('warmer.live')}</span>}
        </div>
        <div ref={logRef} className="flex-1 overflow-y-auto p-3 font-mono text-[11.5px] leading-relaxed">
          {logs.length === 0 ? (
            <p className="text-muted-foreground/60">{t('warmer.consoleIdle')}</p>
          ) : logs.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap break-words">
              <span className="text-muted-foreground/50">{ts(l.ts)} </span>
              <span className={LEVEL_COLOR[l.level] || 'text-foreground'}>[{l.level || 'INFO'}]</span>{' '}
              {l.profileId != null && <span className="text-violet-300">{profileName(l.profileId)}: </span>}
              <span className="text-foreground/90">{l.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task History
// ---------------------------------------------------------------------------
// Collapse history rows that share a runId — older saves may hold two entries per
// run (a 'running' start + a 'completed'/'stopped' finish). Keep the first
// occurrence (most recent, already updated) so each run renders as one row.
function dedupeHistory(rows) {
  if (!Array.isArray(rows)) return [];
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const k = r && r.runId;
    if (k) { if (seen.has(k)) continue; seen.add(k); }
    out.push(r);
  }
  return out;
}

function HistoryPanel() {
  const { t } = useTranslation('automation');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    softglazeApi.automation.getHistory()
      .then((rows) => setHistory(dedupeHistory(rows)))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="grid place-items-center py-16"><Loader2 className="w-5 h-5 text-muted-foreground animate-spin" /></div>;

  if (history.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/40 py-14 grid place-items-center text-center">
        <History className="w-8 h-8 text-muted-foreground mb-3" />
        <p className="text-sm font-medium text-foreground">{t('history.emptyTitle')}</p>
        <p className="text-[12.5px] text-muted-foreground mt-1">{t('history.emptyHint')}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <table className="w-full text-[12.5px]">
        <thead className="bg-elevated/40 text-muted-foreground">
          <tr className="text-left">
            <th className="px-4 py-2.5 font-semibold">{t('history.columns.task')}</th>
            <th className="px-4 py-2.5 font-semibold">{t('history.columns.profiles')}</th>
            <th className="px-4 py-2.5 font-semibold">{t('history.columns.detail')}</th>
            <th className="px-4 py-2.5 font-semibold">{t('history.columns.status')}</th>
            <th className="px-4 py-2.5 font-semibold">{t('history.columns.when')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {history.map((h, i) => {
            const d = describeHistoryEntry(h, t);
            const Icon = d.icon;
            return (
              <tr key={`${h.runId || h.at || 'row'}-${i}`} className="text-foreground">
                <td className="px-4 py-2.5"><span className="inline-flex items-center gap-2"><Icon className={`w-3.5 h-3.5 ${d.iconCls}`} /> {d.label}</span></td>
                <td className="px-4 py-2.5 text-muted-foreground">{d.profiles}</td>
                <td className="px-4 py-2.5 text-muted-foreground max-w-[320px] truncate">{d.detail || t('history.emptyDetail')}</td>
                <td className="px-4 py-2.5">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${d.statusCls}`}>
                    <d.StatusIcon className="w-3 h-3" />
                    {d.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{fmt(d.when)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Normalize the different automation-history entry shapes (warmer / macro /
// parallel) into a single row descriptor so one table renders them all.
function describeHistoryEntry(h, t) {
  const type = h.type || 'warmer';
  const statusStyle = (key) => {
    switch (key) {
      case 'completed':
      case 'success': return { statusCls: 'bg-emerald-500/12 text-emerald-400', StatusIcon: CheckCircle2 };
      case 'error': return { statusCls: 'bg-red-500/12 text-red-400', StatusIcon: XCircle };
      case 'warn': return { statusCls: 'bg-amber-500/12 text-amber-400', StatusIcon: AlertTriangle };
      default: return { statusCls: 'bg-sky-500/12 text-sky-400', StatusIcon: Clock };
    }
  };

  if (type === 'parallel') {
    const key = (h.level || 'INFO').toLowerCase();
    return {
      icon: Layers, iconCls: 'text-indigo-400',
      label: h.label || t('history.parallelRun'),
      profiles: Array.isArray(h.profileIds) ? h.profileIds.length : 0,
      detail: h.detail || '', status: key, when: h.at,
      ...statusStyle(key)
    };
  }
  if (type === 'macro') {
    const key = (h.level || 'INFO').toLowerCase();
    return {
      icon: Bot, iconCls: 'text-violet-400',
      label: h.label || t('history.macroRun'),
      profiles: h.profileId != null ? 1 : 0,
      detail: h.detail || '', status: key, when: h.at,
      ...statusStyle(key)
    };
  }
  // Warmer (legacy/default shape).
  const key = h.status || 'running';
  return {
    icon: Flame, iconCls: 'text-orange-400',
    label: t('history.cookieWarmup'),
    profiles: Array.isArray(h.profileIds) ? h.profileIds.length : 0,
    detail: h.minutes ? t('history.minutes', { count: h.minutes }) : (h.sites ? t('history.sites', { count: h.sites }) : ''), status: key, when: h.finishedAt || h.startedAt,
    ...statusStyle(key)
  };
}

// --- helpers ---
function fmt(value) {
  if (!value) return '—';
  try { return new Date(value).toLocaleString(); } catch (e) { return '—'; }
}
function ts(value) {
  try { return new Date(value || Date.now()).toLocaleTimeString(); } catch (e) { return ''; }
}
