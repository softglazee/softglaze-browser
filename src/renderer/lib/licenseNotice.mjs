// The single licence notice the app shows at a time (AppShell renders it). Pure and framework-free
// so node:test can exercise it.
//
// Priority, highest first; only the first that applies is shown:
//   machine     - the licence is registered to another computer
//   ended       - trial and grace period are over (the blocking screen normally shows instead; this
//                 covers a licence that lapses while the app is open)
//   grace       - the trial or subscription ended and grace days are left
//   trialEnding - the free trial ends within TRIAL_ENDING_DAYS days; can be dismissed
//   trialDays   - the free trial has more days left; a quiet chip in the sidebar, never a banner
// Nothing is shown for no licence, an exempt licence (certified Super Admin) or a paid one. On the
// Billing page only `machine` is shown: the page's own status card states the rest.
//
// placement: 'banner' sits in the page flow above the content (never over it), 'sidebar' is the chip.

export const TRIAL_ENDING_DAYS = 3;

export const LICENSE_NOTICE_PRIORITY = Object.freeze(['machine', 'ended', 'grace', 'trialEnding', 'trialDays']);

function daysOf(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.ceil(n)) : null;
}

export function pickLicenseNotice(license, { dismissed = false, path = '' } = {}) {
  if (!license || typeof license !== 'object' || license.isExempt) return null;
  const isTrialLicence = String(license.type || '').toLowerCase() === 'trial';

  let notice = null;
  if (license.reason === 'machine_mismatch') {
    notice = { kind: 'machine', tone: 'warning', placement: 'banner', dismissible: false, action: null };
  } else if (license.isBanned) {
    notice = { kind: 'ended', tone: 'danger', placement: 'banner', dismissible: false, action: 'subscribe', trial: isTrialLicence };
  } else if (license.isGrace) {
    // isTrial is false once a trial is in grace, so the licence type says which one ended.
    notice = { kind: 'grace', tone: 'danger', placement: 'banner', dismissible: false, action: isTrialLicence ? 'subscribe' : 'renew', trial: isTrialLicence, days: daysOf(license.daysLeftGrace) };
  } else if (license.isTrial) {
    const days = daysOf(license.daysLeftTrial ?? license.daysLeft);
    if (days === null) return null;
    notice = days <= TRIAL_ENDING_DAYS
      ? { kind: 'trialEnding', tone: 'warning', placement: 'banner', dismissible: true, action: 'subscribe', days }
      : { kind: 'trialDays', tone: 'info', placement: 'sidebar', dismissible: false, action: null, days };
  }
  if (!notice) return null;
  if (/^\/billing(\/|$)/.test(String(path || '')) && notice.kind !== 'machine') return null;
  if (dismissed && notice.dismissible) return null;
  return notice;
}
