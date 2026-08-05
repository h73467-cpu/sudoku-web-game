// The only file that touches the DOM. Renders state -> DOM and wires events.
// Mirrors the structure of sudoku/js/ui.js.
(function () {
  const DIFFICULTY_LABELS = {
    superEasy: "超簡單",
    easy: "簡單",
    medium: "中等",
    hard: "困難",
    expert: "專家",
  };
  const DIFFICULTY_ORDER = ["superEasy", "easy", "medium", "hard", "expert"];

  // -- home view elements ---------------------------------------------------
  const homeViewEl = document.getElementById("homeView");
  const themeSelect = document.getElementById("themeSelect");
  const continueBtn = document.getElementById("continueBtn");
  const instructionsBtn = document.getElementById("instructionsBtn");
  const superEasyPercentInput = document.getElementById("superEasyPercent");
  const difficultyButtons = Array.from(document.querySelectorAll(".difficulty-btn"));
  const historyBtn = document.getElementById("historyBtn");
  const careerBtn = document.getElementById("careerBtn");

  // -- game view elements -----------------------------------------------------
  const gameViewEl = document.getElementById("gameView");
  const boardEl = document.getElementById("board");
  const backHomeBtn = document.getElementById("backHomeBtn");
  const difficultyLabel = document.getElementById("difficultyLabel");
  const hintBtn = document.getElementById("hintBtn");
  const hintCountEl = document.getElementById("hintCount");
  const gameInstructionsBtn = document.getElementById("gameInstructionsBtn");
  const timerDisplay = document.getElementById("timerDisplay");
  const bestTimeDisplay = document.getElementById("bestTimeDisplay");
  const movesDisplay = document.getElementById("movesDisplay");

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
    return MemoryGame.hasProgress() || MemoryGame.hasSavedResumableGame();
  }

  // -- home view rendering ----------------------------------------------------
  function renderHome() {
    continueBtn.disabled = !MemoryGame.hasSavedResumableGame();
    const settings = MemoryStorage.getSettings();
    superEasyPercentInput.value = settings.superEasyPercent;
    themeSelect.value = GameHubStorage.getTheme();
  }

  function statRow(label, value) {
    return `<div class="win-stat-row"><span>${label}</span><span>${value}</span></div>`;
  }

  function renderHistory() {
    const items = MemoryStorage.getHistory();
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
        `<span>用時 ${MemoryGame.formatSeconds(entry.elapsedSeconds)}　翻牌 ${entry.moves} 次　提示 ${entry.hintsUsed}</span>`;
      frag.appendChild(row);
    });
    historyList.appendChild(frag);
  }

  function renderCareer() {
    const career = MemoryStorage.getCareer();
    careerTableBody.innerHTML = "";
    const frag = document.createDocumentFragment();
    DIFFICULTY_ORDER.forEach((code) => {
      const entry = career[code] || { bestTime: null, bestMoves: null, won: 0 };
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${DIFFICULTY_LABELS[code]}</td>` +
        `<td>${MemoryGame.formatSeconds(entry.bestTime)}</td>` +
        `<td>${entry.bestMoves == null ? "--" : entry.bestMoves}</td>` +
        `<td>${entry.won}</td>`;
      frag.appendChild(tr);
    });
    careerTableBody.appendChild(frag);
  }

  // -- game view rendering ------------------------------------------------
  function renderBoard(state) {
    boardEl.style.setProperty("--cols", state.cols);
    const frag = document.createDocumentFragment();
    state.cards.forEach((card) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.index = String(card.index);
      const revealed = card.flipped || card.matched;
      btn.className = "mem-card" + (revealed ? " revealed" : "") + (card.matched ? " matched" : "");
      btn.disabled = card.matched || state.status !== "playing";
      btn.setAttribute("aria-label", revealed ? card.symbol : "卡牌");
      // Symbol is only put in the DOM once revealed — like the sudoku pause
      // overlay blanking cell content, this keeps it out of page source /
      // the accessibility tree while face-down, not just hidden by CSS.
      btn.innerHTML =
        '<span class="mem-card-inner">' +
        '<span class="mem-card-face mem-card-back"></span>' +
        `<span class="mem-card-face mem-card-front">${revealed ? card.symbol : ""}</span>` +
        "</span>";
      frag.appendChild(btn);
    });
    boardEl.innerHTML = "";
    boardEl.appendChild(frag);
  }

  function renderToolbar(state) {
    timerDisplay.textContent = MemoryGame.formatTime(MemoryGame.getElapsedMs());
    const career = MemoryStorage.getCareer();
    const entry = career[state.difficulty];
    bestTimeDisplay.textContent = MemoryGame.formatSeconds(entry ? entry.bestTime : null);
    movesDisplay.textContent = String(state.moves);

    const remaining = state.maxHints - state.hintsUsed;
    hintCountEl.textContent = String(remaining);
    hintBtn.disabled = remaining <= 0 || state.status !== "playing";
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
      statRow("花費時間", MemoryGame.formatTime(state.elapsedMs)) +
      statRow("翻牌次數", String(state.moves)) +
      statRow("使用提示", state.hintsUsed + " / " + state.maxHints) +
      (isNewBest ? statRow("紀錄", "🏆 新紀錄！") : "");
    winModal.classList.remove("hidden");
  }

  function render(state, event) {
    if (!state) return;
    if (event !== "tick") {
      renderBoard(state);
    }
    renderToolbar(state);
    renderWinModal(state);
  }

  // -- home view interactions -----------------------------------------------
  continueBtn.addEventListener("click", () => {
    if (MemoryGame.resumeGame()) showView("game");
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
        MemoryStorage.saveSettings({ superEasyPercent: x });
      }
      MemoryGame.newGame(difficulty);
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
    const btn = e.target.closest(".mem-card");
    if (!btn || btn.disabled) return;
    MemoryGame.flipCard(Number(btn.dataset.index));
  });

  backHomeBtn.addEventListener("click", () => {
    renderHome();
    showView("home");
  });

  hintBtn.addEventListener("click", () => {
    MemoryGame.useHint();
  });

  winCloseBtn.addEventListener("click", () => {
    const state = MemoryGame.getState();
    MemoryGame.newGame(state ? state.difficulty : "superEasy");
  });

  winHomeBtn.addEventListener("click", () => {
    winModal.classList.add("hidden");
    renderHome();
    showView("home");
  });

  // -- boot -----------------------------------------------------------------
  MemoryGame.onChange(render);
  applyTheme(GameHubStorage.getTheme());
  renderHome();
  showView("home");
})();
