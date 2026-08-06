// 拼字遊戲 (Word game) state controller: owns the letter-tile hand, staging
// area (letters currently being arranged into a candidate word), found-word
// list, timer, win detection, persistence. No DOM access here (ui.js's job).
//
// Core loop: the player holds a hand of random letter tiles (drawn from a
// weighted bag using real English letter frequency); tapping tiles moves
// them into a staging row to build a candidate word; submitting a valid,
// not-yet-found dictionary word (length >= 3) scores it, permanently
// consumes those tiles, and refills the hand with fresh random letters —
// so the hand keeps "flowing" rather than being a single fixed puzzle.
var WordGame = (function () {
  const TIERS = {
    superEasy: { handSize: 8, targetWords: 4, vowelBoost: 2.2 },
    easy: { handSize: 8, targetWords: 6, vowelBoost: 1.0 },
    medium: { handSize: 9, targetWords: 9, vowelBoost: 0.85 },
    hard: { handSize: 10, targetWords: 12, vowelBoost: 0.7 },
    expert: { handSize: 11, targetWords: 15, vowelBoost: 0.55 },
  };
  const MAX_HINTS = 5;
  const DESTUCK_MAX_ATTEMPTS = 40;

  // Standard approximate English letter frequency (percent), used as the
  // base weight for the tile bag. vowelBoost (per difficulty) multiplies
  // only a/e/i/o/u before normalizing — the one genuine second axis behind
  // 超簡單, independent of hand size (mirrors minesweeper's fixed-board +
  // percent-tunable-density resolution rather than percent-lerping a board
  // size the way sokoban's since-removed superEasy mistakenly did).
  const BASE_LETTER_FREQ = {
    a: 8.2, b: 1.5, c: 2.8, d: 4.3, e: 12.7, f: 2.2, g: 2.0, h: 6.1, i: 7.0,
    j: 0.15, k: 0.77, l: 4.0, m: 2.4, n: 6.7, o: 7.5, p: 1.9, q: 0.095,
    r: 6.0, s: 6.3, t: 9.1, u: 2.8, v: 0.98, w: 2.4, x: 0.15, y: 2.0, z: 0.074,
  };
  const VOWELS = new Set(["a", "e", "i", "o", "u"]);

  let state = null;
  let timerInterval = null;
  let changeListener = null;
  let tileIdCounter = 0;

  function onChange(cb) {
    changeListener = cb;
  }
  function notify(event) {
    if (changeListener) changeListener(state, event || null);
  }

  function nextTileId() {
    tileIdCounter += 1;
    return tileIdCounter;
  }

  function buildCumulativeWeights(vowelBoost) {
    const entries = Object.keys(BASE_LETTER_FREQ).map((letter) => {
      const base = BASE_LETTER_FREQ[letter];
      return [letter, VOWELS.has(letter) ? base * vowelBoost : base];
    });
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let cum = 0;
    return entries.map(([letter, w]) => {
      cum += w;
      return [letter, cum / total];
    });
  }

  function drawLetter(cumulative) {
    const r = Math.random();
    for (const [letter, cp] of cumulative) {
      if (r <= cp) return letter;
    }
    return cumulative[cumulative.length - 1][0];
  }

  function makeHandTiles(size, cumulative) {
    const tiles = [];
    for (let i = 0; i < size; i++) {
      tiles.push({ id: nextTileId(), letter: drawLetter(cumulative) });
    }
    return tiles;
  }

  function canFormWord(handLetters, word) {
    const counts = {};
    for (const l of handLetters) counts[l] = (counts[l] || 0) + 1;
    for (const ch of word) {
      if (!counts[ch]) return false;
      counts[ch] -= 1;
    }
    return true;
  }

  // Every candidate word up to hand size, minus already-found ones, that
  // the current hand's letters can actually spell. Used both by the hint
  // (pick one at random) and by stuck-hand detection (just check length).
  function findFormableWords(handTiles, excludeSet) {
    const handLetters = handTiles.map((t) => t.letter);
    const candidates = WordGameDictionary.wordsOfMaxLength(handTiles.length);
    const out = [];
    for (const w of candidates) {
      if (excludeSet.has(w)) continue;
      if (canFormWord(handLetters, w)) out.push(w);
    }
    return out;
  }

  // If the current hand can't spell anything new, nudge it back to life by
  // redrawing one random tile at a time (rather than the whole hand) until
  // it's playable again, or give up after a bounded number of attempts —
  // in practice this dictionary/frequency table combination makes a truly
  // dead hand vanishingly rare, so the cap is just a defensive fallback.
  function deStuckHand() {
    const excludeSet = new Set(state.foundWords);
    let attempts = 0;
    while (attempts < DESTUCK_MAX_ATTEMPTS && findFormableWords(state.hand, excludeSet).length === 0) {
      const idx = Math.floor(Math.random() * state.hand.length);
      state.hand[idx] = { id: nextTileId(), letter: drawLetter(state.cumulative) };
      attempts++;
    }
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
      difficulty: state.difficulty,
      handSize: state.handSize,
      targetWords: state.targetWords,
      vowelBoost: state.vowelBoost,
      hand: state.hand,
      staging: state.staging,
      foundWords: state.foundWords,
      score: state.score,
      hintsUsed: state.hintsUsed,
      hintWord: state.hintWord,
      lastFound: state.lastFound,
      nextTileId: tileIdCounter,
      elapsedMs: getElapsedMs(),
      status: state.status === "won" ? "won" : "playing",
    };
  }

  function deserialize(saved) {
    tileIdCounter = saved.nextTileId || 0;
    return {
      difficulty: saved.difficulty,
      handSize: saved.handSize,
      targetWords: saved.targetWords,
      vowelBoost: saved.vowelBoost,
      cumulative: buildCumulativeWeights(saved.vowelBoost),
      hand: Array.isArray(saved.hand) ? saved.hand : [],
      staging: Array.isArray(saved.staging) ? saved.staging : [],
      foundWords: Array.isArray(saved.foundWords) ? saved.foundWords : [],
      score: saved.score || 0,
      hintsUsed: saved.hintsUsed || 0,
      hintWord: saved.hintWord || null,
      lastFound: saved.lastFound || null,
      elapsedMs: saved.elapsedMs || 0,
      startTimestamp: Date.now(),
      status: saved.status === "won" ? "won" : "playing",
    };
  }

  function persist() {
    if (state && state.status !== "won") {
      WordGameStorage.saveCurrentGame(serialize());
    }
  }

  function newGame(difficulty) {
    stopTimerInterval();
    tileIdCounter = 0;
    const tier = TIERS[difficulty] || TIERS.easy;
    const cumulative = buildCumulativeWeights(tier.vowelBoost);
    state = {
      difficulty,
      handSize: tier.handSize,
      targetWords: tier.targetWords,
      vowelBoost: tier.vowelBoost,
      cumulative,
      hand: makeHandTiles(tier.handSize, cumulative),
      staging: [],
      foundWords: [],
      score: 0,
      hintsUsed: 0,
      hintWord: null,
      lastFound: null,
      elapsedMs: 0,
      startTimestamp: Date.now(),
      status: "playing",
    };
    deStuckHand();
    startTimer();
    persist();
    notify("new-game");
  }

  function resumeGame() {
    const saved = WordGameStorage.loadCurrentGame();
    if (!saved || !Array.isArray(saved.hand) || !saved.handSize) return false;
    if (saved.status !== "playing") return false;
    stopTimerInterval();
    state = deserialize(saved);
    startTimer();
    notify("restore");
    return true;
  }

  function hasSavedResumableGame() {
    const saved = WordGameStorage.loadCurrentGame();
    return !!(saved && saved.status === "playing");
  }

  function hasProgress() {
    if (!state) return false;
    if (state.status !== "playing") return false;
    return state.foundWords.length > 0;
  }

  function finishWin() {
    state.elapsedMs = getElapsedMs();
    state.status = "won";
    stopTimerInterval();
    const elapsedSeconds = Math.floor(state.elapsedMs / 1000);
    const isNewBest = WordGameStorage.updateCareer(state.difficulty, elapsedSeconds, state.score);
    const longestWord = state.foundWords.reduce((longest, w) => (w.length > longest.length ? w : longest), "");
    WordGameStorage.appendHistoryEntry({
      difficulty: state.difficulty,
      score: state.score,
      wordsFound: state.foundWords.length,
      longestWord,
      elapsedSeconds,
      completedAt: new Date().toISOString(),
    });
    WordGameStorage.clearCurrentGame();
    state.justWon = { isNewBest };
  }

  function selectTile(tileId) {
    if (!state || state.status !== "playing") return;
    const idx = state.hand.findIndex((t) => t.id === tileId);
    if (idx === -1) return;
    const [tile] = state.hand.splice(idx, 1);
    state.staging.push(tile);
    notify("select");
  }

  function deselectTile(tileId) {
    if (!state || state.status !== "playing") return;
    const idx = state.staging.findIndex((t) => t.id === tileId);
    if (idx === -1) return;
    const [tile] = state.staging.splice(idx, 1);
    state.hand.push(tile);
    notify("select");
  }

  function returnStagingToHand() {
    while (state.staging.length > 0) {
      state.hand.push(state.staging.pop());
    }
  }

  function clearStaging() {
    if (!state || state.status !== "playing") return;
    returnStagingToHand();
    notify("select");
  }

  function submitWord() {
    if (!state || state.status !== "playing") return false;
    const word = state.staging.map((t) => t.letter).join("");
    const consumedCount = state.staging.length;
    if (word.length < 3 || !WordGameDictionary.isWord(word) || state.foundWords.includes(word)) {
      returnStagingToHand();
      notify("invalid");
      return false;
    }
    state.foundWords.push(word);
    state.score += word.length;
    state.staging = [];
    state.hintWord = null;
    state.lastFound = { word, translation: WordGameDictionary.getTranslation(word) };
    for (let i = 0; i < consumedCount; i++) {
      state.hand.push({ id: nextTileId(), letter: drawLetter(state.cumulative) });
    }
    deStuckHand();
    if (state.foundWords.length >= state.targetWords) {
      finishWin();
    } else {
      persist();
    }
    notify("submit-valid");
    return true;
  }

  function reshuffleHand() {
    if (!state || state.status !== "playing") return;
    returnStagingToHand();
    state.hand = makeHandTiles(state.handSize, state.cumulative);
    deStuckHand();
    state.hintWord = null;
    persist();
    notify("reshuffle");
  }

  function useHint() {
    if (!state || state.status !== "playing") return;
    if (state.hintsUsed >= MAX_HINTS) {
      notify("invalid");
      return;
    }
    const excludeSet = new Set(state.foundWords);
    const candidates = findFormableWords(state.hand, excludeSet);
    if (candidates.length === 0) {
      notify("invalid");
      return;
    }
    state.hintsUsed++;
    state.hintWord = candidates[Math.floor(Math.random() * candidates.length)];
    persist();
    notify("hint");
  }

  function getState() {
    return state;
  }
  function getMaxHints() {
    return MAX_HINTS;
  }
  function getTiers() {
    return TIERS;
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
    selectTile,
    deselectTile,
    clearStaging,
    submitWord,
    reshuffleHand,
    useHint,
    getState,
    getMaxHints,
    getTiers,
    formatTime,
    formatSeconds,
  };
})();

if (typeof window !== "undefined") {
  window.WordGame = WordGame;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = WordGame;
}
