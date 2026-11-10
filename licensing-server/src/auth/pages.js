'use strict';
// The few pages the browser shows during a provider sign-in. No script and no outside resources (the CSP in
// src/routes/auth.js forbids both); the hand-off to the app is a meta refresh plus a button, so it also works
// when the browser asks "Open SoftGlaze Browser?" first. Texts are short and in English and Spanish.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TEXT = {
  signed_in: {
    title: 'You are signed in',
    body: 'Go back to SoftGlaze Browser. If it did not open, click the button.',
    es: 'Has iniciado sesión. Vuelve a SoftGlaze Browser; si no se abrió, pulsa el botón.'
  },
  cancelled: {
    title: 'Sign-in cancelled',
    body: 'Nothing was changed. You can close this tab and try again in SoftGlaze Browser.',
    es: 'Se canceló el inicio de sesión. Puedes cerrar esta pestaña e intentarlo de nuevo.'
  },
  email_not_verified: {
    title: 'Your GitHub email is not verified',
    body: 'Verify your primary email address on GitHub (Settings > Emails), then try again. Or go back and continue with email.',
    es: 'Verifica tu correo principal en GitHub (Settings > Emails) e inténtalo de nuevo, o continúa con tu correo.'
  },
  disposable_email: {
    title: 'Please use a permanent email address',
    body: 'Your account uses a temporary email address. Change it, or go back and continue with another email.',
    es: 'Tu cuenta usa un correo temporal. Cámbialo o continúa con otro correo.'
  },
  failed: {
    title: 'Sign-in did not finish',
    body: 'Something went wrong on our side. Go back to SoftGlaze Browser and try again in a minute.',
    es: 'No se pudo completar el inicio de sesión. Vuelve a SoftGlaze Browser e inténtalo de nuevo.'
  },
  expired: {
    title: 'This sign-in link has expired',
    body: 'Go back to SoftGlaze Browser and start again. Links work once, for 10 minutes, in the browser that opened them.',
    es: 'Este enlace ha caducado. Vuelve a SoftGlaze Browser y empieza de nuevo.'
  },
  unavailable: {
    title: 'This sign-in is not available yet',
    body: 'Go back to SoftGlaze Browser and continue with email instead.',
    es: 'Este inicio de sesión aún no está disponible. Continúa con tu correo en SoftGlaze Browser.'
  },
  invalid: {
    title: 'This sign-in link is not valid',
    body: 'Start the sign-in from SoftGlaze Browser.',
    es: 'Este enlace no es válido. Inicia sesión desde SoftGlaze Browser.'
  },
  rate_limited: {
    title: 'Too many attempts',
    body: 'Wait a few minutes, then try again from SoftGlaze Browser.',
    es: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.'
  }
};

// key: one of TEXT's keys. appUrl: the app redirect (signed-in or error result) for the button and refresh.
function renderPage(key, { appUrl = null } = {}) {
  const t = TEXT[key] || TEXT.failed;
  const refresh = appUrl ? `<meta http-equiv="refresh" content="0;url=${esc(appUrl)}">` : '';
  const button = appUrl ? `<p><a class="btn" href="${esc(appUrl)}">Open SoftGlaze Browser</a></p>` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">${refresh}
<title>${esc(t.title)} - SoftGlaze</title>
<style>
:root{color-scheme:light dark;--bg:#f6f7fb;--card:#fff;--fg:#0f172a;--muted:#475569;--accent:#2563eb}
@media (prefers-color-scheme:dark){:root{--bg:#0b1020;--card:#121a2e;--fg:#e5e7eb;--muted:#94a3b8;--accent:#3b82f6}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
main{max-width:440px;width:100%;background:var(--card);border-radius:16px;padding:28px;box-shadow:0 10px 40px rgba(0,0,0,.12)}
h1{font-size:20px;margin:0 0 8px}p{margin:0 0 12px;color:var(--muted)}.es{font-size:13px}
.btn{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:10px}
</style></head>
<body><main><h1>${esc(t.title)}</h1><p>${esc(t.body)}</p>${button}<p class="es" lang="es">${esc(t.es)}</p></main></body></html>`;
}

module.exports = { renderPage, TEXT };
