// 數織 (Nonogram / Picross) state controller: owns board state, undo stack,
// timer, win detection, persistence, and puzzle generation. No DOM access
// here (that's ui.js's job). Mirrors the shape of fifteen/js/game.js.
//
// Unlike the reverse-play generators in klotski/sokoban/fifteen (which
// guarantee solvability by construction), a nonogram's solution isn't
// reached by undoing legal moves — it's an independent picture, and a
// randomly generated picture is frequently only solvable by guessing
// (ambiguous). So generation here works the other way: generate a random
// picture, derive its row/column clues, then run an actual line-solver
// (see solveByLogic below) that only uses the same deduction techniques a
// human would — if it can fully determine the grid with zero guessing,
// the puzzle is accepted; otherwise the picture is discarded and another
// is generated. This is verified empirically (not just spot-checked) by a
// Node stress harness — see project memory for the numbers.
var NonogramGame = (function () {
  const BLANK = 0;
  const FILLED = 1;
  const CROSSED = 2;

  // Board size scales with difficulty (same lesson as fifteen/js/game.js:
  // grid size, not just puzzle complexity, needs to shrink for casual/
  // elderly players to get a quick, achievable win). superEasy uses a
  // fixed smaller board regardless of the percent slider — NOT a
  // percent-lerp'd size — so it stays visibly distinct from `easy` at
  // every slider value (percent-lerping board size was sokoban's original
  // "超簡單 barely differs from 簡單" bug; see project memory).
  // Density targets are deliberately modest — empirically (see project
  // memory), a pure line-logic solver rejects almost everything above
  // ~25-30% fill density for boards this size (long contiguous blobs are
  // *more* ambiguous to a row/column-only solver than sparser pictures,
  // since a solid run can often shift by a cell and still satisfy both
  // clues). Starting near the achievable range keeps generation fast
  // instead of burning through the whole retry ladder every time.
  const TIERS = {
    easy: { rows: 7, cols: 7, density: 0.22 },
    medium: { rows: 9, cols: 9, density: 0.21 },
    hard: { rows: 11, cols: 11, density: 0.2 },
    expert: { rows: 13, cols: 13, density: 0.2 },
  };
  const SUPER_EASY_BOARD = { rows: 5, cols: 5 };
  const SUPER_EASY_DENSITY_HIGH = 0.22;
  const SUPER_EASY_DENSITY_LOW = 0.16;
  const MAX_GENERATE_ATTEMPTS = 400;

  let state = null;
  let timerInterval = null;
  let changeListener = null;

  function onChange(cb) {
    changeListener = cb;
  }
  function notify(event) {
    if (changeListener) changeListener(state, event || null);
  }

  function superEasyDensity(percent) {
    const x = (Math.max(10, Math.min(90, Math.round(Number(percent) || 30))) - 10) / 80;
    return SUPER_EASY_DENSITY_HIGH + (SUPER_EASY_DENSITY_LOW - SUPER_EASY_DENSITY_HIGH) * x;
  }

  // -- puzzle generation ------------------------------------------------

  // Grows a handful of random "blobs" rather than filling each cell
  // independently. Pure per-cell noise turns out to be a poor source of
  // nonograms: isolated single filled cells surrounded by unknowns are the
  // main source of line-solving ambiguity, so independent-noise pictures
  // very rarely survive solvableByLogic() at any real density (measured:
  // required density fell all the way to ~0.1-0.2 for larger boards after
  // repeated fallback retries — see project memory). Blobs have long
  // contiguous runs, which are far easier to pin down by pure line logic,
  // and they also read as more recognizable "pictures" than scattered noise.
  function randomTarget(rows, cols, density) {
    const cells = new Array(rows * cols).fill(BLANK);
    const targetCount = Math.round(rows * cols * density);
    const cellIndex = (r, c) => r * cols + c;
    const neighborsOf = (idx) => {
      const r = Math.floor(idx / cols);
      const c = idx % cols;
      const out = [];
      if (r > 0) out.push(cellIndex(r - 1, c));
      if (r < rows - 1) out.push(cellIndex(r + 1, c));
      if (c > 0) out.push(cellIndex(r, c - 1));
      if (c < cols - 1) out.push(cellIndex(r, c + 1));
      return out;
    };

    let count = 0;
    let frontier = [];
    let guard = 0;
    const guardLimit = rows * cols * 40;
    while (count < targetCount && guard < guardLimit) {
      guard++;
      // Occasionally start a fresh blob (or when the current one has
      // nowhere left to grow) so pictures can have multiple disconnected
      // parts instead of always being one solid blob.
      if (frontier.length === 0 || Math.random() < 0.06) {
        const seed = Math.floor(Math.random() * cells.length);
        if (cells[seed] === BLANK) {
          cells[seed] = FILLED;
          count++;
          frontier.push(...neighborsOf(seed).filter((n) => cells[n] === BLANK));
        }
        continue;
      }
      const pickIdx = Math.floor(Math.random() * frontier.length);
      const next = frontier[pickIdx];
      frontier.splice(pickIdx, 1);
      if (cells[next] !== BLANK) continue;
      cells[next] = FILLED;
      count++;
      frontier.push(...neighborsOf(next).filter((n) => cells[n] === BLANK));
    }
    return cells;
  }

  function densityOk(target) {
    const filled = target.reduce((a, v) => a + (v === FILLED ? 1 : 0), 0);
    const ratio = filled / target.length;
    return ratio >= 0.12 && ratio <= 0.78;
  }

  function clueFor(line) {
    const clue = [];
    let run = 0;
    for (const v of line) {
      if (v === FILLED) run++;
      else {
        if (run > 0) clue.push(run);
        run = 0;
      }
    }
    if (run > 0) clue.push(run);
    if (clue.length === 0) clue.push(0);
    return clue;
  }

  function buildClues(target, rows, cols) {
    const rowClues = [];
    for (let r = 0; r < rows; r++) {
      rowClues.push(clueFor(target.slice(r * cols, r * cols + cols)));
    }
    const colClues = [];
    for (let c = 0; c < cols; c++) {
      const line = [];
      for (let r = 0; r < rows; r++) line.push(target[r * cols + c]);
      colClues.push(clueFor(line));
    }
    return { rowClues, colClues };
  }

  // Is `line` (length N, values -1 unknown / 0 empty / 1 filled) feasible
  // under `blocks`? Memoized DP over (blockIndex, cursorPos) — cursorPos is
  // "the next block may start no earlier than here, and everything before
  // it is already accounted for". Prefix sums turn the per-state gap/
  // overlap checks into O(1), so this whole check is O(blocks * N).
  function lineFeasible(blocks, known, N) {
    const filledPrefix = new Array(N + 1).fill(0);
    const emptyPrefix = new Array(N + 1).fill(0);
    for (let i = 0; i < N; i++) {
      filledPrefix[i + 1] = filledPrefix[i] + (known[i] === FILLED ? 1 : 0);
      emptyPrefix[i + 1] = emptyPrefix[i] + (known[i] === BLANK ? 1 : 0);
    }
    const memo = new Map();
    function solve(i, pos) {
      if (i === blocks.length) {
        return filledPrefix[N] - filledPrefix[pos] === 0;
      }
      const mkey = i * (N + 1) + pos;
      if (memo.has(mkey)) return memo.get(mkey);
      let result = false;
      const b = blocks[i];
      for (let s = pos; s + b <= N; s++) {
        if (filledPrefix[s] - filledPrefix[pos] > 0) break; // known-filled cell stuck in the gap before this block
        if (emptyPrefix[s + b] - emptyPrefix[s] > 0) continue; // block would cover a known-empty cell
        const nextPos = Math.min(s + b + 1, N);
        if (solve(i + 1, nextPos)) {
          result = true;
          break;
        }
      }
      memo.set(mkey, result);
      return result;
    }
    return solve(0, 0);
  }

  // Determines whether cell `idx` in `line` is forced filled/empty given
  // `blocks`, by testing feasibility with it pinned each way. -1 = still
  // ambiguous (would require a guess — this is exactly what disqualifies a
  // generated picture from being used as a puzzle).
  function forcedValue(blocks, known, N, idx) {
    if (known[idx] !== -1) return known[idx];
    const kf = known.slice();
    kf[idx] = FILLED;
    const canFill = lineFeasible(blocks, kf, N);
    const ke = known.slice();
    ke[idx] = BLANK;
    const canEmpty = lineFeasible(blocks, ke, N);
    if (canFill && !canEmpty) return FILLED;
    if (canEmpty && !canFill) return BLANK;
    return -1;
  }

  // Full-grid constraint propagation: alternates row/column deduction
  // passes until nothing new is determined. Returns true iff every cell
  // ends up determined (i.e. the puzzle is solvable by pure logic, no
  // guessing required).
  function solvableByLogic(rowClues, colClues, rows, cols) {
    const known = new Array(rows * cols).fill(-1);
    let changed = true;
    while (changed) {
      changed = false;
      for (let r = 0; r < rows; r++) {
        const base = r * cols;
        const lineKnown = known.slice(base, base + cols);
        for (let c = 0; c < cols; c++) {
          if (lineKnown[c] !== -1) continue;
          const v = forcedValue(rowClues[r], lineKnown, cols, c);
          if (v !== -1) {
            known[base + c] = v;
            changed = true;
          }
        }
      }
      for (let c = 0; c < cols; c++) {
        const lineKnown = [];
        for (let r = 0; r < rows; r++) lineKnown.push(known[r * cols + c]);
        for (let r = 0; r < rows; r++) {
          if (lineKnown[r] !== -1) continue;
          const v = forcedValue(colClues[c], lineKnown, rows, r);
          if (v !== -1) {
            known[r * cols + c] = v;
            changed = true;
          }
        }
      }
    }
    return known.every((v) => v !== -1);
  }

  function generatePuzzle(rows, cols, density) {
    let curDensity = density;
    for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt++) {
      if (attempt > 0 && attempt % 40 === 0) curDensity = Math.max(0.14, curDensity - 0.03);
      let target;
      let tries = 0;
      do {
        target = randomTarget(rows, cols, curDensity);
        tries++;
      } while (!densityOk(target) && tries < 20);
      const { rowClues, colClues } = buildClues(target, rows, cols);
      if (solvableByLogic(rowClues, colClues, rows, cols)) {
        return { target, rowClues, colClues };
      }
    }
    // Extremely unlikely fallback given the retries above (verified
    // empirically) — accept the last attempt rather than fail outright.
    const target = randomTarget(rows, cols, Math.max(0.14, curDensity));
    const { rowClues, colClues } = buildClues(target, rows, cols);
    return { target, rowClues, colClues };
  }

  function buildBoard(difficulty) {
    if (difficulty === "superEasy") {
      const density = superEasyDensity(NonogramStorage.getSettings().superEasyPercent);
      const built = generatePuzzle(SUPER_EASY_BOARD.rows, SUPER_EASY_BOARD.cols, density);
      return Object.assign({ rows: SUPER_EASY_BOARD.rows, cols: SUPER_EASY_BOARD.cols }, built);
    }
    const tier = TIERS[difficulty] || TIERS.easy;
    const built = generatePuzzle(tier.rows, tier.cols, tier.density);
    return Object.assign({ rows: tier.rows, cols: tier.cols }, built);
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
      target: state.target.slice(),
      rowClues: state.rowClues,
      colClues: state.colClues,
      cells: state.cells.slice(),
      paintMode: state.paintMode,
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
      target: saved.target.slice(),
      rowClues: saved.rowClues,
      colClues: saved.colClues,
      cells: saved.cells.slice(),
      paintMode: saved.paintMode === "cross" ? "cross" : "fill",
      history: Array.isArray(saved.history) ? saved.history : [],
      moves: saved.moves || 0,
      elapsedMs: saved.elapsedMs || 0,
      startTimestamp: Date.now(),
      status: saved.status === "won" ? "won" : "playing",
    };
  }

  function persist() {
    if (state && state.status !== "won") {
      NonogramStorage.saveCurrentGame(serialize());
    }
  }

  function newGame(difficulty) {
    stopTimerInterval();
    const board = buildBoard(difficulty);
    state = {
      difficulty,
      rows: board.rows,
      cols: board.cols,
      target: board.target,
      rowClues: board.rowClues,
      colClues: board.colClues,
      cells: new Array(board.rows * board.cols).fill(BLANK),
      paintMode: "fill",
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
    const saved = NonogramStorage.loadCurrentGame();
    if (
      !saved ||
      !Array.isArray(saved.target) ||
      !Array.isArray(saved.cells) ||
      !saved.rows ||
      !saved.cols ||
      saved.target.length !== saved.rows * saved.cols
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
    const saved = NonogramStorage.loadCurrentGame();
    return !!(saved && saved.status === "playing");
  }

  function hasProgress() {
    if (!state) return false;
    if (state.status !== "playing") return false;
    return state.moves > 0;
  }

  // -- gameplay -------------------------------------------------------------

  function isSolved() {
    for (let i = 0; i < state.cells.length; i++) {
      const filled = state.cells[i] === FILLED;
      const shouldBeFilled = state.target[i] === FILLED;
      if (filled !== shouldBeFilled) return false;
    }
    return true;
  }

  function finishWin() {
    state.elapsedMs = getElapsedMs();
    state.status = "won";
    stopTimerInterval();
    const elapsedSeconds = Math.floor(state.elapsedMs / 1000);
    const isNewBest = NonogramStorage.updateCareer(state.difficulty, elapsedSeconds, state.moves);
    NonogramStorage.appendHistoryEntry({
      difficulty: state.difficulty,
      moves: state.moves,
      elapsedSeconds,
      completedAt: new Date().toISOString(),
    });
    NonogramStorage.clearCurrentGame();
    state.justWon = { isNewBest };
  }

  function togglePaintMode() {
    if (!state || state.status !== "playing") return;
    state.paintMode = state.paintMode === "fill" ? "cross" : "fill";
    notify("mode");
  }

  function toggleCell(index) {
    if (!state || state.status !== "playing") return false;
    const target = state.paintMode === "cross" ? CROSSED : FILLED;
    const current = state.cells[index];
    const next = current === target ? BLANK : target;
    state.history.push({ index, prev: current });
    state.cells[index] = next;
    state.moves++;
    if (isSolved()) {
      finishWin();
    } else {
      persist();
    }
    notify(next === BLANK ? "clear" : target === FILLED ? "fill" : "cross");
    return true;
  }

  function undo() {
    if (!state || state.status !== "playing" || state.history.length === 0) return;
    const last = state.history.pop();
    state.cells[last.index] = last.prev;
    persist();
    notify("undo");
  }

  // Is every cell in row `r` (or column `c`) already matching a fully-
  // satisfied version of its clue? Purely a rendering aid (dims a
  // finished clue) — derived entirely from the player's own current
  // input, reveals nothing they couldn't already see themselves.
  function isRowSatisfied(r) {
    const base = r * state.cols;
    const line = [];
    for (let c = 0; c < state.cols; c++) line.push(state.cells[base + c] === FILLED ? 1 : 0);
    const actual = clueFor(line);
    const expect = state.rowClues[r];
    return actual.length === expect.length && actual.every((v, i) => v === expect[i]);
  }
  function isColSatisfied(c) {
    const line = [];
    for (let r = 0; r < state.rows; r++) line.push(state.cells[r * state.cols + c] === FILLED ? 1 : 0);
    const actual = clueFor(line);
    const expect = state.colClues[c];
    return actual.length === expect.length && actual.every((v, i) => v === expect[i]);
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
    toggleCell,
    togglePaintMode,
    undo,
    isRowSatisfied,
    isColSatisfied,
    getState,
    getBoardSize,
    formatTime,
    formatSeconds,
  };
})();

if (typeof window !== "undefined") {
  window.NonogramGame = NonogramGame;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = NonogramGame;
}
