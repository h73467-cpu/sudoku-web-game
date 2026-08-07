// 青蛙過河 (Frogger) state controller: owns the live state, physics update
// loop (requestAnimationFrame, delta-time based), lane/obstacle generation,
// score/lives, level-clear/game-over detection, persistence of finished-run
// stats. No DOM/canvas/audio access here (that's ui.js's job, including
// frog/js/sound.js) — same architecture as breakout/js/game.js.
//
// Endless run, same shape as breakout: pick a starting difficulty (lane
// counts + starting speed), then every level cleared spawns a harder one
// automatically (faster traffic/current, tighter gaps) rather than ending
// the game — only running out of lives is a true game over.
var FrogGame = (function () {
  const BOARD_W = 400;
  const BOARD_H = 560;
  const COLS = 9;
  const HOME_SLOT_COLS = [1, 3, 5, 7];
  const MAX_DT = 0.05; // clamp huge gaps (e.g. tab was backgrounded)
  const HOP_DURATION_MS = 130;
  const DEATH_PAUSE_MS = 700;
  const LEVEL_CLEAR_DELAY_MS = 1400;
  const MAX_SPEED_MULT = 2.2;
  const MIN_GAP_MULT = 0.55;

  const OBSTACLE_WIDTH_MULT = { car: 0.8, truck: 1.6, log: 1.4, longLog: 2.4, turtle: 1.3 };
  const ROAD_KINDS = ["car", "car", "car", "truck"];
  const RIVER_KINDS = ["log", "log", "longLog", "turtle"];

  const TIERS = {
    easy: { roadLanes: 3, riverLanes: 3, carSpeed: 70, logSpeed: 60, gap: 1.9, lives: 5 },
    medium: { roadLanes: 4, riverLanes: 3, carSpeed: 95, logSpeed: 75, gap: 1.5, lives: 4 },
    hard: { roadLanes: 5, riverLanes: 4, carSpeed: 120, logSpeed: 90, gap: 1.2, lives: 3 },
    expert: { roadLanes: 6, riverLanes: 4, carSpeed: 150, logSpeed: 105, gap: 1.0, lives: 3 },
  };
  const SUPER_EASY_FLOOR = { roadLanes: 2, riverLanes: 2, carSpeed: 50, logSpeed: 45, gap: 2.4, lives: 6 };

  const cellW = BOARD_W / COLS;

  let state = null;
  let changeListener = null;
  let rafId = null;
  let lastFrameTime = null;

  function onChange(cb) {
    changeListener = cb;
  }
  function notify(event, extra) {
    if (changeListener) changeListener(state, event || null, extra);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }

  function superEasyParams(percent) {
    const t = (clamp(Math.round(Number(percent) || 30), 10, 90) - 10) / 80;
    return {
      roadLanes: Math.round(lerp(TIERS.easy.roadLanes, SUPER_EASY_FLOOR.roadLanes, t)),
      riverLanes: Math.round(lerp(TIERS.easy.riverLanes, SUPER_EASY_FLOOR.riverLanes, t)),
      carSpeed: lerp(TIERS.easy.carSpeed, SUPER_EASY_FLOOR.carSpeed, t),
      logSpeed: lerp(TIERS.easy.logSpeed, SUPER_EASY_FLOOR.logSpeed, t),
      gap: lerp(TIERS.easy.gap, SUPER_EASY_FLOOR.gap, t),
      lives: Math.round(lerp(TIERS.easy.lives, SUPER_EASY_FLOOR.lives, t)),
    };
  }

  function tierFor(difficulty) {
    if (difficulty === "superEasy") {
      return superEasyParams(FrogStorage.getSettings().superEasyPercent);
    }
    return TIERS[difficulty] || TIERS.easy;
  }

  // Lane counts come only from the starting difficulty and stay fixed for
  // the whole run (the board layout never reflows mid-run) — difficulty
  // ramps per level via speed/gap instead, which is the actual classic-
  // Frogger difficulty axis anyway (later levels feel more frantic, not
  // structurally different).
  function buildLevel(levelNumber, base) {
    const speedMult = Math.min(MAX_SPEED_MULT, 1 + (levelNumber - 1) * 0.09);
    const gapMult = Math.max(MIN_GAP_MULT, 1 - (levelNumber - 1) * 0.035);
    return {
      roadLanes: base.roadLanes,
      riverLanes: base.riverLanes,
      carSpeed: base.carSpeed * speedMult,
      logSpeed: base.logSpeed * speedMult,
      gap: base.gap * gapMult,
    };
  }

  // -- lanes / obstacles ----------------------------------------------------
  // Every obstacle in a lane shares one kind/width/spacing, so the whole
  // lane is one seamlessly-wrapping conveyor belt: advance every obstacle's
  // x by the same velocity each frame, then wrap anything that's scrolled
  // fully offscreen back around by exactly one lane "period".
  function buildLane(row, kind, direction, speed, gapMult) {
    const width = OBSTACLE_WIDTH_MULT[kind] * cellW;
    const spacing = width + gapMult * cellW * (1 + Math.random() * 0.5);
    const count = Math.max(2, Math.ceil(BOARD_W / spacing) + 1);
    const period = count * spacing;
    const phase = Math.random() * spacing;
    const obstacles = [];
    for (let i = 0; i < count; i++) obstacles.push({ x: phase + i * spacing });
    return { row, kind, direction, speed, obstacleWidth: width, period, obstacles };
  }

  function updateLane(lane, dt) {
    const dx = lane.direction * lane.speed * dt;
    lane.obstacles.forEach((o) => {
      o.x += dx;
    });
    if (lane.direction > 0) {
      lane.obstacles.forEach((o) => {
        if (o.x > BOARD_W) o.x -= lane.period;
      });
    } else {
      lane.obstacles.forEach((o) => {
        if (o.x + lane.obstacleWidth < 0) o.x += lane.period;
      });
    }
  }

  function laneAtRow(row) {
    return state.lanes.find((l) => l.row === row);
  }

  // row 0 = home bank, then river lanes, one median strip, then road
  // lanes, then the start/safety row at the bottom.
  function laneTypeForRow(row) {
    if (row === 0) return "home";
    if (row <= state.riverLanes) return "river";
    if (row === state.riverLanes + 1) return "median";
    if (row <= state.riverLanes + 1 + state.roadLanes) return "road";
    return "start";
  }

  function cellH() {
    return state ? BOARD_H / state.totalRows : BOARD_H / 9;
  }

  function laneHitsFrog(lane) {
    if (!lane) return false;
    const ch = cellH();
    const w = cellW * 0.72;
    const h = ch * 0.72;
    const fx = state.frog.x - w / 2;
    const fy = state.frog.y - h / 2;
    const laneH = ch * 0.7;
    const ly = lane.row * ch + (ch - laneH) / 2;
    for (const obs of lane.obstacles) {
      if (fx < obs.x + lane.obstacleWidth && fx + w > obs.x && fy < ly + laneH && fy + h > ly) return true;
    }
    return false;
  }

  // -- frog -------------------------------------------------------------------
  function makeFrog(startRow) {
    const col = Math.floor(COLS / 2);
    const ch = cellH();
    return {
      col,
      row: startRow,
      x: col * cellW + cellW / 2,
      y: startRow * ch + ch / 2,
      hopping: false,
      hopFrom: null,
      hopTo: null,
      hopElapsedMs: 0,
      hopDurationMs: HOP_DURATION_MS,
      bestRowThisLife: startRow,
    };
  }

  function respawnFrog() {
    state.frog = makeFrog(state.totalRows - 1);
  }

  // Classic-Frogger rule: every home slot has to be filled before the level
  // clears, not just any one of them — each successful crossing parks a
  // frog in an empty slot and sends a fresh one back to the start, and
  // that slot is then off-limits (see tryHop's occupied-slot guard) until
  // the level resets. Landing between slots (not a slot column at all) is
  // still an immediate death.
  function onLanded() {
    const f = state.frog;
    if (f.row === 0) {
      if (HOME_SLOT_COLS.includes(f.col)) {
        state.filledHomeCols.push(f.col);
        state.score += 30;
        notify("slotFilled");
        if (state.filledHomeCols.length >= HOME_SLOT_COLS.length) {
          finishLevel();
        } else {
          respawnFrog();
        }
      } else {
        killFrog("gapFall");
      }
      return;
    }
    if (f.row < f.bestRowThisLife) {
      state.score += 10;
      f.bestRowThisLife = f.row;
    }
  }

  function updateFrogHop(dt) {
    const f = state.frog;
    if (!f.hopping) return;
    f.hopElapsedMs += dt * 1000;
    const t = Math.min(1, f.hopElapsedMs / f.hopDurationMs);
    f.x = lerp(f.hopFrom.x, f.hopTo.x, t);
    f.y = lerp(f.hopFrom.y, f.hopTo.y, t);
    if (t >= 1) {
      f.hopping = false;
      f.x = f.hopTo.x;
      f.y = f.hopTo.y;
      onLanded();
    }
  }

  // Collision/support is only ever evaluated while the frog is at rest (not
  // mid-hop) — a short, forgiving invulnerability window while airborne,
  // simpler than deriving a lane from the frog's mid-flight y and kinder
  // for this hub's casual/elderly-skewing audience than punishing a jump
  // that lands safely a frame after a car passed through.
  function evaluateResting(dt) {
    const type = laneTypeForRow(state.frog.row);
    if (type === "road") {
      if (laneHitsFrog(laneAtRow(state.frog.row))) killFrog("carHit");
    } else if (type === "river") {
      const lane = laneAtRow(state.frog.row);
      if (!laneHitsFrog(lane)) {
        killFrog("drown");
        return;
      }
      state.frog.x += lane.direction * lane.speed * dt;
      if (state.frog.x < -cellW * 0.5 || state.frog.x > BOARD_W + cellW * 0.5) {
        killFrog("edgeFall");
        return;
      }
      state.frog.col = clamp(Math.round((state.frog.x - cellW / 2) / cellW), 0, COLS - 1);
    }
  }

  function tryHop(dCol, dRow) {
    if (!state || state.status !== "playing" || state.frog.hopping) return;
    const f = state.frog;
    const newCol = clamp(f.col + dCol, 0, COLS - 1);
    const newRow = clamp(f.row + dRow, 0, state.totalRows - 1);
    if (newCol === f.col && newRow === f.row) return;
    // An occupied home slot blocks entry outright, same as a board edge —
    // there's already a frog parked there.
    if (newRow === 0 && state.filledHomeCols.includes(newCol)) {
      notify("bump");
      return;
    }
    const ch = cellH();
    f.hopFrom = { x: f.x, y: f.y };
    f.col = newCol;
    f.row = newRow;
    f.hopTo = { x: newCol * cellW + cellW / 2, y: newRow * ch + ch / 2 };
    f.hopping = true;
    f.hopElapsedMs = 0;
    notify("hop");
  }

  // -- lifecycle --------------------------------------------------------------
  function startLevel(levelNumber) {
    const base = tierFor(state.startDifficulty);
    const built = buildLevel(levelNumber, base);
    const totalRows = built.riverLanes + built.roadLanes + 3; // +home +median +start
    state.level = levelNumber;
    state.totalRows = totalRows;
    state.roadLanes = built.roadLanes;
    state.riverLanes = built.riverLanes;
    state.lanes = [];
    for (let i = 0; i < built.riverLanes; i++) {
      const row = 1 + i;
      const direction = i % 2 === 0 ? 1 : -1;
      const kind = RIVER_KINDS[Math.floor(Math.random() * RIVER_KINDS.length)];
      state.lanes.push(buildLane(row, kind, direction, built.logSpeed * (0.85 + Math.random() * 0.3), built.gap));
    }
    for (let i = 0; i < built.roadLanes; i++) {
      const row = built.riverLanes + 2 + i;
      const direction = i % 2 === 0 ? -1 : 1;
      const kind = ROAD_KINDS[Math.floor(Math.random() * ROAD_KINDS.length)];
      state.lanes.push(buildLane(row, kind, direction, built.carSpeed * (0.85 + Math.random() * 0.3), built.gap));
    }
    state.frog = makeFrog(totalRows - 1);
    state.filledHomeCols = [];
    state.status = "playing";
  }

  function newGame(difficulty) {
    const base = tierFor(difficulty);
    state = {
      startDifficulty: difficulty,
      level: 0,
      lives: base.lives,
      score: 0,
      elapsedMs: 0,
      justFinished: null,
      status: "playing",
      totalRows: 0,
      roadLanes: 0,
      riverLanes: 0,
      lanes: [],
      frog: null,
      filledHomeCols: [],
      levelClearMsRemaining: 0,
      dyingMsRemaining: 0,
      pendingGameOver: false,
      deathReason: null,
    };
    startLevel(1);
    startLoop();
    notify("new-game");
  }

  function hasProgress() {
    return (
      !!state &&
      (state.status === "playing" || state.status === "paused" || state.status === "levelClear" || state.status === "dying")
    );
  }

  function togglePause() {
    if (!state) return;
    if (state.status === "playing") state.status = "paused";
    else if (state.status === "paused") state.status = "playing";
    else return;
    notify("pause");
  }

  function finishLevel() {
    state.score += 50 + state.level * 5;
    state.status = "levelClear";
    state.levelClearMsRemaining = LEVEL_CLEAR_DELAY_MS;
    notify("levelClear");
  }

  function finishGameOver() {
    state.status = "gameover";
    const elapsedSeconds = Math.floor(state.elapsedMs / 1000);
    const result = FrogStorage.updateCareer(state.startDifficulty, state.score, state.level);
    FrogStorage.appendHistoryEntry({
      difficulty: state.startDifficulty,
      level: state.level,
      score: state.score,
      elapsedSeconds,
      completedAt: new Date().toISOString(),
    });
    state.justFinished = result;
    notify("gameover");
  }

  function killFrog(reason) {
    if (!state || state.status !== "playing") return;
    state.lives--;
    state.pendingGameOver = state.lives <= 0;
    state.status = "dying";
    state.dyingMsRemaining = DEATH_PAUSE_MS;
    state.deathReason = reason;
    notify(reason);
  }

  function update(dt) {
    if (!state) return;

    if (state.status === "dying") {
      state.dyingMsRemaining -= dt * 1000;
      if (state.dyingMsRemaining <= 0) {
        if (state.pendingGameOver) {
          finishGameOver();
        } else {
          respawnFrog();
          state.status = "playing";
        }
      }
      return;
    }
    if (state.status === "levelClear") {
      state.levelClearMsRemaining -= dt * 1000;
      if (state.levelClearMsRemaining <= 0) startLevel(state.level + 1);
      return;
    }
    if (state.status !== "playing") return;

    state.elapsedMs += dt * 1000;
    state.lanes.forEach((lane) => updateLane(lane, dt));
    updateFrogHop(dt);
    if (state.status === "playing" && !state.frog.hopping) evaluateResting(dt);
  }

  function loop(now) {
    if (!state) {
      rafId = null;
      return;
    }
    if (lastFrameTime == null) lastFrameTime = now;
    const dt = Math.min((now - lastFrameTime) / 1000, MAX_DT);
    lastFrameTime = now;

    update(dt);
    notify("tick");

    if (
      state.status === "playing" ||
      state.status === "paused" ||
      state.status === "levelClear" ||
      state.status === "dying"
    ) {
      rafId = requestAnimationFrame(loop);
    } else {
      rafId = null;
    }
  }

  function startLoop() {
    stopLoop();
    lastFrameTime = null;
    rafId = requestAnimationFrame(loop);
  }
  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    lastFrameTime = null;
  }

  function getState() {
    return state;
  }
  function getBoardSize() {
    return { width: BOARD_W, height: BOARD_H };
  }
  function getGridInfo() {
    return {
      cols: COLS,
      cellW,
      cellH: cellH(),
      totalRows: state ? state.totalRows : 9,
      homeSlotCols: HOME_SLOT_COLS,
    };
  }
  function laneTypeAt(row) {
    return state ? laneTypeForRow(row) : "start";
  }

  function formatTime(ms) {
    if (ms == null) return "--:--";
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }
  function formatSeconds(seconds) {
    return formatTime(seconds == null ? null : seconds * 1000);
  }

  return {
    onChange,
    newGame,
    hasProgress,
    togglePause,
    tryHop,
    getState,
    getBoardSize,
    getGridInfo,
    laneTypeAt,
    formatTime,
    formatSeconds,
  };
})();

if (typeof window !== "undefined") {
  window.FrogGame = FrogGame;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = FrogGame;
}
