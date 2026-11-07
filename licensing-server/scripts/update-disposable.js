'use strict';
// Refreshes src/data/disposable-domains.json from the open-source disposable-email-domains list
// (https://github.com/disposable-email-domains/disposable-email-domains, CC0 1.0 public domain
// dedication, so it may be copied and shipped without conditions).
//
//   node scripts/update-disposable.js                 fetch the current list from GitHub
//   node scripts/update-disposable.js --from FILE     use a downloaded disposable_email_blocklist.conf
//        [--commit SHA]                               record which upstream commit it came from
//
// Commit the changed JSON and deploy; the server loads it at start. Domains the owner wants to allow
// anyway go in the admin settings (email.domainAllowlist) or EMAIL_DOMAIN_ALLOWLIST, not here.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const SOURCE = 'https://github.com/disposable-email-domains/disposable-email-domains';
const RAW = 'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf';
const COMMITS = 'https://api.github.com/repos/disposable-email-domains/disposable-email-domains/commits/main';
const OUT = path.join(__dirname, '..', 'src', 'data', 'disposable-domains.json');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'softglaze-licensing-update-disposable' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`${url} -> HTTP ${res.statusCode}`)); return; }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    }).on('error', reject).setTimeout(30000, function onTimeout() { this.destroy(new Error('timed out')); });
  });
}

// One domain per line; # comments and blanks ignored. Lowercase, de-duplicated, sorted.
function parseList(text) {
  const out = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const d = line.replace(/#.*/, '').trim().toLowerCase();
    if (d && /^[a-z0-9.-]+\.[a-z0-9-]+$/.test(d)) out.add(d);
  }
  return [...out].sort();
}

async function main() {
  const args = process.argv.slice(2);
  const fromIdx = args.indexOf('--from');
  const commitIdx = args.indexOf('--commit');
  let text;
  let commit = commitIdx >= 0 ? args[commitIdx + 1] : null;
  if (fromIdx >= 0) {
    text = fs.readFileSync(args[fromIdx + 1], 'utf8');
  } else {
    text = await get(RAW);
    if (!commit) {
      try { commit = JSON.parse(await get(COMMITS)).sha || null; } catch (_) { commit = null; }
    }
  }
  const domains = parseList(text);
  if (domains.length < 1000) throw new Error(`Only ${domains.length} domains parsed; refusing to replace the list.`);
  const doc = {
    source: SOURCE,
    licence: 'CC0-1.0 (public domain dedication)',
    upstreamCommit: commit,
    fetchedAt: new Date().toISOString(),
    count: domains.length,
    domains
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');
  console.log(`Wrote ${domains.length} domains to ${path.relative(process.cwd(), OUT)}${commit ? ` (upstream ${commit.slice(0, 7)})` : ''}.`);
}

if (require.main === module) {
  main().catch((e) => { console.error('update-disposable failed:', e.message); process.exitCode = 1; });
}

module.exports = { parseList };
