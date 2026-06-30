'use strict';
// ---------------------------------------------------------------------------
// Smart Autofill — in-page widget for the Identity Data Vault.
//
// This module exports the SOURCE of a self-contained bootstrap that runs INSIDE
// every launched Chromium profile page (injected via puppeteer's
// evaluateOnNewDocument in browserEngine). The page cannot reach Electron IPC, so
// it talks to the backend through two functions exposed on `window` by the bridge
// (browserEngine `exposeFunction`):
//   • window.__sgPersonaList(url)        -> [persona, …] available for this host
//   • window.__sgPersonaMarkUsed(id,url) -> { ok }   (appends the domain)
//
// The widget is a Shadow-DOM overlay (so page CSS can't break it and ours can't
// leak), shows only when a signup/registration form is detected, fills matched
// fields with human-like typing (random 50–150ms delays, real keydown/keypress/
// input/keyup events, React-safe native value setter), and offers a "Mark
// identity as used on this site" button.
//
// Implemented as a real named function so `node --check` syntax-validates it;
// buildAutofillBootstrap() serializes it to an IIFE string for injection.
// ---------------------------------------------------------------------------

function personaAutofillMain() {
  try {
    // Top frame only, real http(s) pages only, once per document.
    if (window.top !== window.self) return;
    if (!/^https?:$/.test(location.protocol)) return;
    if (!location.hostname) return;
    if (window.__sgPersonaInit) return;
    window.__sgPersonaInit = true;

    var BRAND = '#3DC6DA';
    var personas = [];   // available personas for this host (loaded on open)
    var selected = null; // the persona last filled (for "mark used")
    var isOpen = false;
    var loading = false;

    var delay = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var rand = function (min, max) { return Math.floor(min + Math.random() * (max - min)); };
    function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

    // --- Shadow-DOM host -----------------------------------------------------
    var host = document.createElement('div');
    host.id = '__sg-persona-host';
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;bottom:18px;right:18px;';
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' +
      ':host{all:initial}' +
      '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}' +
      '.fab{width:48px;height:48px;border-radius:50%;border:none;cursor:pointer;color:#04222a;font-weight:800;font-size:13px;' +
      'background:linear-gradient(135deg,' + BRAND + ',#2aa3b5);box-shadow:0 8px 24px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;transition:transform .15s}' +
      '.fab:hover{transform:translateY(-2px)}' +
      '.panel{position:absolute;bottom:60px;right:0;width:320px;max-height:60vh;overflow:hidden;display:flex;flex-direction:column;' +
      'background:#0f1722;color:#e6edf3;border:1px solid #243140;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.5)}' +
      '.hd{padding:12px 14px;border-bottom:1px solid #243140;display:flex;align-items:center;gap:8px}' +
      '.dot{width:9px;height:9px;border-radius:50%;background:' + BRAND + '}' +
      '.hd b{font-size:13px;font-weight:700}.hd span{font-size:11px;color:#8aa0b2;margin-left:auto}' +
      '.body{padding:8px;overflow:auto}' +
      '.row{width:100%;text-align:left;background:#16212e;border:1px solid #243140;border-radius:10px;padding:9px 11px;margin:6px 0;cursor:pointer;color:#e6edf3;transition:border-color .15s,background .15s}' +
      '.row:hover{border-color:' + BRAND + ';background:#1b2937}' +
      '.row .nm{font-size:13px;font-weight:600}.row .em{font-size:11px;color:#8aa0b2;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.row .lb{display:inline-block;margin-top:5px;font-size:10px;color:' + BRAND + ';background:rgba(61,198,218,.12);border:1px solid rgba(61,198,218,.3);border-radius:999px;padding:1px 7px}' +
      '.empty{padding:18px 12px;text-align:center;color:#8aa0b2;font-size:12px;line-height:1.5}' +
      '.ft{padding:10px;border-top:1px solid #243140;display:flex;gap:8px}' +
      '.btn{flex:1;border:none;border-radius:9px;padding:9px;font-size:12px;font-weight:700;cursor:pointer}' +
      '.btn.mark{background:linear-gradient(135deg,' + BRAND + ',#2aa3b5);color:#04222a}' +
      '.btn.ghost{background:transparent;border:1px solid #243140;color:#aebfcd}' +
      '.btn:disabled{opacity:.5;cursor:default}' +
      '.toast{position:absolute;bottom:60px;right:0;background:#04222a;border:1px solid ' + BRAND + ';color:#e6edf3;font-size:12px;padding:8px 12px;border-radius:9px;max-width:300px}' +
      '[hidden]{display:none!important}' +
      '</style>' +
      '<div class="toast" hidden></div>' +
      '<div class="panel" hidden>' +
      '  <div class="hd"><span class="dot"></span><b>SoftGlaze Autofill</b><span class="cnt"></span></div>' +
      '  <div class="body"></div>' +
      '  <div class="ft" hidden><button class="btn mark">Mark identity as used on this site</button></div>' +
      '</div>' +
      '<button class="fab" title="SoftGlaze Smart Autofill" hidden>SG</button>';

    var fab = root.querySelector('.fab');
    var panel = root.querySelector('.panel');
    var body = root.querySelector('.body');
    var footer = root.querySelector('.ft');
    var markBtn = root.querySelector('.mark');
    var cntEl = root.querySelector('.cnt');
    var toastEl = root.querySelector('.toast');

    function mount() { if (document.body && !host.isConnected) document.body.appendChild(host); }
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

    var toastTimer = null;
    function toast(msg) {
      toastEl.textContent = msg;
      toastEl.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2600);
    }

    // --- form detection ------------------------------------------------------
    function looksLikeSignup() {
      try {
        if (document.querySelector('input[type="password"],input[autocomplete="new-password"],input[autocomplete="current-password"]')) return true;
        var email = document.querySelector('input[type="email"],input[autocomplete="email"],input[name*="email" i],input[id*="email" i]');
        var nameish = document.querySelector('input[autocomplete="given-name"],input[autocomplete="name"],input[name*="name" i],input[id*="name" i],input[name*="user" i],input[id*="user" i]');
        if (email && nameish) return true;
        var btns = document.querySelectorAll('button,input[type="submit"],[role="button"],a');
        for (var i = 0; i < btns.length && i < 400; i++) {
          var t = (btns[i].textContent || btns[i].value || '').toLowerCase();
          if (/sign\s*up|register|create\s+(an\s+)?account|create your account|join (now|free)|get started|sign up free/.test(t)) return true;
        }
      } catch (e) {}
      return false;
    }
    function updateVisibility() {
      var show = looksLikeSignup();
      fab.hidden = !show;
      if (!show && isOpen) { isOpen = false; panel.hidden = true; }
    }
    var mo = new MutationObserver(debounce(updateVisibility, 450));
    function startObserving() {
      try { mo.observe(document.documentElement || document, { childList: true, subtree: true }); } catch (e) {}
      updateVisibility();
    }
    if (document.body) startObserving(); else document.addEventListener('DOMContentLoaded', startObserving);

    // --- open / load ---------------------------------------------------------
    fab.addEventListener('click', function () { toggle(); });
    async function toggle() {
      isOpen = !isOpen;
      panel.hidden = !isOpen;
      if (!isOpen) return;
      if (loading) return;
      loading = true;
      body.innerHTML = '<div class="empty">Loading identities…</div>';
      footer.hidden = true;
      try {
        var res = await window.__sgPersonaList(location.href);
        personas = Array.isArray(res) ? res : (res && Array.isArray(res.personas) ? res.personas : []);
      } catch (e) { personas = []; }
      loading = false;
      renderList();
    }

    function renderList() {
      body.innerHTML = '';
      cntEl.textContent = personas.length ? (personas.length + ' available') : '';
      if (!personas.length) {
        var d = document.createElement('div');
        d.className = 'empty';
        d.textContent = 'No unused identities for ' + location.hostname + '. Add some in SoftGlaze → Data Vault, or reset a persona’s used status.';
        body.appendChild(d);
        return;
      }
      personas.forEach(function (p) {
        var btn = document.createElement('button');
        btn.className = 'row';
        var nm = document.createElement('div'); nm.className = 'nm';
        nm.textContent = [p.firstName, p.lastName].filter(Boolean).join(' ') || p.username || p.email || 'Identity';
        var em = document.createElement('div'); em.className = 'em';
        em.textContent = p.email || p.username || '';
        btn.appendChild(nm); btn.appendChild(em);
        if (p.label) { var lb = document.createElement('span'); lb.className = 'lb'; lb.textContent = p.label; btn.appendChild(lb); }
        btn.addEventListener('click', function () { fillWith(p); });
        body.appendChild(btn);
      });
    }

    // --- field matching + human typing --------------------------------------
    function fillable(el) {
      if (!el || el.disabled || el.readOnly) return false;
      var t = (el.type || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset', 'range', 'color'].indexOf(t) >= 0) return false;
      if (el.offsetParent === null && (!el.getClientRects || el.getClientRects().length === 0)) return false;
      return true;
    }
    function attrStr(el) {
      var p = [el.name, el.id, el.getAttribute('placeholder'), el.getAttribute('autocomplete'), el.getAttribute('aria-label'), el.getAttribute('title'), el.type];
      try { if (el.labels && el.labels.length) p.push(el.labels[0].textContent); } catch (e) {}
      try { var l = el.closest && el.closest('label'); if (l) p.push(l.textContent); } catch (e) {}
      return p.filter(Boolean).join(' ').toLowerCase();
    }
    function nativeSet(el, value) {
      try {
        var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        var desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, value); else el.value = value;
      } catch (e) { try { el.value = value; } catch (_) {} }
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function setSelect(el, val) {
      var v = String(val).toLowerCase(), o, i;
      for (i = 0; i < el.options.length; i++) { o = el.options[i]; if ((o.value || '').toLowerCase() === v || (o.textContent || '').trim().toLowerCase() === v) { el.value = o.value; el.dispatchEvent(new Event('change', { bubbles: true })); return; } }
      for (i = 0; i < el.options.length; i++) { o = el.options[i]; if ((o.textContent || '').trim().toLowerCase().indexOf(v) >= 0) { el.value = o.value; el.dispatchEvent(new Event('change', { bubbles: true })); return; } }
    }
    async function typeInto(el, value) {
      try { el.focus(); el.dispatchEvent(new Event('focus', { bubbles: true })); } catch (e) {}
      nativeSet(el, '');
      for (var i = 0; i < value.length; i++) {
        var ch = value.charAt(i);
        el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true }));
        nativeSet(el, el.value + ch);
        el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
        await delay(50 + rand(0, 100));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      try { el.blur(); el.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {}
    }

    // Ordered match predicates (key, regex on the field's attribute string, extra test).
    var PLAN = [
      ['firstName', /first[\s_-]*name|given[\s_-]*name|fname|forename/, 'given-name'],
      ['lastName', /last[\s_-]*name|surname|family[\s_-]*name|lname/, 'family-name'],
      ['email', /e[\s_-]*mail/, 'email'],
      ['username', /user[\s_-]*name|\buser\b|login|handle|nickname/, 'username'],
      ['phone', /phone|mobile|\btel\b|cell/, 'tel'],
      ['dateOfBirth', /birth|\bdob\b/, 'bday'],
      ['addressLine1', /address[\s_-]*(line)?[\s_-]*1|street|^address$|addr1/, 'address-line1'],
      ['addressLine2', /address[\s_-]*(line)?[\s_-]*2|apt|suite|\bunit\b|addr2/, 'address-line2'],
      ['city', /\bcity\b|town|locality/, 'address-level2'],
      ['state', /\bstate\b|province|region/, 'address-level1'],
      ['zipCode', /\bzip\b|postal|postcode/, 'postal-code'],
      ['country', /country|nation/, 'country'],
      ['company', /company|organi[sz]ation|employer|business/, 'organization']
    ];

    async function fillWith(p) {
      selected = p;
      var all = Array.prototype.slice.call(document.querySelectorAll('input,textarea,select')).filter(fillable);
      var used = [];
      function take(pred) {
        for (var i = 0; i < all.length; i++) { if (used.indexOf(all[i]) >= 0) continue; if (pred(all[i])) { used.push(all[i]); return all[i]; } }
        return null;
      }
      // 1) Collect the matched (field, value) pairs. Filling happens afterwards —
      //    either via CDP "trusted" typing (Chromium bridge) or in-page events.
      var matches = []; // { el, value, kind }
      for (var i = 0; i < PLAN.length; i++) {
        var key = PLAN[i][0], rx = PLAN[i][1], ac = PLAN[i][2];
        var val = p[key];
        if (!val) continue;
        var el = take((function (rx, ac, key) {
          return function (e) {
            if (key === 'email' && (e.type || '').toLowerCase() === 'email') return true;
            if (key === 'phone' && (e.type || '').toLowerCase() === 'tel') return true;
            var acAttr = (e.getAttribute('autocomplete') || '').toLowerCase();
            if (ac && acAttr.indexOf(ac) >= 0) return true;
            return rx.test(attrStr(e));
          };
        })(rx, ac, key));
        if (!el) continue;
        matches.push({ el: el, value: String(val), kind: el.tagName === 'SELECT' ? 'select' : 'text' });
      }
      // Full-name fallback: a single name field when no first/last was matched.
      if (p.firstName || p.lastName) {
        var nameEl = take(function (e) {
          if (e.tagName === 'SELECT') return false;
          var ac = (e.getAttribute('autocomplete') || '').toLowerCase();
          if (ac === 'name') return true;
          var s = attrStr(e);
          return /full[\s_-]*name|your[\s_-]*name|^name$|\bname\b/.test(s) && !/user|first|last|given|family|sur/.test(s);
        });
        if (nameEl) matches.push({ el: nameEl, value: [p.firstName, p.lastName].filter(Boolean).join(' '), kind: 'text' });
      }
      // Passwords: fill EVERY password field (covers "confirm password").
      if (p.password) {
        var pws = all.filter(function (e) { return (e.type || '').toLowerCase() === 'password' && used.indexOf(e) < 0; });
        for (var k = 0; k < pws.length; k++) { used.push(pws[k]); matches.push({ el: pws[k], value: String(p.password), kind: 'text' }); }
      }

      // 2) Fill. Prefer CDP trusted typing when the host exposes the bridge
      //    (Chromium) — real keydown/keyup with isTrusted:true. Otherwise fall back
      //    to in-page synthetic typing (e.g. Firefox, or if the bridge errors).
      var filled = 0;
      var trusted = (typeof window.__sgPersonaFillPlan === 'function');
      if (trusted && matches.length) {
        var plan = matches.map(function (m, idx) {
          try { m.el.setAttribute('data-sgfill', String(idx)); } catch (e) {}
          return { sel: '[data-sgfill="' + idx + '"]', value: m.value, kind: m.kind };
        });
        try {
          var r = await window.__sgPersonaFillPlan(plan);
          filled = (r && typeof r.filled === 'number') ? r.filled : matches.length;
        } catch (e) { trusted = false; }
        matches.forEach(function (m) { try { m.el.removeAttribute('data-sgfill'); } catch (e) {} });
      }
      if (!trusted) {
        for (var j = 0; j < matches.length; j++) {
          var m = matches[j];
          if (m.kind === 'select') setSelect(m.el, m.value); else await typeInto(m.el, m.value);
          filled++;
          await delay(100 + rand(0, 140));
        }
      }
      footer.hidden = false;
      toast(filled ? ('Filled ' + filled + ' field' + (filled === 1 ? '' : 's') + '. Review, then mark as used.') : 'No matching fields found on this page.');
    }

    // --- mark used -----------------------------------------------------------
    markBtn.addEventListener('click', async function () {
      if (!selected) return;
      markBtn.disabled = true;
      try {
        await window.__sgPersonaMarkUsed(selected.id, location.href);
        toast('Marked as used on ' + location.hostname);
        personas = personas.filter(function (x) { return x.id !== selected.id; });
        selected = null;
        footer.hidden = true;
        renderList();
      } catch (e) {
        toast('Could not save — try again.');
      }
      markBtn.disabled = false;
    });
  } catch (e) { /* never break the host page */ }
}

// Serialize the bootstrap to an IIFE string for evaluateOnNewDocument injection.
function buildAutofillBootstrap() {
  return '(' + personaAutofillMain.toString() + ')();';
}

module.exports = { buildAutofillBootstrap };
