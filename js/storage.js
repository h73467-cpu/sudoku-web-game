// localStorage access: single JSON blob holding current game, play history,
// career stats, daily-challenge streak, and settings — mirrors the desktop
// Python app's storage.py shape (current_game/history/career/daily/settings)
// so behavior stays easy to reason about across both implementations, even
// though the web version doesn't need to read the Python app's actual file.
// All calls are wrapped in try/catch so private-browsing / disabled storage
// degrades gracefully instead of crashing the app.
var SudokuStorage = (function () {
  const DATA_KEY = "sudoku.data";
  const LEGACY_BEST_TIMES_KEY = "sudoku.bestTimes";
  const LEGACY_SAVED_GAME_KEY = "sudoku.savedGame";
  const DIFFICULTIES = ["superEasy", "easy", "medium", "hard", "expert"];

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

  // Best-effort one-time import from the old per-key format (pre-PRID-parity
  // web version) into the new single blob, so existing users don't lose their
  // best times / in-progress game just because the storage shape changed.
  function migrateLegacy() {
    const bestRaw = safeGet(LEGACY_BEST_TIMES_KEY);
    const savedRaw = safeGet(LEGACY_SAVED_GAME_KEY);
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

  function loadAll() {
    const raw = safeGet(DATA_KEY);
    if (!raw) {
      const migrated = migrateLegacy();
      return migrated || defaultData();
    }
    try {
      return mergeDefaults(JSON.parse(raw));
    } catch (e) {
      return defaultData();
    }
  }

  function saveAll(data) {
    try {
      safeSet(DATA_KEY, JSON.stringify(data));
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

  // Date-only diff via UTC midnight (DST-safe — local-time Date construction
  // can yield 0.958/1.042 "days" across a DST transition instead of exactly 1).
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
if (typeof module !== "undefined" && module.exports) {
  module.exports = SudokuStorage;
}
