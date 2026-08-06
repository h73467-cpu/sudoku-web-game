// The only file that touches the DOM. Renders state -> DOM and wires
// events. Mirrors the structure of klotski/js/ui.js.
(function () {
  const DIFFICULTY_LABELS = {
    easy: "簡單",
    medium: "中等",
    hard: "困難",
    expert: "專家",
  };
  const DIFFICULTY_ORDER = ["easy", "medium", "hard", "expert"];
  const SOUND_EVENTS = new Set(["move", "push", "invalid", "undo"]);

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
    return SokobanGame.hasProgress() || SokobanGame.hasSavedResumableGame();
  }

  function applySoundButtonState(btn, compact) {
    const on = SokobanSound.isEnabled();
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = compact ? (on ? "🔊" : "🔇") : on ? "🔊 音效：開" : "🔇 音效：關";
  }

  function toggleSound() {
    const next = !SokobanSound.isEnabled();
    SokobanSound.setEnabled(next);
    SokobanStorage.saveSettings({ soundEnabled: next });
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  // -- home view rendering ----------------------------------------------------
  function renderHome() {
    continueBtn.disabled = !SokobanGame.hasSavedResumableGame();
    themeSelect.value = GameHubStorage.getTheme();
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  function statRow(label, value) {
    return `<div class="win-stat-row"><span>${label}</span><span>${value}</span></div>`;
  }

  function renderHistory() {
    const items = SokobanStorage.getHistory();
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
        `<span>用時 ${SokobanGame.formatSeconds(entry.elapsedSeconds)}　步數 ${entry.moves}</span>`;
      frag.appendChild(row);
    });
    historyList.appendChild(frag);
  }

  function renderCareer() {
    const career = SokobanStorage.getCareer();
    careerTableBody.innerHTML = "";
    const frag = document.createDocumentFragment();
    DIFFICULTY_ORDER.forEach((code) => {
      const entry = career[code] || { bestTime: null, bestMoves: null, won: 0 };
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${DIFFICULTY_LABELS[code]}</td>` +
        `<td>${SokobanGame.formatSeconds(entry.bestTime)}</td>` +
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
    const frag = document.createDocumentFragment();
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.cols; c++) {
        const cell = document.createElement("div");
        const wall = SokobanGame.isWallCell(r, c);
        const target = SokobanGame.isTargetAt(r, c);
        const box = SokobanGame.isBoxAt(r, c);
        const player = state.player.row === r && state.player.col === c;
        let cls = "sokoban-cell";
        if (wall) cls += " wall";
        else if (target) cls += " target" + (box ? " box-on-target" : "");
        else cls += " floor";
        cell.className = cls;
        let icon = "";
        if (player) icon = "🧑";
        else if (box) icon = "📦";
        if (icon) cell.innerHTML = `<span class="cell-icon">${icon}</span>`;
        frag.appendChild(cell);
      }
    }
    boardEl.innerHTML = "";
    boardEl.appendChild(frag);
  }

  function renderToolbar(state) {
    timerDisplay.textContent = SokobanGame.formatTime(SokobanGame.getElapsedMs());
    const career = SokobanStorage.getCareer();
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
      statRow("花費時間", SokobanGame.formatTime(state.elapsedMs)) +
      statRow("移動步數", String(state.moves)) +
      (isNewBest ? statRow("紀錄", "🏆 新紀錄！") : "");
    winModal.classList.remove("hidden");
  }

  function render(state, event) {
    if (SOUND_EVENTS.has(event)) SokobanSound.play(event);
    if (!state) return;
    if (event === "push" && state.status === "won") SokobanSound.play("win");
    if (event !== "tick") {
      renderBoard(state);
    }
    renderToolbar(state);
    renderWinModal(state);
  }

  // -- home view interactions -----------------------------------------------
  continueBtn.addEventListener("click", () => {
    if (SokobanGame.resumeGame()) showView("game");
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
      SokobanGame.newGame(difficulty);
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
  undoBtn.addEventListener("click", () => {
    SokobanGame.undo();
  });

  resetBtn.addEventListener("click", () => {
    const state = SokobanGame.getState();
    if (
      SokobanGame.hasProgress() &&
      !confirm("確定要放棄目前進度，重新開始一局新的關卡嗎？")
    ) {
      return;
    }
    SokobanGame.newGame(state ? state.difficulty : "easy");
  });

  backHomeBtn.addEventListener("click", () => {
    // No confirm needed: like klotski, sokoban autosaves after every move,
    // so "繼續上次遊戲" always brings it back.
    renderHome();
    showView("home");
  });

  dpadUp.addEventListener("click", () => SokobanGame.move(-1, 0));
  dpadDown.addEventListener("click", () => SokobanGame.move(1, 0));
  dpadLeft.addEventListener("click", () => SokobanGame.move(0, -1));
  dpadRight.addEventListener("click", () => SokobanGame.move(0, 1));

  winCloseBtn.addEventListener("click", () => {
    const state = SokobanGame.getState();
    SokobanGame.newGame(state ? state.difficulty : "easy");
  });

  winHomeBtn.addEventListener("click", () => {
    winModal.classList.add("hidden");
    renderHome();
    showView("home");
  });

  document.addEventListener("keydown", (e) => {
    if (gameViewEl.classList.contains("hidden")) return;
    const state = SokobanGame.getState();
    if (!state || state.status !== "playing") return;

    if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
      e.preventDefault();
      SokobanGame.move(-1, 0);
    } else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
      e.preventDefault();
      SokobanGame.move(1, 0);
    } else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
      e.preventDefault();
      SokobanGame.move(0, -1);
    } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
      e.preventDefault();
      SokobanGame.move(0, 1);
    }
  });

  // -- boot -----------------------------------------------------------------
  SokobanSound.setEnabled(SokobanStorage.getSettings().soundEnabled !== false);
  SokobanGame.onChange(render);
  applyTheme(GameHubStorage.getTheme());
  renderHome();
  showView("home");
})();
