// State for the Connect tab's "Use a profile with Playwright MCP or Chrome DevTools MCP (advanced)"
// card (Owner only). Pure, so test/aiDevtoolsCard.test.js can drive it without a window.
//
// The DevTools address reaches the renderer only from ai:devtools-endpoint, which the card calls
// when the Owner presses Show. It lives in `reveal` and nowhere else, and every way out of that
// moment clears it: Hide, another profile, closing the card, the profile stopping.

export const DEVTOOLS_DOCS_URL = 'https://browser.softglaze.com/docs/ai-playwright-devtools';
export const DEVTOOLS_TOOLS = Object.freeze(['playwright', 'chrome-devtools']);
export const DEVTOOLS_CLIENTS = Object.freeze(['claude-code', 'claude-desktop', 'cursor', 'vscode']);
// Product names, the same in every language.
export const DEVTOOLS_TOOL_LABELS = Object.freeze({ playwright: 'Playwright MCP', 'chrome-devtools': 'Chrome DevTools MCP' });
// MCP server names in the setups (src/main/ai/devtoolsSnippets.js), for "claude mcp remove <name>".
export const DEVTOOLS_SERVER_NAMES = Object.freeze({ playwright: 'playwright-softglaze', 'chrome-devtools': 'chrome-devtools-softglaze' });
// What the address looks like before Show: the shape, never the port or the browser id.
export const MASKED_ENDPOINT = 'ws://127.0.0.1:•••••/devtools/browser/•••';
// The running list is re-read this often while the card is open (sessions also end when someone
// closes the browser window, and starts are not pushed to the AI page).
export const SESSION_POLL_MS = 4000;

export const initialDevtools = Object.freeze({
  sessions: [],
  loaded: false,
  loadError: '',
  profileId: null,
  tool: 'playwright',
  client: 'claude-code',
  noUsageStats: true,
  reveal: null, // { profileId, wsEndpoint, snippets, snippetsWithUsageStats } after Show
  busy: false,
  error: '',
  stopped: null // { profileId, name }: the profile whose shown address just stopped working
});

// ai:devtools-sessions rows, cleaned up: { profileId, name, engine: 'chromium' | 'firefox' }.
export function normalizeSessions(list) {
  const out = [];
  const seen = new Set();
  for (const s of Array.isArray(list) ? list : []) {
    const profileId = Number(s && s.profileId);
    if (!Number.isSafeInteger(profileId) || profileId <= 0 || seen.has(profileId)) continue;
    if (s.running === false) continue;
    seen.add(profileId);
    out.push({
      profileId,
      name: s.name ? String(s.name) : `#${profileId}`,
      engine: s.engine === 'firefox' ? 'firefox' : 'chromium'
    });
  }
  return out;
}

const isChromium = (sessions, id) => sessions.some((s) => s.profileId === id && s.engine === 'chromium');
const firstChromium = (sessions) => { const s = sessions.find((x) => x.engine === 'chromium'); return s ? s.profileId : null; };
const nameOf = (sessions, id) => { const s = sessions.find((x) => x.profileId === id); return s ? s.name : `#${id}`; };

// The selected profile ended: forget its address and say so.
function endSelected(state, sessions) {
  return {
    ...state,
    sessions,
    profileId: null,
    reveal: null,
    busy: false,
    error: '',
    stopped: { profileId: state.profileId, name: nameOf(state.sessions, state.profileId) }
  };
}

export function devtoolsReducer(state, action) {
  const a = action || {};
  switch (a.type) {
    case 'sessions': {
      const sessions = normalizeSessions(a.list);
      const base = { ...state, sessions, loaded: true, loadError: '' };
      if (state.profileId != null && !isChromium(sessions, state.profileId)) {
        // The chosen profile is no longer running. With its address shown (or on its way), say so;
        // otherwise move on to the next running Chromium profile.
        if (state.reveal || state.busy) return endSelected(state, sessions);
        return { ...base, profileId: state.stopped ? null : firstChromium(sessions), error: '' };
      }
      // First pick: the first running Chromium profile, unless a stop notice is up.
      if (state.profileId == null && !state.stopped) return { ...base, profileId: firstChromium(sessions) };
      return base;
    }
    case 'loadFailed':
      return { ...state, loaded: true, loadError: String(a.message || '') };
    case 'select': {
      const id = Number(a.profileId);
      if (!isChromium(state.sessions, id)) return state;
      if (id === state.profileId) return { ...state, stopped: null };
      return { ...state, profileId: id, reveal: null, busy: false, error: '', stopped: null };
    }
    case 'tool':
      return DEVTOOLS_TOOLS.includes(a.tool) ? { ...state, tool: a.tool } : state;
    case 'client':
      return DEVTOOLS_CLIENTS.includes(a.client) ? { ...state, client: a.client } : state;
    case 'usageStats':
      return { ...state, noUsageStats: Boolean(a.off) };
    case 'showStart':
      return state.profileId == null ? state : { ...state, busy: true, error: '', stopped: null };
    case 'showDone': {
      const r = a.result || {};
      // A late answer for a profile that is no longer selected (or stopped meanwhile) is dropped.
      if (Number(a.profileId) !== state.profileId || !state.busy) return state;
      if (!r.wsEndpoint || !Array.isArray(r.snippets)) return { ...state, busy: false, error: String(a.emptyMessage || '') };
      return {
        ...state,
        busy: false,
        error: '',
        reveal: {
          profileId: state.profileId,
          wsEndpoint: String(r.wsEndpoint),
          snippets: r.snippets,
          snippetsWithUsageStats: Array.isArray(r.snippetsWithUsageStats) ? r.snippetsWithUsageStats : r.snippets
        }
      };
    }
    case 'showFailed':
      if (Number(a.profileId) !== state.profileId || !state.busy) return state;
      return { ...state, busy: false, reveal: null, error: String(a.message || '') };
    case 'hide':
      return { ...state, reveal: null, busy: false };
    case 'ended': {
      const id = Number(a.profileId);
      const sessions = state.sessions.filter((s) => s.profileId !== id);
      if (id === state.profileId) return endSelected(state, sessions);
      return { ...state, sessions };
    }
    case 'closed':
      // Collapsing the card forgets the address; opening it again starts masked.
      return { ...state, reveal: null, busy: false, error: '', stopped: null };
    default:
      return state;
  }
}

// The setup to show for the chosen server and app, or null before Show.
export function currentSnippet(state) {
  if (!state || !state.reveal) return null;
  const list = state.noUsageStats ? state.reveal.snippets : state.reveal.snippetsWithUsageStats;
  return (list || []).find((s) => s && s.tool === state.tool && s.client === state.client) || null;
}

export function hasChromium(sessions) {
  return (sessions || []).some((s) => s.engine === 'chromium');
}
