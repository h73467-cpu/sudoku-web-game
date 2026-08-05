// The only file that touches the DOM. Renders state -> DOM and wires events.
// Mirrors the structure of sudoku/js/ui.js and memory/js/ui.js.
(function () {
  const DIFFICULTY_LABELS = {
    superEasy: "超簡單",
    easy: "簡單",
    medium: "中等",
    hard: "困難",
    expert: "專家",
  };
  const DIFFICULTY_ORDER = ["superEasy", "easy", "medium", "hard", "expert"];

  let notesVisible = true;

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
  const backHomeBtn = document.getElementById("backHomeBtn");
  const difficultyLabel = document.getElementById("difficultyLabel");
  const timerDisplay = document.getElementById("timerDisplay");
  const bestAttemptsDisplay = document.getElementById("bestAttemptsDisplay");
  const attemptsDisplay = document.getElementById("attemptsDisplay");
  const hintBtn = document.getElementById("hintBtn");
  const hintCountEl = document.getElementById("hintCount");
  const notesToggleBtn = document.getElementById("notesToggleBtn");
  const gameInstructionsBtn = document.getElementById("gameInstructionsBtn");
  const guessSlotsEl = document.getElementById("guessSlots");
  const digitPadEl = document.getElementById("digitPad");
  const clearSlotBtn = document.getElementById("clearSlotBtn");
  const clearAllBtn = document.getElementById("clearAllBtn");
  const submitGuessBtn = document.getElementById("submitGuessBtn");
  const hintLogEl = document.getElementById("hintLog");
  const notesPanelEl = document.getElementById("notesPanel");
  const notesTableEl = document.getElementById("notesTable");
  const guessHistoryEl = document.getElementById("guessHistory");

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
    return GuessGame.hasProgress() || GuessGame.hasSavedResumableGame();
  }

  // -- home view rendering ----------------------------------------------------
  function renderHome() {
    continueBtn.disabled = !GuessGame.hasSavedResumableGame();
    const settings = GuessStorage.getSettings();
    superEasyPercentInput.value = settings.superEasyPercent;
    themeSelect.value = GameHubStorage.getTheme();
  }

  function statRow(label, value) {
    return `<div class="win-stat-row"><span>${label}</span><span>${value}</span></div>`;
  }

  function renderHistory() {
    const items = GuessStorage.getHistory();
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
        `<span>用時 ${GuessGame.formatSeconds(entry.elapsedSeconds)}　猜測 ${entry.attempts} 次　提示 ${entry.hintsUsed}</span>`;
      frag.appendChild(row);
    });
    historyList.appendChild(frag);
  }

  function renderCareer() {
    const career = GuessStorage.getCareer();
    careerTableBody.innerHTML = "";
    const frag = document.createDocumentFragment();
    DIFFICULTY_ORDER.forEach((code) => {
      const entry = career[code] || { bestTime: null, bestAttempts: null, won: 0 };
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${DIFFICULTY_LABELS[code]}</td>` +
        `<td>${GuessGame.formatSeconds(entry.bestTime)}</td>` +
        `<td>${entry.bestAttempts == null ? "--" : entry.bestAttempts}</td>` +
        `<td>${entry.won}</td>`;
      frag.appendChild(tr);
    });
    careerTableBody.appendChild(frag);
  }

  // -- game view rendering ------------------------------------------------
  function renderSlots(state) {
    guessSlotsEl.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (let i = 0; i < state.codeLength; i++) {
      const digit = state.currentGuess[i];
      const slot = document.createElement("button");
      slot.type = "button";
      slot.dataset.index = String(i);
      slot.className =
        "guess-slot " +
        (digit == null ? "empty" : "filled") +
        (state.selectedSlot === i ? " selected" : "");
      slot.disabled = state.status !== "playing";
      slot.textContent = digit == null ? "" : String(digit);
      frag.appendChild(slot);
    }
    guessSlotsEl.appendChild(frag);
  }

  function renderDigitPad(state) {
    digitPadEl.innerHTML = "";
    const frag = document.createDocumentFragment();
    const sel = state.selectedSlot;
    for (let d = 0; d < state.poolSize; d++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "digit-btn";
      btn.dataset.digit = String(d);
      btn.textContent = String(d);
      const usedElsewhere = state.currentGuess.some((v, i) => i !== sel && v === d);
      btn.disabled = state.status !== "playing" || sel == null || usedElsewhere;
      frag.appendChild(btn);
    }
    digitPadEl.appendChild(frag);
    const selFilled = sel != null && state.currentGuess[sel] != null;
    clearSlotBtn.disabled = state.status !== "playing" || sel == null || !selFilled;
    clearAllBtn.disabled = state.status !== "playing" || state.currentGuess.every((v) => v == null);
    submitGuessBtn.disabled = state.status !== "playing" || state.currentGuess.some((v) => v == null);
  }

  function renderNotesPanel(state) {
    notesPanelEl.classList.toggle("hidden", !notesVisible);
    notesToggleBtn.setAttribute("aria-pressed", notesVisible ? "true" : "false");
    notesTableEl.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (let pos = 0; pos < state.codeLength; pos++) {
      const col = document.createElement("div");
      col.className = "notes-column";
      const header = document.createElement("div");
      header.className = "notes-column-header";
      header.textContent = "第 " + (pos + 1) + " 格";
      const grid = document.createElement("div");
      grid.className = "notes-column-grid";
      for (let d = 0; d < state.poolSize; d++) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "note-btn" + (state.notes[pos].has(d) ? " active" : "");
        btn.dataset.position = String(pos);
        btn.dataset.digit = String(d);
        btn.textContent = String(d);
        grid.appendChild(btn);
      }
      col.appendChild(header);
      col.appendChild(grid);
      frag.appendChild(col);
    }
    notesTableEl.appendChild(frag);
  }

  function renderHintLog(state) {
    if (state.revealedHints.length === 0) {
      hintLogEl.classList.add("hidden");
      hintLogEl.innerHTML = "";
      return;
    }
    hintLogEl.classList.remove("hidden");
    const sorted = state.revealedHints.slice().sort((a, b) => a.position - b.position);
    hintLogEl.innerHTML = sorted
      .map((h) => `<div class="hint-item">💡 第 ${h.position + 1} 位是 ${h.digit}</div>`)
      .join("");
  }

  function renderGuessHistory(state) {
    guessHistoryEl.innerHTML = "";
    if (state.history.length === 0) {
      guessHistoryEl.innerHTML = '<div class="empty-state">還沒有猜測紀錄</div>';
      return;
    }
    const total = state.history.length;
    const frag = document.createDocumentFragment();
    state.history.forEach((entry, idx) => {
      const row = document.createElement("div");
      row.className = "record-row";
      const digitsStr = entry.guess.join(" ");
      row.innerHTML =
        `<span class="record-tag">第 ${total - idx} 次</span>` +
        `<span class="guess-history-digits">${digitsStr}</span>` +
        `<span class="guess-history-result">${entry.a}A${entry.b}B</span>`;
      frag.appendChild(row);
    });
    guessHistoryEl.appendChild(frag);
  }

  function renderToolbar(state) {
    timerDisplay.textContent = GuessGame.formatTime(GuessGame.getElapsedMs());
    const career = GuessStorage.getCareer();
    const entry = career[state.difficulty];
    bestAttemptsDisplay.textContent = entry && entry.bestAttempts != null ? String(entry.bestAttempts) : "--";
    attemptsDisplay.textContent = String(state.history.length);

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
      statRow("花費時間", GuessGame.formatTime(state.elapsedMs)) +
      statRow("猜測次數", String(state.history.length)) +
      statRow("使用提示", state.hintsUsed + " / " + state.maxHints) +
      (isNewBest ? statRow("紀錄", "🏆 新紀錄！") : "");
    winModal.classList.remove("hidden");
  }

  function render(state, event) {
    if (!state) return;
    if (event !== "tick") {
      renderSlots(state);
      renderDigitPad(state);
      renderNotesPanel(state);
      renderHintLog(state);
      renderGuessHistory(state);
    }
    renderToolbar(state);
    renderWinModal(state);
  }

  // -- home view interactions -----------------------------------------------
  continueBtn.addEventListener("click", () => {
    if (GuessGame.resumeGame()) showView("game");
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
        GuessStorage.saveSettings({ superEasyPercent: x });
      }
      GuessGame.newGame(difficulty);
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
  guessSlotsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".guess-slot");
    if (!btn || btn.disabled) return;
    GuessGame.selectSlot(Number(btn.dataset.index));
  });

  digitPadEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".digit-btn");
    if (!btn || btn.disabled) return;
    const state = GuessGame.getState();
    if (!state || state.selectedSlot == null) return;
    GuessGame.setSlotDigit(state.selectedSlot, Number(btn.dataset.digit));
  });

  clearSlotBtn.addEventListener("click", () => {
    const state = GuessGame.getState();
    if (!state || state.selectedSlot == null) return;
    GuessGame.clearSlot(state.selectedSlot);
  });

  clearAllBtn.addEventListener("click", () => {
    GuessGame.clearAllSlots();
  });

  submitGuessBtn.addEventListener("click", () => {
    GuessGame.submitGuess();
  });

  notesToggleBtn.addEventListener("click", () => {
    notesVisible = !notesVisible;
    const state = GuessGame.getState();
    if (state) renderNotesPanel(state);
  });

  notesTableEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".note-btn");
    if (!btn) return;
    GuessGame.toggleNote(Number(btn.dataset.position), Number(btn.dataset.digit));
  });

  hintBtn.addEventListener("click", () => {
    GuessGame.useHint();
  });

  backHomeBtn.addEventListener("click", () => {
    renderHome();
    showView("home");
  });

  winCloseBtn.addEventListener("click", () => {
    const state = GuessGame.getState();
    GuessGame.newGame(state ? state.difficulty : "superEasy");
  });

  winHomeBtn.addEventListener("click", () => {
    winModal.classList.add("hidden");
    renderHome();
    showView("home");
  });

  document.addEventListener("keydown", (e) => {
    if (gameViewEl.classList.contains("hidden")) return;
    const state = GuessGame.getState();
    if (!state || state.status !== "playing") return;

    if (e.key >= "0" && e.key <= "9") {
      const digit = Number(e.key);
      if (state.selectedSlot != null && digit < state.poolSize) {
        GuessGame.setSlotDigit(state.selectedSlot, digit);
      }
    } else if (e.key === "Backspace" || e.key === "Delete") {
      if (state.selectedSlot != null) GuessGame.clearSlot(state.selectedSlot);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (state.selectedSlot != null) GuessGame.selectSlot(Math.max(0, state.selectedSlot - 1));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (state.selectedSlot != null) {
        GuessGame.selectSlot(Math.min(state.codeLength - 1, state.selectedSlot + 1));
      }
    } else if (e.key === "Enter") {
      GuessGame.submitGuess();
    }
  });

  // -- boot -----------------------------------------------------------------
  GuessGame.onChange(render);
  applyTheme(GameHubStorage.getTheme());
  renderHome();
  showView("home");
})();
