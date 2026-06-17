import { useEffect, useState } from 'react';
import { Lock, ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';

const inputCls = 'w-full h-10 bg-background border border-border rounded-lg px-3 text-[13px] text-zinc-100 outline-none focus:border-primary transition-colors';

export default function Gate({ children }) {
  const [phase, setPhase] = useState('loading'); // loading | register | lock | pick | ready
  const [members, setMembers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const [rName, setRName] = useState('');
  const [rEmail, setREmail] = useState('');
  const [rPass, setRPass] = useState('');
  const [unlockPass, setUnlockPass] = useState('');
  const [pinFor, setPinFor] = useState(null);
  const [pin, setPin] = useState('');

  async function evaluate() {
    try {
      const [vs, cur, list] = await Promise.all([
        softglazeApi.vault.status().catch(() => ({ enabled: false, locked: false })),
        softglazeApi.members.current().catch(() => null),
        softglazeApi.members.list().catch(() => [])
      ]);
      const ms = Array.isArray(list) ? list : [];
      setMembers(ms);
      if (vs && vs.locked) { setPhase('lock'); return; }
      if (ms.length === 0) { setPhase('register'); return; }
      if (!cur) { setPhase('pick'); return; }
      setPhase('ready');
    } catch (e) {
      setPhase('ready'); // never block the app if the members/vault API is unavailable
    }
  }
  useEffect(() => { evaluate(); }, []);

  async function handleRegister() {
    setErr('');
    if (!rName.trim()) { setErr('Enter your name.'); return; }
    setBusy(true);
    try {
      const m = await softglazeApi.members.create({ name: rName.trim(), email: rEmail.trim() || undefined });
      await softglazeApi.members.switch(m.id);
      if (rPass) await softglazeApi.vault.setPassword({ password: rPass });
      setPhase('ready');
    } catch (e) { setErr(e.message || 'Could not create your workspace.'); }
    finally { setBusy(false); }
  }
  async function handleUnlock() {
    setErr(''); setBusy(true);
    try { await softglazeApi.vault.unlock(unlockPass); setUnlockPass(''); await evaluate(); }
    catch (e) { setErr(e.message || 'Incorrect password.'); }
    finally { setBusy(false); }
  }
  async function handlePick(m) {
    setErr('');
    if (m.hasPin && pinFor !== m.id) { setPinFor(m.id); setPin(''); return; }
    setBusy(true);
    try { await softglazeApi.members.switch(m.id, m.hasPin ? pin : undefined); setPhase('ready'); }
    catch (e) { setErr(e.message || 'Could not sign in.'); }
    finally { setBusy(false); }
  }

  if (phase === 'ready') return children;
  if (phase === 'loading') {
    return <div className="h-screen w-full bg-background grid place-items-center"><Loader2 className="w-6 h-6 text-muted animate-spin" /></div>;
  }

  return (
    <div className="h-screen w-full bg-background text-zinc-100 grid place-items-center font-sans">
      <div className="w-[384px]">
        <div className="flex items-center gap-2.5 mb-7 justify-center">
          <div className="w-9 h-9 rounded-xl bg-primary text-white grid place-items-center font-display font-bold text-lg shadow-glow">S</div>
          <span className="font-display font-semibold text-lg tracking-tight">SoftGlaze</span>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 shadow-2xl shadow-black/40">
          {phase === 'register' && (
            <>
              <h1 className="font-display text-[17px] font-semibold mb-1">Create your workspace</h1>
              <p className="text-[12.5px] text-muted mb-5">You'll be the owner. You can add teammates later from Members.</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-muted mb-1.5">Your name</label>
                  <input className={inputCls} value={rName} onChange={(e) => setRName(e.target.value)} placeholder="e.g. Mathijs" autoFocus />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted mb-1.5">Email <span className="text-muted-dark">(optional)</span></label>
                  <input className={inputCls} value={rEmail} onChange={(e) => setREmail(e.target.value)} placeholder="you@workspace.com" />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted mb-1.5">Master password <span className="text-muted-dark">(optional — locks the app)</span></label>
                  <input type="password" className={inputCls} value={rPass} onChange={(e) => setRPass(e.target.value)} placeholder="Leave blank to skip" />
                </div>
              </div>
              {err && <p className="text-[12px] text-red-400 mt-3">{err}</p>}
              <button disabled={busy} onClick={handleRegister} className="mt-5 w-full h-10 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-60 shadow-glow transition-colors">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Create workspace <ArrowRight className="w-4 h-4" /></>}
              </button>
              <button onClick={() => setPhase('ready')} className="mt-2 w-full h-9 rounded-lg text-[12.5px] text-muted-dark hover:text-muted">Skip for now</button>
            </>
          )}

          {phase === 'lock' && (
            <>
              <div className="flex items-center gap-2 mb-1"><Lock className="w-4 h-4 text-primary" /><h1 className="font-display text-[17px] font-semibold">Workspace locked</h1></div>
              <p className="text-[12.5px] text-muted mb-5">Enter your master password to continue.</p>
              <input type="password" className={inputCls} value={unlockPass} autoFocus onChange={(e) => setUnlockPass(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleUnlock(); }} placeholder="Master password" />
              {err && <p className="text-[12px] text-red-400 mt-3">{err}</p>}
              <button disabled={busy} onClick={handleUnlock} className="mt-5 w-full h-10 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-60 shadow-glow transition-colors">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Unlock'}
              </button>
            </>
          )}

          {phase === 'pick' && (
            <>
              <h1 className="font-display text-[17px] font-semibold mb-1">Who's working?</h1>
              <p className="text-[12.5px] text-muted mb-5">Select your member profile to continue.</p>
              <div className="space-y-1.5">
                {members.map((m) => (
                  <div key={m.id}>
                    <button onClick={() => handlePick(m)} className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-border hover:border-muted-dark hover:bg-white/5 transition-colors text-left">
                      <span className="w-9 h-9 rounded-full grid place-items-center text-[12px] font-semibold" style={{ background: (m.color || '#6366f1') + '22', color: m.color || '#6366f1' }}>{m.initials}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium truncate">{m.name}</span>
                        <span className="block text-[11px] text-muted-dark capitalize">{String(m.role || '').toLowerCase()}{m.hasPin ? ' · PIN' : ''}</span>
                      </span>
                      {m.status === 'suspended' && <span className="text-[10.5px] text-red-400">Suspended</span>}
                    </button>
                    {pinFor === m.id && (
                      <div className="flex items-center gap-2 mt-1.5 mb-1">
                        <input type="password" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handlePick(m); }} placeholder="Enter PIN" className={inputCls} />
                        <button disabled={busy} onClick={() => handlePick(m)} className="h-10 px-4 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[12.5px]">Go</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {err && <p className="text-[12px] text-red-400 mt-3">{err}</p>}
            </>
          )}
        </div>

        {phase !== 'pick' && (
          <p className="text-center text-[11px] text-muted-dark mt-5 flex items-center justify-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" /> Local-first · nothing leaves this device
          </p>
        )}
      </div>
    </div>
  );
}