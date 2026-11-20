// The licence state pill on the Settings > Billing card. Pure and framework-free so node:test covers it.
//
// 1.0.27 added the Free forever plan: main's freeView() returns state 'free' (isFree true, no days left).
// The card had no 'free' case, so a Free workspace fell through to the default and showed an amber
// "Trial · d left". Free now shows the Billing page's own "Free plan" label (billing.json status.free, in
// every language) in the same blue the Billing page uses for it.

import { fmtDate } from './intl.mjs';

export const LICENSE_TONE_COLORS = Object.freeze({
  loading: '#9ca3af',
  sourceOwner: '#10b981',
  paid: '#10b981',
  active: '#10b981',
  free: '#3b82f6',
  trialing: '#3b82f6',
  grace: '#f59e0b',
  banned: '#ef4444',
  trial: '#f59e0b'
});

// Which pill a licence view gets. 'free' wins over the state switch so an older or partial view that
// only carries isFree / type 'free' still reads as Free, never as a trial.
export function licenseStatusKind(license) {
  if (!license || typeof license !== 'object') return 'loading';
  if (license.isExempt) return 'sourceOwner';
  if (license.state === 'free' || license.isFree === true || String(license.type || '').toLowerCase() === 'free') return 'free';
  switch (license.state) {
    case 'paid': return 'paid';
    case 'trialing': return 'trialing';
    case 'grace': return 'grace';
    case 'banned': return 'banned';
    default: return license.isPaid ? 'active' : 'trial';
  }
}

// t is the card's cmpSettingsA translator; the Free label is read from the billing namespace (loaded with
// every other namespace, see i18n/index.js), so the card and the Billing page say the same words.
export function settingsStatusTone(license, t) {
  const kind = licenseStatusKind(license);
  const color = LICENSE_TONE_COLORS[kind];
  switch (kind) {
    case 'loading': return { kind, color, label: t('billing.status.loading') };
    case 'sourceOwner': return { kind, color, label: t('billing.status.sourceOwner') };
    case 'paid': return { kind, color, label: license.endsAt ? t('billing.status.activeUntil', { date: fmtDate(license.endsAt) }) : t('billing.status.active') };
    case 'free': return { kind, color, label: t('status.free', { ns: 'billing' }) };
    case 'trialing': return { kind, color, label: t('billing.status.trialDaysLeft', { count: license.daysLeftTrial }) };
    case 'grace': return { kind, color, label: t('billing.status.graceDaysLeft', { count: license.daysLeftGrace }) };
    case 'banned': return { kind, color, label: t('billing.status.subscriptionEnded') };
    case 'active': return { kind, color, label: t('billing.status.active') };
    default: return { kind, color, label: t('billing.status.trialDaysLeft', { count: license.daysLeft }) };
  }
}
