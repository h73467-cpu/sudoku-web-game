// 15 數字推盤 (Fifteen Puzzle) state controller: owns board state, undo
// stack, timer, win detection, persistence. No DOM access here (that's
// ui.js's job). Mirrors the shape of klotski/js/game.js.
//
// Difficulty scales BOTH board size and scramble depth together — grid size
// alone (keeping a fixed 4x4 board and only varying scramble steps) left
// easy/superEasy still visually overwhelming for casual/elderly players,
// since even a lightly-scrambled 16-cell board is a lot to scan. Smaller
// boards at the easy end give a quicker, more visibly achievable puzzle;
// larger boards at the hard end give real challenge. Board is scrambled by
// reverse play from the solved state (same technique as klotski/sokoban —
// scrambling backward from solved guarantees the result is solvable by
// construction).
var FifteenGame = (function () {
  const BLANK = 0;

  // Board dimensions + scramble depth per tier. superEasy deliberately does
  // NOT interpolate board size from these via the percent slider (see
  // SUPER_EASY_BOARD below) — a percent-lerp'd board size would often round
  // right back to `easy`'s own dimensions at typical percent values,
  // reproducing the exact "超簡單 barely differs from 簡單" complaint sokoban
  // had (see project memory). Instead superEasy always uses a fixed, smaller
  // board; the percent slider only tunes scramble depth within it.
  const TIERS = {
    easy: { rows: 3, cols: 3, steps: 20 },
    medium: { rows: 4, cols: 4, steps: 60 },
    hard: { rows: 5, cols: 5, steps: 120 },
    expert: { rows: 6, cols: 6, steps: 220 },
  };
  const SUPER_EASY_BOARD = { rows: 2, cols: 3 };
  const SUPER_EASY_STEPS_HIGH = 10;
  const SUPER_EASY_STEPS_LOW = 3;

  let state = null;
  let timerInterval = null;
  let changeListener = null;

  function onChange(cb) {
    changeListener = cb;
  }
  function notify(event) {
    if (changeListener) changeListener(state, event || null);
  }

  function superEasySteps(percent) {
    const x = (Math.max(10, Math.min(90, Math.round(Number(percent) || 30))) - 10) / 80;
    return Math.round(SUPER_EASY_STEPS_HIGH + (SUPER_EASY_STEPS_LOW - SUPER_EASY_STEPS_HIGH) * x);
  }

  function solvedTiles(rows, cols) {
    const t = [];
    for (let i = 1; i < rows * cols; i++) t.push(i);
    t.push(BLANK);
    return t;
  }

  function neighborsOf(index, rows, cols) {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const out = [];
    if (row > 0) out.push(index - cols);
    if (row < rows - 1) out.push(index + cols);
    if (col > 0) out.push(index - 1);
    if (col < cols - 1) out.push(index + 1);
    return out;
  }

  function isSolved(tiles) {
    for (let i = 0; i < tiles.length - 1; i++) {
      if (tiles[i] !== i + 1) return false;
    }
    return tiles[tiles.length - 1] === BLANK;
  }

  // True if swapping the blank with some neighbor would immediately win —
  // the "always exactly one move from solved" triviality caught before in
  // both klotski and sokoban's generators.
  function hasWinningMove(tiles, blankIndex, rows, cols) {
    return neighborsOf(blankIndex, rows, cols).some((n) => {
      const trial = tiles.slice();
      trial[blankIndex] = trial[n];
      trial[n] = BLANK;
      return isSolved(trial);
    });
  }

  function scrambleFromSolved(rows, cols, steps) {
    const tiles = solvedTiles(rows, cols);
    let blankIndex = tiles.length - 1;
    let lastBlankIndex = -1;
    for (let i = 0; i < steps; i++) {
      const candidates = neighborsOf(blankIndex, rows, cols).filter((n) => n !== lastBlankIndex);
      const pool = candidates.length > 0 ? candidates : neighborsOf(blankIndex, rows, cols);
      const target = pool[Math.floor(Math.random() * pool.length)];
      tiles[blankIndex] = tiles[target];
      tiles[target] = BLANK;
      lastBlankIndex = blankIndex;
      blankIndex = target;
    }

    // Guarantee the puzzle isn't solvable in 0 or 1 moves.
    let guard = 0;
    while ((isSolved(tiles) || hasWinningMove(tiles, blankIndex, rows, cols)) && guard < 3000) {
      const candidates = neighborsOf(blankIndex, rows, cols).filter((n) => n !== lastBlankIndex);
      const pool = candidates.length > 0 ? candidates : neighborsOf(blankIndex, rows, cols);
      const target = pool[Math.floor(Math.random() * pool.length)];
      tiles[blankIndex] = tiles[target];
      tiles[target] = BLANK;
      lastBlankIndex = blankIndex;
      blankIndex = target;
      guard++;
    }
    return { tiles, blankIndex };
  }

  function buildBoard(difficulty) {
    if (difficulty === "superEasy") {
      const steps = superEasySteps(FifteenStorage.getSettings().superEasyPercent);
      const board = scrambleFromSolved(SUPER_EASY_BOARD.rows, SUPER_EASY_BOARD.cols, steps);
      return { rows: SUPER_EASY_BOARD.rows, cols: SUPER_EASY_BOARD.cols, tiles: board.tiles, blankIndex: board.blankIndex };
    }
    const tier = TIERS[difficulty] || TIERS.easy;
    const board = scrambleFromSolved(tier.rows, tier.cols, tier.steps);
    return { rows: tier.rows, cols: tier.cols, tiles: board.tiles, blankIndex: board.blankIndex };
  }

  function stopTimerInterval() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }
  function startTimer() {
    state.startTimestamp = Date.now();
    stopTimerInterval();
    timerInterval = setInterval(() => {
      persist();
      notify("tick");
    }, 1000);
  }
  function getElapsedMs() {
    if (!state) return 0;
    if (state.status !== "playing") return state.elapsedMs;
    return state.elapsedMs + (Date.now() - state.startTimestamp);
  }

  function serialize() {
    return {
      difficulty: state.difficulty,
      rows: state.rows,
      cols: state.cols,
      tiles: state.tiles.slice(),
      blankIndex: state.blankIndex,
      history: state.history,
      moves: state.moves,
      elapsedMs: getElapsedMs(),
      status: state.status === "won" ? "won" : "playing",
    };
  }

  function deserialize(saved) {
    return {
      difficulty: saved.difficulty,
      rows: saved.rows,
      cols: saved.cols,
      tiles: saved.tiles.slice(),
      blankIndex: saved.blankIndex,
      history: Array.isArray(saved.history) ? saved.history : [],
      moves: saved.moves || 0,
      elapsedMs: saved.elapsedMs || 0,
      startTimestamp: Date.now(),
      status: saved.status === "won" ? "won" : "playing",
    };
  }

  function persist() {
    if (state && state.status !== "won") {
      FifteenStorage.saveCurrentGame(serialize());
    }
  }

  function newGame(difficulty) {
    stopTimerInterval();
    const board = buildBoard(difficulty);
    state = {
      difficulty,
      rows: board.rows,
      cols: board.cols,
      tiles: board.tiles,
      blankIndex: board.blankIndex,
      history: [],
      moves: 0,
      elapsedMs: 0,
      startTimestamp: Date.now(),
      status: "playing",
    };
    startTimer();
    persist();
    notify("new-game");
  }

  function resumeGame() {
    const saved = FifteenStorage.loadCurrentGame();
    if (
      !saved ||
      !Array.isArray(saved.tiles) ||
      !saved.rows ||
      !saved.cols ||
      saved.tiles.length !== saved.rows * saved.cols
    ) {
      return false;
    }
    if (saved.status !== "playing") return false;
    stopTimerInterval();
    state = deserialize(saved);
    if (state.status === "playing") startTimer();
    notify("restore");
    return true;
  }

  function hasSavedResumableGame() {
    const saved = FifteenStorage.loadCurrentGame();
    return !!(saved && saved.status === "playing");
  }

  function hasProgress() {
    if (!state) return false;
    if (state.status !== "playing") return false;
    return state.moves > 0;
  }

  function finishWin() {
    state.elapsedMs = getElapsedMs();
    state.status = "won";
    stopTimerInterval();
    const elapsedSeconds = Math.floor(state.elapsedMs / 1000);
    const isNewBest = FifteenStorage.updateCareer(state.difficulty, elapsedSeconds, state.moves);
    FifteenStorage.appendHistoryEntry({
      difficulty: state.difficulty,
      moves: state.moves,
      elapsedSeconds,
      completedAt: new Date().toISOString(),
    });
    FifteenStorage.clearCurrentGame();
    state.justWon = { isNewBest };
  }

  // Moves the tile at `index` into the blank — only legal when `index` is
  // orthogonally adjacent to the current blank position.
  function moveTile(index) {
    if (!state || state.status !== "playing") return false;
    if (!neighborsOf(state.blankIndex, state.rows, state.cols).includes(index)) {
      notify("invalid");
      return false;
    }
    state.history.push(state.blankIndex);
    state.tiles[state.blankIndex] = state.tiles[index];
    state.tiles[index] = BLANK;
    state.blankIndex = index;
    state.moves++;
    if (isSolved(state.tiles)) {
      finishWin();
    } else {
      persist();
    }
    notify("move");
    return true;
  }

  // Keyboard convenience: dr/dc describes the direction the *blank* moves.
  function moveBlank(dr, dc) {
    if (!state || state.status !== "playing") return false;
    const row = Math.floor(state.blankIndex / state.cols) + dr;
    const col = (state.blankIndex % state.cols) + dc;
    if (row < 0 || row >= state.rows || col < 0 || col >= state.cols) {
      notify("invalid");
      return false;
    }
    return moveTile(row * state.cols + col);
  }

  function undo() {
    if (!state || state.status !== "playing" || state.history.length === 0) return;
    const prevBlankIndex = state.history.pop();
    state.tiles[state.blankIndex] = state.tiles[prevBlankIndex];
    state.tiles[prevBlankIndex] = BLANK;
    state.blankIndex = prevBlankIndex;
    persist();
    notify("undo");
  }

  function getState() {
    return state;
  }
  function getBoardSize() {
    if (!state) return { rows: TIERS.medium.rows, cols: TIERS.medium.cols };
    return { rows: state.rows, cols: state.cols };
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

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", persist);
  }

  return {
    onChange,
    newGame,
    resumeGame,
    hasSavedResumableGame,
    hasProgress,
    getElapsedMs,
    moveTile,
    moveBlank,
    undo,
    getState,
    getBoardSize,
    formatTime,
    formatSeconds,
  };
})();

if (typeof window !== "undefined") {
  window.FifteenGame = FifteenGame;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = FifteenGame;
}
