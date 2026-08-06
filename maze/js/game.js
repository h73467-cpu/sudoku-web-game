// 迷宮遊戲 (Maze) state controller: owns board state, undo stack, timer,
// win detection, persistence. No DOM access here (that's ui.js's job).
//
// Generation is a standard randomized-DFS "recursive backtracker" over a
// grid of cells with 4 walls each — carving a passage between the current
// cell and a random unvisited neighbor, backtracking when stuck. This
// produces a "perfect maze" (exactly one path between any two cells, no
// loops, no isolated areas) by construction, so there's no separate
// solvability guard needed the way the reverse-play games in this hub
// need one — every generated maze is inherently solvable.
var MazeGame = (function () {
  const TIERS = {
    easy: { size: 8 },
    medium: { size: 12 },
    hard: { size: 16 },
    expert: { size: 20 },
  };
  const MAX_HINTS = 5;

  let state = null;
  let timerInterval = null;
  let changeListener = null;

  function onChange(cb) {
    changeListener = cb;
  }
  function notify(event) {
    if (changeListener) changeListener(state, event || null);
  }

  function emptyCell() {
    return { top: true, right: true, bottom: true, left: true };
  }

  // Neighbor list as [targetIndex, directionFromCurrent].
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

  const OPPOSITE = { top: "bottom", right: "left", bottom: "top", left: "right" };

  function generateMaze(rows, cols) {
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

  function canMoveDir(cells, index, dir, rows, cols) {
    if (cells[index][dir]) return false;
    const row = Math.floor(index / cols);
    const col = index % cols;
    if (dir === "top") return row > 0;
    if (dir === "bottom") return row < rows - 1;
    if (dir === "left") return col > 0;
    return col < cols - 1;
  }

  function targetIndex(index, dir, cols) {
    if (dir === "top") return index - cols;
    if (dir === "bottom") return index + cols;
    if (dir === "left") return index - 1;
    return index + 1;
  }

  // BFS shortest path from `from` to `to` through open passages — used both
  // to guarantee the generated maze is solvable in the expected sense
  // (trivially true by construction, but double-checked below) and to
  // power the in-game hint (show the way from here).
  function shortestPath(cells, rows, cols, from, to) {
    const total = rows * cols;
    const prev = new Array(total).fill(-1);
    const visited = new Array(total).fill(false);
    visited[from] = true;
    const queue = [from];
    let qi = 0;
    while (qi < queue.length) {
      const cur = queue[qi++];
      if (cur === to) break;
      for (const dir of ["top", "right", "bottom", "left"]) {
        if (!canMoveDir(cells, cur, dir, rows, cols)) continue;
        const next = targetIndex(cur, dir, cols);
        if (visited[next]) continue;
        visited[next] = true;
        prev[next] = cur;
        queue.push(next);
      }
    }
    if (!visited[to]) return null;
    const path = [to];
    let cur = to;
    while (cur !== from) {
      cur = prev[cur];
      path.unshift(cur);
    }
    return path;
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
      rows: state.rows,
      cols: state.cols,
      cells: state.cells,
      playerIndex: state.playerIndex,
      exitIndex: state.exitIndex,
      history: state.history,
      moves: state.moves,
      hintsUsed: state.hintsUsed,
      elapsedMs: getElapsedMs(),
      status: state.status === "won" ? "won" : "playing",
    };
  }

  function deserialize(saved) {
    return {
      difficulty: saved.difficulty,
      rows: saved.rows,
      cols: saved.cols,
      cells: saved.cells,
      playerIndex: saved.playerIndex,
      exitIndex: saved.exitIndex,
      hintPath: null,
      history: Array.isArray(saved.history) ? saved.history : [],
      moves: saved.moves || 0,
      hintsUsed: saved.hintsUsed || 0,
      elapsedMs: saved.elapsedMs || 0,
      startTimestamp: Date.now(),
      status: saved.status === "won" ? "won" : "playing",
    };
  }

  function persist() {
    if (state && state.status !== "won") {
      MazeStorage.saveCurrentGame(serialize());
    }
  }

  function newGame(difficulty) {
    stopTimerInterval();
    const tier = TIERS[difficulty] || TIERS.easy;
    const rows = tier.size;
    const cols = tier.size;
    const cells = generateMaze(rows, cols);
    state = {
      difficulty,
      rows,
      cols,
      cells,
      playerIndex: 0,
      exitIndex: rows * cols - 1,
      hintPath: null,
      history: [],
      moves: 0,
      hintsUsed: 0,
      elapsedMs: 0,
      startTimestamp: Date.now(),
      status: "playing",
    };
    startTimer();
    persist();
    notify("new-game");
  }

  function resumeGame() {
    const saved = MazeStorage.loadCurrentGame();
    if (
      !saved ||
      !Array.isArray(saved.cells) ||
      !saved.rows ||
      !saved.cols ||
      saved.cells.length !== saved.rows * saved.cols
    ) {
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
    const saved = MazeStorage.loadCurrentGame();
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
    const isNewBest = MazeStorage.updateCareer(state.difficulty, elapsedSeconds, state.moves);
    MazeStorage.appendHistoryEntry({
      difficulty: state.difficulty,
      moves: state.moves,
      elapsedSeconds,
      completedAt: new Date().toISOString(),
    });
    MazeStorage.clearCurrentGame();
    state.justWon = { isNewBest };
  }

  function move(dir) {
    if (!state || state.status !== "playing") return false;
    if (!canMoveDir(state.cells, state.playerIndex, dir, state.rows, state.cols)) {
      notify("invalid");
      return false;
    }
    state.history.push(state.playerIndex);
    state.playerIndex = targetIndex(state.playerIndex, dir, state.cols);
    state.hintPath = null;
    state.moves++;
    if (state.playerIndex === state.exitIndex) {
      finishWin();
    } else {
      persist();
    }
    notify("move");
    return true;
  }

  function undo() {
    if (!state || state.status !== "playing" || state.history.length === 0) return;
    state.playerIndex = state.history.pop();
    state.hintPath = null;
    persist();
    notify("undo");
  }

  function useHint() {
    if (!state || state.status !== "playing") return;
    if (state.hintsUsed >= MAX_HINTS) {
      notify("invalid");
      return;
    }
    const path = shortestPath(state.cells, state.rows, state.cols, state.playerIndex, state.exitIndex);
    if (!path) {
      notify("invalid");
      return;
    }
    state.hintsUsed++;
    state.hintPath = path;
    persist();
    notify("hint");
  }

  function getState() {
    return state;
  }
  function getBoardSize() {
    if (!state) return { rows: TIERS.easy.size, cols: TIERS.easy.size };
    return { rows: state.rows, cols: state.cols };
  }
  function getMaxHints() {
    return MAX_HINTS;
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
    useHint,
    getState,
    getBoardSize,
    getMaxHints,
    formatTime,
    formatSeconds,
  };
})();

if (typeof window !== "undefined") {
  window.MazeGame = MazeGame;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = MazeGame;
}
