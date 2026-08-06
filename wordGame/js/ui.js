// The only file that touches the DOM. Renders state -> DOM and wires
// events. Letters are plain clickable tile buttons (tap to move between
// hand and staging) rather than drag-and-drop, for touch reliability —
// same reasoning as klotski/jigsaw's select-then-act pattern.
(function () {
  const DIFFICULTY_LABELS = { superEasy: "超簡單", easy: "簡單", medium: "中等", hard: "困難", expert: "專家" };
  const DIFFICULTY_ORDER = ["superEasy", "easy", "medium", "hard", "expert"];
  const SOUND_EVENTS = new Set(["select", "submit-valid", "invalid", "hint", "reshuffle"]);

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
  const scoreDisplay = document.getElementById("scoreDisplay");
  const wordsFoundDisplay = document.getElementById("wordsFoundDisplay");
  const hintBtn = document.getElementById("hintBtn");
  const reshuffleBtn = document.getElementById("reshuffleBtn");
  const resetBtn = document.getElementById("resetBtn");
  const gameSoundToggleBtn = document.getElementById("gameSoundToggleBtn");
  const gameInstructionsBtn = document.getElementById("gameInstructionsBtn");
  const stagingArea = document.getElementById("stagingArea");
  const handArea = document.getElementById("handArea");
  const submitBtn = document.getElementById("submitBtn");
  const clearBtn = document.getElementById("clearBtn");
  const hintText = document.getElementById("hintText");
  const foundWordsList = document.getElementById("foundWordsList");

  // -- history / career view elements -----------------------------------------
  const historyViewEl = document.getElementById("historyView");
  const historyBackBtn = document.getElementById("historyBackBtn");
  const historyList = document.getElementById("historyList");
  const careerViewEl = document.getElementById("careerView");
  const careerBackBtn = document.getElementById("careerBackBtn");
  const careerTableBody = document.getElementById("careerTableBody");

  // -- win / instructions modals ----------------------------------------------
  const winModal = document.getElementById("winModal");
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
    return WordGame.hasProgress() || WordGame.hasSavedResumableGame();
  }

  function applySoundButtonState(btn, compact) {
    const on = WordGameSound.isEnabled();
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = compact ? (on ? "🔊" : "🔇") : on ? "🔊 音效：開" : "🔇 音效：關";
  }

  function toggleSound() {
    const next = !WordGameSound.isEnabled();
    WordGameSound.setEnabled(next);
    WordGameStorage.saveSettings({ soundEnabled: next });
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  // -- home view rendering ----------------------------------------------------
  function renderHome() {
    continueBtn.disabled = !WordGame.hasSavedResumableGame();
    themeSelect.value = GameHubStorage.getTheme();
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  function statRow(label, value) {
    return `<div class="win-stat-row"><span>${label}</span><span>${value}</span></div>`;
  }

  function renderHistory() {
    const items = WordGameStorage.getHistory();
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
        `<span>分數 ${entry.score}　${entry.wordsFound} 個單字　最長 ${(entry.longestWord || "").toUpperCase()}</span>`;
      frag.appendChild(row);
    });
    historyList.appendChild(frag);
  }

  function renderCareer() {
    const career = WordGameStorage.getCareer();
    careerTableBody.innerHTML = "";
    const frag = document.createDocumentFragment();
    DIFFICULTY_ORDER.forEach((code) => {
      const entry = career[code] || { bestTime: null, bestScore: null, won: 0 };
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${DIFFICULTY_LABELS[code]}</td>` +
        `<td>${entry.bestTime == null ? "--" : WordGame.formatSeconds(entry.bestTime)}</td>` +
        `<td>${entry.bestScore == null ? "--" : entry.bestScore}</td>` +
        `<td>${entry.won}</td>`;
      frag.appendChild(tr);
    });
    careerTableBody.appendChild(frag);
  }

  // -- game view rendering ------------------------------------------------
  function makeTileButton(tile, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "letter-tile";
    btn.textContent = tile.letter.toUpperCase();
    btn.addEventListener("click", () => onClick(tile.id));
    return btn;
  }

  function renderTiles(state) {
    stagingArea.innerHTML = "";
    state.staging.forEach((tile) => {
      stagingArea.appendChild(makeTileButton(tile, WordGame.deselectTile));
    });

    handArea.innerHTML = "";
    state.hand.forEach((tile) => {
      handArea.appendChild(makeTileButton(tile, WordGame.selectTile));
    });

    submitBtn.disabled = state.status !== "playing" || state.staging.length < 3;
    clearBtn.disabled = state.status !== "playing" || state.staging.length === 0;
  }

  function renderFoundWords(state) {
    foundWordsList.innerHTML = "";
    if (state.foundWords.length === 0) {
      foundWordsList.innerHTML = '<span class="empty-state">還沒有找到單字</span>';
      return;
    }
    const frag = document.createDocumentFragment();
    state.foundWords.forEach((w) => {
      const chip = document.createElement("span");
      chip.className = "word-chip";
      chip.textContent = w.toUpperCase();
      frag.appendChild(chip);
    });
    foundWordsList.appendChild(frag);
  }

  function renderToolbar(state) {
    timerDisplay.textContent = WordGame.formatTime(WordGame.getElapsedMs());
    scoreDisplay.textContent = String(state.score);
    wordsFoundDisplay.textContent = `${state.foundWords.length} / ${state.targetWords}`;
    hintBtn.disabled = state.status !== "playing" || state.hintsUsed >= WordGame.getMaxHints();
    hintBtn.textContent = `💡 提示 (${WordGame.getMaxHints() - state.hintsUsed})`;
    reshuffleBtn.disabled = state.status !== "playing";
    hintText.textContent = state.hintWord ? `提示：${state.hintWord.toUpperCase()}` : "";
    difficultyLabel.textContent = DIFFICULTY_LABELS[state.difficulty] || state.difficulty;
  }

  function renderWinModal(state) {
    if (state.status !== "won") {
      winModal.classList.add("hidden");
      return;
    }
    winSubtitle.textContent = DIFFICULTY_LABELS[state.difficulty] || state.difficulty;
    const isNewBest = state.justWon && state.justWon.isNewBest;
    const longestWord = state.foundWords.reduce((longest, w) => (w.length > longest.length ? w : longest), "");
    winStats.innerHTML =
      statRow("花費時間", WordGame.formatTime(state.elapsedMs)) +
      statRow("分數", String(state.score)) +
      statRow("找到單字", String(state.foundWords.length)) +
      statRow("最長單字", longestWord.toUpperCase()) +
      statRow("使用提示", String(state.hintsUsed)) +
      (isNewBest ? statRow("紀錄", "🏆 新紀錄！") : "");
    winModal.classList.remove("hidden");
  }

  function render(state, event) {
    if (SOUND_EVENTS.has(event)) WordGameSound.play(event);
    if (!state) return;
    if (event === "submit-valid" && state.status === "won") WordGameSound.play("win");
    renderTiles(state);
    renderFoundWords(state);
    renderToolbar(state);
    renderWinModal(state);
  }

  // -- home view interactions -----------------------------------------------
  continueBtn.addEventListener("click", () => {
    if (WordGame.resumeGame()) showView("game");
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
      WordGame.newGame(difficulty);
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
  submitBtn.addEventListener("click", () => WordGame.submitWord());
  clearBtn.addEventListener("click", () => WordGame.clearStaging());
  hintBtn.addEventListener("click", () => WordGame.useHint());
  reshuffleBtn.addEventListener("click", () => WordGame.reshuffleHand());

  resetBtn.addEventListener("click", () => {
    const state = WordGame.getState();
    if (WordGame.hasProgress() && !confirm("確定要放棄目前進度，重新開始一局新的關卡嗎？")) {
      return;
    }
    WordGame.newGame(state ? state.difficulty : "easy");
  });

  backHomeBtn.addEventListener("click", () => {
    // No confirm needed: autosaves after every submitted word, so "繼續上次
    // 遊戲" always brings it back — matches every other game in this hub.
    renderHome();
    showView("home");
  });

  winCloseBtn.addEventListener("click", () => {
    const state = WordGame.getState();
    WordGame.newGame(state ? state.difficulty : "easy");
  });
  winHomeBtn.addEventListener("click", () => {
    winModal.classList.add("hidden");
    renderHome();
    showView("home");
  });

  document.addEventListener("keydown", (e) => {
    if (gameViewEl.classList.contains("hidden")) return;
    const state = WordGame.getState();
    if (!state || state.status !== "playing") return;
    if (e.key === "Enter") {
      e.preventDefault();
      WordGame.submitWord();
    } else if (e.key === "Backspace") {
      e.preventDefault();
      if (state.staging.length > 0) {
        WordGame.deselectTile(state.staging[state.staging.length - 1].id);
      }
    } else {
      const letter = e.key.toLowerCase();
      if (letter.length === 1 && letter >= "a" && letter <= "z") {
        const tile = state.hand.find((t) => t.letter === letter);
        if (tile) WordGame.selectTile(tile.id);
      }
    }
  });

  // -- boot -----------------------------------------------------------------
  WordGameSound.setEnabled(WordGameStorage.getSettings().soundEnabled !== false);
  WordGame.onChange(render);
  applyTheme(GameHubStorage.getTheme());
  renderHome();
  showView("home");
})();
