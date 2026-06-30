import { useEffect, useMemo, useRef, useState } from 'react';
import {
  UserCog, Camera, Loader2, ShieldCheck, Mail, KeyRound, CheckCircle2,
  AlertTriangle, X, Save, Eye, EyeOff
} from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { useDialog } from '@/lib/useDialog.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // ~2 MB before base64 expansion

export default function AccountSettingsPage() {
  const [me, setMe] = useState(undefined); // undefined = loading
  const [loadErr, setLoadErr] = useState('');

  // editable fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(''); // data URI / path or ''
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');

  // verification modal state
  const [verify, setVerify] = useState(null); // { changes, sentTo, devCode } | null
  const fileRef = useRef(null);

  const editable = me && me.role !== 'SUPER_ADMIN' && me.id >= 0;

  function hydrate(m) {
    setMe(m);
    setName(m?.name || '');
    setEmail(m?.email || '');
    setAvatarUrl(m?.avatarUrl || '');
    setNewPassword('');
    setConfirmPassword('');
  }

  useEffect(() => {
    softglazeApi.members.current()
      .then((m) => hydrate(m || null))
      .catch((e) => { setLoadErr(e.message || 'Could not load your account.'); setMe(null); });
  }, []);

  const nameChanged = me ? name.trim() !== (me.name || '') : false;
  const avatarChanged = me ? (avatarUrl || '') !== (me.avatarUrl || '') : false;
  const emailChanged = me ? email.trim().toLowerCase() !== (me.email || '').toLowerCase() : false;
  const pwChanged = newPassword.length > 0;
  const dirty = nameChanged || avatarChanged || emailChanged || pwChanged;
  const sensitiveDirty = emailChanged || pwChanged;

  const initials = useMemo(() => {
    const parts = (name || me?.name || '?').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }, [name, me]);

  function onPickAvatar(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setErr('');
    if (!file.type.startsWith('image/')) { setErr('Please choose an image file.'); return; }
    if (file.size > MAX_AVATAR_BYTES) { setErr('That image is larger than 2 MB. Pick a smaller one.'); return; }
    const reader = new FileReader();
    reader.onload = () => setAvatarUrl(String(reader.result || ''));
    reader.onerror = () => setErr('Could not read that image.');
    reader.readAsDataURL(file);
  }

  // Validate, then split into a direct (non-sensitive) save and a verified
  // (sensitive) flow. Non-sensitive saves apply immediately; sensitive ones open
  // the OTP modal and are only committed after the code is confirmed.
  async function onSave() {
    setErr(''); setOkMsg('');
    if (!editable) return;
    if (nameChanged && !name.trim()) { setErr('Name cannot be empty.'); return; }
    if (emailChanged && !EMAIL_RE.test(email.trim())) { setErr('Enter a valid email address.'); return; }
    if (pwChanged) {
      if (newPassword.length < 8) { setErr('New password must be at least 8 characters.'); return; }
      if (newPassword !== confirmPassword) { setErr('Passwords do not match.'); return; }
    }

    setSaving(true);
    try {
      // 1) Apply non-sensitive changes directly.
      if (nameChanged || avatarChanged) {
        const updated = await softglazeApi.members.updateSelf({
          name: name.trim(),
          avatarUrl: avatarUrl || null
        });
        hydrate(updated);
      }

      // 2) Sensitive changes require email verification.
      if (sensitiveDirty) {
        const changes = {};
        if (emailChanged) changes.email = email.trim().toLowerCase();
        if (pwChanged) changes.password = newPassword;
        const res = await softglazeApi.members.requestChange({ changes });
        setVerify({ changes, sentTo: res?.sentTo || me.email, devCode: res?.devCode || '' });
      } else if (nameChanged || avatarChanged) {
        setOkMsg('Profile updated.');
      }
    } catch (e) {
      setErr(e.message || 'Could not save your changes.');
    } finally {
      setSaving(false);
    }
  }

  function resetChanges() {
    if (me) hydrate(me);
    setErr(''); setOkMsg('');
  }

  if (me === undefined) {
    return <div className="grid place-items-center py-24"><Loader2 className="w-6 h-6 text-muted-foreground animate-spin" /></div>;
  }
  if (loadErr) {
    return <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{loadErr}</div>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* HEADER */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary mb-1">Your account</p>
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground font-display tracking-tight flex items-center gap-2.5">
          <UserCog className="w-6 h-6 text-primary" /> Account settings
        </h1>
        <p className="text-xs text-muted-foreground mt-1">Manage your profile picture, name, email, and password.</p>
      </div>

      {!editable && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3">
          <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[12px] text-amber-300">This is a Super-Admin / source-owner session — there's no editable member record to change here.</p>
        </div>
      )}

      {err && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-400">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {err}
        </div>
      )}
      {okMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-[13px] text-emerald-400">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {okMsg}
        </div>
      )}

      {/* PROFILE CARD */}
      <div className="bg-card border border-border rounded-xl p-5 sm:p-6 space-y-6">
        {/* Avatar + name */}
        <div className="flex items-center gap-5">
          <div className="relative shrink-0">
            <div className="w-20 h-20 rounded-2xl overflow-hidden grid place-items-center text-2xl font-bold"
              style={{ background: (me?.color || '#6366f1') + '22', color: me?.color || '#6366f1' }}>
              {avatarUrl
                ? <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                : <span>{initials}</span>}
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={!editable}
              title="Change picture"
              className="absolute -bottom-1.5 -right-1.5 w-8 h-8 rounded-lg grid place-items-center bg-primary text-white shadow-lg shadow-primary/30 hover:bg-primary-hover disabled:opacity-50"
            >
              <Camera className="w-4 h-4" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickAvatar} />
          </div>
          <div className="min-w-0 flex-1">
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">Full name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!editable}
              placeholder="Your name"
              className="w-full h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary disabled:opacity-50"
            />
            {avatarChanged && <p className="mt-1.5 text-[11px] text-muted-foreground">New picture selected — save to apply.</p>}
          </div>
        </div>

        <div className="h-px bg-border" />

        {/* Email (sensitive) */}
        <div>
          <label className="flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">
            <span className="inline-flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> Email</span>
            {emailChanged && <span className="inline-flex items-center gap-1 text-amber-400 normal-case tracking-normal"><ShieldCheck className="w-3 h-3" /> verification required</span>}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!editable}
            placeholder="you@workspace.com"
            className="w-full h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary disabled:opacity-50"
          />
        </div>

        {/* Password (sensitive) */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">
              <span className="inline-flex items-center gap-1.5"><KeyRound className="w-3.5 h-3.5" /> New password</span>
              {pwChanged && <span className="inline-flex items-center gap-1 text-amber-400 normal-case tracking-normal"><ShieldCheck className="w-3 h-3" /> verification required</span>}
            </label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={!editable}
                placeholder="Leave blank to keep current"
                autoComplete="new-password"
                className="w-full h-10 bg-input-background border border-border rounded-lg px-3 pr-10 text-[13px] text-foreground outline-none focus:border-primary disabled:opacity-50"
              />
              <button type="button" tabIndex={-1} onClick={() => setShowPw((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">Confirm new password</label>
            <input
              type={showPw ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={!editable || !pwChanged}
              placeholder="Repeat new password"
              autoComplete="new-password"
              className="w-full h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary disabled:opacity-50"
            />
          </div>
        </div>

        {sensitiveDirty && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2.5">
            <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[12px] text-amber-300">Changing your email or password requires a 6-digit code sent to your current email <span className="font-medium text-amber-200">{me?.email}</span>.</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={onSave}
            disabled={!editable || !dirty || saving}
            className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 disabled:opacity-50 shadow-lg shadow-blue-500/25"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : sensitiveDirty ? <ShieldCheck className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : sensitiveDirty ? 'Verify & save' : 'Save changes'}
          </button>
          {dirty && !saving && (
            <button onClick={resetChanges} className="h-10 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground border border-border">
              Discard
            </button>
          )}
        </div>
      </div>

      {verify && (
        <VerifyModal
          info={verify}
          onClose={() => setVerify(null)}
          onVerified={(updatedMember) => {
            setVerify(null);
            if (updatedMember) hydrate(updatedMember);
            setOkMsg('Account updated successfully.');
          }}
        />
      )}
    </div>
  );
}

// OTP confirmation modal for sensitive (email/password) changes. The request was
// already issued (code sent) before this opened; here we collect the code and
// commit. Re-send is available if the code never arrives.
function VerifyModal({ info, onClose, onVerified }) {
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState(info.devCode || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [resending, setResending] = useState(false);
  const { dialogRef } = useDialog({ onClose, closeOnEscape: !busy });

  async function commit() {
    const c = code.replace(/\D/g, '');
    if (c.length !== 6) { setErr('Enter the 6-digit code.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await softglazeApi.members.commitChange({ code: c });
      onVerified(res?.member || null);
    } catch (e) {
      setErr(e.message || 'Verification failed.');
      setBusy(false);
    }
  }

  async function resend() {
    setResending(true); setErr('');
    try {
      const res = await softglazeApi.members.requestChange({ changes: info.changes });
      setDevCode(res?.devCode || '');
    } catch (e) {
      setErr(e.message || 'Could not resend the code.');
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Confirm it's you" tabIndex={-1} className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl shadow-black/50 p-6 animate-scale-in">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl grid place-items-center bg-primary/12 border border-primary/20"><ShieldCheck className="w-5 h-5 text-primary" /></span>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Confirm it's you</h3>
              <p className="text-[12px] text-muted-foreground">Code sent to {info.sentTo}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">6-digit code</label>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
          inputMode="numeric"
          autoFocus
          placeholder="••••••"
          className="w-full h-11 bg-input-background border border-border rounded-lg px-3 text-center text-lg font-mono tracking-[0.4em] text-foreground outline-none focus:border-primary"
        />

        {devCode && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 text-[12px] text-primary">
            Dev mode — no email configured. Your code is <span className="font-mono font-semibold">{devCode}</span>.
          </div>
        )}
        {err && <p className="mt-3 text-[12px] text-red-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {err}</p>}

        <div className="mt-5 flex items-center gap-3">
          <button onClick={commit} disabled={busy} className="flex-1 inline-flex items-center justify-center gap-2 h-10 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Verify &amp; apply
          </button>
          <button onClick={resend} disabled={resending || busy} className="h-10 px-4 rounded-lg text-[12px] font-medium text-muted-foreground hover:text-foreground border border-border disabled:opacity-50">
            {resending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Resend'}
          </button>
        </div>
      </div>
    </div>
  );
}
