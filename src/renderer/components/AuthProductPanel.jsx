import { Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// The side of the sign-in and sign-up screens (Gate). Instead of a slogan carousel it shows what SoftGlaze is: a
// small copy of the Profiles page, drawn with the same row styles (status dot, OS, proxy chip, last used), and the
// facts of the plan a new account gets. Every text is in gate.json `panel.*` (en + es) and must stay true for the
// release it ships in.
//   variant 'signup'  new or returning on a fresh install: the Free plan facts
//   variant 'return'  this workspace exists (sign in again, unlock): where the profiles live

// Example rows for the illustration (labelled as an example on screen). Proxy hosts are documentation ranges.
const ROWS = [
  { name: 'Shop EU 01', os: 'Windows 11', proxy: 'DE 203.0.113.24', running: true, used: ['justNow'] },
  { name: 'Ads US 04', os: 'macOS 15', proxy: 'US 198.51.100.7', running: true, used: ['minutes', 12] },
  { name: 'Support desk', os: 'Windows 10', proxy: 'NL 192.0.2.81', running: false, used: ['hours', 3] },
  { name: 'Market FR 02', os: 'Android 14', proxy: 'FR 203.0.113.140', running: false, used: ['days', 2] },
  { name: 'Research', os: 'Linux', proxy: null, running: false, used: ['never'] }
];
const FACTS = ['fingerprint', 'proxy', 'storage', 'phone'];

function ProfilesPreview() {
  const { t } = useTranslation('gate');
  const { t: tp } = useTranslation('profiles');
  return (
    <figure className="m-0">
      <figcaption className="text-[12px] text-muted-foreground mb-2">{t('panel.exampleCaption')}</figcaption>
      <div aria-hidden="true" className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full border-collapse text-left text-[13px] whitespace-nowrap">
          <thead className="bg-elevated text-muted-foreground text-[10px] uppercase tracking-wider font-semibold">
            <tr>
              <th className="px-4 py-2.5 font-semibold">{tp('table.name')}</th>
              <th className="px-3 py-2.5 font-semibold">{tp('general.os')}</th>
              <th className="px-3 py-2.5 font-semibold">{tp('table.proxy')}</th>
              <th className="px-4 py-2.5 font-semibold text-right auth-col-used">{tp('table.lastUsed')}</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.name} className="border-t border-border">
                <td className="px-4 py-2.5 font-medium text-foreground">
                  <span className="flex items-center gap-2.5">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${r.running ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                    {r.name}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{r.os}</td>
                <td className="px-3 py-2.5">
                  {r.proxy ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium font-mono bg-primary/10 text-[var(--auth-proxy-chip)] border border-primary/25">
                      <Link2 className="w-3 h-3" />{r.proxy}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium border border-border-strong text-muted-foreground">{t('panel.direct')}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right text-muted-foreground auth-col-used">{tp(`relTime.${r.used[0]}`, { count: r.used[1] })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

export default function AuthProductPanel({ variant = 'signup' }) {
  const { t } = useTranslation('gate');
  return (
    <aside aria-label={t('panel.label')} className="auth-panel relative hidden min-[960px]:flex flex-col justify-center gap-7 overflow-hidden bg-surface border-l border-border px-10 xl:px-14 py-10">
      {variant === 'signup' ? (
        <div>
          <p className="text-[13px] font-medium text-muted-foreground">{t('panel.freePlan')}</p>
          <p className="mt-1 flex items-baseline gap-3 text-foreground">
            <span className="font-display font-semibold text-[64px] leading-none tracking-tight">25</span>
            <span className="font-display font-semibold text-[24px] leading-tight">{t('panel.profilesUnit')}</span>
          </p>
          <p className="mt-3 text-[15px] text-muted-foreground max-w-[34rem] leading-relaxed">{t('panel.freeBody')}</p>
        </div>
      ) : (
        <div>
          <p className="text-[13px] font-medium text-muted-foreground">{t('panel.returnLabel')}</p>
          <p className="mt-1 font-display font-semibold text-[28px] leading-tight text-foreground max-w-[30rem]">{t('panel.returnTitle')}</p>
          <p className="mt-3 text-[15px] text-muted-foreground max-w-[34rem] leading-relaxed">{t('panel.returnBody')}</p>
        </div>
      )}
      <ProfilesPreview />
      <dl className="auth-facts grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-6 text-[14px] border-b border-border">
        {FACTS.map((k) => (
          <div key={k} className="contents">
            <dt className="py-2.5 border-t border-border font-semibold text-foreground">{t(`panel.facts.${k}.term`)}</dt>
            <dd className="m-0 py-2.5 border-t border-border text-muted-foreground">{t(`panel.facts.${k}.detail`)}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
