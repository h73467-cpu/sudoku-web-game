// The only file that touches the DOM. Renders ShellGame's state machine to
// the cup elements, orchestrates the reveal/shuffle/result timing via
// setTimeout chains (ShellGame itself only exposes discrete step
// functions — it has no timers of its own), and maps events to sound +
// celebratory visual effects.
(function () {
  const PARTICLE_GLYPHS = ["✨", "🎉", "⭐", "💰", "🎊"];
  const CONFETTI_COLORS = ["#f43f5e", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];

  // -- home view elements ---------------------------------------------------
  const homeViewEl = document.getElementById("homeView");
  const themeSelect = document.getElementById("themeSelect");
  const startBtn = document.getElementById("startBtn");
  const instructionsBtn = document.getElementById("instructionsBtn");
  const soundToggleBtn = document.getElementById("soundToggleBtn");
  const historyBtn = document.getElementById("historyBtn");
  const careerBtn = document.getElementById("careerBtn");

  // -- game view elements -----------------------------------------------------
  const gameViewEl = document.getElementById("gameView");
  const backHomeBtn = document.getElementById("backHomeBtn");
  const levelDisplay = document.getElementById("levelDisplay");
  const livesDisplay = document.getElementById("livesDisplay");
  const streakDisplay = document.getElementById("streakDisplay");
  const gameSoundToggleBtn = document.getElementById("gameSoundToggleBtn");
  const gameInstructionsBtn = document.getElementById("gameInstructionsBtn");
  const messageBanner = document.getElementById("messageBanner");
  const particleLayerEl = document.getElementById("particleLayer");
  const cupTrackEl = document.getElementById("cupTrack");
  const cupWrapperEls = [0, 1, 2].map((c) => cupTrackEl.querySelector('.cup[data-cup="' + c + '"]'));
  const cupBodyEls = [0, 1, 2].map((c) => cupTrackEl.querySelector('.cup-body[data-cup="' + c + '"]'));
  const treasureEls = [0, 1, 2].map((c) => cupTrackEl.querySelector('.treasure[data-cup="' + c + '"]'));
  const screenFlashEl = document.getElementById("screenFlash");

  // -- history / career view elements -----------------------------------------
  const historyViewEl = document.getElementById("historyView");
  const historyBackBtn = document.getElementById("historyBackBtn");
  const historyList = document.getElementById("historyList");
  const careerViewEl = document.getElementById("careerView");
  const careerBackBtn = document.getElementById("careerBackBtn");
  const careerStats = document.getElementById("careerStats");

  // -- modals -----------------------------------------------------------------
  const winModal = document.getElementById("winModal");
  const winTitle = document.getElementById("winTitle");
  const winSubtitle = document.getElementById("winSubtitle");
  const winStats = document.getElementById("winStats");
  const winCloseBtn = document.getElementById("winCloseBtn");
  const winHomeBtn = document.getElementById("winHomeBtn");
  const instructionsModal = document.getElementById("instructionsModal");
  const instructionsCloseBtn = document.getElementById("instructionsCloseBtn");

  const views = { home: homeViewEl, game: gameViewEl, history: historyViewEl, career: careerViewEl };

  function showView(name) {
    Object.entries(views).forEach(([key, el]) => el.classList.toggle("hidden", key !== name));
  }

  function applyTheme(themeKey) {
    document.documentElement.dataset.theme = themeKey;
  }

  function applySoundButtonState(btn, compact) {
    const on = ShellGameSound.isEnabled();
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = compact ? (on ? "🔊" : "🔇") : on ? "🔊 音效：開" : "🔇 音效：關";
  }

  function toggleSound() {
    const next = !ShellGameSound.isEnabled();
    ShellGameSound.setEnabled(next);
    ShellGameStorage.saveSettings({ soundEnabled: next });
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  function statRow(label, value) {
    return '<div class="win-stat-row"><span>' + label + "</span><span>" + value + "</span></div>";
  }

  // -- home / history / career rendering ---------------------------------------
  function renderHome() {
    themeSelect.value = GameHubStorage.getTheme();
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  function renderHistory() {
    const items = ShellGameStorage.getHistory();
    historyList.innerHTML = "";
    if (items.length === 0) {
      historyList.innerHTML = '<div class="empty-state">還沒有任何紀錄</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    items.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "record-row";
      const date = entry.completedAt ? entry.completedAt.slice(0, 10) : "-";
      row.innerHTML =
        '<span class="record-tag">' + date + "</span>" +
        "<span>抵達第 " + entry.levelReached + " 關　最長連續 " + entry.bestStreak + " 次</span>";
      frag.appendChild(row);
    });
    historyList.appendChild(frag);
  }

  function renderCareer() {
    const career = ShellGameStorage.getCareer();
    careerStats.innerHTML =
      statRow("最高關卡", career.bestLevel ? "第 " + career.bestLevel + " 關" : "--") +
      statRow("最長連續正確", career.bestStreak ? career.bestStreak + " 次" : "--") +
      statRow("遊玩次數", String(career.runs || 0));
  }

  // -- cup rendering helpers ----------------------------------------------------
  function renderCupPositions(state) {
    for (let c = 0; c < 3; c++) {
      const offset = (state.cupSlot[c] - c) * 100;
      cupWrapperEls[c].style.transform = "translateX(" + offset + "%)";
    }
  }

  function resetCupPositionsInstant() {
    cupWrapperEls.forEach((el) => {
      el.style.transition = "none";
      el.style.transform = "translateX(0%)";
    });
    void cupTrackEl.offsetWidth;
    cupWrapperEls.forEach((el) => {
      el.style.transition = "";
    });
  }

  function clearCupVisualState() {
    cupBodyEls.forEach((el) => el.classList.remove("lifted", "wrong-pick", "correct-pop"));
    treasureEls.forEach((el) => el.classList.remove("shown", "reveal-truth"));
    cupWrapperEls.forEach((el) => el.classList.remove("on-top"));
  }

  function revealTreasure(cupId, opts) {
    const state = ShellGame.getState();
    treasureEls[cupId].textContent = state.treasureEmoji;
    treasureEls[cupId].classList.add("shown");
    if (opts && opts.truth) treasureEls[cupId].classList.add("reveal-truth");
    cupBodyEls[cupId].classList.add("lifted");
  }

  function hideAllTreasures() {
    treasureEls.forEach((el) => el.classList.remove("shown", "reveal-truth"));
    cupBodyEls.forEach((el) => el.classList.remove("lifted"));
  }

  function enableGuessing() {
    cupBodyEls.forEach((el) => el.classList.remove("disabled"));
  }
  function disableGuessing() {
    cupBodyEls.forEach((el) => el.classList.add("disabled"));
  }

  function showMessage(text, tone) {
    messageBanner.textContent = text;
    messageBanner.classList.remove("tone-correct", "tone-wrong");
    if (tone) messageBanner.classList.add(tone);
  }

  function flashScreen(cls) {
    screenFlashEl.classList.remove("flash-good", "flash-bad");
    void screenFlashEl.offsetWidth;
    screenFlashEl.classList.add(cls);
  }

  function spawnParticles(cupIdentity, count) {
    const state = ShellGame.getState();
    const slot = state.cupSlot[cupIdentity];
    const leftPercent = ((slot + 0.5) / 3) * 100;
    for (let i = 0; i < count; i++) {
      const span = document.createElement("span");
      span.className = "particle";
      span.textContent = PARTICLE_GLYPHS[Math.floor(Math.random() * PARTICLE_GLYPHS.length)];
      const angle = Math.random() * Math.PI - Math.PI;
      const dist = 40 + Math.random() * 70;
      const dx = Math.cos(angle) * dist;
      const dy = -Math.abs(Math.sin(angle) * dist) - 30;
      span.style.left = leftPercent + "%";
      span.style.setProperty("--dx", dx.toFixed(1) + "px");
      span.style.setProperty("--dy", dy.toFixed(1) + "px");
      span.style.setProperty("--rot", (Math.random() * 360 - 180).toFixed(0) + "deg");
      span.style.animationDelay = Math.random() * 120 + "ms";
      particleLayerEl.appendChild(span);
      setTimeout(() => span.remove(), 1100);
    }
  }

  function spawnConfetti() {
    const overlay = document.createElement("div");
    overlay.className = "confetti-overlay";
    for (let i = 0; i < 60; i++) {
      const piece = document.createElement("span");
      piece.className = "confetti-piece";
      piece.style.left = Math.random() * 100 + "%";
      piece.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
      piece.style.animationDuration = 1.2 + Math.random() * 1 + "s";
      piece.style.animationDelay = Math.random() * 0.3 + "s";
      overlay.appendChild(piece);
    }
    document.body.appendChild(overlay);
    setTimeout(() => overlay.remove(), 2300);
  }

  function showMilestoneBanner(level) {
    const banner = document.createElement("div");
    banner.className = "milestone-banner";
    banner.textContent = "🏆 恭喜達成第 " + level + " 關！";
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 2100);
  }

  // -- toolbar --------------------------------------------------------------
  let lastLives = null;
  function renderHearts(lives) {
    const total = ShellGame.LIVES_START;
    let html = "";
    for (let i = 0; i < total; i++) {
      if (i < lives) {
        html += '<span class="heart">❤️</span>';
      } else if (lastLives != null && i === lives) {
        html += '<span class="heart breaking">💔</span>';
      } else {
        html += '<span class="heart lost">🖤</span>';
      }
    }
    livesDisplay.innerHTML = html;
    lastLives = lives;
  }

  function renderToolbar(state) {
    levelDisplay.textContent = String(state.level);
    streakDisplay.textContent = String(state.streak) + (state.streak >= 3 ? " 🔥".repeat(Math.min(5, state.streak - 2)) : "");
    renderHearts(state.lives);
  }

  function renderWinModal(state) {
    const result = state.justFinished || {};
    winTitle.textContent = "💥 遊戲結束";
    winSubtitle.textContent = "挑戰到第 " + state.level + " 關";
    winStats.innerHTML =
      statRow("抵達關卡", "第 " + state.level + " 關") +
      statRow("最長連續正確", state.bestStreak + " 次") +
      (result.isNewBestLevel ? statRow("紀錄", "🏆 最高關卡！") : "") +
      (result.isNewBestStreak ? statRow("紀錄", "🏆 最長連續紀錄！") : "");
    winModal.classList.remove("hidden");
  }

  // -- round orchestration (timers live here, not in ShellGame) ---------------
  let pendingTimers = [];
  function schedule(fn, delay) {
    const id = setTimeout(fn, delay);
    pendingTimers.push(id);
    return id;
  }
  function clearTimers() {
    pendingTimers.forEach((id) => clearTimeout(id));
    pendingTimers = [];
  }

  function onRoundStart(state) {
    clearTimers();
    resetCupPositionsInstant();
    clearCupVisualState();
    disableGuessing();
    cupTrackEl.style.setProperty("--swap-duration", state.swapDurationMs + "ms");
    showMessage("👀 記住寶物在哪裡！", "");

    schedule(() => {
      revealTreasure(state.ballCup, { truth: false });
      ShellGameSound.play("reveal");
    }, 200);

    schedule(() => {
      hideAllTreasures();
      ShellGameSound.play("lidClose");
      showMessage("🌀 交換中…", "");
      ShellGame.beginShuffle();
      runShuffleStep();
    }, ShellGame.REVEAL_MS);
  }

  function animateSwapStep(state, cupA, cupB) {
    renderCupPositions(state);
    const topCup = Math.random() < 0.5 ? cupA : cupB;
    cupWrapperEls[topCup].classList.add("on-top");
    schedule(() => cupWrapperEls[topCup].classList.remove("on-top"), state.swapDurationMs);
  }

  function runShuffleStep() {
    const state = ShellGame.getState();
    if (!state || state.status !== "shuffling") return;
    schedule(() => {
      const result = ShellGame.stepSwap();
      if (!result) return;
      const current = ShellGame.getState();
      animateSwapStep(current, result.cupA, result.cupB);
      ShellGameSound.play("swap", { level: current.level });
      if (!result.done) {
        runShuffleStep();
      } else {
        schedule(() => {
          showMessage("🤔 寶物在哪個杯子？", "");
          enableGuessing();
        }, 150);
      }
    }, state.swapDurationMs);
  }

  function onResult(state, event) {
    clearTimers();
    disableGuessing();
    const milestone = event === "correct" && ShellGame.isMilestone(state.clearedLevel);

    for (let id = 0; id < 3; id++) revealTreasure(id, { truth: id === state.ballCup });
    cupBodyEls[state.guessedCup].classList.add(event === "correct" ? "correct-pop" : "wrong-pick");

    if (event === "correct") {
      flashScreen("flash-good");
      showMessage(
        milestone ? "🎉 第 " + state.clearedLevel + " 關！太厲害了！" : "✅ 猜對了！過關～",
        "tone-correct"
      );
      spawnParticles(state.guessedCup, milestone ? 16 : 9);
      ShellGameSound.play("correct", { streak: state.streak });
      if (milestone) {
        ShellGameSound.play("milestone");
        spawnConfetti();
        showMilestoneBanner(state.clearedLevel);
      }
    } else {
      flashScreen("flash-bad");
      showMessage("❌ 猜錯了！寶物其實在這裡", "tone-wrong");
      ShellGameSound.play(event === "gameover" ? "gameover" : "wrong");
    }

    const delay = milestone ? ShellGame.MILESTONE_RESULT_MS : ShellGame.RESULT_MS;
    schedule(() => {
      if (event === "gameover") {
        renderWinModal(state);
      } else {
        ShellGame.proceedAfterResult();
      }
    }, delay);
  }

  function render(state, event) {
    if (!state) return;
    renderToolbar(state);
    if (event === "round-start") onRoundStart(state);
    else if (event === "correct" || event === "wrong" || event === "gameover") onResult(state, event);
  }

  // -- cup click handling -------------------------------------------------------
  cupBodyEls.forEach((el, id) => {
    el.addEventListener("click", () => {
      const state = ShellGame.getState();
      if (!state || state.status !== "guessing") return;
      ShellGame.guess(id);
    });
  });

  // -- home view interactions -----------------------------------------------
  startBtn.addEventListener("click", () => {
    lastLives = null;
    ShellGame.newGame();
    showView("game");
  });

  instructionsBtn.addEventListener("click", () => instructionsModal.classList.remove("hidden"));
  gameInstructionsBtn.addEventListener("click", () => instructionsModal.classList.remove("hidden"));
  instructionsCloseBtn.addEventListener("click", () => instructionsModal.classList.add("hidden"));

  soundToggleBtn.addEventListener("click", toggleSound);
  gameSoundToggleBtn.addEventListener("click", toggleSound);

  themeSelect.addEventListener("change", () => {
    const theme = themeSelect.value;
    applyTheme(theme);
    GameHubStorage.setTheme(theme);
  });

  historyBtn.addEventListener("click", () => {
    renderHistory();
    showView("history");
  });
  careerBtn.addEventListener("click", () => {
    renderCareer();
    showView("career");
  });
  historyBackBtn.addEventListener("click", () => {
    renderHome();
    showView("home");
  });
  careerBackBtn.addEventListener("click", () => {
    renderHome();
    showView("home");
  });

  // -- game view interactions ------------------------------------------------
  backHomeBtn.addEventListener("click", () => {
    const state = ShellGame.getState();
    if (state && state.status !== "gameover" && !confirm("目前有進行中的遊戲，確定要返回首頁嗎？進度將會遺失。")) {
      return;
    }
    clearTimers();
    winModal.classList.add("hidden");
    renderHome();
    showView("home");
  });

  winCloseBtn.addEventListener("click", () => {
    winModal.classList.add("hidden");
    lastLives = null;
    ShellGame.newGame();
  });

  winHomeBtn.addEventListener("click", () => {
    winModal.classList.add("hidden");
    clearTimers();
    renderHome();
    showView("home");
  });

  // -- boot -----------------------------------------------------------------
  ShellGameSound.setEnabled(ShellGameStorage.getSettings().soundEnabled !== false);
  ShellGame.onChange(render);
  applyTheme(GameHubStorage.getTheme());
  renderHome();
  showView("home");
})();
