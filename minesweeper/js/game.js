// 踩地雷 (Minesweeper) state controller: owns board state, timer, win/lose
// detection, persistence. No DOM access here (that's ui.js's job).
//
// Deliberately has NO undo — that's not an oversight, it's the whole point
// of the game (every other game in this hub offers undo, but Minesweeper's
// entire tension comes from clicks being irreversible; adding undo would
// remove the actual game). Mines are placed only after the first reveal
// (classic modern-Minesweeper fairness rule), excluding the clicked cell
// and its neighbors, so the opening click is always safe and usually opens
// up a reasonable area.
var MinesweeperGame = (function () {
  const TIERS = {
    easy: { size: 8, mines: 10 },
    medium: { size: 10, mines: 18 },
    hard: { size: 12, mines: 28 },
    expert: { size: 14, mines: 40 },
  };
  // superEasy keeps a fixed small board (not percent-lerp'd size, to avoid
  // the sokoban-style "barely differs from easy" bug) and only tunes mine
  // count within it — same resolved pattern as nonogram's superEasy.
  const SUPER_EASY_SIZE = 6;
  const SUPER_EASY_MINES_HIGH = 6;
  const SUPER_EASY_MINES_LOW = 2;

  let state = null;
  let timerInterval = null;
  let changeListener = null;

  function onChange(cb) {
    changeListener = cb;
  }
  function notify(event) {
    if (changeListener) changeListener(state, event || null);
  }

  function superEasyMineCount(percent) {
    const x = (Math.max(10, Math.min(90, Math.round(Number(percent) || 30))) - 10) / 80;
    return Math.round(SUPER_EASY_MINES_HIGH + (SUPER_EASY_MINES_LOW - SUPER_EASY_MINES_HIGH) * x);
  }

  function neighborsOf(index, size) {
    const row = Math.floor(index / size);
    const col = index % size;
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = row + dr;
        const c = col + dc;
        if (r >= 0 && r < size && c >= 0 && c < size) out.push(r * size + c);
      }
    }
    return out;
  }

  // Places `mineCount` mines avoiding `safeIndex` and its neighbors (so the
  // first click always opens a small safe pocket, not just a lone number),
  // then computes each cell's adjacent-mine count.
  function placeMines(size, mineCount, safeIndex) {
    const total = size * size;
    const excluded = new Set([safeIndex, ...neighborsOf(safeIndex, size)]);
    const candidates = [];
    for (let i = 0; i < total; i++) if (!excluded.has(i)) candidates.push(i);
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = tmp;
    }
    const mineSet = new Set(candidates.slice(0, Math.min(mineCount, candidates.length)));
    const mines = new Array(total).fill(false);
    const adjacent = new Array(total).fill(0);
    for (const idx of mineSet) mines[idx] = true;
    for (let i = 0; i < total; i++) {
      if (mines[i]) continue;
      let count = 0;
      for (const n of neighborsOf(i, size)) if (mines[n]) count++;
      adjacent[i] = count;
    }
    return { mines, adjacent };
  }

  // Flood-fill reveal from a 0-count cell: reveals the whole connected
  // region of 0-count cells plus their bordering numbered cells.
  function floodReveal(state, startIndex) {
    const stack = [startIndex];
    while (stack.length > 0) {
      const idx = stack.pop();
      if (state.revealed[idx] || state.flagged[idx]) continue;
      state.revealed[idx] = true;
      if (state.adjacent[idx] === 0) {
        for (const n of neighborsOf(idx, state.size)) {
          if (!state.revealed[n] && !state.mines[n] && !state.flagged[n]) stack.push(n);
        }
      }
    }
  }

  function countRevealed(state) {
    let n = 0;
    for (const v of state.revealed) if (v) n++;
    return n;
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
      mineCount: state.mineCount,
      mines: state.mines,
      adjacent: state.adjacent,
      revealed: state.revealed,
      flagged: state.flagged,
      firstClickDone: state.firstClickDone,
      moves: state.moves,
      elapsedMs: getElapsedMs(),
      status: state.status === "playing" ? "playing" : state.status,
    };
  }

  function deserialize(saved) {
    return {
      difficulty: saved.difficulty,
      size: saved.size,
      mineCount: saved.mineCount,
      mines: saved.mines.slice(),
      adjacent: saved.adjacent.slice(),
      revealed: saved.revealed.slice(),
      flagged: saved.flagged.slice(),
      firstClickDone: !!saved.firstClickDone,
      paintMode: "reveal",
      moves: saved.moves || 0,
      elapsedMs: saved.elapsedMs || 0,
      startTimestamp: Date.now(),
      status: saved.status === "won" || saved.status === "lost" ? saved.status : "playing",
    };
  }

  function persist() {
    if (state && state.status === "playing") {
      MinesweeperStorage.saveCurrentGame(serialize());
    }
  }

  function newGame(difficulty) {
    stopTimerInterval();
    let size, mineCount;
    if (difficulty === "superEasy") {
      size = SUPER_EASY_SIZE;
      mineCount = superEasyMineCount(MinesweeperStorage.getSettings().superEasyPercent);
    } else {
      const tier = TIERS[difficulty] || TIERS.easy;
      size = tier.size;
      mineCount = tier.mines;
    }
    const total = size * size;
    state = {
      difficulty,
      size,
      mineCount,
      mines: new Array(total).fill(false),
      adjacent: new Array(total).fill(0),
      revealed: new Array(total).fill(false),
      flagged: new Array(total).fill(false),
      firstClickDone: false,
      paintMode: "reveal",
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
    const saved = MinesweeperStorage.loadCurrentGame();
    if (!saved || !Array.isArray(saved.mines) || !saved.size || saved.mines.length !== saved.size * saved.size) {
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
    const saved = MinesweeperStorage.loadCurrentGame();
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
    if (status === "lost") {
      for (let i = 0; i < state.mines.length; i++) if (state.mines[i]) state.revealed[i] = true;
    }
    const elapsedSeconds = Math.floor(state.elapsedMs / 1000);
    if (status === "won") {
      const isNewBest = MinesweeperStorage.updateCareer(state.difficulty, elapsedSeconds, state.moves);
      state.justWon = { isNewBest };
    }
    MinesweeperStorage.appendHistoryEntry({
      difficulty: state.difficulty,
      status,
      moves: state.moves,
      elapsedSeconds,
      completedAt: new Date().toISOString(),
    });
    MinesweeperStorage.clearCurrentGame();
  }

  function checkWin() {
    const total = state.size * state.size;
    return countRevealed(state) === total - state.mineCount;
  }

  function togglePaintMode() {
    if (!state || state.status !== "playing") return;
    state.paintMode = state.paintMode === "reveal" ? "flag" : "reveal";
    notify("mode");
  }

  function revealCell(index) {
    if (state.revealed[index] || state.flagged[index]) return;
    if (!state.firstClickDone) {
      const built = placeMines(state.size, state.mineCount, index);
      state.mines = built.mines;
      state.adjacent = built.adjacent;
      state.firstClickDone = true;
    }
    if (state.mines[index]) {
      state.revealed[index] = true;
      state.moves++;
      finishGame("lost");
      notify("boom");
      return;
    }
    if (state.adjacent[index] === 0) {
      floodReveal(state, index);
    } else {
      state.revealed[index] = true;
    }
    state.moves++;
    if (checkWin()) {
      finishGame("won");
    } else {
      persist();
    }
    notify("reveal");
  }

  function toggleFlag(index) {
    if (state.revealed[index]) {
      notify("invalid");
      return;
    }
    state.flagged[index] = !state.flagged[index];
    persist();
    notify("flag");
  }

  function tapCell(index) {
    if (!state || state.status !== "playing") return;
    if (state.paintMode === "flag") {
      toggleFlag(index);
    } else {
      revealCell(index);
    }
  }

  function getFlagsRemaining() {
    if (!state) return 0;
    let flagged = 0;
    for (const v of state.flagged) if (v) flagged++;
    return state.mineCount - flagged;
  }

  function getState() {
    return state;
  }
  function getBoardSize() {
    if (!state) return { rows: TIERS.easy.size, cols: TIERS.easy.size };
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
    tapCell,
    togglePaintMode,
    getFlagsRemaining,
    getState,
    getBoardSize,
    formatTime,
    formatSeconds,
  };
})();

if (typeof window !== "undefined") {
  window.MinesweeperGame = MinesweeperGame;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = MinesweeperGame;
}
