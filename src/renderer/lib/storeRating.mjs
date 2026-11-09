// Microsoft Store rating card: the renderer's half of "when to ask". Main decides the rest (Store build,
// 3 different days, 5 profile launches, Not now / Don't ask again / Rate, licence state; see
// src/main/storeRating.js). Pure and framework-free so node:test can exercise it.
//
// The card shows only on the Dashboard after a normal start: never in a run of the app that showed the
// first-run, sign-up, email-code, plan (trial ended) or blocked screen. Gate.jsx reports each screen it
// shows through noteGatePhase; the Dashboard asks main only when normalStart() is still true.

export const INTERRUPTED_START_PHASES = Object.freeze(['register', 'confirm', 'confirmMember', 'plan', 'banned', 'super']);

let interrupted = false;

export function noteGatePhase(phase) {
  if (INTERRUPTED_START_PHASES.includes(String(phase || ''))) interrupted = true;
}

export function normalStart() {
  return !interrupted;
}

// status: main's { storeBuild, ask }.
export function showRatingCard(status, normal = normalStart()) {
  return Boolean(normal && status && status.storeBuild === true && status.ask === true);
}

// The permanent "Rate SoftGlaze Browser" entry: every Store build, whatever the card's state.
export function showRatingEntry(status) {
  return Boolean(status && status.storeBuild === true);
}

export function _resetForTests() {
  interrupted = false;
}
