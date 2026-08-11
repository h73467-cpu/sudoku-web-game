// The only file that touches the DOM. Renders state -> DOM and wires
// events. Uses an on-screen dpad (like 2048's/sokoban's) plus arrow keys —
// more reliable for this hub's touch/elderly audience than swipe gestures.
(function () {
  const DIFFICULTY_LABELS = { easy: "簡單", medium: "中等", hard: "困難", expert: "專家" };
  const DIFFICULTY_ORDER = ["easy", "medium", "hard", "expert"];
  const SOUND_EVENTS = new Set(["move", "invalid", "undo", "hint"]);

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
  const movesDisplay = document.getElementById("movesDisplay");
  const undoBtn = document.getElementById("undoBtn");
  const hintBtn = document.getElementById("hintBtn");
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
    return MazeGame.hasProgress() || MazeGame.hasSavedResumableGame();
  }

  function applySoundButtonState(btn, compact) {
    const on = MazeSound.isEnabled();
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = compact ? (on ? "🔊" : "🔇") : on ? "🔊 音效：開" : "🔇 音效：關";
  }

  function toggleSound() {
    const next = !MazeSound.isEnabled();
    MazeSound.setEnabled(next);
    MazeStorage.saveSettings({ soundEnabled: next });
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  // -- home view rendering ----------------------------------------------------
  function renderHome() {
    continueBtn.disabled = !MazeGame.hasSavedResumableGame();
    themeSelect.value = GameHubStorage.getTheme();
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  function statRow(label, value) {
    return `<div class="win-stat-row"><span>${label}</span><span>${value}</span></div>`;
  }

  function renderHistory() {
    const items = MazeStorage.getHistory();
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
      row.innerHTML =
        `<span class="record-tag">${label}　${date}</span>` +
        `<span>${MazeGame.formatSeconds(entry.elapsedSeconds)}　${entry.moves} 步</span>`;
      frag.appendChild(row);
    });
    historyList.appendChild(frag);
  }

  function renderCareer() {
    const career = MazeStorage.getCareer();
    careerTableBody.innerHTML = "";
    const frag = document.createDocumentFragment();
    DIFFICULTY_ORDER.forEach((code) => {
      const entry = career[code] || { bestMoves: null, bestTime: null, won: 0 };
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${DIFFICULTY_LABELS[code]}</td>` +
        `<td>${entry.bestTime == null ? "--" : MazeGame.formatSeconds(entry.bestTime)}</td>` +
        `<td>${entry.bestMoves == null ? "--" : entry.bestMoves}</td>` +
        `<td>${entry.won}</td>`;
      frag.appendChild(tr);
    });
    careerTableBody.appendChild(frag);
  }

  // -- game view rendering ------------------------------------------------
  function renderBoard(state) {
    boardEl.style.setProperty("--cols", state.cols);
    boardEl.style.setProperty("--rows", state.rows);
    // Also set the literal computed value directly (not just the --cols/--rows
    // custom properties the CSS repeat(var(...)) rule reads) -- a browser that
    // doesn't support custom properties inside repeat()'s count position (pre-2021
    // engines) would otherwise silently fall back to a single column/row. Setting
    // the resolved string via inline style works unconditionally on any browser.
    boardEl.style.gridTemplateColumns = "repeat(" + state.cols + ", 1fr)";
    boardEl.style.gridTemplateRows = "repeat(" + state.rows + ", 1fr)";

    const hintSet = new Set(state.hintPath || []);
    const frag = document.createDocumentFragment();
    state.cells.forEach((cell, index) => {
      const div = document.createElement("div");
      let cls = "maze-cell";
      if (cell.top) cls += " wall-top";
      if (cell.right) cls += " wall-right";
      if (cell.bottom) cls += " wall-bottom";
      if (cell.left) cls += " wall-left";
      if (index === state.exitIndex) cls += " maze-exit";
      if (hintSet.has(index)) cls += " maze-hint";
      if (index === state.playerIndex) cls += " maze-player";
      div.className = cls;
      if (index === state.playerIndex) div.textContent = "🧑";
      else if (index === state.exitIndex) div.textContent = "🚩";
      frag.appendChild(div);
    });

    boardEl.innerHTML = "";
    boardEl.appendChild(frag);
  }

  function renderToolbar(state) {
    timerDisplay.textContent = MazeGame.formatTime(MazeGame.getElapsedMs());
    movesDisplay.textContent = String(state.moves);
    undoBtn.disabled = state.status !== "playing" || state.history.length === 0;
    hintBtn.disabled = state.status !== "playing" || state.hintsUsed >= MazeGame.getMaxHints();
    hintBtn.textContent = `💡 提示 (${MazeGame.getMaxHints() - state.hintsUsed})`;
    difficultyLabel.textContent = DIFFICULTY_LABELS[state.difficulty] || state.difficulty;
  }

  function renderWinModal(state) {
    if (state.status !== "won") {
      winModal.classList.add("hidden");
      return;
    }
    winSubtitle.textContent = DIFFICULTY_LABELS[state.difficulty] || state.difficulty;
    const isNewBest = state.justWon && state.justWon.isNewBest;
    winStats.innerHTML =
      statRow("花費時間", MazeGame.formatTime(state.elapsedMs)) +
      statRow("移動步數", String(state.moves)) +
      statRow("使用提示", String(state.hintsUsed)) +
      (isNewBest ? statRow("紀錄", "🏆 新紀錄！") : "");
    winModal.classList.remove("hidden");
  }

  function render(state, event) {
    if (SOUND_EVENTS.has(event)) MazeSound.play(event);
    if (!state) return;
    if (event === "move" && state.status === "won") MazeSound.play("win");
    renderBoard(state);
    renderToolbar(state);
    renderWinModal(state);
  }

  // -- home view interactions -----------------------------------------------
  continueBtn.addEventListener("click", () => {
    if (MazeGame.resumeGame()) showView("game");
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
      MazeGame.newGame(difficulty);
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
  dpadUp.addEventListener("click", () => MazeGame.move("top"));
  dpadDown.addEventListener("click", () => MazeGame.move("bottom"));
  dpadLeft.addEventListener("click", () => MazeGame.move("left"));
  dpadRight.addEventListener("click", () => MazeGame.move("right"));

  undoBtn.addEventListener("click", () => MazeGame.undo());
  hintBtn.addEventListener("click", () => MazeGame.useHint());

  resetBtn.addEventListener("click", () => {
    const state = MazeGame.getState();
    if (MazeGame.hasProgress() && !confirm("確定要放棄目前進度，重新開始一局新的關卡嗎？")) {
      return;
    }
    MazeGame.newGame(state ? state.difficulty : "easy");
  });

  backHomeBtn.addEventListener("click", () => {
    // No confirm needed: autosaves after every move, so "繼續上次遊戲"
    // always brings it back — matches every other game in this hub.
    renderHome();
    showView("home");
  });

  winCloseBtn.addEventListener("click", () => {
    const state = MazeGame.getState();
    MazeGame.newGame(state ? state.difficulty : "easy");
  });
  winHomeBtn.addEventListener("click", () => {
    winModal.classList.add("hidden");
    renderHome();
    showView("home");
  });

  document.addEventListener("keydown", (e) => {
    if (gameViewEl.classList.contains("hidden")) return;
    const state = MazeGame.getState();
    if (!state || state.status !== "playing") return;
    if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
      e.preventDefault();
      MazeGame.move("top");
    } else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
      e.preventDefault();
      MazeGame.move("bottom");
    } else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
      e.preventDefault();
      MazeGame.move("left");
    } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
      e.preventDefault();
      MazeGame.move("right");
    }
  });

  // -- boot -----------------------------------------------------------------
  MazeSound.setEnabled(MazeStorage.getSettings().soundEnabled !== false);
  MazeGame.onChange(render);
  applyTheme(GameHubStorage.getTheme());
  renderHome();
  showView("home");
})();
