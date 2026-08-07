// 三個杯子 (Shell Game) state controller: owns the round/session state
// machine. No DOM access here (that's ui.js's job) and no difficulty
// tiers by design — the user explicitly asked for a single endless run
// that starts slow and speeds up on its own as levels clear, rather than
// a difficulty picker like every other game in this hub.
//
// Flow per round: "reveal" (ball shown under one cup) -> "shuffling"
// (ui.js drives stepSwap() on a timer using swapDurationMs) -> "guessing"
// (player taps a cup) -> "correct"/"wrong" (ui.js plays the reveal
// animation, then calls proceedAfterResult()) -> next round, or
// "gameover" once lives run out.
var ShellGame = (function () {
  const TREASURES = ["💎", "🌟", "👑", "🍀", "🔔", "🎁", "🪙", "🍭"];
  const LIVES_START = 3;
  const REVEAL_MS = 1100;
  const RESULT_MS = 2000;
  const MILESTONE_RESULT_MS = 2600;
  const MILESTONE_EVERY = 5;
  const MIN_SWAP_DURATION_MS = 150;
  const MAX_SWAP_COUNT = 14;
  // The starting speed is now a player-adjustable slider (home screen),
  // not a fixed constant — but every level after 1 still ramps up from
  // whatever start speed was picked, at a fixed ~10%-per-level rate.
  const DEFAULT_START_DURATION_MS = 650;
  const MIN_START_DURATION_MS = 350;
  const MAX_START_DURATION_MS = 900;
  const LEVEL_SPEEDUP_FACTOR = 0.9;

  let state = null;
  let changeListener = null;

  function onChange(cb) {
    changeListener = cb;
  }
  function notify(event) {
    if (changeListener) changeListener(state, event || null);
  }

  function clampStartDuration(x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return DEFAULT_START_DURATION_MS;
    return Math.max(MIN_START_DURATION_MS, Math.min(MAX_START_DURATION_MS, n));
  }

  // Swap count still grows with level (more cups moving around feels
  // harder independent of speed) — unaffected by the start-speed slider.
  function swapCountForLevel(level) {
    return Math.min(MAX_SWAP_COUNT, 3 + Math.floor((level - 1) / 2));
  }
  // Multiplicative ~10%-per-level ramp from whichever starting speed the
  // player picked, rather than a fixed additive slope from a fixed
  // constant — so "how slow level 1 is" and "how fast it gets" are both
  // driven by the same one knob, compounding level over level.
  function swapDurationForLevel(level, startDurationMs) {
    const start = clampStartDuration(startDurationMs);
    return Math.max(MIN_SWAP_DURATION_MS, start * Math.pow(LEVEL_SPEEDUP_FACTOR, level - 1));
  }

  // Picks b uniformly from {0,1,2} \ {a} without a rejection loop.
  function otherCup(a) {
    let b = Math.floor(Math.random() * 2);
    if (b >= a) b++;
    return b;
  }

  // A pair is fully identified by which cup it *excludes* (the one that
  // doesn't move) — e.g. excluding cup 0 means the pair is [1, 2]. Tracking
  // the excluded cup instead of the pair itself makes it cheap to guarantee
  // consecutive swaps never repeat the same pair: with only 3 cups,
  // independent random picks land on the same pair twice in a row often
  // enough to make a shuffle look boring (the same two cups swapping back
  // and forth while the third never moves), so this guards for visual
  // variety rather than leaving it to chance.
  function pairExcluding(excluded) {
    return [0, 1, 2].filter((c) => c !== excluded);
  }

  function generateSwaps(level) {
    const count = swapCountForLevel(level);
    const swaps = [];
    let prevExcluded = null;
    for (let i = 0; i < count; i++) {
      let excluded = Math.floor(Math.random() * 3);
      if (prevExcluded !== null && excluded === prevExcluded) {
        excluded = otherCup(excluded);
      }
      swaps.push(pairExcluding(excluded));
      prevExcluded = excluded;
    }
    return swaps;
  }

  function startRound() {
    state.ballCup = Math.floor(Math.random() * 3);
    state.cupSlot = [0, 1, 2];
    state.treasureEmoji = TREASURES[Math.floor(Math.random() * TREASURES.length)];
    state.swaps = generateSwaps(state.level);
    state.swapIndex = 0;
    state.swapDurationMs = swapDurationForLevel(state.level, state.startDurationMs);
    state.status = "reveal";
    state.guessedCup = null;
    state.clearedLevel = null;
    notify("round-start");
  }

  function newGame(startDurationMs) {
    state = {
      level: 1,
      lives: LIVES_START,
      streak: 0,
      bestStreak: 0,
      justFinished: null,
      startDurationMs: clampStartDuration(startDurationMs),
    };
    startRound();
  }

  function beginShuffle() {
    if (!state || state.status !== "reveal") return;
    state.status = "shuffling";
    notify("shuffle-start");
  }

  // Applies exactly one swap from the pre-generated sequence and reports
  // which two cup identities were involved so ui.js can animate just those
  // two elements. Returns null if called outside the shuffling phase or
  // after the sequence is already exhausted.
  function stepSwap() {
    if (!state || state.status !== "shuffling") return null;
    if (state.swapIndex >= state.swaps.length) return null;
    const [a, b] = state.swaps[state.swapIndex];
    const sa = state.cupSlot[a];
    const sb = state.cupSlot[b];
    state.cupSlot[a] = sb;
    state.cupSlot[b] = sa;
    state.swapIndex++;
    const done = state.swapIndex >= state.swaps.length;
    if (done) state.status = "guessing";
    notify("swap");
    return { cupA: a, cupB: b, done };
  }

  function finishRun() {
    const result = ShellGameStorage.recordRun(state.level, state.bestStreak);
    ShellGameStorage.appendHistoryEntry({
      levelReached: state.level,
      bestStreak: state.bestStreak,
      completedAt: new Date().toISOString(),
    });
    state.justFinished = Object.assign(
      { levelReached: state.level, bestStreak: state.bestStreak },
      result
    );
    state.status = "gameover";
  }

  // cupId is the cup's fixed identity (0-2), not its current visual slot —
  // ui.js reads this straight off the clicked element's data-cup attribute,
  // so no slot-to-identity lookup is needed here.
  function guess(cupId) {
    if (!state || state.status !== "guessing") return;
    const correct = cupId === state.ballCup;
    state.guessedCup = cupId;
    if (correct) {
      state.streak++;
      if (state.streak > state.bestStreak) state.bestStreak = state.streak;
      state.clearedLevel = state.level;
      state.level++;
      state.status = "correct";
      notify("correct");
    } else {
      state.streak = 0;
      state.lives--;
      state.status = "wrong";
      if (state.lives <= 0) {
        finishRun();
        notify("gameover");
      } else {
        notify("wrong");
      }
    }
  }

  // Called by ui.js once it has finished showing the result reveal
  // animation for a "correct" or "wrong" (but not yet game-over) round.
  function proceedAfterResult() {
    if (!state || state.status === "gameover") return;
    if (state.status === "correct" || state.status === "wrong") startRound();
  }

  function getState() {
    return state;
  }
  function isMilestone(level) {
    return level > 0 && level % MILESTONE_EVERY === 0;
  }

  return {
    onChange,
    newGame,
    beginShuffle,
    stepSwap,
    guess,
    proceedAfterResult,
    getState,
    isMilestone,
    swapCountForLevel,
    swapDurationForLevel,
    clampStartDuration,
    TREASURES,
    LIVES_START,
    REVEAL_MS,
    RESULT_MS,
    MILESTONE_RESULT_MS,
    MILESTONE_EVERY,
    DEFAULT_START_DURATION_MS,
    MIN_START_DURATION_MS,
    MAX_START_DURATION_MS,
  };
})();

if (typeof window !== "undefined") {
  window.ShellGame = ShellGame;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = ShellGame;
}
