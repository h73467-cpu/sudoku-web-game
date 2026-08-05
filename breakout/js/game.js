// Breakout state controller: owns the live state, physics update loop
// (requestAnimationFrame, delta-time based), score/lives, win/lose
// detection, persistence of finished-round stats. No DOM/canvas access
// here (that's ui.js's job) — ui.js reads getState() every "tick" and
// draws it. Real-time game, so unlike the turn-based games there's no
// per-move persistence: a round isn't resumable across a page reload,
// only completed rounds are recorded (career/history).
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

  const TIERS = {
    easy: { rows: 3, speed: 220, paddleWidth: 150, lives: 5 },
    medium: { rows: 4, speed: 260, paddleWidth: 120, lives: 4 },
    hard: { rows: 5, speed: 300, paddleWidth: 100, lives: 3 },
    expert: { rows: 6, speed: 340, paddleWidth: 85, lives: 3 },
  };
  // Floor that "超簡單" interpolates toward as the percent slider increases
  // — same "比簡單少 X%" spirit as the other games, applied across four
  // params at once instead of a single count.
  const SUPER_EASY_FLOOR = { rows: 2, speed: 150, paddleWidth: 190, lives: 6 };

  let state = null;
  let changeListener = null;
  let rafId = null;
  let lastFrameTime = null;

  function onChange(cb) {
    changeListener = cb;
  }

  function notify(event) {
    if (changeListener) changeListener(state, event || null);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function superEasyParams(percent) {
    const t = (Math.max(10, Math.min(90, Math.round(Number(percent) || 30))) - 10) / 80; // 0..1
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

  function buildBricks(rows) {
    const bricks = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < COLS; c++) {
        bricks.push({ row: r, col: c, alive: true });
      }
    }
    return bricks;
  }

  function attachBallToPaddle() {
    state.ballAttached = true;
    state.ballX = state.paddleX;
    state.ballY = PADDLE_Y - BALL_R - 1;
    state.ballVX = 0;
    state.ballVY = 0;
  }

  function newGame(difficulty) {
    const tier = tierFor(difficulty);
    state = {
      difficulty,
      rows: tier.rows,
      speed: tier.speed,
      paddleWidth: tier.paddleWidth,
      lives: tier.lives,
      bricks: buildBricks(tier.rows),
      bricksRemaining: tier.rows * COLS,
      paddleX: BOARD_W / 2,
      ballX: BOARD_W / 2,
      ballY: PADDLE_Y - BALL_R - 1,
      ballVX: 0,
      ballVY: 0,
      ballAttached: true,
      score: 0,
      elapsedMs: 0,
      status: "playing",
      justFinished: null,
    };
    startLoop();
    notify("new-game");
  }

  function hasProgress() {
    return !!state && (state.status === "playing" || state.status === "paused");
  }

  function togglePause() {
    if (!state) return;
    if (state.status === "playing") state.status = "paused";
    else if (state.status === "paused") state.status = "playing";
    else return;
    notify("pause");
  }

  function clampPaddleX(x) {
    const half = state.paddleWidth / 2;
    return Math.max(half, Math.min(BOARD_W - half, x));
  }

  function movePaddleTo(x) {
    if (!state || state.status !== "playing") return;
    state.paddleX = clampPaddleX(x);
    if (state.ballAttached) {
      state.ballX = state.paddleX;
    }
  }

  function movePaddleBy(dx) {
    if (!state || state.status !== "playing") return;
    movePaddleTo(state.paddleX + dx);
  }

  function launchBall() {
    if (!state || state.status !== "playing" || !state.ballAttached) return;
    state.ballAttached = false;
    const angle = (Math.random() * 0.6 - 0.3) * (Math.PI / 2); // +-27 degrees off vertical
    state.ballVX = state.speed * Math.sin(angle);
    state.ballVY = -Math.abs(state.speed * Math.cos(angle));
  }

  function finishRound(won) {
    state.status = won ? "won" : "lost";
    const elapsedSeconds = Math.floor(state.elapsedMs / 1000);
    const result = BreakoutStorage.updateCareer(state.difficulty, state.score, elapsedSeconds, won);
    BreakoutStorage.appendHistoryEntry({
      difficulty: state.difficulty,
      result: won ? "won" : "lost",
      score: state.score,
      elapsedSeconds,
      completedAt: new Date().toISOString(),
    });
    state.justFinished = result;
    notify(won ? "won" : "lost");
  }

  // Deliberately simplified collision response: any brick hit flips vertical
  // velocity only (no side-vs-top edge detection). Bricks are much wider
  // than tall so this reads correctly for the vast majority of hits; a
  // fully accurate AABB-vs-circle side test was judged not worth the
  // complexity for a casual arcade mode.
  function update(dt) {
    if (!state || state.status !== "playing") return;

    if (state.ballAttached) {
      state.ballX = state.paddleX;
      state.ballY = PADDLE_Y - BALL_R - 1;
      return;
    }

    state.elapsedMs += dt * 1000;
    state.ballX += state.ballVX * dt;
    state.ballY += state.ballVY * dt;

    if (state.ballX - BALL_R < 0) {
      state.ballX = BALL_R;
      state.ballVX = Math.abs(state.ballVX);
    } else if (state.ballX + BALL_R > BOARD_W) {
      state.ballX = BOARD_W - BALL_R;
      state.ballVX = -Math.abs(state.ballVX);
    }
    if (state.ballY - BALL_R < 0) {
      state.ballY = BALL_R;
      state.ballVY = Math.abs(state.ballVY);
    }

    // Paddle collision.
    const paddleLeft = state.paddleX - state.paddleWidth / 2;
    const paddleRight = state.paddleX + state.paddleWidth / 2;
    if (
      state.ballVY > 0 &&
      state.ballY + BALL_R >= PADDLE_Y &&
      state.ballY + BALL_R <= PADDLE_Y + PADDLE_H + 10 &&
      state.ballX >= paddleLeft - BALL_R &&
      state.ballX <= paddleRight + BALL_R
    ) {
      const hitPos = Math.max(-1, Math.min(1, (state.ballX - state.paddleX) / (state.paddleWidth / 2)));
      const speed = Math.hypot(state.ballVX, state.ballVY);
      const maxAngle = Math.PI / 3; // 60 degrees
      const angle = hitPos * maxAngle;
      state.ballVX = speed * Math.sin(angle);
      state.ballVY = -Math.abs(speed * Math.cos(angle));
      state.ballY = PADDLE_Y - BALL_R - 0.5;
    }

    // Brick collisions (at most one per frame).
    const bw = brickWidth();
    for (let i = 0; i < state.bricks.length; i++) {
      const brick = state.bricks[i];
      if (!brick.alive) continue;
      const bx = brickX(brick.col);
      const by = brickY(brick.row);
      if (
        state.ballX + BALL_R > bx &&
        state.ballX - BALL_R < bx + bw &&
        state.ballY + BALL_R > by &&
        state.ballY - BALL_R < by + BRICK_H
      ) {
        brick.alive = false;
        state.bricksRemaining--;
        state.score += 10;
        state.ballVY *= -1;
        break;
      }
    }

    if (state.bricksRemaining <= 0) {
      finishRound(true);
      return;
    }

    if (state.ballY - BALL_R > BOARD_H) {
      state.lives--;
      if (state.lives <= 0) {
        finishRound(false);
        return;
      }
      attachBallToPaddle();
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

    if (state.status === "playing" || state.status === "paused") {
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
