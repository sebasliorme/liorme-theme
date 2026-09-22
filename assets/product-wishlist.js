/* Heart next to the product title (snippets/product-block-header.liquid).
   Keeps the products the visitor hearted in localStorage ("liorme_wishlist", a list of product handles) and
   shows the filled heart for those. There is no wishlist page yet — the header heart is still visual only. */
(function () {
  if (window.__productWishlist) return;
  window.__productWishlist = true;

  var KEY = "liorme_wishlist";

  function read() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function write(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* private mode: keep it in memory only */ }
  }

  var memory = null; // fallback when storage is unavailable
  function getList() { return memory || read(); }
  function setList(list) { memory = list; write(list); }

  function paint() {
    var list = getList();
    document.querySelectorAll("[data-product-wishlist]").forEach(function (btn) {
      var on = list.indexOf(btn.dataset.handle) > -1;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.setAttribute("aria-label", on ? btn.dataset.labelRemove : btn.dataset.labelAdd);
    });
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-product-wishlist]");
    if (!btn) return;
    e.preventDefault();
    var list = getList().slice();
    var i = list.indexOf(btn.dataset.handle);
    if (i > -1) list.splice(i, 1); else list.push(btn.dataset.handle);
    setList(list);
    paint();
  });

  window.addEventListener("storage", function (e) { if (e.key === KEY) { memory = null; paint(); } });

  var queued = false;
  new MutationObserver(function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; paint(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  paint();
})();
