// 黑白棋 (Othello / Reversi) state controller: owns board state, undo
// stack, timer, win detection, persistence, and the AI opponent. No DOM
// access here (that's ui.js's job). Mirrors connectFour/js/game.js's shape
// (the other adversarial two-player game in this hub) — two modes ("ai"
// vs "local"), no 超簡單 tier (search depth is the only difficulty axis),
// win/loss/draw career tracking instead of bestTime/bestMoves.
var OthelloGame = (function () {
  const SIZE = 8;
  const EMPTY = 0;
  const BLACK = 1;
  const WHITE = 2;
  const DIRS = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1],
  ];

  // Classic positional weight matrix (corners very valuable, cells next to
  // a corner dangerous — taking one often hands the opponent the corner).
  // Combined with a mobility term and an endgame-weighted piece-count term;
  // this three-part heuristic is the standard simple-but-solid approach for
  // an Othello evaluation function.
  const WEIGHTS = [
    120, -20, 20, 5, 5, 20, -20, 120,
    -20, -40, -5, -5, -5, -5, -40, -20,
    20, -5, 15, 3, 3, 15, -5, 20,
    5, -5, 3, 3, 3, 3, -5, 5,
    5, -5, 3, 3, 3, 3, -5, 5,
    20, -5, 15, 3, 3, 15, -5, 20,
    -20, -40, -5, -5, -5, -5, -40, -20,
    120, -20, 20, 5, 5, 20, -20, 120,
  ];

  const AI_CONFIG = {
    easy: { depth: 2, randomness: 0.35 },
    medium: { depth: 3, randomness: 0.15 },
    hard: { depth: 5, randomness: 0 },
    expert: { depth: 7, randomness: 0 },
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

  function opponentOf(player) {
    return player === BLACK ? WHITE : BLACK;
  }

  function initialBoard() {
    const board = new Array(SIZE * SIZE).fill(EMPTY);
    board[3 * SIZE + 3] = WHITE;
    board[3 * SIZE + 4] = BLACK;
    board[4 * SIZE + 3] = BLACK;
    board[4 * SIZE + 4] = WHITE;
    return board;
  }

  // Returns the list of opponent cell indices that would be flipped by
  // playing `player` at (row,col), or an empty array if the move is
  // illegal there (empty array also correctly means "not a legal move").
  function flipsFor(board, row, col, player) {
    if (board[row * SIZE + col] !== EMPTY) return [];
    const opponent = opponentOf(player);
    const allFlips = [];
    for (const [dr, dc] of DIRS) {
      let r = row + dr;
      let c = col + dc;
      const run = [];
      while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r * SIZE + c] === opponent) {
        run.push(r * SIZE + c);
        r += dr;
        c += dc;
      }
      if (run.length > 0 && r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r * SIZE + c] === player) {
        allFlips.push(...run);
      }
    }
    return allFlips;
  }

  function legalMoves(board, player) {
    const moves = [];
    for (let i = 0; i < SIZE * SIZE; i++) {
      if (board[i] !== EMPTY) continue;
      const row = Math.floor(i / SIZE);
      const col = i % SIZE;
      const flips = flipsFor(board, row, col, player);
      if (flips.length > 0) moves.push({ index: i, row, col, flips });
    }
    return moves;
  }

  function applyMove(board, move, player) {
    board[move.index] = player;
    for (const idx of move.flips) board[idx] = player;
  }

  function countPieces(board) {
    let black = 0;
    let white = 0;
    for (const v of board) {
      if (v === BLACK) black++;
      else if (v === WHITE) white++;
    }
    return { black, white };
  }

  // -- AI (minimax with alpha-beta pruning) ----------------------------

  function evaluateBoard(board, aiPlayer) {
    const human = opponentOf(aiPlayer);
    let positional = 0;
    for (let i = 0; i < SIZE * SIZE; i++) {
      if (board[i] === aiPlayer) positional += WEIGHTS[i];
      else if (board[i] === human) positional -= WEIGHTS[i];
    }
    const aiMoves = legalMoves(board, aiPlayer).length;
    const humanMoves = legalMoves(board, human).length;
    const mobility = (aiMoves - humanMoves) * 8;

    const { black, white } = countPieces(board);
    const aiCount = aiPlayer === BLACK ? black : white;
    const humanCount = aiPlayer === BLACK ? white : black;
    const emptyCount = SIZE * SIZE - black - white;
    // Piece count barely matters early (a big lead mid-game is often
    // fragile) but matters a lot once the board is nearly full.
    const pieceWeight = emptyCount < 12 ? 25 : 2;
    const pieceDiff = (aiCount - humanCount) * pieceWeight;

    return positional + mobility + pieceDiff;
  }

  // Mutates `board` while searching and backtracks afterward. `player` is
  // who's to move at this node; passing (no legal moves) still consumes a
  // ply for simplicity. Terminal (both sides stuck) is scored by final
  // piece count.
  //
  // Othello's branching factor is unpredictable (unlike connect four's
  // fixed-width columns) — some midgame positions where both sides have
  // many flippable lines blow the search tree up far past what the
  // configured depth implies, even with alpha-beta pruning and good move
  // ordering (measured: one specific position at depth 3/"medium" ran over
  // 40s with no cap at all). A wall-clock deadline bounds worst-case
  // latency regardless of position — checked every 2000 nodes so the
  // Date.now() overhead stays negligible relative to the search itself.
  //
  // Getting this right took two attempts. The first version only checked
  // the deadline at function entry and returned a cheap heuristic score
  // once expired — but that alone doesn't stop the *parent* for-loops from
  // continuing to iterate every remaining sibling move at every level of
  // the tree; each call became cheap, but there could still be millions of
  // them left to visit (measured: over 27 million node calls and 19+
  // seconds after the 350ms deadline had already passed, on one specific
  // midgame position — expiring the deadline degrades the search into
  // "evaluate every remaining node with the heuristic," which is fast per
  // call but doesn't reduce how many remain). The fix is `searchAborted`:
  // once set, every level's move-iteration loop breaks immediately instead
  // of continuing to the next sibling, so the whole call stack unwinds in
  // O(remaining recursion depth) rather than O(remaining tree size).
  const TIME_BUDGET_MS = 350;
  let searchDeadline = 0;
  let nodeCounter = 0;
  let searchAborted = false;

  function timeUp() {
    if (searchAborted) return true;
    nodeCounter++;
    if (nodeCounter % 2000 !== 0) return false;
    if (Date.now() >= searchDeadline) searchAborted = true;
    return searchAborted;
  }

  function minimax(board, player, aiPlayer, depth, alpha, beta) {
    if (timeUp()) return { score: evaluateBoard(board, aiPlayer) };
    const moves = legalMoves(board, player);
    if (moves.length === 0) {
      const opponentMoves = legalMoves(board, opponentOf(player));
      if (opponentMoves.length === 0) {
        const { black, white } = countPieces(board);
        const aiCount = aiPlayer === BLACK ? black : white;
        const humanCount = aiPlayer === BLACK ? white : black;
        const diff = aiCount - humanCount;
        return { score: diff > 0 ? 1000000 + diff : diff < 0 ? -1000000 + diff : 0 };
      }
      // Pass: same depth budget spent, turn moves to the opponent.
      const result = minimax(board, opponentOf(player), aiPlayer, depth - 1, alpha, beta);
      return { score: result.score };
    }
    if (depth === 0) return { score: evaluateBoard(board, aiPlayer) };

    // Move ordering: corners first, then by static weight — improves
    // alpha-beta cutoff quality substantially versus board order.
    moves.sort((a, b) => WEIGHTS[b.index] - WEIGHTS[a.index]);

    const maximizing = player === aiPlayer;
    let best = maximizing ? -Infinity : Infinity;
    let bestMove = moves[0];

    for (const move of moves) {
      if (searchAborted) break;
      const backup = move.flips.map((idx) => board[idx]);
      const prevCell = board[move.index];
      applyMove(board, move, player);
      const result = minimax(board, opponentOf(player), aiPlayer, depth - 1, alpha, beta);
      board[move.index] = prevCell;
      move.flips.forEach((idx, i) => (board[idx] = backup[i]));

      if (maximizing) {
        if (result.score > best) {
          best = result.score;
          bestMove = move;
        }
        alpha = Math.max(alpha, best);
      } else {
        if (result.score < best) {
          best = result.score;
          bestMove = move;
        }
        beta = Math.min(beta, best);
      }
      if (alpha >= beta) break;
    }
    return { score: best, move: bestMove };
  }

  function chooseAiMove(board, aiPlayer, difficulty) {
    const moves = legalMoves(board, aiPlayer);
    if (moves.length === 0) return null;
    const config = AI_CONFIG[difficulty] || AI_CONFIG.medium;
    if (Math.random() < config.randomness) {
      return moves[Math.floor(Math.random() * moves.length)];
    }
    searchDeadline = Date.now() + TIME_BUDGET_MS;
    nodeCounter = 0;
    searchAborted = false;
    // Immediate-win-the-corner / obvious-best check is unnecessary here —
    // minimax with corner-first move ordering already finds it quickly at
    // any configured depth.
    const result = minimax(board, aiPlayer, aiPlayer, config.depth, -Infinity, Infinity);
    return result.move || moves[0];
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
      mode: state.mode,
      difficulty: state.difficulty,
      board: state.board.slice(),
      currentPlayer: state.currentPlayer,
      history: state.history,
      moves: state.moves,
      elapsedMs: getElapsedMs(),
      status: state.status,
      winner: state.winner,
    };
  }

  function deserialize(saved) {
    return {
      mode: saved.mode === "local" ? "local" : "ai",
      difficulty: saved.difficulty,
      board: saved.board.slice(),
      currentPlayer: saved.currentPlayer || BLACK,
      history: Array.isArray(saved.history) ? saved.history : [],
      moves: saved.moves || 0,
      elapsedMs: saved.elapsedMs || 0,
      startTimestamp: Date.now(),
      status: saved.status === "won" || saved.status === "draw" ? saved.status : "playing",
      winner: saved.winner || null,
      aiThinking: false,
      lastMoveIndex: null,
    };
  }

  function persist() {
    if (state && state.status === "playing") {
      OthelloStorage.saveCurrentGame(serialize());
    }
  }

  function newGame(mode, difficulty) {
    stopTimerInterval();
    state = {
      mode,
      difficulty: mode === "ai" ? difficulty || "medium" : null,
      board: initialBoard(),
      currentPlayer: BLACK,
      history: [],
      moves: 0,
      elapsedMs: 0,
      startTimestamp: Date.now(),
      status: "playing",
      winner: null,
      aiThinking: false,
      lastMoveIndex: null,
    };
    startTimer();
    persist();
    notify("new-game");
  }

  function resumeGame() {
    const saved = OthelloStorage.loadCurrentGame();
    if (!saved || !Array.isArray(saved.board) || saved.board.length !== SIZE * SIZE) return false;
    if (saved.status !== "playing") return false;
    stopTimerInterval();
    state = deserialize(saved);
    startTimer();
    notify("restore");
    return true;
  }

  function hasSavedResumableGame() {
    const saved = OthelloStorage.loadCurrentGame();
    return !!(saved && saved.status === "playing");
  }

  function hasProgress() {
    if (!state) return false;
    if (state.status !== "playing") return false;
    return state.moves > 0;
  }

  function finishGame() {
    const { black, white } = countPieces(state.board);
    state.elapsedMs = getElapsedMs();
    stopTimerInterval();
    let winner = null;
    if (black > white) winner = BLACK;
    else if (white > black) winner = WHITE;
    state.status = winner ? "won" : "draw";
    state.winner = winner;

    const elapsedSeconds = Math.floor(state.elapsedMs / 1000);
    if (state.mode === "ai") {
      const result = !winner ? "draw" : winner === BLACK ? "win" : "loss";
      OthelloStorage.updateAiCareer(state.difficulty, result);
    } else {
      OthelloStorage.updateLocalCareer(winner);
    }
    OthelloStorage.appendHistoryEntry({
      mode: state.mode,
      difficulty: state.difficulty,
      status: state.status,
      winner,
      black,
      white,
      moves: state.moves,
      elapsedSeconds,
      completedAt: new Date().toISOString(),
    });
    OthelloStorage.clearCurrentGame();
  }

  // Advances turn from `player` onward, auto-skipping any side with no
  // legal moves. Ends the game if neither side can move.
  function advanceTurn(fromPlayer) {
    const next = opponentOf(fromPlayer);
    if (legalMoves(state.board, next).length > 0) {
      state.currentPlayer = next;
      return;
    }
    if (legalMoves(state.board, fromPlayer).length > 0) {
      // Opponent has no moves; same player goes again (a "pass" for next).
      state.currentPlayer = fromPlayer;
      notify("pass");
      return;
    }
    finishGame();
  }

  function placePiece(index, player) {
    const row = Math.floor(index / SIZE);
    const col = index % SIZE;
    const flips = flipsFor(state.board, row, col, player);
    if (flips.length === 0) {
      notify("invalid");
      return false;
    }
    state.history.push({ index, player, flips: flips.slice() });
    state.board[index] = player;
    for (const idx of flips) state.board[idx] = player;
    state.moves++;
    state.lastMoveIndex = index;
    advanceTurn(player);
    if (state.status === "playing") persist();
    notify("place");
    return true;
  }

  function playCell(index) {
    if (!state || state.status !== "playing" || state.aiThinking) return false;
    if (state.mode === "ai" && state.currentPlayer !== BLACK) return false;
    const player = state.currentPlayer;
    const ok = placePiece(index, player);
    if (!ok) return false;
    if (state.mode === "ai" && state.status === "playing" && state.currentPlayer === WHITE) {
      state.aiThinking = true;
      notify("ai-thinking");
    }
    return true;
  }

  // Called by ui.js after a short defer so a "AI 思考中" indicator paints
  // first — same reasoning as connectFour's runAiTurn deferral.
  function runAiTurn() {
    if (!state || state.status !== "playing" || state.mode !== "ai" || state.currentPlayer !== WHITE) {
      if (state) state.aiThinking = false;
      return;
    }
    const move = chooseAiMove(state.board, WHITE, state.difficulty);
    state.aiThinking = false;
    if (!move) {
      // Shouldn't happen (advanceTurn already checked), but stay safe.
      notify("place");
      return;
    }
    placePiece(move.index, WHITE);
  }

  function undo() {
    if (!state || state.status !== "playing" || state.history.length === 0) return;
    const stepsToUndo = state.mode === "ai" && state.history[state.history.length - 1].player === WHITE ? 2 : 1;
    for (let i = 0; i < stepsToUndo && state.history.length > 0; i++) {
      const last = state.history.pop();
      state.board[last.index] = EMPTY;
      for (const idx of last.flips) state.board[idx] = opponentOf(last.player);
      state.currentPlayer = last.player;
      state.moves--;
    }
    state.lastMoveIndex = state.history.length > 0 ? state.history[state.history.length - 1].index : null;
    state.aiThinking = false;
    // Undoing through a skipped turn can land on a player who (at that
    // point in history) had zero legal moves — advanceTurn() would have
    // auto-skipped them during normal play, but a plain history-pop can't
    // replay that logic, so re-check here.
    if (legalMoves(state.board, state.currentPlayer).length === 0) {
      state.currentPlayer = opponentOf(state.currentPlayer);
    }
    persist();
    notify("undo");
  }

  function getLegalMoves() {
    if (!state) return [];
    return legalMoves(state.board, state.currentPlayer).map((m) => m.index);
  }

  function getState() {
    return state;
  }
  function getBoardSize() {
    return { rows: SIZE, cols: SIZE };
  }
  function getScore() {
    if (!state) return { black: 2, white: 2 };
    return countPieces(state.board);
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
    playCell,
    runAiTurn,
    undo,
    getLegalMoves,
    getState,
    getBoardSize,
    getScore,
    formatTime,
    formatSeconds,
  };
})();

if (typeof window !== "undefined") {
  window.OthelloGame = OthelloGame;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = OthelloGame;
}
