import { useCallback, useEffect, useState } from 'react';
import { Database, Lock, KeyRound, ShieldCheck, AlertTriangle, Loader2, Check, ChevronDown } from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';

// Full-database encryption at rest (Phase 6). Honest by design: it never claims
// runtime protection it doesn't provide, it's OFF until the user opts in, and
// enabling forces an explicit acknowledgement that a lost password is unrecoverable.
export default function DbEncryptionSettings() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false); // expand the enable/disable panel

  const [password, setPassword] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const s = await softglazeApi.db.encryptionStatus();
      setStatus(s);
    } catch (e) { setErr(e.message || 'Could not read encryption status.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return null;

  const enabled = Boolean(status?.enabled);

  async function enable() {
    setErr(''); setMsg('');
    if (!password) return setErr('Enter your workspace password.');
    if (!ack) return setErr('Please confirm you understand the recovery risk.');
    setBusy('enable');
    try {
      const s = await softglazeApi.db.enableEncryption({ password, confirm: true });
      setStatus(s); setPassword(''); setAck(false); setOpen(false);
      setMsg('Database encryption is on. The database file is now encrypted whenever the app is closed.');
    } catch (e) {
      setErr(e.message || 'Could not enable encryption.');
    } finally { setBusy(''); }
  }

  async function disable() {
    setErr(''); setMsg('');
    if (!password) return setErr('Enter your workspace password to confirm.');
    setBusy('disable');
    try {
      const s = await softglazeApi.db.disableEncryption({ password });
      setStatus(s); setPassword(''); setOpen(false);
      setMsg('Database encryption is off. The database is stored as plaintext again.');
    } catch (e) {
      setErr(e.message || 'Could not disable encryption.');
    } finally { setBusy(''); }
  }

  const inputCls = 'w-full h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary font-mono';
  const labelCls = 'block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2';
  const tone = enabled ? { color: '#10b981', label: 'Encrypted at rest' } : { color: '#9ca3af', label: 'Off' };

  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-lg grid place-items-center shrink-0" style={{ background: 'color-mix(in srgb, #6366f1 14%, transparent)', border: '1px solid color-mix(in srgb, #6366f1 24%, transparent)' }}><Database className="w-5 h-5 text-indigo-400" /></span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Database Encryption <span className="text-[10px] font-medium text-muted-foreground align-middle">(at rest)</span></h3>
            <p className="text-xs text-muted-foreground">Encrypt the entire workspace database with your workspace password.</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0" style={{ background: `color-mix(in srgb, ${tone.color} 14%, transparent)`, color: tone.color, border: `1px solid color-mix(in srgb, ${tone.color} 26%, transparent)` }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone.color }} />{tone.label}
        </span>
      </div>

      {/* Honest scope statement — never overclaim */}
      <div className="mt-4 px-3 py-2.5 rounded-lg bg-elevated border border-border text-[12px] text-muted-foreground leading-relaxed">
        When the app is closed, the database is stored only as encrypted ciphertext that a file reader cannot open. While the app is <span className="text-foreground">running and unlocked</span>, a working copy is decrypted on disk so the app can use it — so this protects a stolen or copied drive, not a live, running machine.
      </div>

      {!enabled && (
        <div className="mt-3 flex items-start gap-2 px-3 py-2.5 rounded-lg text-[12px]" style={{ background: 'color-mix(in srgb, #6366f1 10%, transparent)', border: '1px solid color-mix(in srgb, #6366f1 22%, transparent)' }}>
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-indigo-400" />
          <span className="text-muted-foreground"><span className="text-foreground font-medium">Recommended.</span> This is the most complete way to protect <span className="text-foreground">proxy passwords</span>, 2FA seeds, saved cookies and account data at rest — it encrypts every field, not just some. Make a workspace backup first, then turn it on below.</span>
        </div>
      )}

      {enabled && (
        <div className="mt-3 flex items-start gap-2 px-3 py-2.5 rounded-lg text-[12px]" style={{ background: 'color-mix(in srgb, #10b981 10%, transparent)', color: '#10b981', border: '1px solid color-mix(in srgb, #10b981 22%, transparent)' }}>
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
          <span>On next launch you'll be asked to unlock the database with your workspace password before the app opens.</span>
        </div>
      )}

      <div className="mt-4">
        <button onClick={() => { setOpen((v) => !v); setErr(''); setMsg(''); }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-semibold text-foreground bg-secondary hover:bg-secondary/70">
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          {enabled ? 'Turn off encryption' : 'Turn on encryption'}
        </button>
      </div>

      {open && !enabled && (
        <div className="mt-4 pt-4 border-t border-border space-y-3.5">
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[12px] text-amber-400">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span><strong>Read this first.</strong> Encryption uses your workspace password as the key. If you forget it, your data <strong>cannot be recovered</strong> — there is no backdoor and no reset. Make a workspace backup before enabling.</span>
          </div>
          <div>
            <label className={labelCls}><KeyRound className="w-3 h-3 inline mr-1" />Workspace password</label>
            <input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your workspace (vault) password" />
          </div>
          <label className="flex items-start gap-2.5 text-[12.5px] text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={Boolean(ack)} onChange={(e) => setAck(e.target.checked)} className="accent-indigo-500 mt-0.5" />
            <span>I understand that if I lose this password, the encrypted database is permanently unrecoverable.</span>
          </label>
          <button onClick={enable} disabled={busy === 'enable'} className="h-9 px-5 rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-600 text-white font-semibold text-[12.5px] inline-flex items-center gap-2 disabled:opacity-60 shadow-lg shadow-indigo-500/25">
            {busy === 'enable' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />} Encrypt database
          </button>
        </div>
      )}

      {open && enabled && (
        <div className="mt-4 pt-4 border-t border-border space-y-3.5">
          <p className="text-[12px] text-muted-foreground">Turning encryption off decrypts the database back to plaintext on this device. Enter your workspace password to confirm.</p>
          <div>
            <label className={labelCls}><KeyRound className="w-3 h-3 inline mr-1" />Workspace password</label>
            <input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your workspace (vault) password" />
          </div>
          <button onClick={disable} disabled={busy === 'disable'} className="h-9 px-5 rounded-lg bg-secondary hover:bg-secondary/70 text-foreground font-semibold text-[12.5px] inline-flex items-center gap-2 disabled:opacity-60">
            {busy === 'disable' ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Turn off encryption
          </button>
        </div>
      )}

      {msg && <p className="mt-3 text-[12px] text-emerald-400 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" />{msg}</p>}
      {err && <p className="mt-3 text-[12px] text-red-400">{err}</p>}
    </div>
  );
}
