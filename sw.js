// sudo/ hub — offline-capable service worker. Whole-site precache (this
// repo is pure text: HTML/JS/CSS/JSON, well under 2MB total, zero images/
// audio/fonts fetched at runtime — every sound is synthesized via Web
// Audio, every icon is emoji), so caching the entire hub is cheap and
// gives every game full offline access after just one successful online
// visit to the hub root, not only whichever games happen to have been
// opened before.
//
// MAINTENANCE: bump CACHE_VERSION on every content change (new game, any
// edited file, new/removed asset) — that's what triggers the
// update-available banner (see shared/js/pwa.js). Format is
// "YYYY-MM-DD-HHmm" (local time of the deploy) rather than an opaque vN —
// shared/js/pwa.js parses this exact string to show "版本更新於 ..." on the
// hub homepage, so this is the ONE place that timestamp comes from; no
// second value to keep in sync. If files are added, removed, or renamed,
// regenerate PRECACHE_URLS too — this list was generated, not hand-typed,
// via:
//   find . -type f \( -iname "*.html" -o -iname "*.js" -o -iname "*.css" -o -iname "*.json" \) \
//     -not -path "./.git/*" -not -path "./.venv/*" -not -path "./.claude/*" -not -name "sw.js" \
//     | sed 's|^\./||' | sort
//   (plus icons/*.png) — re-run that and diff before hand-editing this
// array for anything beyond a one-off addition.
const CACHE_VERSION = "2026-08-12-1022";
const CACHE_NAME = "sudo-hub-" + CACHE_VERSION;

const PRECACHE_URLS = [
  "./",
  "breakout/index.html",
  "breakout/js/game.js",
  "breakout/js/sound.js",
  "breakout/js/ui.js",
  "breakout/style.css",
  "connectFour/index.html",
  "connectFour/js/game.js",
  "connectFour/js/sound.js",
  "connectFour/js/ui.js",
  "connectFour/style.css",
  "fifteen/index.html",
  "fifteen/js/game.js",
  "fifteen/js/sound.js",
  "fifteen/js/ui.js",
  "fifteen/style.css",
  "frog/index.html",
  "frog/js/game.js",
  "frog/js/sound.js",
  "frog/js/ui.js",
  "frog/style.css",
  "game2048/index.html",
  "game2048/js/game.js",
  "game2048/js/sound.js",
  "game2048/js/ui.js",
  "game2048/style.css",
  "guess/index.html",
  "guess/js/game.js",
  "guess/js/ui.js",
  "guess/style.css",
  "index.html",
  "jigsaw/index.html",
  "jigsaw/js/game.js",
  "jigsaw/js/images.js",
  "jigsaw/js/sound.js",
  "jigsaw/js/ui.js",
  "jigsaw/style.css",
  "klotski/index.html",
  "klotski/js/game.js",
  "klotski/js/sound.js",
  "klotski/js/ui.js",
  "klotski/style.css",
  "lianliankan/index.html",
  "lianliankan/js/game.js",
  "lianliankan/js/sound.js",
  "lianliankan/js/ui.js",
  "lianliankan/style.css",
  "manifest.json",
  "maze/index.html",
  "maze/js/game.js",
  "maze/js/sound.js",
  "maze/js/ui.js",
  "maze/style.css",
  "memory/index.html",
  "memory/js/game.js",
  "memory/js/ui.js",
  "memory/style.css",
  "minesweeper/index.html",
  "minesweeper/js/game.js",
  "minesweeper/js/sound.js",
  "minesweeper/js/ui.js",
  "minesweeper/style.css",
  "nonogram/index.html",
  "nonogram/js/game.js",
  "nonogram/js/sound.js",
  "nonogram/js/ui.js",
  "nonogram/style.css",
  "othello/index.html",
  "othello/js/game.js",
  "othello/js/sound.js",
  "othello/js/ui.js",
  "othello/style.css",
  "pitchTrain/index.html",
  "pitchTrain/js/game.js",
  "pitchTrain/js/sound.js",
  "pitchTrain/js/ui.js",
  "pitchTrain/style.css",
  "relativePitch/index.html",
  "relativePitch/js/game.js",
  "relativePitch/js/sound.js",
  "relativePitch/js/ui.js",
  "relativePitch/style.css",
  "shared/js/aspect-ratio-fallback.js",
  "shared/js/games.js",
  "shared/js/hub.js",
  "shared/js/pwa.js",
  "shared/js/storage.js",
  "shared/style.css",
  "shellGame/index.html",
  "shellGame/js/game.js",
  "shellGame/js/sound.js",
  "shellGame/js/ui.js",
  "shellGame/style.css",
  "smokeCar/index.html",
  "smokeCar/js/game.js",
  "smokeCar/js/sound.js",
  "smokeCar/js/ui.js",
  "smokeCar/style.css",
  "sokoban/index.html",
  "sokoban/js/game.js",
  "sokoban/js/sound.js",
  "sokoban/js/ui.js",
  "sokoban/style.css",
  "sudoku/index.html",
  "sudoku/js/game.js",
  "sudoku/js/rng.js",
  "sudoku/js/sudoku.js",
  "sudoku/js/ui.js",
  "sudoku/style.css",
  "wordGame/index.html",
  "wordGame/js/dictionary.js",
  "wordGame/js/game.js",
  "wordGame/js/sound.js",
  "wordGame/js/ui.js",
  "wordGame/style.css",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512-maskable.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  // NOT cache.addAll(PRECACHE_URLS) — that convenience method does a plain
  // fetch() per URL, which is still subject to the browser's own HTTP
  // cache. A device with an old cached response for, say,
  // shared/js/games.js would get that STALE copy baked into the brand-new
  // SW cache even though CACHE_VERSION itself updated correctly — this is
  // exactly what caused one real device (an old Android WebView) to keep
  // showing already-removed content and a stale bugfix while another
  // device on the same deploy was fine, purely because their HTTP caches
  // held different old bytes. `{ cache: "reload" }` forces every one of
  // these fetches to bypass HTTP cache and revalidate with the network, so
  // "new SW version" always actually means "genuinely fresh files".
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        PRECACHE_URLS.map((url) =>
          fetch(url, { cache: "reload" }).then((response) => {
            if (response && response.ok) return cache.put(url, response);
          })
        )
      )
    )
  );
  // Deliberately NOT calling self.skipWaiting() here — a new version stays
  // "waiting" until every open tab on the old version closes, or the page
  // explicitly tells it to take over (see the "message" handler below,
  // triggered by the player clicking the update banner in shared/js/pwa.js).
  // That's what makes the update-available banner meaningful instead of
  // silently swapping content out from under an open game.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

// Cache-first (instant, works offline) with a network fallback that also
// heals the cache — so even a URL that wasn't in PRECACHE_URLS (a new game
// added without remembering to update this file, for instance) still
// becomes available offline the first time it's fetched successfully
// while online.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      // { cache: "reload" } here too, same reasoning as install() above —
      // anything opportunistically cached at runtime should be a genuinely
      // fresh fetch, not whatever the browser's own HTTP cache had lying
      // around.
      return fetch(event.request, { cache: "reload" })
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
  else if (event.data === "getVersion" && event.source) {
    event.source.postMessage({ type: "version", version: CACHE_VERSION });
  }
});
