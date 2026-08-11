// The only file that touches the DOM. Renders state -> DOM and wires
// events. Uses an on-screen dpad (like sokoban's) rather than swipe
// gestures, plus arrow keys — more reliable for this hub's touch/elderly
// audience than gesture detection.
(function () {
  const DIFFICULTY_LABELS = { easy: "簡單", medium: "中等", hard: "困難", expert: "專家" };
  const DIFFICULTY_ORDER = ["easy", "medium", "hard", "expert"];
  const SOUND_EVENTS = new Set(["move", "invalid", "undo"]);

  // -- home view elements ---------------------------------------------------
  const homeViewEl = document.getElementById("homeView");
  const themeSelect = document.getElementById("themeSelect");
  const continueBtn = document.getElementById("continueBtn");
  const instructionsBtn = document.getElementById("instructionsBtn");
  const soundToggleBtn = document.getElementById("soundToggleBtn");
  const difficultyButtons = Array.from(document.querySelectorAll(".difficulty-btn"));
  const historyBtn = document.getElementById("historyBtn");
  const careerBtn = document.getElementById("careerBtn");

  // -- game view elements -----------------------------------------------------
  const gameViewEl = document.getElementById("gameView");
  const backHomeBtn = document.getElementById("backHomeBtn");
  const difficultyLabel = document.getElementById("difficultyLabel");
  const timerDisplay = document.getElementById("timerDisplay");
  const scoreDisplay = document.getElementById("scoreDisplay");
  const targetDisplay = document.getElementById("targetDisplay");
  const undoBtn = document.getElementById("undoBtn");
  const resetBtn = document.getElementById("resetBtn");
  const gameSoundToggleBtn = document.getElementById("gameSoundToggleBtn");
  const gameInstructionsBtn = document.getElementById("gameInstructionsBtn");
  const boardEl = document.getElementById("board");
  const dpadUp = document.getElementById("dpadUp");
  const dpadDown = document.getElementById("dpadDown");
  const dpadLeft = document.getElementById("dpadLeft");
  const dpadRight = document.getElementById("dpadRight");

  // -- history / career view elements -----------------------------------------
  const historyViewEl = document.getElementById("historyView");
  const historyBackBtn = document.getElementById("historyBackBtn");
  const historyList = document.getElementById("historyList");
  const careerViewEl = document.getElementById("careerView");
  const careerBackBtn = document.getElementById("careerBackBtn");
  const careerTableBody = document.getElementById("careerTableBody");

  // -- win / instructions modals ----------------------------------------------
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
    Object.entries(views).forEach(([key, el]) => {
      el.classList.toggle("hidden", key !== name);
    });
  }

  function applyTheme(themeKey) {
    document.documentElement.dataset.theme = themeKey;
  }

  function hasAnyProgressToLose() {
    return Game2048.hasProgress() || Game2048.hasSavedResumableGame();
  }

  function applySoundButtonState(btn, compact) {
    const on = Game2048Sound.isEnabled();
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = compact ? (on ? "🔊" : "🔇") : on ? "🔊 音效：開" : "🔇 音效：關";
  }

  function toggleSound() {
    const next = !Game2048Sound.isEnabled();
    Game2048Sound.setEnabled(next);
    Game2048Storage.saveSettings({ soundEnabled: next });
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  // -- home view rendering ----------------------------------------------------
  function renderHome() {
    continueBtn.disabled = !Game2048.hasSavedResumableGame();
    themeSelect.value = GameHubStorage.getTheme();
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  function statRow(label, value) {
    return `<div class="win-stat-row"><span>${label}</span><span>${value}</span></div>`;
  }

  function renderHistory() {
    const items = Game2048Storage.getHistory();
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
      const label = DIFFICULTY_LABELS[entry.difficulty] || entry.difficulty;
      const result = entry.status === "won" ? "達標" : "卡關";
      row.innerHTML =
        `<span class="record-tag">${label}　${result}　${date}</span>` +
        `<span>分數 ${entry.score}　最高 ${entry.maxTile}</span>`;
      frag.appendChild(row);
    });
    historyList.appendChild(frag);
  }

  function renderCareer() {
    const career = Game2048Storage.getCareer();
    careerTableBody.innerHTML = "";
    const frag = document.createDocumentFragment();
    DIFFICULTY_ORDER.forEach((code) => {
      const entry = career[code] || { bestScore: null, bestTile: null, won: 0, runs: 0 };
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${DIFFICULTY_LABELS[code]}</td>` +
        `<td>${entry.bestScore == null ? "--" : entry.bestScore}</td>` +
        `<td>${entry.bestTile == null ? "--" : entry.bestTile}</td>` +
        `<td>${entry.won}</td>`;
      frag.appendChild(tr);
    });
    careerTableBody.appendChild(frag);
  }

  // -- game view rendering ------------------------------------------------
  function renderBoard(state) {
    const size = Game2048.getBoardSize();
    boardEl.style.setProperty("--cols", size.cols);
    boardEl.style.setProperty("--rows", size.rows);
    // Also set the literal computed value directly (not just the --cols/--rows
    // custom properties the CSS repeat(var(...)) rule reads) -- a browser that
    // doesn't support custom properties inside repeat()'s count position (pre-2021
    // engines) would otherwise silently fall back to a single column/row. Setting
    // the resolved string via inline style works unconditionally on any browser.
    boardEl.style.gridTemplateColumns = "repeat(" + size.cols + ", 1fr)";
    boardEl.style.gridTemplateRows = "repeat(" + size.rows + ", 1fr)";

    const frag = document.createDocumentFragment();
    state.board.forEach((value) => {
      const cell = document.createElement("div");
      cell.className = "g2048-cell" + (value ? " v" + Math.min(value, 8192) : "");
      if (value) cell.textContent = String(value);
      frag.appendChild(cell);
    });

    boardEl.innerHTML = "";
    boardEl.appendChild(frag);
  }

  function renderToolbar(state) {
    timerDisplay.textContent = Game2048.formatTime(Game2048.getElapsedMs());
    scoreDisplay.textContent = String(state.score);
    targetDisplay.textContent = String(state.target);
    undoBtn.disabled = state.status !== "playing" || state.history.length === 0;
    difficultyLabel.textContent = DIFFICULTY_LABELS[state.difficulty] || state.difficulty;
  }

  function renderWinModal(state) {
    if (state.status !== "won" && state.status !== "lost") {
      winModal.classList.add("hidden");
      return;
    }
    if (state.status === "lost") {
      winTitle.textContent = "😢 卡關了";
      winCloseBtn.textContent = "再試一次";
    } else {
      winTitle.textContent = "🎉 達到目標！";
      winCloseBtn.textContent = "新遊戲";
    }
    winSubtitle.textContent = DIFFICULTY_LABELS[state.difficulty] || state.difficulty;
    const isNewBest = state.justWon && state.justWon.isNewBest;
    winStats.innerHTML =
      statRow("分數", String(state.score)) +
      statRow("最高數字", String(Math.max(...state.board))) +
      statRow("花費時間", Game2048.formatTime(state.elapsedMs)) +
      (isNewBest ? statRow("紀錄", "🏆 新紀錄！") : "");
    winModal.classList.remove("hidden");
  }

  function render(state, event) {
    if (SOUND_EVENTS.has(event)) Game2048Sound.play(event);
    if (!state) return;
    if (event === "move" && state.status === "won") Game2048Sound.play("win");
    else if (event === "move" && state.status === "lost") Game2048Sound.play("lost");
    renderBoard(state);
    renderToolbar(state);
    renderWinModal(state);
  }

  // -- home view interactions -----------------------------------------------
  continueBtn.addEventListener("click", () => {
    if (Game2048.resumeGame()) showView("game");
  });

  instructionsBtn.addEventListener("click", () => instructionsModal.classList.remove("hidden"));
  gameInstructionsBtn.addEventListener("click", () => instructionsModal.classList.remove("hidden"));
  instructionsCloseBtn.addEventListener("click", () => instructionsModal.classList.add("hidden"));

  soundToggleBtn.addEventListener("click", toggleSound);
  gameSoundToggleBtn.addEventListener("click", toggleSound);

  difficultyButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const difficulty = btn.dataset.difficulty;
      if (
        hasAnyProgressToLose() &&
        !confirm("目前有進行中的遊戲，確定要開始新的一局嗎？進度將會遺失。")
      ) {
        return;
      }
      Game2048.newGame(difficulty);
      showView("game");
    });
  });

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
  dpadUp.addEventListener("click", () => Game2048.move("up"));
  dpadDown.addEventListener("click", () => Game2048.move("down"));
  dpadLeft.addEventListener("click", () => Game2048.move("left"));
  dpadRight.addEventListener("click", () => Game2048.move("right"));

  undoBtn.addEventListener("click", () => Game2048.undo());

  resetBtn.addEventListener("click", () => {
    const state = Game2048.getState();
    if (Game2048.hasProgress() && !confirm("確定要放棄目前進度，重新開始一局新的關卡嗎？")) {
      return;
    }
    Game2048.newGame(state ? state.difficulty : "easy");
  });

  backHomeBtn.addEventListener("click", () => {
    // No confirm needed: autosaves after every move, so "繼續上次遊戲"
    // always brings it back — matches every other game in this hub.
    renderHome();
    showView("home");
  });

  winCloseBtn.addEventListener("click", () => {
    const state = Game2048.getState();
    Game2048.newGame(state ? state.difficulty : "easy");
  });
  winHomeBtn.addEventListener("click", () => {
    winModal.classList.add("hidden");
    renderHome();
    showView("home");
  });

  document.addEventListener("keydown", (e) => {
    if (gameViewEl.classList.contains("hidden")) return;
    const state = Game2048.getState();
    if (!state || state.status !== "playing") return;
    if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
      e.preventDefault();
      Game2048.move("up");
    } else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
      e.preventDefault();
      Game2048.move("down");
    } else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
      e.preventDefault();
      Game2048.move("left");
    } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
      e.preventDefault();
      Game2048.move("right");
    }
  });

  // -- boot -----------------------------------------------------------------
  Game2048Sound.setEnabled(Game2048Storage.getSettings().soundEnabled !== false);
  Game2048.onChange(render);
  applyTheme(GameHubStorage.getTheme());
  renderHome();
  showView("home");
})();
