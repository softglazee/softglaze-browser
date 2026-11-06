'use strict';
// Enterprise is priced at US$29 per month (it was $15). Pro stays at PLAN.amount ($5). These are the
// built-in defaults; a catalog the Super Admin saved under Setting['billingPlans'] still overrides them.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const IPC = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipcHandlers.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.notEqual(start, -1, `could not find function ${name}`);
  let i = source.indexOf(') {', start) + 2;
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

// The billing constants and the default catalog, evaluated as the main process defines them.
function defaultPlans() {
  const start = IPC.indexOf('const TRIAL_DAYS = ');
  const end = IPC.indexOf(']);', IPC.indexOf('const DEFAULT_BILLING_PLANS = ')) + 3;
  assert.ok(start > 0 && end > start, 'billing constants must exist');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`${IPC.slice(start, end)}\n${extractFunction(IPC, 'sanitizeAmount')}\n${extractFunction(IPC, 'normalizePlan')}\nthis.PLAN = PLAN; this.plans = DEFAULT_BILLING_PLANS.map((p, i) => normalizePlan(p, i));`, ctx);
  return { PLAN: ctx.PLAN, plans: JSON.parse(JSON.stringify(ctx.plans)) };
}

test('Enterprise is US$29 per month and Pro stays at $5', () => {
  const { PLAN, plans } = defaultPlans();
  const byId = Object.fromEntries(plans.map((p) => [p.id, p]));
  assert.deepEqual(Object.keys(byId), ['free-trial', 'pro', 'enterprise'], 'the Enterprise plan is kept');
  assert.equal(byId.enterprise.amount, '29');
  assert.equal(byId.enterprise.currency, 'USD');
  assert.equal(byId.enterprise.months, 1);
  assert.equal(byId.enterprise.period, 'month');
  assert.equal(byId.enterprise.tier, 'enterprise');
  assert.equal(PLAN.amount, '5');
  assert.equal(byId.pro.amount, '5');
  assert.equal(byId['free-trial'].amount, '0');
});

test('no $15 Enterprise price is left in the app', () => {
  const block = IPC.slice(IPC.indexOf('const DEFAULT_BILLING_PLANS = '), IPC.indexOf(']);', IPC.indexOf('const DEFAULT_BILLING_PLANS = ')));
  assert.doesNotMatch(block, /amount: '15'/);
  const root = path.join(__dirname, '..', 'src', 'renderer');
  const offenders = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (/\.(jsx?|mjs|json)$/.test(ent.name) && /\$\s?15\b|US\$15|15 USD/.test(fs.readFileSync(full, 'utf8'))) offenders.push(full);
    }
  };
  walk(root);
  assert.deepEqual(offenders, []);
});
