'use strict';
// The pairing QR as an SVG data URL (black on white with a quiet zone, whatever the app theme, so
// phone cameras read it). Encoder: vendored qrcode-generator 2.0.4 (MIT).
const qrcode = require('./vendor/qrcode-generator');

function qrSvg(text, { cell = 4, margin = 4 } = {}) {
  const qr = qrcode(0, 'M');
  qr.addData(String(text), 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const size = (n + margin * 2) * cell;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${(c + margin) * cell} ${(r + margin) * cell}h${cell}v${cell}h-${cell}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff"/><path d="${d}" fill="#000000"/></svg>`;
}

function qrDataUrl(text, opts) {
  return `data:image/svg+xml;base64,${Buffer.from(qrSvg(text, opts), 'utf8').toString('base64')}`;
}

module.exports = { qrSvg, qrDataUrl };
