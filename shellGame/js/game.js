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
  const RESULT_MS = 1400;
  const MILESTONE_RESULT_MS = 2200;
  const MILESTONE_EVERY = 5;
  const MIN_SWAP_DURATION_MS = 150;
  const MAX_SWAP_DURATION_MS = 620;
  const MAX_SWAP_COUNT = 14;

  let state = null;
  let changeListener = null;

  function onChange(cb) {
    changeListener = cb;
  }
  function notify(event) {
    if (changeListener) changeListener(state, event || null);
  }

  // Difficulty here isn't a player choice — it's purely a function of how
  // many levels have been cleared this run, exactly as requested: slow and
  // simple at level 1, gradually more swaps and less time per swap as the
  // player keeps winning. Both curves flatten out (via clamping) rather
  // than growing unbounded, so very long runs stay hard but still fair.
  function swapCountForLevel(level) {
    return Math.min(MAX_SWAP_COUNT, 3 + Math.floor((level - 1) / 2));
  }
  function swapDurationForLevel(level) {
    return Math.max(MIN_SWAP_DURATION_MS, MAX_SWAP_DURATION_MS - (level - 1) * 22);
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
    state.swapDurationMs = swapDurationForLevel(state.level);
    state.status = "reveal";
    state.guessedCup = null;
    state.clearedLevel = null;
    notify("round-start");
  }

  function newGame() {
    state = {
      level: 1,
      lives: LIVES_START,
      streak: 0,
      bestStreak: 0,
      justFinished: null,
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
    TREASURES,
    LIVES_START,
    REVEAL_MS,
    RESULT_MS,
    MILESTONE_RESULT_MS,
    MILESTONE_EVERY,
  };
})();

if (typeof window !== "undefined") {
  window.ShellGame = ShellGame;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = ShellGame;
}
