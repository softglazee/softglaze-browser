'use strict';
// Trial automations, queued by the cron. Each is due at its anchor + offsetHours (both editable in
// settings.automations) and is queued at most once per trial (dedupeKey auto:<key>:<trialId>).
// It is not sent if more than email.catchUpHours have passed since it was due (for example after
// the cron was off for days), and the trial reminders are skipped once the customer has paid.
//
//   welcome         trial start + 0 h      lifecycle
//   tips            trial start + 48 h     lifecycle
//   trial_ending    trial end - 48 h       lifecycle (day 5 of a 7-day trial)
//   trial_ended     trial end + 0 h        lifecycle
//   locks_tomorrow  trial end + 48 h       lifecycle (the app locks after its 3 grace days)
//   come_back       trial start + 336 h    marketing: needs marketing consent (day 14)
const { renderFor, enqueue, blockReason } = require('./outbox');
const { getTemplate } = require('./templates');
const { ms } = require('../util/time');

const AUTOMATIONS = Object.freeze([
  { key: 'welcome', anchor: 'start', skipIfPaid: false },
  { key: 'tips', anchor: 'start', skipIfPaid: false },
  { key: 'trial_ending', anchor: 'end', skipIfPaid: true },
  { key: 'trial_ended', anchor: 'end', skipIfPaid: true },
  { key: 'locks_tomorrow', anchor: 'end', skipIfPaid: true },
  { key: 'come_back', anchor: 'start', skipIfPaid: true }
]);
const HOUR = 3600000;

function dueAt(automation, trial, offsetHours) {
  const base = automation.anchor === 'end' ? ms(trial.endsAt) : ms(trial.startedAt);
  return base + offsetHours * HOUR;
}

async function scheduleAutomations(db, tenant, { now = Date.now(), settings }) {
  const tenantId = tenant.id;
  const out = { queued: 0, skipped: 0 };
  const cfg = settings.automations;
  const catchUp = settings.email.catchUpHours * HOUR;
  const maxOffset = Math.max(...AUTOMATIONS.map((a) => (cfg[a.key] ? cfg[a.key].offsetHours : 0)), 0) * HOUR;
  const oldest = new Date(now - maxOffset - catchUp - 90 * 86400000);

  const trials = await db.trial.findMany({ where: { tenantId, NOT: { customerId: null }, startedAt: { gte: oldest } } });
  if (!trials.length) return out;
  const customers = await db.customer.findMany({ where: { tenantId, id: { in: [...new Set(trials.map((t) => t.customerId))] } } });
  const byId = new Map(customers.map((c) => [c.id, c]));
  const keys = [];
  for (const t of trials) for (const a of AUTOMATIONS) keys.push(`auto:${a.key}:${t.id}`);
  const existing = new Set((await db.emailOutbox.findMany({ where: { tenantId, dedupeKey: { in: keys } }, select: { dedupeKey: true } })).map((r) => r.dedupeKey));

  for (const t of trials) {
    const customer = byId.get(t.customerId);
    if (!customer) continue;
    for (const a of AUTOMATIONS) {
      const c = cfg[a.key];
      if (!c || !c.enabled) continue;
      const due = dueAt(a, t, c.offsetHours);
      if (now < due || now > due + catchUp) continue;
      const dedupeKey = `auto:${a.key}:${t.id}`;
      if (existing.has(dedupeKey)) continue;
      const tpl = await getTemplate(db, tenantId, a.key, customer.lang || 'en');
      const category = (tpl && tpl.category) || 'lifecycle';
      let skipReason = null;
      if (a.skipIfPaid && (t.convertedAt || customer.statusAuto === 'paid')) skipReason = 'paid';
      if (!skipReason) skipReason = blockReason(customer, category);
      if (skipReason) {
        const row = await enqueue(db, tenantId, { customer, templateKey: a.key, category, dedupeKey, subject: tpl ? tpl.subject : a.key, skipReason, createdBy: 'automation' });
        if (row) out.skipped += 1;
        continue;
      }
      // The trial being emailed about, not whatever is on the customer row now.
      const r = await renderFor(db, tenantId, { customer: { ...customer, trialEndsAt: t.endsAt, tier: t.tier }, templateKey: a.key, settings, now });
      const row = await enqueue(db, tenantId, { customer, templateKey: a.key, category: r.category, dedupeKey, subject: r.subject, html: r.html, text: r.text, createdBy: 'automation' });
      if (row) out.queued += 1;
    }
  }
  return out;
}

module.exports = { AUTOMATIONS, scheduleAutomations, dueAt };
