import { useEffect, useState } from 'react';
import { Database, Lock, Loader2, AlertTriangle, KeyRound } from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';

// Pre-Gate database unlock. When at-rest encryption is on, the database file is
// ciphertext at boot and nothing else in the app can read it — so this screen runs
// BEFORE <Gate>, collects the workspace password, and asks main to decrypt + open
// the database. Once unlocked it renders its children (the normal Gate flow). When
// encryption is off (the default) it is a transparent pass-through.
const inputCls = 'w-full h-10 bg-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary transition-colors placeholder:text-muted-dark font-mono';

export default function DbGate({ children }) {
  const [phase, setPhase] = useState('loading'); // loading | unlock | ready
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [corrupted, setCorrupted] = useState(false);

  async function evaluate() {
    try {
      const s = await softglazeApi.db.encryptionStatus();
      setPhase(s && s.enabled && !s.unlocked ? 'unlock' : 'ready');
    } catch (e) {
      // If we can't even read status, don't block the app — let the normal Gate run.
      setPhase('ready');
    }
  }
  useEffect(() => { evaluate(); }, []);

  async function unlock() {
    setErr('');
    if (!password) return setErr('Enter your workspace password.');
    setBusy(true);
    try {
      const s = await softglazeApi.db.unlock(password);
      if (s && s.unlocked) { setPassword(''); setPhase('ready'); }
      else setErr('The database is still locked — please try again.');
    } catch (e) {
      if (e.code === 'DB_MISSING') {
        setCorrupted(true);
        setErr('The encrypted database file is missing. Restore from a workspace backup to recover.');
      } else if (e.code === 'DB_UNLOCK_FAILED') {
        setCorrupted(true);
        setErr(e.message || 'Incorrect password — or the file is corrupted.');
      } else {
        setErr(e.message || 'Could not unlock the database.');
      }
    } finally { setBusy(false); }
  }

  if (phase === 'ready') return children;
  if (phase === 'loading') {
    return <div className="h-screen w-full bg-background grid place-items-center"><Loader2 className="w-6 h-6 text-muted animate-spin" /></div>;
  }

  return (
    <div className="h-screen w-full bg-background text-foreground font-sans grid place-items-center p-6">
      <div className="w-full max-w-[400px]">
        <div className="flex items-center gap-2.5 mb-7">
          <div className="w-8 h-8 rounded-xl bg-primary text-white grid place-items-center font-display font-bold shadow-glow">S</div>
          <span className="font-display font-semibold tracking-tight">SoftGlaze</span>
        </div>
        <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center mb-4"><Database className="w-5 h-5" /></div>
        <h1 className="font-display text-[20px] font-semibold tracking-tight">Unlock your database</h1>
        <p className="text-[12.5px] text-muted mt-1 mb-6">This workspace's database is encrypted. Enter your workspace password to decrypt and open it.</p>

        <label className="block text-[11px] font-medium text-muted mb-1.5"><KeyRound className="w-3 h-3 inline mr-1" />Workspace password</label>
        <input
          type="password"
          className={inputCls}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Workspace password"
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') unlock(); }}
        />

        {err && (
          <div className="mt-3 flex items-start gap-2 text-[12px] text-red-400">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{err}</span>
          </div>
        )}

        <button disabled={busy} onClick={unlock} className="mt-6 w-full h-10 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-60 shadow-glow transition-colors">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Unlock <Lock className="w-4 h-4" /></>}
        </button>

        {corrupted && (
          <p className="text-[11.5px] text-muted mt-4 leading-relaxed">
            If you're certain the password is right, the database file may be damaged. You can recover by reinstalling and restoring a workspace backup (Settings → Workspace Backup &amp; Restore). There is no password reset — the data can only be opened with the correct password.
          </p>
        )}
      </div>
    </div>
  );
}
