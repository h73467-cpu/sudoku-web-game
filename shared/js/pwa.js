// PWA install + offline support for the sudo/ game hub. Only loaded on the
// hub root page (index.html) — service-worker registration scope is the
// whole origin regardless of which page happens to register it first, so
// every game gets offline support the moment the player has visited the
// hub root once while online; individual game pages don't need this
// script themselves.
(function () {
  if (!("serviceWorker" in navigator)) return;

  var installHint = document.getElementById("pwaInstallHint");
  var installText = document.getElementById("pwaInstallText");
  var installBtn = document.getElementById("pwaInstallBtn");
  var updateBanner = document.getElementById("pwaUpdateBanner");
  var updateBtn = document.getElementById("pwaUpdateBtn");
  var buildVersionText = document.getElementById("buildVersionText");

  var isStandalone =
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true;
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  // -- install hint (skipped entirely once already installed) ---------------
  if (!isStandalone && installHint) {
    installHint.classList.remove("hidden");

    if (isIOS) {
      // iOS/Safari has no beforeinstallprompt API at all — there's no way
      // to trigger installation programmatically, only point at the manual
      // "加入主畫面" step in Safari's own share sheet.
      installText.textContent = "📱 支援離線遊玩：點 Safari 下方的「分享」→「加入主畫面」即可安裝，安裝後不需要網路也能玩。";
    } else {
      installText.textContent = "📲 支援離線遊玩，安裝後不需要網路也能玩。";
      var deferredPrompt = null;
      // Suppress the browser's own automatic install prompt and only ever
      // trigger it from the player's own click on our button below — see
      // this repo's session notes on why (avoids an unpredictable browser
      // popup interrupting play; player controls the timing).
      window.addEventListener("beforeinstallprompt", function (event) {
        event.preventDefault();
        deferredPrompt = event;
        installBtn.classList.remove("hidden");
      });
      installBtn.addEventListener("click", function () {
        if (!deferredPrompt) return;
        var toPrompt = deferredPrompt;
        deferredPrompt = null;
        installBtn.classList.add("hidden");
        toPrompt.prompt();
      });
      window.addEventListener("appinstalled", function () {
        installHint.classList.add("hidden");
      });
    }
  }

  // -- service worker registration + passive update-available banner -------
  function showUpdateBanner(waitingWorker) {
    if (!updateBanner) return;
    updateBanner.classList.remove("hidden");
    updateBtn.onclick = function () {
      waitingWorker.postMessage("skipWaiting");
    };
  }

  navigator.serviceWorker
    .register("sw.js")
    .then(function (registration) {
      // A worker was already waiting when we registered (e.g. this tab
      // opened after an update finished downloading in another tab).
      if (registration.waiting && navigator.serviceWorker.controller) {
        showUpdateBanner(registration.waiting);
      }
      registration.addEventListener("updatefound", function () {
        var newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", function () {
          // controller already set = this is a genuine update, not the
          // very first install (which has no prior controller to notify).
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            showUpdateBanner(newWorker);
          }
        });
      });
    })
    .catch(function () {
      // Offline support is a progressive enhancement — a failed
      // registration (unsupported browser, blocked, etc.) shouldn't
      // affect normal online play at all.
    });

  var reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  // -- visible build version (which cached version is actually running) -----
  // sw.js's CACHE_VERSION is the single source of truth, formatted as
  // "YYYY-MM-DD-HHmm" — parsed here rather than duplicated as a second
  // hardcoded string anywhere, so there's nothing else to keep in sync when
  // bumping it. Asks the ACTIVE (controlling) worker specifically, not
  // whichever cache happens to exist in storage, so this reflects what the
  // page is really running right now — if an update is waiting but not yet
  // applied, this still (correctly) shows the old version until the player
  // taps "立即更新".
  function formatBuildVersion(raw) {
    var m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})$/.exec(raw);
    if (!m) return raw;
    return m[1] + "年" + Number(m[2]) + "月" + Number(m[3]) + "日 " + m[4] + ":" + m[5] + " 更新";
  }
  navigator.serviceWorker.addEventListener("message", function (event) {
    if (event.data && event.data.type === "version" && buildVersionText) {
      buildVersionText.textContent = "📦 版本：" + formatBuildVersion(event.data.version);
      buildVersionText.classList.remove("hidden");
    }
  });
  function requestVersion() {
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage("getVersion");
    }
  }
  if (navigator.serviceWorker.controller) requestVersion();
  navigator.serviceWorker.ready.then(requestVersion);
  navigator.serviceWorker.addEventListener("controllerchange", requestVersion);
})();
