'use strict';
// Team activity labels (Members page, Activity tab). actionLabel() turns a stored action into a
// canonical English label, actionLabelT() translates it from members.json activityActions, and
// ACTION_COLORS colours the badge. 1.0.24: the AI page's DevTools card writes action 'devtools'
// ("DevTools address shown for profile #12 (Playwright MCP)"), which used to show as raw "devtools".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const locale = (lng) => JSON.parse(read('src', 'renderer', 'i18n', 'locales', lng, 'members.json'));

// The three helpers are plain JS (no JSX) between actionLabel() and humanizeDetail()'s comment.
const PAGE = read('src', 'renderer', 'pages', 'MembersPage.jsx');
const start = PAGE.indexOf('function actionLabel(a) {');
const end = PAGE.indexOf('// Structured audit detail', start);
assert.ok(start > 0 && end > start, 'actionLabel block found in MembersPage.jsx');
const { actionLabel, actionLabelT, ACTION_COLORS } = new Function(
  `${PAGE.slice(start, end)}\nreturn { actionLabel, actionLabelT, ACTION_COLORS };`
)();

// i18next's t() for the members namespace: activityActions.<key>, else the defaultValue.
const tFor = (lng) => {
  const ns = locale(lng);
  return (key, opts = {}) => {
    const v = key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), ns);
    return typeof v === 'string' ? v : opts.defaultValue;
  };
};

test('the devtools row has a proper label in English and Spanish, and an amber badge', () => {
  assert.equal(actionLabel('devtools'), 'devtools address shown');
  assert.equal(actionLabel('DevTools'), 'devtools address shown', 'case does not matter');
  assert.equal(actionLabelT('devtools', tFor('en')), 'DevTools address shown');
  assert.equal(actionLabelT('devtools', tFor('es')), 'dirección de DevTools mostrada');
  assert.equal(ACTION_COLORS[actionLabel('devtools')], '#f59e0b');
});

test('main still writes the action this label is for', () => {
  const ai = read('src', 'main', 'ai', 'index.js');
  assert.match(ai, /action: 'devtools',\s*\n\s*detail: `DevTools address shown for profile #\$\{profileId\}/);
});

test('every mapped action has an English and a Spanish label', () => {
  const mapped = PAGE.slice(start, PAGE.indexOf('return map[', start));
  const actions = [...mapped.matchAll(/(?:'([\w.-]+)'|\b([a-z]+)):\s*'[^']+'/g)].map((m) => m[1] || m[2]);
  assert.ok(actions.length >= 20, `found ${actions.length} actions`);
  assert.ok(actions.includes('devtools') && actions.includes('proxy.copied_for_extension'));
  for (const lng of ['en', 'es']) {
    const labels = locale(lng).activityActions;
    for (const a of actions) {
      const key = String(actionLabel(a)).replace(/[^a-z0-9]+/gi, '_');
      assert.equal(typeof labels[key], 'string', `${lng} activityActions.${key} (${a})`);
    }
  }
});

test('an action with no label still shows as stored', () => {
  assert.equal(actionLabel('something-new'), 'something-new');
  assert.equal(actionLabelT('something-new', tFor('es')), 'something-new');
  assert.equal(actionLabelT('launch', tFor('es')), 'abrió');
});
