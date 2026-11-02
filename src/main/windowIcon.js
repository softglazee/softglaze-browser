'use strict';
// Best-effort per-profile taskbar icon: Windows takes a window's icon from the exe, so push one
// with WM_SETICON through a short PowerShell P/Invoke (window found by PID); Chrome may repaint it.
// Icons are original colored marks drawn in code, not vendor logos (trademark-safe).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const ICON_DIR = path.join(os.tmpdir(), 'softglaze-brand-icons');

// Matches BrowserBrandSelect. Chrome is listed so its icon replaces the Chrome-for-Testing badge.
const BRAND_COLORS = {
  Chrome: [66, 133, 244],
  Edge: [15, 138, 224],
  Brave: [251, 84, 43],
  Opera: [255, 27, 45],
  Vivaldi: [239, 57, 57],
  Yandex: [255, 51, 51]
};

function normalizeBrand(brand) {
  const t = String(brand || '').toLowerCase();
  if (t.includes('edge')) return 'Edge';
  if (t.includes('brave')) return 'Brave';
  if (t.includes('opera') || t === 'opr') return 'Opera';
  if (t.includes('vivaldi')) return 'Vivaldi';
  if (t.includes('yandex') || t.includes('yabrowser')) return 'Yandex';
  return 'Chrome';
}

// Builds a 32x32 32bpp .ico in code: accent-colored rounded square with a white centered ring.
function buildIcoBuffer([r, g, b]) {
  const S = 32;
  const cornerR = 5;
  const cx = (S - 1) / 2;
  const cy = (S - 1) / 2;
  const outerRing = 10.5; // ring outer radius
  const innerRing = 6.5; // ring inner radius

  // XOR bitmap is bottom-up, BGRA per pixel.
  const xor = Buffer.alloc(S * S * 4);
  for (let row = 0; row < S; row++) {
    const y = S - 1 - row; // bottom-up → screen y
    for (let x = 0; x < S; x++) {
      // Rounded-rect alpha (transparent corners).
      let inside = true;
      const nearL = x < cornerR, nearR = x > S - 1 - cornerR;
      const nearT = y < cornerR, nearB = y > S - 1 - cornerR;
      if ((nearL || nearR) && (nearT || nearB)) {
        const ccx = nearL ? cornerR : S - 1 - cornerR;
        const ccy = nearT ? cornerR : S - 1 - cornerR;
        if (Math.hypot(x - ccx, y - ccy) > cornerR + 0.5) inside = false;
      }
      const off = (row * S + x) * 4;
      if (!inside) { xor[off] = 0; xor[off + 1] = 0; xor[off + 2] = 0; xor[off + 3] = 0; continue; }
      // White ring glyph in the center, accent everywhere else.
      const dist = Math.hypot(x - cx, y - cy);
      const isRing = dist <= outerRing && dist >= innerRing;
      if (isRing) { xor[off] = 255; xor[off + 1] = 255; xor[off + 2] = 255; xor[off + 3] = 255; }
      else { xor[off] = b; xor[off + 1] = g; xor[off + 2] = r; xor[off + 3] = 255; }
    }
  }
  // AND mask: 1 bit/pixel, rows padded to 4 bytes. All zero (alpha handles it).
  const maskRow = 4; // ceil(32/8)=4, already 4-byte aligned
  const andMask = Buffer.alloc(S * maskRow, 0);

  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(S, 4); // biWidth
  header.writeInt32LE(S * 2, 8); // biHeight (XOR + AND)
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  // rest zero (compression=0 etc.)

  const dib = Buffer.concat([header, xor, andMask]);

  const iconDir = Buffer.alloc(6);
  iconDir.writeUInt16LE(0, 0); // reserved
  iconDir.writeUInt16LE(1, 2); // type = icon
  iconDir.writeUInt16LE(1, 4); // count

  const entry = Buffer.alloc(16);
  entry.writeUInt8(S, 0); // width
  entry.writeUInt8(S, 1); // height
  entry.writeUInt8(0, 2); // color count
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bit count
  entry.writeUInt32LE(dib.length, 8); // bytes in resource
  entry.writeUInt32LE(6 + 16, 12); // image offset

  return Buffer.concat([iconDir, entry, dib]);
}

// Generates and caches the brand's .ico on disk; returns its path, or null for Chrome/unknown brands.
function ensureBrandIcon(brand) {
  const id = normalizeBrand(brand);
  const color = BRAND_COLORS[id];
  if (!color) return null;
  try {
    fs.mkdirSync(ICON_DIR, { recursive: true });
    const file = path.join(ICON_DIR, `${id}.ico`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, buildIcoBuffer(color));
    return file;
  } catch (e) { return null; }
}

// Sets the icon on the process's top-level window via WM_SETICON. The script polls briefly
// because the window may not exist yet right after launch.
function applyWindowIcon(pid, icoPath) {
  if (process.platform !== 'win32' || !pid || !icoPath) return;
  const ps = `
$ErrorActionPreference='SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class SgWin {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr LoadImage(IntPtr h, string n, uint t, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
"@
$target=[uint32]${pid}
$ico='${String(icoPath).replace(/'/g, "''")}'
$small=[SgWin]::LoadImage([IntPtr]::Zero,$ico,1,16,16,0x00000010)
$big=[SgWin]::LoadImage([IntPtr]::Zero,$ico,1,32,32,0x00000010)
$cb=[SgWin+EnumWindowsProc]{ param($h,$l)
  $p=0; [void][SgWin]::GetWindowThreadProcessId($h,[ref]$p)
  if($p -eq $target -and [SgWin]::IsWindowVisible($h) -and [SgWin]::GetWindow($h,4) -eq [IntPtr]::Zero){
    [void][SgWin]::SendMessage($h,0x80,[IntPtr]0,$small)
    [void][SgWin]::SendMessage($h,0x80,[IntPtr]1,$big)
  }
  return $true
}
for($i=0;$i -lt 24;$i++){
  [void][SgWin]::EnumWindows($cb,[IntPtr]::Zero)
  Start-Sleep -Milliseconds 500
}`;
  try {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], { windowsHide: true, detached: true, stdio: 'ignore' });
    child.unref();
  } catch (e) { /* best-effort */ }
}

// No-op for Chrome and on non-Windows platforms.
function applyBrandWindowIcon(pid, brand) {
  try {
    const ico = ensureBrandIcon(brand);
    if (ico) applyWindowIcon(pid, ico);
  } catch (e) { /* best-effort */ }
}

module.exports = { applyBrandWindowIcon, normalizeBrand };
