import { useEffect, useState } from 'react';
import { KeyRound, LogOut, Loader2, Mail, WifiOff, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { methodRows } from '@/lib/signInFlow.mjs';
import SignInPanel, { GithubMark } from '@/components/SignInPanel.jsx';

// Settings > Account: the SoftGlaze account's sign-in methods (GitHub, email code) and Sign out (1.0.26).
// Only the workspace Owner (or the Super Admin) sees it; main decides what can be done (oneClickSignIn.js).

function formatDate(value, lang) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  try { return d.toLocaleDateString(lang || undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (_) { return d.toISOString().slice(0, 10); }
}

export default function SignInMethodsCard({ isOwner }) {
  const { t, i18n } = useTranslation('signin');
  const [acct, setAcct] = useState(undefined); // undefined = loading, null = unavailable
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  function load() {
    return softglazeApi.signin.account().then((a) => setAcct(a || null)).catch(() => setAcct(null));
  }
  useEffect(() => { if (isOwner) load(); }, [isOwner]);

  if (!isOwner) return null;
  if (acct === undefined) {
    return <div className="bg-card border border-border rounded-xl p-5 text-[12.5px] text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {t('account.loading')}</div>;
  }
  if (acct === null) return null;

  async function signOut() {
    if (!window.confirm(t('account.signOutConfirm'))) return;
    setBusy(true); setErr('');
    try { await softglazeApi.signin.signOut(); } catch (e) { /* the reload shows the Gate either way */ }
    window.location.reload();
  }

  const rows = methodRows(acct.methods);
  const lang = i18n.language;

  return (
    <section aria-labelledby="signin-methods-title" className="bg-card border border-border rounded-xl p-5 sm:p-6 space-y-4">
      <div>
        <h2 id="signin-methods-title" className="text-[15px] font-semibold text-foreground flex items-center gap-2"><KeyRound className="w-4 h-4 text-primary" /> {t('account.title')}</h2>
        <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">{t('account.subtitle')}</p>
      </div>

      {ok && <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12.5px] text-emerald-400"><CheckCircle2 className="w-4 h-4 shrink-0" /> {ok}</div>}
      {err && <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-400"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {err}</div>}

      {acct.signedIn ? (
        <>
          <p className="text-[12.5px] text-foreground break-words">{t('account.signedInAs', { email: acct.email || '' })}</p>
          {acct.offline && <p className="text-[11.5px] text-amber-400 flex items-center gap-1.5"><WifiOff className="w-3.5 h-3.5 shrink-0" /> {t('account.offline')}</p>}
          <ul className="divide-y divide-border rounded-lg border border-border">
            {rows.map((m) => (
              <li key={`${m.provider}-${m.login || m.email}`} className="flex items-center gap-3 px-3 py-2.5 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-secondary grid place-items-center shrink-0 text-foreground">
                  {m.provider === 'github' ? <GithubMark className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-foreground truncate">{m.provider === 'github' ? (m.login ? t('account.githubLogin', { login: m.login }) : t('account.github')) : t('account.email')}</span>
                  <span className="block text-[11.5px] text-muted-foreground truncate">{m.email || ''}</span>
                </span>
                <span className="text-[11px] text-muted-foreground shrink-0 hidden sm:block">
                  {m.lastUsedAt ? t('account.lastUsed', { date: formatDate(m.lastUsedAt, lang) }) : (m.linkedAt ? t('account.linkedOn', { date: formatDate(m.linkedAt, lang) }) : '')}
                </span>
              </li>
            ))}
          </ul>
          {acct.signInWorkspace && <p className="text-[11.5px] text-muted-foreground leading-relaxed">{t('account.signInWorkspace')}</p>}
          <button type="button" onClick={signOut} disabled={busy} className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-[13px] font-medium text-foreground border border-border hover:bg-secondary disabled:opacity-60">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />} {busy ? t('account.signingOut') : t('account.signOut')}
          </button>
        </>
      ) : acct.tenant ? (
        <div className="max-w-sm">
          <p className="text-[12.5px] text-muted-foreground mb-4 leading-relaxed">{t('account.notSignedIn')}</p>
          <SignInPanel
            purpose="link"
            compact
            heading={false}
            info={{ tenant: acct.tenant, providers: acct.providers }}
            onDone={() => { setOk(t('account.linked')); setErr(''); load(); }}
          />
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">{t('account.notAvailable')}</p>
      )}
    </section>
  );
}
