// 2048 state controller: owns board state, undo stack, timer, win/lose
// detection, persistence. No DOM access here (that's ui.js's job).
//
// Difficulty here is the inverse of most games in this hub: a SMALLER
// board is actually HARDER in 2048 (less room to maneuver tiles), not
// easier. So difficulty is board size + win target together, tuned so the
// progression still feels right: 簡單 gets a bigger board and a modest
// target (lots of room, easy win), 專家 gets the smallest board with a
// real target (tightest, least forgiving). No 超簡單 tier — board size
// already IS the difficulty knob in both directions here, there's no
// separate axis left to tune.
var Game2048 = (function () {
  const TIERS = {
    easy: { size: 5, target: 256 },
    medium: { size: 4, target: 1024 },
    hard: { size: 4, target: 2048 },
    expert: { size: 3, target: 512 },
  };

  let state = null;
  let timerInterval = null;
  let changeListener = null;

  function onChange(cb) {
    changeListener = cb;
  }
  function notify(event) {
    if (changeListener) changeListener(state, event || null);
  }

  function emptyCells(board) {
    const out = [];
    for (let i = 0; i < board.length; i++) if (board[i] === 0) out.push(i);
    return out;
  }

  function spawnRandomTile(board) {
    const empties = emptyCells(board);
    if (empties.length === 0) return false;
    const idx = empties[Math.floor(Math.random() * empties.length)];
    board[idx] = Math.random() < 0.9 ? 2 : 4;
    return true;
  }

  // Generic line access so all 4 directions share one slide/merge routine:
  // a "line" is `size` cells starting at `startIdx` stepping by `step`.
  function getLine(board, size, startIdx, step) {
    const out = [];
    for (let i = 0; i < size; i++) out.push(board[startIdx + i * step]);
    return out;
  }
  function setLine(board, size, startIdx, step, values) {
    for (let i = 0; i < size; i++) board[startIdx + i * step] = values[i];
  }

  function lineStarts(size, direction) {
    // Returns [{startIdx, step}] for each of the `size` lines needed for
    // this direction, always ordered so slideLeft() means "toward the
    // start of the line" for that direction.
    const lines = [];
    if (direction === "left") {
      for (let r = 0; r < size; r++) lines.push({ startIdx: r * size, step: 1 });
    } else if (direction === "right") {
      for (let r = 0; r < size; r++) lines.push({ startIdx: r * size + size - 1, step: -1 });
    } else if (direction === "up") {
      for (let c = 0; c < size; c++) lines.push({ startIdx: c, step: size });
    } else {
      for (let c = 0; c < size; c++) lines.push({ startIdx: c + (size - 1) * size, step: -size });
    }
    return lines;
  }

  function slideAndMergeLine(line) {
    const nonZero = line.filter((v) => v !== 0);
    const merged = [];
    let scoreGained = 0;
    for (let i = 0; i < nonZero.length; i++) {
      if (i < nonZero.length - 1 && nonZero[i] === nonZero[i + 1]) {
        const value = nonZero[i] * 2;
        merged.push(value);
        scoreGained += value;
        i++;
      } else {
        merged.push(nonZero[i]);
      }
    }
    while (merged.length < line.length) merged.push(0);
    return { line: merged, scoreGained };
  }

  function arraysEqual(a, b) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // Applies one slide in `direction`. Returns whether the board actually
  // changed (a no-op move — sliding into a wall with nothing to merge —
  // doesn't consume a turn or spawn a new tile, matching real 2048).
  function applyMove(board, size, direction) {
    let changed = false;
    let scoreGained = 0;
    for (const { startIdx, step } of lineStarts(size, direction)) {
      const original = getLine(board, size, startIdx, step);
      const result = slideAndMergeLine(original);
      if (!arraysEqual(original, result.line)) changed = true;
      scoreGained += result.scoreGained;
      setLine(board, size, startIdx, step, result.line);
    }
    return { changed, scoreGained };
  }

  function hasAnyMove(board, size) {
    if (emptyCells(board).length > 0) return true;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const idx = r * size + c;
        const v = board[idx];
        if (c < size - 1 && board[idx + 1] === v) return true;
        if (r < size - 1 && board[idx + size] === v) return true;
      }
    }
    return false;
  }

  function maxTile(board) {
    return board.reduce((m, v) => Math.max(m, v), 0);
  }

  // -- timer / persistence ------------------------------------------------

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
      size: state.size,
      target: state.target,
      board: state.board.slice(),
      score: state.score,
      history: state.history,
      moves: state.moves,
      elapsedMs: getElapsedMs(),
      status: state.status === "playing" ? "playing" : state.status,
    };
  }

  function deserialize(saved) {
    return {
      difficulty: saved.difficulty,
      size: saved.size,
      target: saved.target,
      board: saved.board.slice(),
      score: saved.score || 0,
      history: Array.isArray(saved.history) ? saved.history : [],
      moves: saved.moves || 0,
      elapsedMs: saved.elapsedMs || 0,
      startTimestamp: Date.now(),
      status: saved.status === "won" || saved.status === "lost" ? saved.status : "playing",
    };
  }

  function persist() {
    if (state && state.status === "playing") {
      Game2048Storage.saveCurrentGame(serialize());
    }
  }

  function newGame(difficulty) {
    stopTimerInterval();
    const tier = TIERS[difficulty] || TIERS.medium;
    const board = new Array(tier.size * tier.size).fill(0);
    spawnRandomTile(board);
    spawnRandomTile(board);
    state = {
      difficulty,
      size: tier.size,
      target: tier.target,
      board,
      score: 0,
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
    const saved = Game2048Storage.loadCurrentGame();
    if (!saved || !Array.isArray(saved.board) || !saved.size || saved.board.length !== saved.size * saved.size) {
      return false;
    }
    if (saved.status !== "playing") return false;
    stopTimerInterval();
    state = deserialize(saved);
    startTimer();
    notify("restore");
    return true;
  }

  function hasSavedResumableGame() {
    const saved = Game2048Storage.loadCurrentGame();
    return !!(saved && saved.status === "playing");
  }

  function hasProgress() {
    if (!state) return false;
    if (state.status !== "playing") return false;
    return state.moves > 0;
  }

  function finishGame(status) {
    state.elapsedMs = getElapsedMs();
    state.status = status;
    stopTimerInterval();
    const elapsedSeconds = Math.floor(state.elapsedMs / 1000);
    const isNewBest = Game2048Storage.updateCareer(state.difficulty, state.score, maxTile(state.board), status === "won");
    if (status === "won") state.justWon = { isNewBest };
    Game2048Storage.appendHistoryEntry({
      difficulty: state.difficulty,
      status,
      score: state.score,
      maxTile: maxTile(state.board),
      moves: state.moves,
      elapsedSeconds,
      completedAt: new Date().toISOString(),
    });
    Game2048Storage.clearCurrentGame();
  }

  function move(direction) {
    if (!state || state.status !== "playing") return false;
    const before = state.board.slice();
    const result = applyMove(state.board, state.size, direction);
    if (!result.changed) {
      notify("invalid");
      return false;
    }
    state.history.push({ board: before, score: state.score });
    state.score += result.scoreGained;
    spawnRandomTile(state.board);
    state.moves++;

    if (maxTile(state.board) >= state.target) {
      finishGame("won");
    } else if (!hasAnyMove(state.board, state.size)) {
      finishGame("lost");
    } else {
      persist();
    }
    notify("move");
    return true;
  }

  function undo() {
    if (!state || state.status !== "playing" || state.history.length === 0) return;
    const last = state.history.pop();
    state.board = last.board;
    state.score = last.score;
    persist();
    notify("undo");
  }

  function getState() {
    return state;
  }
  function getBoardSize() {
    if (!state) return { rows: TIERS.medium.size, cols: TIERS.medium.size };
    return { rows: state.size, cols: state.size };
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
    move,
    undo,
    getState,
    getBoardSize,
    formatTime,
    formatSeconds,
  };
})();

if (typeof window !== "undefined") {
  window.Game2048 = Game2048;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = Game2048;
}
