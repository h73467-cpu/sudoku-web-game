// The only file that touches the DOM/canvas. Renders state -> canvas + DOM,
// maps game events to sound effects (including starting/stopping the bgm
// loop), and wires input (dpad buttons + arrow/WASD keys). Mirrors the
// overall structure of breakout/js/ui.js (also a canvas + RAF-driven game),
// adapted for a discrete grid instead of continuous ball physics.
(function () {
  const DIFFICULTY_LABELS = { superEasy: "超簡單", easy: "簡單", medium: "中等", hard: "困難", expert: "專家" };
  const DIFFICULTY_ORDER = ["superEasy", "easy", "medium", "hard", "expert"];
  const SOUND_EVENTS = new Set([
    "hop",
    "carHit",
    "drown",
    "edgeFall",
    "gapFall",
    "slotFilled",
    "bump",
    "levelClear",
    "gameover",
  ]);

  const { width: BOARD_W, height: BOARD_H } = FrogGame.getBoardSize();

  // Deliberately no green anywhere the frog itself can be standing (start,
  // median, home) — the frog is green, so a green background used to make
  // it nearly invisible (only the eyes showed). Safe zones use a sandy/
  // dirt palette instead; the home bank uses dark brown so a parked frog
  // (drawn in a different, warm color) stays clearly visible on it too.
  const LANE_COLORS = {
    home: "#3a2a1c",
    river: "#2f7dc4",
    median: "#a9824f",
    road: "#333333",
    start: "#d4b579",
  };
  const HOME_HEDGE_COLOR = "#241a10";
  const HOME_SLOT_EMPTY_COLOR = "#7ec8e3";
  const HOME_SLOT_EMPTY_STROKE = "#2b6a86";
  const PARKED_FROG_COLOR = "#f2a541";
  const DEATH_FLASH_COLORS = {
    carHit: "rgba(220, 38, 38, 0.45)",
    drown: "rgba(37, 99, 235, 0.45)",
    edgeFall: "rgba(37, 99, 235, 0.45)",
    gapFall: "rgba(21, 128, 61, 0.45)",
  };

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
  const boardCanvas = document.getElementById("board");
  const ctx = boardCanvas.getContext("2d");
  const canvasOverlay = document.getElementById("canvasOverlay");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayText = document.getElementById("overlayText");
  const overlayActionBtn = document.getElementById("overlayActionBtn");
  const dpadButtons = {
    up: document.getElementById("dpadUp"),
    down: document.getElementById("dpadDown"),
    left: document.getElementById("dpadLeft"),
    right: document.getElementById("dpadRight"),
  };

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
    Object.entries(views).forEach(([key, el]) => el.classList.toggle("hidden", key !== name));
  }

  function applyTheme(themeKey) {
    document.documentElement.dataset.theme = themeKey;
  }

  function clampPercent(x) {
    if (!Number.isFinite(x)) return 30;
    return Math.max(10, Math.min(90, Math.round(x)));
  }

  function applySoundButtonState(btn, compact) {
    const on = FrogSound.isEnabled();
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = compact ? (on ? "🔊" : "🔇") : on ? "🔊 音效：開" : "🔇 音效：關";
  }

  function toggleSound() {
    const next = !FrogSound.isEnabled();
    FrogSound.setEnabled(next);
    FrogStorage.saveSettings({ soundEnabled: next });
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  // -- home view rendering ----------------------------------------------------
  function renderHome() {
    const settings = FrogStorage.getSettings();
    superEasyPercentInput.value = settings.superEasyPercent;
    themeSelect.value = GameHubStorage.getTheme();
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  function statRow(label, value) {
    return `<div class="win-stat-row"><span>${label}</span><span>${value}</span></div>`;
  }

  function renderHistory() {
    const items = FrogStorage.getHistory();
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
        `<span>抵達第 ${entry.level} 關　分數 ${entry.score}　用時 ${FrogGame.formatSeconds(entry.elapsedSeconds)}</span>`;
      frag.appendChild(row);
    });
    historyList.appendChild(frag);
  }

  function renderCareer() {
    const career = FrogStorage.getCareer();
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

  function drawLanes(state, grid) {
    for (let row = 0; row < state.totalRows; row++) {
      const type = FrogGame.laneTypeAt(row);
      ctx.fillStyle = LANE_COLORS[type] || "#4caf50";
      ctx.fillRect(0, row * grid.cellH, BOARD_W, grid.cellH);

      if (type === "road") {
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 8]);
        ctx.beginPath();
        const y = row * grid.cellH + grid.cellH / 2;
        ctx.moveTo(0, y);
        ctx.lineTo(BOARD_W, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Home row: lily pads on the valid slots, a hedge texture blocking the rest.
    const homeY = 0;
    for (let col = 0; col < grid.cols; col++) {
      const cx = col * grid.cellW + grid.cellW / 2;
      const cy = homeY + grid.cellH / 2;
      if (grid.homeSlotCols.includes(col)) {
        ctx.fillStyle = HOME_SLOT_EMPTY_COLOR;
        ctx.beginPath();
        ctx.ellipse(cx, cy, grid.cellW * 0.36, grid.cellH * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = HOME_SLOT_EMPTY_STROKE;
        ctx.lineWidth = 2;
        ctx.stroke();
        if (state.filledHomeCols.includes(col)) {
          drawParkedFrog(cx, cy, grid.cellW * 0.28);
        }
      } else {
        ctx.fillStyle = HOME_HEDGE_COLOR;
        roundRect(col * grid.cellW + 3, homeY + 3, grid.cellW - 6, grid.cellH - 6, 4);
        ctx.fill();
      }
    }
  }

  // A parked frog uses a distinct warm color from the live frog (which
  // stays green) — the point is "unmistakably occupied, unmistakably not
  // the frog you're controlling right now", not a second green shape that
  // would just recreate the same blends-into-the-background problem.
  function drawParkedFrog(cx, cy, r) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = PARKED_FROG_COLOR;
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff3d6";
    ctx.beginPath();
    ctx.arc(-r * 0.35, -r * 0.4, r * 0.22, 0, Math.PI * 2);
    ctx.arc(r * 0.35, -r * 0.4, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#5a3a10";
    ctx.beginPath();
    ctx.arc(-r * 0.35, -r * 0.4, r * 0.1, 0, Math.PI * 2);
    ctx.arc(r * 0.35, -r * 0.4, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawObstacle(lane, obs, grid) {
    const y = lane.row * grid.cellH + grid.cellH * 0.15;
    const h = grid.cellH * 0.7;
    const w = lane.obstacleWidth;
    const facingRight = lane.direction > 0;

    if (lane.kind === "car" || lane.kind === "truck") {
      ctx.fillStyle = lane.kind === "truck" ? "#d97706" : "#e74c3c";
      roundRect(obs.x, y, w, h, 6);
      ctx.fill();
      // cab block toward the front (direction of travel) for a sense of motion.
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      const cabW = w * 0.28;
      const cabX = facingRight ? obs.x + w - cabW - 3 : obs.x + 3;
      roundRect(cabX, y + h * 0.18, cabW, h * 0.64, 3);
      ctx.fill();
    } else {
      // log / longLog / turtle
      ctx.fillStyle = lane.kind === "turtle" ? "#2e8b57" : "#8b5a2b";
      roundRect(obs.x, y, w, h, 8);
      ctx.fill();
      if (lane.kind === "turtle") {
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        const shellCount = Math.max(1, Math.round(w / (grid.cellW * 0.5)));
        for (let i = 0; i < shellCount; i++) {
          ctx.beginPath();
          ctx.arc(obs.x + (i + 0.5) * (w / shellCount), y + h / 2, h * 0.28, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.strokeStyle = "rgba(0,0,0,0.2)";
        ctx.lineWidth = 1.5;
        for (let i = 1; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(obs.x + 4, y + (h * i) / 3);
          ctx.lineTo(obs.x + w - 4, y + (h * i) / 3);
          ctx.stroke();
        }
      }
    }
  }

  function drawFrog(state, grid) {
    const f = state.frog;
    const squish = f.hopping ? 1 - Math.sin(Math.min(1, f.hopElapsedMs / f.hopDurationMs) * Math.PI) * 0.22 : 1;
    const r = grid.cellW * 0.32;

    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(1, squish);

    if (state.status === "dying" && state.deathReason === "carHit") {
      ctx.fillStyle = "#7a1212";
    } else {
      ctx.fillStyle = "#3fae2e";
    }
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();

    if (!(state.status === "dying")) {
      ctx.fillStyle = "#eafff0";
      ctx.beginPath();
      ctx.arc(-r * 0.35, -r * 0.4, r * 0.24, 0, Math.PI * 2);
      ctx.arc(r * 0.35, -r * 0.4, r * 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#173d17";
      ctx.beginPath();
      ctx.arc(-r * 0.35, -r * 0.4, r * 0.11, 0, Math.PI * 2);
      ctx.arc(r * 0.35, -r * 0.4, r * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function draw(state) {
    ctx.clearRect(0, 0, BOARD_W, BOARD_H);
    if (!state) return;
    const grid = FrogGame.getGridInfo();

    drawLanes(state, grid);
    state.lanes.forEach((lane) => {
      lane.obstacles.forEach((obs) => drawObstacle(lane, obs, grid));
    });
    drawFrog(state, grid);

    if (state.status === "dying" && DEATH_FLASH_COLORS[state.deathReason]) {
      ctx.fillStyle = DEATH_FLASH_COLORS[state.deathReason];
      ctx.fillRect(0, 0, BOARD_W, BOARD_H);
    }
  }

  function renderOverlay(state) {
    if (state.status === "paused") {
      overlayTitle.textContent = "⏸ 已暫停";
      overlayText.textContent = "按下方按鈕或 Esc 繼續遊戲";
      overlayActionBtn.textContent = "繼續遊戲";
      overlayActionBtn.classList.remove("hidden");
      canvasOverlay.classList.remove("hidden");
    } else if (state.status === "levelClear") {
      overlayTitle.textContent = "🎉 第 " + state.level + " 關過關！";
      overlayText.textContent = "準備進入第 " + (state.level + 1) + " 關…";
      overlayActionBtn.classList.add("hidden");
      canvasOverlay.classList.remove("hidden");
    } else {
      canvasOverlay.classList.add("hidden");
    }
  }

  function renderToolbar(state) {
    scoreDisplay.textContent = String(state.score);
    livesDisplay.textContent = "❤️".repeat(Math.max(0, state.lives));
    timerDisplay.textContent = FrogGame.formatTime(state.elapsedMs);
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
      statRow("花費時間", FrogGame.formatTime(state.elapsedMs)) +
      (result.isNewBestScore ? statRow("紀錄", "🏆 最佳分數！") : "") +
      (result.isNewBestLevel ? statRow("紀錄", "🏆 最高關卡！") : "");
    winModal.classList.remove("hidden");
  }

  // Bgm plays if and only if a run is actively "playing" — anything else
  // (paused, levelClear, dying, gameover, or no run at all) stops it. Kept
  // deliberately unconditional rather than special-casing which non-
  // playing statuses count as "stop": the game's own RAF loop keeps
  // ticking (and re-rendering) even after the player navigates back to
  // this game's home screen unless the run itself is paused/ended, so any
  // narrower condition here risks the bgm surviving a status this function
  // wasn't told to treat as "stopped".
  let bgmActive = false;
  function syncBgm(state) {
    const shouldPlay = !!state && state.status === "playing";
    if (shouldPlay && !bgmActive) {
      FrogSound.startBgm();
      bgmActive = true;
    } else if (!shouldPlay && bgmActive) {
      FrogSound.stopBgm();
      bgmActive = false;
    }
  }

  function render(state, event) {
    if (SOUND_EVENTS.has(event)) FrogSound.play(event, { level: state ? state.level : 0 });
    syncBgm(state);
    if (!state) return;
    draw(state);
    renderOverlay(state);
    renderToolbar(state);
    renderWinModal(state);
  }

  // -- home view interactions -----------------------------------------------
  instructionsBtn.addEventListener("click", () => instructionsModal.classList.remove("hidden"));
  gameInstructionsBtn.addEventListener("click", () => instructionsModal.classList.remove("hidden"));
  instructionsCloseBtn.addEventListener("click", () => instructionsModal.classList.add("hidden"));

  soundToggleBtn.addEventListener("click", toggleSound);
  gameSoundToggleBtn.addEventListener("click", toggleSound);

  difficultyButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const difficulty = btn.dataset.difficulty;
      if (FrogGame.hasProgress() && !confirm("目前有進行中的遊戲，確定要開始新的一局嗎？進度將會遺失。")) {
        return;
      }
      if (difficulty === "superEasy") {
        const x = clampPercent(Number(superEasyPercentInput.value));
        superEasyPercentInput.value = x;
        FrogStorage.saveSettings({ superEasyPercent: x });
      }
      FrogGame.newGame(difficulty);
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
  dpadButtons.up.addEventListener("click", () => FrogGame.tryHop(0, -1));
  dpadButtons.down.addEventListener("click", () => FrogGame.tryHop(0, 1));
  dpadButtons.left.addEventListener("click", () => FrogGame.tryHop(-1, 0));
  dpadButtons.right.addEventListener("click", () => FrogGame.tryHop(1, 0));

  // Drag/swipe directly on the board as an alternative to the dpad buttons —
  // touch drag on phone/tablet and mouse/trackpad drag on a laptop both fire
  // the same Pointer Events, so one handler covers both (same technique
  // breakout/js/ui.js uses for its paddle, adapted here for a discrete
  // one-hop-per-swipe model instead of a continuous x-position). Unlike
  // smokeCar's continuous glide, each threshold crossing fires exactly one
  // tryHop() — matches one dpad tap — and the origin resets after firing so
  // a longer continuous drag can chain multiple hops.
  (function attachSwipeControls() {
    const THRESHOLD = 22;
    let active = false;
    let originX = 0;
    let originY = 0;

    function pointFromEvent(e) {
      const rect = boardCanvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    boardCanvas.addEventListener("pointerdown", (e) => {
      const state = FrogGame.getState();
      if (!state || state.status !== "playing") return;
      e.preventDefault();
      boardCanvas.setPointerCapture(e.pointerId);
      const p = pointFromEvent(e);
      originX = p.x;
      originY = p.y;
      active = true;
    });

    boardCanvas.addEventListener("pointermove", (e) => {
      if (!active) return;
      const p = pointFromEvent(e);
      const dx = p.x - originX;
      const dy = p.y - originY;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < THRESHOLD) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        FrogGame.tryHop(dx > 0 ? 1 : -1, 0);
      } else {
        FrogGame.tryHop(0, dy > 0 ? 1 : -1);
      }
      originX = p.x;
      originY = p.y;
    });

    boardCanvas.addEventListener("pointerup", () => {
      active = false;
    });
    boardCanvas.addEventListener("pointercancel", () => {
      active = false;
    });
  })();

  overlayActionBtn.addEventListener("click", () => FrogGame.togglePause());
  pauseBtn.addEventListener("click", () => FrogGame.togglePause());

  backHomeBtn.addEventListener("click", () => {
    if (FrogGame.hasProgress() && !confirm("目前有進行中的遊戲，確定要返回首頁嗎？進度將會遺失。")) {
      return;
    }
    // Leaving to the home screen discards the run (per the confirm above),
    // but the RAF loop itself keeps ticking in the background regardless
    // of which view is showing — if the run were left in "playing", the
    // very next tick's syncBgm would see status==="playing" and start the
    // bgm right back up a frame later, which is exactly the bug this
    // guards against. Pausing (not just muting) is what actually stops it
    // for good.
    const state = FrogGame.getState();
    if (state && state.status === "playing") FrogGame.togglePause();
    FrogSound.stopBgm();
    bgmActive = false;
    renderHome();
    showView("home");
  });

  winCloseBtn.addEventListener("click", () => {
    const state = FrogGame.getState();
    FrogGame.newGame(state ? state.startDifficulty : "easy");
  });

  winHomeBtn.addEventListener("click", () => {
    winModal.classList.add("hidden");
    renderHome();
    showView("home");
  });

  document.addEventListener("keydown", (e) => {
    if (gameViewEl.classList.contains("hidden")) return;
    const state = FrogGame.getState();
    if (!state) return;

    if (e.key === "Escape") {
      FrogGame.togglePause();
      return;
    }
    if (state.status !== "playing") return;

    if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
      e.preventDefault();
      FrogGame.tryHop(0, -1);
    } else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
      e.preventDefault();
      FrogGame.tryHop(0, 1);
    } else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
      e.preventDefault();
      FrogGame.tryHop(-1, 0);
    } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
      e.preventDefault();
      FrogGame.tryHop(1, 0);
    }
  });

  // -- boot -----------------------------------------------------------------
  FrogSound.setEnabled(FrogStorage.getSettings().soundEnabled !== false);
  FrogGame.onChange(render);
  applyTheme(GameHubStorage.getTheme());
  renderHome();
  showView("home");
})();
