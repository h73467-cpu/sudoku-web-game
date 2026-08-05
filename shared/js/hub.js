// Game-hub home page wiring: renders GAMES as cards and drives the global
// theme picker shared by the hub and any game that opts into it.
(function () {
  const gameGrid = document.getElementById("gameGrid");
  const themeSelect = document.getElementById("themeSelect");

  function applyTheme(themeKey) {
    document.documentElement.dataset.theme = themeKey;
  }

  function renderGames() {
    gameGrid.innerHTML = "";
    const frag = document.createDocumentFragment();
    GAMES.forEach((game) => {
      const ready = game.status === "ready";
      const el = document.createElement(ready ? "a" : "div");
      el.className = "game-card" + (ready ? "" : " planned");
      if (ready) el.href = game.path;
      el.innerHTML =
        `<span class="game-card-icon">${game.icon}</span>` +
        `<span class="game-card-title">${game.title}</span>` +
        (ready ? "" : '<span class="game-card-badge">即將推出</span>');
      frag.appendChild(el);
    });
    gameGrid.appendChild(frag);
  }

  themeSelect.addEventListener("change", () => {
    const theme = themeSelect.value;
    applyTheme(theme);
    GameHubStorage.setTheme(theme);
  });

  applyTheme(GameHubStorage.getTheme());
  themeSelect.value = GameHubStorage.getTheme();
  renderGames();
})();
