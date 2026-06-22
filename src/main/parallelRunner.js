'use strict';
// ---------------------------------------------------------------------------
// Softglaze Enterprise — Parallel Macro Runner (pure orchestration)
//
// Runs ONE macro across MANY profiles with a hard concurrency cap, streaming a
// REDACTED live status of each profile's run. Every side-effect (launch / run /
// close / emit) is injected, so:
//   • this module is unit-testable without Electron or a real browser, and
//   • the live stream can never accidentally carry credentials — frame payloads
//     are built from a strict whitelist of safe fields and the caller additionally
//     routes them through the relay's `sanitizeFrame` (defense-in-depth).
//
// It reuses the existing primitives via `deps` (launchProfileSession/runMacro/
// closeProfileSession in production) — it does NOT reimplement launching, the
// macro engine, history, or an event bus. The relay framing carries progress.
// ---------------------------------------------------------------------------

// Stable per-profile stream key for one run (so frames group cleanly).
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

// Substitute {{key}} placeholders in a macro's `url` / `value` fields from a data
// row. Header names may contain spaces, so the key is everything between the
// braces (trimmed). Returns a shallow copy per step — the originals are never
// mutated (the same macro object is reused across rows).
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

// Run `steps` across `items` with at most `concurrency` profiles in flight.
//
//   items        : [{ profileId, profileName, vars }]
//   steps        : base macro steps (per-item variable substitution applied here)
//   concurrency  : worker cap, clamped to [1, 10]
//   continueOnError / closeWhenDone : forwarded run options
//
//   deps.isOpen(profileId)        -> boolean (is a session already open?)
//   deps.launch(profileId)        -> { sessionId }      (launch one)
//   deps.runMacro(sid, steps, o)  -> { ok, ran, total, log }
//   deps.close(sessionId)         -> void               (close one)
//   deps.emit(key, type, payload) -> void               (relay.emitFrame)
//
// Emits ONLY safe metadata: { runId, profileId, profileName, state, stepIndex?,
// stepType?, ran?, total?, error? }. Never step values, cookies, or credentials.
async function runParallelMacro(opts, deps) {
  const o = opts || {};
  const runId = String(o.runId || `par-${0}`);
  const items = Array.isArray(o.items) ? o.items.slice() : [];
  const steps = Array.isArray(o.steps) ? o.steps : [];
  const cap = Math.max(1, Math.min(10, Number(o.concurrency) || 1));
  const continueOnError = o.continueOnError !== false;
  const closeWhenDone = o.closeWhenDone !== false;

  const results = [];
  const summary = { runId, total: items.length, passed: 0, failed: 0, results };

  // Every frame carries runId so the host can fan it to the right renderer.
  const emit = (key, type, payload) => {
    try { deps.emit(key, type, { runId, ...payload }); } catch (_) { /* auditing must never break a run */ }
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
        launched = true;
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

module.exports = { runParallelMacro, applyVariables, streamKey, firstError };
