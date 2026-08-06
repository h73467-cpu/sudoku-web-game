// The only file that touches the DOM. Renders state -> DOM and wires events.
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
  const dailyStatus = document.getElementById("dailyStatus");
  const dailyBtn = document.getElementById("dailyBtn");
  const superEasyPercentInput = document.getElementById("superEasyPercent");
  const difficultyButtons = Array.from(document.querySelectorAll(".difficulty-btn"));
  const historyBtn = document.getElementById("historyBtn");
  const careerBtn = document.getElementById("careerBtn");

  // -- game view elements -----------------------------------------------------
  const gameViewEl = document.getElementById("gameView");
  const boardEl = document.getElementById("board");
  const numpadEl = document.getElementById("numpad");
  const backHomeBtn = document.getElementById("backHomeBtn");
  const dailyBadge = document.getElementById("dailyBadge");
  const difficultyLabel = document.getElementById("difficultyLabel");
  const notesToggleBtn = document.getElementById("notesToggleBtn");
  const hintBtn = document.getElementById("hintBtn");
  const hintCountEl = document.getElementById("hintCount");
  const undoBtn = document.getElementById("undoBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const timerDisplay = document.getElementById("timerDisplay");
  const bestTimeDisplay = document.getElementById("bestTimeDisplay");
  const mistakesDisplay = document.getElementById("mistakesDisplay");
  const pauseOverlayEl = document.getElementById("pauseOverlay");
  const resumeBtn = document.getElementById("resumeBtn");
  const gameInstructionsBtn = document.getElementById("gameInstructionsBtn");

  // -- history / career view elements -----------------------------------------
  const historyViewEl = document.getElementById("historyView");
  const historyBackBtn = document.getElementById("historyBackBtn");
  const historyList = document.getElementById("historyList");
  const careerViewEl = document.getElementById("careerView");
  const careerBackBtn = document.getElementById("careerBackBtn");
  const careerTableBody = document.getElementById("careerTableBody");

  // -- win modal ----------------------------------------------------------
  const winModal = document.getElementById("winModal");
  const winTitle = document.getElementById("winTitle");
  const winSubtitle = document.getElementById("winSubtitle");
  const winStats = document.getElementById("winStats");
  const winCloseBtn = document.getElementById("winCloseBtn");
  const winHomeBtn = document.getElementById("winHomeBtn");

  // -- instructions modal --------------------------------------------------
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
    return SudokuGame.hasProgress() || SudokuGame.hasSavedResumableGame();
  }

  // -- home view rendering ----------------------------------------------------
  function renderHome() {
    continueBtn.disabled = !SudokuGame.hasSavedResumableGame();

    const daily = SudokuStorage.getDailyStatus();
    const today = SudokuGame.todayStr();
    const completedToday = daily.completedDates.includes(today);
    if (completedToday) {
      dailyStatus.textContent = `今天已完成！連續 ${daily.streak} 天`;
      dailyBtn.textContent = "今日已完成";
      dailyBtn.disabled = true;
    } else if (daily.streak > 0) {
      dailyStatus.textContent = `連續完成 ${daily.streak} 天`;
      dailyBtn.textContent = "開始每日挑戰";
      dailyBtn.disabled = false;
    } else {
      dailyStatus.textContent = "開始你的每日挑戰紀錄";
      dailyBtn.textContent = "開始每日挑戰";
      dailyBtn.disabled = false;
    }

    const settings = SudokuStorage.getSettings();
    themeSelect.value = settings.theme;
    superEasyPercentInput.value = settings.superEasyPercent;
  }

  function statRow(label, value) {
    return `<div class="win-stat-row"><span>${label}</span><span>${value}</span></div>`;
  }

  function renderHistory() {
    const items = SudokuStorage.getHistory();
    historyList.innerHTML = "";
    if (items.length === 0) {
      historyList.innerHTML = '<div class="empty-state">還沒有任何紀錄</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    items.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "record-row";
      const tag = entry.isDaily ? "📅 每日挑戰" : "一般遊戲";
      const date = entry.isDaily
        ? entry.dailyDate || "-"
        : entry.completedAt
        ? entry.completedAt.slice(0, 10)
        : "-";
      const label = DIFFICULTY_LABELS[entry.difficulty] || entry.difficulty;
      row.innerHTML =
        `<span class="record-tag">${tag}　${label}　${date}</span>` +
        `<span>用時 ${SudokuGame.formatSeconds(entry.elapsedSeconds)}　錯誤 ${entry.mistakes}　提示 ${entry.hintsUsed}</span>`;
      frag.appendChild(row);
    });
    historyList.appendChild(frag);
  }

  function renderCareer() {
    const career = SudokuStorage.getCareer();
    careerTableBody.innerHTML = "";
    const frag = document.createDocumentFragment();
    DIFFICULTY_ORDER.forEach((code) => {
      const entry = career[code] || { bestTime: null, won: 0, zeroMistakeWins: 0 };
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${DIFFICULTY_LABELS[code]}</td>` +
        `<td>${SudokuGame.formatSeconds(entry.bestTime)}</td>` +
        `<td>${entry.won}</td>` +
        `<td>${entry.zeroMistakeWins}</td>`;
      frag.appendChild(tr);
    });
    careerTableBody.appendChild(frag);
  }

  // -- game view rendering ------------------------------------------------
  function isPeerOrSameValue(state, idx) {
    const sel = state.selectedIndex;
    if (sel == null || sel === idx) return false;
    if (
      Sudoku.rowOf(sel) === Sudoku.rowOf(idx) ||
      Sudoku.colOf(sel) === Sudoku.colOf(idx) ||
      Sudoku.boxOf(sel) === Sudoku.boxOf(idx)
    ) {
      return true;
    }
    const selValue = state.cells[sel].value;
    return selValue !== 0 && state.cells[idx].value === selValue;
  }

  function cellClasses(cell, state) {
    const classes = ["cell"];
    const row = Math.floor(cell.index / 9);
    if (row % 3 === 2 && row !== 8) classes.push("box-bottom");

    if (state.status === "paused") {
      // Nothing about the puzzle's content should be inferable while paused.
      return classes.join(" ");
    }

    if (cell.given) classes.push("given");
    if (state.selectedIndex === cell.index) classes.push("selected");
    else if (isPeerOrSameValue(state, cell.index)) classes.push("peer");
    if (cell.conflict) classes.push("conflict");
    else if (cell.value !== 0 && cell.value !== state.solution[cell.index])
      classes.push("wrong");
    if (cell.hinted) classes.push("hinted");
    return classes.join(" ");
  }

  function cellContent(cell) {
    if (cell.value !== 0) {
      return "<span>" + cell.value + "</span>";
    }
    if (cell.notes.size > 0) {
      let html = '<div class="notes-grid">';
      for (let d = 1; d <= 9; d++) {
        html += "<span>" + (cell.notes.has(d) ? d : "") + "</span>";
      }
      html += "</div>";
      return html;
    }
    return "";
  }

  function renderBoard(state) {
    const paused = state.status === "paused";
    const frag = document.createDocumentFragment();
    state.cells.forEach((cell) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.index = String(cell.index);
      btn.className = cellClasses(cell, state);
      // While paused, DOM content is blanked outright (not just visually
      // blurred) so the solution can't be read from the page source.
      btn.innerHTML = paused ? "" : cellContent(cell);
      frag.appendChild(btn);
    });
    boardEl.innerHTML = "";
    boardEl.appendChild(frag);
  }

  function renderToolbar(state) {
    timerDisplay.textContent = SudokuGame.formatTime(SudokuGame.getElapsedMs());
    const career = SudokuStorage.getCareer();
    const entry = career[state.difficulty];
    bestTimeDisplay.textContent = SudokuGame.formatSeconds(entry ? entry.bestTime : null);
    mistakesDisplay.textContent = String(state.mistakes);

    const remaining = state.maxHints - state.hintsUsed;
    hintCountEl.textContent = String(remaining);
    hintBtn.disabled = remaining <= 0 || state.status !== "playing";

    notesToggleBtn.setAttribute("aria-pressed", state.notesMode ? "true" : "false");
    undoBtn.disabled = state.status !== "playing";
    pauseBtn.disabled = state.status === "won";
    pauseBtn.textContent = state.status === "paused" ? "繼續 (Esc)" : "暫停 (Esc)";
    difficultyLabel.textContent = DIFFICULTY_LABELS[state.difficulty] || state.difficulty;

    if (state.isDaily) {
      dailyBadge.textContent = "📅 本日題目 " + (state.dailyDate || "");
      dailyBadge.classList.remove("hidden");
    } else {
      dailyBadge.classList.add("hidden");
    }
  }

  function renderPauseOverlay(state) {
    pauseOverlayEl.classList.toggle("hidden", state.status !== "paused");
    numpadEl.classList.toggle("disabled", state.status !== "playing");
  }

  function renderWinModal(state) {
    if (state.status !== "won") {
      winModal.classList.add("hidden");
      return;
    }
    const isNewBest = state.justWon && state.justWon.isNewBest;
    winTitle.textContent = state.isDaily ? "🎉 每日挑戰完成！" : "🎉 完成！";
    winSubtitle.textContent =
      (DIFFICULTY_LABELS[state.difficulty] || state.difficulty) +
      (state.isDaily && state.dailyDate ? "　" + state.dailyDate : "");
    const timeStr = SudokuGame.formatTime(state.elapsedMs);
    winStats.innerHTML =
      statRow("花費時間", timeStr) +
      statRow("錯誤次數", String(state.mistakes)) +
      statRow("使用提示", state.hintsUsed + " / " + state.maxHints) +
      (isNewBest ? statRow("紀錄", "🏆 新紀錄！") : "");
    // Daily challenges only get one attempt per day — no "play again".
    winCloseBtn.classList.toggle("hidden", !!state.isDaily);
    winModal.classList.remove("hidden");
  }

  function render(state, event) {
    if (!state) return;
    if (event !== "tick") {
      renderBoard(state);
    }
    renderToolbar(state);
    renderPauseOverlay(state);
    renderWinModal(state);
  }

  function moveSelection(key, idx) {
    let row = Math.floor(idx / 9);
    let col = idx % 9;
    if (key === "ArrowUp") row = Math.max(0, row - 1);
    if (key === "ArrowDown") row = Math.min(8, row + 1);
    if (key === "ArrowLeft") col = Math.max(0, col - 1);
    if (key === "ArrowRight") col = Math.min(8, col + 1);
    SudokuGame.selectCell(row * 9 + col);
  }

  // -- home view interactions -----------------------------------------------
  continueBtn.addEventListener("click", () => {
    if (SudokuGame.resumeGame()) showView("game");
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
        SudokuStorage.saveSettings({ superEasyPercent: x });
      }
      SudokuGame.newGame(difficulty);
      showView("game");
    });
  });

  dailyBtn.addEventListener("click", () => {
    const today = SudokuGame.todayStr();
    const saved = SudokuStorage.loadCurrentGame();
    const alreadyInProgress =
      saved &&
      saved.isDaily &&
      saved.dailyDate === today &&
      (saved.status === "playing" || saved.status === "paused");
    if (alreadyInProgress) {
      SudokuGame.resumeGame();
    } else {
      if (
        hasAnyProgressToLose() &&
        !confirm("目前有進行中的遊戲，確定要開始每日挑戰嗎？進度將會遺失。")
      ) {
        return;
      }
      SudokuGame.newGame("medium", { isDaily: true, dailyDate: today });
    }
    showView("game");
  });

  themeSelect.addEventListener("change", () => {
    const theme = themeSelect.value;
    applyTheme(theme);
    SudokuStorage.saveSettings({ theme });
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
    const btn = e.target.closest(".cell");
    if (!btn) return;
    const state = SudokuGame.getState();
    if (!state || state.status !== "playing") return;
    SudokuGame.selectCell(Number(btn.dataset.index));
  });

  numpadEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".num-btn");
    if (!btn) return;
    const state = SudokuGame.getState();
    if (!state || state.status !== "playing" || state.selectedIndex == null) return;
    SudokuGame.setValue(state.selectedIndex, Number(btn.dataset.digit));
  });

  backHomeBtn.addEventListener("click", () => {
    const state = SudokuGame.getState();
    if (state && state.status === "playing") SudokuGame.togglePause();
    renderHome();
    showView("home");
  });

  notesToggleBtn.addEventListener("click", () => {
    SudokuGame.toggleNotesMode();
  });

  hintBtn.addEventListener("click", () => {
    SudokuGame.useHint();
  });

  undoBtn.addEventListener("click", () => {
    SudokuGame.undo();
  });

  pauseBtn.addEventListener("click", () => {
    SudokuGame.togglePause();
  });

  resumeBtn.addEventListener("click", () => {
    SudokuGame.togglePause();
  });

  winCloseBtn.addEventListener("click", () => {
    const state = SudokuGame.getState();
    SudokuGame.newGame(state ? state.difficulty : "superEasy");
  });

  winHomeBtn.addEventListener("click", () => {
    winModal.classList.add("hidden");
    renderHome();
    showView("home");
  });

  document.addEventListener("keydown", (e) => {
    if (gameViewEl.classList.contains("hidden")) return;
    const state = SudokuGame.getState();
    if (!state) return;

    if (e.key === "Escape") {
      SudokuGame.togglePause();
      return;
    }
    if (e.ctrlKey && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      SudokuGame.undo();
      return;
    }
    if (state.status !== "playing") return;

    if (e.key === "n" || e.key === "N") {
      SudokuGame.toggleNotesMode();
      return;
    }
    if (state.selectedIndex == null) {
      if (e.key.indexOf("Arrow") === 0) {
        e.preventDefault();
        SudokuGame.selectCell(0);
      }
      return;
    }
    if (e.key >= "1" && e.key <= "9") {
      SudokuGame.setValue(state.selectedIndex, Number(e.key));
    } else if (e.key === "Backspace" || e.key === "Delete") {
      SudokuGame.setValue(state.selectedIndex, 0);
    } else if (e.key.indexOf("Arrow") === 0) {
      e.preventDefault();
      moveSelection(e.key, state.selectedIndex);
    }
  });

  // -- boot -----------------------------------------------------------------
  SudokuGame.onChange(render);
  applyTheme(SudokuStorage.getSettings().theme);
  renderHome();
  showView("home");
})();
