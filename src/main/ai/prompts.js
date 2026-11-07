'use strict';
// Pre-built prompts: the same list is served as MCP prompts, shown in the app's prompt library and
// published on the website. Each has a name, title, description, string arguments and the message
// text. All are for legitimate work (see the acceptable use guide); none creates accounts, posts,
// or gets past a site's protections.

const PREAMBLE = 'Before you start, read the resources softglaze://memory/workspace and '
  + 'softglaze://guide/how-softglaze-works and follow them. Anything that changes something will ask '
  + 'me for approval in the SoftGlaze app; tell me what you are about to change and why first. '
  + 'Stop every profile you start when you are done.';

function arg(name, description, required = false) {
  return { name, description, required };
}

function v(args, name, fallback) {
  const value = args && args[name] != null ? String(args[name]).trim() : '';
  return value || fallback;
}

const PROMPTS = [
  {
    name: 'daily_health_check',
    title: 'Daily health check',
    description: 'Check every running and recently used profile and its proxy, then report problems with the fix for each.',
    arguments: [arg('group', 'Only check this group (name or id). Leave empty for all groups.')],
    build: (a) => `${PREAMBLE}

Run a daily health check of my SoftGlaze workspace${a.group ? ` for the group "${v(a, 'group')}"` : ''}.

1. Call workspace_summary, then list_sessions to see what is running.
2. Call list_profiles${a.group ? ` with group "${v(a, 'group')}"` : ''} and take the running profiles plus the 20 most recently used.
3. For each of those profiles call profile_health (live: false) and note every factor that is "fail" or "warn".
4. For each distinct proxy those profiles use, call get_proxy_health. If a proxy was last checked more than a day ago, call check_proxy on it.
5. Report one table: profile, CAPTCHA risk grade, proxy (name, country, last status, latency), and the problems found.
6. Under the table, list the fixes in order of impact, each with the exact tool call you would make. Do not apply any fix until I say which ones to apply.`
  },
  {
    name: 'diagnose_captcha',
    title: 'Why does this profile get CAPTCHAs?',
    description: 'Explain why one profile keeps getting CAPTCHAs or block pages, using profile_health, and propose fixes.',
    arguments: [arg('profile', 'The profile name or id.', true)],
    build: (a) => `${PREAMBLE}

The profile "${v(a, 'profile', '?')}" keeps getting CAPTCHAs or block pages. Find out why.

1. Find it with list_profiles (search by name) or get_profile (by id).
2. Call profile_health with live: true. This tests its proxy now and compares the exit IP's country and timezone with the profile's settings.
3. Explain each failing or warning factor in plain words: what it is, why sites react to it, and how much it matters (use the factor's impact).
4. Check the proxy itself with get_proxy_health and, if it has not been checked today, check_proxy. Say whether it is a datacenter or home IP, whether it is blocklisted, and whether other profiles share it.
5. Propose the smallest set of fixes that removes the biggest risks, for example: put timezone, language, location or WebRTC back to safe values with update_profile and its "fixes" list (tz-auto, lang-auto, geo-auto, webrtc-safe); move a failing or blocklisted proxy's profile to a healthy proxy from the same country with assign_proxy; warm the profile up with start_warmer if it has little history.
6. Ask me before changing anything. Never suggest ways to get past a CAPTCHA itself.`
  },
  {
    name: 'create_geo_profiles',
    title: 'Create profiles for a country',
    description: 'Create a number of profiles in a group, each with a working proxy from that country.',
    arguments: [
      arg('count', 'How many profiles to create (1-50).', true),
      arg('country', 'Two-letter country code, for example US or DE.', true),
      arg('group', 'Group to put them in (name). It is created if it does not exist.', true)
    ],
    build: (a) => `${PREAMBLE}

Create ${v(a, 'count', '?')} new profiles for ${v(a, 'country', '?').toUpperCase()} in the group "${v(a, 'group', '?')}".

1. Call list_groups. If "${v(a, 'group', '?')}" does not exist, plan to create it with create_group.
2. Call list_proxies with country "${v(a, 'country', '?').toUpperCase()}" and status "ok" to see how many working proxies from that country are free (not used by another profile).
3. If there are fewer free working proxies than ${v(a, 'count', '?')}, tell me the shortfall before doing anything. Never create a profile without a proxy, and never use a proxy from another country.
4. Tell me the plan: names (follow the naming rules in the workspace memory), group, proxy source, and that SoftGlaze will generate each fingerprint.
5. After I approve, call batch_generate_profiles with count ${v(a, 'count', '?')}, country "${v(a, 'country', '?').toUpperCase()}", proxySource "unique" and the group.
6. Report what was created and any proxy that failed its live check. Do not start the new profiles unless I ask.`
  },
  {
    name: 'fix_proxy_mismatches',
    title: 'Fix timezone, language and location mismatches',
    description: 'Find profiles whose timezone, language or location disagree with their proxy, and propose fixes for approval.',
    arguments: [arg('group', 'Only this group (name or id). Leave empty for all.')],
    build: (a) => `${PREAMBLE}

Find profiles${a.group ? ` in the group "${v(a, 'group')}"` : ''} whose timezone, language or geolocation do not match their proxy's country.

1. Call list_profiles${a.group ? ` with group "${v(a, 'group')}"` : ''} (page through all of them).
2. Call profile_health (live: false) for each profile that has a proxy. Collect the factors timezone, language, geolocation and webrtc that are not "pass".
3. For profiles whose proxy country is unknown or older than a week, call check_proxy on that proxy first, then score again.
4. Report a table: profile, proxy country, what disagrees, and the fix (for example "timezone: set to Based on IP").
5. Propose the setting fixes as update_profile calls with the "fixes" list (tz-auto, lang-auto, geo-auto, webrtc-safe), grouped so I approve them in as few requests as possible. Where the proxy itself is wrong, propose assign_proxy with a healthy proxy from the right country instead. Apply nothing until I approve.`
  },
  {
    name: 'rotate_bad_proxies',
    title: 'Replace failing or blocklisted proxies',
    description: 'Find failing or blocklisted proxies, then rotate their IP or move their profiles to healthy proxies.',
    arguments: [arg('group', 'Only profiles in this group (name or id). Leave empty for all.')],
    build: (a) => `${PREAMBLE}

Find proxies that are failing or blocklisted${a.group ? ` among the profiles in "${v(a, 'group')}"` : ''} and fix them.

1. Call list_proxies with status "fail", then with blocklisted true. Call get_proxy_health for each to confirm it is a pattern and not a single bad check; re-check with check_proxy where the last check is old.
2. For each bad proxy, find which profiles use it (list_profiles shows each profile's proxy).
3. For a proxy whose vendor supports it (canRotate true), propose rotate_proxy_ip, then check_proxy again.
4. Otherwise propose moving its profiles to healthy, unused proxies from the same country with assign_proxy (mode "unique", source "unassigned").
5. Show me the full plan first. Never move a profile to a proxy from another country, and never to a free proxy.
6. After the changes, report what changed and what still needs a new proxy from the vendor.`
  },
  {
    name: 'warm_up_profiles',
    title: 'Warm up profiles',
    description: 'Plan and start a warm-up with the Cookie Warmer so new profiles build normal browsing history.',
    arguments: [
      arg('group', 'The group to warm up (name or id).', true),
      arg('sites', 'Sites to visit, separated by commas. Leave empty for the default mix of popular sites.'),
      arg('days', 'Over how many days to repeat the warm-up (1-14).')
    ],
    build: (a) => `${PREAMBLE}

Warm up the profiles in the group "${v(a, 'group', '?')}"${a.days ? ` over ${v(a, 'days')} days` : ''}.

1. Call list_profiles for the group and profile_health for each; pick the profiles whose "history" factor is "warn" (little browsing history).
2. Sites: ${a.sites ? `use ${v(a, 'sites')}` : 'use the default mix (leave sites empty)'}. Keep to general, legitimate browsing; no logins, sign-ups, posting or ad clicking.
3. Plan small batches (concurrency 1 or 2) and about 30-60 seconds per site, so the run looks like normal reading and does not overload this computer.
4. Show me the plan, then call start_warmer for the first batch.
5. Track it with get_run_status and report cookies and sites loaded per profile.${a.days ? `
6. A warm-up across several days needs the Warm-up autopilot in the app (Automation page). Tell me the settings to use there for ${v(a, 'days')} days; you cannot schedule future runs yourself.` : ''}`
  },
  {
    name: 'write_macro',
    title: 'Write a macro from a description',
    description: 'Turn a plain-language task into a macro, save it, and dry-run it on one profile.',
    arguments: [
      arg('goal', 'What the macro should do, in plain words.', true),
      arg('site', 'The site it runs on, for example https://example.com.', true)
    ],
    build: (a) => `${PREAMBLE}

Write a SoftGlaze macro that does this on ${v(a, 'site', '?')}: ${v(a, 'goal', '?')}

1. Pick one test profile (ask me which, or use one the workspace memory names for testing) and start it with start_profile.
2. Open the site with page_navigate and study it with page_snapshot. Find stable selectors: prefer ids, name, data-testid or aria labels over long positional paths.
3. Write the steps (goto, click, type, keypress, scroll, wait, waitFor, select, check, clear, submit, hover, move). Use waitFor before clicking things that load late. Use {{placeholders}} for any personal value, never real passwords.
4. Save it with save_macro. If it fails validation, fix the step it names.
5. Dry-run it with run_macro on that one profile and follow get_run_status. If a step fails, look at the page again (page_snapshot), fix the selector and save again.
6. Stop the test profile when done and give me a short summary of what each step does.
Only automate my own, permitted work on that site; never sign-ups, posting at scale or anything that would break the site's rules.`
  },
  {
    name: 'run_macro_on_group',
    title: 'Run a macro on a group',
    description: 'Run a saved macro across the profiles in a group within the plan limits and report the results.',
    arguments: [
      arg('macro', 'The macro name or id.', true),
      arg('group', 'The group (name or id).', true),
      arg('concurrency', 'Profiles at once. Reduced to your plan limit if higher.')
    ],
    build: (a) => `${PREAMBLE}

Run the macro "${v(a, 'macro', '?')}" on the profiles in the group "${v(a, 'group', '?')}"${a.concurrency ? `, ${v(a, 'concurrency')} at a time` : ''}.

1. Find the macro with list_macros and read it with get_macro so you can describe what it does.
2. List the group's profiles with list_profiles and check them with profile_health; leave out any whose proxy is failing and tell me which.
3. Call workspace_summary to see the plan's parallel limit${a.concurrency ? `; if ${v(a, 'concurrency')} is higher it will be reduced` : ''}.
4. Tell me: the macro, the number of profiles, how many at a time, and roughly how long it will take. Then call run_macro.
5. Follow it with get_run_status until it ends, then report passed and failed profiles and the first error of each failure.
6. If something goes wrong across many profiles, stop it with stop_run straight away and tell me.`
  },
  {
    name: 'qa_test_site',
    title: 'Test a site from several countries',
    description: 'Open a site in profiles from several countries and report the differences (QA, geo testing, ad verification).',
    arguments: [
      arg('url', 'The page to test (your own site or ad landing page).', true),
      arg('countries', 'Two-letter country codes, separated by commas, for example US,DE,JP.', true)
    ],
    build: (a) => `${PREAMBLE}

Test ${v(a, 'url', '?')} as visitors from ${v(a, 'countries', '?')} would see it. This is QA of my own site or ad, so read only: do not log in, buy, submit forms or click ads.

1. For each country, find a profile whose proxy is in that country (list_profiles and list_proxies; the proxy's country must match). If a country has none, tell me and skip it.
2. Check each chosen profile's proxy with check_proxy so the exit country is confirmed today.
3. Start the profiles a few at a time (start_profile). In each, page_navigate to the URL, then take page_screenshot and page_extract_text.
4. Compare: language, currency, prices, banners, consent notices, redirects (final URL), blocked or missing content, and load errors.
5. Report a table per country and a list of the differences that matter, with screenshots referenced by country.
6. Stop every profile you started.`
  },
  {
    name: 'price_check',
    title: 'Compare prices by country',
    description: 'Compare the prices or content a page shows in different countries (market research).',
    arguments: [
      arg('url', 'The product or pricing page.', true),
      arg('countries', 'Two-letter country codes, separated by commas.', true)
    ],
    build: (a) => `${PREAMBLE}

Compare what ${v(a, 'url', '?')} shows in ${v(a, 'countries', '?')}. Read only: do not log in, add to cart, or submit anything, and visit the page once per country.

1. For each country pick a profile with a proxy in that country (check_proxy confirms the exit country).
2. Start it, page_navigate to the URL, wait for the price to appear (page_wait_for), and read it with page_extract_text (pass a selector for the price area if you can find one with page_snapshot).
3. Record: price, currency, tax or shipping notes, availability, and any country-specific offer.
4. Report a table with the price in each currency and, if I ask, converted to one currency (say which rate and date you used).
5. Stop every profile you started. Respect the site's terms; if it forbids automated access, tell me instead of continuing.`
  },
  {
    name: 'team_access_review',
    title: 'Review team access',
    description: 'Summarise which members can open which profiles (read-only) and suggest how to tighten access.',
    arguments: [],
    build: () => `${PREAMBLE}

Review who can open which profiles in this workspace. This is read-only: do not change anything.

1. Call workspace_summary for the team size and plan.
2. Call list_profiles (page through all) and note each profile's group and whether it is shared.
3. Call get_activity for the last 200 actions and note who launched or edited which groups recently.
4. Report: groups, how many profiles each has, and which members used them recently.
5. Suggest tightening where it helps, for example operators who used client groups they should not, unused shares, or profiles without a group. Member and role changes are made by the Owner in the app; you cannot make them.`
  },
  {
    name: 'weekly_report',
    title: 'Weekly report',
    description: 'Summarise the week: workspace activity, proxy health trends and the vendor scoreboard.',
    arguments: [],
    build: () => `${PREAMBLE}

Write my weekly SoftGlaze report. Read only.

1. workspace_summary: profiles, proxies, groups, running sessions, plan and limits.
2. get_activity (limit 200): launches, edits, macro and warm-up runs this week, and by whom.
3. get_proxy_health with no proxy id: the recent health of the pool and the vendor scoreboard (success rate, speed, blocklist rate per vendor).
4. list_proxies with status "fail": proxies that need attention.
5. Report in short sections: what happened, proxy health and the best and worst vendors (from my own checks only), problems to fix next week, and the profiles with the highest CAPTCHA risk (profile_health on the 10 most used).
Keep it to one page and say where a number comes from.`
  }
];

function listPrompts() {
  return PROMPTS.map((p) => ({
    name: p.name,
    title: p.title,
    description: p.description,
    arguments: p.arguments.map((x) => ({ ...x })),
    text: p.build(Object.fromEntries(p.arguments.map((x) => [x.name, `{${x.name}}`])))
  }));
}

function getPrompt(name) {
  return PROMPTS.find((p) => p.name === name) || null;
}

// Builds the message text for a prompt with the given arguments. Throws on a missing required one.
function renderPrompt(name, args = {}) {
  const p = getPrompt(name);
  if (!p) throw new Error(`Unknown prompt: ${name}`);
  const clean = {};
  for (const a of p.arguments) {
    const raw = args && args[a.name] != null ? String(args[a.name]).slice(0, 500).trim() : '';
    if (a.required && !raw) throw new Error(`The prompt "${p.title}" needs "${a.name}".`);
    if (raw) clean[a.name] = raw;
  }
  return p.build(clean);
}

module.exports = { PROMPTS, PREAMBLE, listPrompts, getPrompt, renderPrompt };
