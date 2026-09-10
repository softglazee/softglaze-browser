'use strict';
// Regression tests for bulk-action selection scope.
//
// Background: every list page keeps `selectedIds` in state while the visible rows come
// from a filtered memo. Only ProxyPoolPage pruned the selection when the filter changed.
// On the other three, a "select all" under one filter carried hidden ids into the next
// filter, and the bulk bar still counted them: switching group and hitting Move-to,
// Delete or Purge acted on rows the user could not see. TrashPage was the worst of the
// three because its purge is irreversible and also wipes the profile data directory.
//
// These assert the guard exists in the shipped source. They are deliberately structural:
// there is no renderer test harness in this repo, and a missing prune is invisible until
// it destroys something.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = (name) => fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'pages', `${name}.jsx`), 'utf8');

// Every page that offers a destructive or state-changing bulk action over a filtered list.
const PAGES = ['ProfilesPage', 'GroupsPage', 'TrashPage', 'ProxyPoolPage'];

for (const name of PAGES) {
  test(`${name} prunes its selection when the filter changes`, () => {
    const src = PAGE(name);

    assert.match(src, /setSelectedIds\(\(prev\) => \{/,
      'the page must own a selection set it can prune');

    // The prune reads the CURRENT visible rows through a ref so the effect does not have
    // to depend on the row data itself (which would clear the selection on every refresh).
    assert.match(src, /Ref\.current \|\| \[\]\)\.map\(\(\w+\) => \w+\.id\)/,
      `${name} must build the visible-id set from a ref to the filtered rows`);

    assert.match(src, /prev\.forEach\(\(id\) => \{ if \(visible\.has\(id\)\) next\.add\(id\); \}\);/,
      `${name} must keep only the ids that are still visible`);

    assert.match(src, /return next\.size === prev\.size \? prev : next;/,
      `${name} must return the SAME set when nothing changed, or the effect re-renders forever`);
  });
}

test('the prune effect is not keyed on the row data itself', () => {
  // Keying on the rows would clear the selection every time a background refresh, a
  // health check or a launch updated them - which is why ProxyPoolPage deliberately
  // excludes checkResults and ProfilesPage excludes runningIds.
  const profiles = PAGE('ProfilesPage');
  const prune = /useEffect\(\(\) => \{\s*setSelectedIds[\s\S]*?\}, \[([^\]]*)\]\);/.exec(profiles);
  assert.ok(prune, 'ProfilesPage must have a selection-prune effect');
  const deps = prune[1];
  assert.doesNotMatch(deps, /\bprofiles\b/, 'a data refresh must not clear the selection');
  assert.doesNotMatch(deps, /\brunningIds\b/, 'launching a profile must not clear the selection');
  assert.match(deps, /filterGroup/, 'but a real filter change must');
});

test('TrashPage keeps deliberate cross-page selection but not hidden-by-search rows', () => {
  const src = PAGE('TrashPage');
  const prune = /useEffect\(\(\) => \{\s*setSelectedIds[\s\S]*?\}, \[([^\]]*)\]\);/.exec(src);
  assert.ok(prune, 'TrashPage must have a selection-prune effect');
  assert.match(prune[1].trim(), /^search$/,
    'only the search filter may hide rows; paging across a selection is intentional');
  assert.match(src, /visibleTrashIdsRef\.current = filteredItems;/,
    'the visible set must be the search-filtered items, not just the current page');
});
