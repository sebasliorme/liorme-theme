/*
  Menu promo video: start loading it when the menu is actually shown.

  The promotional carousel inside the drawer menu can hold a video. The menu is closed on every page load, but the
  video was still being downloaded (about 12 MB, autoplaying, on every page and on phones too). The slide now holds
  the video's markup in a <template>, which the browser does not load. This script puts it into the page the first
  time its box becomes visible, that is, when the menu opens.
*/
(function () {
  "use strict";

  var SELECTOR = "[data-lazy-promo-video]";
  var TEMPLATE = "template[data-lazy-promo-video-template]";

  function load(host) {
    var template = host.querySelector(TEMPLATE);
    if (!template) return;
    host.appendChild(template.content.cloneNode(true));
    template.parentNode.removeChild(template);
  }

  function loadAll() {
    Array.prototype.forEach.call(document.querySelectorAll(SELECTOR), load);
  }

  // Very old browsers: no way to know when the menu opens, so keep the previous behaviour
  if (!("IntersectionObserver" in window)) {
    loadAll();
    return;
  }

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      load(entry.target);
    });
  });

  function watch(root) {
    var hosts = (root || document).querySelectorAll(SELECTOR);
    Array.prototype.forEach.call(hosts, function (host) {
      if (host.querySelector(TEMPLATE)) observer.observe(host);
    });
  }

  watch();

  // The carousel copies its slides when it starts (and again if the editor rebuilds the header): watch new ones too
  var carousel = document.querySelector("[data-drawer-promo-carousel]");
  if (carousel && "MutationObserver" in window) {
    new MutationObserver(function () {
      watch(carousel);
    }).observe(carousel, { childList: true, subtree: true });
  }
})();
