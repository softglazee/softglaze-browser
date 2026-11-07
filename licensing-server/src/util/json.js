'use strict';
// Prisma returns JSON columns parsed on MySQL, but MariaDB stores JSON as LONGTEXT and some setups
// hand back the raw string. asJson() accepts either.
function asJson(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch (_) { return null; }
  }
  return v;
}

module.exports = { asJson };
