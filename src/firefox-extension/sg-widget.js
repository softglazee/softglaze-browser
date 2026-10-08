/* GENERATED from src/main/personaAutofill.js — DO NOT EDIT.
   Run `npm run build:firefox-ext` to regenerate. */
(function personaAutofillMain(sgRpc) {
  try {
    // Top frame only, real http(s) pages only, once per document.
    if (window.top !== window.self) return;
    if (!/^https?:$/.test(location.protocol)) return;
    if (!location.hostname) return;
    if (window.__sgPersonaInit) return;
    window.__sgPersonaInit = true; // isolated-world expando: invisible to the page

    var BRAND = '#3DC6DA';
    var personas = [];   // available personas for this host (loaded on open)
    var selected = null; // the persona last filled (for "mark used")
    var filledEls = new WeakSet(); // fields WE autofilled (multi-step re-runs skip them)
    var multiStepObserver = null;  // watches for later wizard steps to appear
    var isOpen = false;
    var loading = false;
    var filling = false; // a user-started fill is running
    // The identity being used for a signup on this site. It stays active across wizard
    // steps and page loads (the backend remembers it per site) and is only marked as
    // used when the FINAL submit happens - marking it used after step 1 dropped it from
    // the list, so step 2 had nothing to fill with.
    var active = null;

    // Bridge call. Chromium hands us sgRpc (world-scoped CDP binding first,
    // body-authenticated sentinel-fetch RPC for engines like fingerprint-chromium
    // that drop bindings). The Firefox extension instead defines the raw
    // window.__sgPersona* functions in its content-script sandbox, so call the named
    // function directly there - one widget source, both browsers.
    function sgCall(name) {
      var args = Array.prototype.slice.call(arguments, 1);
      if (typeof sgRpc === 'function') return sgRpc.apply(null, arguments);
      var fn = window[name];
      if (typeof fn === 'function') {
        try { return Promise.resolve(fn.apply(window, args)); } catch (e) { return Promise.reject(e); }
      }
      return Promise.reject(new Error('bridge unavailable'));
    }
    function sgHas(name) {
      return typeof sgRpc === 'function' || typeof window[name] === 'function';
    }
    // Active-identity tracking needs a backend that remembers it across documents. An
    // older Firefox extension without it keeps the old behaviour (mark used on fill).
    function canTrackActive() { return sgHas('__sgPersonaActive'); }
    function setActive(p) {
      active = p || null;
      if (!canTrackActive()) return Promise.resolve(false);
      return sgCall('__sgPersonaActive', p ? 'set' : 'clear', p ? p.id : '')
        .then(function () { return true; }, function () { return false; });
    }
    // Per-document attribute used to hand matched fields to the trusted typer. A
    // fixed name would be one more SoftGlaze tell in the DOM.
    var FILL_ATTR = 'data-' + 'k' + Math.random().toString(36).slice(2, 9);

    var delay = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var rand = function (min, max) { return Math.floor(min + Math.random() * (max - min)); };
    function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

    // --- Shadow-DOM host -----------------------------------------------------
    var host = document.createElement('div');
    // audit C2: a stable id + an OPEN shadow root let page JS do
    // document.getElementById('__sg-persona-host').shadowRoot and drive the widget's
    // buttons to exfiltrate the vault (3 lines of script, no user interaction). The
    // root is CLOSED so the page cannot reach in. audit E2: no id at all, and the host
    // is only in the DOM while the button is showing (see updateVisibility), so pages
    // without a signup form never see an extra element.
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;bottom:18px;right:18px;';
    var root = host.attachShadow({ mode: 'closed' });
    // Built with DOM calls, not innerHTML: the markup is static, but Mozilla's
    // add-on linter (this source is also the Firefox content script) flags any
    // innerHTML assignment, and DOM building keeps review clean.
    var CSS =
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
      '.row.on{border-color:' + BRAND + '}' +
      '.row .lb{display:inline-block;margin-top:5px;font-size:10px;color:' + BRAND + ';background:rgba(61,198,218,.12);border:1px solid rgba(61,198,218,.3);border-radius:999px;padding:1px 7px}' +
      '.empty{padding:18px 12px;text-align:center;color:#8aa0b2;font-size:12px;line-height:1.5}' +
      '.ft{padding:10px;border-top:1px solid #243140;display:flex;gap:8px}' +
      '.btn{flex:1;border:none;border-radius:9px;padding:9px;font-size:12px;font-weight:700;cursor:pointer}' +
      '.btn.mark{background:linear-gradient(135deg,' + BRAND + ',#2aa3b5);color:#04222a}' +
      '.btn.ghost{background:transparent;border:1px solid #243140;color:#aebfcd}' +
      '.btn:disabled{opacity:.5;cursor:default}' +
      // width:max-content - the host is only as wide as the 48px button, so a plain
      // absolutely-positioned toast shrank to one word per line. z-index keeps it above
      // the panel (it used to render underneath it, so results were never seen).
      '.toast{position:absolute;bottom:60px;right:0;z-index:2;width:max-content;max-width:300px;line-height:1.4;background:#04222a;border:1px solid ' + BRAND + ';color:#e6edf3;font-size:12px;padding:8px 12px;border-radius:9px}' +
      '[hidden]{display:none!important}';
    function mk(tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text) n.textContent = text;
      return n;
    }
    var styleEl = mk('style'); styleEl.textContent = CSS; root.appendChild(styleEl);
    var toastEl = mk('div', 'toast'); toastEl.hidden = true; root.appendChild(toastEl);
    var panel = mk('div', 'panel'); panel.hidden = true; root.appendChild(panel);
    var hd = mk('div', 'hd'); hd.appendChild(mk('span', 'dot')); hd.appendChild(mk('b', '', 'SoftGlaze Autofill'));
    var cntEl = mk('span', 'cnt'); hd.appendChild(cntEl); panel.appendChild(hd);
    var body = mk('div', 'body'); panel.appendChild(body);
    var footer = mk('div', 'ft'); footer.hidden = true; panel.appendChild(footer);
    var markBtn = mk('button', 'btn mark', 'Mark as used'); footer.appendChild(markBtn);
    var relBtn = mk('button', 'btn ghost rel', 'Release'); relBtn.hidden = true; footer.appendChild(relBtn);
    var fab = mk('button', 'fab', 'SG'); fab.title = 'SoftGlaze Smart Autofill'; fab.hidden = true; root.appendChild(fab);
    function clearBody() { while (body.firstChild) body.removeChild(body.firstChild); }


    function mount() { if (document.body && !host.isConnected) document.body.appendChild(host); }
    function unmount() { try { if (host.isConnected) host.remove(); } catch (e) {} }

    var toastTimer = null;
    // Long messages stay up longer (about 60 ms a character, 2.6 s to 9 s).
    function toast(msg, ms) {
      mount();
      toastEl.textContent = msg;
      toastEl.hidden = false;
      clearTimeout(toastTimer);
      var dur = ms || Math.min(9000, Math.max(2600, String(msg).length * 60));
      toastTimer = setTimeout(function () { toastEl.hidden = true; }, dur);
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
      // A later wizard step often has no signup cues of its own (just "Phone" and
      // "Company"), so while an identity is active any fillable field keeps us visible.
      var show = looksLikeSignup() || (!!active && hasMatchableField());
      fab.hidden = !show;
      if (!show && isOpen) { isOpen = false; panel.hidden = true; }
      // Mount lazily; drop the host again once nothing of ours is visible.
      if (show) mount(); else if (toastEl.hidden) unmount();
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
      clearBody(); body.appendChild(mk('div', 'empty', 'Loading identities…'));
      footer.hidden = true;
      try {
        var res = await sgCall('__sgPersonaList', location.href);
        personas = Array.isArray(res) ? res : (res && Array.isArray(res.personas) ? res.personas : []);
      } catch (e) { personas = []; }
      loading = false;
      renderList();
    }

    // Keep the active identity first in the list (it is never marked used mid-signup,
    // so it is still offered for this site).
    function pinActive() {
      if (!active) return;
      var i = -1;
      for (var k = 0; k < personas.length; k++) { if (personas[k].id === active.id) { i = k; break; } }
      if (i > 0) personas.unshift(personas.splice(i, 1)[0]);
    }
    function renderList() {
      clearBody();
      pinActive();
      cntEl.textContent = personas.length ? (personas.length + ' available') : '';
      // While an identity is active the footer offers the manual controls: mark it
      // used now, or release it without marking (abandoned signup).
      footer.hidden = !active && !selected;
      relBtn.hidden = !active;
      if (!personas.length) {
        var d = document.createElement('div');
        d.className = 'empty';
        d.textContent = 'No unused identities for ' + location.hostname + '. Add some in SoftGlaze → Data Vault, or reset a persona’s used status.';
        body.appendChild(d);
        return;
      }
      personas.forEach(function (p) {
        var btn = document.createElement('button');
        var isActive = !!active && active.id === p.id;
        btn.className = isActive ? 'row on' : 'row';
        var nm = document.createElement('div'); nm.className = 'nm';
        nm.textContent = [p.firstName, p.lastName].filter(Boolean).join(' ') || p.username || p.email || 'Identity';
        var em = document.createElement('div'); em.className = 'em';
        em.textContent = p.email || p.username || '';
        btn.appendChild(nm); btn.appendChild(em);
        if (isActive || p.label) { var lb = document.createElement('span'); lb.className = 'lb'; lb.textContent = isActive ? 'In progress - fills each step' : p.label; btn.appendChild(lb); }
        btn.addEventListener('click', function (e) {
          if (!e.isTrusted) return; // audit C2/E1: only a real user click fills (and may carry a password)
          // One fill at a time. A second pick while the first is still typing used to
          // start a parallel fill whose keystrokes interleaved with the first.
          if (filling) { toast('Still filling - one moment.'); return; }
          // Close the panel before filling: left open it covers part of the form, and
          // the trusted click that focuses a field underneath it would land on another
          // identity row instead.
          isOpen = false; panel.hidden = true;
          filling = true;
          fillWith(p, { gesture: true })
            .catch(function () {})
            .then(function () { filling = false; armMultiStep(p); });
        });
        body.appendChild(btn);
      });
    }

    // --- field matching + human typing --------------------------------------
    function fillable(el) {
      if (!el || el.disabled || el.readOnly) return false;
      var t = (el.type || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset', 'range', 'color'].indexOf(t) >= 0) return false;
      if (el.offsetParent === null && (!el.getClientRects || el.getClientRects().length === 0)) return false;
      return isReallyVisible(el);
    }
    // Honeypots and decoys: a field a person cannot see must never be filled - filling one is
    // how spam filters spot a bot. Off-screen, transparent, zero-size and aria-hidden fields
    // are skipped.
    function isReallyVisible(el) {
      try {
        var r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        if (r.right < 0 || r.bottom < -window.innerHeight * 4 || r.left > (window.innerWidth || 0) + 2000) return false;
        var cs = window.getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
        if (el.closest && el.closest('[aria-hidden="true"]')) return false;
        if (el.getAttribute('tabindex') === '-1' && /honey|trap|bot|leave[\s_-]*blank/i.test((el.name || '') + ' ' + (el.id || ''))) return false;
      } catch (e) {}
      return true;
    }
    // Everything that describes a field, normalised so one set of rules works on every site:
    // camelCase, snake_case, kebab-case and dots become spaces ("billingZipCode" -> "billing zip
    // code"), so word boundaries work. The input TYPE is deliberately not mixed in (it used to be
    // appended, which made anchored rules like "^name$" impossible to match).
    function attrStr(el) {
      var p = [el.name, el.id, el.getAttribute('placeholder'), el.getAttribute('autocomplete'), el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('data-testid')];
      try { if (el.labels && el.labels.length) p.push(el.labels[0].textContent); } catch (e) {}
      try { var l = el.closest && el.closest('label'); if (l) p.push(l.textContent); } catch (e) {}
      try {
        var lb = el.getAttribute('aria-labelledby');
        if (lb) lb.split(/\s+/).forEach(function (id) { var n = document.getElementById(id); if (n) p.push(n.textContent); });
      } catch (e) {}
      try {
        // Label-less layouts: the nearest short text just before the field.
        if (!(el.labels && el.labels.length)) {
          var prev = el.previousElementSibling || (el.parentElement && el.parentElement.previousElementSibling);
          if (prev && prev.textContent && prev.textContent.trim().length <= 40) p.push(prev.textContent);
        }
      } catch (e) {}
      return normField(p.filter(Boolean).join(' '));
    }
    function normField(s) {
      return String(s || '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_\-.\[\]:*]+/g, ' ')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
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
    // descriptor - not the element instance - so React's controlled-input
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
    var attemptedEls = new WeakSet();
    function regionName(code) { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(String(code).toUpperCase()) || ''; } catch (e) { return ''; } }
    function resolveOption(el, val) {
      var v = String(val || '').trim().toLowerCase(); if (!v) return null;
      var alt = /^[a-z]{2}$/.test(v) ? regionName(v).toLowerCase() : '';
      var opts = Array.prototype.slice.call(el.options || []);
      function txt(o) { return (o.textContent || '').trim().toLowerCase(); }
      var hit = opts.find(function (o) { return (o.value || '').toLowerCase() === v || txt(o) === v || (alt && txt(o) === alt); })
        || opts.find(function (o) { var t = txt(o); return t && o.value && (t.indexOf(v) === 0 || (alt && t.indexOf(alt) === 0)); })
        || opts.find(function (o) { var t = txt(o); return v.length > 3 && t && o.value && t.indexOf(v) >= 0; });
      return hit ? hit.value : null;
    }
    function toIsoDate(v) {
      var s = String(v || '').trim(); var m;
      if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
      var d = new Date(s); if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      return '';
    }
    function setSelect(el, val) {
      var ov = resolveOption(el, val); if (ov == null) return;
      el.value = ov; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
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

    // Ordered match rules (key, rule on the NORMALISED field description, autocomplete token).
    // Country comes before state so a "Country/Region" field is never handed the state.
    var PLAN = [
      ['firstName', /\bfirst ?name\b|\bgiven ?name\b|\bfname\b|\bforename\b/, 'given-name'],
      ['lastName', /\blast ?name\b|\bsurname\b|\bfamily ?name\b|\blname\b/, 'family-name'],
      ['email', /\be ?mail\b/, 'email'],
      ['username', /\buser ?name\b|\buser ?id\b|\buser\b|\blogin\b|\bhandle\b|\bnick ?name\b/, 'username'],
      ['phone', /\bphone\b|\bmobile\b|\btel\b|\btelephone\b|\bcell\b/, 'tel'],
      ['dateOfBirth', /\bbirth|\bdob\b|\bbirthday\b/, 'bday'],
      // MUST precede addressLine1 (a "Company address" input would otherwise get the home street).
      ['companyAddress', /\b(compan(?:y|ies)|organi[sz]ation|employer|business|firm|office) ?(?:street ?)?(?:address|addr|street|location)\b/, ''],
      ['addressLine1', /\baddress ?(line)? ?1\b|\bstreet\b|\baddr ?1\b|\baddress\b/, 'address-line1'],
      ['addressLine2', /\baddress ?(line)? ?2\b|\bapt\b|\bapartment\b|\bsuite\b|\bunit\b|\baddr ?2\b/, 'address-line2'],
      ['city', /\bcity\b|\btown\b|\blocality\b/, 'address-level2'],
      ['country', /\bcountry\b|\bnation\b/, 'country'],
      ['state', /\bstate\b|\bprovince\b|\bregion\b|\bcounty\b/, 'address-level1'],
      ['zipCode', /\bzip\b|\bzip ?code\b|\bpostal\b|\bpost ?code\b|\bpostcode\b/, 'postal-code'],
      ['company', /^(?!.*\b(?:address|street|addr)\b)(?=.*\b(?:company|organi[sz]ation|employer|business ?name)\b)/, 'organization']
    ];
    // Fields that must never receive persona data, whatever else they match.
    var NEVER = /\b(captcha|coupon|promo|voucher|discount|gift ?card|card ?number|cc ?number|cvv|cvc|security ?code|otp|one ?time|verification ?code|search|query|referr?al ?code|invite ?code)\b/;
    // Per-key exclusions: a rule that matches but describes something else.
    var EXCLUDE = {
      email: /\b(confirm|verify|repeat|re ?enter|again)\b/,
      username: /\bemail\b/,
      addressLine1: /\b(e ?mail|ip|web|url|line ?2|apt|suite|unit|compan(?:y|ies)|address ?(?:line ?)?2)\b/,
      addressLine2: /\b(e ?mail)\b/,
      state: /\bcountry\b/,
      phone: /\b(country ?code|extension|ext)\b/,
      company: /\b(name ?on ?card|card ?holder)\b/
    };

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
      return /\bfull ?name\b|\byour ?name\b|\bname\b/.test(s) && !NEVER.test(s);
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
    // A matchable field we have not filled or tried yet, empty and not being typed in.
    function newEmptyFieldExists() {
      var fs = collectTargetFields();
      for (var i = 0; i < fs.length; i++) {
        var e = fs[i];
        if (filledEls.has(e) || attemptedEls.has(e) || e === document.activeElement) continue;
        if (e.value && String(e.value).length) continue;
        if (isMatchable(e)) return true;
      }
      return false;
    }
    function hasMatchableField() {
      try { return newEmptyFieldExists(); } catch (e) { return false; }
    }
    // Multi-step forms (wizards, email-then-password, 3-step signups): after a fill, watch for
    // the NEXT step's fields and fill the ones still empty. Kept deliberately narrow so it can
    // never spill into other forms on the page:
    //  - only DOM additions (childList) are watched, not class/style flips on every re-render;
    //  - each field is attempted at most once (no retry loop on a field that will not take);
    //  - it never types while the user is typing in another field (no focus stealing);
    //  - it never fills a password (that needs a click on the widget, see audit E1).
    // While an identity is ACTIVE it keeps watching across SPA route changes (a wizard's next
    // step often changes the URL) until the final submit or 15 minutes; without active
    // tracking it keeps the old narrow rule (stop on a route change, 90 s).
    function armMultiStep(p) {
      if (multiStepObserver || !p) return;
      var pending = false;
      var armedPath = location.pathname;
      function stop() { if (multiStepObserver) { try { multiStepObserver.disconnect(); } catch (e) {} multiStepObserver = null; } }
      function userIsTyping() {
        var a = document.activeElement;
        return !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable) && !filledEls.has(a));
      }
      var run = debounce(function () {
        var tracking = !!active && active.id === p.id;
        if (!tracking && (canTrackActive() || location.pathname !== armedPath)) { stop(); return; }
        if (pending || filling || userIsTyping() || !newEmptyFieldExists()) return;
        pending = true;
        fillWith(p, { onlyEmpty: true }).catch(function () {}).then(function () { pending = false; nudgePassword(); });
      }, 600);
      try {
        multiStepObserver = new MutationObserver(run);
        multiStepObserver.observe(document.documentElement, { childList: true, subtree: true });
      } catch (e) { multiStepObserver = null; }
      setTimeout(stop, canTrackActive() ? 15 * 60000 : 90000);
      run(); // the step already on screen (a page load mid-signup)
    }
    // A later step that asks for the password: say so, since it is never auto-filled.
    var nudged = false;
    function passwordPending() {
      if (!active || !active.hasPassword) return false;
      var pw = document.querySelector('input[type="password"]');
      return !!(pw && fillable(pw) && !pw.value);
    }
    function nudgePassword() {
      if (nudged || filling || !passwordPending()) return;
      nudged = true;
      toast('Click SG, then ' + displayName(active) + ', to fill the password.');
    }
    function displayName(p) {
      return [p.firstName, p.lastName].filter(Boolean).join(' ') || p.username || p.email || 'Identity';
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
      // 1) Collect the matched (field, value) pairs. Filling happens afterwards -
      //    either via CDP "trusted" typing (Chromium bridge) or in-page events.
      var matches = []; // { el, value, kind }
      for (var i = 0; i < PLAN.length; i++) {
        var key = PLAN[i][0], rx = PLAN[i][1], ac = PLAN[i][2];
        var val = p[key];
        if (!val) continue;
        var el = take((function (rx, ac, key) {
          return function (e) {
            var desc = attrStr(e);
            if (NEVER.test(desc)) return false;
            var acTokens = (e.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/);
            if (ac && acTokens.indexOf(ac) >= 0) return true;
            if (EXCLUDE[key] && EXCLUDE[key].test(desc)) return false;
            if (key === 'email' && (e.type || '').toLowerCase() === 'email') return true;
            if (key === 'phone' && (e.type || '').toLowerCase() === 'tel') return true;
            return rx.test(desc);
          };
        })(rx, ac, key));
        if (!el) continue;
        matches.push({ el: el, value: String(val), kind: el.tagName === 'SELECT' ? 'select' : 'text' });
      }
      // "Confirm email" / "Re-enter email" fields take the same address.
      if (p.email) {
        var conf;
        while ((conf = take(function (e) { var d = attrStr(e); return !NEVER.test(d) && /\be ?mail\b/.test(d) && EXCLUDE.email.test(d); }))) {
          matches.push({ el: conf, value: String(p.email), kind: 'text' });
        }
      }
      // Full-name fallback: a single name field when no first/last was matched.
      if (p.firstName || p.lastName) {
        var nameEl = take(function (e) {
          if (e.tagName === 'SELECT') return false;
          var ac = (e.getAttribute('autocomplete') || '').toLowerCase();
          if (ac === 'name') return true;
          var s = attrStr(e);
          return /\bfull ?name\b|\byour ?name\b|\bname\b/.test(s) && !/\b(user|first|last|given|family|sur|company|business|organi[sz]ation|card|cardholder|holder|domain|file|display|nick|screen)\b/.test(s) && !NEVER.test(s);
        });
        if (nameEl) matches.push({ el: nameEl, value: [p.firstName, p.lastName].filter(Boolean).join(' '), kind: 'text' });
      }
      // Passwords: fill EVERY password field (covers "confirm password"). The
      // plaintext is NEVER shipped to page JS in the list payload (audit C2) - the
      // list only tells us `hasPassword`. On Chromium the backend types the real
      // value server-side by persona id via the trusted CDP bridge; on Firefox the
      // ISOLATED content-script fetches it on demand via __sgPersonaGetSecret (see
      // the fallback below). Kind 'password' carries only the persona id.
      if (p.hasPassword) {
        var pws = all.filter(function (e) { return (e.type || '').toLowerCase() === 'password' && used.indexOf(e) < 0; });
        for (var k = 0; k < pws.length; k++) { used.push(pws[k]); matches.push({ el: pws[k], kind: 'password', personaId: p.id }); }
      }

      // Multi-step re-run: on a later wizard step only fill fields that are still
      // empty, not currently focused, and not already filled by us - and never
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

      matches.forEach(function (m) { try { attemptedEls.add(m.el); } catch (e) {} });
      // <input type=date> needs an ISO value set directly; typing a date string into it fails.
      matches = matches.filter(function (m) {
        if ((m.el.type || '').toLowerCase() !== 'date' || m.kind === 'password') return true;
        var iso = toIsoDate(m.value);
        if (iso) { setReactInputValue(m.el, iso); try { filledEls.add(m.el); } catch (e) {} }
        return false;
      });
      // Native <select>: send the OPTION VALUE that matches (by value, visible text, or a
      // country/region code), because the trusted path selects by exact value only.
      matches.forEach(function (m) { if (m.kind === 'select') { var ov = resolveOption(m.el, m.value); if (ov != null) m.value = ov; } });
      // 2) Fill. Prefer CDP trusted typing when the host exposes the bridge
      //    (Chromium) - real keydown/keyup with isTrusted:true. Otherwise fall back
      //    to in-page synthetic typing (e.g. Firefox, or if the bridge errors).
      var filled = 0;
      var fillFailed = 0; // fields the backend could not verify - reported, not hidden
      // Use sgHas, NOT a raw typeof on the binding. sgHas also returns true when only
      // the RPC bridge is present, and sgCall routes through whichever transport is
      // alive. A raw typeof check misses the bridge, so whenever the CDP binding is
      // absent this fell through to the in-page fallback below - which types with
      // synthetic KeyboardEvents that are ALWAYS isTrusted:false, i.e. a bot signal on
      // any site that checks. That is precisely the case when "Minimize CDP footprint"
      // (the anti-CAPTCHA engine) is on, since it never installs the binding at all:
      // enabling the anti-CAPTCHA setting would silently downgrade autofill to
      // detectable typing. With sgHas the plan goes over the bridge and the keystrokes
      // stay real, trusted CDP input.
      var trusted = sgHas('__sgPersonaFillPlan');
      if (trusted && matches.length) {
        var plan = matches.map(function (m, idx) {
          try { m.el.setAttribute(FILL_ATTR, String(idx)); } catch (e) {}
          var it = { sel: '[' + FILL_ATTR + '="' + idx + '"]', kind: m.kind };
          // Password items carry only the persona id; the backend resolves the
          // plaintext server-side. All other kinds carry their (non-secret) value.
          if (m.kind === 'password') it.personaId = m.personaId; else it.value = m.value;
          return it;
        });
        // audit E1: `gesture` is set ONLY when this fill started from an isTrusted
        // click on the widget's own row (multi-step re-runs pass onlyEmpty and never
        // carry a password). The backend also requires a transient user activation,
        // read from this isolated world, before it releases any password.
        var failedMap = null; // plan index -> true, for fields that did not take
        try {
          var r = await sgCall('__sgPersonaFillPlan', plan, { gesture: !opts.onlyEmpty && opts.gesture === true });
          filled = (r && typeof r.filled === 'number') ? r.filled : matches.length;
          fillFailed = (r && typeof r.failed === 'number') ? r.failed : 0;
          if (r && Object.prototype.toString.call(r.failedIdx) === '[object Array]') {
            failedMap = {};
            for (var fi = 0; fi < r.failedIdx.length; fi++) failedMap[r.failedIdx[fi]] = true;
          }
        } catch (e) { trusted = false; }
        // Only mark a field as done when the backend VERIFIED the value landed in it.
        // Adding every matched element unconditionally is what stopped the multi-step
        // observer from ever retrying a field that silently failed to fill.
        matches.forEach(function (m, idx) {
          try { m.el.removeAttribute(FILL_ATTR); } catch (e) {}
          if (failedMap && failedMap[idx]) return; // leave it retryable
          try { filledEls.add(m.el); } catch (e) {}
        });
      }
      if (!trusted) {
        // Fallback in-page typing (Firefox, or if the CDP bridge errored). On Firefox
        // the widget runs in the extension's ISOLATED content-script world - page JS
        // cannot read these expandos or the typed value beyond the DOM field itself -
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
        if (skippedSecret) { toast(filled ? 'Filled fields, but the password could not be autofilled here.' : 'Autofill unavailable - could not fill the password on this page.'); }
      }
      if (!opts.onlyEmpty) {
        // Report the real outcome. A partial fill used to be indistinguishable from a
        // complete one, so scrolling mid-fill looked like it had worked.
        if (filled && fillFailed) {
          toast('Filled ' + filled + ' field' + (filled === 1 ? '' : 's') + ', but ' + fillFailed + ' did not take - click Autofill again to finish.');
        } else if (filled) {
          toast(canTrackActive()
            ? ('Filled ' + filled + ' field' + (filled === 1 ? '' : 's') + '. ' + displayName(p) + ' stays active here until you submit the form.')
            : ('Filled ' + filled + ' field' + (filled === 1 ? '' : 's') + '.'));
        } else if (fillFailed) {
          toast('Could not fill this form - nothing was entered. Click the identity again to retry.');
        } else {
          toast('No matching fields found on this page.');
        }
        // The identity becomes ACTIVE for this site: it keeps filling each later step
        // (same page or a new one) and is marked used only on the FINAL submit (see
        // watchSubmits). Marking it used right here is what made multi-step signups
        // lose it after step 1. An older backend without active tracking keeps the old
        // rule: mark used after a clean fill.
        if (filled > 0) {
          if (canTrackActive()) {
            await setActive(p);
          } else if (fillFailed === 0) {
            var _marked = await markSelectedUsed(true);
            if (!_marked) footer.hidden = false;
          } else {
            footer.hidden = false;
          }
        } else {
          footer.hidden = false;
        }
      } else if (filled) {
        // A step that also asks for the password says so in the same message (a
        // separate hint would just be replaced by this one).
        toast('Filled ' + filled + ' more field' + (filled === 1 ? '' : 's') + ' on this step.' + (passwordPending() ? (' Click SG, then ' + displayName(p) + ', to fill the password.') : ''));
        if (passwordPending()) nudged = true;
      }
    }

    // --- mark used -----------------------------------------------------------
    async function markSelectedUsed(silent) {
      var target = active || selected;
      if (!target || !sgHas('__sgPersonaMarkUsed')) { if (!silent) toast('Autofill bridge unavailable.'); return false; }
      var id = target.id, hostName = location.hostname;
      try {
        // The backend clears the active identity when it marks it used.
        await sgCall('__sgPersonaMarkUsed', id, location.href);
        toast(silent ? ('Identity used on ' + hostName + ' - moved to Reuse.') : ('Marked as used on ' + hostName));
        personas = personas.filter(function (x) { return x.id !== id; });
        if (active && active.id === id) active = null;
        selected = null;
        footer.hidden = true;
        renderList();
        return true;
      } catch (e) { if (!silent) toast('Could not save - try again.'); return false; }
    }
    markBtn.addEventListener('click', async function (e) {
      if (!e.isTrusted) return; // audit C2: ignore page-scripted clicks
      if (!active && !selected) return;
      markBtn.disabled = true;
      await markSelectedUsed(false);
      markBtn.disabled = false;
    });
    // Release: stop using the active identity here WITHOUT marking it used (the user
    // abandoned the signup, or picked the wrong identity).
    relBtn.addEventListener('click', async function (e) {
      if (!e.isTrusted || !active) return;
      var name = displayName(active);
      await setActive(null);
      selected = null;
      renderList();
      toast(name + ' released - not marked as used.');
    });

    // --- final submit -> mark used -------------------------------------------
    // A wizard's intermediate buttons (Next / Continue) keep the identity active; the
    // final one (Sign up / Register / Submit / Create account / Finish ...) marks it
    // used. Only REAL user actions count (isTrusted), and only while an identity is
    // active. The mark is sent from inside the event, before the page unloads.
    var NEXT_RX = /\b(next|continue|proceed|go on|forward|step \d|save (and|&) continue)\b|[\u2192\u203a\u00bb>]\s*$/i;
    var FINAL_RX = /\b(sign ?up|register|create( (my|an|your))? account|submit|finish|complete|done|join|get started|start( (my|free|your))? (free )?trial|request|book|apply|subscribe|confirm|send|place order|pay|checkout)\b/i;
    function controlText(el) {
      if (!el) return '';
      var t = (el.tagName === 'INPUT') ? el.value : (el.textContent || el.getAttribute('aria-label') || el.title || '');
      return String(t || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    }
    // Is this submit the LAST step? A named control decides by its label; a form
    // submitted with Enter (no submitter) decides by the form's own submit buttons.
    function isFinalSubmit(submitter, form) {
      var t = controlText(submitter);
      if (t) return !NEXT_RX.test(t);
      if (!form || !form.querySelectorAll) return false;
      var btns = form.querySelectorAll('button:not([type="button"]):not([type="reset"]),input[type="submit"]');
      for (var i = 0; i < btns.length; i++) { if (NEXT_RX.test(controlText(btns[i]))) return false; }
      return true;
    }
    // A label alone cannot tell the last step: Buildium's STEP 1 button reads "Start
    // My Free Trial". A submit that carries a filled password is an account being
    // created, so it is final. Anything else is only "finishing": the identity stays
    // active (pending) and the page that follows decides - more fields to fill means
    // it was a step, nothing left means it was the end and the identity is used.
    function hasFilledPassword(scope) {
      var pws = (scope && scope.querySelectorAll ? scope : document).querySelectorAll('input[type="password"]');
      for (var i = 0; i < pws.length; i++) { if (pws[i].value) return true; }
      return false;
    }
    function stepContinues() {
      if (newEmptyFieldExists()) return true;
      var pws = document.querySelectorAll('input[type="password"]');
      for (var i = 0; i < pws.length; i++) { if (fillable(pws[i]) && !pws[i].value) return true; }
      return false;
    }
    // Watch the current page for up to `ms`: a further step continues the signup
    // (pending cleared), no step at all marks the identity used.
    function settlePending(ms, onContinue) {
      var t0 = Date.now();
      (function check() {
        if (!active || leaving) return;
        if (stepContinues()) { setActive(active); if (onContinue) onContinue(); return; }
        if (Date.now() - t0 >= ms) { markSelectedUsed(true); return; }
        setTimeout(check, 500);
      })();
    }
    var finalizing = false, leaving = false;
    window.addEventListener('beforeunload', function () { leaving = true; }, true);
    window.addEventListener('pagehide', function () { leaving = true; }, true);
    function finalSubmit(scope) {
      if (!active || finalizing) return;
      finalizing = true;
      var done = function () { finalizing = false; };
      if (!canTrackActive() || hasFilledPassword(scope)) { markSelectedUsed(true).then(done, done); return; }
      var id = active.id;
      sgCall('__sgPersonaActive', 'finish', id).then(function (r) {
        // A backend without 'finish' (older Firefox extension) keeps the old rule.
        if (!r || r.id !== id || !r.pending) return markSelectedUsed(true);
        // The page may stay (SPA wizard, or a validation error): decide here too.
        setTimeout(function () { settlePending(8000, function () { armMultiStep(active); }); }, 1500);
      }).then(done, done);
    }
    document.addEventListener('submit', function (e) {
      if (!e.isTrusted || !active) return;
      if (isFinalSubmit(e.submitter || null, e.target)) finalSubmit(e.target);
    }, true);
    // SPA signups often have no <form>: the last step is a plain button with a click
    // handler. Buttons only - a "Sign up" LINK in a header is navigation, not a submit.
    document.addEventListener('click', function (e) {
      if (!e.isTrusted || !active) return;
      var el = e.target && e.target.closest ? e.target.closest('button,input[type="submit"],input[type="button"],[role="button"]') : null;
      if (!el || host.contains(el)) return;
      // A real <form> submit button is handled by the submit event above.
      if (el.form && (el.type === 'submit' || (el.tagName === 'BUTTON' && !el.getAttribute('type')))) return;
      var t = controlText(el);
      if (t && !NEXT_RX.test(t) && FINAL_RX.test(t)) finalSubmit(null);
    }, true);

    // --- resume an active identity on a new page / step ------------------------
    // A full page load mid-signup is a fresh document: ask the backend whether this
    // site has an active identity and, if so, carry on filling the new step's fields.
    (function resume() {
      if (!canTrackActive()) return;
      sgCall('__sgPersonaActive', 'get').then(function (r) {
        if (!r || !r.id) return null;
        return sgCall('__sgPersonaList', location.href).then(function (res) {
          var list = Array.isArray(res) ? res : (res && Array.isArray(res.personas) ? res.personas : []);
          var p = null;
          for (var i = 0; i < list.length; i++) { if (list[i].id === r.id) { p = list[i]; break; } }
          if (!p) { setActive(null); return null; } // used or deleted meanwhile
          personas = list;
          active = p; selected = p;
          // The step fill reports the password itself; this covers a step that is
          // ONLY a password (nothing else to fill).
          var go = function () {
            updateVisibility();
            var carryOn = function () { armMultiStep(p); setTimeout(function () { if (!newEmptyFieldExists()) nudgePassword(); }, 1500); };
            // The last submit only looked final: this page decides (forms often render
            // late, so give it a few seconds before calling the signup finished).
            if (r.pending) settlePending(8000, carryOn); else carryOn();
          };
          if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(go, 700); });
          else setTimeout(go, 700);
          return null;
        });
      }).catch(function () {});
    })();
  } catch (e) { /* never break the host page */ }
})();
