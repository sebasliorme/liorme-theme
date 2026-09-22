/* Progress bar for the product slider ("Recommended"): a thin track with a black thumb whose
   width is the share of slides in view and whose position follows the slider. The slider HTML is
   injected after load and Swiper starts asynchronously, so this watches for it. */
(function () {
  if (window.__recommendedSliderProgress) return;
  window.__recommendedSliderProgress = true;

  function update(slider, bar, thumb) {
    var swiper = slider.swiper;
    if (!swiper || !swiper.slides || !swiper.slides.length) return;
    var perView = Math.max(1, swiper.params.slidesPerView === "auto" ? 1 : swiper.params.slidesPerView);
    var fraction = Math.min(1, perView / swiper.slides.length);
    var progress = Math.min(1, Math.max(0, swiper.progress || 0));
    thumb.style.width = fraction * 100 + "%";
    thumb.style.transform = "translateX(" + progress * (1 / fraction - 1) * 100 + "%)";
    bar.hidden = fraction >= 1;
  }

  function bind(slider) {
    var bar = slider.querySelector(".recommended-products__progress");
    var thumb = bar && bar.querySelector(".recommended-products__progress-thumb");
    if (!bar || !thumb || slider.__progressBound) return;
    var tries = 0;
    (function wait() {
      var swiper = slider.swiper;
      if (!swiper) { if (tries++ < 200) requestAnimationFrame(wait); return; }
      slider.__progressBound = true;
      var go = function () { update(slider, bar, thumb); };
      swiper.on("progress", go);
      swiper.on("slideChange", go);
      swiper.on("resize", go);
      swiper.on("breakpoint", go);
      swiper.on("update", go);
      go();
    })();
  }

  function scan() {
    var sliders = document.querySelectorAll(".recommended-products__content");
    for (var i = 0; i < sliders.length; i++) bind(sliders[i]);
  }

  var queued = false;
  new MutationObserver(function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; scan(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
