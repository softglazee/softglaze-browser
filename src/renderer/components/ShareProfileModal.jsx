import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Share2, Check } from 'lucide-react';
import Button from '@/components/ui/Button.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { useDialog } from '@/lib/useDialog.js';

// Phase F2 — shared profile pools. Bulk-share the selected profiles with a team
// member at a chosen access level, or revoke that member's access. The backend
// enforces that the actor may only share profiles they can edit and only with
// members they manage; this UI is a thin, fail-safe front for that.
const ROLE_KEY = { OWNER: 'shareProfile.roleOwner', ADMIN: 'shareProfile.roleAdmin', MANAGER: 'shareProfile.roleManager', OPERATOR: 'shareProfile.roleOperator', SUPER_ADMIN: 'shareProfile.roleSuperAdmin' };

export default function ShareProfileModal({ profileIds = [], onClose }) {
  const { t } = useTranslation('cmpModalsC');
  const [members, setMembers] = useState([]);
  const [memberId, setMemberId] = useState('');
  const [level, setLevel] = useState('use'); // 'use' | 'edit'
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const { dialogRef } = useDialog({ onClose, closeOnEscape: !busy });

  useEffect(() => {
    let live = true;
    softglazeApi.members.list()
      .then((list) => {
        if (!live) return;
        const arr = Array.isArray(list) ? list : [];
        setMembers(arr);
        if (arr.length) setMemberId(String(arr[0].id));
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const count = profileIds.length;

  async function run(action) {
    if (!memberId) { setErr(t('shareProfile.errChooseMember')); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      const payload = { profileIds, memberId: Number(memberId), level };
      if (action === 'grant') {
        const r = await softglazeApi.profiles.grantAccess(payload);
        const skipped = r.denied ? t('shareProfile.grantedSkipped', { count: r.denied }) : '';
        setMsg(t('shareProfile.granted', { count: r.granted, skipped }));
      } else {
        const r = await softglazeApi.profiles.revokeAccess(payload);
        setMsg(t('shareProfile.revoked', { count: r.revoked }));
      }
    } catch (e) { setErr(e.message || t('shareProfile.errUpdate')); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={() => { if (!busy) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('shareProfile.ariaLabel')} tabIndex={-1} className="w-full max-w-sm rounded-xl border border-border bg-card shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Share2 className="w-4 h-4 text-primary" /> {t('shareProfile.title', { count })}</h3>
        <p className="text-xs text-muted-foreground mt-1">{t('shareProfile.description')}</p>

        {members.length === 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">{t('shareProfile.noMembers')}</p>
        ) : (
          <>
            <label htmlFor="share-member" className="mt-4 block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">{t('shareProfile.member')}</label>
            <select
              id="share-member"
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              className="w-full bg-input-background border border-border rounded px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}{m.role ? ` · ${ROLE_KEY[m.role] ? t(ROLE_KEY[m.role]) : m.role}` : ''}</option>
              ))}
            </select>

            <span className="mt-4 block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">{t('shareProfile.accessLevel')}</span>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('shareProfile.accessLevel')}>
              <button type="button" role="radio" aria-checked={level === 'use'} onClick={() => setLevel('use')} className={`h-9 rounded-lg border text-[12.5px] font-semibold ${level === 'use' ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'}`}>{t('shareProfile.levelUse')}</button>
              <button type="button" role="radio" aria-checked={level === 'edit'} onClick={() => setLevel('edit')} className={`h-9 rounded-lg border text-[12.5px] font-semibold ${level === 'edit' ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'}`}>{t('shareProfile.levelEdit')}</button>
            </div>

            {(err || msg) && <p className={`mt-3 text-[12px] ${err ? 'text-red-400' : 'text-emerald-400'} flex items-center gap-1.5`}>{!err && <Check className="w-3.5 h-3.5" />}{err || msg}</p>}

            <div className="mt-4 flex gap-2 justify-end">
              <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>{t('shareProfile.close')}</Button>
              <Button size="sm" variant="secondary" disabled={busy || !memberId} onClick={() => run('revoke')}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('shareProfile.revoke')}</Button>
              <Button size="sm" variant="primary" disabled={busy || !memberId} onClick={() => run('grant')}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('shareProfile.grant')}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
