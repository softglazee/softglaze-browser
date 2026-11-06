import { useTranslation } from 'react-i18next';
import { AlertTriangle, Clock, Sparkles, X } from 'lucide-react';

// Renders the one notice picked by pickLicenseNotice (lib/licenseNotice.mjs). The banner is a normal
// block in the page flow, above the scrolling content, so it pushes the page down instead of covering
// it; nothing here is fixed or absolutely positioned.

const TONE_CLASS = {
  danger: 'bg-destructive/10 border-destructive/30 text-destructive',
  warning: 'bg-warning/10 border-warning/30 text-warning'
};

function noticeText(t, notice) {
  switch (notice.kind) {
    case 'machine': return t('shell.licenceOtherComputer');
    case 'ended': return t('shell.accessEnded');
    case 'grace': return `${notice.trial ? t('shell.trialEnded') : t('shell.subscriptionEnded')} ${t('shell.graceDaysLeft', { count: notice.days ?? 0 })}`;
    case 'trialEnding': return t('shell.trialEndingDays', { count: notice.days ?? 0 });
    default: return '';
  }
}

export function LicenseNoticeBanner({ notice, onAction, onDismiss }) {
  const { t } = useTranslation();
  if (!notice || notice.placement !== 'banner') return null;
  const Icon = notice.kind === 'trialEnding' ? Sparkles : AlertTriangle;
  const urgent = notice.kind === 'machine' || notice.kind === 'ended' || notice.kind === 'grace';
  return (
    <div
      role={urgent ? 'alert' : 'status'}
      data-license-notice={notice.kind}
      className={`shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 sm:px-7 py-2.5 ${TONE_CLASS[notice.tone] || TONE_CLASS.warning}`}
    >
      <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="text-[12.5px] flex-1 min-w-[12rem]">{noticeText(t, notice)}</span>
      {notice.action && (
        <button type="button" onClick={onAction} className="shrink-0 text-[12px] font-semibold px-3 py-1 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow shadow-blue-500/25">
          {notice.action === 'renew' ? t('shell.renew') : t('shell.subscribe')}
        </button>
      )}
      {notice.dismissible && (
        <button type="button" onClick={onDismiss} className="shrink-0 opacity-80 hover:opacity-100" title={t('shell.dismiss')} aria-label={t('shell.dismiss')}>
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

// The trial-days chip lives in the sidebar, not over the page, and opens Billing.
export function LicenseTrialChip({ notice, collapsed, onOpen }) {
  const { t } = useTranslation();
  if (!notice || notice.placement !== 'sidebar') return null;
  const label = t('shell.trialChip', { count: notice.days ?? 0 });
  return (
    <button
      type="button"
      onClick={onOpen}
      data-license-notice={notice.kind}
      title={collapsed ? label : undefined}
      aria-label={label}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[12px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors text-left"
    >
      <Clock className="w-[18px] h-[18px] shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
}
