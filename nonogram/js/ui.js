// The only file that touches the DOM. Renders state -> DOM and wires
// events. Mirrors the structure of fifteen/js/ui.js.
(function () {
  const DIFFICULTY_LABELS = {
    superEasy: "超簡單",
    easy: "簡單",
    medium: "中等",
    hard: "困難",
    expert: "專家",
  };
  const DIFFICULTY_ORDER = ["superEasy", "easy", "medium", "hard", "expert"];
  const SOUND_EVENTS = new Set(["fill", "cross", "clear", "undo", "mode"]);

  // -- home view elements ---------------------------------------------------
  const homeViewEl = document.getElementById("homeView");
  const themeSelect = document.getElementById("themeSelect");
  const continueBtn = document.getElementById("continueBtn");
  const instructionsBtn = document.getElementById("instructionsBtn");
  const soundToggleBtn = document.getElementById("soundToggleBtn");
  const superEasyPercentInput = document.getElementById("superEasyPercent");
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
  const paintModeBtn = document.getElementById("paintModeBtn");
  const undoBtn = document.getElementById("undoBtn");
  const resetBtn = document.getElementById("resetBtn");
  const gameSoundToggleBtn = document.getElementById("gameSoundToggleBtn");
  const gameInstructionsBtn = document.getElementById("gameInstructionsBtn");
  const boardEl = document.getElementById("board");

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

  function clampPercent(x) {
    if (!Number.isFinite(x)) return 30;
    return Math.max(10, Math.min(90, Math.round(x)));
  }

  function hasAnyProgressToLose() {
    return NonogramGame.hasProgress() || NonogramGame.hasSavedResumableGame();
  }

  // Generation for larger boards (e.g. 專家 13x13) can take up to ~1s of
  // synchronous work (a real line-solver runs on every generated picture
  // until one is provably solvable without guessing — see game.js). Without
  // this, clicking a difficulty button would just hang with no feedback
  // until it's done. Painting a loading state first, then deferring the
  // actual generation a tick later, keeps the click feeling responsive.
  function startNewGame(difficulty) {
    showView("game");
    boardEl.innerHTML = '<div class="nono-loading">🧩 產生題目中…</div>';
    difficultyButtons.forEach((b) => (b.disabled = true));
    setTimeout(() => {
      NonogramGame.newGame(difficulty);
      difficultyButtons.forEach((b) => (b.disabled = false));
    }, 20);
  }

  function applySoundButtonState(btn, compact) {
    const on = NonogramSound.isEnabled();
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = compact ? (on ? "🔊" : "🔇") : on ? "🔊 音效：開" : "🔇 音效：關";
  }

  function toggleSound() {
    const next = !NonogramSound.isEnabled();
    NonogramSound.setEnabled(next);
    NonogramStorage.saveSettings({ soundEnabled: next });
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  // -- home view rendering ----------------------------------------------------
  function renderHome() {
    continueBtn.disabled = !NonogramGame.hasSavedResumableGame();
    const settings = NonogramStorage.getSettings();
    superEasyPercentInput.value = settings.superEasyPercent;
    themeSelect.value = GameHubStorage.getTheme();
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  function statRow(label, value) {
    return `<div class="win-stat-row"><span>${label}</span><span>${value}</span></div>`;
  }

  function renderHistory() {
    const items = NonogramStorage.getHistory();
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
        `<span>用時 ${NonogramGame.formatSeconds(entry.elapsedSeconds)}　步數 ${entry.moves}</span>`;
      frag.appendChild(row);
    });
    historyList.appendChild(frag);
  }

  function renderCareer() {
    const career = NonogramStorage.getCareer();
    careerTableBody.innerHTML = "";
    const frag = document.createDocumentFragment();
    DIFFICULTY_ORDER.forEach((code) => {
      const entry = career[code] || { bestTime: null, bestMoves: null, won: 0 };
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${DIFFICULTY_LABELS[code]}</td>` +
        `<td>${NonogramGame.formatSeconds(entry.bestTime)}</td>` +
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
    boardEl.style.setProperty("--cols", cols + 1);
    boardEl.style.setProperty("--rows", rows + 1);
    const frag = document.createDocumentFragment();

    const corner = document.createElement("div");
    corner.className = "nono-corner";
    frag.appendChild(corner);

    for (let c = 0; c < cols; c++) {
      const cell = document.createElement("div");
      cell.className = "nono-col-clue" + (NonogramGame.isColSatisfied(c) ? " satisfied" : "");
      cell.innerHTML = state.colClues[c].map((n) => `<span>${n}</span>`).join("");
      frag.appendChild(cell);
    }

    for (let r = 0; r < rows; r++) {
      const rowClueCell = document.createElement("div");
      rowClueCell.className = "nono-row-clue" + (NonogramGame.isRowSatisfied(r) ? " satisfied" : "");
      rowClueCell.textContent = state.rowClues[r].join(" ");
      frag.appendChild(rowClueCell);

      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const v = state.cells[idx];
        const btn = document.createElement("button");
        btn.type = "button";
        let cls = "nono-cell";
        if (v === 1) cls += " filled";
        else if (v === 2) cls += " crossed";
        btn.className = cls;
        btn.dataset.index = String(idx);
        btn.disabled = state.status !== "playing";
        if (v === 2) btn.textContent = "✕";
        frag.appendChild(btn);
      }
    }

    boardEl.innerHTML = "";
    boardEl.appendChild(frag);
  }

  function renderToolbar(state) {
    timerDisplay.textContent = NonogramGame.formatTime(NonogramGame.getElapsedMs());
    const career = NonogramStorage.getCareer();
    const entry = career[state.difficulty];
    bestMovesDisplay.textContent = entry && entry.bestMoves != null ? String(entry.bestMoves) : "--";
    movesDisplay.textContent = String(state.moves);
    undoBtn.disabled = state.status !== "playing" || state.history.length === 0;
    difficultyLabel.textContent = DIFFICULTY_LABELS[state.difficulty] || state.difficulty;
    paintModeBtn.textContent = state.paintMode === "cross" ? "✏️ 模式：打叉" : "✏️ 模式：塗黑";
    paintModeBtn.setAttribute("aria-pressed", state.paintMode === "cross" ? "true" : "false");
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
      statRow("花費時間", NonogramGame.formatTime(state.elapsedMs)) +
      statRow("操作次數", String(state.moves)) +
      (isNewBest ? statRow("紀錄", "🏆 新紀錄！") : "");
    winModal.classList.remove("hidden");
  }

  function render(state, event) {
    if (SOUND_EVENTS.has(event)) NonogramSound.play(event);
    if (!state) return;
    if ((event === "fill" || event === "clear") && state.status === "won") NonogramSound.play("win");
    if (event !== "tick") {
      renderBoard(state);
    }
    renderToolbar(state);
    renderWinModal(state);
  }

  // -- home view interactions -----------------------------------------------
  continueBtn.addEventListener("click", () => {
    if (NonogramGame.resumeGame()) showView("game");
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
      if (difficulty === "superEasy") {
        const x = clampPercent(Number(superEasyPercentInput.value));
        superEasyPercentInput.value = x;
        NonogramStorage.saveSettings({ superEasyPercent: x });
      }
      startNewGame(difficulty);
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
    const btn = e.target.closest(".nono-cell");
    if (!btn || btn.disabled) return;
    NonogramGame.toggleCell(Number(btn.dataset.index));
  });

  paintModeBtn.addEventListener("click", () => {
    NonogramGame.togglePaintMode();
  });

  undoBtn.addEventListener("click", () => {
    NonogramGame.undo();
  });

  resetBtn.addEventListener("click", () => {
    const state = NonogramGame.getState();
    if (
      NonogramGame.hasProgress() &&
      !confirm("確定要放棄目前進度，重新開始一局新的關卡嗎？")
    ) {
      return;
    }
    startNewGame(state ? state.difficulty : "superEasy");
  });

  backHomeBtn.addEventListener("click", () => {
    // No confirm needed: like fifteen/klotski/sokoban, this autosaves after
    // every move, so "繼續上次遊戲" always brings it back.
    renderHome();
    showView("home");
  });

  winCloseBtn.addEventListener("click", () => {
    const state = NonogramGame.getState();
    startNewGame(state ? state.difficulty : "superEasy");
  });

  winHomeBtn.addEventListener("click", () => {
    winModal.classList.add("hidden");
    renderHome();
    showView("home");
  });

  document.addEventListener("keydown", (e) => {
    if (gameViewEl.classList.contains("hidden")) return;
    const state = NonogramGame.getState();
    if (!state || state.status !== "playing") return;
    if (e.key === "x" || e.key === "X" || e.key === " ") {
      e.preventDefault();
      NonogramGame.togglePaintMode();
    } else if (e.key.toLowerCase() === "z" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      NonogramGame.undo();
    }
  });

  // -- boot -----------------------------------------------------------------
  NonogramSound.setEnabled(NonogramStorage.getSettings().soundEnabled !== false);
  NonogramGame.onChange(render);
  applyTheme(GameHubStorage.getTheme());
  renderHome();
  showView("home");
})();
