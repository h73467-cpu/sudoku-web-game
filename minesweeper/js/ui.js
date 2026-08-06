// The only file that touches the DOM. Renders state -> DOM and wires
// events. Mirrors nonogram/js/ui.js's fill/cross-mode-toggle pattern
// (here: reveal/flag mode), since Minesweeper needs the same two-mode tap
// interaction and this hub avoids right-click/long-press for touch
// reliability.
(function () {
  const DIFFICULTY_LABELS = { superEasy: "超簡單", easy: "簡單", medium: "中等", hard: "困難", expert: "專家" };
  const DIFFICULTY_ORDER = ["superEasy", "easy", "medium", "hard", "expert"];
  const SOUND_EVENTS = new Set(["reveal", "flag", "mode", "invalid", "boom"]);
  const NUMBER_CLASS = ["", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8"];

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
  const flagsDisplay = document.getElementById("flagsDisplay");
  const paintModeBtn = document.getElementById("paintModeBtn");
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

  const views = { home: homeViewEl, game: gameViewEl, history: historyViewEl, career: careerViewEl };

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
    return MinesweeperGame.hasProgress() || MinesweeperGame.hasSavedResumableGame();
  }

  function applySoundButtonState(btn, compact) {
    const on = MinesweeperSound.isEnabled();
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = compact ? (on ? "🔊" : "🔇") : on ? "🔊 音效：開" : "🔇 音效：關";
  }

  function toggleSound() {
    const next = !MinesweeperSound.isEnabled();
    MinesweeperSound.setEnabled(next);
    MinesweeperStorage.saveSettings({ soundEnabled: next });
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  // -- home view rendering ----------------------------------------------------
  function renderHome() {
    continueBtn.disabled = !MinesweeperGame.hasSavedResumableGame();
    const settings = MinesweeperStorage.getSettings();
    superEasyPercentInput.value = settings.superEasyPercent;
    themeSelect.value = GameHubStorage.getTheme();
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  function statRow(label, value) {
    return `<div class="win-stat-row"><span>${label}</span><span>${value}</span></div>`;
  }

  function renderHistory() {
    const items = MinesweeperStorage.getHistory();
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
      const result = entry.status === "won" ? "過關" : "踩到地雷";
      row.innerHTML =
        `<span class="record-tag">${label}　${result}　${date}</span>` +
        `<span>用時 ${MinesweeperGame.formatSeconds(entry.elapsedSeconds)}</span>`;
      frag.appendChild(row);
    });
    historyList.appendChild(frag);
  }

  function renderCareer() {
    const career = MinesweeperStorage.getCareer();
    careerTableBody.innerHTML = "";
    const frag = document.createDocumentFragment();
    DIFFICULTY_ORDER.forEach((code) => {
      const entry = career[code] || { bestTime: null, won: 0 };
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${DIFFICULTY_LABELS[code]}</td>` +
        `<td>${MinesweeperGame.formatSeconds(entry.bestTime)}</td>` +
        `<td>${entry.won}</td>`;
      frag.appendChild(tr);
    });
    careerTableBody.appendChild(frag);
  }

  // -- game view rendering ------------------------------------------------
  function renderBoard(state) {
    const size = MinesweeperGame.getBoardSize();
    boardEl.style.setProperty("--cols", size.cols);
    boardEl.style.setProperty("--rows", size.rows);

    const frag = document.createDocumentFragment();
    for (let i = 0; i < size.rows * size.cols; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.index = String(i);
      const revealed = state.revealed[i];
      const isMine = state.mines[i];
      let cls = "ms-cell";
      if (revealed) {
        cls += " revealed";
        if (isMine) cls += " mine";
      } else if (state.flagged[i]) {
        cls += " flagged";
      }
      btn.className = cls;
      btn.disabled = state.status !== "playing" || revealed;
      if (revealed) {
        if (isMine) {
          btn.textContent = "💣";
        } else if (state.adjacent[i] > 0) {
          btn.textContent = String(state.adjacent[i]);
          btn.classList.add(NUMBER_CLASS[state.adjacent[i]]);
        }
      } else if (state.flagged[i]) {
        btn.textContent = "🚩";
      }
      frag.appendChild(btn);
    }

    boardEl.innerHTML = "";
    boardEl.appendChild(frag);
  }

  function renderToolbar(state) {
    timerDisplay.textContent = MinesweeperGame.formatTime(MinesweeperGame.getElapsedMs());
    flagsDisplay.textContent = String(MinesweeperGame.getFlagsRemaining());
    difficultyLabel.textContent = DIFFICULTY_LABELS[state.difficulty] || state.difficulty;
    paintModeBtn.textContent = state.paintMode === "flag" ? "🚩 模式：插旗" : "⛏️ 模式：翻開";
    paintModeBtn.setAttribute("aria-pressed", state.paintMode === "flag" ? "true" : "false");
  }

  function renderWinModal(state) {
    if (state.status !== "won" && state.status !== "lost") {
      winModal.classList.add("hidden");
      return;
    }
    if (state.status === "lost") {
      winTitle.textContent = "💥 踩到地雷了";
      winSubtitle.textContent = DIFFICULTY_LABELS[state.difficulty] || state.difficulty;
      winStats.innerHTML = statRow("花費時間", MinesweeperGame.formatTime(state.elapsedMs));
      winCloseBtn.textContent = "再試一次";
    } else {
      const isNewBest = state.justWon && state.justWon.isNewBest;
      winTitle.textContent = "🎉 過關！";
      winSubtitle.textContent = DIFFICULTY_LABELS[state.difficulty] || state.difficulty;
      winStats.innerHTML =
        statRow("花費時間", MinesweeperGame.formatTime(state.elapsedMs)) +
        (isNewBest ? statRow("紀錄", "🏆 新紀錄！") : "");
      winCloseBtn.textContent = "新遊戲";
    }
    winModal.classList.remove("hidden");
  }

  function render(state, event) {
    if (SOUND_EVENTS.has(event)) MinesweeperSound.play(event);
    if (!state) return;
    if (event === "reveal" && state.status === "won") MinesweeperSound.play("win");
    renderBoard(state);
    renderToolbar(state);
    renderWinModal(state);
  }

  // -- home view interactions -----------------------------------------------
  continueBtn.addEventListener("click", () => {
    if (MinesweeperGame.resumeGame()) showView("game");
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
      if (difficulty === "superEasy") {
        const x = clampPercent(Number(superEasyPercentInput.value));
        superEasyPercentInput.value = x;
        MinesweeperStorage.saveSettings({ superEasyPercent: x });
      }
      MinesweeperGame.newGame(difficulty);
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
    const btn = e.target.closest(".ms-cell");
    if (!btn || btn.disabled) return;
    MinesweeperGame.tapCell(Number(btn.dataset.index));
  });

  paintModeBtn.addEventListener("click", () => MinesweeperGame.togglePaintMode());

  resetBtn.addEventListener("click", () => {
    const state = MinesweeperGame.getState();
    if (MinesweeperGame.hasProgress() && !confirm("確定要放棄目前進度，重新開始一局新的關卡嗎？")) {
      return;
    }
    MinesweeperGame.newGame(state ? state.difficulty : "easy");
  });

  backHomeBtn.addEventListener("click", () => {
    // No confirm needed: autosaves after every move, so "繼續上次遊戲"
    // always brings it back — matches every other game in this hub.
    renderHome();
    showView("home");
  });

  winCloseBtn.addEventListener("click", () => {
    const state = MinesweeperGame.getState();
    MinesweeperGame.newGame(state ? state.difficulty : "easy");
  });
  winHomeBtn.addEventListener("click", () => {
    winModal.classList.add("hidden");
    renderHome();
    showView("home");
  });

  // -- boot -----------------------------------------------------------------
  MinesweeperSound.setEnabled(MinesweeperStorage.getSettings().soundEnabled !== false);
  MinesweeperGame.onChange(render);
  applyTheme(GameHubStorage.getTheme());
  renderHome();
  showView("home");
})();
