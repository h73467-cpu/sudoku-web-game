// 1A2B (Bulls and Cows) state controller: owns live state, timer, hints,
// notes, win detection, persistence. No DOM access here (that's ui.js's
// job). Mirrors the shape of sudoku/js/game.js and memory/js/game.js.
var GuessGame = (function () {
  const TIERS = {
    easy: { codeLength: 3, poolSize: 10 },
    medium: { codeLength: 4, poolSize: 10 },
    hard: { codeLength: 5, poolSize: 10 },
    expert: { codeLength: 6, poolSize: 10 },
  };
  // A pool that's too close to codeLength makes every digit "in the code",
  // which collapses the A/B distinction into a trivial ordering puzzle.
  const MIN_SUPER_EASY_POOL = TIERS.easy.codeLength + 2;
  const DEFAULT_MAX_HINTS = 3;
  const NOTE_STATES = ["neutral", "excluded", "confirmed"];

  let state = null;
  let timerInterval = null;
  let changeListener = null;

  function onChange(cb) {
    changeListener = cb;
  }

  function notify(event) {
    if (changeListener) changeListener(state, event || null);
  }

  function superEasyPoolSize(percent) {
    const x = Math.max(10, Math.min(90, Math.round(Number(percent) || 30)));
    return Math.max(MIN_SUPER_EASY_POOL, Math.round(TIERS.easy.poolSize * (1 - x / 100)));
  }

  function tierFor(difficulty) {
    if (difficulty === "superEasy") {
      return {
        codeLength: TIERS.easy.codeLength,
        poolSize: superEasyPoolSize(GuessStorage.getSettings().superEasyPercent),
      };
    }
    return TIERS[difficulty] || TIERS.easy;
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

  function buildSecret(codeLength, poolSize) {
    const digits = shuffle(Array.from({ length: poolSize }, (_, i) => i));
    return digits.slice(0, codeLength);
  }

  function defaultNotes(poolSize) {
    const notes = {};
    for (let d = 0; d < poolSize; d++) notes[d] = "neutral";
    return notes;
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
      secret: state.secret,
      codeLength: state.codeLength,
      poolSize: state.poolSize,
      difficulty: state.difficulty,
      currentGuess: state.currentGuess,
      history: state.history,
      notes: state.notes,
      hintsUsed: state.hintsUsed,
      maxHints: state.maxHints,
      revealedHints: state.revealedHints,
      elapsedMs: getElapsedMs(),
      status: state.status === "won" ? "won" : "playing",
    };
  }

  function deserialize(saved) {
    return {
      secret: saved.secret,
      codeLength: saved.codeLength,
      poolSize: saved.poolSize,
      difficulty: saved.difficulty,
      currentGuess: Array.isArray(saved.currentGuess) ? saved.currentGuess : [],
      history: Array.isArray(saved.history) ? saved.history : [],
      notes: saved.notes && typeof saved.notes === "object" ? saved.notes : defaultNotes(saved.poolSize),
      hintsUsed: saved.hintsUsed || 0,
      maxHints: saved.maxHints || DEFAULT_MAX_HINTS,
      revealedHints: Array.isArray(saved.revealedHints) ? saved.revealedHints : [],
      elapsedMs: saved.elapsedMs || 0,
      startTimestamp: Date.now(),
      status: saved.status === "won" ? "won" : "playing",
    };
  }

  function persist() {
    if (state && state.status !== "won") {
      GuessStorage.saveCurrentGame(serialize());
    }
  }

  function newGame(difficulty) {
    stopTimerInterval();
    const tier = tierFor(difficulty);
    state = {
      secret: buildSecret(tier.codeLength, tier.poolSize),
      codeLength: tier.codeLength,
      poolSize: tier.poolSize,
      difficulty,
      currentGuess: [],
      history: [],
      notes: defaultNotes(tier.poolSize),
      hintsUsed: 0,
      maxHints: DEFAULT_MAX_HINTS,
      revealedHints: [],
      elapsedMs: 0,
      startTimestamp: Date.now(),
      status: "playing",
    };
    startTimer();
    persist();
    notify("new-game");
  }

  function resumeGame() {
    const saved = GuessStorage.loadCurrentGame();
    if (!saved || !Array.isArray(saved.secret)) return false;
    if (saved.status !== "playing") return false;
    stopTimerInterval();
    state = deserialize(saved);
    if (state.status === "playing") startTimer();
    notify("restore");
    return true;
  }

  function hasSavedResumableGame() {
    const saved = GuessStorage.loadCurrentGame();
    return !!(saved && saved.status === "playing");
  }

  function hasProgress() {
    if (!state) return false;
    if (state.status !== "playing") return false;
    return state.history.length > 0 || state.currentGuess.length > 0;
  }

  function appendDigit(digit) {
    if (!state || state.status !== "playing") return;
    if (state.currentGuess.length >= state.codeLength) return;
    if (state.currentGuess.includes(digit)) return;
    state.currentGuess.push(digit);
    persist();
    notify("guess-edit");
  }

  function removeLastDigit() {
    if (!state || state.status !== "playing") return;
    if (state.currentGuess.length === 0) return;
    state.currentGuess.pop();
    persist();
    notify("guess-edit");
  }

  function clearGuess() {
    if (!state || state.status !== "playing") return;
    if (state.currentGuess.length === 0) return;
    state.currentGuess = [];
    persist();
    notify("guess-edit");
  }

  // A = right digit, right position. B = right digit, wrong position.
  function evaluateGuess(guess, secret) {
    let a = 0;
    guess.forEach((d, i) => {
      if (secret[i] === d) a++;
    });
    const matches = guess.filter((d) => secret.includes(d)).length;
    return { a, b: matches - a };
  }

  function finishWin() {
    state.elapsedMs = getElapsedMs();
    state.status = "won";
    stopTimerInterval();

    const elapsedSeconds = Math.floor(state.elapsedMs / 1000);
    const attempts = state.history.length;
    const isNewBest = GuessStorage.updateCareer(state.difficulty, elapsedSeconds, attempts);
    GuessStorage.appendHistoryEntry({
      difficulty: state.difficulty,
      elapsedSeconds,
      attempts,
      hintsUsed: state.hintsUsed,
      completedAt: new Date().toISOString(),
    });
    GuessStorage.clearCurrentGame();
    state.justWon = { isNewBest };
  }

  function submitGuess() {
    if (!state || state.status !== "playing") return;
    if (state.currentGuess.length !== state.codeLength) return;
    const { a, b } = evaluateGuess(state.currentGuess, state.secret);
    state.history.unshift({ guess: state.currentGuess.slice(), a, b });
    state.currentGuess = [];
    if (a === state.codeLength) {
      finishWin();
    } else {
      persist();
    }
    notify("submit");
  }

  // Freeform scratchpad, not validated by the game — same spirit as
  // sudoku's notes mode. Cycles neutral -> excluded -> confirmed -> neutral.
  function toggleNote(digit) {
    if (!state) return;
    const cur = state.notes[digit] || "neutral";
    state.notes[digit] = NOTE_STATES[(NOTE_STATES.indexOf(cur) + 1) % NOTE_STATES.length];
    persist();
    notify("note");
  }

  // Reveals one still-unrevealed secret position, at the cost of one of the
  // (limited) hint uses. Does not count as a guess attempt.
  function useHint() {
    if (!state || state.status !== "playing") return;
    if (state.hintsUsed >= state.maxHints) return;

    const revealedPositions = state.revealedHints.map((h) => h.position);
    const candidates = state.secret
      .map((digit, position) => ({ digit, position }))
      .filter((h) => !revealedPositions.includes(h.position));
    if (candidates.length === 0) return;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];

    state.hintsUsed++;
    state.revealedHints.push(pick);
    persist();
    notify("hint");
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
    appendDigit,
    removeLastDigit,
    clearGuess,
    submitGuess,
    toggleNote,
    useHint,
    getState,
    getElapsedMs,
    formatTime,
    formatSeconds,
  };
})();

if (typeof window !== "undefined") {
  window.GuessGame = GuessGame;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = GuessGame;
}
