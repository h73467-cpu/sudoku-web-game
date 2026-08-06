// 四子棋 (Connect Four) state controller: owns board state, undo stack,
// timer, win detection, persistence, and the AI opponent. No DOM access
// here (that's ui.js's job).
//
// Unlike every other game in this hub, this is a two-player game, not a
// solo puzzle — so it has two modes (`state.mode`): "ai" (vs a minimax
// opponent, difficulty controls search depth) and "local" (two people
// sharing one device, no difficulty/AI involved). Career/history tracking
// is shaped differently from the rest of the hub's bestTime/bestMoves/won
// pattern for the same reason — win/loss/draw is what matters here, not a
// personal best time.
var ConnectFourGame = (function () {
  const ROWS = 6;
  const COLS = 7;
  const CENTER_COL = Math.floor(COLS / 2);
  const EMPTY = 0;

  // Search depth per AI difficulty, plus a chance of playing a random
  // (non-optimal) move instead so 簡單/中等 actually feel beatable rather
  // than just "the same unbeatable AI but slower to lose to."
  const AI_CONFIG = {
    easy: { depth: 2, randomness: 0.35 },
    medium: { depth: 4, randomness: 0.15 },
    hard: { depth: 6, randomness: 0 },
    expert: { depth: 8, randomness: 0 },
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

  // -- board primitives -------------------------------------------------

  function emptyBoard() {
    return new Array(ROWS * COLS).fill(EMPTY);
  }

  function dropRow(heights, col) {
    return ROWS - 1 - heights[col];
  }

  function validColumns(heights) {
    const out = [];
    for (let c = 0; c < COLS; c++) if (heights[c] < ROWS) out.push(c);
    return out;
  }

  // Checks for a 4+ in a row through (row,col) — the cell that was just
  // played. Returns the full connected run (length >= 4) if there's a win
  // through this cell, else null. Only checking around the last move (not
  // scanning the whole board) keeps this cheap enough to call at every
  // minimax node.
  function winningLineThrough(board, row, col) {
    const player = board[row * COLS + col];
    if (player === EMPTY) return null;
    const dirs = [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, -1],
    ];
    for (const [dr, dc] of dirs) {
      const line = [[row, col]];
      let r = row + dr;
      let c = col + dc;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === player) {
        line.push([r, c]);
        r += dr;
        c += dc;
      }
      r = row - dr;
      c = col - dc;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === player) {
        line.unshift([r, c]);
        r -= dr;
        c -= dc;
      }
      if (line.length >= 4) return line.map(([lr, lc]) => lr * COLS + lc);
    }
    return null;
  }

  function isBoardFull(heights) {
    return heights.every((h) => h >= ROWS);
  }

  // -- AI (minimax with alpha-beta pruning) ----------------------------

  function scoreWindow(cells, aiPlayer, humanPlayer) {
    let ai = 0;
    let human = 0;
    let empty = 0;
    for (const v of cells) {
      if (v === aiPlayer) ai++;
      else if (v === humanPlayer) human++;
      else empty++;
    }
    if (ai > 0 && human > 0) return 0;
    if (ai === 4) return 100000;
    if (ai === 3 && empty === 1) return 100;
    if (ai === 2 && empty === 2) return 10;
    if (ai === 1 && empty === 3) return 1;
    if (human === 4) return -100000;
    if (human === 3 && empty === 1) return -120;
    if (human === 2 && empty === 2) return -12;
    if (human === 1 && empty === 3) return -1;
    return 0;
  }

  function evaluateBoard(board, aiPlayer) {
    const humanPlayer = aiPlayer === 1 ? 2 : 1;
    let score = 0;
    for (let r = 0; r < ROWS; r++) {
      if (board[r * COLS + CENTER_COL] === aiPlayer) score += 6;
      else if (board[r * COLS + CENTER_COL] === humanPlayer) score -= 6;
    }
    // horizontal
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c <= COLS - 4; c++) {
        const window = [
          board[r * COLS + c],
          board[r * COLS + c + 1],
          board[r * COLS + c + 2],
          board[r * COLS + c + 3],
        ];
        score += scoreWindow(window, aiPlayer, humanPlayer);
      }
    }
    // vertical
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r <= ROWS - 4; r++) {
        const window = [
          board[r * COLS + c],
          board[(r + 1) * COLS + c],
          board[(r + 2) * COLS + c],
          board[(r + 3) * COLS + c],
        ];
        score += scoreWindow(window, aiPlayer, humanPlayer);
      }
    }
    // diagonal (down-right)
    for (let r = 0; r <= ROWS - 4; r++) {
      for (let c = 0; c <= COLS - 4; c++) {
        const window = [
          board[r * COLS + c],
          board[(r + 1) * COLS + c + 1],
          board[(r + 2) * COLS + c + 2],
          board[(r + 3) * COLS + c + 3],
        ];
        score += scoreWindow(window, aiPlayer, humanPlayer);
      }
    }
    // diagonal (down-left)
    for (let r = 0; r <= ROWS - 4; r++) {
      for (let c = 3; c < COLS; c++) {
        const window = [
          board[r * COLS + c],
          board[(r + 1) * COLS + c - 1],
          board[(r + 2) * COLS + c - 2],
          board[(r + 3) * COLS + c - 3],
        ];
        score += scoreWindow(window, aiPlayer, humanPlayer);
      }
    }
    return score;
  }

  function orderedColumns(heights) {
    return validColumns(heights).sort((a, b) => Math.abs(a - CENTER_COL) - Math.abs(b - CENTER_COL));
  }

  // Mutates `board`/`heights` while searching and backtracks afterward
  // (no per-node array copying) — keeps depth-8 search fast enough to run
  // synchronously. `lastMove` lets the terminal check stay O(1)-ish
  // (only scan around the cell that was just played) instead of rescanning
  // the whole board at every node.
  function minimax(board, heights, depth, alpha, beta, maximizing, aiPlayer, humanPlayer, lastMove) {
    if (lastMove) {
      const line = winningLineThrough(board, lastMove.row, lastMove.col);
      if (line) {
        const winner = board[lastMove.row * COLS + lastMove.col];
        const score = winner === aiPlayer ? 1000000 + depth : -1000000 - depth;
        return { score };
      }
    }
    if (isBoardFull(heights)) return { score: 0 };
    if (depth === 0) return { score: evaluateBoard(board, aiPlayer) };

    const cols = orderedColumns(heights);
    const player = maximizing ? aiPlayer : humanPlayer;
    let bestScore = maximizing ? -Infinity : Infinity;
    let bestCol = cols[0];

    for (const col of cols) {
      const row = dropRow(heights, col);
      board[row * COLS + col] = player;
      heights[col]++;
      const result = minimax(board, heights, depth - 1, alpha, beta, !maximizing, aiPlayer, humanPlayer, { row, col });
      board[row * COLS + col] = EMPTY;
      heights[col]--;

      if (maximizing) {
        if (result.score > bestScore) {
          bestScore = result.score;
          bestCol = col;
        }
        alpha = Math.max(alpha, bestScore);
      } else {
        if (result.score < bestScore) {
          bestScore = result.score;
          bestCol = col;
        }
        beta = Math.min(beta, bestScore);
      }
      if (alpha >= beta) break;
    }
    return { score: bestScore, col: bestCol };
  }

  function chooseAiMove(board, heights, aiPlayer, humanPlayer, difficulty) {
    const cols = validColumns(heights);
    const config = AI_CONFIG[difficulty] || AI_CONFIG.medium;
    if (Math.random() < config.randomness) {
      return cols[Math.floor(Math.random() * cols.length)];
    }
    // Immediate win check first — minimax already finds this, but a direct
    // check keeps the "AI takes an obvious win" case cheap and certain.
    for (const col of cols) {
      const row = dropRow(heights, col);
      board[row * COLS + col] = aiPlayer;
      const line = winningLineThrough(board, row, col);
      board[row * COLS + col] = EMPTY;
      if (line) return col;
    }
    const result = minimax(board, heights, config.depth, -Infinity, Infinity, true, aiPlayer, humanPlayer, null);
    return result.col != null ? result.col : cols[Math.floor(cols.length / 2)];
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

  function heightsFromBoard(board) {
    const heights = new Array(COLS).fill(0);
    for (let c = 0; c < COLS; c++) {
      let h = 0;
      for (let r = ROWS - 1; r >= 0; r--) {
        if (board[r * COLS + c] !== EMPTY) h++;
        else break;
      }
      heights[c] = h;
    }
    return heights;
  }

  function serialize() {
    return {
      mode: state.mode,
      difficulty: state.difficulty,
      board: state.board.slice(),
      currentPlayer: state.currentPlayer,
      history: state.history,
      moves: state.moves,
      elapsedMs: getElapsedMs(),
      status: state.status === "playing" ? "playing" : state.status,
      winner: state.winner,
      winningLine: state.winningLine,
    };
  }

  function deserialize(saved) {
    return {
      mode: saved.mode === "local" ? "local" : "ai",
      difficulty: saved.difficulty,
      board: saved.board.slice(),
      heights: heightsFromBoard(saved.board),
      currentPlayer: saved.currentPlayer || 1,
      history: Array.isArray(saved.history) ? saved.history : [],
      moves: saved.moves || 0,
      elapsedMs: saved.elapsedMs || 0,
      startTimestamp: Date.now(),
      status: saved.status === "won" || saved.status === "draw" ? saved.status : "playing",
      winner: saved.winner || null,
      winningLine: Array.isArray(saved.winningLine) ? saved.winningLine : null,
      aiThinking: false,
    };
  }

  function persist() {
    if (state && state.status === "playing") {
      ConnectFourStorage.saveCurrentGame(serialize());
    }
  }

  // mode: "ai" | "local"; difficulty only used for "ai".
  function newGame(mode, difficulty) {
    stopTimerInterval();
    state = {
      mode,
      difficulty: mode === "ai" ? difficulty || "medium" : null,
      board: emptyBoard(),
      heights: new Array(COLS).fill(0),
      currentPlayer: 1,
      history: [],
      moves: 0,
      elapsedMs: 0,
      startTimestamp: Date.now(),
      status: "playing",
      winner: null,
      winningLine: null,
      aiThinking: false,
    };
    startTimer();
    persist();
    notify("new-game");
  }

  function resumeGame() {
    const saved = ConnectFourStorage.loadCurrentGame();
    if (!saved || !Array.isArray(saved.board) || saved.board.length !== ROWS * COLS) return false;
    if (saved.status !== "playing") return false;
    stopTimerInterval();
    state = deserialize(saved);
    startTimer();
    notify("restore");
    return true;
  }

  function hasSavedResumableGame() {
    const saved = ConnectFourStorage.loadCurrentGame();
    return !!(saved && saved.status === "playing");
  }

  function hasProgress() {
    if (!state) return false;
    if (state.status !== "playing") return false;
    return state.moves > 0;
  }

  function finishGame(status, winner) {
    state.elapsedMs = getElapsedMs();
    state.status = status;
    state.winner = winner;
    stopTimerInterval();
    const elapsedSeconds = Math.floor(state.elapsedMs / 1000);
    if (state.mode === "ai") {
      const result = status === "draw" ? "draw" : winner === 1 ? "win" : "loss";
      ConnectFourStorage.updateAiCareer(state.difficulty, result);
    } else {
      ConnectFourStorage.updateLocalCareer(status === "draw" ? null : winner);
    }
    ConnectFourStorage.appendHistoryEntry({
      mode: state.mode,
      difficulty: state.difficulty,
      status,
      winner,
      moves: state.moves,
      elapsedSeconds,
      completedAt: new Date().toISOString(),
    });
    ConnectFourStorage.clearCurrentGame();
  }

  // Drops `player`'s piece into `col`, checks for win/draw, and — in AI
  // mode, once it becomes the AI's turn — triggers the AI's reply. Returns
  // false if the column is full.
  function dropInternal(col, player) {
    if (state.heights[col] >= ROWS) {
      notify("invalid");
      return false;
    }
    const row = dropRow(state.heights, col);
    state.board[row * COLS + col] = player;
    state.heights[col]++;
    state.history.push({ col, row, player });
    state.moves++;

    const line = winningLineThrough(state.board, row, col);
    if (line) {
      state.winningLine = line;
      finishGame("won", player);
      notify("drop");
      return true;
    }
    if (isBoardFull(state.heights)) {
      finishGame("draw", null);
      notify("drop");
      return true;
    }
    state.currentPlayer = player === 1 ? 2 : 1;
    persist();
    notify("drop");
    return true;
  }

  function playColumn(col) {
    if (!state || state.status !== "playing" || state.aiThinking) return false;
    if (state.mode === "ai" && state.currentPlayer !== 1) return false;
    const player = state.currentPlayer;
    const ok = dropInternal(col, player);
    if (!ok) return false;
    if (state.mode === "ai" && state.status === "playing" && state.currentPlayer === 2) {
      state.aiThinking = true;
      notify("ai-thinking");
    }
    return true;
  }

  // Called by ui.js after a short defer so a "AI 思考中" indicator can
  // paint first — minimax at higher difficulties is real synchronous work,
  // same reasoning as nonogram's generation-loading placeholder.
  function runAiTurn() {
    if (!state || state.status !== "playing" || state.mode !== "ai" || state.currentPlayer !== 2) {
      state && (state.aiThinking = false);
      return;
    }
    const col = chooseAiMove(state.board, state.heights, 2, 1, state.difficulty);
    state.aiThinking = false;
    dropInternal(col, 2);
  }

  function undo() {
    if (!state || state.status !== "playing" || state.history.length === 0) return;
    // In AI mode, undo removes the AI's reply too so it's always the
    // human's turn again afterward.
    const stepsToUndo = state.mode === "ai" && state.history[state.history.length - 1].player === 2 ? 2 : 1;
    for (let i = 0; i < stepsToUndo && state.history.length > 0; i++) {
      const last = state.history.pop();
      state.board[last.row * COLS + last.col] = EMPTY;
      state.heights[last.col]--;
      state.currentPlayer = last.player;
      state.moves--;
    }
    state.winningLine = null;
    state.aiThinking = false;
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
    playColumn,
    runAiTurn,
    undo,
    getState,
    getBoardSize,
    formatTime,
    formatSeconds,
  };
})();

if (typeof window !== "undefined") {
  window.ConnectFourGame = ConnectFourGame;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = ConnectFourGame;
}
