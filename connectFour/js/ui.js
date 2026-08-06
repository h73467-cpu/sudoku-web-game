// The only file that touches the DOM. Renders state -> DOM and wires
// events. Mirrors the overall structure of the other games' ui.js, but the
// home view/toolbar/career views are shaped around this game's two modes
// (AI vs local two-player) instead of a single difficulty ladder.
(function () {
  const DIFFICULTY_LABELS = { easy: "簡單", medium: "中等", hard: "困難", expert: "專家" };
  const DIFFICULTY_ORDER = ["easy", "medium", "hard", "expert"];
  const SOUND_EVENTS = new Set(["drop", "invalid", "undo"]);

  // -- home view elements ---------------------------------------------------
  const homeViewEl = document.getElementById("homeView");
  const themeSelect = document.getElementById("themeSelect");
  const continueBtn = document.getElementById("continueBtn");
  const instructionsBtn = document.getElementById("instructionsBtn");
  const soundToggleBtn = document.getElementById("soundToggleBtn");
  const localModeBtn = document.getElementById("localModeBtn");
  const aiDifficultyButtons = Array.from(document.querySelectorAll(".ai-difficulty-btn"));
  const historyBtn = document.getElementById("historyBtn");
  const careerBtn = document.getElementById("careerBtn");

  // -- game view elements -----------------------------------------------------
  const gameViewEl = document.getElementById("gameView");
  const backHomeBtn = document.getElementById("backHomeBtn");
  const modeLabel = document.getElementById("modeLabel");
  const turnIndicator = document.getElementById("turnIndicator");
  const timerDisplay = document.getElementById("timerDisplay");
  const movesDisplay = document.getElementById("movesDisplay");
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
  const aiCareerTableBody = document.getElementById("aiCareerTableBody");
  const localCareerBody = document.getElementById("localCareerBody");

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
    return ConnectFourGame.hasProgress() || ConnectFourGame.hasSavedResumableGame();
  }

  function applySoundButtonState(btn, compact) {
    const on = ConnectFourSound.isEnabled();
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = compact ? (on ? "🔊" : "🔇") : on ? "🔊 音效：開" : "🔇 音效：關";
  }

  function toggleSound() {
    const next = !ConnectFourSound.isEnabled();
    ConnectFourSound.setEnabled(next);
    ConnectFourStorage.saveSettings({ soundEnabled: next });
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  // -- home view rendering ----------------------------------------------------
  function renderHome() {
    continueBtn.disabled = !ConnectFourGame.hasSavedResumableGame();
    themeSelect.value = GameHubStorage.getTheme();
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  function statRow(label, value) {
    return `<div class="win-stat-row"><span>${label}</span><span>${value}</span></div>`;
  }

  function modeResultLabel(entry) {
    const mode = entry.mode === "local" ? "本地雙人" : DIFFICULTY_LABELS[entry.difficulty] || entry.difficulty;
    const result =
      entry.status === "draw" ? "平手" : entry.mode === "ai" ? (entry.winner === 1 ? "獲勝" : "落敗") : entry.winner === 1 ? "紅方勝" : "黃方勝";
    return `${mode}　${result}`;
  }

  function renderHistory() {
    const items = ConnectFourStorage.getHistory();
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
        `<span class="record-tag">${modeResultLabel(entry)}　${date}</span>` +
        `<span>用時 ${ConnectFourGame.formatSeconds(entry.elapsedSeconds)}　步數 ${entry.moves}</span>`;
      frag.appendChild(row);
    });
    historyList.appendChild(frag);
  }

  function renderCareer() {
    const career = ConnectFourStorage.getCareer();
    aiCareerTableBody.innerHTML = "";
    const frag = document.createDocumentFragment();
    DIFFICULTY_ORDER.forEach((code) => {
      const entry = career.ai[code] || { wins: 0, losses: 0, draws: 0 };
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${DIFFICULTY_LABELS[code]}</td>` +
        `<td>${entry.wins}</td>` +
        `<td>${entry.losses}</td>` +
        `<td>${entry.draws}</td>`;
      frag.appendChild(tr);
    });
    aiCareerTableBody.appendChild(frag);

    const local = career.local || { redWins: 0, yellowWins: 0, draws: 0, gamesPlayed: 0 };
    localCareerBody.innerHTML =
      statRow("紅方勝場", local.redWins) +
      statRow("黃方勝場", local.yellowWins) +
      statRow("平手", local.draws) +
      statRow("總局數", local.gamesPlayed);
  }

  // -- game view rendering ------------------------------------------------
  function renderBoard(state) {
    const size = ConnectFourGame.getBoardSize();
    const winningSet = new Set(state.winningLine || []);
    const frag = document.createDocumentFragment();

    for (let c = 0; c < size.cols; c++) {
      const colBtn = document.createElement("button");
      colBtn.type = "button";
      colBtn.className = "c4-column";
      colBtn.dataset.col = String(c);
      const colFull = state.board[c] !== 0; // row0 of this column occupied => full
      colBtn.disabled = state.status !== "playing" || state.aiThinking || colFull;
      for (let r = 0; r < size.rows; r++) {
        const idx = r * size.cols + c;
        const v = state.board[idx];
        const cell = document.createElement("div");
        let cls = "c4-cell";
        if (v === 1) cls += " red";
        else if (v === 2) cls += " yellow";
        if (winningSet.has(idx)) cls += " winning";
        cell.className = cls;
        colBtn.appendChild(cell);
      }
      frag.appendChild(colBtn);
    }

    boardEl.innerHTML = "";
    boardEl.appendChild(frag);
  }

  function renderToolbar(state) {
    timerDisplay.textContent = ConnectFourGame.formatTime(ConnectFourGame.getElapsedMs());
    movesDisplay.textContent = String(state.moves);
    undoBtn.disabled = state.status !== "playing" || state.history.length === 0 || state.aiThinking;
    modeLabel.textContent =
      state.mode === "local" ? "本地雙人" : "對戰電腦・" + (DIFFICULTY_LABELS[state.difficulty] || state.difficulty);

    if (state.status === "won") {
      turnIndicator.textContent = state.winner === 1 ? "🔴 紅方獲勝！" : state.mode === "ai" ? "🤖 電腦獲勝" : "🟡 黃方獲勝！";
    } else if (state.status === "draw") {
      turnIndicator.textContent = "🤝 平手";
    } else if (state.aiThinking) {
      turnIndicator.textContent = "🤖 電腦思考中…";
    } else if (state.mode === "ai") {
      turnIndicator.textContent = state.currentPlayer === 1 ? "🔴 換你了" : "🤖 電腦回合";
    } else {
      turnIndicator.textContent = state.currentPlayer === 1 ? "🔴 紅方回合" : "🟡 黃方回合";
    }
  }

  function renderWinModal(state) {
    if (state.status !== "won" && state.status !== "draw") {
      winModal.classList.add("hidden");
      return;
    }
    if (state.status === "draw") {
      winTitle.textContent = "🤝 平手！";
      winSubtitle.textContent = state.mode === "local" ? "本地雙人" : "對戰電腦・" + (DIFFICULTY_LABELS[state.difficulty] || "");
    } else {
      const winnerText =
        state.mode === "ai" ? (state.winner === 1 ? "🎉 你贏了！" : "🤖 電腦獲勝") : state.winner === 1 ? "🔴 紅方獲勝！" : "🟡 黃方獲勝！";
      winTitle.textContent = winnerText;
      winSubtitle.textContent = state.mode === "local" ? "本地雙人" : "對戰電腦・" + (DIFFICULTY_LABELS[state.difficulty] || "");
    }
    winStats.innerHTML =
      statRow("花費時間", ConnectFourGame.formatTime(state.elapsedMs)) + statRow("總步數", String(state.moves));
    winModal.classList.remove("hidden");
  }

  function render(state, event) {
    if (SOUND_EVENTS.has(event)) ConnectFourSound.play(event);
    if (!state) return;
    if (event === "drop" && state.status === "won") ConnectFourSound.play("win");
    else if (event === "drop" && state.status === "draw") ConnectFourSound.play("draw");
    renderBoard(state);
    renderToolbar(state);
    renderWinModal(state);

    // Kick off the AI's reply one tick later so the "電腦思考中" indicator
    // actually paints first — minimax at higher difficulties is real
    // synchronous work (same reasoning as nonogram's generation deferral).
    if (state.aiThinking) {
      setTimeout(() => ConnectFourGame.runAiTurn(), 30);
    }
  }

  // -- home view interactions -----------------------------------------------
  continueBtn.addEventListener("click", () => {
    if (ConnectFourGame.resumeGame()) showView("game");
  });

  instructionsBtn.addEventListener("click", () => instructionsModal.classList.remove("hidden"));
  gameInstructionsBtn.addEventListener("click", () => instructionsModal.classList.remove("hidden"));
  instructionsCloseBtn.addEventListener("click", () => instructionsModal.classList.add("hidden"));

  soundToggleBtn.addEventListener("click", toggleSound);
  gameSoundToggleBtn.addEventListener("click", toggleSound);

  function startNewGame(mode, difficulty) {
    if (hasAnyProgressToLose() && !confirm("目前有進行中的對局，確定要開始新的一局嗎？進度將會遺失。")) {
      return;
    }
    ConnectFourGame.newGame(mode, difficulty);
    showView("game");
  }

  localModeBtn.addEventListener("click", () => startNewGame("local"));
  aiDifficultyButtons.forEach((btn) => {
    btn.addEventListener("click", () => startNewGame("ai", btn.dataset.difficulty));
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
    const btn = e.target.closest(".c4-column");
    if (!btn || btn.disabled) return;
    ConnectFourGame.playColumn(Number(btn.dataset.col));
  });

  undoBtn.addEventListener("click", () => ConnectFourGame.undo());

  resetBtn.addEventListener("click", () => {
    const state = ConnectFourGame.getState();
    if (ConnectFourGame.hasProgress() && !confirm("確定要放棄目前對局，重新開始新的一局嗎？")) {
      return;
    }
    ConnectFourGame.newGame(state ? state.mode : "local", state ? state.difficulty : undefined);
  });

  backHomeBtn.addEventListener("click", () => {
    // No confirm needed: autosaves after every move, so "繼續上次遊戲"
    // always brings it back — matches every other game in this hub.
    renderHome();
    showView("home");
  });

  winCloseBtn.addEventListener("click", () => {
    const state = ConnectFourGame.getState();
    ConnectFourGame.newGame(state ? state.mode : "local", state ? state.difficulty : undefined);
  });
  winHomeBtn.addEventListener("click", () => {
    winModal.classList.add("hidden");
    renderHome();
    showView("home");
  });

  document.addEventListener("keydown", (e) => {
    if (gameViewEl.classList.contains("hidden")) return;
    const state = ConnectFourGame.getState();
    if (!state || state.status !== "playing" || state.aiThinking) return;
    if (e.key >= "1" && e.key <= "7") {
      const col = Number(e.key) - 1;
      if (state.mode === "local" || state.currentPlayer === 1) ConnectFourGame.playColumn(col);
    }
  });

  // -- boot -----------------------------------------------------------------
  ConnectFourSound.setEnabled(ConnectFourStorage.getSettings().soundEnabled !== false);
  ConnectFourGame.onChange(render);
  applyTheme(GameHubStorage.getTheme());
  renderHome();
  showView("home");
})();
