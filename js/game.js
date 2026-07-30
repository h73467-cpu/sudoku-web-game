// Game state controller: owns the live state object, timer, hints, notes,
// win detection, and persistence. No DOM access here (that's ui.js's job).
window.SudokuGame = (function () {
  const DEFAULT_MAX_HINTS = 3;

  let state = null;
  let timerInterval = null;
  let changeListener = null;

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
    timerInterval = setInterval(() => notify("tick"), 1000);
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
      elapsedMs: getElapsedMs(),
      hintsUsed: state.hintsUsed,
      maxHints: state.maxHints,
      notesMode: state.notesMode,
      selectedIndex: state.selectedIndex,
      status: state.status,
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
      elapsedMs: saved.elapsedMs || 0,
      startTimestamp: Date.now(),
      hintsUsed: saved.hintsUsed || 0,
      maxHints: saved.maxHints || DEFAULT_MAX_HINTS,
      notesMode: !!saved.notesMode,
      selectedIndex:
        typeof saved.selectedIndex === "number" ? saved.selectedIndex : null,
      status: saved.status,
    };
  }

  function persist() {
    if (state && state.status === "playing") {
      SudokuStorage.saveGame(serialize());
    }
  }

  function newGame(difficulty) {
    stopTimerInterval();
    const { puzzle, solution } = Sudoku.generatePuzzle(difficulty);
    state = {
      cells: createCells(puzzle),
      solution,
      difficulty,
      elapsedMs: 0,
      startTimestamp: Date.now(),
      hintsUsed: 0,
      maxHints: DEFAULT_MAX_HINTS,
      notesMode: false,
      selectedIndex: null,
      status: "playing",
    };
    recomputeConflicts();
    startTimer();
    persist();
    notify("new-game");
  }

  function loadOrNew(defaultDifficulty) {
    const saved = SudokuStorage.loadGame();
    if (saved && saved.status === "playing" && Array.isArray(saved.cells)) {
      state = deserialize(saved);
      recomputeConflicts();
      startTimer();
      notify("restore");
    } else {
      newGame(defaultDifficulty);
    }
  }

  function selectCell(index) {
    if (!state) return;
    state.selectedIndex = index;
    notify("select");
  }

  function setValue(index, digit) {
    if (!state || state.status !== "playing") return;
    const cell = state.cells[index];
    if (!cell || cell.given) return;
    if (state.notesMode && digit !== 0) {
      toggleNote(index, digit);
      return;
    }
    cell.value = digit;
    cell.notes.clear();
    cell.hinted = false;
    recomputeConflicts();
    persist();
    checkWin();
    notify("value");
  }

  function toggleNote(index, digit) {
    if (!state || state.status !== "playing") return;
    const cell = state.cells[index];
    if (!cell || cell.given || cell.value !== 0 || digit === 0) return;
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

  function useHint() {
    if (!state || state.status !== "playing") return;
    if (state.hintsUsed >= state.maxHints) return;

    let idx = state.selectedIndex;
    const needsHint = (i) =>
      state.cells[i].value !== state.solution[i] && !state.cells[i].given;
    if (idx == null || !needsHint(idx)) {
      idx = state.cells.findIndex((c) => needsHint(c.index));
      if (idx === -1) return;
    }

    const cell = state.cells[idx];
    cell.value = state.solution[idx];
    cell.notes.clear();
    cell.hinted = true;
    state.hintsUsed++;
    recomputeConflicts();
    persist();
    checkWin();
    notify("hint");
  }

  function checkWin() {
    const allFilled = state.cells.every((c) => c.value !== 0);
    const noConflict = state.cells.every((c) => !c.conflict);
    const matches = state.cells.every(
      (c) => c.value === state.solution[c.index]
    );
    if (allFilled && noConflict && matches) {
      state.elapsedMs = getElapsedMs();
      state.status = "won";
      stopTimerInterval();
      const isNewBest = SudokuStorage.setBestTime(
        state.difficulty,
        state.elapsedMs
      );
      SudokuStorage.clearSavedGame();
      state.justWon = { isNewBest };
    }
  }

  function hasProgress() {
    if (!state) return false;
    if (state.status !== "playing") return false;
    return state.cells.some(
      (c) => !c.given && (c.value !== 0 || c.notes.size > 0)
    );
  }

  function getState() {
    return state;
  }

  function getBestTime(difficulty) {
    return SudokuStorage.getBestTimes()[difficulty];
  }

  function formatTime(ms) {
    if (ms == null) return "--:--";
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  window.addEventListener("beforeunload", persist);

  return {
    onChange,
    newGame,
    loadOrNew,
    selectCell,
    setValue,
    toggleNote,
    toggleNotesMode,
    useHint,
    hasProgress,
    getState,
    getElapsedMs,
    getBestTime,
    formatTime,
  };
})();
