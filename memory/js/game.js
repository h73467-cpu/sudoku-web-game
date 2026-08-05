// Memory Match state controller: owns live state, timer, hints, win
// detection, persistence. No DOM access here (that's ui.js's job). Mirrors
// the shape of sudoku/js/game.js so the two games stay easy to compare.
var MemoryGame = (function () {
  const PAIR_COUNTS = { easy: 6, medium: 8, hard: 12, expert: 18 };
  const MIN_SUPER_EASY_PAIRS = 3;
  const DEFAULT_MAX_HINTS = 3;
  const MISMATCH_DELAY_MS = 1800;
  const HINT_PEEK_MS = 1200;
  const SYMBOL_POOL = [
    "🍎", "🍌", "🍇", "🍉", "🍓", "🍒", "🍑", "🥝",
    "🍍", "🥥", "🍋", "🍈", "🥭", "🍐", "🍊", "🌽", "🥕", "🍅",
  ];

  let state = null;
  let timerInterval = null;
  let mismatchTimeout = null;
  let hintTimeout = null;
  let changeListener = null;

  function onChange(cb) {
    changeListener = cb;
  }

  function notify(event) {
    if (changeListener) changeListener(state, event || null);
  }

  function superEasyPairs(percent) {
    const x = Math.max(10, Math.min(90, Math.round(Number(percent) || 30)));
    return Math.max(MIN_SUPER_EASY_PAIRS, Math.round(PAIR_COUNTS.easy * (1 - x / 100)));
  }

  function pairsForDifficulty(difficulty) {
    if (difficulty === "superEasy") {
      return superEasyPairs(MemoryStorage.getSettings().superEasyPercent);
    }
    return PAIR_COUNTS[difficulty] || PAIR_COUNTS.easy;
  }

  function columnsForCardCount(total) {
    if (total <= 16) return 4;
    return 6;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function buildCards(pairs) {
    const symbols = shuffle(SYMBOL_POOL.slice(0, pairs).concat(SYMBOL_POOL.slice(0, pairs)));
    shuffle(symbols);
    return symbols.map((symbol, index) => ({
      index,
      symbol,
      matched: false,
      flipped: false,
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
    if (state.status !== "playing" && state.status !== "resolving") return state.elapsedMs;
    return state.elapsedMs + (Date.now() - state.startTimestamp);
  }

  function serialize() {
    return {
      cards: state.cards.map((c) => ({ ...c, flipped: false })),
      difficulty: state.difficulty,
      cols: state.cols,
      moves: state.moves,
      hintsUsed: state.hintsUsed,
      maxHints: state.maxHints,
      elapsedMs: getElapsedMs(),
      status: state.status === "won" ? "won" : "playing",
    };
  }

  function deserialize(saved) {
    return {
      cards: saved.cards.map((c) => ({ ...c, flipped: false })),
      flippedIndices: [],
      difficulty: saved.difficulty,
      cols: saved.cols || columnsForCardCount(saved.cards.length),
      moves: saved.moves || 0,
      hintsUsed: saved.hintsUsed || 0,
      maxHints: saved.maxHints || DEFAULT_MAX_HINTS,
      elapsedMs: saved.elapsedMs || 0,
      startTimestamp: Date.now(),
      status: saved.status === "won" ? "won" : "playing",
    };
  }

  function persist() {
    if (state && state.status !== "won") {
      MemoryStorage.saveCurrentGame(serialize());
    }
  }

  function clearTimeouts() {
    if (mismatchTimeout) {
      clearTimeout(mismatchTimeout);
      mismatchTimeout = null;
    }
    if (hintTimeout) {
      clearTimeout(hintTimeout);
      hintTimeout = null;
    }
  }

  function newGame(difficulty) {
    stopTimerInterval();
    clearTimeouts();

    const pairs = pairsForDifficulty(difficulty);
    const cards = buildCards(pairs);
    state = {
      cards,
      flippedIndices: [],
      difficulty,
      cols: columnsForCardCount(cards.length),
      moves: 0,
      hintsUsed: 0,
      maxHints: DEFAULT_MAX_HINTS,
      elapsedMs: 0,
      startTimestamp: Date.now(),
      status: "playing",
    };
    startTimer();
    persist();
    notify("new-game");
  }

  function resumeGame() {
    const saved = MemoryStorage.loadCurrentGame();
    if (!saved || !Array.isArray(saved.cards)) return false;
    if (saved.status !== "playing") return false;
    stopTimerInterval();
    clearTimeouts();
    state = deserialize(saved);
    if (state.status === "playing") startTimer();
    notify("restore");
    return true;
  }

  function hasSavedResumableGame() {
    const saved = MemoryStorage.loadCurrentGame();
    return !!(saved && saved.status === "playing");
  }

  function hasProgress() {
    if (!state) return false;
    if (state.status !== "playing" && state.status !== "resolving") return false;
    return state.cards.some((c) => c.matched) || state.moves > 0;
  }

  function flipCard(index) {
    if (!state || state.status !== "playing") return;
    const card = state.cards[index];
    if (!card || card.matched || card.flipped) return;
    if (state.flippedIndices.length >= 2) return;

    card.flipped = true;
    state.flippedIndices.push(index);
    notify("flip");

    if (state.flippedIndices.length === 2) {
      state.moves++;
      const [ai, bi] = state.flippedIndices;
      const a = state.cards[ai];
      const b = state.cards[bi];
      if (a.symbol === b.symbol) {
        a.matched = true;
        b.matched = true;
        state.flippedIndices = [];
        persist();
        checkWin();
        notify("match");
      } else {
        state.status = "resolving";
        persist();
        notify("mismatch");
        mismatchTimeout = setTimeout(() => {
          a.flipped = false;
          b.flipped = false;
          state.flippedIndices = [];
          state.status = "playing";
          mismatchTimeout = null;
          persist();
          notify("resolve");
        }, MISMATCH_DELAY_MS);
      }
    } else {
      persist();
    }
  }

  // Briefly reveals one random still-unmatched pair, at the cost of one of
  // the (limited) hint uses. Does not count as a move.
  function useHint() {
    if (!state || state.status !== "playing") return;
    if (state.hintsUsed >= state.maxHints) return;

    const bySymbol = {};
    state.cards.forEach((c) => {
      if (c.matched) return;
      (bySymbol[c.symbol] = bySymbol[c.symbol] || []).push(c);
    });
    const pairs = Object.values(bySymbol).filter((group) => group.length === 2);
    if (pairs.length === 0) return;
    const [a, b] = pairs[Math.floor(Math.random() * pairs.length)];

    state.hintsUsed++;
    a.flipped = true;
    b.flipped = true;
    persist();
    notify("hint");

    hintTimeout = setTimeout(() => {
      if (!a.matched) a.flipped = false;
      if (!b.matched) b.flipped = false;
      hintTimeout = null;
      persist();
      notify("hint-end");
    }, HINT_PEEK_MS);
  }

  function checkWin() {
    if (!state.cards.every((c) => c.matched)) return;

    state.elapsedMs = getElapsedMs();
    state.status = "won";
    stopTimerInterval();
    clearTimeouts();

    const elapsedSeconds = Math.floor(state.elapsedMs / 1000);
    const isNewBest = MemoryStorage.updateCareer(state.difficulty, elapsedSeconds, state.moves);
    MemoryStorage.appendHistoryEntry({
      difficulty: state.difficulty,
      elapsedSeconds,
      moves: state.moves,
      hintsUsed: state.hintsUsed,
      completedAt: new Date().toISOString(),
    });
    MemoryStorage.clearCurrentGame();
    state.justWon = { isNewBest };
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
    hasProgress,
    flipCard,
    useHint,
    getState,
    getElapsedMs,
    formatTime,
    formatSeconds,
  };
})();

if (typeof window !== "undefined") {
  window.MemoryGame = MemoryGame;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = MemoryGame;
}
