// The only file that touches the DOM. Renders state -> DOM and wires
// events. Mirrors the structure of jigsaw/js/ui.js (the other click-to-
// select grid game).
(function () {
  const DIFFICULTY_LABELS = { easy: "簡單", medium: "中等", hard: "困難", expert: "專家" };
  const DIFFICULTY_ORDER = ["easy", "medium", "hard", "expert"];
  const SOUND_EVENTS = new Set(["select", "match", "invalid", "hint", "undo", "reshuffle"]);

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
  const hintCountEl = document.getElementById("hintCount");
  const hintBtn = document.getElementById("hintBtn");
  const undoBtn = document.getElementById("undoBtn");
  const reshuffleBtn = document.getElementById("reshuffleBtn");
  const resetBtn = document.getElementById("resetBtn");
  const gameSoundToggleBtn = document.getElementById("gameSoundToggleBtn");
  const gameInstructionsBtn = document.getElementById("gameInstructionsBtn");
  const boardEl = document.getElementById("board");
  const deadlockNotice = document.getElementById("deadlockNotice");

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
    return LianliankanGame.hasProgress() || LianliankanGame.hasSavedResumableGame();
  }

  function applySoundButtonState(btn, compact) {
    const on = LianliankanSound.isEnabled();
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = compact ? (on ? "🔊" : "🔇") : on ? "🔊 音效：開" : "🔇 音效：關";
  }

  function toggleSound() {
    const next = !LianliankanSound.isEnabled();
    LianliankanSound.setEnabled(next);
    LianliankanStorage.saveSettings({ soundEnabled: next });
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  // -- home view rendering ----------------------------------------------------
  function renderHome() {
    continueBtn.disabled = !LianliankanGame.hasSavedResumableGame();
    themeSelect.value = GameHubStorage.getTheme();
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  function statRow(label, value) {
    return `<div class="win-stat-row"><span>${label}</span><span>${value}</span></div>`;
  }

  function renderHistory() {
    const items = LianliankanStorage.getHistory();
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
        `<span>用時 ${LianliankanGame.formatSeconds(entry.elapsedSeconds)}　配對 ${entry.moves}</span>`;
      frag.appendChild(row);
    });
    historyList.appendChild(frag);
  }

  function renderCareer() {
    const career = LianliankanStorage.getCareer();
    careerTableBody.innerHTML = "";
    const frag = document.createDocumentFragment();
    DIFFICULTY_ORDER.forEach((code) => {
      const entry = career[code] || { bestTime: null, bestMoves: null, won: 0 };
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${DIFFICULTY_LABELS[code]}</td>` +
        `<td>${LianliankanGame.formatSeconds(entry.bestTime)}</td>` +
        `<td>${entry.bestMoves == null ? "--" : entry.bestMoves}</td>` +
        `<td>${entry.won}</td>`;
      frag.appendChild(tr);
    });
    careerTableBody.appendChild(frag);
  }

  // -- game view rendering ------------------------------------------------
  function renderBoard(state) {
    const size = LianliankanGame.getBoardSize();
    boardEl.style.setProperty("--cols", size.cols);
    boardEl.style.setProperty("--rows", size.rows);
    const hintSet = new Set(state.hintPair || []);

    const frag = document.createDocumentFragment();
    state.tiles.forEach((icon, index) => {
      if (icon === -1) {
        const blank = document.createElement("div");
        blank.className = "llk-blank";
        frag.appendChild(blank);
        return;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      let cls = "llk-tile";
      if (state.selectedIndex === index) cls += " selected";
      if (hintSet.has(index)) cls += " hint";
      btn.className = cls;
      btn.dataset.index = String(index);
      btn.disabled = state.status !== "playing";
      btn.textContent = LianliankanGame.ICON_POOL ? LianliankanGame.ICON_POOL[icon] : "";
      frag.appendChild(btn);
    });

    boardEl.innerHTML = "";
    boardEl.appendChild(frag);
  }

  function renderToolbar(state) {
    timerDisplay.textContent = LianliankanGame.formatTime(LianliankanGame.getElapsedMs());
    movesDisplay.textContent = String(state.moves);
    const maxHints = LianliankanGame.getMaxHints();
    hintCountEl.textContent = String(maxHints - state.hintsUsed);
    hintBtn.disabled = state.status !== "playing" || state.hintsUsed >= maxHints;
    undoBtn.disabled = state.status !== "playing" || state.history.length === 0;
    reshuffleBtn.disabled = state.status !== "playing";
    difficultyLabel.textContent = DIFFICULTY_LABELS[state.difficulty] || state.difficulty;

    if (state.status === "playing" && !LianliankanGame.hasAnyValidMove()) {
      deadlockNotice.classList.remove("hidden");
    } else {
      deadlockNotice.classList.add("hidden");
    }
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
      statRow("花費時間", LianliankanGame.formatTime(state.elapsedMs)) +
      statRow("配對次數", String(state.moves)) +
      (isNewBest ? statRow("紀錄", "🏆 新紀錄！") : "");
    winModal.classList.remove("hidden");
  }

  function render(state, event) {
    if (SOUND_EVENTS.has(event)) LianliankanSound.play(event);
    if (!state) return;
    if (event === "match" && state.status === "won") LianliankanSound.play("win");
    renderBoard(state);
    renderToolbar(state);
    renderWinModal(state);
  }

  // -- home view interactions -----------------------------------------------
  continueBtn.addEventListener("click", () => {
    if (LianliankanGame.resumeGame()) showView("game");
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
      LianliankanGame.newGame(difficulty);
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
    const btn = e.target.closest(".llk-tile");
    if (!btn || btn.disabled) return;
    LianliankanGame.selectCell(Number(btn.dataset.index));
  });

  hintBtn.addEventListener("click", () => LianliankanGame.useHint());
  undoBtn.addEventListener("click", () => LianliankanGame.undo());
  reshuffleBtn.addEventListener("click", () => LianliankanGame.reshuffle());

  resetBtn.addEventListener("click", () => {
    const state = LianliankanGame.getState();
    if (
      LianliankanGame.hasProgress() &&
      !confirm("確定要放棄目前進度，重新開始一局新的關卡嗎？")
    ) {
      return;
    }
    LianliankanGame.newGame(state ? state.difficulty : "easy");
  });

  backHomeBtn.addEventListener("click", () => {
    // No confirm needed: autosaves after every move, so "繼續上次遊戲"
    // always brings it back — matches every other game in this hub.
    renderHome();
    showView("home");
  });

  winCloseBtn.addEventListener("click", () => {
    const state = LianliankanGame.getState();
    LianliankanGame.newGame(state ? state.difficulty : "easy");
  });
  winHomeBtn.addEventListener("click", () => {
    winModal.classList.add("hidden");
    renderHome();
    showView("home");
  });

  // -- boot -----------------------------------------------------------------
  LianliankanSound.setEnabled(LianliankanStorage.getSettings().soundEnabled !== false);
  LianliankanGame.onChange(render);
  applyTheme(GameHubStorage.getTheme());
  renderHome();
  showView("home");
})();
