import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Loader2 } from 'lucide-react';
import Switch from '@/components/ui/Switch.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;
const FIELD = 'h-8 w-full min-w-0 bg-input-background border border-border rounded-lg px-2 text-[12px] text-foreground outline-none focus:border-primary disabled:opacity-50';
const LABEL = 'block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1';
// The status line moves on its own while the autopilot works, so it is re-read now and then.
const REFRESH_MS = 30000;

function formatNext(ts) {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  try {
    return new Intl.DateTimeFormat(undefined, sameDay ? { timeStyle: 'short' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
  } catch (e) { return d.toLocaleString(); }
}

function errorText(t, e) {
  if (!e) return '';
  if (e.code === 'warm-failed' && !e.message) return t('autopilot.errors.warmFailedHidden');
  const profile = e.title || (e.profileId != null ? `#${e.profileId}` : '');
  return t(`autopilot.errors.${e.code}`, { profile, error: e.message || '', defaultValue: e.message || e.code });
}

// Settings card for the warm-up autopilot, shown beside the Cookie Warmer. Every change saves at once.
export default function WarmAutopilotCard() {
  const { t } = useTranslation('automation');
  const [cfg, setCfg] = useState(null);
  const [groups, setGroups] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    if (savingRef.current) return;
    try { setCfg(await softglazeApi.automation.getWarmAutopilot()); }
    catch (e) { setErr(e.message || t('autopilot.errors.load')); }
  }, [t]);

  useEffect(() => {
    load();
    softglazeApi.groups.list().then((g) => setGroups(Array.isArray(g) ? g : [])).catch(() => {});
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function save(patch) {
    const { status, canEdit, ...settings } = { ...cfg, ...patch };
    if (settings.target === 'group' && !settings.groupId) {
      if (!groups.length) { setErr(t('autopilot.errors.noGroups')); return; }
      settings.groupId = groups[0].id;
    }
    setErr('');
    setSaving(true);
    savingRef.current = true;
    setCfg((prev) => ({ ...prev, ...settings }));
    try { setCfg(await softglazeApi.automation.setWarmAutopilot(settings)); }
    catch (e) { setErr(e.message || t('autopilot.errors.save')); savingRef.current = false; load(); }
    finally { savingRef.current = false; setSaving(false); }
  }

  if (!cfg) {
    return (
      <section className="rounded-xl border border-border bg-card px-4 py-6 grid place-items-center" aria-busy="true">
        {err ? <p role="alert" className="text-[12px] text-destructive">{err}</p> : <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" aria-hidden="true" />}
      </section>
    );
  }

  const editable = cfg.canEdit !== false;
  const disabled = !editable || saving;
  const s = cfg.status || {};
  let next = t('autopilot.status.off');
  if (cfg.enabled) {
    if (s.nextRunAt == null) next = t('autopilot.status.nothingDue');
    else if (s.nextRunAt <= Date.now() + 60000) next = t('autopilot.status.nextSoon');
    else next = t('autopilot.status.nextAt', { time: formatNext(s.nextRunAt) });
  }
  const groupMissing = cfg.target === 'group' && cfg.groupId && !groups.some((g) => g.id === cfg.groupId);

  return (
    <section aria-labelledby="warm-autopilot-title" className="rounded-xl border border-border bg-card p-4 space-y-3 min-w-0">
      <div className="flex items-start gap-2.5">
        <span className="w-9 h-9 shrink-0 rounded-lg grid place-items-center bg-primary/10 border border-primary/20">
          <CalendarClock className="w-5 h-5 text-primary" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="warm-autopilot-title" className="text-sm font-semibold text-foreground">{t('autopilot.title')}</h3>
          <p className="text-[11.5px] text-muted-foreground">{t('autopilot.subtitle')}</p>
        </div>
        <Switch checked={Boolean(cfg.enabled)} onChange={(v) => save({ enabled: v })} disabled={disabled} label={t('autopilot.toggle')} className="mt-1" />
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        <label className="min-w-0">
          <span className={LABEL}>{t('autopilot.target')}</span>
          <select value={cfg.target} disabled={disabled} onChange={(e) => save({ target: e.target.value })} className={FIELD}>
            <option value="all">{t('autopilot.targetAll')}</option>
            <option value="group">{t('autopilot.targetGroup')}</option>
          </select>
        </label>
        {cfg.target === 'group' ? (
          <label className="min-w-0">
            <span className={LABEL}>{t('autopilot.group')}</span>
            <select value={cfg.groupId || ''} disabled={disabled} onChange={(e) => save({ groupId: Number(e.target.value) || null })} className={FIELD}>
              {groupMissing && <option value={cfg.groupId}>#{cfg.groupId}</option>}
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        ) : <span aria-hidden="true" />}

        <label className="min-w-0" title={t('autopilot.runsPerDayTitle')}>
          <span className={LABEL}>{t('autopilot.runsPerDay')}</span>
          <select value={cfg.runsPerDay} disabled={disabled} onChange={(e) => save({ runsPerDay: Number(e.target.value) })} className={FIELD}>
            {range(1, 6).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="min-w-0" title={t('autopilot.sitesPerRunTitle')}>
          <span className={LABEL}>{t('autopilot.sitesPerRun')}</span>
          <select value={cfg.sitesPerRun} disabled={disabled} onChange={(e) => save({ sitesPerRun: Number(e.target.value) })} className={FIELD}>
            {range(2, 10).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>

        <fieldset className="min-w-0">
          <legend className={LABEL}>{t('autopilot.activeHours')}</legend>
          <div className="flex items-center gap-1.5">
            <select aria-label={t('autopilot.startHour')} value={cfg.startHour} disabled={disabled} onChange={(e) => save({ startHour: Number(e.target.value) })} className={FIELD}>
              {range(0, 23).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
            <span className="text-[11px] text-muted-foreground shrink-0">{t('autopilot.hoursTo')}</span>
            <select aria-label={t('autopilot.endHour')} value={cfg.endHour} disabled={disabled} onChange={(e) => save({ endHour: Number(e.target.value) })} className={FIELD}>
              {range(1, 24).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
          </div>
        </fieldset>
        <label className="min-w-0" title={t('autopilot.atATimeTitle')}>
          <span className={LABEL}>{t('autopilot.atATime')}</span>
          <select value={cfg.maxConcurrent} disabled={disabled} onChange={(e) => save({ maxConcurrent: Number(e.target.value) })} className={FIELD}>
            {range(1, 4).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      <label className="flex items-center gap-2 text-[12px] text-muted-foreground cursor-pointer w-fit">
        <input type="checkbox" checked={Boolean(cfg.headless)} disabled={disabled} onChange={(e) => save({ headless: e.target.checked })} className="accent-primary" />
        {t('autopilot.hidden')}
      </label>

      <p className="text-[10.5px] text-muted-foreground/80">{t('autopilot.hint')}</p>

      <div role="status" aria-live="polite" className="rounded-lg border border-border bg-surface px-3 py-2 text-[11.5px] space-y-1">
        <p className="text-foreground">
          {next}
          <span className="text-muted-foreground"> · {t('autopilot.status.warmedToday', { done: s.warmedToday || 0, total: s.covered || 0 })}</span>
          {s.warmingNow > 0 && <span className="text-muted-foreground"> · {t('autopilot.status.warmingNow', { n: s.warmingNow })}</span>}
        </p>
        {s.lastError && (
          <p className="text-destructive break-words">
            {t('autopilot.status.lastError', { time: formatNext(s.lastError.at), error: errorText(t, s.lastError) })}
          </p>
        )}
      </div>

      {!editable && <p className="text-[11px] text-muted-foreground">{t('autopilot.ownedByOther')}</p>}
      {err && <p role="alert" className="px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-[12px] text-destructive">{err}</p>}
    </section>
  );
}
