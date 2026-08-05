// The only file that touches the DOM. Renders state -> DOM and wires
// events. Mirrors the structure of sudoku/js/ui.js.
(function () {
  const DIFFICULTY_LABELS = {
    superEasy: "超簡單",
    easy: "簡單",
    medium: "中等",
    hard: "困難",
    expert: "專家",
  };
  const DIFFICULTY_ORDER = ["superEasy", "easy", "medium", "hard", "expert"];
  const PIECE_LABELS = { caocao: "曹", general: "將", soldier: "兵" };
  const SOUND_EVENTS = new Set(["select", "move", "invalid", "undo"]);

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
  const undoBtn = document.getElementById("undoBtn");
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
    return KlotskiGame.hasProgress() || KlotskiGame.hasSavedResumableGame();
  }

  function applySoundButtonState(btn, compact) {
    const on = KlotskiSound.isEnabled();
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = compact ? (on ? "🔊" : "🔇") : on ? "🔊 音效：開" : "🔇 音效：關";
  }

  function toggleSound() {
    const next = !KlotskiSound.isEnabled();
    KlotskiSound.setEnabled(next);
    KlotskiStorage.saveSettings({ soundEnabled: next });
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  // -- home view rendering ----------------------------------------------------
  function renderHome() {
    continueBtn.disabled = !KlotskiGame.hasSavedResumableGame();
    const settings = KlotskiStorage.getSettings();
    superEasyPercentInput.value = settings.superEasyPercent;
    themeSelect.value = GameHubStorage.getTheme();
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  function statRow(label, value) {
    return `<div class="win-stat-row"><span>${label}</span><span>${value}</span></div>`;
  }

  function renderHistory() {
    const items = KlotskiStorage.getHistory();
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
        `<span>用時 ${KlotskiGame.formatSeconds(entry.elapsedSeconds)}　步數 ${entry.moves}</span>`;
      frag.appendChild(row);
    });
    historyList.appendChild(frag);
  }

  function renderCareer() {
    const career = KlotskiStorage.getCareer();
    careerTableBody.innerHTML = "";
    const frag = document.createDocumentFragment();
    DIFFICULTY_ORDER.forEach((code) => {
      const entry = career[code] || { bestTime: null, bestMoves: null, won: 0 };
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${DIFFICULTY_LABELS[code]}</td>` +
        `<td>${KlotskiGame.formatSeconds(entry.bestTime)}</td>` +
        `<td>${entry.bestMoves == null ? "--" : entry.bestMoves}</td>` +
        `<td>${entry.won}</td>`;
      frag.appendChild(tr);
    });
    careerTableBody.appendChild(frag);
  }

  // -- game view rendering ------------------------------------------------
  function buildOccupancy(pieces, rows, cols) {
    const grid = new Array(rows * cols).fill(null);
    pieces.forEach((p) => {
      for (let r = p.row; r < p.row + p.rowSpan; r++) {
        for (let c = p.col; c < p.col + p.colSpan; c++) grid[r * cols + c] = p.id;
      }
    });
    return grid;
  }

  function renderBoard(state) {
    const size = KlotskiGame.getBoardSize();
    const frag = document.createDocumentFragment();

    const exitEl = document.createElement("div");
    exitEl.className = "klotski-exit-marker";
    exitEl.style.gridRow = size.rows + " / span 1";
    exitEl.style.gridColumn = size.exitCol + 1 + " / span 2";
    exitEl.textContent = "🚪 出口";
    frag.appendChild(exitEl);

    const grid = buildOccupancy(state.pieces, size.rows, size.cols);
    for (let r = 0; r < size.rows; r++) {
      for (let c = 0; c < size.cols; c++) {
        if (grid[r * size.cols + c] == null) {
          const cell = document.createElement("button");
          cell.type = "button";
          cell.className = "klotski-empty-cell";
          cell.style.gridRow = r + 1 + " / span 1";
          cell.style.gridColumn = c + 1 + " / span 1";
          cell.dataset.row = String(r);
          cell.dataset.col = String(c);
          cell.disabled = state.status !== "playing";
          frag.appendChild(cell);
        }
      }
    }

    state.pieces.forEach((piece) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "klotski-piece " + piece.type + (state.selectedPieceId === piece.id ? " selected" : "");
      btn.style.gridRow = piece.row + 1 + " / span " + piece.rowSpan;
      btn.style.gridColumn = piece.col + 1 + " / span " + piece.colSpan;
      btn.dataset.pieceId = piece.id;
      btn.disabled = state.status !== "playing";
      btn.textContent = PIECE_LABELS[piece.type];
      frag.appendChild(btn);
    });

    boardEl.innerHTML = "";
    boardEl.appendChild(frag);
  }

  function renderToolbar(state) {
    timerDisplay.textContent = KlotskiGame.formatTime(KlotskiGame.getElapsedMs());
    const career = KlotskiStorage.getCareer();
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
    winTitle.textContent = "🎉 過關！";
    winSubtitle.textContent = DIFFICULTY_LABELS[state.difficulty] || state.difficulty;
    winStats.innerHTML =
      statRow("花費時間", KlotskiGame.formatTime(state.elapsedMs)) +
      statRow("移動步數", String(state.moves)) +
      (isNewBest ? statRow("紀錄", "🏆 新紀錄！") : "");
    winModal.classList.remove("hidden");
  }

  function render(state, event) {
    if (SOUND_EVENTS.has(event)) KlotskiSound.play(event);
    if (!state) return;
    if (event === "move" && state.status === "won") KlotskiSound.play("win");
    if (event !== "tick") {
      renderBoard(state);
    }
    renderToolbar(state);
    renderWinModal(state);
  }

  // -- home view interactions -----------------------------------------------
  continueBtn.addEventListener("click", () => {
    if (KlotskiGame.resumeGame()) showView("game");
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
        KlotskiStorage.saveSettings({ superEasyPercent: x });
      }
      KlotskiGame.newGame(difficulty);
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
    const pieceBtn = e.target.closest(".klotski-piece");
    if (pieceBtn && !pieceBtn.disabled) {
      KlotskiGame.selectPiece(pieceBtn.dataset.pieceId);
      return;
    }
    const emptyBtn = e.target.closest(".klotski-empty-cell");
    if (emptyBtn && !emptyBtn.disabled) {
      KlotskiGame.moveSelectedToward(Number(emptyBtn.dataset.row), Number(emptyBtn.dataset.col));
    }
  });

  undoBtn.addEventListener("click", () => {
    KlotskiGame.undo();
  });

  backHomeBtn.addEventListener("click", () => {
    // No confirm needed: unlike breakout's real-time round, klotski
    // autosaves after every move, so "繼續上次遊戲" always brings it back.
    renderHome();
    showView("home");
  });

  winCloseBtn.addEventListener("click", () => {
    const state = KlotskiGame.getState();
    KlotskiGame.newGame(state ? state.difficulty : "superEasy");
  });

  winHomeBtn.addEventListener("click", () => {
    winModal.classList.add("hidden");
    renderHome();
    showView("home");
  });

  document.addEventListener("keydown", (e) => {
    if (gameViewEl.classList.contains("hidden")) return;
    const state = KlotskiGame.getState();
    if (!state || state.status !== "playing") return;

    if (e.key === "ArrowUp") {
      e.preventDefault();
      KlotskiGame.moveBy(-1, 0);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      KlotskiGame.moveBy(1, 0);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      KlotskiGame.moveBy(0, -1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      KlotskiGame.moveBy(0, 1);
    }
  });

  // -- boot -----------------------------------------------------------------
  KlotskiSound.setEnabled(KlotskiStorage.getSettings().soundEnabled !== false);
  KlotskiGame.onChange(render);
  applyTheme(GameHubStorage.getTheme());
  renderHome();
  showView("home");
})();
