/* "Find your size" block (snippets/product-block-find-size.liquid).
   - Puts a copy of the trigger button right under the size option of the variant picker (the picker leaves a
     [data-find-size-slot] there).
   - Opens a side drawer over a dimmed page, like the site menu: overlay + panel are moved to <body> so no
     transformed ancestor can break position:fixed.
   - Tab 1 is a ring size finder (finger circumference or ring diameter -> size), tab 2 a size chart. The scale
     is "size = circumference in mm - offset" (offset is a block setting, 40 by default).
   Everything is event-delegated, so it also survives the theme editor re-rendering the section. */
(function () {
  if (window.__findYourSize) return;
  window.__findYourSize = true;

  var CLOSE_MS = 700;
  var lastTrigger = null;
  var state = new WeakMap();

  function st(drawer) {
    if (!state.has(drawer)) state.set(drawer, { mode: "circumference", unit: "mm", tab: "find", step: 1, result: null, chartBuilt: false, closeTimer: null });
    return state.get(drawer);
  }
  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function sizesOf(drawer) {
    return (drawer.dataset.sizes || "").split("|").map(function (v) { return { value: v, num: parseFloat(v) }; }).filter(function (s) { return s.num > 0; });
  }

  /* ---------- place the trigger under the size option ---------- */
  // The variant picker can re-render its own markup (dynamic product options), which would destroy a button
  // moved into it — so the original stays where the block rendered it (hidden) and a clone goes in the slot;
  // the clone is recreated whenever the slot is re-rendered.
  function place() {
    qa("[data-find-size]").forEach(function (el) {
      var slot = q('[data-find-size-slot="' + el.dataset.sizeOption + '"]');
      if (!slot) { el.hidden = false; return; }
      el.hidden = true;
      if (!slot.querySelector("[data-find-size-clone]")) {
        var c = el.cloneNode(true);
        c.removeAttribute("data-find-size");
        c.removeAttribute("hidden");
        c.setAttribute("data-find-size-clone", "");
        slot.appendChild(c);
      }
    });
  }

  /* ---------- open / close ---------- */
  function drawerOf(trigger) {
    var id = trigger.getAttribute("aria-controls");
    var byId = id && document.getElementById(id);
    if (byId) return byId;
    var wrap = trigger.closest("[data-find-size]");
    var next = wrap && wrap.nextElementSibling;
    return next && next.matches("[data-find-size-drawer]") ? next : null;
  }

  function openDrawer(drawer, trigger) {
    var s = st(drawer);
    clearTimeout(s.closeTimer);
    // one copy per block in <body> (the editor may re-render the block)
    qa('[data-find-size-drawer="' + drawer.dataset.findSizeDrawer + '"]', document.body).forEach(function (d) {
      if (d !== drawer && d.parentElement === document.body) d.remove();
    });
    if (drawer.parentElement !== document.body) document.body.appendChild(drawer);
    if (!s.chartBuilt) buildChart(drawer);
    var ctaBtn = q("[data-fs-cta]", drawer);
    if (ctaBtn && !ctaBtn.dataset.continueLabel) ctaBtn.dataset.continueLabel = ctaBtn.textContent.trim();
    lastTrigger = trigger || lastTrigger;

    var sbw = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.style.setProperty("--find-size-sbw", sbw + "px");
    document.documentElement.classList.add("find-size-lock");

    drawer.hidden = false;
    drawer.setAttribute("aria-hidden", "false");
    void drawer.offsetWidth; // let the browser register the start state
    drawer.classList.add("is-open");
    var closeBtn = q(".find-size-drawer__close", drawer);
    setTimeout(function () { if (closeBtn) closeBtn.focus(); }, 60);
  }

  function closeDrawer(drawer) {
    var s = st(drawer);
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    clearTimeout(s.closeTimer);
    s.closeTimer = setTimeout(function () {
      drawer.hidden = true;
      document.documentElement.classList.remove("find-size-lock");
      document.documentElement.style.removeProperty("--find-size-sbw");
      if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
    }, CLOSE_MS);
  }

  function openDrawerEl() { return q("[data-find-size-drawer].is-open"); }

  /* ---------- tabs ---------- */
  function setTab(drawer, tab) {
    var s = st(drawer);
    s.tab = tab;
    qa("[data-fs-tab]", drawer).forEach(function (b) {
      var on = b.dataset.fsTab === tab;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    qa("[data-fs-pane]", drawer).forEach(function (p) { p.hidden = p.dataset.fsPane !== tab; });
    q(".find-size-drawer__footer", drawer).hidden = tab === "chart";
  }

  /* ---------- size chart ---------- */
  function buildChart(drawer) {
    var s = st(drawer);
    var offset = parseFloat(drawer.dataset.offset) || 40;
    var available = sizesOf(drawer).map(function (x) { return x.num; });
    var body = q("[data-fs-chart]", drawer);
    if (!body) return;
    var html = "";
    for (var size = 6; size <= 26; size++) {
      var circ = offset + size;
      var dia = circ / Math.PI;
      html += '<tr class="' + (available.indexOf(size) > -1 ? "is-available" : "") + '"><td>' + size + "</td><td>" + circ.toFixed(1) + "</td><td>" + dia.toFixed(1) + "</td><td>" + (circ / 25.4).toFixed(2) + "</td></tr>";
    }
    body.innerHTML = html;
    s.chartBuilt = true;
  }

  /* ---------- finder ---------- */
  function readCircumference(drawer) {
    var s = st(drawer);
    var raw = (q("[data-fs-value]", drawer).value || "").replace(",", ".");
    var v = parseFloat(raw);
    if (!(v > 0)) return null;
    var mm = s.unit === "in" ? v * 25.4 : v;
    return s.mode === "diameter" ? Math.PI * mm : mm;
  }

  function updateCta(drawer) {
    var s = st(drawer);
    var cta = q("[data-fs-cta]", drawer);
    if (s.step === 1) {
      cta.disabled = !(readCircumference(drawer) > 0);
      if (cta.dataset.continueLabel) cta.textContent = cta.dataset.continueLabel;
    }
  }

  function showError(drawer, msg) {
    var e = q("[data-fs-error]", drawer);
    e.textContent = msg || "";
    e.hidden = !msg;
  }

  function goStep(drawer, step) {
    var s = st(drawer);
    s.step = step;
    qa("[data-fs-step]", drawer).forEach(function (el) { el.hidden = el.dataset.fsStep !== String(step); });
    var body = q(".find-size-drawer__body", drawer);
    if (body) body.scrollTop = 0;
  }

  function continueFromStep1(drawer) {
    var s = st(drawer);
    var circ = readCircumference(drawer);
    if (!(circ > 0)) return;
    if (circ < 40 || circ > 90) {
      showError(drawer, "Please check your measurement — a finger circumference is usually between 44 and 74 mm.");
      return;
    }
    showError(drawer, "");
    var offset = parseFloat(drawer.dataset.offset) || 40;
    var ideal = Math.floor(circ - offset + 0.5);
    var list = sizesOf(drawer);
    var best = null;
    list.forEach(function (x) {
      var d = Math.abs(x.num - ideal);
      if (!best || d < best.d || (d === best.d && x.num > best.num)) best = { d: d, num: x.num, value: x.value };
    });
    s.result = { ideal: ideal, circ: circ, pick: best };

    var sizeEl = q("[data-fs-result-size]", drawer);
    var textEl = q("[data-fs-result-text]", drawer);
    var cta = q("[data-fs-cta]", drawer);
    var label = drawer.dataset.selectLabel || "Select size";
    if (best) {
      sizeEl.textContent = best.value;
      textEl.textContent = best.d === 0
        ? "A finger circumference of " + circ.toFixed(1) + " mm matches size " + best.value + ", which is available for this product."
        : "A finger circumference of " + circ.toFixed(1) + " mm matches size " + ideal + ". The closest size available for this product is " + best.value + ".";
      cta.textContent = label + " " + best.value;
    } else {
      sizeEl.textContent = String(ideal);
      textEl.textContent = "A finger circumference of " + circ.toFixed(1) + " mm matches size " + ideal + ".";
      cta.textContent = "Close";
    }
    cta.disabled = false;
    goStep(drawer, 2);
  }

  function selectSize(drawer, value) {
    var idx = drawer.dataset.optionIndex;
    var wrap = q('[data-product-option="' + idx + '"]');
    var done = false;
    if (wrap) {
      var btn = qa("[data-option-value]", wrap).filter(function (b) { return b.dataset.optionValue === value; })[0];
      if (btn) { btn.click(); done = true; }
    }
    if (!done) {
      var sel = document.getElementById(idx);
      if (sel) { sel.value = value; sel.dispatchEvent(new Event("change", { bubbles: true })); }
    }
  }

  /* ---------- events ---------- */
  document.addEventListener("click", function (e) {
    var trigger = e.target.closest("[data-find-size-open]");
    if (trigger) {
      var d = drawerOf(trigger);
      if (d) { e.preventDefault(); openDrawer(d, trigger); }
      return;
    }
    var drawer = e.target.closest("[data-find-size-drawer]");
    if (!drawer) return;

    if (e.target.closest("[data-find-size-close]")) { closeDrawer(drawer); return; }

    var tab = e.target.closest("[data-fs-tab]");
    if (tab) { setTab(drawer, tab.dataset.fsTab); return; }

    var unit = e.target.closest("[data-fs-unit]");
    if (unit) {
      st(drawer).unit = unit.dataset.fsUnit;
      qa("[data-fs-unit]", drawer).forEach(function (b) { b.classList.toggle("is-active", b === unit); });
      showError(drawer, "");
      updateCta(drawer);
      return;
    }

    if (e.target.closest("[data-fs-back]")) {
      goStep(drawer, 1);
      updateCta(drawer);
      return;
    }

    var cta = e.target.closest("[data-fs-cta]");
    if (cta && !cta.disabled) {
      var s = st(drawer);
      if (s.step === 1) continueFromStep1(drawer);
      else {
        if (s.result && s.result.pick) selectSize(drawer, s.result.pick.value);
        closeDrawer(drawer);
      }
    }
  });

  document.addEventListener("change", function (e) {
    var mode = e.target.closest && e.target.closest("[data-fs-mode]");
    if (!mode) return;
    var drawer = mode.closest("[data-find-size-drawer]");
    st(drawer).mode = mode.value;
    var input = q("[data-fs-value]", drawer);
    var label = mode.value === "diameter" ? (q('[data-fs-mode][value="diameter"]', drawer).parentElement.textContent.trim()) : (drawer.dataset.unitLabelCircumference || "Finger circumference");
    input.placeholder = label;
    input.setAttribute("aria-label", label);
    showError(drawer, "");
    updateCta(drawer);
  });

  document.addEventListener("input", function (e) {
    if (!e.target.matches || !e.target.matches("[data-fs-value]")) return;
    var drawer = e.target.closest("[data-find-size-drawer]");
    showError(drawer, "");
    updateCta(drawer);
  });

  document.addEventListener("keydown", function (e) {
    var drawer = openDrawerEl();
    if (!drawer) return;
    if (e.key === "Escape") { closeDrawer(drawer); return; }
    if (e.key === "Enter" && e.target.matches && e.target.matches("[data-fs-value]")) {
      e.preventDefault();
      var s = st(drawer);
      if (s.step === 1) continueFromStep1(drawer);
      return;
    }
    if (e.key === "Tab") {
      var f = qa('button:not([disabled]), input, [href], [tabindex]:not([tabindex="-1"])', drawer).filter(function (el) { return el.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ---------- placement, also after the theme editor re-renders the section ---------- */
  var queued = false;
  new MutationObserver(function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; place(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  place();
})();
