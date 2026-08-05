// 華容道 (Klotski / Huarong Dao) state controller: owns board state, undo
// stack, timer, win detection, persistence. No DOM access here (that's
// ui.js's job). Mirrors the shape of sudoku/js/game.js.
//
// Board is the classic 4-column x 5-row layout with a 2-wide exit gap at
// the bottom-center, and the classic 10-piece set: one 2x2 ("Cao Cao"),
// four 1x2 vertical generals, one 2x1 horizontal general, four 1x1
// soldiers. Goal: slide Cao Cao down to the exit (row 3, col 1).
var KlotskiGame = (function () {
  const ROWS = 5;
  const COLS = 4;
  const EXIT_ROW = 3;
  const EXIT_COL = 1;
  const DEFAULT_MAX_HINTS = 0; // no solver-based hints; undo is this game's assistive feature

  // Static shape per piece id: rowSpan/colSpan/type. Positions are dynamic
  // (state.pieces), shapes never change during play.
  const PIECE_SHAPES = {
    caocao: { rowSpan: 2, colSpan: 2, type: "caocao" },
    vert1: { rowSpan: 2, colSpan: 1, type: "general" },
    vert2: { rowSpan: 2, colSpan: 1, type: "general" },
    vert3: { rowSpan: 2, colSpan: 1, type: "general" },
    vert4: { rowSpan: 2, colSpan: 1, type: "general" },
    horiz1: { rowSpan: 1, colSpan: 2, type: "general" },
    s1: { rowSpan: 1, colSpan: 1, type: "soldier" },
    s2: { rowSpan: 1, colSpan: 1, type: "soldier" },
    s3: { rowSpan: 1, colSpan: 1, type: "soldier" },
    s4: { rowSpan: 1, colSpan: 1, type: "soldier" },
  };

  // Hand-verified full tiling of the 4x5 board (no overlaps, 2 empty cells),
  // with Cao Cao already at the exit — used as the seed for scrambling
  // easier tiers (scrambling backward from a solved state guarantees the
  // result is solvable).
  //
  // Deliberately different from CLASSIC_LAYOUT below: here Cao Cao's two
  // side neighbors at the exit row are 1x1 soldiers (s1/s2), not tall
  // vertical pieces. A first scrambling attempt flanked it with vertical
  // generals identical in shape/role to CLASSIC_LAYOUT's, which pins those
  // generals into their columns for the board's entire height with no
  // slack — Cao Cao ends up structurally trapped in a 2-cell vertical
  // corridor no matter how many random moves are applied (measured: even
  // 400 uniform random moves left it within Manhattan distance ~1 of the
  // exit on average). Soldiers are far more mobile (they can step into
  // either of the two starting empty corners immediately), so scrambling
  // can actually explore sideways moves within a reasonable move budget.
  const SOLVED_BASE = {
    caocao: { row: 3, col: 1 },
    vert1: { row: 0, col: 0 },
    vert2: { row: 0, col: 3 },
    vert3: { row: 1, col: 1 },
    vert4: { row: 1, col: 2 },
    horiz1: { row: 0, col: 1 },
    s1: { row: 3, col: 0 },
    s2: { row: 3, col: 3 },
    s3: { row: 2, col: 0 },
    s4: { row: 2, col: 3 },
  };

  // The authentic classic "橫刀立馬" starting layout, used for 專家
  // (expert) difficulty — the real puzzle rather than a procedural one.
  const CLASSIC_LAYOUT = {
    caocao: { row: 0, col: 1 },
    vert1: { row: 0, col: 0 },
    vert2: { row: 0, col: 3 },
    vert3: { row: 2, col: 0 },
    vert4: { row: 2, col: 3 },
    horiz1: { row: 2, col: 1 },
    s1: { row: 3, col: 1 },
    s2: { row: 3, col: 2 },
    s3: { row: 4, col: 0 },
    s4: { row: 4, col: 3 },
  };

  // Total random legal moves applied to scramble each difficulty. On this
  // small a board (4x5), Cao Cao's own Manhattan distance from the exit is
  // capped at 4 and stays small under almost any scramble — even the real
  // classic layout only sits 3 cells away despite needing 81 moves to
  // solve. So step count here isn't chasing "distance"; it's scrambling
  // the *other* nine pieces enough that reconstructing a path back takes
  // real work, while the guard below (see scrambleFromSolved) is what
  // actually guarantees the puzzle isn't trivially solvable.
  const SCRAMBLE_STEPS = { easy: 40, medium: 90, hard: 180 };
  const SUPER_EASY_FLOOR_STEPS = 15;

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

  function piecesFromPositions(positions) {
    return Object.keys(positions).map((id) => ({
      id,
      row: positions[id].row,
      col: positions[id].col,
      rowSpan: PIECE_SHAPES[id].rowSpan,
      colSpan: PIECE_SHAPES[id].colSpan,
      type: PIECE_SHAPES[id].type,
    }));
  }

  function cellsOf(piece, row, col) {
    const cells = [];
    for (let r = row; r < row + piece.rowSpan; r++) {
      for (let c = col; c < col + piece.colSpan; c++) cells.push(r * COLS + c);
    }
    return cells;
  }

  function buildOccupancy(pieces) {
    const grid = new Array(ROWS * COLS).fill(null);
    pieces.forEach((p) => {
      cellsOf(p, p.row, p.col).forEach((cell) => (grid[cell] = p.id));
    });
    return grid;
  }

  function canMovePiece(pieces, grid, piece, dr, dc) {
    const newRow = piece.row + dr;
    const newCol = piece.col + dc;
    if (newRow < 0 || newCol < 0 || newRow + piece.rowSpan > ROWS || newCol + piece.colSpan > COLS) {
      return false;
    }
    const destCells = cellsOf(piece, newRow, newCol);
    return destCells.every((cell) => grid[cell] == null || grid[cell] === piece.id);
  }

  function applyMoveToPieces(pieces, pieceId, dr, dc) {
    const piece = pieces.find((p) => p.id === pieceId);
    piece.row += dr;
    piece.col += dc;
  }

  function allLegalMoves(pieces) {
    const grid = buildOccupancy(pieces);
    const moves = [];
    const dirs = [
      { dr: -1, dc: 0 },
      { dr: 1, dc: 0 },
      { dr: 0, dc: -1 },
      { dr: 0, dc: 1 },
    ];
    pieces.forEach((piece) => {
      dirs.forEach(({ dr, dc }) => {
        if (canMovePiece(pieces, grid, piece, dr, dc)) moves.push({ pieceId: piece.id, dr, dc });
      });
    });
    return moves;
  }

  function isSolved(pieces) {
    const caocao = pieces.find((p) => p.id === "caocao");
    return caocao.row === EXIT_ROW && caocao.col === EXIT_COL;
  }

  // True if some single legal move would win immediately — the exact
  // "just slide it down once" case reported as making every difficulty
  // feel identical and trivial.
  function hasWinningMove(pieces) {
    const caocao = pieces.find((p) => p.id === "caocao");
    const grid = buildOccupancy(pieces);
    const dirs = [
      { dr: -1, dc: 0 },
      { dr: 1, dc: 0 },
      { dr: 0, dc: -1 },
      { dr: 0, dc: 1 },
    ];
    return dirs.some(
      ({ dr, dc }) =>
        caocao.row + dr === EXIT_ROW &&
        caocao.col + dc === EXIT_COL &&
        canMovePiece(pieces, grid, caocao, dr, dc)
    );
  }

  function scrambleFromSolved(steps) {
    let pieces = piecesFromPositions(SOLVED_BASE);
    let lastMove = null;
    for (let i = 0; i < steps; i++) {
      const moves = allLegalMoves(pieces);
      const filtered = lastMove
        ? moves.filter((m) => !(m.pieceId === lastMove.pieceId && m.dr === -lastMove.dr && m.dc === -lastMove.dc))
        : moves;
      const pool = filtered.length > 0 ? filtered : moves;
      const move = pool[Math.floor(Math.random() * pool.length)];
      applyMoveToPieces(pieces, move.pieceId, move.dr, move.dc);
      lastMove = move;
    }

    // Guarantee the puzzle isn't solvable in 0 or 1 moves — the exact
    // "Cao Cao always parked right above the exit" complaint. When picking
    // a move to escape this, Cao Cao's own winning move is explicitly
    // excluded from the pool, since otherwise "prefer moving Cao Cao when
    // possible" would just walk straight into the thing being avoided.
    // Cheap array bookkeeping on a 20-cell board — generous cap costs
    // nothing measurable even in the rare pathological case.
    let guard = 0;
    while ((isSolved(pieces) || hasWinningMove(pieces)) && guard < 3000) {
      const moves = allLegalMoves(pieces);
      const nonWinning = moves.filter((m) => {
        if (m.pieceId !== "caocao") return true;
        const caocao = pieces.find((p) => p.id === "caocao");
        return !(caocao.row + m.dr === EXIT_ROW && caocao.col + m.dc === EXIT_COL);
      });
      const pool = nonWinning.length > 0 ? nonWinning : moves;
      const move = pool[Math.floor(Math.random() * pool.length)];
      applyMoveToPieces(pieces, move.pieceId, move.dr, move.dc);
      guard++;
    }
    return pieces;
  }

  function buildBoard(difficulty) {
    if (difficulty === "expert") return piecesFromPositions(CLASSIC_LAYOUT);
    const steps =
      difficulty === "superEasy"
        ? superEasySteps(KlotskiStorage.getSettings().superEasyPercent)
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
      pieces: state.pieces.map((p) => ({ id: p.id, row: p.row, col: p.col })),
      history: state.history,
      moves: state.moves,
      selectedPieceId: state.selectedPieceId,
      elapsedMs: getElapsedMs(),
      status: state.status === "won" ? "won" : "playing",
    };
  }

  function deserialize(saved) {
    const pieces = saved.pieces.map((p) => ({
      id: p.id,
      row: p.row,
      col: p.col,
      rowSpan: PIECE_SHAPES[p.id].rowSpan,
      colSpan: PIECE_SHAPES[p.id].colSpan,
      type: PIECE_SHAPES[p.id].type,
    }));
    return {
      difficulty: saved.difficulty,
      pieces,
      history: Array.isArray(saved.history) ? saved.history : [],
      moves: saved.moves || 0,
      selectedPieceId: null,
      elapsedMs: saved.elapsedMs || 0,
      startTimestamp: Date.now(),
      status: saved.status === "won" ? "won" : "playing",
    };
  }

  function persist() {
    if (state && state.status !== "won") {
      KlotskiStorage.saveCurrentGame(serialize());
    }
  }

  function newGame(difficulty) {
    stopTimerInterval();
    state = {
      difficulty,
      pieces: buildBoard(difficulty),
      history: [],
      moves: 0,
      selectedPieceId: null,
      elapsedMs: 0,
      startTimestamp: Date.now(),
      status: "playing",
    };
    startTimer();
    persist();
    notify("new-game");
  }

  function resumeGame() {
    const saved = KlotskiStorage.loadCurrentGame();
    if (!saved || !Array.isArray(saved.pieces)) return false;
    if (saved.status !== "playing") return false;
    stopTimerInterval();
    state = deserialize(saved);
    if (state.status === "playing") startTimer();
    notify("restore");
    return true;
  }

  function hasSavedResumableGame() {
    const saved = KlotskiStorage.loadCurrentGame();
    return !!(saved && saved.status === "playing");
  }

  function hasProgress() {
    if (!state) return false;
    if (state.status !== "playing") return false;
    return state.moves > 0;
  }

  function selectPiece(pieceId) {
    if (!state || state.status !== "playing") return;
    state.selectedPieceId = state.selectedPieceId === pieceId ? null : pieceId;
    notify("select");
  }

  function finishWin() {
    state.elapsedMs = getElapsedMs();
    state.status = "won";
    stopTimerInterval();
    const elapsedSeconds = Math.floor(state.elapsedMs / 1000);
    const isNewBest = KlotskiStorage.updateCareer(state.difficulty, elapsedSeconds, state.moves);
    KlotskiStorage.appendHistoryEntry({
      difficulty: state.difficulty,
      moves: state.moves,
      elapsedSeconds,
      completedAt: new Date().toISOString(),
    });
    KlotskiStorage.clearCurrentGame();
    state.justWon = { isNewBest };
  }

  function moveBy(dr, dc) {
    if (!state || state.status !== "playing" || !state.selectedPieceId) return false;
    const piece = state.pieces.find((p) => p.id === state.selectedPieceId);
    const grid = buildOccupancy(state.pieces);
    if (!canMovePiece(state.pieces, grid, piece, dr, dc)) {
      notify("invalid");
      return false;
    }
    state.history.push({ pieceId: piece.id, dr, dc });
    piece.row += dr;
    piece.col += dc;
    state.moves++;
    if (isSolved(state.pieces)) {
      finishWin();
    } else {
      persist();
    }
    notify("move");
    return true;
  }

  // Called when the player clicks an empty cell while a piece is selected —
  // infers which of the (at most 4) directions that cell corresponds to.
  function moveSelectedToward(targetRow, targetCol) {
    if (!state || state.status !== "playing" || !state.selectedPieceId) return;
    const piece = state.pieces.find((p) => p.id === state.selectedPieceId);
    const grid = buildOccupancy(state.pieces);
    const dirs = [
      { dr: -1, dc: 0 },
      { dr: 1, dc: 0 },
      { dr: 0, dc: -1 },
      { dr: 0, dc: 1 },
    ];
    for (const { dr, dc } of dirs) {
      if (!canMovePiece(state.pieces, grid, piece, dr, dc)) continue;
      const oldCells = new Set(cellsOf(piece, piece.row, piece.col));
      const newCells = cellsOf(piece, piece.row + dr, piece.col + dc);
      const targetCell = targetRow * COLS + targetCol;
      if (newCells.includes(targetCell) && !oldCells.has(targetCell)) {
        moveBy(dr, dc);
        return;
      }
    }
  }

  function undo() {
    if (!state || state.status !== "playing" || state.history.length === 0) return;
    const last = state.history.pop();
    const piece = state.pieces.find((p) => p.id === last.pieceId);
    piece.row -= last.dr;
    piece.col -= last.dc;
    state.selectedPieceId = last.pieceId;
    persist();
    notify("undo");
  }

  function getState() {
    return state;
  }
  function getBoardSize() {
    return { rows: ROWS, cols: COLS, exitRow: EXIT_ROW, exitCol: EXIT_COL };
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
    selectPiece,
    moveBy,
    moveSelectedToward,
    undo,
    getState,
    getBoardSize,
    formatTime,
    formatSeconds,
  };
})();

if (typeof window !== "undefined") {
  window.KlotskiGame = KlotskiGame;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = KlotskiGame;
}
