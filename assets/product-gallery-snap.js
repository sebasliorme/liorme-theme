/* The home page's "page turn" on the desktop product photos (rules: theme.css, "page turn on the product
   photos" block; toggle: "Snap scrolling en las fotos" in the product section). It follows the home's
   snap in layout/theme.liquid, applied to the photos instead of the sections:

   - Down: the next photo slides up over the current one, which is frozen underneath (the real scroll
     is animated and the outgoing photo gets a counter-transform that cancels its own movement).
   - Up: the mirror. The real scroll jumps to the destination at once and the top photo retreats
     downward, uncovering the previous photo that was sitting there all along.
   - Same timing as the home: 580ms, ease-in-out cubic (gentle start, soft landing - a pure ease-out started at
     full speed the instant a gesture registered, which read as an abrupt jolt rather than a page turning).
     One photo per gesture.

   Stops are the top of the page (which stands for the first photo, already on screen), every photo after
   it, and the first thing after the photos (recommended products / footer). Going between two photos is
   the page turn; going out of the photos and back is a plain glide.

   Two more pieces:
   - .gallery-snap-active on <html> turns the CSS snap on while the page is between its top and the last
     photo, and off below it, so the sections underneath scroll freely and nothing is trapped. That native
     snap only serves what is not driven here (dragging the scrollbar, touch).
   - The wheel / trackpad is read by intent rather than by distance: the first tick of a gesture already
     starts the turn, and the rest of that gesture (and a trackpad's momentum) is swallowed, so one
     gesture never moves two photos.

   A column of dots on the left of the photos shows which photo is on screen (one dot per photo; a click
   goes to that photo).

   Idempotent and event-driven, so it also survives the theme editor re-rendering the section. */
(function () {
  if (window.__productGallerySnap) return;
  window.__productGallerySnap = true;

  /* ---- tuning ---- */
  var DURATION = 580; // ms, same as the home's page turn
  var MIN_DELTA = 2; // ignore wheel noise below this many pixels
  var REPEAT_GAP = 110; // ms of silence after which a wheel event counts as a new gesture
  var SETTLE_DELAY = 180; // ms of scroll silence before settling a scroll that ended between two photos

  var ACTIVE = "gallery-snap-active";
  var MOVING = "gallery-snap-moving";
  var PHOTO = '.product[data-gallery-snap="true"] .product__media-container.above-mobile .product__media-item';
  var root = document.documentElement;
  var desktop = window.matchMedia("(min-width: 960px)");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  var queued = false;
  var needsSettle = false;
  var settleTimer = null;

  var move = null; // the page turn in progress: { raf, apply, done }
  var pendingKeyDir = null; // a navigation key pressed mid-turn acts as soon as the turn ends
  var zCounter = 0; // highest z-index handed out: the photo being entered always goes on top
  var lastWheelTime = 0;
  var lastWheelSize = 0;
  var dots = null; // the <nav> with one button per photo
  var shownDot = -1;

  function photos() {
    return Array.prototype.slice.call(document.querySelectorAll(PHOTO));
  }

  function lastPhoto() {
    var list = photos();
    return list.length ? list[list.length - 1] : null;
  }

  // Photos stack in document order, so going back always uncovers the one underneath. They slide in from
  // below, so every one must already be loaded when it starts to move.
  function prepare() {
    var list = photos();
    zCounter = list.length;

    list.forEach(function (photo, i) {
      photo.style.zIndex = i + 1;
      Array.prototype.forEach.call(photo.querySelectorAll('img[loading="lazy"]'), function (img) {
        img.loading = "eager";
      });
    });

    buildDots();
  }

  /* ---------- the dots ---------- */
  // The photo on screen: the last one whose top has reached the middle of the window. Only read while nothing
  // is moving, so no transform is in the way.
  function currentPhoto() {
    var y = window.scrollY;
    var middle = y + window.innerHeight / 2;
    var index = 0;

    photos().forEach(function (photo, i) {
      var top = i === 0 ? 0 : photo.getBoundingClientRect().top + y;
      if (top <= middle) index = i;
    });
    return index;
  }

  function showDot(index) {
    if (!dots || index === shownDot) return;
    shownDot = index;

    Array.prototype.forEach.call(dots.children, function (dot, i) {
      var on = i === index;
      dot.classList.toggle("is-active", on);
      if (on) dot.setAttribute("aria-current", "true");
      else dot.removeAttribute("aria-current");
    });
  }

  function goToPhoto(index) {
    if (move) return;
    var list = stopList();
    if (!list[index] || !list[index].el) return; // the photos come first in the list, one stop each
    if (Math.abs(list[index].top - window.scrollY) <= 2) return;
    goTo(list, index);
  }

  // One dot per photo, so the count always matches the gallery (a variant can change which photos show).
  function buildDots() {
    if (dots && dots.parentNode) dots.parentNode.removeChild(dots);
    dots = null;
    shownDot = -1;

    var list = photos();
    var host = document.querySelector('.product[data-gallery-snap="true"] .product__primary-left');
    if (list.length < 2 || !host) return;

    dots = document.createElement("nav");
    dots.className = "gallery-dots";
    dots.setAttribute("aria-label", "Fotos del producto");

    list.forEach(function (photo, i) {
      var dot = document.createElement("button");
      dot.type = "button";
      dot.className = "gallery-dots__dot";
      dot.setAttribute("aria-label", "Ir a la foto " + (i + 1) + " de " + list.length);
      dot.addEventListener("click", function () {
        goToPhoto(i);
      });
      dots.appendChild(dot);
    });

    host.appendChild(dots);
    showDot(currentPhoto());
  }

  /* ---------- 1. switch the CSS snap on / off ---------- */
  function update() {
    queued = false;
    var last = lastPhoto();
    var wasActive = root.classList.contains(ACTIVE);

    if (!last || !desktop.matches) {
      root.classList.remove(ACTIVE);
      return;
    }

    // Snapped on the last photo its top sits at (or a fraction of a pixel above) the top of the window;
    // a couple of pixels of tolerance keeps the class on while it rests there.
    var active = last.getBoundingClientRect().top >= -2;
    root.classList.toggle(ACTIVE, active);

    // The browser does not re-snap a scroll that was already under way when the snapping switched on
    // (e.g. PageUp from below the photos), so it can stop between two photos. Remember to settle it.
    if (active && !wasActive && window.scrollY > 2) needsSettle = true;

    // While a turn runs the dot already points at its destination (set when it starts).
    if (!move) showDot(currentPhoto());
  }

  function queue() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(update);
  }

  /* ---------- stops ---------- */
  function exitTop() {
    var next = document.querySelector(".main-product-section ~ .shopify-section") || document.querySelector(".footer__parent");
    var max = root.scrollHeight - window.innerHeight;
    if (!next) return max;
    return Math.min(next.getBoundingClientRect().top + window.scrollY, max);
  }

  // The first photo has no stop of its own: it is already on screen at the top of the page (just under the
  // header), so the top of the page stands for it. That way the first scroll goes straight to the second
  // photo, in step with the header hiding, instead of spending the first tick on a short hop to photo one.
  // Only measured while nothing is moving, so no transform is in the way.
  function stopList() {
    var y = window.scrollY;
    var list = photos().map(function (photo, i) {
      return { top: i === 0 ? 0 : photo.getBoundingClientRect().top + y, el: photo };
    });
    if (!list.length) return list;

    list.push({ top: exitTop(), el: null });
    return list.sort(function (a, b) { return a.top - b.top; });
  }

  function indexAt(list, y) {
    var index = 0;
    for (var i = 0; i < list.length; i++) if (list[i].top <= y + 2) index = i;
    return index;
  }

  // The stop a gesture in that direction leads to, or null when there is nothing further. Forward only ever
  // leads to another PHOTO (the exit stop past the last one, el: null, is not a turn's destination - see
  // eligible() below): otherwise the last photo would take one more full, animated turn to land exactly on
  // whatever comes after the gallery (recommended products, the footer), instead of just letting go there.
  function nextIndex(list, dir) {
    var y = window.scrollY;
    var i;

    if (dir > 0) {
      for (i = 0; i < list.length; i++) if (list[i].top > y + 2 && list[i].el) return i;
    } else {
      for (i = list.length - 1; i >= 0; i--) if (list[i].top < y - 2) return i;
    }
    return null;
  }

  /* ---------- 2. the page turn ---------- */
  function easeInOutCubic(t) {
    // gentle start, quick middle, soft landing - unlike a pure ease-out (fast right from the first frame),
    // this ramps up instead of jolting into motion the instant a gesture registers.
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function endMove() {
    move = null;
    root.classList.remove(MOVING);
    queue();

    if (pendingKeyDir !== null) {
      var dir = pendingKeyDir;
      pendingKeyDir = null;
      step(dir);
    }
  }

  // apply(eased 0..1) draws one frame; done() clears whatever the turn put on the photos.
  function run(duration, apply, done) {
    var start = performance.now();
    var current = { raf: 0, apply: apply, done: done };
    move = current;
    root.classList.add(MOVING);

    function frame(now) {
      if (move !== current) return;
      var t = Math.max(0, Math.min(1, (now - start) / duration));
      apply(easeInOutCubic(t));

      if (t < 1) {
        current.raf = window.requestAnimationFrame(frame);
        return;
      }

      done();
      endMove();
    }

    current.raf = window.requestAnimationFrame(frame);
  }

  // Another way of scrolling (a click, a touch) takes over: land the turn on its destination at once.
  function finishNow() {
    if (!move) return;
    var current = move;
    window.cancelAnimationFrame(current.raf);
    current.apply(1);
    current.done();
    pendingKeyDir = null;
    endMove();
  }

  // Down: the real scroll animates; the outgoing photo is pushed down by exactly as much, so it stays
  // where it is on screen while the entering photo (on top) slides up over it.
  function coverForward(outgoing, entering, to) {
    var from = window.scrollY;
    zCounter += 1;
    entering.style.zIndex = zCounter;
    outgoing.style.willChange = "transform";

    run(
      DURATION,
      function (eased) {
        var y = from + (to - from) * eased;
        window.scrollTo(0, y);
        outgoing.style.transform = eased < 1 ? "translateY(" + (y - from) + "px)" : "";
      },
      function () {
        outgoing.style.transform = "";
        outgoing.style.willChange = "";
      }
    );
  }

  // Up: the real scroll jumps to the destination at once, which leaves the photo we came from
  // (still on top) below the window; a compensating transform keeps it covering the screen, then eases
  // away so it retreats the way it arrived.
  function coverReverse(outgoing, to) {
    var restingOffset = outgoing.getBoundingClientRect().top + window.scrollY - to;
    outgoing.style.willChange = "transform";
    root.classList.add(MOVING);
    window.scrollTo(0, to);
    outgoing.style.transform = "translateY(" + -restingOffset + "px)";

    run(
      DURATION,
      function (eased) {
        outgoing.style.transform = eased < 1 ? "translateY(" + -restingOffset * (1 - eased) + "px)" : "";
      },
      function () {
        outgoing.style.transform = "";
        outgoing.style.willChange = "";
      }
    );
  }

  // Out of the photos and back: nothing to cover, a plain glide with the same timing.
  function glide(to) {
    var from = window.scrollY;

    run(
      DURATION,
      function (eased) {
        window.scrollTo(0, eased < 1 ? from + (to - from) * eased : to);
      },
      function () {}
    );
  }

  function goTo(list, index) {
    var y = window.scrollY;
    var fromIndex = indexAt(list, y);
    var from = list[fromIndex];
    var to = list[index];

    // The dot follows the gesture at once instead of waiting for the photo to land.
    if (to.el) showDot(photos().indexOf(to.el));

    // Reduced motion: still one photo per gesture, but landing at once, like the home.
    if (reduceMotion.matches) {
      window.scrollTo(0, to.top);
      return;
    }

    var turning = Math.abs(y - from.top) <= 2 && Math.abs(index - fromIndex) === 1 && from.el && to.el;

    if (turning && index > fromIndex) coverForward(from.el, to.el, to.top);
    else if (turning) coverReverse(from.el, to.top);
    else glide(to.top);
  }

  // Starts a turn in that direction. False when there is nowhere to go (the browser then scrolls as usual).
  function step(dir) {
    var list = stopList();
    var index = list.length ? nextIndex(list, dir) : null;
    if (index === null) return false;

    goTo(list, index);
    return true;
  }

  /* ---------- input ---------- */
  function pageIsLocked() {
    // Drawers, menus, the size finder and the lightbox lock the page scroll; leave the input to them.
    return (
      document.body.classList.contains("scroll-lock") ||
      root.classList.contains("find-size-lock") ||
      document.body.getAttribute("data-fluorescent-overlay-open") === "true" ||
      !!document.querySelector(".pswp--open") ||
      window.getComputedStyle(document.body).overflow === "hidden" ||
      window.getComputedStyle(root).overflow === "hidden"
    );
  }

  function insideOwnScroller(target) {
    if (!target || !target.closest) return false;
    if (target.closest('.pswp, [role="dialog"], [aria-modal="true"]')) return true;

    for (var el = target; el && el !== root && el !== document.body; el = el.parentElement) {
      var overflowY = window.getComputedStyle(el).overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1) return true;
    }
    return false;
  }

  function wheelSize(e) {
    if (e.deltaMode === 1) return e.deltaY * 40; // lines
    if (e.deltaMode === 2) return e.deltaY * window.innerHeight; // pages
    return e.deltaY;
  }

  // The page is between its top and the last photo, or it rests on the stop right after the last photo and
  // is going back up to it.
  function eligible(dir) {
    if (!lastPhoto()) return false;

    // Forward: only while there is a further PHOTO to turn to. On the last one, scrolling down is no longer
    // ours - it lets go into whatever is next (recommended products, the footer) as plain, unassisted scroll,
    // instead of one more animated turn that would land exactly on its top edge.
    if (dir > 0) return nextIndex(stopList(), 1) !== null;

    if (root.classList.contains(ACTIVE)) return true;
    return Math.abs(window.scrollY - exitTop()) <= 3;
  }

  function onWheel(e) {
    // Ctrl + wheel is the browser's zoom, not a scroll.
    if (e.ctrlKey || e.defaultPrevented || !desktop.matches) return;
    if (pageIsLocked() || insideOwnScroller(e.target)) return;

    var size = wheelSize(e);
    var amount = Math.abs(size);
    if (amount < MIN_DELTA) return;

    var dir = size > 0 ? 1 : -1;

    if (!move && !eligible(dir)) {
      // Scrolling down off the last photo with nowhere further to turn to: let go of the native mandatory
      // snap right now, in this same event, so it does not fight the wheel's own (un-prevented) scroll and
      // pull the page straight back to the last photo the instant this small scroll ends.
      if (dir > 0) root.classList.remove(ACTIVE);
      return;
    }

    e.preventDefault();

    var now = performance.now();
    var gap = now - lastWheelTime;
    var wasSize = lastWheelSize;
    lastWheelTime = now;
    lastWheelSize = amount;

    // One turn at a time: the rest of the gesture, and a trackpad's momentum, is swallowed.
    if (move) return;

    // A new gesture is a pause in the events, a clearly stronger push, or a mouse-wheel notch.
    var isNotch = amount >= 100 && amount % 1 === 0;
    var fresh = gap > REPEAT_GAP || amount > wasSize * 1.5 + 4 || isNotch;
    if (!fresh) return;

    step(dir);
  }

  function onKeyDown(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !desktop.matches) return;

    var dir = null;
    if (e.key === "ArrowDown" || e.key === "PageDown") dir = 1;
    else if (e.key === "ArrowUp" || e.key === "PageUp") dir = -1;
    else if (e.key === " ") dir = e.shiftKey ? -1 : 1;
    if (dir === null || pageIsLocked()) return;

    var target = e.target;
    if (target && target.closest) {
      // Fields and widgets that use these keys themselves.
      if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="slider"], [role="listbox"], [role="combobox"], [role="menu"], [role="tablist"], [role="radiogroup"]')) return;
      // Space presses a focused button or link: leave it that.
      if (e.key === " " && target.closest('button, a[href], summary, [role="button"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"]')) return;
    }

    if (!move && !eligible(dir)) return;

    if (move) {
      e.preventDefault();
      pendingKeyDir = dir;
      return;
    }

    if (step(dir)) e.preventDefault();
  }

  /* ---------- settle a scroll that ended between two photos ---------- */
  function settle() {
    if (!needsSettle || move || !root.classList.contains(ACTIVE)) return;
    needsSettle = false;
    if (pageIsLocked()) return; // a drawer or the lightbox is open: do not move the page behind it

    var y = window.scrollY;
    var best = null;

    stopList().forEach(function (stop) {
      if (!stop.el) return; // the stop after the photos is not one to settle on
      if (best === null || Math.abs(stop.top - y) < Math.abs(best - y)) best = stop.top;
    });

    if (best !== null && Math.abs(best - y) > 2) window.scrollTo({ top: best, behavior: "smooth" });
  }

  function onScroll() {
    queue();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, SETTLE_DELAY);
  }

  function onSectionChange() {
    prepare();
    queue();
  }

  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", queue);
  window.addEventListener("load", onSectionChange);
  // A click or a touch takes over from a turn in progress.
  window.addEventListener("touchstart", finishNow, { passive: true });
  window.addEventListener("mousedown", finishNow);
  document.addEventListener("shopify:section:load", onSectionChange);
  document.addEventListener("shopify:section:unload", queue);
  if (desktop.addEventListener) desktop.addEventListener("change", queue);

  prepare();
  queue();
})();
