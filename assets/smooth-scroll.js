/*
  Smooth wheel scrolling, desktop only.

  The mouse wheel or the trackpad moves a target position; every animation frame the page catches up with it:

      currentScroll += (targetScroll - currentScroll) * 0.08

  The distance is the one the browser would scroll (nothing is added or removed), only the way there is eased.
  The page still scrolls freely from top to bottom: no snapping, no sections.

  It only runs when all of this is true, and switches off by itself when it stops being true:
    - the device has a mouse or trackpad (hover: hover and pointer: fine), so never on phones or touch tablets
    - the window is at least 960px wide
    - the visitor has not asked for reduced motion
  It is left alone, so the browser or the theme keeps scrolling as before:
    - wheel events another script has already handled (the home page's page turn, the product photos turning,
      the lightbox zoom): this listener is added last, when the page has loaded, and checks defaultPrevented
    - the home page itself, which has its own wheel behaviour
    - pinch zoom (ctrl), shift, alt and mostly-horizontal gestures
    - a wheel over something that scrolls by itself (a drawer, a list, a text area) that can still move that way
    - anything while a drawer, modal or the lightbox has locked the page
    - the theme editor
  If anything else moves the page in the middle of a glide (keyboard, scrollbar, "back to top", a link to an
  anchor, another script), this one gives way and starts again from where the page really is.
*/
(function () {
  "use strict";

  // Share of the remaining distance covered each 1/60 s. Higher = snappier, lower = floatier.
  var LERP = 0.08;
  var MIN_WIDTH = 960;
  // Below this many pixels from the target the glide ends on the target itself
  var STOP_DISTANCE = 0.4;
  // Pixels for one "line" of a wheel that reports lines (Firefox)
  var LINE_PX = 32;
  // Wheel over these never smooth-scrolls the page
  var IGNORE = ".pswp, [data-smooth-scroll-ignore], select, textarea, input[type='number'], input[type='range']";

  if (!window.matchMedia || !window.requestAnimationFrame) return;
  if (window.Shopify && window.Shopify.designMode) return;

  var root = document.documentElement;
  var fine = window.matchMedia("(hover: hover) and (pointer: fine)");
  var wide = window.matchMedia("(min-width: " + MIN_WIDTH + "px)");
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  var target = 0;
  var current = 0;
  var lastSet = 0;
  var last = 0;
  var raf = 0;

  // Collection pages scroll natively: with the glide one wheel notch took ~0.5s to cover 90% of its distance and
  // ~1.1s to settle, which read as heavy/laggy while browsing a product grid (explicit request, 2026-09-22).
  function active() {
    var body = document.body;
    return fine.matches && wide.matches && !reduce.matches &&
      !body.classList.contains("template-index") && !body.classList.contains("template-collection");
  }

  function locked() {
    var body = document.body;
    if (body.classList.contains("scroll-lock") || root.classList.contains("find-size-lock")) return true;
    if (document.querySelector(".pswp--open")) return true;
    return window.getComputedStyle(body).overflowY === "hidden" || window.getComputedStyle(root).overflowY === "hidden";
  }

  function maxScroll() {
    return Math.max(0, root.scrollHeight - root.clientHeight);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // An element under the pointer that scrolls by itself and can still move in this direction keeps the wheel
  function scrollsItself(el, dy) {
    for (var node = el; node && node !== document.body && node !== root; node = node.parentElement) {
      var style = window.getComputedStyle(node);
      var overflowY = style.overflowY;

      if ((overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") && node.scrollHeight > node.clientHeight + 1) {
        if (style.overscrollBehaviorY === "contain" || style.overscrollBehaviorY === "none") return true;
        if (dy > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1) return true;
        if (dy < 0 && node.scrollTop > 0) return true;
      }
    }
    return false;
  }

  function setScroll(y) {
    lastSet = y;
    window.scrollTo(0, y);
  }

  function cancel() {
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
  }

  function frame(now) {
    raf = 0;

    // The conditions changed in the middle of a glide (window narrowed, a drawer opened...): stop where it is
    if (!active() || locked()) return;

    // Something else moved the page (keyboard, scrollbar, a link, another script): give way
    var y = window.scrollY;
    if (Math.abs(y - lastSet) > 2) {
      current = target = y;
      return;
    }

    var dt = Math.min(64, now - last);
    last = now;
    // The same easing at 60, 120 or 144 Hz
    var k = 1 - Math.pow(1 - LERP, dt / 16.667);

    target = Math.min(target, maxScroll());
    var diff = target - current;

    if (Math.abs(diff) <= STOP_DISTANCE) {
      current = target;
      setScroll(current);
      return;
    }

    current += diff * k;
    setScroll(current);
    raf = window.requestAnimationFrame(frame);
  }

  function onWheel(e) {
    if (e.defaultPrevented || !active()) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

    var dy = e.deltaY;
    if (!dy || Math.abs(e.deltaX) > Math.abs(dy)) return;
    if (locked()) return;

    var el = e.target && e.target.nodeType === 1 ? e.target : document.body;
    if (el.closest && el.closest(IGNORE)) return;
    if (scrollsItself(el, dy)) return;

    var pixels = e.deltaMode === 1 ? dy * LINE_PX : e.deltaMode === 2 ? dy * window.innerHeight : dy;

    // Not gliding: start from wherever the page really is
    if (!raf) {
      current = target = window.scrollY;
      lastSet = current;
    }

    target = clamp(target + pixels, 0, maxScroll());
    e.preventDefault();

    if (!raf) {
      last = window.performance.now();
      raf = window.requestAnimationFrame(frame);
    }
  }

  function onConditionsChange() {
    if (!active()) cancel();
  }

  function start() {
    // Added last (after the page and every other script have loaded), so the checks above see what the others did
    window.addEventListener("wheel", onWheel, { passive: false });

    [fine, wide, reduce].forEach(function (query) {
      if (query.addEventListener) query.addEventListener("change", onConditionsChange);
      else if (query.addListener) query.addListener(onConditionsChange);
    });
  }

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start);
})();
