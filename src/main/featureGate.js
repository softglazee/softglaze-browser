'use strict';
// "Visible features" (Members > a member's permissions) hide a page from that member's sidebar. This
// module makes main refuse the page's actions as well, so a hidden feature cannot be used from another
// page's shortcut, a stale window or DevTools. registerHandler checks it for every renderer channel.
//
// Only actions are listed: anything that changes data, starts work, downloads or exports. Lists that
// other pages need keep working (proxies, proxy groups and groups in the profile editor, members in the
// share dialog, profiles on the Automation page, installed browsers), and so does reading a page's own
// data. Each channel belongs to the one feature whose page it serves; an action that another page also
// offers (a group created from the profile editor, a browser version downloaded from it) follows the
// feature it belongs to.
//
// Not enforced here, by design:
//   - Dashboard: the page has no actions of its own, and its numbers (the member's own profiles and
//     sessions) also feed the sidebar counts. Turning it off only hides the page.
//   - Workspace settings written through settings:set-global: setGlobalSettingsForActor checks the
//     "settings" feature itself, because other pages save their own lists through the same channel
//     (saved Profiles filters, Automation warm-up lists).
//   - Automation, SoftGlaze AI and Start links have no feature switch; Automation follows
//     automation.run, SoftGlaze AI follows its own Owner/Admin rule.

const permissions = require('./permissions');

const FEATURE_LABELS = Object.freeze({
  dashboard: 'Dashboard',
  profiles: 'Profiles',
  groups: 'Groups',
  proxies: 'Proxies',
  extensions: 'Extensions',
  browsers: 'Browsers',
  batchImport: 'Batch import',
  members: 'Members',
  trash: 'Trash',
  settings: 'Settings'
});

const FEATURE_CHANNELS = Object.freeze({
  dashboard: Object.freeze([]),
  profiles: Object.freeze([
    'profile:create', 'profile:batch-generate', 'profile:update', 'profile:delete', 'profile:launch',
    'profile:bulk-delete', 'profile:bulk-launch', 'profile:bulk-launch-control', 'profile:bulk-assign-proxy',
    'profile:access-grant', 'profile:access-revoke',
    'profile:export-cookies', 'profile:import-cookies', 'profile:import-cookies-bulk',
    'profile:clone', 'template:save', 'template:delete', 'template:create-profile',
    'profile:captcha-fix', 'profile:captcha-fix-bulk', 'profile:get-2fa-token', 'profile:bulk-synchronize',
    'profile:export-archive', 'profile:cookie-robot', 'profile:tag-assign', 'profile:bulk-rename',
    'proxy:rotation-set', 'profile:rotate-ip'
  ]),
  groups: Object.freeze(['group:create', 'group:update', 'group:delete', 'group:assign']),
  proxies: Object.freeze([
    'proxy:create', 'proxy:update', 'proxy:delete', 'proxy:batch-add', 'proxy:bulk-delete',
    'proxy:free-harvest', 'proxy:free-cancel', 'proxy:sync-vendor-pool', 'proxy:vendor-lookup',
    'proxy-provider:creds-get', 'proxy-provider:creds-set', 'proxy:provider-account', 'proxy:rotate-ip',
    'proxy:extension-copy-info', 'proxy:extension-copy', 'proxy:test-all', 'proxy:check-stream', 'proxy:check-stop',
    'proxy-group:create', 'proxy-group:update', 'proxy-group:delete', 'proxy-group:assign', 'proxy:auto-group'
  ]),
  extensions: Object.freeze(['extensions:install-from-id', 'extensions:delete', 'extensions:toggle-global']),
  browsers: Object.freeze([
    'browser:download', 'browser:download-pause', 'browser:download-resume', 'browser:antidetect-download',
    'browser:firefox-download', 'browser:firefox-download-pause', 'browser:firefox-download-resume'
  ]),
  batchImport: Object.freeze([
    'batch:preview-profiles-dialog', 'batch:commit-profile-import', 'batch:export-profiles', 'batch:export-profiles-file'
  ]),
  members: Object.freeze([
    'member:create', 'member:update', 'member:delete', 'member:set-pin', 'member:update-permissions',
    'member:set-instructions', 'member:set-status',
    'team:activity', 'team:reassign-profiles', 'team:export-activity'
  ]),
  trash: Object.freeze(['profile:list-trash', 'profile:restore', 'profile:purge', 'profile:bulk-restore', 'profile:bulk-purge']),
  settings: Object.freeze([
    'email:set-config', 'email:test', 'sync:configure', 'sync:run', 'db:enable-encryption', 'db:disable-encryption',
    'workspace:backup', 'workspace:restore', 'monetization:set-links', 'migration:start-transfer'
  ])
});

const CHANNEL_FEATURE = new Map();
for (const [feature, channels] of Object.entries(FEATURE_CHANNELS)) {
  for (const ch of channels) CHANNEL_FEATURE.set(ch, feature);
}

function featureForChannel(channel) {
  return CHANNEL_FEATURE.get(String(channel)) || null;
}

// True when `feature` was turned off for `member`. No member (single-user mode, the Owner) and the Super
// Admin see everything.
function featureHidden(member, feature) {
  if (!member || member.role === 'SUPER_ADMIN' || !feature) return false;
  const f = permissions.effectivePermissions(member).features;
  return Boolean(f) && f[feature] === false;
}

function featureOffError(feature) {
  const e = new Error(`${FEATURE_LABELS[feature] || 'This feature'} is turned off for your account by an administrator.`);
  e.code = 'FEATURE_OFF';
  return e;
}

// The refusal for a renderer channel, or null when it may run.
function refusalFor(channel, member) {
  const feature = featureForChannel(channel);
  return feature && featureHidden(member, feature) ? featureOffError(feature) : null;
}

module.exports = { FEATURE_LABELS, FEATURE_CHANNELS, featureForChannel, featureHidden, featureOffError, refusalFor };
