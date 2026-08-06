// Shared localStorage core for the game hub, plus per-game storage modules.
//
// Everything still lives under the single original key "sudoku.data" (never
// renamed, so existing sudoku players lose nothing when this file replaces
// js/storage.js). The root shape used to be sudoku's flat blob directly;
// it is now { theme, games: { <gameId>: <that game's own blob> } }. On first
// load after this upgrade, GameHubStorage.loadRoot() detects the old flat
// shape (no `.games` key) and nests it as games.sudoku exactly once,
// persisting the upgraded shape immediately — existing career/history/daily
// streak/current game/settings all survive untouched.
var GameHubStorage = (function () {
  const DATA_KEY = "sudoku.data";

  function safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  }

  function defaultRoot() {
    return { theme: "blue_light", games: {} };
  }

  function loadRoot() {
    const raw = safeGet(DATA_KEY);
    if (!raw) return defaultRoot();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return defaultRoot();
    }
    if (!parsed || typeof parsed !== "object") return defaultRoot();

    if (parsed.games && typeof parsed.games === "object") {
      if (typeof parsed.theme !== "string") parsed.theme = "blue_light";
      return parsed;
    }

    // Pre-hub flat shape: the only game that ever existed before the hub was
    // sudoku, so any flat top-level currentGame/history/career/daily/settings
    // blob belongs to it. Nest it once and persist the upgraded shape.
    if (
      "currentGame" in parsed ||
      "history" in parsed ||
      "career" in parsed ||
      "daily" in parsed ||
      "settings" in parsed
    ) {
      const wrapped = {
        theme: (parsed.settings && parsed.settings.theme) || "blue_light",
        games: { sudoku: parsed },
      };
      saveRoot(wrapped);
      return wrapped;
    }

    return defaultRoot();
  }

  function saveRoot(root) {
    try {
      safeSet(DATA_KEY, JSON.stringify(root));
    } catch (e) {
      /* no-op */
    }
  }

  function getTheme() {
    try {
      return loadRoot().theme || "blue_light";
    } catch (e) {
      return "blue_light";
    }
  }

  function setTheme(theme) {
    try {
      const root = loadRoot();
      root.theme = theme;
      saveRoot(root);
    } catch (e) {
      /* no-op */
    }
  }

  // Per-game namespaced load/save. `options.defaultData()` supplies the
  // shape for a brand-new game; `options.migrateLegacy()` (optional) is
  // consulted only the first time a game has no data at all, for importing
  // even-older per-key storage formats (e.g. sudoku's pre-PRID-parity keys).
  function forGame(gameId, options) {
    options = options || {};

    function loadGameData() {
      const root = loadRoot();
      if (root.games[gameId] != null) return root.games[gameId];
      if (typeof options.migrateLegacy === "function") {
        const legacy = options.migrateLegacy();
        if (legacy) {
          root.games[gameId] = legacy;
          saveRoot(root);
          return legacy;
        }
      }
      return typeof options.defaultData === "function" ? options.defaultData() : {};
    }

    function saveGameData(data) {
      const root = loadRoot();
      root.games[gameId] = data;
      saveRoot(root);
    }

    return { loadGameData, saveGameData };
  }

  return { forGame, getTheme, setTheme, safeGet, safeSet };
})();

if (typeof window !== "undefined") {
  window.GameHubStorage = GameHubStorage;
}

// ---------------------------------------------------------------------------
// SudokuStorage — external API (function names, params, return values) is
// unchanged from the pre-hub js/storage.js, so sudoku/js/game.js and
// sudoku/js/ui.js require zero code changes.
// ---------------------------------------------------------------------------
var SudokuStorage = (function () {
  const LEGACY_BEST_TIMES_KEY = "sudoku.bestTimes";
  const LEGACY_SAVED_GAME_KEY = "sudoku.savedGame";
  const DIFFICULTIES = ["superEasy", "easy", "medium", "hard", "expert"];

  function defaultCareerEntry() {
    return { bestTime: null, won: 0, zeroMistakeWins: 0 };
  }

  function defaultData() {
    const career = {};
    for (const d of DIFFICULTIES) career[d] = defaultCareerEntry();
    return {
      currentGame: null,
      history: [],
      career,
      daily: { completedDates: [], streak: 0, lastCompletedDate: null },
      settings: { theme: "blue_light", superEasyPercent: 30 },
    };
  }

  function mergeDefaults(data) {
    const merged = defaultData();
    if (!data || typeof data !== "object") return merged;
    if (data.currentGame && typeof data.currentGame === "object") {
      merged.currentGame = data.currentGame;
    }
    if (Array.isArray(data.history)) merged.history = data.history;
    if (data.career && typeof data.career === "object") {
      for (const d of DIFFICULTIES) {
        merged.career[d] = Object.assign(defaultCareerEntry(), data.career[d] || {});
      }
    }
    if (data.daily && typeof data.daily === "object") {
      merged.daily.completedDates = Array.isArray(data.daily.completedDates)
        ? data.daily.completedDates
        : [];
      merged.daily.streak = data.daily.streak || 0;
      merged.daily.lastCompletedDate = data.daily.lastCompletedDate || null;
    }
    if (data.settings && typeof data.settings === "object") {
      merged.settings.theme = data.settings.theme || "blue_light";
      merged.settings.superEasyPercent = data.settings.superEasyPercent || 30;
    }
    return merged;
  }

  // One-time import from the old per-key format (pre-PRD-parity web version,
  // predates even the flat "sudoku.data" blob) into the new shape.
  function migrateLegacy() {
    const bestRaw = GameHubStorage.safeGet(LEGACY_BEST_TIMES_KEY);
    const savedRaw = GameHubStorage.safeGet(LEGACY_SAVED_GAME_KEY);
    if (!bestRaw && !savedRaw) return null;
    try {
      const migrated = defaultData();
      if (bestRaw) {
        const best = JSON.parse(bestRaw);
        for (const d of ["easy", "medium", "hard", "expert"]) {
          if (best[d] != null) migrated.career[d].bestTime = Math.floor(best[d] / 1000);
        }
      }
      if (savedRaw) {
        const saved = JSON.parse(savedRaw);
        if (saved && saved.status === "playing") {
          migrated.currentGame = saved;
        }
      }
      return migrated;
    } catch (e) {
      return null;
    }
  }

  const gameStore = GameHubStorage.forGame("sudoku", {
    defaultData,
    migrateLegacy,
  });

  function loadAll() {
    try {
      return mergeDefaults(gameStore.loadGameData());
    } catch (e) {
      return defaultData();
    }
  }

  function saveAll(data) {
    try {
      gameStore.saveGameData(data);
    } catch (e) {
      /* no-op */
    }
  }

  // -- current game -----------------------------------------------------
  function loadCurrentGame() {
    try {
      return loadAll().currentGame;
    } catch (e) {
      return null;
    }
  }
  function saveCurrentGame(stateDict) {
    try {
      const data = loadAll();
      data.currentGame = stateDict;
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }
  function clearCurrentGame() {
    try {
      const data = loadAll();
      data.currentGame = null;
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }

  // -- history ------------------------------------------------------------
  function appendHistoryEntry(entry) {
    try {
      const data = loadAll();
      data.history.unshift(entry);
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }
  function getHistory() {
    try {
      return loadAll().history;
    } catch (e) {
      return [];
    }
  }

  // -- career ---------------------------------------------------------------
  function getCareer() {
    try {
      return loadAll().career;
    } catch (e) {
      return defaultData().career;
    }
  }
  function updateCareer(difficulty, elapsedSeconds, mistakes) {
    try {
      const data = loadAll();
      const entry = Object.assign(defaultCareerEntry(), data.career[difficulty] || {});
      entry.won += 1;
      if (mistakes === 0) entry.zeroMistakeWins += 1;
      let isNewBest = false;
      if (entry.bestTime == null || elapsedSeconds < entry.bestTime) {
        entry.bestTime = elapsedSeconds;
        isNewBest = true;
      }
      data.career[difficulty] = entry;
      saveAll(data);
      return isNewBest;
    } catch (e) {
      return false;
    }
  }

  // -- daily challenge ------------------------------------------------------
  function getDailyStatus() {
    try {
      return loadAll().daily;
    } catch (e) {
      return defaultData().daily;
    }
  }

  function dateDiffDays(a, b) {
    const toUtcMs = (s) => {
      const [y, m, d] = s.split("-").map(Number);
      return Date.UTC(y, m - 1, d);
    };
    return Math.round((toUtcMs(b) - toUtcMs(a)) / 86400000);
  }

  function recordDailyCompletion(dateStr) {
    try {
      const data = loadAll();
      const daily = data.daily;
      if (daily.completedDates.includes(dateStr)) {
        saveAll(data);
        return daily;
      }
      const isConsecutive = daily.lastCompletedDate
        ? dateDiffDays(daily.lastCompletedDate, dateStr) === 1
        : false;
      daily.streak = isConsecutive ? (daily.streak || 0) + 1 : 1;
      daily.completedDates.push(dateStr);
      daily.lastCompletedDate = dateStr;
      data.daily = daily;
      saveAll(data);
      return daily;
    } catch (e) {
      return getDailyStatus();
    }
  }

  // -- settings -------------------------------------------------------------
  function getSettings() {
    try {
      return loadAll().settings;
    } catch (e) {
      return defaultData().settings;
    }
  }
  function saveSettings(partial) {
    try {
      const data = loadAll();
      data.settings = Object.assign(data.settings, partial);
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }

  return {
    DIFFICULTIES,
    loadCurrentGame,
    saveCurrentGame,
    clearCurrentGame,
    appendHistoryEntry,
    getHistory,
    getCareer,
    updateCareer,
    getDailyStatus,
    recordDailyCompletion,
    getSettings,
    saveSettings,
    dateDiffDays,
  };
})();

if (typeof window !== "undefined") {
  window.SudokuStorage = SudokuStorage;
}

// ---------------------------------------------------------------------------
// MemoryStorage — same shape of API as SudokuStorage, adapted for Memory
// Match's own career/history fields (moves instead of mistakes, no daily
// challenge). Namespaced under games.memoryMatch, fully independent from
// sudoku's data.
// ---------------------------------------------------------------------------
var MemoryStorage = (function () {
  const DIFFICULTIES = ["superEasy", "easy", "medium", "hard", "expert"];

  function defaultCareerEntry() {
    return { bestTime: null, bestMoves: null, won: 0 };
  }

  function defaultData() {
    const career = {};
    for (const d of DIFFICULTIES) career[d] = defaultCareerEntry();
    return {
      currentGame: null,
      history: [],
      career,
      settings: { superEasyPercent: 30 },
    };
  }

  function mergeDefaults(data) {
    const merged = defaultData();
    if (!data || typeof data !== "object") return merged;
    if (data.currentGame && typeof data.currentGame === "object") {
      merged.currentGame = data.currentGame;
    }
    if (Array.isArray(data.history)) merged.history = data.history;
    if (data.career && typeof data.career === "object") {
      for (const d of DIFFICULTIES) {
        merged.career[d] = Object.assign(defaultCareerEntry(), data.career[d] || {});
      }
    }
    if (data.settings && typeof data.settings === "object") {
      merged.settings.superEasyPercent = data.settings.superEasyPercent || 30;
    }
    return merged;
  }

  const gameStore = GameHubStorage.forGame("memoryMatch", { defaultData });

  function loadAll() {
    try {
      return mergeDefaults(gameStore.loadGameData());
    } catch (e) {
      return defaultData();
    }
  }

  function saveAll(data) {
    try {
      gameStore.saveGameData(data);
    } catch (e) {
      /* no-op */
    }
  }

  // -- current game -----------------------------------------------------
  function loadCurrentGame() {
    try {
      return loadAll().currentGame;
    } catch (e) {
      return null;
    }
  }
  function saveCurrentGame(stateDict) {
    try {
      const data = loadAll();
      data.currentGame = stateDict;
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }
  function clearCurrentGame() {
    try {
      const data = loadAll();
      data.currentGame = null;
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }

  // -- history ------------------------------------------------------------
  function appendHistoryEntry(entry) {
    try {
      const data = loadAll();
      data.history.unshift(entry);
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }
  function getHistory() {
    try {
      return loadAll().history;
    } catch (e) {
      return [];
    }
  }

  // -- career ---------------------------------------------------------------
  function getCareer() {
    try {
      return loadAll().career;
    } catch (e) {
      return defaultData().career;
    }
  }
  function updateCareer(difficulty, elapsedSeconds, moves) {
    try {
      const data = loadAll();
      const entry = Object.assign(defaultCareerEntry(), data.career[difficulty] || {});
      entry.won += 1;
      let isNewBest = false;
      if (entry.bestTime == null || elapsedSeconds < entry.bestTime) {
        entry.bestTime = elapsedSeconds;
        isNewBest = true;
      }
      if (entry.bestMoves == null || moves < entry.bestMoves) {
        entry.bestMoves = moves;
      }
      data.career[difficulty] = entry;
      saveAll(data);
      return isNewBest;
    } catch (e) {
      return false;
    }
  }

  // -- settings -------------------------------------------------------------
  function getSettings() {
    try {
      return loadAll().settings;
    } catch (e) {
      return defaultData().settings;
    }
  }
  function saveSettings(partial) {
    try {
      const data = loadAll();
      data.settings = Object.assign(data.settings, partial);
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }

  return {
    DIFFICULTIES,
    loadCurrentGame,
    saveCurrentGame,
    clearCurrentGame,
    appendHistoryEntry,
    getHistory,
    getCareer,
    updateCareer,
    getSettings,
    saveSettings,
  };
})();

if (typeof window !== "undefined") {
  window.MemoryStorage = MemoryStorage;
}

// ---------------------------------------------------------------------------
// GuessStorage — same shape of API again, for 1A2B (Bulls and Cows). Career
// tracks fewest attempts to win instead of moves/mistakes. Namespaced under
// games.guessNumber.
// ---------------------------------------------------------------------------
var GuessStorage = (function () {
  const DIFFICULTIES = ["superEasy", "easy", "medium", "hard", "expert"];

  function defaultCareerEntry() {
    return { bestTime: null, bestAttempts: null, won: 0 };
  }

  function defaultData() {
    const career = {};
    for (const d of DIFFICULTIES) career[d] = defaultCareerEntry();
    return {
      currentGame: null,
      history: [],
      career,
      settings: { superEasyPercent: 30 },
    };
  }

  function mergeDefaults(data) {
    const merged = defaultData();
    if (!data || typeof data !== "object") return merged;
    if (data.currentGame && typeof data.currentGame === "object") {
      merged.currentGame = data.currentGame;
    }
    if (Array.isArray(data.history)) merged.history = data.history;
    if (data.career && typeof data.career === "object") {
      for (const d of DIFFICULTIES) {
        merged.career[d] = Object.assign(defaultCareerEntry(), data.career[d] || {});
      }
    }
    if (data.settings && typeof data.settings === "object") {
      merged.settings.superEasyPercent = data.settings.superEasyPercent || 30;
    }
    return merged;
  }

  const gameStore = GameHubStorage.forGame("guessNumber", { defaultData });

  function loadAll() {
    try {
      return mergeDefaults(gameStore.loadGameData());
    } catch (e) {
      return defaultData();
    }
  }

  function saveAll(data) {
    try {
      gameStore.saveGameData(data);
    } catch (e) {
      /* no-op */
    }
  }

  // -- current game -----------------------------------------------------
  function loadCurrentGame() {
    try {
      return loadAll().currentGame;
    } catch (e) {
      return null;
    }
  }
  function saveCurrentGame(stateDict) {
    try {
      const data = loadAll();
      data.currentGame = stateDict;
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }
  function clearCurrentGame() {
    try {
      const data = loadAll();
      data.currentGame = null;
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }

  // -- history ------------------------------------------------------------
  function appendHistoryEntry(entry) {
    try {
      const data = loadAll();
      data.history.unshift(entry);
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }
  function getHistory() {
    try {
      return loadAll().history;
    } catch (e) {
      return [];
    }
  }

  // -- career ---------------------------------------------------------------
  function getCareer() {
    try {
      return loadAll().career;
    } catch (e) {
      return defaultData().career;
    }
  }
  function updateCareer(difficulty, elapsedSeconds, attempts) {
    try {
      const data = loadAll();
      const entry = Object.assign(defaultCareerEntry(), data.career[difficulty] || {});
      entry.won += 1;
      let isNewBest = false;
      if (entry.bestTime == null || elapsedSeconds < entry.bestTime) {
        entry.bestTime = elapsedSeconds;
        isNewBest = true;
      }
      if (entry.bestAttempts == null || attempts < entry.bestAttempts) {
        entry.bestAttempts = attempts;
      }
      data.career[difficulty] = entry;
      saveAll(data);
      return isNewBest;
    } catch (e) {
      return false;
    }
  }

  // -- settings -------------------------------------------------------------
  function getSettings() {
    try {
      return loadAll().settings;
    } catch (e) {
      return defaultData().settings;
    }
  }
  function saveSettings(partial) {
    try {
      const data = loadAll();
      data.settings = Object.assign(data.settings, partial);
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }

  return {
    DIFFICULTIES,
    loadCurrentGame,
    saveCurrentGame,
    clearCurrentGame,
    appendHistoryEntry,
    getHistory,
    getCareer,
    updateCareer,
    getSettings,
    saveSettings,
  };
})();

if (typeof window !== "undefined") {
  window.GuessStorage = GuessStorage;
}

// ---------------------------------------------------------------------------
// BreakoutStorage — same shape again, adapted for an endless-level arcade
// game: career tracks best score + highest level reached + run count;
// history logs every finished run (there's no "won", only "how far did you
// get"). No currentGame is ever written by breakout/js/game.js (a real-time
// round isn't meaningfully resumable across a page reload), but
// loadCurrentGame/saveCurrentGame are still exposed for API symmetry with
// the other games.
// ---------------------------------------------------------------------------
var BreakoutStorage = (function () {
  const DIFFICULTIES = ["superEasy", "easy", "medium", "hard", "expert"];

  function defaultCareerEntry() {
    return { bestScore: null, bestLevel: null, runs: 0 };
  }

  function defaultData() {
    const career = {};
    for (const d of DIFFICULTIES) career[d] = defaultCareerEntry();
    return {
      currentGame: null,
      history: [],
      career,
      settings: { superEasyPercent: 30, soundEnabled: true },
    };
  }

  function mergeDefaults(data) {
    const merged = defaultData();
    if (!data || typeof data !== "object") return merged;
    if (data.currentGame && typeof data.currentGame === "object") {
      merged.currentGame = data.currentGame;
    }
    if (Array.isArray(data.history)) merged.history = data.history;
    if (data.career && typeof data.career === "object") {
      for (const d of DIFFICULTIES) {
        merged.career[d] = Object.assign(defaultCareerEntry(), data.career[d] || {});
      }
    }
    if (data.settings && typeof data.settings === "object") {
      merged.settings.superEasyPercent = data.settings.superEasyPercent || 30;
      merged.settings.soundEnabled =
        data.settings.soundEnabled != null ? !!data.settings.soundEnabled : true;
    }
    return merged;
  }

  const gameStore = GameHubStorage.forGame("breakout", { defaultData });

  function loadAll() {
    try {
      return mergeDefaults(gameStore.loadGameData());
    } catch (e) {
      return defaultData();
    }
  }

  function saveAll(data) {
    try {
      gameStore.saveGameData(data);
    } catch (e) {
      /* no-op */
    }
  }

  // -- current game (unused by breakout today, kept for API symmetry) ------
  function loadCurrentGame() {
    try {
      return loadAll().currentGame;
    } catch (e) {
      return null;
    }
  }
  function saveCurrentGame(stateDict) {
    try {
      const data = loadAll();
      data.currentGame = stateDict;
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }
  function clearCurrentGame() {
    try {
      const data = loadAll();
      data.currentGame = null;
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }

  // -- history ------------------------------------------------------------
  function appendHistoryEntry(entry) {
    try {
      const data = loadAll();
      data.history.unshift(entry);
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }
  function getHistory() {
    try {
      return loadAll().history;
    } catch (e) {
      return [];
    }
  }

  // -- career ---------------------------------------------------------------
  function getCareer() {
    try {
      return loadAll().career;
    } catch (e) {
      return defaultData().career;
    }
  }
  function updateCareer(difficulty, score, level) {
    try {
      const data = loadAll();
      const entry = Object.assign(defaultCareerEntry(), data.career[difficulty] || {});
      let isNewBestScore = false;
      let isNewBestLevel = false;
      entry.runs += 1;
      if (entry.bestScore == null || score > entry.bestScore) {
        entry.bestScore = score;
        isNewBestScore = true;
      }
      if (entry.bestLevel == null || level > entry.bestLevel) {
        entry.bestLevel = level;
        isNewBestLevel = true;
      }
      data.career[difficulty] = entry;
      saveAll(data);
      return { isNewBestScore, isNewBestLevel };
    } catch (e) {
      return { isNewBestScore: false, isNewBestLevel: false };
    }
  }

  // -- settings -------------------------------------------------------------
  function getSettings() {
    try {
      return loadAll().settings;
    } catch (e) {
      return defaultData().settings;
    }
  }
  function saveSettings(partial) {
    try {
      const data = loadAll();
      data.settings = Object.assign(data.settings, partial);
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }

  return {
    DIFFICULTIES,
    loadCurrentGame,
    saveCurrentGame,
    clearCurrentGame,
    appendHistoryEntry,
    getHistory,
    getCareer,
    updateCareer,
    getSettings,
    saveSettings,
  };
})();

if (typeof window !== "undefined") {
  window.BreakoutStorage = BreakoutStorage;
}

// ---------------------------------------------------------------------------
// KlotskiStorage — same shape again, for 華容道 (Klotski). Career tracks
// fewest moves to solve + fastest time, like sudoku/memory. Namespaced
// under games.klotski.
// ---------------------------------------------------------------------------
var KlotskiStorage = (function () {
  const DIFFICULTIES = ["superEasy", "easy", "medium", "hard", "expert"];

  function defaultCareerEntry() {
    return { bestMoves: null, bestTime: null, won: 0 };
  }

  function defaultData() {
    const career = {};
    for (const d of DIFFICULTIES) career[d] = defaultCareerEntry();
    return {
      currentGame: null,
      history: [],
      career,
      settings: { superEasyPercent: 30, soundEnabled: true },
    };
  }

  function mergeDefaults(data) {
    const merged = defaultData();
    if (!data || typeof data !== "object") return merged;
    if (data.currentGame && typeof data.currentGame === "object") {
      merged.currentGame = data.currentGame;
    }
    if (Array.isArray(data.history)) merged.history = data.history;
    if (data.career && typeof data.career === "object") {
      for (const d of DIFFICULTIES) {
        merged.career[d] = Object.assign(defaultCareerEntry(), data.career[d] || {});
      }
    }
    if (data.settings && typeof data.settings === "object") {
      merged.settings.superEasyPercent = data.settings.superEasyPercent || 30;
      merged.settings.soundEnabled =
        data.settings.soundEnabled != null ? !!data.settings.soundEnabled : true;
    }
    return merged;
  }

  const gameStore = GameHubStorage.forGame("klotski", { defaultData });

  function loadAll() {
    try {
      return mergeDefaults(gameStore.loadGameData());
    } catch (e) {
      return defaultData();
    }
  }

  function saveAll(data) {
    try {
      gameStore.saveGameData(data);
    } catch (e) {
      /* no-op */
    }
  }

  // -- current game -----------------------------------------------------
  function loadCurrentGame() {
    try {
      return loadAll().currentGame;
    } catch (e) {
      return null;
    }
  }
  function saveCurrentGame(stateDict) {
    try {
      const data = loadAll();
      data.currentGame = stateDict;
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }
  function clearCurrentGame() {
    try {
      const data = loadAll();
      data.currentGame = null;
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }

  // -- history ------------------------------------------------------------
  function appendHistoryEntry(entry) {
    try {
      const data = loadAll();
      data.history.unshift(entry);
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }
  function getHistory() {
    try {
      return loadAll().history;
    } catch (e) {
      return [];
    }
  }

  // -- career ---------------------------------------------------------------
  function getCareer() {
    try {
      return loadAll().career;
    } catch (e) {
      return defaultData().career;
    }
  }
  function updateCareer(difficulty, elapsedSeconds, moves) {
    try {
      const data = loadAll();
      const entry = Object.assign(defaultCareerEntry(), data.career[difficulty] || {});
      entry.won += 1;
      let isNewBest = false;
      if (entry.bestTime == null || elapsedSeconds < entry.bestTime) {
        entry.bestTime = elapsedSeconds;
        isNewBest = true;
      }
      if (entry.bestMoves == null || moves < entry.bestMoves) {
        entry.bestMoves = moves;
      }
      data.career[difficulty] = entry;
      saveAll(data);
      return isNewBest;
    } catch (e) {
      return false;
    }
  }

  // -- settings -------------------------------------------------------------
  function getSettings() {
    try {
      return loadAll().settings;
    } catch (e) {
      return defaultData().settings;
    }
  }
  function saveSettings(partial) {
    try {
      const data = loadAll();
      data.settings = Object.assign(data.settings, partial);
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }

  return {
    DIFFICULTIES,
    loadCurrentGame,
    saveCurrentGame,
    clearCurrentGame,
    appendHistoryEntry,
    getHistory,
    getCareer,
    updateCareer,
    getSettings,
    saveSettings,
  };
})();

if (typeof window !== "undefined") {
  window.KlotskiStorage = KlotskiStorage;
}

// ---------------------------------------------------------------------------
// SokobanStorage — same shape again, for 推箱子 (Sokoban). Career tracks
// fewest moves to solve + fastest time. Namespaced under games.sokoban.
// ---------------------------------------------------------------------------
var SokobanStorage = (function () {
  const DIFFICULTIES = ["easy", "medium", "hard", "expert"];

  function defaultCareerEntry() {
    return { bestMoves: null, bestTime: null, won: 0 };
  }

  function defaultData() {
    const career = {};
    for (const d of DIFFICULTIES) career[d] = defaultCareerEntry();
    return {
      currentGame: null,
      history: [],
      career,
      settings: { soundEnabled: true },
    };
  }

  function mergeDefaults(data) {
    const merged = defaultData();
    if (!data || typeof data !== "object") return merged;
    if (data.currentGame && typeof data.currentGame === "object") {
      merged.currentGame = data.currentGame;
    }
    if (Array.isArray(data.history)) merged.history = data.history;
    if (data.career && typeof data.career === "object") {
      for (const d of DIFFICULTIES) {
        merged.career[d] = Object.assign(defaultCareerEntry(), data.career[d] || {});
      }
    }
    if (data.settings && typeof data.settings === "object") {
      merged.settings.soundEnabled =
        data.settings.soundEnabled != null ? !!data.settings.soundEnabled : true;
    }
    return merged;
  }

  const gameStore = GameHubStorage.forGame("sokoban", { defaultData });

  function loadAll() {
    try {
      return mergeDefaults(gameStore.loadGameData());
    } catch (e) {
      return defaultData();
    }
  }

  function saveAll(data) {
    try {
      gameStore.saveGameData(data);
    } catch (e) {
      /* no-op */
    }
  }

  // -- current game -----------------------------------------------------
  function loadCurrentGame() {
    try {
      return loadAll().currentGame;
    } catch (e) {
      return null;
    }
  }
  function saveCurrentGame(stateDict) {
    try {
      const data = loadAll();
      data.currentGame = stateDict;
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }
  function clearCurrentGame() {
    try {
      const data = loadAll();
      data.currentGame = null;
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }

  // -- history ------------------------------------------------------------
  function appendHistoryEntry(entry) {
    try {
      const data = loadAll();
      data.history.unshift(entry);
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }
  function getHistory() {
    try {
      return loadAll().history;
    } catch (e) {
      return [];
    }
  }

  // -- career ---------------------------------------------------------------
  function getCareer() {
    try {
      return loadAll().career;
    } catch (e) {
      return defaultData().career;
    }
  }
  function updateCareer(difficulty, elapsedSeconds, moves) {
    try {
      const data = loadAll();
      const entry = Object.assign(defaultCareerEntry(), data.career[difficulty] || {});
      entry.won += 1;
      let isNewBest = false;
      if (entry.bestTime == null || elapsedSeconds < entry.bestTime) {
        entry.bestTime = elapsedSeconds;
        isNewBest = true;
      }
      if (entry.bestMoves == null || moves < entry.bestMoves) {
        entry.bestMoves = moves;
      }
      data.career[difficulty] = entry;
      saveAll(data);
      return isNewBest;
    } catch (e) {
      return false;
    }
  }

  // -- settings -------------------------------------------------------------
  function getSettings() {
    try {
      return loadAll().settings;
    } catch (e) {
      return defaultData().settings;
    }
  }
  function saveSettings(partial) {
    try {
      const data = loadAll();
      data.settings = Object.assign(data.settings, partial);
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }

  return {
    DIFFICULTIES,
    loadCurrentGame,
    saveCurrentGame,
    clearCurrentGame,
    appendHistoryEntry,
    getHistory,
    getCareer,
    updateCareer,
    getSettings,
    saveSettings,
  };
})();

if (typeof window !== "undefined") {
  window.SokobanStorage = SokobanStorage;
}

// ---------------------------------------------------------------------------
// FifteenStorage — same shape again, for 15 數字推盤 (Fifteen Puzzle).
// Career tracks fewest moves to solve + fastest time. Namespaced under
// games.fifteenPuzzle.
// ---------------------------------------------------------------------------
var FifteenStorage = (function () {
  const DIFFICULTIES = ["superEasy", "easy", "medium", "hard", "expert"];

  function defaultCareerEntry() {
    return { bestMoves: null, bestTime: null, won: 0 };
  }

  function defaultData() {
    const career = {};
    for (const d of DIFFICULTIES) career[d] = defaultCareerEntry();
    return {
      currentGame: null,
      history: [],
      career,
      settings: { superEasyPercent: 30, soundEnabled: true },
    };
  }

  function mergeDefaults(data) {
    const merged = defaultData();
    if (!data || typeof data !== "object") return merged;
    if (data.currentGame && typeof data.currentGame === "object") {
      merged.currentGame = data.currentGame;
    }
    if (Array.isArray(data.history)) merged.history = data.history;
    if (data.career && typeof data.career === "object") {
      for (const d of DIFFICULTIES) {
        merged.career[d] = Object.assign(defaultCareerEntry(), data.career[d] || {});
      }
    }
    if (data.settings && typeof data.settings === "object") {
      merged.settings.superEasyPercent = data.settings.superEasyPercent || 30;
      merged.settings.soundEnabled =
        data.settings.soundEnabled != null ? !!data.settings.soundEnabled : true;
    }
    return merged;
  }

  const gameStore = GameHubStorage.forGame("fifteenPuzzle", { defaultData });

  function loadAll() {
    try {
      return mergeDefaults(gameStore.loadGameData());
    } catch (e) {
      return defaultData();
    }
  }

  function saveAll(data) {
    try {
      gameStore.saveGameData(data);
    } catch (e) {
      /* no-op */
    }
  }

  // -- current game -----------------------------------------------------
  function loadCurrentGame() {
    try {
      return loadAll().currentGame;
    } catch (e) {
      return null;
    }
  }
  function saveCurrentGame(stateDict) {
    try {
      const data = loadAll();
      data.currentGame = stateDict;
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }
  function clearCurrentGame() {
    try {
      const data = loadAll();
      data.currentGame = null;
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }

  // -- history ------------------------------------------------------------
  function appendHistoryEntry(entry) {
    try {
      const data = loadAll();
      data.history.unshift(entry);
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }
  function getHistory() {
    try {
      return loadAll().history;
    } catch (e) {
      return [];
    }
  }

  // -- career ---------------------------------------------------------------
  function getCareer() {
    try {
      return loadAll().career;
    } catch (e) {
      return defaultData().career;
    }
  }
  function updateCareer(difficulty, elapsedSeconds, moves) {
    try {
      const data = loadAll();
      const entry = Object.assign(defaultCareerEntry(), data.career[difficulty] || {});
      entry.won += 1;
      let isNewBest = false;
      if (entry.bestTime == null || elapsedSeconds < entry.bestTime) {
        entry.bestTime = elapsedSeconds;
        isNewBest = true;
      }
      if (entry.bestMoves == null || moves < entry.bestMoves) {
        entry.bestMoves = moves;
      }
      data.career[difficulty] = entry;
      saveAll(data);
      return isNewBest;
    } catch (e) {
      return false;
    }
  }

  // -- settings -------------------------------------------------------------
  function getSettings() {
    try {
      return loadAll().settings;
    } catch (e) {
      return defaultData().settings;
    }
  }
  function saveSettings(partial) {
    try {
      const data = loadAll();
      data.settings = Object.assign(data.settings, partial);
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }

  return {
    DIFFICULTIES,
    loadCurrentGame,
    saveCurrentGame,
    clearCurrentGame,
    appendHistoryEntry,
    getHistory,
    getCareer,
    updateCareer,
    getSettings,
    saveSettings,
  };
})();

if (typeof window !== "undefined") {
  window.FifteenStorage = FifteenStorage;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    GameHubStorage,
    SudokuStorage,
    MemoryStorage,
    GuessStorage,
    BreakoutStorage,
    KlotskiStorage,
    SokobanStorage,
    FifteenStorage,
  };
}
