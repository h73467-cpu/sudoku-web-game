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
    return { theme: "blue_light", games: {}, favorites: [] };
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
      if (!Array.isArray(parsed.favorites)) parsed.favorites = [];
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

  // Home-page "我的最愛" favorites — a flat array of game ids, stored at the
  // root (not per-game) since it's about the hub's own home page, not any
  // individual game's own data.
  function getFavorites() {
    try {
      const favorites = loadRoot().favorites;
      return Array.isArray(favorites) ? favorites : [];
    } catch (e) {
      return [];
    }
  }

  function isFavorite(gameId) {
    return getFavorites().indexOf(gameId) !== -1;
  }

  function toggleFavorite(gameId) {
    try {
      const root = loadRoot();
      if (!Array.isArray(root.favorites)) root.favorites = [];
      const idx = root.favorites.indexOf(gameId);
      if (idx === -1) root.favorites.push(gameId);
      else root.favorites.splice(idx, 1);
      saveRoot(root);
      return idx === -1;
    } catch (e) {
      return false;
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

  return { forGame, getTheme, setTheme, getFavorites, isFavorite, toggleFavorite, safeGet, safeSet };
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

// ---------------------------------------------------------------------------
// NonogramStorage — same shape again, for 數織 (Nonogram). Career tracks
// fewest moves to solve + fastest time. Namespaced under games.nonogram.
// ---------------------------------------------------------------------------
var NonogramStorage = (function () {
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

  const gameStore = GameHubStorage.forGame("nonogram", { defaultData });

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
  window.NonogramStorage = NonogramStorage;
}

// ---------------------------------------------------------------------------
// JigsawStorage — same shape again, for 拼圖 (Jigsaw). Career tracks fewest
// swaps to solve + fastest time. No 超簡單 tier (see project memory — piece
// count has no meaningful continuous axis to tune at the small end), so
// DIFFICULTIES mirrors SokobanStorage's rather than the percent-slider
// games'. Namespaced under games.jigsaw.
// ---------------------------------------------------------------------------
var JigsawStorage = (function () {
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

  const gameStore = GameHubStorage.forGame("jigsaw", { defaultData });

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
  window.JigsawStorage = JigsawStorage;
}

// ---------------------------------------------------------------------------
// ConnectFourStorage — shaped differently from every other game's storage
// module on purpose: 四子棋 is a two-player adversarial game, not a solo
// puzzle, so "bestTime/bestMoves" doesn't mean anything here. Career is
// split into `ai` (win/loss/draw per AI difficulty) and `local` (a simple
// red/yellow/draw tally for two people sharing one device — there's no
// "your" record to keep since either player could be either color).
// Namespaced under games.connectFour.
// ---------------------------------------------------------------------------
var ConnectFourStorage = (function () {
  const AI_DIFFICULTIES = ["easy", "medium", "hard", "expert"];

  function defaultAiCareerEntry() {
    return { wins: 0, losses: 0, draws: 0 };
  }

  function defaultData() {
    const ai = {};
    for (const d of AI_DIFFICULTIES) ai[d] = defaultAiCareerEntry();
    return {
      currentGame: null,
      history: [],
      career: {
        ai,
        local: { redWins: 0, yellowWins: 0, draws: 0, gamesPlayed: 0 },
      },
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
      if (data.career.ai && typeof data.career.ai === "object") {
        for (const d of AI_DIFFICULTIES) {
          merged.career.ai[d] = Object.assign(defaultAiCareerEntry(), data.career.ai[d] || {});
        }
      }
      if (data.career.local && typeof data.career.local === "object") {
        merged.career.local = Object.assign(merged.career.local, data.career.local);
      }
    }
    if (data.settings && typeof data.settings === "object") {
      merged.settings.soundEnabled =
        data.settings.soundEnabled != null ? !!data.settings.soundEnabled : true;
    }
    return merged;
  }

  const gameStore = GameHubStorage.forGame("connectFour", { defaultData });

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
  // result: "win" | "loss" | "draw" (from the human player's perspective).
  function updateAiCareer(difficulty, result) {
    try {
      const data = loadAll();
      const entry = Object.assign(defaultAiCareerEntry(), data.career.ai[difficulty] || {});
      if (result === "win") entry.wins += 1;
      else if (result === "loss") entry.losses += 1;
      else entry.draws += 1;
      data.career.ai[difficulty] = entry;
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }
  // winner: 1 (red) | 2 (yellow) | null (draw).
  function updateLocalCareer(winner) {
    try {
      const data = loadAll();
      const local = Object.assign({ redWins: 0, yellowWins: 0, draws: 0, gamesPlayed: 0 }, data.career.local);
      local.gamesPlayed += 1;
      if (winner === 1) local.redWins += 1;
      else if (winner === 2) local.yellowWins += 1;
      else local.draws += 1;
      data.career.local = local;
      saveAll(data);
    } catch (e) {
      /* no-op */
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
    AI_DIFFICULTIES,
    loadCurrentGame,
    saveCurrentGame,
    clearCurrentGame,
    appendHistoryEntry,
    getHistory,
    getCareer,
    updateAiCareer,
    updateLocalCareer,
    getSettings,
    saveSettings,
  };
})();

if (typeof window !== "undefined") {
  window.ConnectFourStorage = ConnectFourStorage;
}

// ---------------------------------------------------------------------------
// OthelloStorage — same shape as ConnectFourStorage (the other adversarial
// two-player game in this hub): win/loss/draw per AI difficulty, plus a
// black/white/draw tally for local mode. Namespaced under games.othello.
// ---------------------------------------------------------------------------
var OthelloStorage = (function () {
  const AI_DIFFICULTIES = ["easy", "medium", "hard", "expert"];

  function defaultAiCareerEntry() {
    return { wins: 0, losses: 0, draws: 0 };
  }

  function defaultData() {
    const ai = {};
    for (const d of AI_DIFFICULTIES) ai[d] = defaultAiCareerEntry();
    return {
      currentGame: null,
      history: [],
      career: {
        ai,
        local: { blackWins: 0, whiteWins: 0, draws: 0, gamesPlayed: 0 },
      },
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
      if (data.career.ai && typeof data.career.ai === "object") {
        for (const d of AI_DIFFICULTIES) {
          merged.career.ai[d] = Object.assign(defaultAiCareerEntry(), data.career.ai[d] || {});
        }
      }
      if (data.career.local && typeof data.career.local === "object") {
        merged.career.local = Object.assign(merged.career.local, data.career.local);
      }
    }
    if (data.settings && typeof data.settings === "object") {
      merged.settings.soundEnabled =
        data.settings.soundEnabled != null ? !!data.settings.soundEnabled : true;
    }
    return merged;
  }

  const gameStore = GameHubStorage.forGame("othello", { defaultData });

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
  // result: "win" | "loss" | "draw" (from the human player's perspective).
  function updateAiCareer(difficulty, result) {
    try {
      const data = loadAll();
      const entry = Object.assign(defaultAiCareerEntry(), data.career.ai[difficulty] || {});
      if (result === "win") entry.wins += 1;
      else if (result === "loss") entry.losses += 1;
      else entry.draws += 1;
      data.career.ai[difficulty] = entry;
      saveAll(data);
    } catch (e) {
      /* no-op */
    }
  }
  // winner: 1 (black) | 2 (white) | null (draw).
  function updateLocalCareer(winner) {
    try {
      const data = loadAll();
      const local = Object.assign({ blackWins: 0, whiteWins: 0, draws: 0, gamesPlayed: 0 }, data.career.local);
      local.gamesPlayed += 1;
      if (winner === 1) local.blackWins += 1;
      else if (winner === 2) local.whiteWins += 1;
      else local.draws += 1;
      data.career.local = local;
      saveAll(data);
    } catch (e) {
      /* no-op */
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
    AI_DIFFICULTIES,
    loadCurrentGame,
    saveCurrentGame,
    clearCurrentGame,
    appendHistoryEntry,
    getHistory,
    getCareer,
    updateAiCareer,
    updateLocalCareer,
    getSettings,
    saveSettings,
  };
})();

if (typeof window !== "undefined") {
  window.OthelloStorage = OthelloStorage;
}

// ---------------------------------------------------------------------------
// LianliankanStorage — back to the solo-puzzle bestTime/bestMoves/won shape
// (same as JigsawStorage/FifteenStorage) since 連連看 is single-player, not
// adversarial. No 超簡單 tier (grid size is the only difficulty axis, same
// resolution as jigsaw). Namespaced under games.lianliankan.
// ---------------------------------------------------------------------------
var LianliankanStorage = (function () {
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

  const gameStore = GameHubStorage.forGame("lianliankan", { defaultData });

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
  window.LianliankanStorage = LianliankanStorage;
}

// ---------------------------------------------------------------------------
// MinesweeperStorage — solo puzzle again, but career only tracks
// bestTime/won (no bestMoves — "how many cells did you reveal" isn't a
// meaningful skill metric the way move-count is for the other games; time
// is what actually matters for Minesweeper). Has a 超簡單 tier (fixed small
// board + percent-tunable mine count, same pattern as nonogram) since mine
// density is a genuine second difficulty axis here, unlike jigsaw/
// lianliankan/sokoban where no such axis exists. Namespaced under
// games.minesweeper.
// ---------------------------------------------------------------------------
var MinesweeperStorage = (function () {
  const DIFFICULTIES = ["superEasy", "easy", "medium", "hard", "expert"];

  function defaultCareerEntry() {
    return { bestTime: null, won: 0 };
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

  const gameStore = GameHubStorage.forGame("minesweeper", { defaultData });

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
  function updateCareer(difficulty, elapsedSeconds) {
    try {
      const data = loadAll();
      const entry = Object.assign(defaultCareerEntry(), data.career[difficulty] || {});
      entry.won += 1;
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
  window.MinesweeperStorage = MinesweeperStorage;
}

// ---------------------------------------------------------------------------
// Game2048Storage — score-driven career shape (bestScore/bestTile/won/runs),
// same idea as BreakoutStorage rather than the time-driven bestTime shape
// most other games use: "how fast" barely matters in 2048, "how high a
// score/tile did you reach" is what's actually worth bragging about. No
// 超簡單 tier — board size is already the (inverted-direction) difficulty
// knob here, see project memory. Namespaced under games.game2048.
// ---------------------------------------------------------------------------
var Game2048Storage = (function () {
  const DIFFICULTIES = ["easy", "medium", "hard", "expert"];

  function defaultCareerEntry() {
    return { bestScore: null, bestTile: null, won: 0, runs: 0 };
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

  const gameStore = GameHubStorage.forGame("game2048", { defaultData });

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
  function updateCareer(difficulty, score, tile, won) {
    try {
      const data = loadAll();
      const entry = Object.assign(defaultCareerEntry(), data.career[difficulty] || {});
      entry.runs += 1;
      if (won) entry.won += 1;
      let isNewBest = false;
      if (entry.bestScore == null || score > entry.bestScore) {
        entry.bestScore = score;
        isNewBest = true;
      }
      if (entry.bestTile == null || tile > entry.bestTile) {
        entry.bestTile = tile;
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
  window.Game2048Storage = Game2048Storage;
}

// ---------------------------------------------------------------------------
// MazeStorage — same solo-puzzle shape as FifteenStorage (bestTime/bestMoves/
// won), for 迷宮遊戲 (Maze). Difficulty is grid size only (no superEasy tier —
// there's no independent second axis to vary, same resolution as jigsaw/
// lianliankan/connectFour/othello/game2048). Namespaced under games.maze.
// ---------------------------------------------------------------------------
var MazeStorage = (function () {
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

  const gameStore = GameHubStorage.forGame("maze", { defaultData });

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
  window.MazeStorage = MazeStorage;
}

// ---------------------------------------------------------------------------
// WordGameStorage — for 拼字遊戲 (word game). Career is time+score driven
// (`{bestTime,bestScore,won}`, mirrors FifteenStorage/MazeStorage's shape but
// with score standing in for moves, since "how many/how long the words
// spelled" is the meaningful skill metric here, not a move count). Five
// difficulty tiers including `superEasy` (vowel-density knob, not a smaller
// board — there's no board here at all). Namespaced under games.wordGame.
// ---------------------------------------------------------------------------
var WordGameStorage = (function () {
  const DIFFICULTIES = ["superEasy", "easy", "medium", "hard", "expert"];

  function defaultCareerEntry() {
    return { bestTime: null, bestScore: null, won: 0 };
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

  const gameStore = GameHubStorage.forGame("wordGame", { defaultData });

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
  function updateCareer(difficulty, elapsedSeconds, score) {
    try {
      const data = loadAll();
      const entry = Object.assign(defaultCareerEntry(), data.career[difficulty] || {});
      entry.won += 1;
      let isNewBest = false;
      if (entry.bestTime == null || elapsedSeconds < entry.bestTime) {
        entry.bestTime = elapsedSeconds;
        isNewBest = true;
      }
      if (entry.bestScore == null || score > entry.bestScore) {
        entry.bestScore = score;
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
  window.WordGameStorage = WordGameStorage;
}

// ---------------------------------------------------------------------------
// ShellGameStorage — for 三個杯子 (Shell Game). No difficulty tiers at all
// (the user explicitly didn't want a picker — the game is one endless run
// that self-paces via level-based speed ramp), so this is the simplest
// storage module in the hub: a single flat career blob instead of one
// entry per difficulty, and no currentGame (a shuffle round isn't
// meaningfully resumable across a reload, same reasoning as breakout).
// Namespaced under games.shellGame.
// ---------------------------------------------------------------------------
var ShellGameStorage = (function () {
  function defaultData() {
    return {
      history: [],
      career: { bestLevel: 0, bestStreak: 0, runs: 0 },
      settings: { soundEnabled: true, startDurationMs: 650 },
    };
  }

  function mergeDefaults(data) {
    const merged = defaultData();
    if (!data || typeof data !== "object") return merged;
    if (Array.isArray(data.history)) merged.history = data.history;
    if (data.career && typeof data.career === "object") {
      merged.career = Object.assign(merged.career, data.career);
    }
    if (data.settings && typeof data.settings === "object") {
      merged.settings.soundEnabled =
        data.settings.soundEnabled != null ? !!data.settings.soundEnabled : true;
      merged.settings.startDurationMs = data.settings.startDurationMs || 650;
    }
    return merged;
  }

  const gameStore = GameHubStorage.forGame("shellGame", { defaultData });

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

  function getCareer() {
    try {
      return loadAll().career;
    } catch (e) {
      return defaultData().career;
    }
  }
  function recordRun(levelReached, longestStreak) {
    try {
      const data = loadAll();
      const career = Object.assign(defaultData().career, data.career);
      career.runs += 1;
      let isNewBestLevel = false;
      let isNewBestStreak = false;
      if (levelReached > career.bestLevel) {
        career.bestLevel = levelReached;
        isNewBestLevel = true;
      }
      if (longestStreak > career.bestStreak) {
        career.bestStreak = longestStreak;
        isNewBestStreak = true;
      }
      data.career = career;
      saveAll(data);
      return { isNewBestLevel, isNewBestStreak };
    } catch (e) {
      return { isNewBestLevel: false, isNewBestStreak: false };
    }
  }

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
    appendHistoryEntry,
    getHistory,
    getCareer,
    recordRun,
    getSettings,
    saveSettings,
  };
})();

if (typeof window !== "undefined") {
  window.ShellGameStorage = ShellGameStorage;
}

// ---------------------------------------------------------------------------
// FrogStorage — same endless-run shape as BreakoutStorage (career tracks
// best score + highest level reached + run count per starting difficulty,
// no "won", history logs every finished run), for 青蛙過河 (Frogger).
// Namespaced under games.frogger.
// ---------------------------------------------------------------------------
var FrogStorage = (function () {
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

  const gameStore = GameHubStorage.forGame("frogger", { defaultData });

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

  // -- current game (unused today, kept for API symmetry with the rest of
  // the hub, same reasoning as BreakoutStorage) ------------------------
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
  window.FrogStorage = FrogStorage;
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
    NonogramStorage,
    JigsawStorage,
    ConnectFourStorage,
    OthelloStorage,
    LianliankanStorage,
    MinesweeperStorage,
    Game2048Storage,
    MazeStorage,
    WordGameStorage,
    ShellGameStorage,
    FrogStorage,
  };
}
