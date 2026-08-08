// 相對音感 state controller: owns live state for both practice modes. No
// DOM/canvas/audio access here (that's ui.js's job, including
// relativePitch/js/sound.js) — same architecture as pitchTrain/js/game.js,
// which this file mirrors closely. No lives/game-over by design: this is
// continuous practice, same as pitchTrain (see PitchTrainStorage's header
// note for the reasoning).
//
// The defining difference from pitchTrain: the tonic ("do") is ALWAYS
// randomized — pickTonicMidi() takes no argument, unlike pitchTrain's
// randomKey-gated version — because that's the entire point of a
// *relative*-pitch trainer (recognize scale-degree relationships against a
// freshly-heard anchor, not memorized absolute pitch). Every question/round
// in both modes re-randomizes the tonic.
var RelativePitchGame = (function () {
  // A 13-slot "movable-do" chromatic array, one semitone per slot, index 0
  // is always "do" (the tonic) and index 12 is the octave above ("i").
  // DIATONIC_INDICES are the 8 "white key" scale degrees (1..7,i);
  // CHROMATIC_INDICES are the 5 "black key" in-between semitones, using
  // standard 簡譜 sharp notation (#1, #2, #4, #5, #6) — positioned exactly
  // where a real major scale's half-steps fall (nothing between 3-4 or
  // 7-i, matching a real piano's E-F/B-C gaps).
  const FULL_DEGREE_LABELS = ["1", "#1", "2", "#2", "3", "4", "#4", "5", "#5", "6", "#6", "7", "i"];
  const DIATONIC_INDICES = [0, 2, 4, 5, 7, 9, 11, 12];
  const CHROMATIC_INDICES = [1, 3, 6, 8, 10];
  const MILESTONE_EVERY = 5;
  const DIFFICULTY_ORDER = ["superEasy", "easy", "medium", "hard", "expert"];

  // -- 單音辨識 (single-degree recognition) tiers ------------------------------
  // diatonicPool: which scale degrees can be asked (superEasy restricts to
  // a gentle stepwise-friendly subset, same reasoning as pitchTrain's
  // SINGLE_TIERS superEasy). timbre: oscillator blend, sine -> triangle ->
  // triangle+square across the 5 tiers, same progression pitchTrain uses.
  const SINGLE_TIERS = {
    superEasy: { diatonicPool: [0, 2, 4, 7, 9], timbre: ["sine"] },
    easy: { diatonicPool: DIATONIC_INDICES, timbre: ["sine"] },
    medium: { diatonicPool: DIATONIC_INDICES, timbre: ["sine", "triangle"] },
    hard: { diatonicPool: DIATONIC_INDICES, timbre: ["triangle"] },
    expert: { diatonicPool: DIATONIC_INDICES, timbre: ["triangle", "square"] },
  };

  // -- 旋律回奏 (melody echo) tiers ---------------------------------------------
  // length/tempoMs/replayLimit same shape as pitchTrain's MELODY_TIERS;
  // diatonicPool grows narrower->wider the same way SINGLE_TIERS does.
  const MELODY_TIERS = {
    superEasy: { length: 4, diatonicPool: [0, 2, 4, 7, 9], tempoMs: 700, replayLimit: 3 },
    easy: { length: 6, diatonicPool: DIATONIC_INDICES.slice(0, 7), tempoMs: 620, replayLimit: 3 },
    medium: { length: 8, diatonicPool: DIATONIC_INDICES, tempoMs: 550, replayLimit: 2 },
    hard: { length: 12, diatonicPool: DIATONIC_INDICES, tempoMs: 480, replayLimit: 1 },
    expert: { length: 16, diatonicPool: DIATONIC_INDICES, tempoMs: 420, replayLimit: 0 },
  };

  let state = null;
  let changeListener = null;

  function onChange(cb) {
    changeListener = cb;
  }
  function notify(event, extra) {
    if (changeListener) changeListener(state, event || null, extra);
  }

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }
  function isMilestone(streak) {
    return streak > 0 && streak % MILESTONE_EVERY === 0;
  }
  // Always random (G3..G4) — no fixed-tonic option, unlike pitchTrain's
  // pickTonicMidi(randomKey). This is what makes the game "relative".
  function pickTonicMidi() {
    return 55 + Math.floor(Math.random() * 13);
  }
  // includeChromatic is a player-facing toggle orthogonal to the 5
  // difficulty tiers — when on, it unconditionally adds all 5 chromatic
  // positions on top of whichever diatonic pool the tier already defines
  // (deliberately not further tuned per-tier — see the plan's design notes).
  function effectivePool(diatonicPool, includeChromatic) {
    return includeChromatic ? diatonicPool.concat(CHROMATIC_INDICES) : diatonicPool;
  }

  function singleTierFor(difficulty) {
    return SINGLE_TIERS[difficulty] || SINGLE_TIERS.easy;
  }
  function melodyTierFor(difficulty) {
    return MELODY_TIERS[difficulty] || MELODY_TIERS.easy;
  }

  // -- 單音辨識 -----------------------------------------------------------------
  function nextSingleQuestion() {
    if (!state || state.mode !== "singleDegree") return;
    const tier = singleTierFor(state.difficulty);
    const pool = effectivePool(tier.diatonicPool, state.settings.includeChromatic);
    const index = pool[Math.floor(Math.random() * pool.length)];
    state.tonicMidi = pickTonicMidi();
    state.currentDegree = { index, midi: state.tonicMidi + index, label: FULL_DEGREE_LABELS[index] };
    state.lastResult = null;
    state.status = "question";
    notify("single-question");
  }

  function answerSingle(pickedIndex) {
    if (!state || state.mode !== "singleDegree" || state.status !== "question") return;
    const correct = pickedIndex === state.currentDegree.index;
    state.sessionAnswered += 1;
    if (correct) {
      state.sessionCorrect += 1;
      state.streak += 1;
      if (state.streak > state.bestStreakThisSession) state.bestStreakThisSession = state.streak;
    } else {
      state.streak = 0;
    }
    const milestone = correct && isMilestone(state.streak);
    state.lastResult = { correct, pickedIndex, correctIndex: state.currentDegree.index };
    state.status = "answered";
    notify("single-answer", { correct, milestone });
  }

  // -- 旋律回奏 -----------------------------------------------------------------
  function startMelodyRound() {
    if (!state || state.mode !== "melody") return;
    const tier = melodyTierFor(state.difficulty);
    const pool = effectivePool(tier.diatonicPool, state.settings.includeChromatic);
    const melody = [];
    for (let i = 0; i < tier.length; i++) {
      melody.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    state.tonicMidi = pickTonicMidi();
    state.melody = melody;
    state.playerAttempt = [];
    state.replaysUsed = 0;
    state.melodyResult = null;
    state.status = "melody-intro";
    notify("melody-round-start");
  }

  function markMelodyIntroDone() {
    if (!state || state.mode !== "melody" || state.status !== "melody-intro") return;
    state.status = "melody-input";
    notify("melody-input-ready");
  }

  function requestMelodyReplay() {
    if (!state || state.mode !== "melody") return false;
    const tier = melodyTierFor(state.difficulty);
    if (state.replaysUsed >= tier.replayLimit) return false;
    state.replaysUsed += 1;
    notify("melody-replay");
    return true;
  }

  function tapMelodyDegree(index) {
    if (!state || state.mode !== "melody" || state.status !== "melody-input") return;
    if (state.playerAttempt.length >= state.melody.length) return;
    state.playerAttempt.push(index);
    notify("melody-tap");
    if (state.playerAttempt.length >= state.melody.length) submitMelodyAttempt();
  }

  function undoMelodyTap() {
    if (!state || state.mode !== "melody" || state.status !== "melody-input") return;
    if (state.playerAttempt.length === 0) return;
    state.playerAttempt.pop();
    notify("melody-tap");
  }

  function submitMelodyAttempt() {
    if (!state || state.mode !== "melody" || state.status !== "melody-input") return;
    const total = state.melody.length;
    const perNote = state.melody.map((degree, i) => state.playerAttempt[i] === degree);
    const matched = perNote.filter(Boolean).length;
    const fullyCorrect = state.playerAttempt.length === total && matched === total;

    state.sessionAnswered += total;
    state.sessionCorrect += matched;
    if (fullyCorrect) {
      state.streak += 1;
      if (state.streak > state.bestStreakThisSession) state.bestStreakThisSession = state.streak;
    } else {
      state.streak = 0;
    }
    const milestone = fullyCorrect && isMilestone(state.streak);
    state.melodyResult = { perNote, matched, total, fullyCorrect };
    state.status = "melody-result";
    notify("melody-result", { fullyCorrect, milestone });
  }

  // -- session lifecycle --------------------------------------------------
  function startSession(mode, difficulty) {
    state = {
      mode,
      difficulty,
      settings: {
        inputMode: RelativePitchStorage.getSettings().inputMode,
        includeChromatic: RelativePitchStorage.getSettings().includeChromatic,
      },
      status: null,
      streak: 0,
      bestStreakThisSession: 0,
      sessionAnswered: 0,
      sessionCorrect: 0,
      currentDegree: null,
      lastResult: null,
      melody: [],
      tonicMidi: 60,
      playerAttempt: [],
      replaysUsed: 0,
      melodyResult: null,
    };
    if (mode === "singleDegree") nextSingleQuestion();
    else startMelodyRound();
    notify("session-start");
  }

  function hasProgress() {
    return !!state && state.sessionAnswered > 0;
  }

  function endSession() {
    if (!state) return null;
    const answered = state.sessionAnswered;
    const correct = state.sessionCorrect;
    const streak = state.bestStreakThisSession;
    let result = { isNewBestStreak: false, isNewBestAccuracy: false };
    if (answered > 0) {
      result = RelativePitchStorage.recordSession(state.mode, state.difficulty, { answered, correct, streak });
      RelativePitchStorage.appendHistoryEntry({
        mode: state.mode,
        difficulty: state.difficulty,
        streak,
        answered,
        correct,
        accuracy: correct / answered,
        completedAt: new Date().toISOString(),
      });
    }
    const summary = {
      mode: state.mode,
      difficulty: state.difficulty,
      answered,
      correct,
      streak,
      accuracy: answered > 0 ? correct / answered : null,
      isNewBestStreak: result.isNewBestStreak,
      isNewBestAccuracy: result.isNewBestAccuracy,
    };
    state = null;
    return summary;
  }

  function getState() {
    return state;
  }

  return {
    onChange,
    startSession,
    hasProgress,
    endSession,
    getState,
    // singleDegree
    nextSingleQuestion,
    answerSingle,
    // melody
    startMelodyRound,
    markMelodyIntroDone,
    requestMelodyReplay,
    tapMelodyDegree,
    undoMelodyTap,
    submitMelodyAttempt,
    // shared helpers/constants for ui.js
    FULL_DEGREE_LABELS,
    DIATONIC_INDICES,
    CHROMATIC_INDICES,
    DIFFICULTY_ORDER,
    MILESTONE_EVERY,
    SINGLE_TIERS,
    MELODY_TIERS,
    midiToFreq,
    isMilestone,
    singleTierFor,
    melodyTierFor,
    effectivePool,
  };
})();

if (typeof window !== "undefined") {
  window.RelativePitchGame = RelativePitchGame;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = RelativePitchGame;
}
