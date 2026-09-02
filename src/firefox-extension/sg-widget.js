/* GENERATED from src/main/personaAutofill.js — DO NOT EDIT.
   Run `npm run build:firefox-ext` to regenerate. */
(function personaAutofillMain() {
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
    var filledEls = new WeakSet(); // fields WE autofilled (multi-step re-runs skip them)
    var multiStepObserver = null;  // watches for later wizard steps to appear
    var isOpen = false;
    var loading = false;

    var delay = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var rand = function (min, max) { return Math.floor(min + Math.random() * (max - min)); };
    function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

    // --- Shadow-DOM host -----------------------------------------------------
    var host = document.createElement('div');
    // audit C2: a stable id + an OPEN shadow root let page JS do
    // document.getElementById('__sg-persona-host').shadowRoot and drive the widget's
    // buttons to exfiltrate the vault (3 lines of script, no user interaction). Use a
    // random id and a CLOSED root so the page can neither find it reliably nor reach in.
    host.id = '__sg_' + Math.random().toString(36).slice(2, 10);
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;bottom:18px;right:18px;';
    var root = host.attachShadow({ mode: 'closed' });
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
    fab.addEventListener('click', function (e) { if (!e.isTrusted) return; toggle(); }); // audit C2: ignore page-scripted clicks
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
        btn.addEventListener('click', function (e) { if (!e.isTrusted) return; fillWith(p).then(function () { armMultiStep(p); }); }); // audit C2: only a real user click fills
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
    // Authoritative React/SPA-safe commit (same mechanism every password
    // manager uses): write through the NATIVE value setter from the prototype
    // descriptor — not the element instance — so React's controlled-input
    // override is bypassed, then fire input + change + blur so React's synthetic
    // event system updates its Virtual DOM. Without this, the framework keeps
    // its internal value tracker out of sync and submits an empty string.
    function setReactInputValue(el, value) {
      try {
        var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        var desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, value); else el.value = value;
      } catch (e) { try { el.value = value; } catch (_) {} }
      try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
      try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
      try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {}
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
      // Authoritative final commit so React/Vue controlled inputs register the
      // complete value (fires input + change + blur via the native setter).
      setReactInputValue(el, value);
      try { el.blur(); } catch (e) {}
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

    // A header/site SEARCH box must never receive persona data.
    function isSearchDecoy(el) {
      if ((el.type || '').toLowerCase() === 'search') return true;
      return /\bsearch\b|search[\s_-]*(field|box|query|term)|\bquery\b|(^|[^a-z])term([^a-z]|$)/.test(attrStr(el));
    }
    // Would a persona plausibly target this field? Used only to SCORE forms.
    function isMatchable(el) {
      var t = (el.type || '').toLowerCase();
      if (t === 'password' || t === 'email' || t === 'tel') return true;
      var s = attrStr(el);
      for (var i = 0; i < PLAN.length; i++) { if (PLAN[i][1].test(s)) return true; }
      return /full[\s_-]*name|your[\s_-]*name|^name$|\bname\b/.test(s);
    }
    // Choose the ONE best target form to fill, so the persona never lands in a header
    // search box or a footer newsletter/subscribe field (the reported bug where the
    // name/email went into "Sign up to receive..."). Fillable inputs are grouped by
    // their owning <form> (form-less inputs share a group for SPA layouts), search
    // decoys are dropped, and each group is scored by password-presence + how many
    // fields a persona could match. The richest group wins; if nothing scores we fall
    // back to every non-decoy field (previous whole-page behavior).
    function collectTargetFields() {
      var everything = Array.prototype.slice.call(document.querySelectorAll('input,textarea,select'))
        .filter(fillable).filter(function (e) { return !isSearchDecoy(e); });
      if (everything.length < 2) return everything;
      var groups = [];
      var byForm = new Map();
      for (var i = 0; i < everything.length; i++) {
        var f = everything[i].form || null;
        var g = byForm.get(f);
        if (!g) { g = []; byForm.set(f, g); groups.push(g); }
        g.push(everything[i]);
      }
      var best = null, bestScore = -1;
      for (var k = 0; k < groups.length; k++) {
        var fields = groups[k], score = 0;
        for (var j = 0; j < fields.length; j++) {
          if ((fields[j].type || '').toLowerCase() === 'password') score += 100;
          if (isMatchable(fields[j])) score += 1;
        }
        if (score > bestScore) { bestScore = score; best = fields; }
      }
      return (best && bestScore > 0) ? best : everything;
    }
    // Multi-step forms (wizards, email-then-password, Ferguson-style 3-step signup):
    // after the first fill, watch for the NEXT step's fields to appear and fill the
    // ones still empty. Bounded (3 min), debounced, and only fires when a new matchable
    // EMPTY field shows up — so it never fights the user or loops on SPA re-renders.
    function armMultiStep(p) {
      if (multiStepObserver || !p) return;
      var pending = false;
      function newEmptyFieldExists() {
        var fs = collectTargetFields();
        for (var i = 0; i < fs.length; i++) {
          var e = fs[i];
          if (filledEls.has(e) || e === document.activeElement) continue;
          if (e.value && String(e.value).length) continue;
          if (isMatchable(e)) return true;
        }
        return false;
      }
      var run = debounce(function () {
        if (pending || !newEmptyFieldExists()) return;
        pending = true;
        fillWith(p, { onlyEmpty: true }).catch(function () {}).then(function () { pending = false; });
      }, 500);
      try {
        multiStepObserver = new MutationObserver(run);
        multiStepObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'] });
      } catch (e) { multiStepObserver = null; }
      setTimeout(function () { if (multiStepObserver) { try { multiStepObserver.disconnect(); } catch (e) {} multiStepObserver = null; } }, 180000);
    }

    async function fillWith(p, opts) {
      opts = opts || {};
      selected = p;
      var all = collectTargetFields();
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
      // Passwords: fill EVERY password field (covers "confirm password"). The
      // plaintext is NEVER shipped to page JS in the list payload (audit C2) — the
      // list only tells us `hasPassword`. On Chromium the backend types the real
      // value server-side by persona id via the trusted CDP bridge; on Firefox the
      // ISOLATED content-script fetches it on demand via __sgPersonaGetSecret (see
      // the fallback below). Kind 'password' carries only the persona id.
      if (p.hasPassword) {
        var pws = all.filter(function (e) { return (e.type || '').toLowerCase() === 'password' && used.indexOf(e) < 0; });
        for (var k = 0; k < pws.length; k++) { used.push(pws[k]); matches.push({ el: pws[k], kind: 'password', personaId: p.id }); }
      }

      // Multi-step re-run: on a later wizard step only fill fields that are still
      // empty, not currently focused, and not already filled by us — and never
      // re-issue the password. Stops the observer from re-typing or fighting the user.
      if (opts.onlyEmpty) {
        matches = matches.filter(function (m) {
          if (m.kind === 'password') return false;
          if (m.el === document.activeElement) return false;
          if (filledEls.has(m.el)) return false;
          if (m.kind === 'select') return !m.el.value;
          return !(m.el.value && String(m.el.value).length);
        });
        if (!matches.length) return;
      }

      // 2) Fill. Prefer CDP trusted typing when the host exposes the bridge
      //    (Chromium) — real keydown/keyup with isTrusted:true. Otherwise fall back
      //    to in-page synthetic typing (e.g. Firefox, or if the bridge errors).
      var filled = 0;
      var trusted = (typeof window.__sgPersonaFillPlan === 'function');
      if (trusted && matches.length) {
        var plan = matches.map(function (m, idx) {
          try { m.el.setAttribute('data-sgfill', String(idx)); } catch (e) {}
          var it = { sel: '[data-sgfill="' + idx + '"]', kind: m.kind };
          // Password items carry only the persona id; the backend resolves the
          // plaintext server-side. All other kinds carry their (non-secret) value.
          if (m.kind === 'password') it.personaId = m.personaId; else it.value = m.value;
          return it;
        });
        try {
          var r = await window.__sgPersonaFillPlan(plan);
          filled = (r && typeof r.filled === 'number') ? r.filled : matches.length;
        } catch (e) { trusted = false; }
        matches.forEach(function (m) { try { m.el.removeAttribute('data-sgfill'); } catch (e) {} try { filledEls.add(m.el); } catch (e) {} });
      }
      if (!trusted) {
        // Fallback in-page typing (Firefox, or if the CDP bridge errored). On Firefox
        // the widget runs in the extension's ISOLATED content-script world — page JS
        // cannot read these expandos or the typed value beyond the DOM field itself —
        // so it fetches ONLY the selected persona's password on demand via
        // __sgPersonaGetSecret (origin-scoped server-side) and types it here. When
        // that bridge is absent (e.g. plain Chromium fallback) password fields are
        // skipped rather than filled blank.
        var canGetSecret = (typeof window.__sgPersonaGetSecret === 'function');
        var secretVal = null; // resolved once per fill (same persona for every pw field)
        var skippedSecret = false;
        for (var j = 0; j < matches.length; j++) {
          var m = matches[j];
          if (m.kind === 'password') {
            if (!canGetSecret) { skippedSecret = true; continue; }
            if (secretVal === null) {
              try { var sr = await window.__sgPersonaGetSecret(p.id, location.href); secretVal = (sr && sr.password != null) ? String(sr.password) : ''; }
              catch (e) { secretVal = ''; }
            }
            if (!secretVal) { skippedSecret = true; continue; }
            await typeInto(m.el, secretVal);
            filled++; try { filledEls.add(m.el); } catch (e) {}
            await delay(100 + rand(0, 140));
            continue;
          }
          if (m.kind === 'select') setSelect(m.el, m.value); else await typeInto(m.el, m.value);
          filled++; try { filledEls.add(m.el); } catch (e) {}
          await delay(100 + rand(0, 140));
        }
        if (skippedSecret) { toast(filled ? 'Filled fields, but the password could not be autofilled here.' : 'Autofill unavailable — could not fill the password on this page.'); }
      }
      if (!opts.onlyEmpty) {
        footer.hidden = false;
        toast(filled ? ('Filled ' + filled + ' field' + (filled === 1 ? '' : 's') + '. Review, then mark as used.') : 'No matching fields found on this page.');
      } else if (filled) {
        toast('Filled ' + filled + ' more field' + (filled === 1 ? '' : 's') + ' on this step.');
      }
    }

    // --- mark used -----------------------------------------------------------
    markBtn.addEventListener('click', async function (e) {
      if (!e.isTrusted) return; // audit C2: ignore page-scripted clicks
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
})();
