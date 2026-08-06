// 拼圖 (Jigsaw) state controller: owns board state, undo stack, timer, win
// detection, persistence. No DOM access here (that's ui.js's job). Mirrors
// the shape of fifteen/js/game.js.
//
// Unlike a sliding puzzle, any two pieces can swap directly (no adjacency
// requirement), so any random permutation of pieces is trivially solvable —
// there's no reverse-play/solvability concern here, only the usual
// "don't start already (nearly) solved" triviality guard.
var JigsawGame = (function () {
  // No 超簡單 tier here (mirrors sokoban's resolved design, not fifteen/
  // nonogram's): piece count is the only real difficulty axis for a flat
  // grid-swap jigsaw, and at 2x2 there's no meaningful continuous knob left
  // to tune with a percent slider — see project memory on 超簡單 redundancy.
  const TIERS = {
    easy: { rows: 2, cols: 2 },
    medium: { rows: 3, cols: 3 },
    hard: { rows: 4, cols: 4 },
    expert: { rows: 5, cols: 5 },
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

  function shuffledPieces(rows, cols) {
    const n = rows * cols;
    const pieces = Array.from({ length: n }, (_, i) => i);
    function fisherYates(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
    }
    function misplacedCount(arr) {
      return arr.reduce((acc, v, i) => acc + (v !== i ? 1 : 0), 0);
    }
    const minMisplaced = Math.max(2, Math.floor(n / 2));
    fisherYates(pieces);
    let guard = 0;
    while (misplacedCount(pieces) < minMisplaced && guard < 200) {
      fisherYates(pieces);
      guard++;
    }
    return pieces;
  }

  function buildBoard(difficulty) {
    const tier = TIERS[difficulty] || TIERS.easy;
    const image = JigsawImages.randomImage();
    return {
      rows: tier.rows,
      cols: tier.cols,
      imageId: image.id,
      pieces: shuffledPieces(tier.rows, tier.cols),
    };
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
      imageId: state.imageId,
      pieces: state.pieces.slice(),
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
      imageId: saved.imageId,
      pieces: saved.pieces.slice(),
      selectedIndex: null,
      history: Array.isArray(saved.history) ? saved.history : [],
      moves: saved.moves || 0,
      elapsedMs: saved.elapsedMs || 0,
      startTimestamp: Date.now(),
      status: saved.status === "won" ? "won" : "playing",
    };
  }

  function persist() {
    if (state && state.status !== "won") {
      JigsawStorage.saveCurrentGame(serialize());
    }
  }

  function newGame(difficulty) {
    stopTimerInterval();
    const board = buildBoard(difficulty);
    state = {
      difficulty,
      rows: board.rows,
      cols: board.cols,
      imageId: board.imageId,
      pieces: board.pieces,
      selectedIndex: null,
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
    const saved = JigsawStorage.loadCurrentGame();
    if (
      !saved ||
      !Array.isArray(saved.pieces) ||
      !saved.rows ||
      !saved.cols ||
      saved.pieces.length !== saved.rows * saved.cols
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
    const saved = JigsawStorage.loadCurrentGame();
    return !!(saved && saved.status === "playing");
  }

  function hasProgress() {
    if (!state) return false;
    if (state.status !== "playing") return false;
    return state.moves > 0;
  }

  function isSolved() {
    return state.pieces.every((v, i) => v === i);
  }

  function finishWin() {
    state.elapsedMs = getElapsedMs();
    state.status = "won";
    stopTimerInterval();
    const elapsedSeconds = Math.floor(state.elapsedMs / 1000);
    const isNewBest = JigsawStorage.updateCareer(state.difficulty, elapsedSeconds, state.moves);
    JigsawStorage.appendHistoryEntry({
      difficulty: state.difficulty,
      moves: state.moves,
      elapsedSeconds,
      completedAt: new Date().toISOString(),
    });
    JigsawStorage.clearCurrentGame();
    state.justWon = { isNewBest };
  }

  function swapCells(i, j) {
    if (i === j) return;
    state.history.push([i, j]);
    const tmp = state.pieces[i];
    state.pieces[i] = state.pieces[j];
    state.pieces[j] = tmp;
    state.moves++;
    if (isSolved()) {
      finishWin();
    } else {
      persist();
    }
    notify("swap");
  }

  // Click-to-select-then-swap, mirroring klotski's piece-selection UX:
  // first click selects a piece (highlighted), second click on a different
  // cell swaps them, clicking the same cell again deselects it.
  function selectCell(index) {
    if (!state || state.status !== "playing") return;
    if (state.selectedIndex === null) {
      state.selectedIndex = index;
      notify("select");
    } else if (state.selectedIndex === index) {
      state.selectedIndex = null;
      notify("select");
    } else {
      const from = state.selectedIndex;
      state.selectedIndex = null;
      swapCells(from, index);
    }
  }

  function undo() {
    if (!state || state.status !== "playing" || state.history.length === 0) return;
    const [i, j] = state.history.pop();
    const tmp = state.pieces[i];
    state.pieces[i] = state.pieces[j];
    state.pieces[j] = tmp;
    state.selectedIndex = null;
    persist();
    notify("undo");
  }

  function getState() {
    return state;
  }
  function getBoardSize() {
    if (!state) return { rows: TIERS.easy.rows, cols: TIERS.easy.cols };
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
    selectCell,
    undo,
    getState,
    getBoardSize,
    formatTime,
    formatSeconds,
  };
})();

if (typeof window !== "undefined") {
  window.JigsawGame = JigsawGame;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = JigsawGame;
}
