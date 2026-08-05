// Game state controller: owns the live state object, timer, hints, notes,
// undo stack, pause, win detection, and persistence. No DOM access here
// (that's ui.js's job).
var SudokuGame = (function () {
  const DEFAULT_MAX_HINTS = 5;
  const MAX_UNDO = 500;

  let state = null;
  let timerInterval = null;
  let changeListener = null;
  let undoStack = []; // module-scoped, NOT part of state, NOT persisted —
  // resuming a saved game always starts with an empty undo history.

  function onChange(cb) {
    changeListener = cb;
  }

  function notify(event) {
    if (changeListener) changeListener(state, event || null);
  }

  function createCells(puzzle) {
    return puzzle.map((v, i) => ({
      index: i,
      given: v !== 0,
      value: v,
      notes: new Set(),
      conflict: false,
      hinted: false,
    }));
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

  function recomputeConflicts() {
    const values = state.cells.map((c) => c.value);
    const conflicts = Sudoku.computeConflicts(values);
    state.cells.forEach((c, i) => (c.conflict = conflicts[i]));
  }

  function serialize() {
    return {
      cells: state.cells.map((c) => ({ ...c, notes: Array.from(c.notes) })),
      solution: state.solution,
      difficulty: state.difficulty,
      requiresAdvanced: state.requiresAdvanced,
      elapsedMs: getElapsedMs(),
      mistakes: state.mistakes,
      hintsUsed: state.hintsUsed,
      maxHints: state.maxHints,
      notesMode: state.notesMode,
      selectedIndex: state.selectedIndex,
      status: state.status,
      isDaily: state.isDaily,
      dailyDate: state.dailyDate,
    };
  }

  function deserialize(saved) {
    return {
      cells: saved.cells.map((c) => ({
        ...c,
        notes: new Set(c.notes || []),
      })),
      solution: saved.solution,
      difficulty: saved.difficulty,
      requiresAdvanced: !!saved.requiresAdvanced,
      elapsedMs: saved.elapsedMs || 0,
      startTimestamp: Date.now(),
      mistakes: saved.mistakes || 0,
      hintsUsed: saved.hintsUsed || 0,
      maxHints: saved.maxHints || DEFAULT_MAX_HINTS,
      notesMode: !!saved.notesMode,
      selectedIndex:
        typeof saved.selectedIndex === "number" ? saved.selectedIndex : null,
      status: saved.status,
      isDaily: !!saved.isDaily,
      dailyDate: saved.dailyDate || null,
    };
  }

  function persist() {
    // Persist while playing AND paused (PRD: autosave on every fill + every
    // second of ticking); skip once won since checkWin() already clears the
    // saved slot and records history/career separately.
    if (state && state.status !== "won") {
      SudokuStorage.saveCurrentGame(serialize());
    }
  }

  function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // opts: { isDaily, dailyDate }
  function newGame(difficulty, opts) {
    opts = opts || {};
    stopTimerInterval();
    undoStack = [];

    let generated;
    if (opts.isDaily) {
      const dateStr = opts.dailyDate || todayStr();
      const rand = SudokuRng.mulberry32(SudokuRng.hashSeed(dateStr));
      generated = Sudoku.generatePuzzle("medium", { rand });
    } else if (difficulty === "superEasy") {
      const settings = SudokuStorage.getSettings();
      generated = Sudoku.generatePuzzle("superEasy", {
        superEasyPercent: settings.superEasyPercent,
      });
    } else {
      generated = Sudoku.generatePuzzle(difficulty);
    }

    const { puzzle, solution, requiresAdvanced } = generated;
    state = {
      cells: createCells(puzzle),
      solution,
      difficulty: opts.isDaily ? "medium" : difficulty,
      requiresAdvanced: !!requiresAdvanced,
      elapsedMs: 0,
      startTimestamp: Date.now(),
      mistakes: 0,
      hintsUsed: 0,
      maxHints: DEFAULT_MAX_HINTS,
      notesMode: false,
      selectedIndex: null,
      status: "playing",
      isDaily: !!opts.isDaily,
      dailyDate: opts.isDaily ? opts.dailyDate || todayStr() : null,
    };
    recomputeConflicts();
    startTimer();
    persist();
    notify("new-game");
  }

  // Restores a saved in-progress game (playing or paused). Returns false
  // (and leaves `state` untouched) if there's nothing resumable. Does NOT
  // auto-run on script load — callers (the home view) decide when to resume.
  function resumeGame() {
    const saved = SudokuStorage.loadCurrentGame();
    if (!saved || !Array.isArray(saved.cells)) return false;
    if (saved.status !== "playing" && saved.status !== "paused") return false;
    stopTimerInterval();
    undoStack = [];
    state = deserialize(saved);
    recomputeConflicts();
    if (state.status === "playing") startTimer();
    notify("restore");
    return true;
  }

  function hasSavedResumableGame() {
    const saved = SudokuStorage.loadCurrentGame();
    return !!(saved && (saved.status === "playing" || saved.status === "paused"));
  }

  function selectCell(index) {
    if (!state) return;
    state.selectedIndex = index;
    notify("select");
  }

  function pushUndo(index) {
    const cell = state.cells[index];
    undoStack.push({
      index,
      value: cell.value,
      notes: new Set(cell.notes),
      hinted: cell.hinted,
    });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  }

  function setValue(index, digit) {
    if (!state || state.status !== "playing") return;
    const cell = state.cells[index];
    if (!cell || cell.given) return;
    if (state.notesMode && digit !== 0) {
      toggleNote(index, digit);
      return;
    }
    pushUndo(index);
    cell.value = digit;
    cell.notes.clear();
    cell.hinted = false;
    if (digit !== 0 && digit !== state.solution[index]) {
      state.mistakes++;
    }
    recomputeConflicts();
    checkWin();
    persist();
    notify("value");
  }

  function toggleNote(index, digit) {
    if (!state || state.status !== "playing") return;
    const cell = state.cells[index];
    if (!cell || cell.given || cell.value !== 0 || digit === 0) return;
    pushUndo(index);
    if (cell.notes.has(digit)) {
      cell.notes.delete(digit);
    } else {
      cell.notes.add(digit);
    }
    persist();
    notify("note");
  }

  function toggleNotesMode() {
    if (!state) return;
    state.notesMode = !state.notesMode;
    persist();
    notify("notes-mode");
  }

  // Randomly picks among all currently-wrong/empty non-given cells (deliberate
  // PRD-literal choice: 5 hints, random selection — diverges from the desktop
  // reference's deterministic "prefer selected cell, else first wrong index").
  function useHint() {
    if (!state || state.status !== "playing") return;
    if (state.hintsUsed >= state.maxHints) return;

    const candidates = state.cells.filter(
      (c) => !c.given && c.value !== state.solution[c.index]
    );
    if (candidates.length === 0) return;
    const target = candidates[Math.floor(Math.random() * candidates.length)];

    pushUndo(target.index);
    target.value = state.solution[target.index];
    target.notes.clear();
    target.hinted = true;
    state.hintsUsed++;

    recomputeConflicts();
    checkWin();
    persist();
    notify("hint");
  }

  // Pure rewind: restores value/notes/hinted from the last snapshot, but does
  // NOT decrement mistakes/hintsUsed — undo is not a "refund".
  function undo() {
    if (!state || state.status !== "playing") return;
    if (undoStack.length === 0) return;
    const snap = undoStack.pop();
    const cell = state.cells[snap.index];
    cell.value = snap.value;
    cell.notes = new Set(snap.notes);
    cell.hinted = snap.hinted;
    recomputeConflicts();
    persist();
    notify("undo");
  }

  function togglePause() {
    if (!state) return;
    if (state.status === "playing") {
      state.elapsedMs = getElapsedMs();
      stopTimerInterval();
      state.status = "paused";
    } else if (state.status === "paused") {
      state.startTimestamp = Date.now();
      state.status = "playing";
      startTimer();
    } else {
      return; // no-op if won
    }
    persist();
    notify("pause");
  }

  function checkWin() {
    const allFilled = state.cells.every((c) => c.value !== 0);
    const noConflict = state.cells.every((c) => !c.conflict);
    const matches = state.cells.every(
      (c) => c.value === state.solution[c.index]
    );
    if (!(allFilled && noConflict && matches)) return;

    state.elapsedMs = getElapsedMs();
    state.status = "won";
    stopTimerInterval();

    const elapsedSeconds = Math.floor(state.elapsedMs / 1000);
    const isNewBest = SudokuStorage.updateCareer(
      state.difficulty,
      elapsedSeconds,
      state.mistakes
    );
    SudokuStorage.appendHistoryEntry({
      difficulty: state.difficulty,
      elapsedSeconds,
      mistakes: state.mistakes,
      hintsUsed: state.hintsUsed,
      requiresAdvanced: state.requiresAdvanced,
      isDaily: state.isDaily,
      dailyDate: state.dailyDate,
      completedAt: new Date().toISOString(),
    });
    if (state.isDaily) {
      SudokuStorage.recordDailyCompletion(state.dailyDate || todayStr());
    }
    SudokuStorage.clearCurrentGame();
    state.justWon = { isNewBest };
  }

  function hasProgress() {
    if (!state) return false;
    if (state.status === "paused") return true;
    if (state.status !== "playing") return false;
    return state.cells.some(
      (c) => !c.given && (c.value !== 0 || c.notes.size > 0)
    );
  }

  function getState() {
    return state;
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
    selectCell,
    setValue,
    toggleNote,
    toggleNotesMode,
    useHint,
    undo,
    togglePause,
    hasProgress,
    getState,
    getElapsedMs,
    formatTime,
    formatSeconds,
    todayStr,
  };
})();

if (typeof window !== "undefined") {
  window.SudokuGame = SudokuGame;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = SudokuGame;
}
