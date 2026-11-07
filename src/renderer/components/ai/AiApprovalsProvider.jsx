import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { softglazeApi } from '@/lib/softglazeApi.js';
import { classifyAiError } from '@/lib/aiCore.mjs';
import { enqueue, isDecision, isGoneError, pruneExpired, removeApproval, syncFromServer } from '@/lib/aiApprovals.mjs';

// One approvals queue for the whole app, mounted once above AppShell. The global dialog, the nav
// badge and the AI page's Approvals tab all read it, so an answer in one place clears it everywhere.
//
// Approvals arrive by the ai:approval-requested event (every member) and by ai.approvals.list()
// (Owner/Admin only; for others it is FORBIDDEN and the event alone feeds the queue). A build
// without the engine rejects with AI_UNAVAILABLE and the provider stays silent.

const EMPTY = {
  available: null,
  canList: false,
  queue: [],
  now: Date.now(),
  hidden: new Set(),
  busy: new Set(),
  notices: [],
  refresh: async () => {},
  respond: async () => ({ ok: false }),
  hide: () => {},
  showAll: () => {},
  clearAll: () => {},
  dismissNotice: () => {}
};

const AiApprovalsContext = createContext(EMPTY);

export function useAiApprovals() {
  return useContext(AiApprovalsContext);
}

export function AiApprovalsProvider({ children }) {
  const [available, setAvailable] = useState(null);
  const [canList, setCanList] = useState(false);
  const [queue, setQueue] = useState([]);
  const [now, setNow] = useState(() => Date.now());
  const [hidden, setHidden] = useState(() => new Set());
  const [busy, setBusy] = useState(() => new Set());
  const [notices, setNotices] = useState([]);
  const noticeSeq = useRef(0);
  const live = useRef(true);

  useEffect(() => () => { live.current = false; }, []);

  const pushNotice = useCallback((kind, approval) => {
    const id = ++noticeSeq.current;
    setNotices((n) => [...n.slice(-2), { id, kind, clientName: approval && approval.clientName, summary: approval && approval.summary }]);
    setTimeout(() => { if (live.current) setNotices((n) => n.filter((x) => x.id !== id)); }, 6000);
  }, []);

  const refresh = useCallback(async () => {
    const requestedAt = Date.now();
    try {
      const list = await softglazeApi.ai.approvals.list();
      if (!live.current) return;
      setQueue((q) => syncFromServer(q, list, requestedAt, Date.now()));
      setCanList(true);
      setAvailable(true);
    } catch (e) {
      if (!live.current) return;
      const kind = classifyAiError(e);
      if (kind === 'unavailable') setAvailable(false);
      else if (kind === 'forbidden') { setCanList(false); setAvailable(true); }
    }
  }, []);

  // Events first, so nothing raised during the first list() call is lost.
  useEffect(() => {
    const off = softglazeApi.ai.onApprovalRequested((raw) => {
      if (!live.current) return;
      setAvailable(true);
      setQueue((q) => enqueue(q, raw, Date.now()));
    });
    refresh();
    return () => { if (typeof off === 'function') off(); };
  }, [refresh]);

  // Re-sync when the window comes back to the front (answers may have happened while away).
  useEffect(() => {
    const onFocus = () => { if (canList) refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [canList, refresh]);

  // One-second clock while anything is waiting: drives the countdowns and drops timed-out requests.
  // The side effect (a notice) stays outside the state updater, which StrictMode may run twice.
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const hasItems = queue.length > 0;
  useEffect(() => {
    if (!hasItems) return undefined;
    setNow(Date.now());
    const id = setInterval(() => {
      const tNow = Date.now();
      setNow(tNow);
      const { expired } = pruneExpired(queueRef.current, tNow);
      if (expired.length) {
        // Pure updater: an approval that arrived since the last render is never overwritten.
        setQueue((q) => pruneExpired(q, tNow).queue);
        expired.forEach((a) => pushNotice('timeout', a));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [hasItems, pushNotice]);

  // Keep the side sets small: forget keys that left the queue.
  useEffect(() => {
    const keys = new Set(queue.map((a) => a._key));
    setHidden((h) => { const n = new Set([...h].filter((k) => keys.has(k))); return n.size === h.size ? h : n; });
    setBusy((b) => { const n = new Set([...b].filter((k) => keys.has(k))); return n.size === b.size ? b : n; });
  }, [queue]);

  const respond = useCallback(async (approval, decision) => {
    if (!approval || !isDecision(decision)) return { ok: false };
    const key = approval._key;
    setBusy((b) => new Set(b).add(key));
    try {
      await softglazeApi.ai.approvals.respond(approval.id, decision);
      if (live.current) setQueue((q) => removeApproval(q, approval.id));
      return { ok: true };
    } catch (e) {
      if (!live.current) return { ok: false };
      if (isGoneError(e)) {
        setQueue((q) => removeApproval(q, approval.id));
        pushNotice('gone', approval);
        return { ok: false, gone: true };
      }
      return { ok: false, error: (e && e.message) || String(e) };
    } finally {
      if (live.current) setBusy((b) => { const n = new Set(b); n.delete(key); return n; });
    }
  }, [pushNotice]);

  const hide = useCallback((key) => setHidden((h) => new Set(h).add(key)), []);
  const showAll = useCallback(() => setHidden(new Set()), []);
  // After Stop all AI: main has denied everything that was waiting.
  const clearAll = useCallback(() => { setQueue([]); setHidden(new Set()); }, []);
  const dismissNotice = useCallback((id) => setNotices((n) => n.filter((x) => x.id !== id)), []);

  const value = useMemo(() => ({
    available, canList, queue, now, hidden, busy, notices,
    refresh, respond, hide, showAll, clearAll, dismissNotice
  }), [available, canList, queue, now, hidden, busy, notices, refresh, respond, hide, showAll, clearAll, dismissNotice]);

  return <AiApprovalsContext.Provider value={value}>{children}</AiApprovalsContext.Provider>;
}
