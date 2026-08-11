// Fallback for browsers that don't support the CSS `aspect-ratio` property
// (landed in Chromium 88 / Jan 2021, Safari 15 / Sep 2021) — a 2019-era
// Android WebView (common on phones that never get Google Play Services
// WebView auto-updates, e.g. mainland-China-market Xiaomi/MIUI devices)
// predates this by a couple of years. A <div>-based grid board has no
// intrinsic size of its own, so when its `aspect-ratio: W / H` rule is
// silently ignored, it collapses to near-zero height — this is what makes
// a game's board render as a single tiny sliver instead of a full grid on
// those devices. (A `<canvas>` element is a "replaced element" with its own
// intrinsic width/height attributes, so `height:auto` already sizes it
// correctly without aspect-ratio at all — canvases don't actually need
// this fallback, but it's harmless to also cover them.)
//
// Zero per-file changes required: this scans the page's OWN stylesheets
// for any `aspect-ratio: W / H` declaration via the raw rule text (which
// is readable even on a browser that doesn't understand the property well
// enough to expose it through the normal CSSOM `.style.aspectRatio`), then
// — only if this browser genuinely doesn't support the property — applies
// an equivalent computed inline height to every matching element, kept in
// sync via ResizeObserver. On any modern browser this whole script is a
// single `CSS.supports()` check and then does nothing at all.
(function () {
  if (window.CSS && CSS.supports && CSS.supports("aspect-ratio", "1 / 1")) return;

  var RATIO_RE = /aspect-ratio\s*:\s*([\d.]+)\s*\/\s*([\d.]+)/i;
  var rules = [];

  function collectFromSheet(sheet) {
    var cssRules;
    try {
      cssRules = sheet.cssRules;
    } catch (e) {
      return; // cross-origin stylesheet — this hub has none, but stay safe
    }
    if (!cssRules) return;
    for (var i = 0; i < cssRules.length; i++) {
      var rule = cssRules[i];
      if (rule.selectorText && rule.cssText) {
        var m = RATIO_RE.exec(rule.cssText);
        if (m) rules.push({ selector: rule.selectorText, w: parseFloat(m[1]), h: parseFloat(m[2]) });
      } else if (rule.cssRules) {
        collectFromSheet(rule); // @media-wrapped rules
      }
    }
  }

  try {
    for (var i = 0; i < document.styleSheets.length; i++) collectFromSheet(document.styleSheets[i]);
  } catch (e) {
    return;
  }
  if (!rules.length) return;

  var observed = [];
  function applyAll() {
    rules.forEach(function (r) {
      var els = document.querySelectorAll(r.selector);
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var width = el.getBoundingClientRect().width;
        if (width > 0) el.style.height = (width * r.h) / r.w + "px";
        if (observed.indexOf(el) === -1) {
          observed.push(el);
          if (window.ResizeObserver && applyAll._ro) applyAll._ro.observe(el);
        }
      }
    });
  }

  if (window.ResizeObserver) {
    applyAll._ro = new ResizeObserver(function () {
      applyAll();
    });
  } else {
    window.addEventListener("resize", applyAll);
  }

  applyAll();
  document.addEventListener("DOMContentLoaded", applyAll);
  // Boards that get rebuilt via innerHTML replacement (every grid-based
  // game in this hub) keep the same container element/id across renders,
  // so observing it once is enough — this extra delayed pass just covers
  // any element that didn't exist yet at initial script-run time (e.g. a
  // board created only after the player picks a difficulty).
  setTimeout(applyAll, 300);
})();
