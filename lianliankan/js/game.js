// 連連看 (tile-matching) state controller: owns board state, undo stack,
// timer, win detection, persistence. No DOM access here (that's ui.js's
// job). Mirrors the shape of jigsaw/js/game.js (the other click-to-select
// grid game), adapted for pair-matching with connect-path validation.
var LianliankanGame = (function () {
  const EMPTY = -1;

  // Difficulty scales board size (same lesson as every grid game in this
  // hub: size is what casual/elderly players actually feel as difficulty).
  // No 超簡單 tier — icon count/grid size is the only real axis here, same
  // resolution as jigsaw/sokoban (see project memory on 超簡單 redundancy).
  const TIERS = {
    easy: { rows: 4, cols: 6 },
    medium: { rows: 5, cols: 8 },
    hard: { rows: 6, cols: 10 },
    expert: { rows: 7, cols: 12 },
  };
  const MAX_HINTS = 5;

  // Emoji icon pool — no image assets needed (matches this hub's
  // established zero-external-asset approach), wide selection of visually
  // distinct fruit/animal icons that render consistently as system emoji.
  const ICON_POOL = [
    "🍎", "🍊", "🍋", "🍇", "🍓", "🍉", "🍒", "🍑", "🍍", "🥝",
    "🍌", "🥥", "🍅", "🥑", "🌽", "🥕", "🍄", "🌰", "🐶", "🐱",
    "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮",
  ];

  let state = null;
  let timerInterval = null;
  let changeListener = null;

  function onChange(cb) {
    changeListener = cb;
  }
  function notify(event) {
    if (changeListener) changeListener(state, event || null);
  }

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  }

  function generateTiles(rows, cols) {
    const totalCells = rows * cols;
    const pairCount = totalCells / 2;
    const icons = [];
    for (let i = 0; i < pairCount; i++) {
      const icon = i % ICON_POOL.length;
      icons.push(icon, icon);
    }
    shuffleArray(icons);
    return icons;
  }

  // -- connect-path validation (classic 連連看 rule: at most 2 turns, may
  // route through the empty border just outside the grid) ---------------

  const DIRS4 = [
    [-1, 0],
    [0, 1],
    [1, 0],
    [0, -1],
  ];

  function canConnect(tiles, rows, cols, startIndex, endIndex) {
    const paddedCols = cols + 2;
    const paddedRows = rows + 2;
    const toPadded = (index) => {
      const r = Math.floor(index / cols) + 1;
      const c = (index % cols) + 1;
      return r * paddedCols + c;
    };
    const startP = toPadded(startIndex);
    const endP = toPadded(endIndex);
    const isPassable = (pIdx) => {
      if (pIdx === startP || pIdx === endP) return true;
      const pr = Math.floor(pIdx / paddedCols);
      const pc = pIdx % paddedCols;
      if (pr <= 0 || pr >= paddedRows - 1 || pc <= 0 || pc >= paddedCols - 1) return true; // border always passable
      const origR = pr - 1;
      const origC = pc - 1;
      return tiles[origR * cols + origC] === EMPTY;
    };

    const bestTurns = new Map();
    const queue = [{ pIdx: startP, dir: -1, turns: 0 }];
    bestTurns.set(startP * 5 + 4, 0);
    let qi = 0;
    while (qi < queue.length) {
      const cur = queue[qi++];
      if (cur.pIdx === endP) return true;
      const pr0 = Math.floor(cur.pIdx / paddedCols);
      const pc0 = cur.pIdx % paddedCols;
      for (let d = 0; d < 4; d++) {
        const turnCost = cur.dir === -1 || cur.dir === d ? 0 : 1;
        const newTurns = cur.turns + turnCost;
        if (newTurns > 2) continue;
        const pr = pr0 + DIRS4[d][0];
        const pc = pc0 + DIRS4[d][1];
        if (pr < 0 || pr >= paddedRows || pc < 0 || pc >= paddedCols) continue;
        const nIdx = pr * paddedCols + pc;
        if (!isPassable(nIdx)) continue;
        const key = nIdx * 5 + d;
        if (bestTurns.has(key) && bestTurns.get(key) <= newTurns) continue;
        bestTurns.set(key, newTurns);
        queue.push({ pIdx: nIdx, dir: d, turns: newTurns });
      }
    }
    return false;
  }

  function findAnyValidPair(tiles, rows, cols) {
    const byIcon = new Map();
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] === EMPTY) continue;
      if (!byIcon.has(tiles[i])) byIcon.set(tiles[i], []);
      byIcon.get(tiles[i]).push(i);
    }
    for (const cells of byIcon.values()) {
      for (let a = 0; a < cells.length; a++) {
        for (let b = a + 1; b < cells.length; b++) {
          if (canConnect(tiles, rows, cols, cells[a], cells[b])) {
            return [cells[a], cells[b]];
          }
        }
      }
    }
    return null;
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
      tiles: state.tiles.slice(),
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
      tiles: saved.tiles.slice(),
      selectedIndex: null,
      hintPair: null,
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
      LianliankanStorage.saveCurrentGame(serialize());
    }
  }

  function newGame(difficulty) {
    stopTimerInterval();
    const tier = TIERS[difficulty] || TIERS.easy;
    state = {
      difficulty,
      rows: tier.rows,
      cols: tier.cols,
      tiles: generateTiles(tier.rows, tier.cols),
      selectedIndex: null,
      hintPair: null,
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
    const saved = LianliankanStorage.loadCurrentGame();
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
    startTimer();
    notify("restore");
    return true;
  }

  function hasSavedResumableGame() {
    const saved = LianliankanStorage.loadCurrentGame();
    return !!(saved && saved.status === "playing");
  }

  function hasProgress() {
    if (!state) return false;
    if (state.status !== "playing") return false;
    return state.moves > 0;
  }

  function isSolved() {
    return state.tiles.every((v) => v === EMPTY);
  }

  function finishWin() {
    state.elapsedMs = getElapsedMs();
    state.status = "won";
    stopTimerInterval();
    const elapsedSeconds = Math.floor(state.elapsedMs / 1000);
    const isNewBest = LianliankanStorage.updateCareer(state.difficulty, elapsedSeconds, state.moves);
    LianliankanStorage.appendHistoryEntry({
      difficulty: state.difficulty,
      moves: state.moves,
      elapsedSeconds,
      completedAt: new Date().toISOString(),
    });
    LianliankanStorage.clearCurrentGame();
    state.justWon = { isNewBest };
  }

  // Click-to-select-then-match: first click selects a tile, second click
  // on a same-icon, path-connectable tile removes both; a non-matching or
  // unconnectable second click just re-selects that tile instead (so the
  // player doesn't need a separate "cancel" step to try again).
  function selectCell(index) {
    if (!state || state.status !== "playing") return;
    if (state.tiles[index] === EMPTY) return;
    state.hintPair = null;
    if (state.selectedIndex === null) {
      state.selectedIndex = index;
      notify("select");
      return;
    }
    if (state.selectedIndex === index) {
      state.selectedIndex = null;
      notify("select");
      return;
    }
    const a = state.selectedIndex;
    const b = index;
    if (state.tiles[a] === state.tiles[b] && canConnect(state.tiles, state.rows, state.cols, a, b)) {
      state.history.push({ a, b, icon: state.tiles[a] });
      state.tiles[a] = EMPTY;
      state.tiles[b] = EMPTY;
      state.selectedIndex = null;
      state.moves++;
      if (isSolved()) {
        finishWin();
      } else {
        persist();
      }
      notify("match");
    } else {
      state.selectedIndex = index;
      notify("invalid");
    }
  }

  function undo() {
    if (!state || state.status !== "playing" || state.history.length === 0) return;
    const last = state.history.pop();
    state.tiles[last.a] = last.icon;
    state.tiles[last.b] = last.icon;
    state.selectedIndex = null;
    state.hintPair = null;
    persist();
    notify("undo");
  }

  function reshuffle() {
    if (!state || state.status !== "playing") return;
    const remainingIndices = [];
    const remainingIcons = [];
    for (let i = 0; i < state.tiles.length; i++) {
      if (state.tiles[i] !== EMPTY) {
        remainingIndices.push(i);
        remainingIcons.push(state.tiles[i]);
      }
    }
    shuffleArray(remainingIcons);
    remainingIndices.forEach((idx, i) => {
      state.tiles[idx] = remainingIcons[i];
    });
    state.selectedIndex = null;
    state.hintPair = null;
    persist();
    notify("reshuffle");
  }

  function useHint() {
    if (!state || state.status !== "playing") return;
    if (state.hintsUsed >= MAX_HINTS) {
      notify("invalid");
      return;
    }
    const pair = findAnyValidPair(state.tiles, state.rows, state.cols);
    if (!pair) {
      notify("invalid");
      return;
    }
    state.hintsUsed++;
    state.hintPair = pair;
    state.selectedIndex = null;
    persist();
    notify("hint");
  }

  function hasAnyValidMove() {
    if (!state) return false;
    return findAnyValidPair(state.tiles, state.rows, state.cols) !== null;
  }

  function getState() {
    return state;
  }
  function getBoardSize() {
    if (!state) return { rows: TIERS.easy.rows, cols: TIERS.easy.cols };
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
    selectCell,
    undo,
    reshuffle,
    useHint,
    hasAnyValidMove,
    getState,
    getBoardSize,
    getMaxHints,
    formatTime,
    formatSeconds,
    ICON_POOL,
  };
})();

if (typeof window !== "undefined") {
  window.LianliankanGame = LianliankanGame;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = LianliankanGame;
}
