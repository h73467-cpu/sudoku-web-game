// localStorage access: best times + in-progress saved game.
// All calls are wrapped in try/catch so private-browsing / disabled storage
// degrades gracefully instead of crashing the app.
window.SudokuStorage = (function () {
  const BEST_TIMES_KEY = "sudoku.bestTimes";
  const SAVED_GAME_KEY = "sudoku.savedGame";

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

  function safeRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      /* no-op */
    }
  }

  function getBestTimes() {
    const raw = safeGet(BEST_TIMES_KEY);
    const defaults = { easy: null, medium: null, hard: null, expert: null };
    if (!raw) return defaults;
    try {
      return Object.assign(defaults, JSON.parse(raw));
    } catch (e) {
      return defaults;
    }
  }

  function setBestTime(difficulty, ms) {
    const times = getBestTimes();
    if (times[difficulty] == null || ms < times[difficulty]) {
      times[difficulty] = ms;
      safeSet(BEST_TIMES_KEY, JSON.stringify(times));
      return true;
    }
    return false;
  }

  function saveGame(state) {
    try {
      safeSet(SAVED_GAME_KEY, JSON.stringify(state));
    } catch (e) {
      /* no-op */
    }
  }

  function loadGame() {
    const raw = safeGet(SAVED_GAME_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function clearSavedGame() {
    safeRemove(SAVED_GAME_KEY);
  }

  return {
    getBestTimes,
    setBestTime,
    saveGame,
    loadGame,
    clearSavedGame,
  };
})();
