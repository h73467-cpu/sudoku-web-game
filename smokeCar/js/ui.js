// The only file that touches the DOM/canvas. Renders state -> canvas + DOM,
// maps game events to sound effects (including starting/stopping the bgm
// loop), and wires input (dpad + smoke button + arrow/WASD/space keys).
// Mirrors the overall structure of frog/js/ui.js (also a canvas + RAF-
// driven maze game).
(function () {
  const DIFFICULTY_LABELS = { superEasy: "超簡單", easy: "簡單", medium: "中等", hard: "困難", expert: "專家" };
  const DIFFICULTY_ORDER = ["superEasy", "easy", "medium", "hard", "expert"];
  const SOUND_EVENTS = new Set(["smoke", "flag", "caught", "levelClear", "gameover"]);

  const { width: BOARD_W, height: BOARD_H } = SmokeCarGame.getBoardSize();
  const grid = SmokeCarGame.getGridInfo();

  const WALL_COLOR = "#5fd4e0";
  const FLOOR_COLOR = "#1c2530";
  const SMOKE_COLOR = "rgba(200, 205, 210, 0.8)";
  const CAUGHT_FLASH = "rgba(220, 38, 38, 0.4)";
  const ENEMY_COLORS = ["#e74c3c", "#e6a13c", "#c05fd6", "#e2557b"];

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
  const flagsDisplay = document.getElementById("flagsDisplay");
  const smokeDisplay = document.getElementById("smokeDisplay");
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
  const smokeBtn = document.getElementById("smokeBtn");

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
    const on = SmokeCarSound.isEnabled();
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = compact ? (on ? "🔊" : "🔇") : on ? "🔊 音效：開" : "🔇 音效：關";
  }

  function toggleSound() {
    const next = !SmokeCarSound.isEnabled();
    SmokeCarSound.setEnabled(next);
    SmokeCarStorage.saveSettings({ soundEnabled: next });
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  // -- home view rendering ----------------------------------------------------
  function renderHome() {
    const settings = SmokeCarStorage.getSettings();
    superEasyPercentInput.value = settings.superEasyPercent;
    themeSelect.value = GameHubStorage.getTheme();
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  function statRow(label, value) {
    return `<div class="win-stat-row"><span>${label}</span><span>${value}</span></div>`;
  }

  function renderHistory() {
    const items = SmokeCarStorage.getHistory();
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
        `<span>抵達第 ${entry.level} 關　分數 ${entry.score}　用時 ${SmokeCarGame.formatSeconds(entry.elapsedSeconds)}</span>`;
      frag.appendChild(row);
    });
    historyList.appendChild(frag);
  }

  function renderCareer() {
    const career = SmokeCarStorage.getCareer();
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
  function drawMaze(cells) {
    ctx.fillStyle = FLOOR_COLOR;
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);

    ctx.strokeStyle = WALL_COLOR;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const cell = cells[row * grid.cols + col];
        const x0 = col * grid.cell;
        const y0 = row * grid.cell;
        const x1 = x0 + grid.cell;
        const y1 = y0 + grid.cell;
        ctx.beginPath();
        if (cell.top) {
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y0);
        }
        if (cell.bottom) {
          ctx.moveTo(x0, y1);
          ctx.lineTo(x1, y1);
        }
        if (cell.left) {
          ctx.moveTo(x0, y0);
          ctx.lineTo(x0, y1);
        }
        if (cell.right) {
          ctx.moveTo(x1, y0);
          ctx.lineTo(x1, y1);
        }
        ctx.stroke();
      }
    }
  }

  function drawFlags(flags) {
    flags.forEach((f) => {
      if (f.collected) return;
      const cx = f.col * grid.cell + grid.cell / 2;
      const cy = f.row * grid.cell + grid.cell / 2;
      ctx.fillStyle = "#f2c14e";
      ctx.beginPath();
      ctx.moveTo(cx - 2, cy - 10);
      ctx.lineTo(cx - 2, cy + 10);
      ctx.lineTo(cx + 9, cy + 5);
      ctx.lineTo(cx - 2, cy);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#8a6a1a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - 2, cy - 10);
      ctx.lineTo(cx - 2, cy + 10);
      ctx.stroke();
    });
  }

  function drawSmokes(smokes) {
    smokes.forEach((s) => {
      const cx = s.col * grid.cell + grid.cell / 2;
      const cy = s.row * grid.cell + grid.cell / 2;
      const fade = Math.min(1, s.msRemaining / 600);
      ctx.globalAlpha = 0.55 + 0.35 * fade;
      ctx.fillStyle = SMOKE_COLOR;
      ctx.beginPath();
      ctx.arc(cx - 6, cy, grid.cell * 0.32, 0, Math.PI * 2);
      ctx.arc(cx + 7, cy - 4, grid.cell * 0.28, 0, Math.PI * 2);
      ctx.arc(cx, cy + 6, grid.cell * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
  }

  function drawCar(x, y, facing, color) {
    const w = grid.cell * 0.62;
    const h = grid.cell * 0.62;
    const angle = Math.atan2(facing.dy, facing.dx) - Math.PI / 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-w * 0.28, h * 0.5);
    ctx.lineTo(w * 0.28, h * 0.5);
    ctx.lineTo(w * 0.4, -h * 0.1);
    ctx.lineTo(0, -h * 0.5);
    ctx.lineTo(-w * 0.4, -h * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath();
    ctx.arc(-w * 0.16, -h * 0.05, w * 0.1, 0, Math.PI * 2);
    ctx.arc(w * 0.16, -h * 0.05, w * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function draw(state) {
    ctx.clearRect(0, 0, BOARD_W, BOARD_H);
    if (!state) return;
    drawMaze(state.cells);
    drawFlags(state.flags);
    drawSmokes(state.smokes);
    state.enemies.forEach((e, i) => drawCar(e.x, e.y, e.facing, ENEMY_COLORS[i % ENEMY_COLORS.length]));
    drawCar(state.player.x, state.player.y, state.player.facing, "#3fa9f5");

    if (state.status === "dying") {
      ctx.fillStyle = CAUGHT_FLASH;
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
    flagsDisplay.textContent = state.flags.filter((f) => f.collected).length + "/" + state.flags.length;
    smokeDisplay.textContent = String(state.smokeCharges);
    timerDisplay.textContent = SmokeCarGame.formatTime(state.elapsedMs);
    pauseBtn.disabled = state.status !== "playing" && state.status !== "paused";
    pauseBtn.textContent = state.status === "paused" ? "繼續 (Esc)" : "暫停 (Esc)";
    smokeBtn.disabled = state.status !== "playing" || state.smokeCharges <= 0;
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
      statRow("花費時間", SmokeCarGame.formatTime(state.elapsedMs)) +
      (result.isNewBestScore ? statRow("紀錄", "🏆 最佳分數！") : "") +
      (result.isNewBestLevel ? statRow("紀錄", "🏆 最高關卡！") : "");
    winModal.classList.remove("hidden");
  }

  // Bgm plays if and only if a run is actively "playing" — see the fix
  // applied to frog/js/ui.js: the RAF loop keeps ticking regardless of
  // which view is showing, so this must be unconditional (not special-
  // cased to only a couple of statuses) or leaving to this game's own
  // home screen while still "playing" would let the very next tick start
  // the bgm right back up.
  let bgmActive = false;
  function syncBgm(state) {
    const shouldPlay = !!state && state.status === "playing";
    if (shouldPlay && !bgmActive) {
      SmokeCarSound.startBgm();
      bgmActive = true;
    } else if (!shouldPlay && bgmActive) {
      SmokeCarSound.stopBgm();
      bgmActive = false;
    }
  }

  function render(state, event) {
    if (SOUND_EVENTS.has(event)) SmokeCarSound.play(event);
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
      if (SmokeCarGame.hasProgress() && !confirm("目前有進行中的遊戲，確定要開始新的一局嗎？進度將會遺失。")) {
        return;
      }
      if (difficulty === "superEasy") {
        const x = clampPercent(Number(superEasyPercentInput.value));
        superEasyPercentInput.value = x;
        SmokeCarStorage.saveSettings({ superEasyPercent: x });
      }
      SmokeCarGame.newGame(difficulty);
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
  dpadButtons.up.addEventListener("click", () => SmokeCarGame.setQueuedDir(0, -1));
  dpadButtons.down.addEventListener("click", () => SmokeCarGame.setQueuedDir(0, 1));
  dpadButtons.left.addEventListener("click", () => SmokeCarGame.setQueuedDir(-1, 0));
  dpadButtons.right.addEventListener("click", () => SmokeCarGame.setQueuedDir(1, 0));
  smokeBtn.addEventListener("click", () => SmokeCarGame.useSmoke());

  overlayActionBtn.addEventListener("click", () => SmokeCarGame.togglePause());
  pauseBtn.addEventListener("click", () => SmokeCarGame.togglePause());

  backHomeBtn.addEventListener("click", () => {
    if (SmokeCarGame.hasProgress() && !confirm("目前有進行中的遊戲，確定要返回首頁嗎？進度將會遺失。")) {
      return;
    }
    const state = SmokeCarGame.getState();
    if (state && state.status === "playing") SmokeCarGame.togglePause();
    SmokeCarSound.stopBgm();
    bgmActive = false;
    renderHome();
    showView("home");
  });

  winCloseBtn.addEventListener("click", () => {
    const state = SmokeCarGame.getState();
    SmokeCarGame.newGame(state ? state.startDifficulty : "easy");
  });

  winHomeBtn.addEventListener("click", () => {
    winModal.classList.add("hidden");
    renderHome();
    showView("home");
  });

  document.addEventListener("keydown", (e) => {
    if (gameViewEl.classList.contains("hidden")) return;
    const state = SmokeCarGame.getState();
    if (!state) return;

    if (e.key === "Escape") {
      SmokeCarGame.togglePause();
      return;
    }
    if (state.status !== "playing") return;

    if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
      e.preventDefault();
      SmokeCarGame.setQueuedDir(0, -1);
    } else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
      e.preventDefault();
      SmokeCarGame.setQueuedDir(0, 1);
    } else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
      e.preventDefault();
      SmokeCarGame.setQueuedDir(-1, 0);
    } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
      e.preventDefault();
      SmokeCarGame.setQueuedDir(1, 0);
    } else if (e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      SmokeCarGame.useSmoke();
    }
  });

  // -- boot -----------------------------------------------------------------
  SmokeCarSound.setEnabled(SmokeCarStorage.getSettings().soundEnabled !== false);
  SmokeCarGame.onChange(render);
  applyTheme(GameHubStorage.getTheme());
  renderHome();
  showView("home");
})();
