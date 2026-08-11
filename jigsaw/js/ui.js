// The only file that touches the DOM. Renders state -> DOM and wires
// events. Mirrors the structure of fifteen/js/ui.js.
(function () {
  const DIFFICULTY_LABELS = {
    easy: "簡單",
    medium: "中等",
    hard: "困難",
    expert: "專家",
  };
  const DIFFICULTY_ORDER = ["easy", "medium", "hard", "expert"];
  const SOUND_EVENTS = new Set(["select", "swap", "undo"]);

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
  const bestMovesDisplay = document.getElementById("bestMovesDisplay");
  const movesDisplay = document.getElementById("movesDisplay");
  const undoBtn = document.getElementById("undoBtn");
  const resetBtn = document.getElementById("resetBtn");
  const gameSoundToggleBtn = document.getElementById("gameSoundToggleBtn");
  const gameInstructionsBtn = document.getElementById("gameInstructionsBtn");
  const boardEl = document.getElementById("board");
  const previewEl = document.getElementById("preview");

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

  const views = {
    home: homeViewEl,
    game: gameViewEl,
    history: historyViewEl,
    career: careerViewEl,
  };

  function showView(name) {
    Object.entries(views).forEach(([key, el]) => {
      el.classList.toggle("hidden", key !== name);
    });
  }

  function applyTheme(themeKey) {
    document.documentElement.dataset.theme = themeKey;
  }

  function hasAnyProgressToLose() {
    return JigsawGame.hasProgress() || JigsawGame.hasSavedResumableGame();
  }

  function applySoundButtonState(btn, compact) {
    const on = JigsawSound.isEnabled();
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = compact ? (on ? "🔊" : "🔇") : on ? "🔊 音效：開" : "🔇 音效：關";
  }

  function toggleSound() {
    const next = !JigsawSound.isEnabled();
    JigsawSound.setEnabled(next);
    JigsawStorage.saveSettings({ soundEnabled: next });
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  // -- home view rendering ----------------------------------------------------
  function renderHome() {
    continueBtn.disabled = !JigsawGame.hasSavedResumableGame();
    themeSelect.value = GameHubStorage.getTheme();
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  function statRow(label, value) {
    return `<div class="win-stat-row"><span>${label}</span><span>${value}</span></div>`;
  }

  function renderHistory() {
    const items = JigsawStorage.getHistory();
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
        `<span>用時 ${JigsawGame.formatSeconds(entry.elapsedSeconds)}　步數 ${entry.moves}</span>`;
      frag.appendChild(row);
    });
    historyList.appendChild(frag);
  }

  function renderCareer() {
    const career = JigsawStorage.getCareer();
    careerTableBody.innerHTML = "";
    const frag = document.createDocumentFragment();
    DIFFICULTY_ORDER.forEach((code) => {
      const entry = career[code] || { bestTime: null, bestMoves: null, won: 0 };
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${DIFFICULTY_LABELS[code]}</td>` +
        `<td>${JigsawGame.formatSeconds(entry.bestTime)}</td>` +
        `<td>${entry.bestMoves == null ? "--" : entry.bestMoves}</td>` +
        `<td>${entry.won}</td>`;
      frag.appendChild(tr);
    });
    careerTableBody.appendChild(frag);
  }

  // -- game view rendering ------------------------------------------------
  function renderBoard(state) {
    const rows = state.rows;
    const cols = state.cols;
    boardEl.style.setProperty("--cols", cols);
    boardEl.style.setProperty("--rows", rows);
    // Also set the literal computed value directly (not just the --cols/--rows
    // custom properties the CSS repeat(var(...)) rule reads) -- a browser that
    // doesn't support custom properties inside repeat()'s count position (pre-2021
    // engines) would otherwise silently fall back to a single column/row. Setting
    // the resolved string via inline style works unconditionally on any browser.
    boardEl.style.gridTemplateColumns = "repeat(" + cols + ", 1fr)";
    boardEl.style.gridTemplateRows = "repeat(" + rows + ", 1fr)";
    const image = JigsawImages.byId(state.imageId);
    const uri = JigsawImages.dataUri(image);

    previewEl.style.backgroundImage = `url("${uri}")`;

    const frag = document.createDocumentFragment();
    state.pieces.forEach((originIndex, displayIndex) => {
      const originRow = Math.floor(originIndex / cols);
      const originCol = originIndex % cols;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "jigsaw-piece" + (state.selectedIndex === displayIndex ? " selected" : "");
      btn.dataset.index = String(displayIndex);
      btn.disabled = state.status !== "playing";
      btn.style.backgroundImage = `url("${uri}")`;
      btn.style.backgroundSize = `${cols * 100}% ${rows * 100}%`;
      btn.style.backgroundPosition =
        cols > 1 && rows > 1
          ? `${(originCol / (cols - 1)) * 100}% ${(originRow / (rows - 1)) * 100}%`
          : "0% 0%";
      frag.appendChild(btn);
    });

    boardEl.innerHTML = "";
    boardEl.appendChild(frag);
  }

  function renderToolbar(state) {
    timerDisplay.textContent = JigsawGame.formatTime(JigsawGame.getElapsedMs());
    const career = JigsawStorage.getCareer();
    const entry = career[state.difficulty];
    bestMovesDisplay.textContent = entry && entry.bestMoves != null ? String(entry.bestMoves) : "--";
    movesDisplay.textContent = String(state.moves);
    undoBtn.disabled = state.status !== "playing" || state.history.length === 0;
    difficultyLabel.textContent = DIFFICULTY_LABELS[state.difficulty] || state.difficulty;
  }

  function renderWinModal(state) {
    if (state.status !== "won") {
      winModal.classList.add("hidden");
      return;
    }
    const isNewBest = state.justWon && state.justWon.isNewBest;
    winTitle.textContent = "🎉 完成！";
    winSubtitle.textContent = DIFFICULTY_LABELS[state.difficulty] || state.difficulty;
    winStats.innerHTML =
      statRow("花費時間", JigsawGame.formatTime(state.elapsedMs)) +
      statRow("交換次數", String(state.moves)) +
      (isNewBest ? statRow("紀錄", "🏆 新紀錄！") : "");
    winModal.classList.remove("hidden");
  }

  function render(state, event) {
    if (SOUND_EVENTS.has(event)) JigsawSound.play(event);
    if (!state) return;
    if (event === "swap" && state.status === "won") JigsawSound.play("win");
    if (event !== "tick") {
      renderBoard(state);
    }
    renderToolbar(state);
    renderWinModal(state);
  }

  // -- home view interactions -----------------------------------------------
  continueBtn.addEventListener("click", () => {
    if (JigsawGame.resumeGame()) showView("game");
  });

  instructionsBtn.addEventListener("click", () => {
    instructionsModal.classList.remove("hidden");
  });
  gameInstructionsBtn.addEventListener("click", () => {
    instructionsModal.classList.remove("hidden");
  });
  instructionsCloseBtn.addEventListener("click", () => {
    instructionsModal.classList.add("hidden");
  });

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
      JigsawGame.newGame(difficulty);
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
  boardEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".jigsaw-piece");
    if (!btn || btn.disabled) return;
    JigsawGame.selectCell(Number(btn.dataset.index));
  });

  undoBtn.addEventListener("click", () => {
    JigsawGame.undo();
  });

  resetBtn.addEventListener("click", () => {
    const state = JigsawGame.getState();
    if (
      JigsawGame.hasProgress() &&
      !confirm("確定要放棄目前進度，重新開始一局新的關卡嗎？")
    ) {
      return;
    }
    JigsawGame.newGame(state ? state.difficulty : "easy");
  });

  backHomeBtn.addEventListener("click", () => {
    // No confirm needed: like fifteen/klotski/sokoban, this autosaves after
    // every move, so "繼續上次遊戲" always brings it back.
    renderHome();
    showView("home");
  });

  winCloseBtn.addEventListener("click", () => {
    const state = JigsawGame.getState();
    JigsawGame.newGame(state ? state.difficulty : "easy");
  });

  winHomeBtn.addEventListener("click", () => {
    winModal.classList.add("hidden");
    renderHome();
    showView("home");
  });

  // -- boot -----------------------------------------------------------------
  JigsawSound.setEnabled(JigsawStorage.getSettings().soundEnabled !== false);
  JigsawGame.onChange(render);
  applyTheme(GameHubStorage.getTheme());
  renderHome();
  showView("home");
})();
