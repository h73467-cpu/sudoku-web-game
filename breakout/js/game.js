// Breakout state controller: owns the live state, physics update loop
// (requestAnimationFrame, delta-time based), power-ups, procedural level
// generation, score/lives, level-clear/game-over detection, persistence of
// finished-run stats. No DOM/canvas/audio access here (that's ui.js's job,
// including breakout/js/sound.js) — ui.js reads getState() every "tick"
// and draws it, and maps other notify() event names to sound effects.
//
// Unlike the turn-based games, this is an endless run: clearing a level
// auto-generates a harder one instead of ending the game (see startLevel).
// Only "gameover" (all lives lost) is a true terminal state; a round isn't
// resumable across a page reload, only completed runs are recorded.
var BreakoutGame = (function () {
  const BOARD_W = 400;
  const BOARD_H = 560;
  const COLS = 8;
  const BRICK_H = 22;
  const BRICK_GAP = 5;
  const BRICK_TOP = 46;
  const PADDLE_Y = BOARD_H - 44;
  const PADDLE_H = 16;
  const BALL_R = 8;
  const MAX_DT = 0.05; // clamp huge gaps (e.g. tab was backgrounded)
  const MAX_ROWS = 10;
  const MAX_SPEED = 460;
  const MAX_BALLS = 6;
  const EFFECT_DURATION_MS = 10000;
  const FIRE_INTERVAL_MS = 260;
  const BULLET_SPEED = 480;
  const POWERUP_FALL_SPEED = 130;
  const LEVEL_CLEAR_DELAY_MS = 1600;
  const GOOD_TYPES = ["multiBall", "paddleGrow", "machineGun", "extraLife"];
  const BAD_TYPES = ["paddleShrink", "fastBall"];

  const TIERS = {
    easy: { rows: 3, speed: 220, paddleWidth: 150, lives: 5 },
    medium: { rows: 4, speed: 260, paddleWidth: 120, lives: 4 },
    hard: { rows: 5, speed: 300, paddleWidth: 100, lives: 3 },
    expert: { rows: 6, speed: 340, paddleWidth: 85, lives: 3 },
  };
  const SUPER_EASY_FLOOR = { rows: 2, speed: 150, paddleWidth: 190, lives: 6 };

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

  function superEasyParams(percent) {
    const t = (Math.max(10, Math.min(90, Math.round(Number(percent) || 30))) - 10) / 80;
    return {
      rows: Math.round(lerp(TIERS.easy.rows, SUPER_EASY_FLOOR.rows, t)),
      speed: Math.round(lerp(TIERS.easy.speed, SUPER_EASY_FLOOR.speed, t)),
      paddleWidth: Math.round(lerp(TIERS.easy.paddleWidth, SUPER_EASY_FLOOR.paddleWidth, t)),
      lives: Math.round(lerp(TIERS.easy.lives, SUPER_EASY_FLOOR.lives, t)),
    };
  }

  function tierFor(difficulty) {
    if (difficulty === "superEasy") {
      return superEasyParams(BreakoutStorage.getSettings().superEasyPercent);
    }
    return TIERS[difficulty] || TIERS.easy;
  }

  function brickWidth() {
    return (BOARD_W - BRICK_GAP * (COLS + 1)) / COLS;
  }
  function brickX(col) {
    return BRICK_GAP + col * (brickWidth() + BRICK_GAP);
  }
  function brickY(row) {
    return BRICK_TOP + row * (BRICK_H + BRICK_GAP);
  }

  // -- procedural level layouts ---------------------------------------------
  // Each returns { positions: [{row,col}], hpOverrides: {"r,c": hp} }.

  function layoutFullGrid(rows, cols) {
    const positions = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) positions.push({ row: r, col: c });
    }
    return { positions, hpOverrides: {} };
  }

  function layoutPyramid(rows, cols) {
    const positions = [];
    for (let r = 0; r < rows; r++) {
      const width = Math.max(2, cols - r);
      const start = Math.floor((cols - width) / 2);
      for (let c = start; c < start + width; c++) positions.push({ row: r, col: c });
    }
    return { positions, hpOverrides: {} };
  }

  function layoutCheckerGaps(rows, cols) {
    const positions = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if ((r + c) % 2 === 0) positions.push({ row: r, col: c });
      }
    }
    return { positions, hpOverrides: {} };
  }

  // "Hidden chamber": a walled room with a single gap in its bottom wall
  // (facing the paddle) containing tougher bricks. No special collision
  // code needed — the wall bricks naturally block the ball like any other
  // brick, so the ball can only reach the interior by entering the gap.
  function layoutChamber(rows, cols) {
    const positions = [];
    const hpOverrides = {};
    const topRows = Math.max(0, Math.min(2, rows - 3));
    for (let r = 0; r < topRows; r++) {
      for (let c = 0; c < cols; c++) positions.push({ row: r, col: c });
    }
    const roomTop = topRows;
    const roomHeight = 3;
    const roomWidth = Math.min(4, cols - 2);
    const roomLeft = Math.floor((cols - roomWidth) / 2);
    const gapCol = roomLeft + Math.floor(roomWidth / 2);
    for (let r = roomTop; r < roomTop + roomHeight; r++) {
      for (let c = roomLeft; c < roomLeft + roomWidth; c++) {
        const isBorder = r === roomTop || r === roomTop + roomHeight - 1 || c === roomLeft || c === roomLeft + roomWidth - 1;
        const isGap = r === roomTop + roomHeight - 1 && c === gapCol;
        if (isBorder && !isGap) {
          positions.push({ row: r, col: c });
        } else if (!isBorder) {
          positions.push({ row: r, col: c });
          hpOverrides[r + "," + c] = 3;
        }
      }
    }
    return { positions, hpOverrides };
  }

  function weightedPick(options) {
    const total = options.reduce((sum, o) => sum + o.weight, 0);
    let r = Math.random() * total;
    for (const o of options) {
      if (r < o.weight) return o.fn;
      r -= o.weight;
    }
    return options[options.length - 1].fn;
  }

  function pickLayout(levelNumber, rows, cols) {
    if (levelNumber <= 2) return layoutFullGrid(rows, cols);
    const options = [
      { fn: layoutFullGrid, weight: 3 },
      { fn: layoutPyramid, weight: 2 },
      { fn: layoutCheckerGaps, weight: 2 },
    ];
    if (rows >= 5) {
      options.push({ fn: layoutChamber, weight: 2 + Math.min(levelNumber - 2, 6) * 0.3 });
    }
    return weightedPick(options)(rows, cols);
  }

  function buildBricks(levelNumber, rows, cols) {
    const { positions, hpOverrides } = pickLayout(levelNumber, rows, cols);
    const hp2Chance = Math.min(0.4, levelNumber * 0.04);
    const hp3Chance = Math.min(0.18, Math.max(0, levelNumber - 4) * 0.03);
    return positions.map(({ row, col }) => {
      let hp = hpOverrides[row + "," + col];
      if (hp == null) {
        const roll = Math.random();
        hp = roll < hp3Chance ? 3 : roll < hp3Chance + hp2Chance ? 2 : 1;
      }
      return { row, col, alive: true, hp, maxHp: hp };
    });
  }

  function buildLevel(levelNumber, base) {
    const rows = Math.min(base.rows + Math.floor((levelNumber - 1) / 2), MAX_ROWS);
    const speed = Math.min(base.speed + (levelNumber - 1) * 12, MAX_SPEED);
    const bricks = buildBricks(levelNumber, rows, COLS);
    return { rows, speed, bricks };
  }

  // -- balls / paddle ---------------------------------------------------------
  function attachNewBall() {
    return { x: state.paddleX, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0, attached: true };
  }

  function effectivePaddleWidth() {
    let w = state.basePaddleWidth;
    if (state.effects.paddleGrow > 0) w *= 1.5;
    if (state.effects.paddleShrink > 0) w *= 0.6;
    return Math.max(40, w);
  }

  function clampPaddleX(x) {
    const half = state.paddleWidth / 2;
    return Math.max(half, Math.min(BOARD_W - half, x));
  }

  function movePaddleTo(x) {
    if (!state || state.status !== "playing") return;
    state.paddleX = clampPaddleX(x);
  }

  function movePaddleBy(dx) {
    if (!state || state.status !== "playing") return;
    movePaddleTo(state.paddleX + dx);
  }

  function launchBall() {
    if (!state || state.status !== "playing") return;
    const ball = state.balls.find((b) => b.attached);
    if (!ball) return;
    ball.attached = false;
    const angle = (Math.random() * 0.6 - 0.3) * (Math.PI / 2);
    ball.vx = state.speed * Math.sin(angle);
    ball.vy = -Math.abs(state.speed * Math.cos(angle));
  }

  function rotate(vx, vy, angleRad) {
    return {
      vx: vx * Math.cos(angleRad) - vy * Math.sin(angleRad),
      vy: vx * Math.sin(angleRad) + vy * Math.cos(angleRad),
    };
  }

  // -- power-ups ----------------------------------------------------------
  function pickPowerUpType() {
    const pool = Math.random() < 0.65 ? GOOD_TYPES : BAD_TYPES;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function maybeDropPowerUp(brick) {
    const dropChance = 0.16 + Math.min(state.level, 10) * 0.005;
    if (Math.random() > dropChance) return;
    state.powerUps.push({
      x: brickX(brick.col) + brickWidth() / 2,
      y: brickY(brick.row) + BRICK_H / 2,
      type: pickPowerUpType(),
    });
  }

  function applyMultiBall() {
    const source = state.balls.find((b) => !b.attached);
    if (!source) return;
    const toAdd = Math.min(2, MAX_BALLS - state.balls.length);
    for (let i = 0; i < toAdd; i++) {
      const v = rotate(source.vx, source.vy, i === 0 ? 0.35 : -0.35);
      state.balls.push({ x: source.x, y: source.y, vx: v.vx, vy: v.vy, attached: false });
    }
  }

  function applyPowerUp(type) {
    switch (type) {
      case "multiBall":
        applyMultiBall();
        break;
      case "paddleGrow":
        state.effects.paddleGrow = EFFECT_DURATION_MS;
        break;
      case "paddleShrink":
        state.effects.paddleShrink = EFFECT_DURATION_MS;
        break;
      case "machineGun":
        state.effects.machineGun = EFFECT_DURATION_MS;
        state.gunCooldown = 0;
        break;
      case "fastBall":
        state.effects.fastBall = EFFECT_DURATION_MS;
        state.balls.forEach((b) => {
          if (!b.attached) {
            b.vx *= 1.4;
            b.vy *= 1.4;
          }
        });
        break;
      case "extraLife":
        state.lives++;
        break;
    }
  }

  function updatePowerUps(dt) {
    const paddleLeft = state.paddleX - state.paddleWidth / 2;
    const paddleRight = state.paddleX + state.paddleWidth / 2;
    for (let i = state.powerUps.length - 1; i >= 0; i--) {
      const p = state.powerUps[i];
      p.y += POWERUP_FALL_SPEED * dt;
      if (p.y >= PADDLE_Y && p.y <= PADDLE_Y + PADDLE_H && p.x >= paddleLeft - 12 && p.x <= paddleRight + 12) {
        applyPowerUp(p.type);
        notify(GOOD_TYPES.includes(p.type) ? "powerupGood" : "powerupBad");
        state.powerUps.splice(i, 1);
      } else if (p.y - 12 > BOARD_H) {
        state.powerUps.splice(i, 1);
      }
    }
  }

  function tickEffects(dtMs) {
    ["paddleGrow", "paddleShrink", "machineGun"].forEach((key) => {
      if (state.effects[key] > 0) {
        state.effects[key] = Math.max(0, state.effects[key] - dtMs);
      }
    });
    if (state.effects.fastBall > 0) {
      state.effects.fastBall -= dtMs;
      if (state.effects.fastBall <= 0) {
        state.effects.fastBall = 0;
        state.balls.forEach((b) => {
          if (!b.attached) {
            b.vx /= 1.4;
            b.vy /= 1.4;
          }
        });
      }
    }
  }

  // -- bricks / bullets ---------------------------------------------------
  function damageBrick(brick) {
    brick.hp--;
    state.score += 10;
    if (brick.hp <= 0) {
      brick.alive = false;
      state.bricksRemaining--;
      state.combo++;
      notify("brickBreak");
      maybeDropPowerUp(brick);
    } else {
      notify("brick");
    }
  }

  function updateBullets(dt) {
    const bw = brickWidth();
    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const b = state.bullets[i];
      b.y -= BULLET_SPEED * dt;
      if (b.y < 0) {
        state.bullets.splice(i, 1);
        continue;
      }
      for (const brick of state.bricks) {
        if (!brick.alive) continue;
        const bx = brickX(brick.col);
        const by = brickY(brick.row);
        if (b.x > bx && b.x < bx + bw && b.y > by && b.y < by + BRICK_H) {
          damageBrick(brick);
          state.bullets.splice(i, 1);
          break;
        }
      }
    }
  }

  // -- lifecycle ------------------------------------------------------------
  function startLevel(levelNumber) {
    const base = tierFor(state.startDifficulty);
    const built = buildLevel(levelNumber, base);
    state.level = levelNumber;
    state.rows = built.rows;
    state.speed = built.speed;
    state.bricks = built.bricks;
    state.bricksRemaining = built.bricks.length;
    state.basePaddleWidth = base.paddleWidth;
    state.paddleWidth = state.basePaddleWidth;
    state.effects = { paddleGrow: 0, paddleShrink: 0, machineGun: 0, fastBall: 0 };
    state.powerUps = [];
    state.bullets = [];
    state.gunCooldown = 0;
    state.combo = 0;
    state.balls = [attachNewBall()];
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
      rows: 0,
      speed: 0,
      bricks: [],
      bricksRemaining: 0,
      basePaddleWidth: base.paddleWidth,
      paddleWidth: base.paddleWidth,
      paddleX: BOARD_W / 2,
      balls: [],
      effects: { paddleGrow: 0, paddleShrink: 0, machineGun: 0, fastBall: 0 },
      powerUps: [],
      bullets: [],
      gunCooldown: 0,
      combo: 0,
      levelClearMsRemaining: 0,
    };
    startLevel(1);
    startLoop();
    notify("new-game");
  }

  function hasProgress() {
    return !!state && (state.status === "playing" || state.status === "paused" || state.status === "levelClear");
  }

  function togglePause() {
    if (!state) return;
    if (state.status === "playing") state.status = "paused";
    else if (state.status === "paused") state.status = "playing";
    else return;
    notify("pause");
  }

  function finishGameOver() {
    state.status = "gameover";
    const elapsedSeconds = Math.floor(state.elapsedMs / 1000);
    const result = BreakoutStorage.updateCareer(state.startDifficulty, state.score, state.level);
    BreakoutStorage.appendHistoryEntry({
      difficulty: state.startDifficulty,
      level: state.level,
      score: state.score,
      elapsedSeconds,
      completedAt: new Date().toISOString(),
    });
    state.justFinished = result;
    notify("gameover");
  }

  // Deliberately simplified collision response: any brick hit flips vertical
  // velocity only (no side-vs-top edge detection) — bricks are much wider
  // than tall so this reads correctly for the vast majority of hits.
  function update(dt) {
    if (!state) return;

    if (state.status === "levelClear") {
      state.levelClearMsRemaining -= dt * 1000;
      if (state.levelClearMsRemaining <= 0) {
        startLevel(state.level + 1);
      }
      return;
    }
    if (state.status !== "playing") return;

    state.elapsedMs += dt * 1000;
    state.paddleWidth = effectivePaddleWidth();
    state.paddleX = clampPaddleX(state.paddleX);

    tickEffects(dt * 1000);
    updatePowerUps(dt);
    updateBullets(dt);
    if (state.effects.machineGun > 0) {
      state.gunCooldown -= dt * 1000;
      if (state.gunCooldown <= 0) {
        state.bullets.push({ x: state.paddleX, y: PADDLE_Y - 4 });
        state.gunCooldown = FIRE_INTERVAL_MS;
      }
    }

    const bw = brickWidth();
    const paddleLeft = state.paddleX - state.paddleWidth / 2;
    const paddleRight = state.paddleX + state.paddleWidth / 2;

    state.balls.forEach((ball) => {
      if (ball.attached) {
        ball.x = state.paddleX;
        ball.y = PADDLE_Y - BALL_R - 1;
        return;
      }
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      if (ball.x - BALL_R < 0) {
        ball.x = BALL_R;
        ball.vx = Math.abs(ball.vx);
        notify("wall");
      } else if (ball.x + BALL_R > BOARD_W) {
        ball.x = BOARD_W - BALL_R;
        ball.vx = -Math.abs(ball.vx);
        notify("wall");
      }
      if (ball.y - BALL_R < 0) {
        ball.y = BALL_R;
        ball.vy = Math.abs(ball.vy);
        notify("wall");
      }

      if (
        ball.vy > 0 &&
        ball.y + BALL_R >= PADDLE_Y &&
        ball.y + BALL_R <= PADDLE_Y + PADDLE_H + 10 &&
        ball.x >= paddleLeft - BALL_R &&
        ball.x <= paddleRight + BALL_R
      ) {
        const hitPos = Math.max(-1, Math.min(1, (ball.x - state.paddleX) / (state.paddleWidth / 2)));
        const speed = Math.hypot(ball.vx, ball.vy);
        const angle = hitPos * (Math.PI / 3);
        ball.vx = speed * Math.sin(angle);
        ball.vy = -Math.abs(speed * Math.cos(angle));
        ball.y = PADDLE_Y - BALL_R - 0.5;
        state.combo++;
        notify("paddle", { combo: state.combo });
      }

      for (const brick of state.bricks) {
        if (!brick.alive) continue;
        const bx = brickX(brick.col);
        const by = brickY(brick.row);
        if (
          ball.x + BALL_R > bx &&
          ball.x - BALL_R < bx + bw &&
          ball.y + BALL_R > by &&
          ball.y - BALL_R < by + BRICK_H
        ) {
          ball.vy *= -1;
          damageBrick(brick);
          break;
        }
      }
    });

    state.balls = state.balls.filter((b) => b.attached || b.y - BALL_R <= BOARD_H);
    if (state.balls.length === 0) {
      state.lives--;
      notify("lifeLost");
      if (state.lives <= 0) {
        finishGameOver();
        return;
      }
      state.combo = 0;
      state.balls = [attachNewBall()];
    }

    if (state.bricksRemaining <= 0) {
      state.status = "levelClear";
      state.levelClearMsRemaining = LEVEL_CLEAR_DELAY_MS;
      notify("levelClear");
    }
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

    if (state.status === "playing" || state.status === "paused" || state.status === "levelClear") {
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

  function getBrickGeometry() {
    return { width: brickWidth(), height: BRICK_H, gap: BRICK_GAP, top: BRICK_TOP };
  }

  function getPaddleGeometry() {
    return { y: PADDLE_Y, height: PADDLE_H, ballRadius: BALL_R };
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
    movePaddleTo,
    movePaddleBy,
    launchBall,
    getState,
    getBoardSize,
    getBrickGeometry,
    getPaddleGeometry,
    formatTime,
    formatSeconds,
  };
})();

if (typeof window !== "undefined") {
  window.BreakoutGame = BreakoutGame;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = BreakoutGame;
}
