'use strict';
// Reads DNS blocklist (DNSBL) answers for the proxy health check. Pure: ipcHandlers.js does the
// DNS lookups and passes the answers here, so the rules can be tested without a network.
//
// Spamhaus ZEN return codes (spamhaus.org/faqs/dnsbl-usage):
//   127.0.0.2         SBL   known spam source
//   127.0.0.3         CSS   spam from many addresses (part of the SBL)
//   127.0.0.4 to .7   XBL   infected or exploited computer
//   127.0.0.9         DROP  hijacked or criminal network
//   127.0.0.10, .11   PBL   Policy Block List
//   127.255.255.x     an error, for example a query through a public resolver: not a listing
//
// The PBL is not a spam or abuse listing. It marks dynamic, residential and mobile ranges that
// should not send mail straight to a mail server, so nearly every home or mobile IP is on it, and
// so is nearly every residential proxy. A PBL-only answer therefore costs no points and is not
// shown as "listed". SBL, CSS, XBL and DROP still count. When several codes come back (PBL plus
// XBL), the worst one wins: the IP is listed.
//
// SpamCop and Barracuda have no such split: any 127.0.0.x answer there means listed.

const SPAMHAUS_ZONE = 'zen.spamhaus.org';

const ZEN_CODES = Object.freeze({
  2: 'SBL', 3: 'CSS', 4: 'XBL', 5: 'XBL', 6: 'XBL', 7: 'XBL', 9: 'DROP', 10: 'PBL', 11: 'PBL'
});

// Plain words for each Spamhaus list, used in the check log.
const ZEN_TEXT = Object.freeze({
  SBL: 'a known spam source',
  CSS: 'spam from many addresses',
  XBL: 'an infected or exploited computer',
  DROP: 'a hijacked or criminal network',
  PBL: 'residential range, not a spam listing'
});

// The one line shown when Spamhaus answered PBL only.
const RESIDENTIAL_NOTE = 'Residential range (Spamhaus PBL), not a spam listing';

const LISTED_RE = /^127\.0\.0\.(\d{1,3})$/;

// One zone's A records -> { outcome, lists }.
//   outcome 'listed'   a real listing (costs points)
//           'policy'   Spamhaus PBL only (no points, shown as a residential range)
//           'clean'    no 127.0.0.x answer: not listed, including the 127.255.255.x error codes
//   lists   the Spamhaus lists that matched ('OTHER' for a code not in the table); [] for other zones
// A Spamhaus code that is not in the table counts as listed, as every code did before this rule.
function classifyAnswer(zone, addrs) {
  const codes = (Array.isArray(addrs) ? addrs : [])
    .map((a) => LISTED_RE.exec(String(a || '').trim()))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  if (!codes.length) return { outcome: 'clean', lists: [] };
  if (String(zone || '').toLowerCase() !== SPAMHAUS_ZONE) return { outcome: 'listed', lists: [] };
  const lists = [...new Set(codes.map((c) => ZEN_CODES[c] || 'OTHER'))];
  return { outcome: lists.every((l) => l === 'PBL') ? 'policy' : 'listed', lists };
}

// results: [{ name, outcome, lists }] -> the blacklist part of a check result:
//   checked      true (the lookups ran; errors and timeouts already count as clean)
//   listed       true when any list really lists the IP
//   sources      names of the lists that really list it (each one costs points)
//   residential  true when Spamhaus answered PBL, alone or with a real listing
//   details      { Spamhaus: ['XBL'] }: the Spamhaus lists behind a real listing, PBL left out
function summarize(results) {
  const rows = Array.isArray(results) ? results : [];
  const sources = rows.filter((r) => r && r.outcome === 'listed').map((r) => r.name);
  const residential = rows.some((r) => r && (r.outcome === 'policy' || (r.lists || []).includes('PBL')));
  const details = {};
  for (const r of rows) {
    if (!r || r.outcome !== 'listed') continue;
    const lists = (r.lists || []).filter((l) => l !== 'PBL');
    if (lists.length) details[r.name] = lists;
  }
  return { checked: true, listed: sources.length > 0, sources, residential, details };
}

// "Spamhaus XBL: an infected or exploited computer, SpamCop" for the check log.
function listingText(bl) {
  if (!bl || !bl.listed || !Array.isArray(bl.sources)) return '';
  return bl.sources.map((name) => {
    const lists = (bl.details && Array.isArray(bl.details[name]) ? bl.details[name] : []).filter((l) => ZEN_TEXT[l]);
    if (!lists.length) return name;
    return `${name} ${lists.map((l) => `${l}: ${ZEN_TEXT[l]}`).join('; ')}`;
  }).join(', ');
}

// The blocklist part of one check-log line: "⚠ blacklisted (...)", the residential note,
// "clean", or '' when the lookups did not run.
function logSuffix(bl) {
  if (!bl || !bl.checked) return '';
  if (bl.listed) return `⚠ blacklisted (${listingText(bl)})`;
  if (bl.residential) return RESIDENTIAL_NOTE;
  return 'clean';
}

module.exports = {
  SPAMHAUS_ZONE,
  ZEN_CODES,
  ZEN_TEXT,
  RESIDENTIAL_NOTE,
  classifyAnswer,
  summarize,
  listingText,
  logSuffix
};
