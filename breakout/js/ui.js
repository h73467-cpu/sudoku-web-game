// The only file that touches the DOM/canvas. Renders state -> canvas + DOM,
// maps game events to sound effects, and wires input events. Mirrors the
// structure of the other games' ui.js files, but the render() callback
// fires every animation frame (not just on discrete moves) since
// BreakoutGame's loop notifies every tick.
(function () {
  const DIFFICULTY_LABELS = {
    superEasy: "超簡單",
    easy: "簡單",
    medium: "中等",
    hard: "困難",
    expert: "專家",
  };
  const DIFFICULTY_ORDER = ["superEasy", "easy", "medium", "hard", "expert"];
  const ROW_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7"];
  const KEYBOARD_STEP = 26;
  const SOUND_EVENTS = new Set([
    "wall",
    "paddle",
    "brick",
    "brickBreak",
    "powerupGood",
    "powerupBad",
    "lifeLost",
    "levelClear",
    "gameover",
  ]);
  const POWERUP_INFO = {
    multiBall: { icon: "⚪", label: "分裂球", good: true },
    paddleGrow: { icon: "↔️", label: "板變長", good: true },
    machineGun: { icon: "🔫", label: "機關槍", good: true },
    extraLife: { icon: "❤️", label: "多一命", good: true },
    paddleShrink: { icon: "⚠️", label: "板變短", good: false },
    fastBall: { icon: "⚡", label: "球變快", good: false },
  };
  const EFFECT_LABELS = {
    paddleGrow: { icon: "↔️", label: "板變長" },
    paddleShrink: { icon: "⚠️", label: "板變短" },
    machineGun: { icon: "🔫", label: "機關槍" },
    fastBall: { icon: "⚡", label: "球變快" },
  };

  const { width: BOARD_W, height: BOARD_H } = BreakoutGame.getBoardSize();
  const brickGeom = BreakoutGame.getBrickGeometry();
  const paddleGeom = BreakoutGame.getPaddleGeometry();

  // -- home view elements ---------------------------------------------------
  const homeViewEl = document.getElementById("homeView");
  const themeSelect = document.getElementById("themeSelect");
  const instructionsBtn = document.getElementById("instructionsBtn");
  const soundToggleBtn = document.getElementById("soundToggleBtn");
  const superEasyPercentInput = document.getElementById("superEasyPercent");
  const difficultyButtons = Array.from(document.querySelectorAll(".difficulty-btn"));
  const historyBtn = document.getElementById("historyBtn");
  const careerBtn = document.getElementById("careerBtn");

  // -- game view elements -----------------------------------------------------
  const gameViewEl = document.getElementById("gameView");
  const backHomeBtn = document.getElementById("backHomeBtn");
  const levelLabel = document.getElementById("levelLabel");
  const scoreDisplay = document.getElementById("scoreDisplay");
  const livesDisplay = document.getElementById("livesDisplay");
  const timerDisplay = document.getElementById("timerDisplay");
  const pauseBtn = document.getElementById("pauseBtn");
  const gameSoundToggleBtn = document.getElementById("gameSoundToggleBtn");
  const gameInstructionsBtn = document.getElementById("gameInstructionsBtn");
  const activeEffectsBarEl = document.getElementById("activeEffectsBar");
  const boardCanvas = document.getElementById("board");
  const ctx = boardCanvas.getContext("2d");
  const canvasOverlay = document.getElementById("canvasOverlay");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayText = document.getElementById("overlayText");
  const overlayActionBtn = document.getElementById("overlayActionBtn");

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

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function applySoundButtonState(btn, compact) {
    const on = BreakoutSound.isEnabled();
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = compact ? (on ? "🔊" : "🔇") : on ? "🔊 音效：開" : "🔇 音效：關";
  }

  function toggleSound() {
    const next = !BreakoutSound.isEnabled();
    BreakoutSound.setEnabled(next);
    BreakoutStorage.saveSettings({ soundEnabled: next });
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  // -- home view rendering ----------------------------------------------------
  function renderHome() {
    const settings = BreakoutStorage.getSettings();
    superEasyPercentInput.value = settings.superEasyPercent;
    themeSelect.value = GameHubStorage.getTheme();
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  function statRow(label, value) {
    return `<div class="win-stat-row"><span>${label}</span><span>${value}</span></div>`;
  }

  function renderHistory() {
    const items = BreakoutStorage.getHistory();
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
        `<span>抵達第 ${entry.level} 關　分數 ${entry.score}　用時 ${BreakoutGame.formatSeconds(entry.elapsedSeconds)}</span>`;
      frag.appendChild(row);
    });
    historyList.appendChild(frag);
  }

  function renderCareer() {
    const career = BreakoutStorage.getCareer();
    careerTableBody.innerHTML = "";
    const frag = document.createDocumentFragment();
    DIFFICULTY_ORDER.forEach((code) => {
      const entry = career[code] || { bestScore: null, bestLevel: null, runs: 0 };
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${DIFFICULTY_LABELS[code]}</td>` +
        `<td>${entry.bestScore == null ? "--" : entry.bestScore}</td>` +
        `<td>${entry.bestLevel == null ? "--" : entry.bestLevel}</td>` +
        `<td>${entry.runs}</td>`;
      frag.appendChild(tr);
    });
    careerTableBody.appendChild(frag);
  }

  // -- game view rendering ------------------------------------------------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw(state) {
    ctx.clearRect(0, 0, BOARD_W, BOARD_H);

    state.bricks.forEach((brick) => {
      if (!brick.alive) return;
      const bx = brickGeom.gap + brick.col * (brickGeom.width + brickGeom.gap);
      const by = brickGeom.top + brick.row * (brickGeom.height + brickGeom.gap);
      const alpha = 0.45 + 0.55 * (brick.hp / brick.maxHp);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = ROW_COLORS[brick.row % ROW_COLORS.length];
      roundRect(bx, by, brickGeom.width, brickGeom.height, 4);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (brick.maxHp > 1) {
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 13px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(brick.hp), bx + brickGeom.width / 2, by + brickGeom.height / 2 + 1);
      }
    });

    state.powerUps.forEach((p) => {
      const info = POWERUP_INFO[p.type];
      ctx.fillStyle = info.good ? "#22c55e" : "#ef4444";
      roundRect(p.x - 14, p.y - 12, 28, 24, 8);
      ctx.fill();
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(info.icon, p.x, p.y + 1);
    });

    ctx.fillStyle = cssVar("--color-text") || "#1f2430";
    state.bullets.forEach((b) => {
      roundRect(b.x - 2, b.y - 7, 4, 14, 2);
      ctx.fill();
    });

    const paddleLeft = state.paddleX - state.paddleWidth / 2;
    ctx.fillStyle = cssVar("--color-accent") || "#2563eb";
    roundRect(paddleLeft, paddleGeom.y, state.paddleWidth, paddleGeom.height, 7);
    ctx.fill();

    ctx.fillStyle = cssVar("--color-text") || "#1f2430";
    state.balls.forEach((ball) => {
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, paddleGeom.ballRadius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function renderOverlay(state) {
    if (state.status === "paused") {
      overlayTitle.textContent = "⏸ 已暫停";
      overlayText.textContent = "按下方按鈕或 Esc 繼續遊戲";
      overlayActionBtn.textContent = "繼續遊戲";
      overlayActionBtn.dataset.mode = "pause";
      overlayActionBtn.classList.remove("hidden");
      canvasOverlay.classList.remove("hidden");
    } else if (state.status === "levelClear") {
      overlayTitle.textContent = "🎉 第 " + state.level + " 關過關！";
      overlayText.textContent = "準備進入第 " + (state.level + 1) + " 關…";
      overlayActionBtn.classList.add("hidden");
      canvasOverlay.classList.remove("hidden");
    } else if (state.status === "playing" && state.balls.some((b) => b.attached)) {
      overlayTitle.textContent = "🏓 準備開始";
      overlayText.textContent = "點擊畫面或按空白鍵發射球";
      overlayActionBtn.textContent = "發射！";
      overlayActionBtn.dataset.mode = "launch";
      overlayActionBtn.classList.remove("hidden");
      canvasOverlay.classList.remove("hidden");
    } else {
      canvasOverlay.classList.add("hidden");
    }
  }

  function renderActiveEffects(state) {
    const pills = Object.keys(EFFECT_LABELS)
      .filter((key) => state.effects[key] > 0)
      .map((key) => {
        const info = EFFECT_LABELS[key];
        const seconds = Math.ceil(state.effects[key] / 1000);
        const bad = key === "paddleShrink" || key === "fastBall";
        return `<span class="active-effect-pill${bad ? " bad" : ""}">${info.icon} ${info.label} ${seconds}s</span>`;
      });
    activeEffectsBarEl.innerHTML = pills.join("");
    activeEffectsBarEl.classList.toggle("hidden", pills.length === 0);
  }

  function renderToolbar(state) {
    scoreDisplay.textContent = String(state.score);
    livesDisplay.textContent = "❤️".repeat(Math.max(0, state.lives));
    timerDisplay.textContent = BreakoutGame.formatTime(state.elapsedMs);
    pauseBtn.disabled = state.status !== "playing" && state.status !== "paused";
    pauseBtn.textContent = state.status === "paused" ? "繼續 (Esc)" : "暫停 (Esc)";
    levelLabel.textContent =
      "第 " + state.level + " 關 · " + (DIFFICULTY_LABELS[state.startDifficulty] || state.startDifficulty);
  }

  function renderWinModal(state) {
    if (state.status !== "gameover") {
      winModal.classList.add("hidden");
      return;
    }
    const result = state.justFinished || { isNewBestScore: false, isNewBestLevel: false };
    winTitle.textContent = "💥 遊戲結束";
    winSubtitle.textContent = DIFFICULTY_LABELS[state.startDifficulty] || state.startDifficulty;
    winStats.innerHTML =
      statRow("分數", String(state.score)) +
      statRow("抵達關卡", "第 " + state.level + " 關") +
      statRow("花費時間", BreakoutGame.formatTime(state.elapsedMs)) +
      (result.isNewBestScore ? statRow("紀錄", "🏆 最佳分數！") : "") +
      (result.isNewBestLevel ? statRow("紀錄", "🏆 最高關卡！") : "");
    winModal.classList.remove("hidden");
  }

  function render(state, event, extra) {
    if (SOUND_EVENTS.has(event)) {
      BreakoutSound.play(event, extra);
    }
    if (!state) return;
    draw(state);
    renderOverlay(state);
    renderActiveEffects(state);
    renderToolbar(state);
    renderWinModal(state);
  }

  // -- home view interactions -----------------------------------------------
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
        BreakoutGame.hasProgress() &&
        !confirm("目前有進行中的遊戲，確定要開始新的一局嗎？進度將會遺失。")
      ) {
        return;
      }
      if (difficulty === "superEasy") {
        const x = clampPercent(Number(superEasyPercentInput.value));
        superEasyPercentInput.value = x;
        BreakoutStorage.saveSettings({ superEasyPercent: x });
      }
      BreakoutGame.newGame(difficulty);
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
  function canvasXFromEvent(e) {
    const rect = boardCanvas.getBoundingClientRect();
    const scaleX = BOARD_W / rect.width;
    return (e.clientX - rect.left) * scaleX;
  }

  boardCanvas.addEventListener("pointermove", (e) => {
    BreakoutGame.movePaddleTo(canvasXFromEvent(e));
  });

  boardCanvas.addEventListener("pointerdown", (e) => {
    BreakoutGame.movePaddleTo(canvasXFromEvent(e));
    BreakoutGame.launchBall();
  });

  overlayActionBtn.addEventListener("click", () => {
    if (overlayActionBtn.dataset.mode === "pause") {
      BreakoutGame.togglePause();
    } else {
      BreakoutGame.launchBall();
    }
  });

  pauseBtn.addEventListener("click", () => {
    BreakoutGame.togglePause();
  });

  backHomeBtn.addEventListener("click", () => {
    const state = BreakoutGame.getState();
    if (
      state &&
      (state.status === "playing" || state.status === "paused" || state.status === "levelClear") &&
      !confirm("目前有進行中的遊戲，確定要返回首頁嗎？進度將會遺失。")
    ) {
      return;
    }
    renderHome();
    showView("home");
  });

  winCloseBtn.addEventListener("click", () => {
    const state = BreakoutGame.getState();
    BreakoutGame.newGame(state ? state.startDifficulty : "superEasy");
  });

  winHomeBtn.addEventListener("click", () => {
    winModal.classList.add("hidden");
    renderHome();
    showView("home");
  });

  document.addEventListener("keydown", (e) => {
    if (gameViewEl.classList.contains("hidden")) return;
    const state = BreakoutGame.getState();
    if (!state) return;

    if (e.key === "Escape") {
      BreakoutGame.togglePause();
      return;
    }
    if (state.status !== "playing") return;

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      BreakoutGame.movePaddleBy(-KEYBOARD_STEP);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      BreakoutGame.movePaddleBy(KEYBOARD_STEP);
    } else if (e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      BreakoutGame.launchBall();
    }
  });

  // -- boot -----------------------------------------------------------------
  BreakoutSound.setEnabled(BreakoutStorage.getSettings().soundEnabled !== false);
  BreakoutGame.onChange(render);
  applyTheme(GameHubStorage.getTheme());
  renderHome();
  showView("home");
})();
