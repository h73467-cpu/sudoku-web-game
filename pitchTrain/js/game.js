// 絕對音感 state controller: owns live state for both practice modes. No
// DOM/canvas/audio access here (that's ui.js's job, including
// pitchTrain/js/sound.js) — same architecture as every other game in this
// hub. No lives/game-over by design (explicit user requirement): this is
// continuous practice, so the only "session boundary" is the player
// choosing to leave (endSession persists the session's stats to career +
// history, same "persist at a natural checkpoint" spirit as
// ShellGame.finishRun, just triggered by leaving instead of losing).
//
// Two modes share one streak/accuracy bookkeeping shape (see the
// PitchTrainStorage header note) but are otherwise independent state
// machines living side by side in `state`; only one is active per session
// (`state.mode`).
var PitchTrainGame = (function () {
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const WHITE_KEY_CLASSES = [0, 2, 4, 5, 7, 9, 11];
  const DEGREE_LABELS = ["1", "2", "3", "4", "5", "6", "7", "i"];
  // Major-scale semitone offsets from the tonic for each 簡譜 degree above,
  // 1:1 index-matched (index 7 / label "i" is the octave above 1).
  const DEGREE_SEMITONES = [0, 2, 4, 5, 7, 9, 11, 12];
  const MILESTONE_EVERY = 5;

  // -- 聽音辨識 (single note) tiers -------------------------------------------
  // notePool: which pitch classes can be asked. octaveMin/Max: musical
  // octave numbers (4 = the octave containing middle C). referenceTone:
  // whether an A4 anchor plays before the question. timbre: oscillator
  // type(s) blended together — sine -> triangle -> triangle+square mix
  // across the 5 tiers, per the original design (a richer/harsher
  // waveform's overtones make pitch-class identification genuinely
  // harder, not just "feel" harder).
  const SINGLE_TIERS = {
    superEasy: { notePool: "white", octaveMin: 4, octaveMax: 4, referenceTone: true, timbre: ["sine"] },
    easy: { notePool: "white", octaveMin: 3, octaveMax: 5, referenceTone: true, timbre: ["sine"] },
    medium: { notePool: "chromatic", octaveMin: 3, octaveMax: 5, referenceTone: true, timbre: ["sine", "triangle"] },
    hard: { notePool: "chromatic", octaveMin: 2, octaveMax: 6, referenceTone: false, timbre: ["triangle"] },
    expert: { notePool: "chromatic", octaveMin: 2, octaveMax: 6, referenceTone: false, timbre: ["triangle", "square"] },
  };

  // -- 旋律回奏 (melody echo) tiers --------------------------------------------
  // length: notes per melody. tempoMs: ms between note onsets when played.
  // replayLimit: how many extra replays are allowed per melody (0 = hear
  // it once only).
  const MELODY_TIERS = {
    superEasy: { length: 4, tempoMs: 750, replayLimit: 3 },
    easy: { length: 5, tempoMs: 650, replayLimit: 3 },
    medium: { length: 6, tempoMs: 550, replayLimit: 2 },
    hard: { length: 8, tempoMs: 450, replayLimit: 1 },
    expert: { length: 10, tempoMs: 380, replayLimit: 0 },
  };

  const DIFFICULTY_ORDER = ["superEasy", "easy", "medium", "hard", "expert"];

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
  function midiToLabel(midi) {
    const pitchClass = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    return { name: NOTE_NAMES[pitchClass], octave, pitchClass };
  }
  function isMilestone(streak) {
    return streak > 0 && streak % MILESTONE_EVERY === 0;
  }

  function singleTierFor(difficulty) {
    return SINGLE_TIERS[difficulty] || SINGLE_TIERS.easy;
  }
  function melodyTierFor(difficulty) {
    return MELODY_TIERS[difficulty] || MELODY_TIERS.easy;
  }

  // -- 聽音辨識 (single note) --------------------------------------------------
  function pickSingleNote(tier, avoidMidi) {
    const pool = tier.notePool === "white" ? WHITE_KEY_CLASSES : NOTE_NAMES.map((_, i) => i);
    let midi;
    let guard = 0;
    do {
      const pitchClass = pool[Math.floor(Math.random() * pool.length)];
      const octave = tier.octaveMin + Math.floor(Math.random() * (tier.octaveMax - tier.octaveMin + 1));
      midi = (octave + 1) * 12 + pitchClass;
      guard++;
    } while (midi === avoidMidi && guard < 8);
    return midi;
  }

  function nextSingleQuestion() {
    if (!state || state.mode !== "singleNote") return;
    const tier = singleTierFor(state.difficulty);
    const midi = pickSingleNote(tier, state.currentNote ? state.currentNote.midi : null);
    state.currentNote = { midi, freq: midiToFreq(midi), label: midiToLabel(midi) };
    state.lastResult = null;
    state.status = "question";
    notify("single-question");
  }

  function answerSingle(pitchClass) {
    if (!state || state.mode !== "singleNote" || state.status !== "question") return;
    const correct = pitchClass === state.currentNote.label.pitchClass;
    state.sessionAnswered += 1;
    if (correct) {
      state.sessionCorrect += 1;
      state.streak += 1;
      if (state.streak > state.bestStreakThisSession) state.bestStreakThisSession = state.streak;
    } else {
      state.streak = 0;
    }
    const milestone = correct && isMilestone(state.streak);
    state.lastResult = { correct, pickedPitchClass: pitchClass, correctPitchClass: state.currentNote.label.pitchClass };
    state.status = "answered";
    notify("single-answer", { correct, milestone });
  }

  // -- 旋律回奏 (melody echo) --------------------------------------------------
  // Fixed-C practice always anchors on C4 (MIDI 60). Random-key practice
  // still announces the tonic first (played by ui.js before the melody) —
  // it's relative-pitch-by-ear against a just-heard anchor, not absolute
  // recall of an unannounced key, which is what makes it a genuinely
  // *relative*-pitch challenge rather than an unfair guessing game.
  function pickTonicMidi(randomKey) {
    if (!randomKey) return 60;
    return 55 + Math.floor(Math.random() * 13); // G3..G4, a comfortable synth range
  }

  function startMelodyRound() {
    if (!state || state.mode !== "melody") return;
    const tier = melodyTierFor(state.difficulty);
    const melody = [];
    for (let i = 0; i < tier.length; i++) {
      melody.push(Math.floor(Math.random() * DEGREE_LABELS.length));
    }
    state.tonicMidi = pickTonicMidi(state.settings.melodyRandomKey);
    state.melody = melody;
    state.playerAttempt = [];
    state.replaysUsed = 0;
    state.melodyResult = null;
    state.status = "melody-intro";
    notify("melody-round-start");
  }

  // Called by ui.js once the intro (tonic + melody) playback has actually
  // finished, so input isn't accepted mid-playback.
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

  function tapMelodyDegree(degreeIndex) {
    if (!state || state.mode !== "melody" || state.status !== "melody-input") return;
    if (degreeIndex < 0 || degreeIndex >= DEGREE_LABELS.length) return;
    if (state.playerAttempt.length >= state.melody.length) return;
    state.playerAttempt.push(degreeIndex);
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
      settings: { melodyRandomKey: PitchTrainStorage.getSettings().melodyRandomKey },
      status: null,
      streak: 0,
      bestStreakThisSession: 0,
      sessionAnswered: 0,
      sessionCorrect: 0,
      currentNote: null,
      lastResult: null,
      melody: [],
      tonicMidi: 60,
      playerAttempt: [],
      replaysUsed: 0,
      melodyResult: null,
    };
    if (mode === "singleNote") nextSingleQuestion();
    else startMelodyRound();
    notify("session-start");
  }

  function hasProgress() {
    return !!state && state.sessionAnswered > 0;
  }

  // Persists this session's stats (if any answers were given) to career +
  // history, then clears live state. Returns the session summary (or null
  // if nothing was answered) so ui.js can show a recap.
  function endSession() {
    if (!state) return null;
    const answered = state.sessionAnswered;
    const correct = state.sessionCorrect;
    const streak = state.bestStreakThisSession;
    let result = { isNewBestStreak: false, isNewBestAccuracy: false };
    if (answered > 0) {
      result = PitchTrainStorage.recordSession(state.mode, state.difficulty, { answered, correct, streak });
      PitchTrainStorage.appendHistoryEntry({
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
    // singleNote
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
    NOTE_NAMES,
    WHITE_KEY_CLASSES,
    DEGREE_LABELS,
    DEGREE_SEMITONES,
    DIFFICULTY_ORDER,
    MILESTONE_EVERY,
    SINGLE_TIERS,
    MELODY_TIERS,
    midiToFreq,
    midiToLabel,
    isMilestone,
    singleTierFor,
    melodyTierFor,
  };
})();

if (typeof window !== "undefined") {
  window.PitchTrainGame = PitchTrainGame;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = PitchTrainGame;
}
