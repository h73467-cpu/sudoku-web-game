// 15 數字推盤 (Fifteen Puzzle) state controller: owns board state, undo
// stack, timer, win detection, persistence. No DOM access here (that's
// ui.js's job). Mirrors the shape of klotski/js/game.js.
//
// Fixed classic 4x4 board (15 numbered tiles + 1 blank). Difficulty only
// changes how many random legal moves are used to scramble from the solved
// state (same reverse-play technique as klotski/sokoban — scrambling
// backward from solved guarantees the result is solvable by construction).
var FifteenGame = (function () {
  const ROWS = 4;
  const COLS = 4;
  const CELL_COUNT = ROWS * COLS;
  const BLANK = 0;

  const SOLVED_TILES = (() => {
    const t = [];
    for (let i = 1; i < CELL_COUNT; i++) t.push(i);
    t.push(BLANK);
    return t;
  })();

  // Total random legal moves applied to scramble from the solved state.
  const SCRAMBLE_STEPS = { easy: 25, medium: 60, hard: 120, expert: 220 };
  const SUPER_EASY_FLOOR_STEPS = 8;

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
    return Math.round(SCRAMBLE_STEPS.easy + (SUPER_EASY_FLOOR_STEPS - SCRAMBLE_STEPS.easy) * x);
  }

  function neighborsOf(index) {
    const row = Math.floor(index / COLS);
    const col = index % COLS;
    const out = [];
    if (row > 0) out.push(index - COLS);
    if (row < ROWS - 1) out.push(index + COLS);
    if (col > 0) out.push(index - 1);
    if (col < COLS - 1) out.push(index + 1);
    return out;
  }

  function isSolved(tiles) {
    for (let i = 0; i < CELL_COUNT - 1; i++) {
      if (tiles[i] !== i + 1) return false;
    }
    return tiles[CELL_COUNT - 1] === BLANK;
  }

  // True if swapping the blank with some neighbor would immediately win —
  // the "always exactly one move from solved" triviality caught before in
  // both klotski and sokoban's generators.
  function hasWinningMove(tiles, blankIndex) {
    return neighborsOf(blankIndex).some((n) => {
      const trial = tiles.slice();
      trial[blankIndex] = trial[n];
      trial[n] = BLANK;
      return isSolved(trial);
    });
  }

  function scrambleFromSolved(steps) {
    const tiles = SOLVED_TILES.slice();
    let blankIndex = CELL_COUNT - 1;
    let lastBlankIndex = -1;
    for (let i = 0; i < steps; i++) {
      const candidates = neighborsOf(blankIndex).filter((n) => n !== lastBlankIndex);
      const pool = candidates.length > 0 ? candidates : neighborsOf(blankIndex);
      const target = pool[Math.floor(Math.random() * pool.length)];
      tiles[blankIndex] = tiles[target];
      tiles[target] = BLANK;
      lastBlankIndex = blankIndex;
      blankIndex = target;
    }

    // Guarantee the puzzle isn't solvable in 0 or 1 moves.
    let guard = 0;
    while ((isSolved(tiles) || hasWinningMove(tiles, blankIndex)) && guard < 3000) {
      const candidates = neighborsOf(blankIndex).filter((n) => n !== lastBlankIndex);
      const pool = candidates.length > 0 ? candidates : neighborsOf(blankIndex);
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
    const steps =
      difficulty === "superEasy"
        ? superEasySteps(FifteenStorage.getSettings().superEasyPercent)
        : SCRAMBLE_STEPS[difficulty] || SCRAMBLE_STEPS.easy;
    return scrambleFromSolved(steps);
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
    if (!saved || !Array.isArray(saved.tiles) || saved.tiles.length !== CELL_COUNT) return false;
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
    if (!neighborsOf(state.blankIndex).includes(index)) {
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
    const row = Math.floor(state.blankIndex / COLS) + dr;
    const col = (state.blankIndex % COLS) + dc;
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) {
      notify("invalid");
      return false;
    }
    return moveTile(row * COLS + col);
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
    return { rows: ROWS, cols: COLS };
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
