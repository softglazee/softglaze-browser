'use strict';
// Regression tests for the macro step contract (normalizeMacroSteps).
//
// Background: saveMacro used to JSON.stringify whatever the renderer sent, with no
// validation at all. A typo'd type, a missing selector or a non-numeric wait were
// only discovered by the RUNNER — mid-run, potentially after 40 good steps across
// every profile of a parallel batch. `VALID_MACRO_STEPS` existed but was dead code
// and already stale (it omitted `move` and `hover`). Steps are now validated and
// canonicalised at save time against a single field schema.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeMacroSteps,
  VALID_MACRO_STEPS,
  MACRO_STEP_FIELDS
} = require('../src/main/browserEngine');

test('the valid-step set covers every type the editor and runner support', () => {
  const expected = [
    'goto', 'click', 'type', 'keypress', 'scroll', 'wait', 'move', 'hover',
    'select', 'waitFor', 'submit', 'check', 'clear'
  ];
  assert.deepEqual(Array.from(VALID_MACRO_STEPS).sort(), expected.slice().sort());
  // The set is derived from the field schema, so the two can never drift apart.
  assert.deepEqual(Array.from(VALID_MACRO_STEPS).sort(), Object.keys(MACRO_STEP_FIELDS).sort());
});

test('move and hover normalize (they were missing from the old dead constant)', () => {
  const steps = normalizeMacroSteps([
    { type: 'move', x: '10', y: '20' },
    { type: 'hover', selector: '.menu', ms: '800' }
  ]);
  assert.deepEqual(steps[0], { type: 'move', x: 10, y: 20 });
  assert.deepEqual(steps[1], { type: 'hover', selector: '.menu', ms: 800 });
});

test('an unknown step type is rejected at save time with a 1-based step number', () => {
  assert.throws(
    () => normalizeMacroSteps([{ type: 'goto', url: 'https://a.test' }, { type: 'clickk', selector: '#x' }]),
    /Step 2: unknown step type "clickk"/
  );
});

test('an empty step type is rejected', () => {
  assert.throws(() => normalizeMacroSteps([{ selector: '#x' }]), /Step 1: unknown step type "\(empty\)"/);
});

test('type names are matched case-insensitively but stored canonically', () => {
  const steps = normalizeMacroSteps([
    { type: 'WAITFOR', selector: '.ready' },
    { type: 'waitfor', selector: '.ready' },
    { type: '  GoTo  ', url: 'https://a.test' }
  ]);
  assert.equal(steps[0].type, 'waitFor');
  assert.equal(steps[1].type, 'waitFor');
  assert.equal(steps[2].type, 'goto');
});

test('numeric fields are coerced to numbers and non-numeric input is rejected', () => {
  assert.deepEqual(normalizeMacroSteps([{ type: 'wait', ms: '2500' }])[0], { type: 'wait', ms: 2500 });
  assert.throws(() => normalizeMacroSteps([{ type: 'wait', ms: 'soon' }]), /Step 1 \(wait\): "ms" must be a number/);
});

test('unknown fields are dropped rather than silently carried into the runner', () => {
  const [step] = normalizeMacroSteps([
    { type: 'click', selector: '#go', bogus: 'x', __proto__: { evil: 1 } }
  ]);
  assert.deepEqual(step, { type: 'click', selector: '#go' });
  assert.equal(step.bogus, undefined);
});

test('element steps require a selector', () => {
  assert.throws(() => normalizeMacroSteps([{ type: 'click' }]), /Step 1 \(click\): a CSS selector is required/);
  assert.throws(() => normalizeMacroSteps([{ type: 'select', value: 'A' }]), /Step 1 \(select\): a CSS selector is required/);
  assert.throws(() => normalizeMacroSteps([{ type: 'goto' }]), /Step 1 \(goto\): a URL is required/);
});

test('move is the one element step allowed to target bare x/y instead of a selector', () => {
  assert.deepEqual(normalizeMacroSteps([{ type: 'move', x: 5, y: 6 }])[0], { type: 'move', x: 5, y: 6 });
  // ...but with neither a selector nor coordinates it is still rejected.
  assert.throws(() => normalizeMacroSteps([{ type: 'move' }]), /Step 1 \(move\): a CSS selector is required/);
});

test('select accepts by=auto|value|label|index and lowercases it', () => {
  const [step] = normalizeMacroSteps([{ type: 'select', selector: 'select#f', value: 'Plumbing', by: 'LABEL' }]);
  assert.deepEqual(step, { type: 'select', selector: 'select#f', value: 'Plumbing', by: 'label' });
});

test('an out-of-set enum value is rejected with the allowed list', () => {
  assert.throws(
    () => normalizeMacroSteps([{ type: 'select', selector: 's', value: 'x', by: 'fuzzy' }]),
    /Step 1 \(select\): "by" must be one of auto, value, label, index/
  );
  assert.throws(
    () => normalizeMacroSteps([{ type: 'check', selector: 'i', state: 'maybe' }]),
    /Step 1 \(check\): "state" must be one of checked, unchecked/
  );
  assert.throws(
    () => normalizeMacroSteps([{ type: 'waitFor', selector: 'd', state: 'gone' }]),
    /Step 1 \(waitFor\): "state" must be one of visible, hidden/
  );
});

test('waitFor and check use the same field name for different value sets', () => {
  assert.equal(normalizeMacroSteps([{ type: 'waitFor', selector: 'd', state: 'hidden' }])[0].state, 'hidden');
  assert.equal(normalizeMacroSteps([{ type: 'check', selector: 'i', state: 'unchecked' }])[0].state, 'unchecked');
  // ...and they do not leak into each other.
  assert.throws(() => normalizeMacroSteps([{ type: 'waitFor', selector: 'd', state: 'checked' }]), /visible, hidden/);
});

test('optional is preserved as a real boolean and only when truthy', () => {
  assert.equal(normalizeMacroSteps([{ type: 'click', selector: '#a', optional: true }])[0].optional, true);
  assert.equal(normalizeMacroSteps([{ type: 'click', selector: '#a', optional: 'true' }])[0].optional, true);
  assert.equal('optional' in normalizeMacroSteps([{ type: 'click', selector: '#a' }])[0], false);
  assert.equal('optional' in normalizeMacroSteps([{ type: 'click', selector: '#a', optional: false }])[0], false);
});

test('blank and null fields are dropped so the runner sees its own defaults', () => {
  const [step] = normalizeMacroSteps([{ type: 'hover', selector: '.m', ms: '', timeout: null }]);
  assert.deepEqual(step, { type: 'hover', selector: '.m' });
});

test('a non-array or empty input normalizes to an empty list, not a throw', () => {
  assert.deepEqual(normalizeMacroSteps([]), []);
  assert.deepEqual(normalizeMacroSteps(null), []);
  assert.deepEqual(normalizeMacroSteps('nope'), []);
});

test('a realistic multi-step form macro round-trips unchanged through JSON', () => {
  const authored = [
    { type: 'goto', url: 'https://example.test/signup' },
    { type: 'waitFor', selector: 'form#signup', state: 'visible', timeout: 45000 },
    { type: 'clear', selector: '#email' },
    { type: 'type', selector: '#email', value: '{{Email}}' },
    { type: 'select', selector: 'select[name="focus"]', value: 'Plumbing', by: 'label' },
    { type: 'check', selector: '#trade-pro', state: 'checked' },
    { type: 'type', selector: '#referral', value: '{{Referral}}', optional: true },
    { type: 'submit', selector: 'form#signup' }
  ];
  const normalized = normalizeMacroSteps(authored);
  assert.deepEqual(normalized, authored);
  // Survives the DB round-trip (stepsJson is a TEXT column).
  assert.deepEqual(normalizeMacroSteps(JSON.parse(JSON.stringify(normalized))), authored);
});
