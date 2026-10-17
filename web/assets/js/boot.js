// Runs synchronously in <head>: decide early whether motion styles apply, so
// content never flashes visible-then-hidden. If the animation layer has not
// started within a few seconds (CDN blocked, script error), show everything.
(function () {
  var root = document.documentElement;
  root.classList.add("js");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduce) root.classList.add("has-motion");
  window.setTimeout(function () {
    if (!window.__atherynMotion) root.classList.remove("has-motion");
  }, 3500);
})();
