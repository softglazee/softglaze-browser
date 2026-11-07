'use strict';
// Runs one macro across many profiles with a concurrency cap. Side effects come in through `deps`,
// and status frames carry only whitelisted fields, so they never leak credentials.
const { MAX_PARALLEL } = require('./tierPolicy');

function streamKey(runId, profileId) {
  return `${runId}::p${profileId}`;
}

// First failing step's error message from a runMacro result, if any.
function firstError(res) {
  if (!res || !Array.isArray(res.log)) return undefined;
  const bad = res.log.find((l) => l && l.ok === false);
  if (!bad) return undefined;
  return bad.error || `step ${bad.index} failed`;
}

// Substitutes {{key}} placeholders in `url`/`value`; keys may contain spaces (header names).
// Returns copies, since the same macro object is reused across rows.
function applyVariables(steps, vars) {
  const list = Array.isArray(steps) ? steps : [];
  if (!vars || typeof vars !== 'object') return list.map((s) => ({ ...s }));
  const sub = (text) => String(text).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, rawKey) => {
    const key = String(rawKey).trim();
    const v = vars[key];
    return v == null ? '' : String(v);
  });
  return list.map((step) => {
    const next = { ...step };
    if (typeof next.url === 'string') next.url = sub(next.url);
    if (typeof next.value === 'string') next.value = sub(next.value);
    return next;
  });
}

// deps: isOpen(id), launch(id) -> { sessionId }, runMacro(sid, steps, o) -> { ok, ran, total, log },
// close(sid), emit(key, type, payload). Concurrency is clamped to [1, MAX_PARALLEL] (10); the caller
// applies the plan's lower cap first (tierPolicy.clampConcurrency).
// Frames carry only safe metadata, never step values, cookies or credentials.
async function runParallelMacro(opts, deps) {
  const o = opts || {};
  const runId = String(o.runId || `par-${0}`);
  // One entry per profile: two workers on one session race, and the second close kills the first.
  const seen = new Set();
  const items = (Array.isArray(o.items) ? o.items : []).filter((it) => {
    const k = String(it && it.profileId);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const steps = Array.isArray(o.steps) ? o.steps : [];
  const cap = Math.max(1, Math.min(MAX_PARALLEL, Number(o.concurrency) || 1));
  const continueOnError = o.continueOnError !== false;
  const closeWhenDone = o.closeWhenDone !== false;

  const results = [];
  const summary = { runId, total: items.length, passed: 0, failed: 0, results };

  // Every frame carries runId so the host can fan it to the right renderer.
  const emit = (key, type, payload) => {
    try { deps.emit(key, type, { runId, ...payload }); } catch (_) { /* a status frame must never break a run */ }
  };

  // Roster up front so the console shows every profile as queued immediately.
  for (const it of items) {
    emit(streamKey(runId, it.profileId), 'status', {
      profileId: it.profileId, profileName: it.profileName, state: 'queued'
    });
  }

  let cursor = 0;
  async function runOne(it) {
    const profileId = it.profileId;
    const key = streamKey(runId, profileId);
    const base = { profileId, profileName: it.profileName };
    const stepsForRow = applyVariables(steps, it.vars);
    let sessionId = String(profileId);
    let launched = false;
    let res = null;
    try {
      const open = await deps.isOpen(profileId);
      if (open) {
        emit(key, 'status', { ...base, state: 'launching', message: 'Using already-open session.' });
      } else {
        emit(key, 'status', { ...base, state: 'launching' });
        const launchRes = await deps.launch(profileId);
        sessionId = launchRes && launchRes.sessionId ? String(launchRes.sessionId) : sessionId;
        // Only close sessions this run started; an already-open profile (the user's window) must survive.
        launched = !(launchRes && launchRes.alreadyRunning);
      }

      emit(key, 'status', { ...base, state: 'running', total: stepsForRow.length });
      res = await deps.runMacro(sessionId, stepsForRow, { continueOnError });

      const passed = Boolean(res && res.ok);
      if (passed) summary.passed += 1; else summary.failed += 1;
      emit(key, 'status', {
        ...base,
        state: passed ? 'passed' : 'failed',
        ran: res ? res.ran : 0,
        total: res ? res.total : stepsForRow.length,
        error: passed ? undefined : firstError(res)
      });
      results.push({ profileId, ok: passed, ran: res ? res.ran : 0, total: res ? res.total : stepsForRow.length });
    } catch (e) {
      summary.failed += 1;
      const message = (e && e.message) ? e.message : 'Run failed.';
      emit(key, 'status', { ...base, state: 'failed', error: message });
      results.push({ profileId, ok: false, error: message });
    } finally {
      if (launched && closeWhenDone) {
        try { await deps.close(sessionId); } catch (_) { /* best-effort cleanup */ }
      }
    }
  }

  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await runOne(items[index]);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(cap, items.length); i += 1) workers.push(worker());
  await Promise.all(workers);

  // Run-level terminator (no profileId) so the renderer can flip "running" off.
  emit(String(runId), 'status', { state: 'done', total: summary.total, passed: summary.passed, failed: summary.failed });
  return summary;
}

module.exports = { runParallelMacro, applyVariables };
