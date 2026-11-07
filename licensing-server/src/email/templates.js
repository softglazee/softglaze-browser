'use strict';
// Email templates live in the EmailTemplate table (seeded by migration). Lookup order for (key, lang):
// the tenant's row in that language, the tenant's English row, then the built-in copy.
const { defaultRows, builtIn, BUILT_IN_KEYS, LANGS } = require('./defaults');

const CATEGORIES = ['essential', 'lifecycle', 'marketing', 'service'];

async function getTemplate(db, tenantId, key, lang = 'en') {
  const l = LANGS.includes(lang) ? lang : 'en';
  const row = await db.emailTemplate.findUnique({ where: { tenantId_key_lang: { tenantId, key, lang: l } } });
  if (row) return row;
  if (l !== 'en') {
    const en = await db.emailTemplate.findUnique({ where: { tenantId_key_lang: { tenantId, key, lang: 'en' } } });
    if (en) return en;
  }
  return builtIn(key, l);
}

// Adds any built-in template the tenant does not have yet (new tenants, new built-in keys).
async function ensureDefaultTemplates(db, tenantId) {
  let added = 0;
  for (const r of defaultRows()) {
    const exists = await db.emailTemplate.findUnique({ where: { tenantId_key_lang: { tenantId, key: r.key, lang: r.lang } } });
    if (exists) continue;
    try {
      await db.emailTemplate.create({ data: { tenantId, ...r, builtIn: true, isDefault: true } });
      added += 1;
    } catch (e) { if (!e || e.code !== 'P2002') throw e; }
  }
  return added;
}

module.exports = { getTemplate, ensureDefaultTemplates, CATEGORIES, BUILT_IN_KEYS, LANGS };
