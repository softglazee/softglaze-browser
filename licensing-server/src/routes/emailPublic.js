'use strict';
// Unsubscribe (link in every lifecycle / marketing email, and the List-Unsubscribe header).
// GET  /v1/email/unsubscribe?t=TOKEN  a small page with a confirm button (GET never changes anything,
//                                     because mail scanners open links)
// POST /v1/email/unsubscribe?t=TOKEN  unsubscribes: the page's button, and RFC 8058 one-click
//                                     ("List-Unsubscribe=One-Click" posted by the mail provider)
// Unsubscribing stops lifecycle and marketing email and withdraws marketing consent; sign-in codes
// still arrive.
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { verifyToken } = require('../email/unsubscribe');
const { escapeHtml } = require('../email/render');
const { addEvent } = require('../customers/sync');

const router = express.Router();

const COPY = {
  en: {
    title: 'Unsubscribe', ask: 'Stop emails from SoftGlaze to this address?', button: 'Unsubscribe',
    done: 'You are unsubscribed. You will not get trial reminders or news from us any more. Sign-in codes you ask for in the app still arrive.',
    invalid: 'This unsubscribe link is not valid. If you copied it, check that the whole link was copied.',
    gone: 'There is nothing to unsubscribe: we do not hold this address any more.'
  },
  es: {
    title: 'Darse de baja', ask: '¿Dejar de recibir correos de SoftGlaze en esta dirección?', button: 'Darme de baja',
    done: 'Te has dado de baja. Ya no recibirás recordatorios de la prueba ni novedades. Los códigos de acceso que pidas en la aplicación sí llegarán.',
    invalid: 'Este enlace para darse de baja no es válido. Si lo copiaste, comprueba que se copió entero.',
    gone: 'No hay nada que dar de baja: ya no guardamos esta dirección.'
  }
};

function page(res, status, lang, message, form) {
  const c = COPY[lang] || COPY.en;
  res.status(status);
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Cache-Control', 'no-store');
  res.type('html').send(`<!doctype html>
<html lang="${lang === 'es' ? 'es' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(c.title)} - SoftGlaze</title>
<style>
:root{--bg:#f3f4f6;--card:#fff;--text:#111827;--muted:#4b5563;--accent:#1d4ed8;--accent-text:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b0f;--card:#17171c;--text:#e5e7eb;--muted:#9ca3af;--accent:#3b82f6;--accent-text:#0b0b0f}}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
main{max-width:480px;margin:12vh auto;padding:28px 24px;background:var(--card);border-radius:10px}
h1{font-size:20px;margin:0 0 12px}p{margin:0 0 16px;color:var(--muted)}
button{font:inherit;padding:10px 18px;border:0;border-radius:6px;background:var(--accent);color:var(--accent-text);cursor:pointer}
button:focus-visible{outline:3px solid var(--text);outline-offset:2px}
@media (max-width:520px){main{margin:16px;}}
</style></head>
<body><main><h1>${escapeHtml(c.title)}</h1><p>${escapeHtml(message)}</p>${form || ''}</main></body></html>`);
}

async function customerFromToken(req) {
  const id = verifyToken(req.query.t);
  if (!id) return { valid: false };
  const c = await prisma.customer.findUnique({ where: { id } });
  return { valid: true, customer: c };
}

router.get('/unsubscribe', asyncHandler(async (req, res) => {
  const { valid, customer } = await customerFromToken(req);
  const lang = customer && customer.lang === 'es' ? 'es' : 'en';
  if (!valid) return page(res, 400, lang, COPY[lang].invalid);
  if (!customer) return page(res, 200, lang, COPY[lang].gone);
  if (customer.unsubscribedAt) return page(res, 200, lang, COPY[lang].done);
  const action = `?t=${encodeURIComponent(String(req.query.t))}`;
  page(res, 200, lang, COPY[lang].ask, `<form method="post" action="${escapeHtml(action)}"><button type="submit">${escapeHtml(COPY[lang].button)}</button></form>`);
}));

router.post('/unsubscribe', express.urlencoded({ extended: false, limit: '2kb' }), asyncHandler(async (req, res) => {
  const { valid, customer } = await customerFromToken(req);
  const lang = customer && customer.lang === 'es' ? 'es' : 'en';
  if (!valid) return page(res, 400, lang, COPY[lang].invalid);
  if (!customer) return page(res, 200, lang, COPY[lang].gone);
  if (!customer.unsubscribedAt) {
    const at = new Date();
    await prisma.customer.update({
      where: { id: customer.id },
      data: { unsubscribedAt: at, marketingConsent: false, consentAt: at, consentSource: 'unsubscribe' }
    });
    const oneClick = req.body && req.body['List-Unsubscribe'] === 'One-Click';
    await addEvent(prisma, customer.tenantId, customer.id, 'unsubscribed', { via: oneClick ? 'one_click' : 'link' }, at);
    await prisma.emailOutbox.updateMany({
      where: { tenantId: customer.tenantId, customerId: customer.id, status: 'queued', NOT: { category: 'essential' } },
      data: { status: 'cancelled', lastError: 'unsubscribed', html: null, text: null }
    });
  }
  page(res, 200, lang, COPY[lang].done);
}));

module.exports = router;
