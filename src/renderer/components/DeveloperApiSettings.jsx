import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal, KeyRound, Loader2, Plus, Copy, Check, Trash2, Power, ServerCog, AlertTriangle } from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';

export default function DeveloperApiSettings() {
  const { t } = useTranslation('cmpSettingsA');
  const [me, setMe] = useState(undefined); // undefined = loading
  const [tokens, setTokens] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [freshToken, setFreshToken] = useState('');
  const [copied, setCopied] = useState('');
  const [toggling, setToggling] = useState(false);

  // Owner / Super Admin only (single-user mode counts as the owner). Sub-members
  // (admin/manager/operator) never see or call the developer API.
  const allowed = me !== undefined && (!me || me.role === 'OWNER' || me.role === 'SUPER_ADMIN');

  const load = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([
        softglazeApi.developerApi.listTokens(),
        softglazeApi.developerApi.serverStatus()
      ]);
      setTokens(Array.isArray(t) ? t : []);
      setStatus(s || null);
    } catch (e) { setErr(e.message || t('developerApi.errors.load')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    softglazeApi.members.current().then((m) => setMe(m || null)).catch(() => setMe(null));
  }, []);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  if (me === undefined) return null;
  if (!allowed) return null;

  async function generate() {
    setErr(''); setFreshToken('');
    if (!newName.trim()) { setErr(t('developerApi.errors.nameRequired')); return; }
    setCreating(true);
    try {
      const res = await softglazeApi.developerApi.createToken({ name: newName.trim() });
      setFreshToken(res.token || '');
      setNewName('');
      await load();
    } catch (e) { setErr(e.message || t('developerApi.errors.generate')); }
    finally { setCreating(false); }
  }

  async function revoke(id) {
    setErr('');
    try { await softglazeApi.developerApi.revokeToken(id); setTokens((list) => list.filter((x) => x.id !== id)); }
    catch (e) { setErr(e.message || t('developerApi.errors.revoke')); }
  }

  async function toggleServer() {
    setErr('');
    setToggling(true);
    try {
      const next = await softglazeApi.developerApi.setServerEnabled(!status?.enabled);
      setStatus(next);
    } catch (e) { setErr(e.message || t('developerApi.errors.toggleServer')); }
    finally { setToggling(false); }
  }

  function copy(text, tag) {
    try {
      navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(''), 1500);
    } catch (e) { /* clipboard blocked */ }
  }

  const url = status?.url || 'http://127.0.0.1:8080';
  const curl = `curl -X POST ${url}/api/v1/profiles/1/start \\\n  -H "Authorization: Bearer sg_your_token_here"`;

  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="flex items-center gap-3 mb-1">
        <span className="w-10 h-10 rounded-lg grid place-items-center shrink-0 bg-emerald-500/12 border border-emerald-500/20">
          <Terminal className="w-5 h-5 text-emerald-400" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            {t('developerApi.title')}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/12 text-violet-300 border border-violet-500/20">Softglaze Pro</span>
          </h3>
          <p className="text-xs text-muted-foreground">{t('developerApi.description')}</p>
        </div>
      </div>

      {err && <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">{err}</div>}

      {loading ? (
        <div className="grid place-items-center py-10"><Loader2 className="w-5 h-5 text-muted-foreground animate-spin" /></div>
      ) : (
        <div className="mt-4 space-y-5">
          {/* API key generation */}
          <div className="rounded-xl border border-border bg-elevated/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <KeyRound className="w-4 h-4 text-muted-foreground" />
              <span className="text-[13px] font-semibold text-foreground">{t('developerApi.keys.title')}</span>
            </div>

            <div className="flex items-center gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') generate(); }}
                placeholder={t('developerApi.keys.namePlaceholder')}
                className="flex-1 h-9 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary"
              />
              <button onClick={generate} disabled={creating} className="shrink-0 h-9 px-4 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 disabled:opacity-50 inline-flex items-center gap-2">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {t('developerApi.keys.generate')}
              </button>
            </div>

            {/* One-time reveal */}
            {freshToken && (
              <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] text-amber-300 font-medium">{t('developerApi.keys.copyOnce')}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="flex-1 min-w-0 truncate font-mono text-[12px] text-foreground bg-background/60 border border-border rounded px-2 py-1.5">{freshToken}</code>
                      <button onClick={() => copy(freshToken, 'fresh')} className="shrink-0 h-8 px-3 rounded-lg bg-secondary hover:bg-secondary/70 text-[12px] font-medium text-foreground inline-flex items-center gap-1.5">
                        {copied === 'fresh' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />} {t('developerApi.copy')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Existing keys */}
            <div className="mt-3 space-y-1.5">
              {tokens.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">{t('developerApi.keys.empty')}</p>
              ) : tokens.map((tok) => (
                <div key={tok.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-card border border-border">
                  <KeyRound className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="text-[12.5px] font-medium text-foreground truncate block">{tok.name}</span>
                    <span className="text-[10.5px] text-muted-foreground font-mono">{tok.preview} · {tok.lastUsedAt ? t('developerApi.keys.lastUsed', { when: fmt(tok.lastUsedAt, t) }) : t('developerApi.keys.neverUsed')}</span>
                  </div>
                  <button onClick={() => revoke(tok.id)} title={t('developerApi.keys.revoke')} className="shrink-0 text-muted-foreground hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>

          {/* Local server */}
          <div className="rounded-xl border border-border bg-elevated/50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <ServerCog className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <span className="text-[13px] font-semibold text-foreground">{t('developerApi.server.title')}</span>
                  <p className="text-[11.5px] text-muted-foreground truncate">
                    {status?.running
                      ? <>{t('developerApi.server.runningAt')} <span className="font-mono text-emerald-400">{url}</span></>
                      : <>{t('developerApi.server.stoppedPrefix')} <span className="font-mono">{url}</span> {t('developerApi.server.loopbackOnly')}</>}
                  </p>
                </div>
              </div>
              <button
                onClick={toggleServer}
                disabled={toggling}
                role="switch"
                aria-checked={Boolean(status?.enabled)}
                className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 disabled:opacity-60"
                style={{ background: status?.enabled ? '#22c55e' : 'var(--switch-background, #3f3f46)' }}
                title={status?.enabled ? t('developerApi.server.disableTitle') : t('developerApi.server.enableTitle')}
              >
                <span className={`inline-block transform rounded-full bg-white shadow transition-transform ${status?.enabled ? 'translate-x-5' : 'translate-x-1'}`} style={{ height: 18, width: 18 }} />
              </button>
            </div>

            <div className="mt-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('developerApi.server.curlExample')}</span>
                <button onClick={() => copy(curl, 'curl')} className="text-[11px] font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                  {copied === 'curl' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />} {t('developerApi.copy')}
                </button>
              </div>
              <pre className="rounded-lg bg-[#0b0f17] border border-border p-3 font-mono text-[11.5px] text-foreground/90 overflow-x-auto whitespace-pre">{curl}</pre>
              <p className="mt-2 text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
                <Power className="w-3 h-3" /> {t('developerApi.server.footnote')}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function fmt(value, t) {
  if (!value) return t('developerApi.keys.never');
  try { return new Date(value).toLocaleString(); } catch (e) { return t('developerApi.keys.never'); }
}
