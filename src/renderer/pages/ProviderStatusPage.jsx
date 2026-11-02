import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, KeyRound, RefreshCw } from 'lucide-react';

import PageHeader from '@/components/PageHeader.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card } from '@/components/ui/Card.jsx';
import { TONE, daysUntil, parseDay, shortDate, toneText, useProviderStates } from '@/lib/providerStates.js';
import { cn } from '@/lib/utils.js';
import i18n from '@/i18n/index.js';
import providersPageEn from '@/i18n/locales/en/providersPage.json';
import providersPageEs from '@/i18n/locales/es/providersPage.json';

if (!i18n.hasResourceBundle('en', 'providersPage')) i18n.addResourceBundle('en', 'providersPage', providersPageEn);
if (!i18n.hasResourceBundle('es', 'providersPage')) i18n.addResourceBundle('es', 'providersPage', providersPageEs);

// Super Admin only, for in-house vendor testing; customers buy their own proxies and never see it.
// The role exists only on the machine holding the source owner's certificate.

const ATTENTION_PREVIEW = 8;

function CardHead({ title, count, aside }) {
  return (
    <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border">
      <h2 className="text-[14px] font-semibold text-foreground font-display">{title}</h2>
      {count != null && <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">{count}</span>}
      {aside && <span className="ml-auto text-[12px] text-muted-foreground">{aside}</span>}
    </div>
  );
}

export default function ProviderStatusPage() {
  const { t, i18n: inst } = useTranslation('providersPage');
  const navigate = useNavigate();
  const lang = inst.language || 'en';
  const { loading, setLoading, loadErr, load, rows, isSuper, roleKnown } = useProviderStates();
  const [showAll, setShowAll] = useState(false);

  const attention = useMemo(() => {
    const items = [];
    for (const r of rows) {
      if (r.state === 'unavailable') continue;
      const name = r.p.name;
      const day = r.trial ? parseDay(r.trial.endsAt) : null;
      if (day) {
        const left = daysUntil(day);
        if (left <= 14) {
          items.push({
            id: `${r.p.key}-trial`, key: r.p.key, name, icon: Clock, rank: 0, sort: day.getTime(),
            tone: left <= 3 ? 'danger' : 'warning',
            text: left < 0 ? t('attention.trialEnded', { date: shortDate(day, lang) }) : t('attention.trialEnds', { date: shortDate(day, lang) }),
            emphasis: left < 0 ? null : left === 0 ? t('attention.endsToday') : t('attention.daysLeft', { count: left }),
            action: t('attention.actionPull'), tab: 'pull'
          });
        }
      }
      if (r.pool.fail > 0) {
        items.push({ id: `${r.p.key}-fail`, key: r.p.key, name, icon: AlertTriangle, rank: 1, sort: -r.pool.fail, tone: 'danger', text: t('attention.failing', { failed: r.pool.fail, total: r.pool.total }), action: t('attention.actionReview'), tab: 'pool' });
      }
      if (r.state === 'needsKey') {
        items.push({ id: `${r.p.key}-key`, key: r.p.key, name, icon: KeyRound, rank: 2, sort: -r.pool.total, tone: 'warning', text: t('attention.needsKey', { count: r.pool.total }), action: t('attention.actionAddKey'), tab: 'pull' });
      } else if (r.keySaved && r.pool.total === 0) {
        items.push({ id: `${r.p.key}-empty`, key: r.p.key, name, icon: AlertTriangle, rank: 3, sort: 0, tone: 'warning', text: t('attention.keyNoPool'), action: t('attention.actionPull'), tab: 'pull' });
      }
    }
    items.sort((a, b) => a.rank - b.rank || a.sort - b.sort || a.name.localeCompare(b.name));
    return items;
  }, [rows, t, lang]);

  const trialRows = useMemo(() => rows
    .filter((r) => r.trial)
    .map((r) => ({ r, day: parseDay(r.trial.endsAt) }))
    .sort((a, b) => (a.day ? a.day.getTime() : Infinity) - (b.day ? b.day.getTime() : Infinity)), [rows]);

  if (roleKnown && !isSuper) return <Navigate to="/proxy-providers" replace />;

  const open = (key, tab = 'pull') => navigate(`/proxy-providers?provider=${encodeURIComponent(key)}&tab=${tab}`);
  const shown = showAll ? attention : attention.slice(0, ATTENTION_PREVIEW);

  return (
    <div className="flex flex-col gap-5 pb-6">
      <PageHeader
        className="mb-0"
        title={t('status.title')}
        description={t('status.description')}
        actions={(
          <Button variant="secondary" size="sm" onClick={() => { setLoading(true); load(); }} disabled={loading}>
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} /> {t('refresh')}
          </Button>
        )}
      />

      {loadErr && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm" style={toneText('danger')}>{t('loadError', { message: loadErr })}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4 items-start">
        <Card className="overflow-hidden">
          <CardHead title={t('attention.title')} count={attention.length} aside={attention.length > 1 ? t('attention.order') : null} />
          {attention.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-muted-foreground flex items-start gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" style={{ color: TONE.success }} />{loading ? t('loading') : t('attention.none')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {shown.map((a) => {
                const Icon = a.icon;
                return (
                  <li key={a.id} className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-2 px-5 py-3">
                    <Icon className="w-4 h-4 shrink-0 self-start mt-0.5 sm:self-center sm:mt-0" style={{ color: TONE[a.tone] }} aria-hidden="true" />
                    <span className="flex flex-col sm:flex-row sm:items-center gap-x-3 gap-y-0.5 min-w-0 flex-1 basis-[calc(100%-28px)] sm:basis-auto">
                      <span className="text-[13px] font-semibold text-foreground sm:w-28 shrink-0 truncate" title={a.name}>{a.name}</span>
                      <span className="text-[12.5px] text-muted-foreground min-w-0">
                        {a.text}
                        {a.emphasis && <span className="ml-2 font-semibold whitespace-nowrap" style={toneText(a.tone)}>{a.emphasis}</span>}
                      </span>
                    </span>
                    <Button variant="secondary" size="sm" className="shrink-0 ml-7 sm:ml-auto" onClick={() => open(a.key, a.tab)}>{a.action}</Button>
                  </li>
                );
              })}
            </ul>
          )}
          {attention.length > ATTENTION_PREVIEW && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="w-full px-5 py-2.5 border-t border-border text-[12.5px] font-medium text-primary hover:bg-secondary text-left">
              {showAll ? t('attention.showLess') : t('attention.showAll', { count: attention.length })}
            </button>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHead title={t('trials.title')} count={trialRows.length} />
          {trialRows.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-muted-foreground">{t('trials.empty')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {trialRows.map(({ r, day }) => {
                const left = day ? daysUntil(day) : null;
                return (
                  <li key={r.p.key}>
                    <button type="button" onClick={() => open(r.p.key)} className="w-full grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-0.5 px-5 py-3 text-left hover:bg-secondary/60 transition-colors">
                      <span className="text-[13px] font-semibold text-foreground truncate">{r.p.name}</span>
                      <span className="text-[12.5px] text-foreground text-right">{r.trial.allowance || <span className="text-muted-foreground">{t('trials.noAllowance')}</span>}</span>
                      <span className="text-[12px] col-span-2 sm:col-span-1 sm:text-right" style={left != null && left <= 3 ? toneText('danger') : undefined}>
                        <span className={left != null && left <= 3 ? '' : 'text-muted-foreground'}>
                          {day ? (left < 0 ? t('trials.ended', { date: shortDate(day, lang) }) : t('trials.ends', { date: shortDate(day, lang) })) : t('trials.noEnd')}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
