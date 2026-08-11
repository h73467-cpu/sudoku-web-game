// The only file that touches the DOM. Renders state -> DOM and wires
// events. Mirrors connectFour/js/ui.js's overall structure (the other
// adversarial two-player game), adapted for othello's board/legal-move-dot
// rendering and black/white terminology instead of red/yellow columns.
(function () {
  const DIFFICULTY_LABELS = { easy: "簡單", medium: "中等", hard: "困難", expert: "專家" };
  const DIFFICULTY_ORDER = ["easy", "medium", "hard", "expert"];
  const SOUND_EVENTS = new Set(["place", "invalid", "undo", "pass"]);

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
  const scoreDisplay = document.getElementById("scoreDisplay");
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
    return OthelloGame.hasProgress() || OthelloGame.hasSavedResumableGame();
  }

  function applySoundButtonState(btn, compact) {
    const on = OthelloSound.isEnabled();
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = compact ? (on ? "🔊" : "🔇") : on ? "🔊 音效：開" : "🔇 音效：關";
  }

  function toggleSound() {
    const next = !OthelloSound.isEnabled();
    OthelloSound.setEnabled(next);
    OthelloStorage.saveSettings({ soundEnabled: next });
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  // -- home view rendering ----------------------------------------------------
  function renderHome() {
    continueBtn.disabled = !OthelloGame.hasSavedResumableGame();
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
      entry.status === "draw" ? "平手" : entry.mode === "ai" ? (entry.winner === 1 ? "獲勝" : "落敗") : entry.winner === 1 ? "黑方勝" : "白方勝";
    return `${mode}　${result}`;
  }

  function renderHistory() {
    const items = OthelloStorage.getHistory();
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
        `<span>比分 ${entry.black}:${entry.white}　用時 ${OthelloGame.formatSeconds(entry.elapsedSeconds)}</span>`;
      frag.appendChild(row);
    });
    historyList.appendChild(frag);
  }

  function renderCareer() {
    const career = OthelloStorage.getCareer();
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

    const local = career.local || { blackWins: 0, whiteWins: 0, draws: 0, gamesPlayed: 0 };
    localCareerBody.innerHTML =
      statRow("黑方勝場", local.blackWins) +
      statRow("白方勝場", local.whiteWins) +
      statRow("平手", local.draws) +
      statRow("總局數", local.gamesPlayed);
  }

  // -- game view rendering ------------------------------------------------
  function renderBoard(state) {
    const size = OthelloGame.getBoardSize();
    boardEl.style.setProperty("--cols", size.cols);
    boardEl.style.setProperty("--rows", size.rows);
    // Also set the literal computed value directly (not just the --cols/--rows
    // custom properties the CSS repeat(var(...)) rule reads) -- a browser that
    // doesn't support custom properties inside repeat()'s count position (pre-2021
    // engines) would otherwise silently fall back to a single column/row. Setting
    // the resolved string via inline style works unconditionally on any browser.
    boardEl.style.gridTemplateColumns = "repeat(" + size.cols + ", 1fr)";
    boardEl.style.gridTemplateRows = "repeat(" + size.rows + ", 1fr)";
    const legal = state.status === "playing" && !state.aiThinking ? new Set(OthelloGame.getLegalMoves()) : new Set();
    const canClick = state.status === "playing" && !state.aiThinking && (state.mode === "local" || state.currentPlayer === 1);

    const frag = document.createDocumentFragment();
    for (let i = 0; i < size.rows * size.cols; i++) {
      const v = state.board[i];
      const btn = document.createElement("button");
      btn.type = "button";
      let cls = "oth-cell";
      if (i === state.lastMoveIndex) cls += " last-move";
      btn.className = cls;
      btn.dataset.index = String(i);
      const showHint = canClick && legal.has(i);
      btn.disabled = !showHint;
      if (v === 1 || v === 2) {
        const disc = document.createElement("span");
        disc.className = "oth-disc " + (v === 1 ? "black" : "white");
        btn.appendChild(disc);
      } else if (showHint) {
        const hint = document.createElement("span");
        hint.className = "oth-hint";
        btn.appendChild(hint);
      }
      frag.appendChild(btn);
    }

    boardEl.innerHTML = "";
    boardEl.appendChild(frag);
  }

  function renderToolbar(state) {
    timerDisplay.textContent = OthelloGame.formatTime(OthelloGame.getElapsedMs());
    movesDisplay.textContent = String(state.moves);
    undoBtn.disabled = state.status !== "playing" || state.history.length === 0 || state.aiThinking;
    modeLabel.textContent =
      state.mode === "local" ? "本地雙人" : "對戰電腦・" + (DIFFICULTY_LABELS[state.difficulty] || state.difficulty);

    const score = OthelloGame.getScore();
    scoreDisplay.textContent = `⚫ ${score.black} - ${score.white} ⚪`;

    if (state.status === "won") {
      turnIndicator.textContent = state.winner === 1 ? "⚫ 黑方獲勝！" : state.mode === "ai" ? "🤖 電腦獲勝" : "⚪ 白方獲勝！";
    } else if (state.status === "draw") {
      turnIndicator.textContent = "🤝 平手";
    } else if (state.passInfo) {
      // Makes an auto-skip visible — otherwise the board/score don't
      // change and it just looks like nothing happened (see game.js's
      // advanceTurn comment). Shown even if aiThinking is about to flip
      // true right after (a skipped AI re-thinks immediately), since it's
      // still useful context for the render(s) in between.
      const skipped = state.passInfo.skippedPlayer;
      const label = skipped === 1 ? "⚫ 黑方" : state.mode === "ai" ? "🤖 電腦" : "⚪ 白方";
      turnIndicator.textContent = label + "沒有地方可下，跳過一輪";
    } else if (state.aiThinking) {
      turnIndicator.textContent = "🤖 電腦思考中…";
    } else if (state.mode === "ai") {
      turnIndicator.textContent = state.currentPlayer === 1 ? "⚫ 換你了" : "🤖 電腦回合";
    } else {
      turnIndicator.textContent = state.currentPlayer === 1 ? "⚫ 黑方回合" : "⚪ 白方回合";
    }
  }

  function renderWinModal(state) {
    if (state.status !== "won" && state.status !== "draw") {
      winModal.classList.add("hidden");
      return;
    }
    const score = OthelloGame.getScore();
    if (state.status === "draw") {
      winTitle.textContent = "🤝 平手！";
    } else {
      winTitle.textContent =
        state.mode === "ai" ? (state.winner === 1 ? "🎉 你贏了！" : "🤖 電腦獲勝") : state.winner === 1 ? "⚫ 黑方獲勝！" : "⚪ 白方獲勝！";
    }
    winSubtitle.textContent = state.mode === "local" ? "本地雙人" : "對戰電腦・" + (DIFFICULTY_LABELS[state.difficulty] || "");
    winStats.innerHTML =
      statRow("最終比分", `⚫ ${score.black} - ${score.white} ⚪`) +
      statRow("花費時間", OthelloGame.formatTime(state.elapsedMs)) +
      statRow("總步數", String(state.moves));
    winModal.classList.remove("hidden");
  }

  function render(state, event) {
    if (SOUND_EVENTS.has(event)) OthelloSound.play(event);
    if (!state) return;
    if (event === "place" && state.status === "won") OthelloSound.play("win");
    else if (event === "place" && state.status === "draw") OthelloSound.play("draw");
    renderBoard(state);
    renderToolbar(state);
    renderWinModal(state);

    // Kick off the AI's reply one tick later so the "電腦思考中" indicator
    // actually paints first — same reasoning as connectFour's deferral.
    if (state.aiThinking) {
      setTimeout(() => OthelloGame.runAiTurn(), 30);
    }
  }

  // -- home view interactions -----------------------------------------------
  continueBtn.addEventListener("click", () => {
    if (OthelloGame.resumeGame()) showView("game");
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
    OthelloGame.newGame(mode, difficulty);
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
    const btn = e.target.closest(".oth-cell");
    if (!btn || btn.disabled) return;
    OthelloGame.playCell(Number(btn.dataset.index));
  });

  undoBtn.addEventListener("click", () => OthelloGame.undo());

  resetBtn.addEventListener("click", () => {
    const state = OthelloGame.getState();
    if (OthelloGame.hasProgress() && !confirm("確定要放棄目前對局，重新開始新的一局嗎？")) {
      return;
    }
    OthelloGame.newGame(state ? state.mode : "local", state ? state.difficulty : undefined);
  });

  backHomeBtn.addEventListener("click", () => {
    // No confirm needed: autosaves after every move, so "繼續上次遊戲"
    // always brings it back — matches every other game in this hub.
    renderHome();
    showView("home");
  });

  winCloseBtn.addEventListener("click", () => {
    const state = OthelloGame.getState();
    OthelloGame.newGame(state ? state.mode : "local", state ? state.difficulty : undefined);
  });
  winHomeBtn.addEventListener("click", () => {
    winModal.classList.add("hidden");
    renderHome();
    showView("home");
  });

  // -- boot -----------------------------------------------------------------
  OthelloSound.setEnabled(OthelloStorage.getSettings().soundEnabled !== false);
  OthelloGame.onChange(render);
  applyTheme(GameHubStorage.getTheme());
  renderHome();
  showView("home");
})();
