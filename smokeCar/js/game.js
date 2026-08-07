// 迷魂車 state controller: owns the live state, physics update loop
// (requestAnimationFrame, delta-time based), maze/enemy/flag generation,
// score/lives, level-clear/game-over detection, persistence of finished-
// run stats. No DOM/canvas/audio access here (that's ui.js's job,
// including smokeCar/js/sound.js) — same architecture as breakout and
// frog's game.js.
//
// Endless run, same shape as breakout/frog: pick a starting difficulty
// (enemy count/speed, smoke charges, flag count), then every level
// cleared (all flags collected) spawns a harder one automatically — more
// enemies, faster chase — until lives run out.
//
// Movement is the classic "grid maze, continuous glide" model (think
// Pac-Man): every entity has a grid cell identity (col,row) plus a
// continuous pixel position: it glides at constant speed along the
// current direction and only re-evaluates which way to go at each
// cell-center crossing (a queued direction takes effect there if legal,
// otherwise it keeps going straight, or stops if that's blocked too).
var SmokeCarGame = (function () {
  const BOARD_W = 400;
  const BOARD_H = 560;
  const CELL = 40;
  const COLS = 10;
  const ROWS = 14;
  const MAX_DT = 0.05;
  const DEATH_PAUSE_MS = 800;
  const LEVEL_CLEAR_DELAY_MS = 1500;
  const SMOKE_DURATION_MS = 5000;
  const LOOP_CHANCE = 0.15;
  const MAX_ENEMY_SPEED_MULT = 1.8;
  const MAX_ENEMIES = 6;
  const MAX_FLAGS = 12;

  const DIRS = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  const TIERS = {
    easy: { enemyCount: 1, enemySpeed: 70, playerSpeed: 112, smokeCharges: 4, flagCount: 6, randomness: 0.4, lives: 5 },
    medium: { enemyCount: 2, enemySpeed: 85, playerSpeed: 112, smokeCharges: 3, flagCount: 7, randomness: 0.25, lives: 4 },
    hard: { enemyCount: 3, enemySpeed: 100, playerSpeed: 112, smokeCharges: 3, flagCount: 8, randomness: 0.12, lives: 3 },
    expert: { enemyCount: 4, enemySpeed: 115, playerSpeed: 112, smokeCharges: 2, flagCount: 9, randomness: 0.05, lives: 3 },
  };
  const SUPER_EASY_FLOOR = { enemyCount: 1, enemySpeed: 55, playerSpeed: 112, smokeCharges: 5, flagCount: 5, randomness: 0.5, lives: 6 };

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
      enemyCount: Math.round(lerp(TIERS.easy.enemyCount, SUPER_EASY_FLOOR.enemyCount, t)),
      enemySpeed: lerp(TIERS.easy.enemySpeed, SUPER_EASY_FLOOR.enemySpeed, t),
      playerSpeed: TIERS.easy.playerSpeed,
      smokeCharges: Math.round(lerp(TIERS.easy.smokeCharges, SUPER_EASY_FLOOR.smokeCharges, t)),
      flagCount: Math.round(lerp(TIERS.easy.flagCount, SUPER_EASY_FLOOR.flagCount, t)),
      randomness: lerp(TIERS.easy.randomness, SUPER_EASY_FLOOR.randomness, t),
      lives: Math.round(lerp(TIERS.easy.lives, SUPER_EASY_FLOOR.lives, t)),
    };
  }

  function tierFor(difficulty) {
    if (difficulty === "superEasy") {
      return superEasyParams(SmokeCarStorage.getSettings().superEasyPercent);
    }
    return TIERS[difficulty] || TIERS.easy;
  }

  function buildLevel(levelNumber, base) {
    const speedMult = Math.min(MAX_ENEMY_SPEED_MULT, 1 + (levelNumber - 1) * 0.07);
    return {
      enemyCount: Math.min(MAX_ENEMIES, base.enemyCount + Math.floor((levelNumber - 1) / 2)),
      enemySpeed: base.enemySpeed * speedMult,
      playerSpeed: base.playerSpeed,
      flagCount: Math.min(MAX_FLAGS, base.flagCount + Math.floor((levelNumber - 1) / 3)),
      randomness: Math.max(0.05, base.randomness - (levelNumber - 1) * 0.02),
    };
  }

  // -- maze generation --------------------------------------------------------
  function emptyCell() {
    return { top: true, right: true, bottom: true, left: true };
  }
  const OPPOSITE = { top: "bottom", right: "left", bottom: "top", left: "right" };
  const DIR_TO_WALL = { "1,0": "right", "-1,0": "left", "0,1": "bottom", "0,-1": "top" };

  function neighborsWithDir(index, rows, cols) {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const out = [];
    if (row > 0) out.push([index - cols, "top"]);
    if (col < cols - 1) out.push([index + 1, "right"]);
    if (row < rows - 1) out.push([index + cols, "bottom"]);
    if (col > 0) out.push([index - 1, "left"]);
    return out;
  }

  function generateMazeBase(rows, cols) {
    const total = rows * cols;
    const cells = new Array(total);
    for (let i = 0; i < total; i++) cells[i] = emptyCell();
    const visited = new Array(total).fill(false);
    const stack = [0];
    visited[0] = true;
    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      const candidates = neighborsWithDir(current, rows, cols).filter(([n]) => !visited[n]);
      if (candidates.length === 0) {
        stack.pop();
        continue;
      }
      const [next, dir] = candidates[Math.floor(Math.random() * candidates.length)];
      cells[current][dir] = false;
      cells[next][OPPOSITE[dir]] = false;
      visited[next] = true;
      stack.push(next);
    }
    return cells;
  }

  // A perfect maze (spanning tree, no loops) makes evasion nearly
  // impossible — one wrong turn and there's only one way back out. Rally-
  // style mazes need alternate routes, so this knocks down a random subset
  // of remaining internal walls afterward to create loops.
  function addLoops(cells, rows, cols, chance) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (c < cols - 1 && cells[idx].right && Math.random() < chance) {
          cells[idx].right = false;
          cells[idx + 1].left = false;
        }
        if (r < rows - 1 && cells[idx].bottom && Math.random() < chance) {
          cells[idx].bottom = false;
          cells[idx + cols].top = false;
        }
      }
    }
  }

  function canMove(cells, col, row, dir, blockedFn) {
    if (!dir || (dir.dx === 0 && dir.dy === 0)) return false;
    const nc = col + dir.dx;
    const nr = row + dir.dy;
    if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) return false;
    const wallName = DIR_TO_WALL[dir.dx + "," + dir.dy];
    if (cells[row * COLS + col][wallName]) return false;
    if (blockedFn && blockedFn(nc, nr)) return false;
    return true;
  }

  function legalDirs(cells, col, row, blockedFn) {
    return DIRS.filter((d) => canMove(cells, col, row, d, blockedFn));
  }

  // BFS shortest path, returning only the first step's direction from
  // (fromCol,fromRow) toward (toCol,toRow) — recomputed once per enemy
  // per cell-center crossing (cheap: at most COLS*ROWS=140 cells), not
  // every frame.
  function bfsFirstStep(cells, fromCol, fromRow, toCol, toRow, blockedFn) {
    if (fromCol === toCol && fromRow === toRow) return null;
    const total = COLS * ROWS;
    const visited = new Array(total).fill(false);
    const prevDir = new Array(total).fill(null);
    const startIdx = fromRow * COLS + fromCol;
    visited[startIdx] = true;
    const queue = [startIdx];
    let qi = 0;
    const targetIdx = toRow * COLS + toCol;
    while (qi < queue.length) {
      const idx = queue[qi++];
      if (idx === targetIdx) break;
      const col = idx % COLS;
      const row = (idx - col) / COLS;
      for (const d of DIRS) {
        if (!canMove(cells, col, row, d, blockedFn)) continue;
        const nidx = (row + d.dy) * COLS + (col + d.dx);
        if (visited[nidx]) continue;
        visited[nidx] = true;
        prevDir[nidx] = d;
        queue.push(nidx);
      }
    }
    if (!visited[targetIdx]) return null;
    let cur = targetIdx;
    let firstDir = null;
    while (cur !== startIdx) {
      const d = prevDir[cur];
      firstDir = d;
      const col = cur % COLS;
      const row = (cur - col) / COLS;
      cur = (row - d.dy) * COLS + (col - d.dx);
    }
    return firstDir;
  }

  function bfsDistance(cells, fromCol, fromRow, toCol, toRow) {
    const total = COLS * ROWS;
    const visited = new Array(total).fill(false);
    const startIdx = fromRow * COLS + fromCol;
    visited[startIdx] = true;
    const queue = [[startIdx, 0]];
    let qi = 0;
    const targetIdx = toRow * COLS + toCol;
    while (qi < queue.length) {
      const [idx, dist] = queue[qi++];
      if (idx === targetIdx) return dist;
      const col = idx % COLS;
      const row = (idx - col) / COLS;
      for (const d of DIRS) {
        if (!canMove(cells, col, row, d)) continue;
        const nidx = (row + d.dy) * COLS + (col + d.dx);
        if (visited[nidx]) continue;
        visited[nidx] = true;
        queue.push([nidx, dist + 1]);
      }
    }
    return Infinity;
  }

  // -- entities -----------------------------------------------------------
  function cellCenter(col, row) {
    return { x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 };
  }

  function makeEntity(col, row) {
    const c = cellCenter(col, row);
    return { col, row, x: c.x, y: c.y, dir: { dx: 0, dy: 0 }, queuedDir: { dx: 0, dy: 0 }, facing: { dx: 0, dy: -1 } };
  }

  function isSmoked(state, col, row) {
    return state.smokes.some((s) => s.col === col && s.row === row);
  }

  // Distance is measured to the center of the cell being traveled TOWARD
  // (col+dir, row+dir), not the cell already occupied — checking against
  // the current cell's own center would read as "arrived" on the very
  // first frame of every new direction (since an entity always starts a
  // new direction exactly at its current cell's center), which stalls
  // movement completely instead of ever actually crossing to the next
  // cell.
  function stepEntity(e, dt, speed, cells, blockedFn) {
    if (e.dir.dx === 0 && e.dir.dy === 0) {
      if (canMove(cells, e.col, e.row, e.queuedDir, blockedFn)) {
        e.dir = e.queuedDir;
        e.facing = e.dir;
      }
      return;
    }
    const nextCol = e.col + e.dir.dx;
    const nextRow = e.row + e.dir.dy;
    const target = cellCenter(nextCol, nextRow);
    const axisPos = e.dir.dx ? e.x : e.y;
    const axisTarget = e.dir.dx ? target.x : target.y;
    const sign = e.dir.dx || e.dir.dy;
    const distToTarget = (axisTarget - axisPos) * sign;
    const step = speed * dt;
    if (distToTarget <= step) {
      e.x = target.x;
      e.y = target.y;
      e.col = nextCol;
      e.row = nextRow;
      if (canMove(cells, e.col, e.row, e.queuedDir, blockedFn)) {
        e.dir = e.queuedDir;
      } else if (!canMove(cells, e.col, e.row, e.dir, blockedFn)) {
        e.dir = { dx: 0, dy: 0 };
      }
      if (e.dir.dx || e.dir.dy) e.facing = e.dir;
      return;
    }
    e.x += e.dir.dx * step;
    e.y += e.dir.dy * step;
  }

  function enemyBlocked(state) {
    return (col, row) => isSmoked(state, col, row);
  }

  function updateEnemyAI(enemy, cells, state) {
    const blocked = enemyBlocked(state);
    // Frozen if currently sitting in an active smoke cell — can't move at
    // all until it dissipates, regardless of queuedDir.
    if (isSmoked(state, enemy.col, enemy.row)) {
      enemy.dir = { dx: 0, dy: 0 };
      enemy.queuedDir = { dx: 0, dy: 0 };
      return;
    }
    // Only re-decide when idle or exactly at a cell center (stepEntity
    // handles the actual center-detection; this just needs to keep
    // queuedDir fresh so stepEntity has something current to apply).
    const atCenter = Math.abs(enemy.x - (enemy.col * CELL + CELL / 2)) < 0.5 && Math.abs(enemy.y - (enemy.row * CELL + CELL / 2)) < 0.5;
    if (!atCenter && (enemy.dir.dx || enemy.dir.dy)) return;

    const legal = legalDirs(cells, enemy.col, enemy.row, blocked);
    if (legal.length === 0) {
      enemy.queuedDir = { dx: 0, dy: 0 };
      return;
    }
    if (Math.random() < state.randomness) {
      enemy.queuedDir = legal[Math.floor(Math.random() * legal.length)];
      return;
    }
    const chase = bfsFirstStep(cells, enemy.col, enemy.row, state.player.col, state.player.row, blocked);
    enemy.queuedDir = chase || legal[Math.floor(Math.random() * legal.length)];
  }

  // -- level setup --------------------------------------------------------
  function farCornerStarts(cells, playerCol, playerRow, count) {
    // 8 candidates so up to MAX_ENEMIES(6) can always be placed even after
    // excluding whichever one coincides with the player's own start.
    const candidates = [
      [0, 0],
      [COLS - 1, 0],
      [0, ROWS - 1],
      [COLS - 1, ROWS - 1],
      [Math.floor(COLS / 2), 0],
      [Math.floor(COLS / 2), ROWS - 1],
      [0, Math.floor(ROWS / 2)],
      [COLS - 1, Math.floor(ROWS / 2)],
    ].filter(([c, r]) => !(c === playerCol && r === playerRow));
    candidates.sort((a, b) => bfsDistance(cells, playerCol, playerRow, b[0], b[1]) - bfsDistance(cells, playerCol, playerRow, a[0], a[1]));
    return candidates.slice(0, count);
  }

  function placeFlags(cells, avoidCells, count) {
    const avoid = new Set(avoidCells.map(([c, r]) => c + "," + r));
    const flags = [];
    let guard = 0;
    while (flags.length < count && guard < count * 40) {
      guard++;
      const c = Math.floor(Math.random() * COLS);
      const r = Math.floor(Math.random() * ROWS);
      const key = c + "," + r;
      if (avoid.has(key)) continue;
      if (flags.some((f) => f.col === c && f.row === r)) continue;
      flags.push({ col: c, row: r, collected: false });
    }
    return flags;
  }

  function startLevel(levelNumber) {
    const base = tierFor(state.startDifficulty);
    const built = buildLevel(levelNumber, base);
    const cells = generateMazeBase(ROWS, COLS);
    addLoops(cells, ROWS, COLS, LOOP_CHANCE);

    const playerStart = [0, ROWS - 1];
    const enemyStarts = farCornerStarts(cells, playerStart[0], playerStart[1], built.enemyCount);
    const flags = placeFlags(cells, [playerStart, ...enemyStarts], built.flagCount);

    state.level = levelNumber;
    state.cells = cells;
    state.enemySpeed = built.enemySpeed;
    state.playerSpeed = built.playerSpeed;
    state.randomness = built.randomness;
    state.flags = flags;
    state.smokes = [];
    state.player = makeEntity(playerStart[0], playerStart[1]);
    state.enemies = enemyStarts.map(([c, r]) => makeEntity(c, r));
    state.status = "playing";
  }

  function newGame(difficulty) {
    const base = tierFor(difficulty);
    state = {
      startDifficulty: difficulty,
      level: 0,
      lives: base.lives,
      smokeCharges: base.smokeCharges,
      score: 0,
      elapsedMs: 0,
      justFinished: null,
      status: "playing",
      cells: [],
      flags: [],
      smokes: [],
      player: null,
      enemies: [],
      enemySpeed: 0,
      playerSpeed: 0,
      randomness: 0,
      levelClearMsRemaining: 0,
      dyingMsRemaining: 0,
      pendingGameOver: false,
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

  function setQueuedDir(dx, dy) {
    if (!state || state.status !== "playing") return;
    state.player.queuedDir = { dx, dy };
  }

  // Places a smoke cloud in the cell behind the player (opposite of
  // whichever way it's currently facing) — traps any enemy already
  // standing there, and blocks the cell entirely (for enemy pathing and
  // movement both) until it dissipates.
  function useSmoke() {
    if (!state || state.status !== "playing" || state.smokeCharges <= 0) return false;
    const behindCol = clamp(state.player.col - state.player.facing.dx, 0, COLS - 1);
    const behindRow = clamp(state.player.row - state.player.facing.dy, 0, ROWS - 1);
    const existing = state.smokes.find((s) => s.col === behindCol && s.row === behindRow);
    if (existing) {
      existing.msRemaining = SMOKE_DURATION_MS;
    } else {
      state.smokes.push({ col: behindCol, row: behindRow, msRemaining: SMOKE_DURATION_MS });
    }
    state.smokeCharges--;
    notify("smoke");
    return true;
  }

  function finishLevel() {
    state.score += 100 + state.level * 10;
    state.status = "levelClear";
    state.levelClearMsRemaining = LEVEL_CLEAR_DELAY_MS;
    notify("levelClear");
  }

  function finishGameOver() {
    state.status = "gameover";
    const elapsedSeconds = Math.floor(state.elapsedMs / 1000);
    const result = SmokeCarStorage.updateCareer(state.startDifficulty, state.score, state.level);
    SmokeCarStorage.appendHistoryEntry({
      difficulty: state.startDifficulty,
      level: state.level,
      score: state.score,
      elapsedSeconds,
      completedAt: new Date().toISOString(),
    });
    state.justFinished = result;
    notify("gameover");
  }

  function catchPlayer() {
    if (!state || state.status !== "playing") return;
    state.lives--;
    state.pendingGameOver = state.lives <= 0;
    state.status = "dying";
    state.dyingMsRemaining = DEATH_PAUSE_MS;
    notify("caught");
  }

  function respawnPlayer() {
    const c = cellCenter(0, ROWS - 1);
    state.player = { col: 0, row: ROWS - 1, x: c.x, y: c.y, dir: { dx: 0, dy: 0 }, queuedDir: { dx: 0, dy: 0 }, facing: { dx: 0, dy: -1 } };
  }

  function checkFlagPickup() {
    const p = state.player;
    for (const flag of state.flags) {
      if (!flag.collected && flag.col === p.col && flag.row === p.row) {
        flag.collected = true;
        state.score += 20;
        notify("flag");
      }
    }
    if (state.flags.every((f) => f.collected)) finishLevel();
  }

  function checkCaught() {
    const p = state.player;
    for (const e of state.enemies) {
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      if (Math.hypot(dx, dy) < CELL * 0.55) {
        catchPlayer();
        return;
      }
    }
  }

  function update(dt) {
    if (!state) return;

    if (state.status === "dying") {
      state.dyingMsRemaining -= dt * 1000;
      if (state.dyingMsRemaining <= 0) {
        if (state.pendingGameOver) {
          finishGameOver();
        } else {
          respawnPlayer();
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

    for (let i = state.smokes.length - 1; i >= 0; i--) {
      state.smokes[i].msRemaining -= dt * 1000;
      if (state.smokes[i].msRemaining <= 0) state.smokes.splice(i, 1);
    }

    stepEntity(state.player, dt, state.playerSpeed, state.cells, null);
    state.enemies.forEach((e) => {
      updateEnemyAI(e, state.cells, state);
      stepEntity(e, dt, state.enemySpeed, state.cells, enemyBlocked(state));
    });

    checkFlagPickup();
    if (state.status === "playing") checkCaught();
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
    return { cols: COLS, rows: ROWS, cell: CELL };
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
    setQueuedDir,
    useSmoke,
    getState,
    getBoardSize,
    getGridInfo,
    formatTime,
    formatSeconds,
  };
})();

if (typeof window !== "undefined") {
  window.SmokeCarGame = SmokeCarGame;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = SmokeCarGame;
}
