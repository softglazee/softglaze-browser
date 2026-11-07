'use strict';
// Audit trail of AI and Local API tool calls: token, client, tool, a one-line summary, redacted
// arguments, outcome, approval path and duration. Writing never throws, so logging cannot break a
// call. The database is passed in.
const { redactArgs, scrubText } = require('./redact');

const OUTCOMES = Object.freeze(['ok', 'denied', 'error', 'pending']);
const KEEP_ROWS = 20000;
const APPROVAL_MAX = 40;
const PRUNE_EVERY = 500;
let writesSincePrune = 0;

async function record(db, entry) {
  const e = entry || {};
  const outcome = OUTCOMES.includes(e.outcome) ? e.outcome : 'error';
  let argsJson = null;
  try { argsJson = JSON.stringify(redactArgs(e.args || {})).slice(0, 4000); } catch (err) { argsJson = null; }
  try {
    const row = await db.aiAuditLog.create({
      data: {
        tokenId: e.tokenId == null ? null : Number(e.tokenId),
        tokenName: e.tokenName ? String(e.tokenName).slice(0, 80) : null,
        memberId: e.memberId == null ? null : Number(e.memberId),
        clientName: e.clientName ? String(e.clientName).slice(0, 80) : null,
        transport: e.transport ? String(e.transport).slice(0, 10) : null,
        tool: String(e.tool || 'unknown').slice(0, 60),
        summary: e.summary ? scrubText(e.summary).slice(0, 300) : null,
        argsJson,
        outcome,
        // 40 keeps the longest approval path ("started-by-this-token", 21) whole.
        approval: e.approval ? String(e.approval).slice(0, APPROVAL_MAX) : null,
        error: e.error ? scrubText(e.error).slice(0, 500) : null,
        durationMs: Math.max(0, Math.round(Number(e.durationMs) || 0))
      }
    });
    writesSincePrune += 1;
    if (writesSincePrune >= PRUNE_EVERY) { writesSincePrune = 0; prune(db).catch(() => {}); }
    return row;
  } catch (err) {
    return null;
  }
}

// Keeps the newest KEEP_ROWS rows.
async function prune(db, keep = KEEP_ROWS) {
  const cutoff = await db.aiAuditLog.findMany({ orderBy: { id: 'desc' }, skip: keep, take: 1, select: { id: true } });
  if (!cutoff.length) return 0;
  const res = await db.aiAuditLog.deleteMany({ where: { id: { lte: cutoff[0].id } } });
  return res.count || 0;
}

function serialize(row) {
  let args = {};
  try { args = row.argsJson ? JSON.parse(row.argsJson) : {}; } catch (e) { args = {}; }
  return {
    id: row.id,
    at: row.at instanceof Date ? row.at.toISOString() : row.at,
    tokenId: row.tokenId == null ? null : row.tokenId,
    tokenName: row.tokenName || null,
    clientName: row.clientName || null,
    transport: row.transport || null,
    tool: row.tool,
    summary: row.summary || '',
    args,
    outcome: row.outcome,
    approval: row.approval || null,
    error: row.error || null,
    durationMs: row.durationMs || 0
  };
}

// Pages newest first. q: { cursor (an id from nextCursor), limit (1-200, default 50), tokenId,
// tool, outcome, clientName (exact), search (text in the tool, summary or token name) }. Filters
// apply before paging. Returns { items, nextCursor } (nextCursor null on the last page).
async function list(db, q = {}) {
  const input = (q && typeof q === 'object') ? q : {};
  const limit = Math.max(1, Math.min(200, Number.parseInt(input.limit, 10) || 50));
  const where = {};
  if (input.tokenId != null && input.tokenId !== '') where.tokenId = Number(input.tokenId);
  if (input.tool) where.tool = String(input.tool);
  if (input.outcome && OUTCOMES.includes(String(input.outcome))) where.outcome = String(input.outcome);
  if (input.clientName) where.clientName = String(input.clientName).slice(0, 80);
  const search = input.search == null ? '' : String(input.search).trim().slice(0, 100);
  if (search) where.OR = [{ tool: { contains: search } }, { summary: { contains: search } }, { tokenName: { contains: search } }];
  const cursor = Number.parseInt(input.cursor, 10);
  if (Number.isInteger(cursor) && cursor > 0) where.id = { lt: cursor };
  const rows = await db.aiAuditLog.findMany({ where, orderBy: { id: 'desc' }, take: limit + 1 });
  const items = rows.slice(0, limit).map(serialize);
  const nextCursor = rows.length > limit ? items[items.length - 1].id : null;
  return { items, nextCursor };
}

module.exports = { record, list, prune, serialize, OUTCOMES, KEEP_ROWS, APPROVAL_MAX };
