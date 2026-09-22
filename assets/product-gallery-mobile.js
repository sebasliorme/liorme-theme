/* The product page on mobile (rules: theme.css, "the product page on mobile" block; switch: "Móvil: fotos a
   pantalla completa y panel inferior" in the product section).

   The photos are stacked in a box that stays put at the top of the screen, and the product summary is a
   panel that rises over them as the page scrolls (that part is plain CSS: a sticky box and a panel above
   it). This script adds what CSS can not:

   - Photos turn one by one with a vertical swipe, the same "page turn" as on desktop and on the home: the
     next photo slides up over the current one, which stays underneath; swiping back retreats the top photo
     to uncover the previous one. 580ms, ease-in-out cubic (gentle start, soft landing).
   - The panel moves the same way: past the last photo (or on the panel itself) a swipe up glides it up until it
     sticks under the header, over the photo box that stays put; from there a swipe down glides it back. Inside
     the raised panel the page scrolls normally. If native scrolling leaves the panel half way, it settles on
     the nearest stop. The mouse wheel does the same on a narrow window.
   - A column of dots (one per photo) at the bottom left of the box, following the photo on screen.
   - The height of the panel's visible strip is measured (title lines, price, button) and handed to the CSS.
   - A product with sizes asks for one before adding to the cart: the button says "Elegir talla" and takes
     the visitor to the sizes until one is chosen.

   Idempotent and event-driven, so it also survives the theme editor re-rendering the section. */
(function () {
  if (window.__productGalleryMobile) return;
  window.__productGalleryMobile = true;

  /* ---- tuning ---- */
  var DURATION = 580; // ms, same as the desktop page turn and the home
  var AXIS_LOCK_PX = 8; // movement before a touch is read as vertical or horizontal
  var TURN_PX = 24; // vertical movement that turns a photo
  var PEEK_PADDING = 24; // space under the buy button inside the visible strip

  var ROOT = '.product[data-gallery-snap-mobile="true"]';
  var BOX = ROOT + " .product__media-container.below-mobile";
  var ITEM = BOX + " .product__media-item";
  var root = document.documentElement;
  var mobile = window.matchMedia("(max-width: 959px)");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  var product = null;
  var box = null;
  var items = [];
  var dots = null;
  var index = 0; // the photo on top
  var shownDot = -1;
  var move = null; // the turn in progress: { raf, apply, done }
  var touch = null; // the touch being followed: { x, y, axis, handled }
  var peek = 0;
  var needsSize = false;

  function pageIsLocked() {
    return (
      document.body.classList.contains("scroll-lock") ||
      document.body.getAttribute("data-fluorescent-overlay-open") === "true" ||
      !!document.querySelector(".pswp--open") ||
      root.classList.contains("find-size-lock")
    );
  }

  /* ---------- arranging the photos ---------- */
  // Photos up to the current one are stacked in order (a higher one covers a lower one); the rest wait below.
  // The transform is always set explicitly: an empty one would fall back to the stylesheet's default for the
  // photos after the first (translateY(100%), "waiting below"), which hides the photo that has just arrived.
  var IN_PLACE = "translateY(0)";
  var WAITING = "translateY(100%)";

  function arrange() {
    items.forEach(function (item, i) {
      item.style.zIndex = i + 1;
      item.style.transform = i > index ? WAITING : IN_PLACE;
    });
  }

  function prepare() {
    var first = !!(product && box);
    product = document.querySelector(ROOT);
    box = product && product.querySelector(".product__media-container.below-mobile");
    items = Array.prototype.slice.call(document.querySelectorAll(ITEM));
    move = null;
    index = 0;

    if (dots && dots.parentNode) dots.parentNode.removeChild(dots);
    dots = null;
    shownDot = -1;

    if (!mobile.matches || !product || !box || !items.length) {
      items.forEach(function (item) {
        item.style.zIndex = "";
        item.style.transform = "";
      });
      return;
    }

    // Photos slide in from below, so each must already be loaded when it starts to move
    items.forEach(function (item) {
      Array.prototype.forEach.call(item.querySelectorAll('img[loading="lazy"]'), function (img) {
        img.loading = "eager";
      });
    });

    arrange();
    buildDots();
    measurePeek();
    initSizeGate();
    return first;
  }

  /* ---------- the dots ---------- */
  function showDot(i) {
    if (!dots || i === shownDot) return;
    shownDot = i;

    Array.prototype.forEach.call(dots.children, function (dot, k) {
      var on = k === i;
      dot.classList.toggle("is-active", on);
      if (on) dot.setAttribute("aria-current", "true");
      else dot.removeAttribute("aria-current");
    });
  }

  function buildDots() {
    if (items.length < 2) return;

    dots = document.createElement("nav");
    dots.className = "gallery-dots gallery-dots--mobile";
    dots.setAttribute("aria-label", "Fotos del producto");

    items.forEach(function (item, i) {
      var dot = document.createElement("button");
      dot.type = "button";
      dot.className = "gallery-dots__dot";
      dot.setAttribute("aria-label", "Ir a la foto " + (i + 1) + " de " + items.length);
      dot.addEventListener("click", function () {
        turnTo(i);
      });
      dots.appendChild(dot);
    });

    box.appendChild(dots);
    showDot(index);
  }

  /* ---------- the page turn ---------- */
  function easeInOutCubic(t) {
    // gentle start, quick middle, soft landing - a pure ease-out jolted into full speed the instant a swipe
    // registered, which read as abrupt rather than a page turning.
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function run(apply, done) {
    var start = performance.now();
    var current = { raf: 0, apply: apply, done: done };
    move = current;

    function frame(now) {
      if (move !== current) return;
      var t = Math.max(0, Math.min(1, (now - start) / DURATION));
      apply(easeInOutCubic(t));

      if (t < 1) {
        current.raf = window.requestAnimationFrame(frame);
        return;
      }

      done();
      move = null;
    }

    current.raf = window.requestAnimationFrame(frame);
  }

  function turnTo(target) {
    if (move || target === index || target < 0 || target >= items.length) return;

    var forward = target > index;
    showDot(target);

    if (reduceMotion.matches) {
      index = target;
      arrange();
      return;
    }

    var k;

    if (forward) {
      // Photos in between are already under the one coming in
      for (k = index + 1; k < target; k++) items[k].style.transform = IN_PLACE;
      var entering = items[target];
      entering.style.willChange = "transform";
      entering.style.transform = WAITING;

      run(
        function (eased) {
          entering.style.transform = eased < 1 ? "translateY(" + 100 * (1 - eased) + "%)" : IN_PLACE;
        },
        function () {
          entering.style.willChange = "";
          entering.style.transform = IN_PLACE;
          index = target;
        }
      );
    } else {
      // Photos in between are put away, so the one going out uncovers the target
      for (k = target + 1; k < index; k++) items[k].style.transform = WAITING;
      var outgoing = items[index];
      outgoing.style.willChange = "transform";

      run(
        function (eased) {
          outgoing.style.transform = "translateY(" + 100 * eased + "%)";
        },
        function () {
          outgoing.style.willChange = "";
          outgoing.style.transform = WAITING;
          index = target;
        }
      );
    }
  }

  /* ---------- the panel: raised and lowered with the same glide ---------- */
  var scrollMove = null; // the glide of the page in progress: { raf }
  var settleTimer = null;
  var lastWheelTime = 0;
  var lastWheelSize = 0;

  function headerHeight() {
    var header = document.querySelector("header.header");
    return header ? header.getBoundingClientRect().height : 0;
  }

  // The scroll offset at which the panel's top sits right under the header: the panel fully raised
  function panelStop() {
    var panel = product && product.querySelector(".product__primary-right");
    if (!panel) return 0;
    return Math.max(0, Math.round(panel.getBoundingClientRect().top + window.scrollY - headerHeight()));
  }

  function cancelGlide() {
    if (!scrollMove) return;
    window.cancelAnimationFrame(scrollMove.raf);
    scrollMove = null;
  }

  function glideScroll(to) {
    cancelGlide();
    var from = window.scrollY;
    if (Math.abs(to - from) < 2) return;

    if (reduceMotion.matches) {
      window.scrollTo(0, to);
      return;
    }

    var start = performance.now();
    var current = { raf: 0 };
    scrollMove = current;

    function frame(now) {
      if (scrollMove !== current) return;
      var t = Math.max(0, Math.min(1, (now - start) / DURATION));
      window.scrollTo(0, t < 1 ? from + (to - from) * easeInOutCubic(t) : to);

      if (t < 1) {
        current.raf = window.requestAnimationFrame(frame);
        return;
      }
      scrollMove = null;
    }

    current.raf = window.requestAnimationFrame(frame);
  }

  // "closed": the panel is down and the photos are in view. "open": the panel is fully raised, at the start of
  // its content. null: anywhere else (a glide in progress, or scrolled into the content): the browser scrolls.
  function zone() {
    if (!mobile.matches || !product || scrollMove) return null;
    var y = window.scrollY;
    if (y <= 2) return "closed";
    return Math.abs(y - panelStop()) <= 2 ? "open" : null;
  }

  // What a vertical gesture does from a zone (up = finger up / wheel down), or null to leave it to the browser
  function decide(z, onPhotos, up) {
    if (z === "closed") {
      if (onPhotos && items.length > 1) {
        var target = index + (up ? 1 : -1);
        if (target >= 0 && target < items.length) return { turn: target };
      }
      // No photo left to turn to, or the finger is on the panel: up raises the panel
      return up ? { raise: true } : null;
    }
    if (z === "open") return up ? null : { lower: true };
    return null;
  }

  function perform(action) {
    if (action.turn !== undefined) turnTo(action.turn);
    else if (action.raise) glideScroll(panelStop());
    else if (action.lower) glideScroll(0);
  }

  function underFinger(target) {
    return {
      onPhotos: !!(box && target && box.contains(target)),
      onPanel: !!(target && target.closest && target.closest(".product__primary-right")),
    };
  }

  /* ---------- touch ---------- */
  function onTouchStart(e) {
    touch = null;
    cancelGlide(); // a finger down takes over from a glide (the settling below finishes it if it stops half way)
    if (!mobile.matches || !product || !e.touches.length || pageIsLocked()) return;

    var z = zone();
    var where = underFinger(e.target);
    if (!z || !(where.onPhotos || where.onPanel)) return;

    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, axis: null, handled: false, claimed: false, zone: z, onPhotos: where.onPhotos };
  }

  function onTouchMove(e) {
    if (!touch || !e.touches.length) return;

    var dx = e.touches[0].clientX - touch.x;
    var dy = e.touches[0].clientY - touch.y;

    if (!touch.axis) {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      touch.axis = Math.abs(dy) > Math.abs(dx) ? "y" : "x";
    }
    if (touch.axis !== "y") return;

    var up = dy < 0;

    // A gesture that has been claimed keeps the whole gesture: if what it triggers ends before the finger lifts,
    // the rest of the swipe must not leak into scrolling the page.
    if (touch.claimed) {
      if (e.cancelable) e.preventDefault();

      if (!touch.handled && !move && !scrollMove && Math.abs(dy) >= TURN_PX) {
        var again = decide(touch.zone, touch.onPhotos, up);
        if (again) {
          touch.handled = true;
          perform(again);
        }
      }
      return;
    }

    var action = decide(touch.zone, touch.onPhotos, up);
    if (!action) return; // the browser scrolls as usual

    if (e.cancelable) e.preventDefault();
    touch.claimed = true;

    if (!move && !scrollMove && Math.abs(dy) >= TURN_PX) {
      touch.handled = true;
      perform(action);
    }
  }

  function onTouchEnd() {
    touch = null;
  }

  /* ---------- wheel (a narrow desktop window) ---------- */
  function onWheel(e) {
    if (e.ctrlKey || e.defaultPrevented || !mobile.matches || !product || pageIsLocked()) return;
    if (e.target && e.target.closest && e.target.closest('.pswp, [role="dialog"], [aria-modal="true"]')) return;

    var size = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;
    var amount = Math.abs(size);
    if (amount < 2) return;

    // A glide is running: the wheel must not fight it
    if (scrollMove) {
      if (e.cancelable) e.preventDefault();
      return;
    }

    var where = underFinger(e.target);
    var z = zone();
    if (!z || !(where.onPhotos || where.onPanel)) return;

    var action = decide(z, where.onPhotos, size > 0);
    if (!action) return;

    if (e.cancelable) e.preventDefault();

    var now = performance.now();
    var gap = now - lastWheelTime;
    var was = lastWheelSize;
    lastWheelTime = now;
    lastWheelSize = amount;

    // One step per gesture: the rest of it, and a trackpad's momentum, is swallowed
    var isNotch = amount >= 100 && amount % 1 === 0;
    var fresh = gap > 110 || amount > was * 1.5 + 4 || isNotch;
    if (!fresh || move) return;

    perform(action);
  }

  /* ---------- settling ---------- */
  // Native scrolling can leave the panel half way up; once it stops, it goes to the nearest stop
  function settle() {
    if (!mobile.matches || !product || move || scrollMove || touch) return;
    var y = window.scrollY;
    var stop = panelStop();
    if (y > 2 && y < stop - 2) glideScroll(y > stop / 2 ? stop : 0);
  }

  function onScroll() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 160);
  }

  /* ---------- the panel's visible strip ---------- */
  function measurePeek() {
    if (!mobile.matches || !product) return;
    var panel = product.querySelector(".product__primary-right");
    var button = product.querySelector(".product__meta > .product-form .product-form__cart-submit");
    if (!panel || !button) return;

    var top = panel.getBoundingClientRect().top;
    var bottom = button.getBoundingClientRect().bottom;
    var value = Math.round(bottom - top + PEEK_PADDING);

    if (value > 80 && Math.abs(value - peek) > 1) {
      peek = value;
      product.style.setProperty("--pdp-peek", value + "px");
    }
  }

  /* ---------- sizes ---------- */
  function sizeChips() {
    return product ? product.querySelectorAll(".product__option .product__chip") : [];
  }

  function initSizeGate() {
    needsSize = sizeChips().length > 0;
    product.classList.toggle("pdp-needs-size", needsSize);
  }

  function chooseSizeFirst(e) {
    if (!needsSize || !product || !mobile.matches) return;
    var button = e.target && e.target.closest && e.target.closest(".product-form__cart-submit");
    var form = e.target && e.target.closest && e.target.closest(".product-form");
    if (!(button || (form && e.type === "submit")) || !product.contains(e.target)) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    var chips = sizeChips();
    var group = chips.length ? chips[0].closest(".product__option") : null;
    if (group) window.scrollTo({ top: group.getBoundingClientRect().top + window.scrollY - 100, behavior: "smooth" });
  }

  function onChipClick(e) {
    if (!needsSize || !e.target || !e.target.closest || !e.target.closest(".product__option .product__chip")) return;
    needsSize = false;
    product.classList.remove("pdp-needs-size");
  }

  /* ---------- events ---------- */
  function refresh() {
    prepare();
  }

  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("touchend", onTouchEnd, { passive: true });
  window.addEventListener("touchcancel", onTouchEnd, { passive: true });
  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("click", chooseSizeFirst, true);
  document.addEventListener("submit", chooseSizeFirst, true);
  document.addEventListener("click", onChipClick);
  window.addEventListener("resize", measurePeek);
  window.addEventListener("load", function () {
    measurePeek();
  });
  document.addEventListener("shopify:section:load", refresh);
  if (mobile.addEventListener) mobile.addEventListener("change", refresh);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measurePeek);

  prepare();

  // The title can wrap onto more lines once fonts load or the width changes
  if (window.ResizeObserver && product) {
    var panel = product.querySelector(".product__primary-right");
    if (panel) new ResizeObserver(measurePeek).observe(panel);
  }
})();
