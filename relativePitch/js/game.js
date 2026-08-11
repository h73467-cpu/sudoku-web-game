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

  // -- 音域設定：練習用的主音 MIDI 範圍 -----------------------------------------
  // "mid" is exactly today's old hardcoded 55+rand(13) (G3..G4 inclusive) —
  // players who never touch this setting see zero behavior change.
  const OCTAVE_RANGES = {
    low: { min: 48, max: 60 }, // C3..C4
    mid: { min: 55, max: 67 }, // G3..G4
    high: { min: 60, max: 72 }, // C4..C5
  };
  // Highest MIDI note any generated tone (melody note or chord voice) may
  // land on before we drop the whole thing an octave — keeps "high" range
  // + a wide chord voicing or the melody's +12 octave leap from turning
  // into a shrill oscillator screech.
  const AUDIBLE_CEILING_MIDI = 84;

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
  // length/tempoMs same shape as pitchTrain's MELODY_TIERS. Note CONTENT is
  // no longer a free random pool — see buildMelodyFromProgression below,
  // which walks a real chord progression (reusing CHORD_TIERS via
  // chordTierFor for gating which progressions/qualities are reachable at
  // each difficulty) and arpeggiates it into the melody. Replay is
  // unlimited at every tier (see requestMelodyReplay) — difficulty comes
  // from length/tempo/progression complexity, not from rationing replays.
  const MELODY_TIERS = {
    superEasy: { length: 4, tempoMs: 700 },
    easy: { length: 6, tempoMs: 620 },
    medium: { length: 8, tempoMs: 550 },
    hard: { length: 12, tempoMs: 480 },
    expert: { length: 16, tempoMs: 420 },
  };

  // -- 和弦練習 (chord) theory data ---------------------------------------------
  // intervals are semitone offsets from the chord's own root (not the
  // practice tonic) — same "index = semitone" convention as
  // FULL_DEGREE_LABELS, so chord tones reuse midiToFreq directly.
  const CHORD_QUALITIES = {
    major: { label: "大三和弦", intervals: [0, 4, 7] },
    minor: { label: "小三和弦", intervals: [0, 3, 7] },
    diminished: { label: "減三和弦", intervals: [0, 3, 6] },
    dominant7: { label: "屬七和弦", intervals: [0, 4, 7, 10] },
    major7: { label: "大七和弦", intervals: [0, 4, 7, 11] },
    minor7: { label: "小七和弦", intervals: [0, 3, 7, 10] },
  };
  // Major-key diatonic harmony (I ii iii IV V vi vii°), keyed by the same
  // semitone-offset-from-tonic convention DIATONIC_INDICES uses.
  const DIATONIC_CHORD_MAP = {
    0: { roman: "I", quality: "major" },
    2: { roman: "ii", quality: "minor" },
    4: { roman: "iii", quality: "minor" },
    5: { roman: "IV", quality: "major" },
    7: { roman: "V", quality: "major" },
    9: { roman: "vi", quality: "minor" },
    11: { roman: "vii°", quality: "diminished" },
  };
  const CHORD_TIERS = {
    superEasy: { progressionPool: [0, 5, 7], qualityPool: ["major", "minor"], timbre: ["sine"] },
    easy: { progressionPool: [0, 5, 7, 9], qualityPool: ["major", "minor"], timbre: ["sine"] },
    medium: {
      progressionPool: [0, 2, 4, 5, 7, 9],
      qualityPool: ["major", "minor", "diminished"],
      timbre: ["sine", "triangle"],
    },
    hard: {
      progressionPool: [0, 2, 4, 5, 7, 9, 11],
      qualityPool: ["major", "minor", "diminished", "dominant7"],
      timbre: ["triangle"],
    },
    expert: {
      progressionPool: [0, 2, 4, 5, 7, 9, 11],
      qualityPool: ["major", "minor", "diminished", "dominant7", "major7", "minor7"],
      timbre: ["triangle", "square"],
    },
  };

  // -- 和弦級數聽辨：知名和弦走向，出題時優先參考這些「主音」而非完全隨機亂選 ---
  // Each chord is { root: <semitone offset from tonic, matches
  // DIATONIC_CHORD_MAP keys>, quality: <CHORD_QUALITIES key> }. quality is
  // spelled out explicitly per chord (not derived from DIATONIC_CHORD_MAP)
  // because some progressions deliberately deviate from plain diatonic
  // triads (blues' dominant7 throughout, jazz ii-V-I's V7/Imaj7) — the
  // *roman numeral* shown to the player still comes from
  // DIATONIC_CHORD_MAP[root].roman regardless, since that's about scale
  // position, not chord color.
  const PROGRESSION_TEMPLATES = [
    {
      name: "J-Pop 王道進行",
      chords: [
        { root: 5, quality: "major" }, // IV
        { root: 7, quality: "major" }, // V
        { root: 4, quality: "minor" }, // iii
        { root: 9, quality: "minor" }, // vi
      ],
    },
    {
      name: "卡農進行",
      chords: [
        { root: 0, quality: "major" }, // I
        { root: 7, quality: "major" }, // V
        { root: 9, quality: "minor" }, // vi
        { root: 4, quality: "minor" }, // iii
        { root: 5, quality: "major" }, // IV
        { root: 0, quality: "major" }, // I
        { root: 5, quality: "major" }, // IV
        { root: 7, quality: "major" }, // V
      ],
    },
    {
      name: "2-5-3-6 收束變體",
      chords: [
        { root: 2, quality: "minor" }, // ii
        { root: 7, quality: "major" }, // V
        { root: 4, quality: "minor" }, // iii
        { root: 9, quality: "minor" }, // vi
      ],
    },
    {
      name: "4-5-1 完結變體",
      chords: [
        { root: 5, quality: "major" }, // IV
        { root: 7, quality: "major" }, // V
        { root: 0, quality: "major" }, // I
      ],
    },
    {
      name: "黃金四和弦",
      chords: [
        { root: 0, quality: "major" }, // I
        { root: 7, quality: "major" }, // V
        { root: 9, quality: "minor" }, // vi
        { root: 5, quality: "major" }, // IV
      ],
    },
    {
      name: "暗黑抒情進行",
      chords: [
        { root: 9, quality: "minor" }, // vi
        { root: 5, quality: "major" }, // IV
        { root: 0, quality: "major" }, // I
        { root: 7, quality: "major" }, // V
      ],
    },
    {
      name: "Doo-Wop 進行",
      chords: [
        { root: 0, quality: "major" }, // I
        { root: 9, quality: "minor" }, // vi
        { root: 5, quality: "major" }, // IV
        { root: 7, quality: "major" }, // V
      ],
    },
    {
      name: "2-5-1 爵士進行",
      chords: [
        { root: 2, quality: "minor" }, // ii
        { root: 7, quality: "dominant7" }, // V7
        { root: 0, quality: "major7" }, // Imaj7
      ],
    },
    {
      name: "五度圈下行",
      chords: [
        { root: 4, quality: "minor" }, // iii
        { root: 9, quality: "minor" }, // vi
        { root: 2, quality: "minor" }, // ii
        { root: 7, quality: "dominant7" }, // V7
        { root: 0, quality: "major" }, // I
      ],
    },
    {
      name: "12 小節藍調",
      chords: [
        { root: 0, quality: "dominant7" },
        { root: 0, quality: "dominant7" },
        { root: 0, quality: "dominant7" },
        { root: 0, quality: "dominant7" },
        { root: 5, quality: "dominant7" },
        { root: 5, quality: "dominant7" },
        { root: 0, quality: "dominant7" },
        { root: 0, quality: "dominant7" },
        { root: 7, quality: "dominant7" },
        { root: 5, quality: "dominant7" },
        { root: 0, quality: "dominant7" },
        { root: 7, quality: "dominant7" },
      ],
    },
    {
      name: "1-4-5 三和弦搖滾",
      chords: [
        { root: 0, quality: "major" },
        { root: 5, quality: "major" },
        { root: 7, quality: "major" },
      ],
    },
  ];

  // -- 經典歌曲提示：答錯單音辨識題目時，可播放對應音級的經典歌曲片段輔助 -------
  // noteSequence is expressed in the SONG'S OWN scale degrees (its own
  // tonic = degree 0, matching FULL_DEGREE_LABELS' semitone-offset
  // convention but allowed to exceed 12 for notes above the song's own
  // octave) so ui.js can transpose it onto whatever tonic the current
  // practice question randomized to. targetIndex marks which noteSequence
  // entry demonstrates the taught degree.
  //
  // Coverage note: only the 6 diatonic degrees (2,3,4,5,6,7) have an entry
  // here — see the plan's feasibility assessment for why the 5 chromatic
  // degrees (#1 #2 #4 #5 #6) don't have a solid public-domain "classic
  // song" candidate yet (they're exactly the tones a plain major-scale
  // song excludes). The hint button simply doesn't appear for degrees
  // without an entry.
  const INTERVAL_SONG_HINTS = {
    // 小星星：do do sol sol / la la sol- / fa fa mi mi / re re do- —
    // targets the "re re" near the end (do -> re relationship).
    2: {
      name: "小星星",
      tempo: 480,
      noteSequence: [
        { degree: 0, duration: 1 }, { degree: 0, duration: 1 },
        { degree: 7, duration: 1 }, { degree: 7, duration: 1 },
        { degree: 9, duration: 1 }, { degree: 9, duration: 1 }, { degree: 7, duration: 2 },
        { degree: 5, duration: 1 }, { degree: 5, duration: 1 },
        { degree: 4, duration: 1 }, { degree: 4, duration: 1 },
        { degree: 2, duration: 1 }, { degree: 2, duration: 1 }, { degree: 0, duration: 2 },
      ],
      targetIndex: 11,
    },
    // 兩隻老虎：do re mi do 開頭就是 do -> mi 的完美示範。
    4: {
      name: "兩隻老虎",
      tempo: 460,
      noteSequence: [
        { degree: 0, duration: 1 }, { degree: 2, duration: 1 }, { degree: 4, duration: 1 }, { degree: 0, duration: 1 },
        { degree: 0, duration: 1 }, { degree: 2, duration: 1 }, { degree: 4, duration: 1 }, { degree: 0, duration: 1 },
        { degree: 4, duration: 1 }, { degree: 5, duration: 1 }, { degree: 7, duration: 2 },
        { degree: 4, duration: 1 }, { degree: 5, duration: 1 }, { degree: 7, duration: 2 },
      ],
      targetIndex: 2,
    },
    // 生日快樂歌「Happy birthday dear...」樂句觸及 fa。
    5: {
      name: "生日快樂歌",
      tempo: 480,
      noteSequence: [
        { degree: 7, duration: 1 }, { degree: 7, duration: 1 }, { degree: 12, duration: 1 }, { degree: 9, duration: 1 },
        { degree: 5, duration: 1 }, { degree: 4, duration: 2 },
        { degree: 11, duration: 1 }, { degree: 11, duration: 1 }, { degree: 9, duration: 1 }, { degree: 5, duration: 1 },
        { degree: 7, duration: 1 }, { degree: 5, duration: 2 },
        { degree: 2, duration: 1 }, { degree: 4, duration: 1 }, { degree: 5, duration: 2 },
      ],
      targetIndex: 4,
    },
    // 倫敦鐵橋：開頭就是 sol，純五度的直接示範。
    7: {
      name: "倫敦鐵橋",
      tempo: 460,
      noteSequence: [
        { degree: 7, duration: 1 }, { degree: 9, duration: 1 }, { degree: 7, duration: 1 }, { degree: 5, duration: 1 },
        { degree: 4, duration: 1 }, { degree: 5, duration: 1 }, { degree: 7, duration: 2 },
        { degree: 2, duration: 1 }, { degree: 4, duration: 1 }, { degree: 5, duration: 2 },
        { degree: 4, duration: 1 }, { degree: 5, duration: 1 }, { degree: 7, duration: 2 },
      ],
      targetIndex: 0,
    },
    // 小星星「la la sol」是 do-re-mi-fa-sol-LA 裡最好認的 la。
    9: {
      name: "小星星",
      tempo: 480,
      noteSequence: [
        { degree: 0, duration: 1 }, { degree: 0, duration: 1 },
        { degree: 7, duration: 1 }, { degree: 7, duration: 1 },
        { degree: 9, duration: 1 }, { degree: 9, duration: 1 }, { degree: 7, duration: 2 },
        { degree: 5, duration: 1 }, { degree: 5, duration: 1 },
        { degree: 4, duration: 1 }, { degree: 4, duration: 1 },
        { degree: 2, duration: 1 }, { degree: 2, duration: 1 }, { degree: 0, duration: 2 },
      ],
      targetIndex: 4,
    },
    // 生日快樂歌「Happy birthday to you」句尾的 ti，導音示範。
    11: {
      name: "生日快樂歌",
      tempo: 480,
      noteSequence: [
        { degree: 7, duration: 1 }, { degree: 7, duration: 1 }, { degree: 9, duration: 1 }, { degree: 7, duration: 1 },
        { degree: 12, duration: 1 }, { degree: 11, duration: 2 },
        { degree: 7, duration: 1 }, { degree: 7, duration: 1 }, { degree: 9, duration: 1 }, { degree: 7, duration: 1 },
        { degree: 14, duration: 1 }, { degree: 12, duration: 2 },
        { degree: 9, duration: 1 }, { degree: 7, duration: 1 }, { degree: 12, duration: 2 },
      ],
      targetIndex: 5,
    },
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
  // Always random within the player's chosen 音域 — no fixed-tonic option,
  // unlike pitchTrain's pickTonicMidi(randomKey). This is what makes the
  // game "relative". Defaults to the "mid" range (today's old hardcoded
  // G3..G4) when state/settings aren't available yet.
  function pickTonicMidi() {
    const rangeKey = (state && state.settings && state.settings.octaveRange) || "mid";
    const range = OCTAVE_RANGES[rangeKey] || OCTAVE_RANGES.mid;
    return range.min + Math.floor(Math.random() * (range.max - range.min + 1));
  }

  // Drops a whole tone/chord block down an octave if its highest voice
  // would land above AUDIBLE_CEILING_MIDI, rather than silently altering
  // the tonic that was already announced to the player.
  function clampMidiList(midiList) {
    const highest = Math.max.apply(null, midiList);
    if (highest <= AUDIBLE_CEILING_MIDI) return midiList;
    return midiList.map((m) => m - 12);
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
  function chordTierFor(difficulty) {
    return CHORD_TIERS[difficulty] || CHORD_TIERS.easy;
  }

  // MIDI notes for a chord rooted `rootDegreeIndex` semitones above
  // `tonicMidi`, clamped down an octave as a block if it would otherwise
  // reach into shrill territory (see AUDIBLE_CEILING_MIDI / clampMidiList).
  function chordMidiNotes(tonicMidi, rootDegreeIndex, quality) {
    const midiList = CHORD_QUALITIES[quality].intervals.map((iv) => tonicMidi + rootDegreeIndex + iv);
    return clampMidiList(midiList);
  }

  // Every chord in the template (root AND quality) must fit within
  // tier.progressionPool/qualityPool for the template to be usable at that
  // tier — harder progressions (blues' dominant7, jazz's V7/Imaj7)
  // naturally only surface once the tier's qualityPool unlocks those
  // chord qualities. Shared by chord-mode question generation and
  // melody-mode's progression-arpeggio generation (see chordTierFor reuse
  // in buildMelodyFromProgression below).
  function templateFitsTier(template, tier) {
    return template.chords.every(
      (c) => tier.progressionPool.indexOf(c.root) !== -1 && tier.qualityPool.indexOf(c.quality) !== -1
    );
  }

  // Flattens PROGRESSION_TEMPLATES into { progressionName, context, target }
  // candidates usable at this tier. `context` is the chord heard just
  // before `target` in the progression (or the implicit tonic I, for a
  // template's very first chord).
  function progressionCandidatesForTier(tier) {
    const candidates = [];
    PROGRESSION_TEMPLATES.forEach((template) => {
      if (!templateFitsTier(template, tier)) return;
      template.chords.forEach((chord, i) => {
        const context = i === 0 ? { root: 0, quality: "major" } : template.chords[i - 1];
        candidates.push({ progressionName: template.name, context, target: chord });
      });
    });
    return candidates;
  }

  // Chord-tone scale-degree indices for a chord rooted `root` semitones
  // above the tonic, folded back into the practice octave (0..12) so every
  // tone is always answerable on the existing degree keypad/piano — root
  // first, then 3rd, 5th, [7th], matching CHORD_QUALITIES' interval order,
  // so "take the first k tones" always starts from the most recognizable
  // note. (These chords are all built from correct diatonic qualities on
  // diatonic roots, so every folded tone always lands on a DIATONIC_INDICES
  // slot — never a chromatic one, regardless of the includeChromatic
  // setting.)
  function chordToneDegrees(root, quality) {
    return CHORD_QUALITIES[quality].intervals.map((iv) => {
      const v = root + iv;
      return v > 12 ? v - 12 : v;
    });
  }

  // Splits `totalNotes` across `chordCount` chords as evenly as possible,
  // front-loading any remainder onto the earlier chords (6 notes over 4
  // chords -> [2,2,1,1]) rather than padding the end.
  function distributeNoteCounts(totalNotes, chordCount) {
    const base = Math.floor(totalNotes / chordCount);
    const remainder = totalNotes % chordCount;
    const counts = [];
    for (let i = 0; i < chordCount; i++) {
      counts.push(base + (i < remainder ? 1 : 0));
    }
    return counts;
  }

  // Builds a `length`-note melody by picking a random progression template
  // (gated to `difficulty` via chordTierFor, reusing the exact same
  // pool/quality gating chord-mode questions use) and arpeggiating it:
  // each chord gets a share of the notes (see distributeNoteCounts),
  // cycling through that chord's own tones in root/3rd/5th/[7th] order —
  // so a chord holding more notes than it has distinct tones just repeats
  // the pattern (a completely normal arpeggio-drill shape). Falls back to
  // "1-4-5 三和弦搖滾" (major triads only, fits every tier) if nothing else
  // fits, so this never comes back empty.
  function buildMelodyFromProgression(length, difficulty) {
    const chordTier = chordTierFor(difficulty);
    const usable = PROGRESSION_TEMPLATES.filter((t) => templateFitsTier(t, chordTier));
    const template =
      usable.length > 0
        ? usable[Math.floor(Math.random() * usable.length)]
        : PROGRESSION_TEMPLATES.find((t) => t.name === "1-4-5 三和弦搖滾");
    const counts = distributeNoteCounts(length, template.chords.length);
    const melody = [];
    template.chords.forEach((chord, i) => {
      const tones = chordToneDegrees(chord.root, chord.quality);
      for (let j = 0; j < counts[i]; j++) {
        melody.push(tones[j % tones.length]);
      }
    });
    return { melody, progressionName: template.name };
  }

  // -- 弱點強化：依歷史正確率加權選取 -------------------------------------------
  const WEAKNESS_MIN_SAMPLE = 5;
  const WEAKNESS_MAX_WEIGHT_BONUS = 4;
  // Picks one item from `items`. Uniform random unless
  // state.settings.weaknessFocus is on, in which case items with a lower
  // historical accuracy (via getEntry(item) -> {attempts, correct} | null,
  // needs >=WEAKNESS_MIN_SAMPLE attempts to count) get picked more often —
  // items with too little data stay at neutral weight so early sessions
  // behave like plain random. Shared by degree selection (single/melody)
  // and chord selection (progression/quality), just with different
  // getEntry lookups against different storage stats buckets.
  function weightedChoice(items, getEntry) {
    if (!state.settings.weaknessFocus) return items[Math.floor(Math.random() * items.length)];
    const weights = items.map((item) => {
      const entry = getEntry(item);
      if (!entry || entry.attempts < WEAKNESS_MIN_SAMPLE) return 1;
      const accuracy = entry.correct / entry.attempts;
      return 1 + (1 - accuracy) * WEAKNESS_MAX_WEIGHT_BONUS;
    });
    const total = weights.reduce((sum, w) => sum + w, 0);
    let r = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }
  function weightedPool(pool, mode) {
    const stats = RelativePitchStorage.getDegreeStats();
    return weightedChoice(pool, (index) => stats[mode + ":" + index]);
  }

  // -- 單音辨識 -----------------------------------------------------------------
  function nextSingleQuestion() {
    if (!state || state.mode !== "singleDegree") return;
    const tier = singleTierFor(state.difficulty);
    const pool = effectivePool(tier.diatonicPool, state.settings.includeChromatic);
    const index = weightedPool(pool, "singleDegree");
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
    RelativePitchStorage.recordDegreeAttempt("singleDegree", state.currentDegree.index, pickedIndex);
    notify("single-answer", { correct, milestone });
  }

  // -- 旋律回奏 -----------------------------------------------------------------
  function startMelodyRound() {
    if (!state || state.mode !== "melody") return;
    const tier = melodyTierFor(state.difficulty);
    const built = buildMelodyFromProgression(tier.length, state.difficulty);
    state.tonicMidi = pickTonicMidi();
    state.melody = built.melody;
    state.progressionName = built.progressionName;
    state.playerAttempt = [];
    state.melodyResult = null;
    state.status = "melody-intro";
    notify("melody-round-start");
  }

  function markMelodyIntroDone() {
    if (!state || state.mode !== "melody" || state.status !== "melody-intro") return;
    state.status = "melody-input";
    notify("melody-input-ready");
  }

  // Unlimited — the only gate is being in the input phase of a round.
  function requestMelodyReplay() {
    if (!state || state.mode !== "melody" || state.status !== "melody-input") return false;
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
    state.melody.forEach((degree, i) => {
      if (state.playerAttempt[i] != null) {
        RelativePitchStorage.recordDegreeAttempt("melody", degree, state.playerAttempt[i]);
      }
    });

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

  // -- 和弦練習 -----------------------------------------------------------------
  function nextChordQuestion() {
    if (!state || state.mode !== "chord") return;
    const tier = chordTierFor(state.difficulty);
    state.tonicMidi = pickTonicMidi();
    if (state.chordSubMode === "quality") {
      const stats = RelativePitchStorage.getChordStats();
      const quality = weightedChoice(tier.qualityPool, (q) => stats["quality:" + q]);
      state.currentChord = {
        rootDegreeIndex: 0,
        quality,
        roman: null,
        midiNotes: chordMidiNotes(state.tonicMidi, 0, quality),
        contextMidiNotes: null,
        progressionName: null,
      };
    } else {
      const stats = RelativePitchStorage.getChordStats();
      // Prefer real, named progressions (J-Pop 王道, 卡農, 黃金四和弦...) over
      // an isolated random root — each candidate is "this chord, heard right
      // after that one, inside this progression", which is both more
      // musical and a better test of in-context recognition than a bare
      // I-then-target pair. Falls back to the old isolated-root behavior
      // only if no template's chords fit within this tier (shouldn't
      // happen in practice — even superEasy fits "1-4-5"/"4-5-1").
      const candidates = progressionCandidatesForTier(tier);
      let contextChord, targetChord, progressionName;
      if (candidates.length > 0) {
        const picked = weightedChoice(
          candidates,
          (c) => stats["progression:" + DIATONIC_CHORD_MAP[c.target.root].roman]
        );
        contextChord = picked.context;
        targetChord = picked.target;
        progressionName = picked.progressionName;
      } else {
        const rootDegreeIndex = weightedChoice(
          tier.progressionPool,
          (root) => stats["progression:" + DIATONIC_CHORD_MAP[root].roman]
        );
        contextChord = { root: 0, quality: "major" };
        targetChord = { root: rootDegreeIndex, quality: DIATONIC_CHORD_MAP[rootDegreeIndex].quality };
        progressionName = null;
      }
      const chordInfo = DIATONIC_CHORD_MAP[targetChord.root];
      state.currentChord = {
        rootDegreeIndex: targetChord.root,
        quality: targetChord.quality,
        roman: chordInfo.roman,
        midiNotes: chordMidiNotes(state.tonicMidi, targetChord.root, targetChord.quality),
        // Harmonic context played just before the target chord — the
        // actual preceding chord in the chosen progression, or a plain I
        // when there's no "previous chord" (template's first chord).
        contextMidiNotes: chordMidiNotes(state.tonicMidi, contextChord.root, contextChord.quality),
        progressionName,
      };
    }
    state.lastChordResult = null;
    state.status = "chord-question";
    notify("chord-question");
  }

  function answerChord(pickedValue) {
    if (!state || state.mode !== "chord" || state.status !== "chord-question") return;
    const correctKey = state.chordSubMode === "quality" ? state.currentChord.quality : state.currentChord.roman;
    const correct = pickedValue === correctKey;
    state.sessionAnswered += 1;
    if (correct) {
      state.sessionCorrect += 1;
      state.streak += 1;
      if (state.streak > state.bestStreakThisSession) state.bestStreakThisSession = state.streak;
    } else {
      state.streak = 0;
    }
    const milestone = correct && isMilestone(state.streak);
    state.lastChordResult = { correct, pickedValue, correctKey };
    state.status = "chord-answered";
    RelativePitchStorage.recordChordAttempt(state.chordSubMode, correctKey, pickedValue);
    notify("chord-answer", { correct, milestone });
  }

  // -- session lifecycle --------------------------------------------------
  function startSession(mode, difficulty) {
    state = {
      mode,
      difficulty,
      settings: {
        inputMode: RelativePitchStorage.getSettings().inputMode,
        includeChromatic: RelativePitchStorage.getSettings().includeChromatic,
        octaveRange: RelativePitchStorage.getSettings().octaveRange,
        weaknessFocus: RelativePitchStorage.getSettings().weaknessFocus,
      },
      chordSubMode: RelativePitchStorage.getSettings().chordSubMode,
      status: null,
      streak: 0,
      bestStreakThisSession: 0,
      sessionAnswered: 0,
      sessionCorrect: 0,
      currentDegree: null,
      lastResult: null,
      currentChord: null,
      lastChordResult: null,
      melody: [],
      progressionName: null,
      tonicMidi: 60,
      playerAttempt: [],
      melodyResult: null,
    };
    if (mode === "singleDegree") nextSingleQuestion();
    else if (mode === "chord") nextChordQuestion();
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
    // chord
    nextChordQuestion,
    answerChord,
    // shared helpers/constants for ui.js
    FULL_DEGREE_LABELS,
    DIATONIC_INDICES,
    CHROMATIC_INDICES,
    DIFFICULTY_ORDER,
    MILESTONE_EVERY,
    SINGLE_TIERS,
    MELODY_TIERS,
    CHORD_TIERS,
    CHORD_QUALITIES,
    DIATONIC_CHORD_MAP,
    INTERVAL_SONG_HINTS,
    midiToFreq,
    isMilestone,
    singleTierFor,
    melodyTierFor,
    chordTierFor,
    effectivePool,
  };
})();

if (typeof window !== "undefined") {
  window.RelativePitchGame = RelativePitchGame;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = RelativePitchGame;
}
