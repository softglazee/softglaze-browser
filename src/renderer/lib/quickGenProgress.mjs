// What the Quick generate modal shows for a progress frame from main (batchGenerateHandler):
//   { phase: 'check', checked, total, working, failed, needed }   live proxy check
//   { phase: 'create', done, created, toCreate, requested, failed } profile creation
//   { phase: 'done', created, requested, cancelled }                the run ended
// Pure and framework-free so node:test can exercise it.
//
// Returns { phase: 'start' | 'check' | 'create', checked, total, working, done, percent, shortfall }.
// shortfall is { requested, available } when fewer working proxies were found than profiles asked
// for (one unique proxy per profile), so the modal can say "80 requested, only 61 working proxies".
export function quickGenProgressView(frame, { requested = 0, uniqueProxies = false } = {}) {
  const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
  const pct = (a, b) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);
  const base = { phase: 'start', checked: 0, total: num(requested), working: 0, done: 0, percent: 0, shortfall: null };
  if (!frame || typeof frame !== 'object') return base;

  if (frame.phase === 'check') {
    const checked = num(frame.checked);
    const total = num(frame.total);
    const working = num(frame.working);
    const needed = num(frame.needed);
    // The scan also ends early once enough proxies work, so whichever is further along counts.
    const percent = Math.max(pct(checked, total), pct(working, needed));
    return { ...base, phase: 'check', checked, total, working, percent };
  }

  if (frame.phase === 'create') {
    const toCreate = num(frame.toCreate);
    const asked = num(frame.requested) || num(requested);
    const done = num(frame.done);
    const shortfall = uniqueProxies && toCreate < asked ? { requested: asked, available: toCreate } : null;
    return { ...base, phase: 'create', total: toCreate, done, percent: pct(done, toCreate), shortfall };
  }

  if (frame.phase === 'done') {
    const created = num(frame.created);
    return { ...base, phase: 'create', total: num(frame.requested) || created, done: created, percent: 100 };
  }

  return base;
}
