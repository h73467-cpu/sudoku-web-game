// Game-hub home page wiring: renders GAMES as cards (plus an optional
// "我的最愛" pinned section) and drives the global theme picker shared by
// the hub and any game that opts into it.
(function () {
  const gameGrid = document.getElementById("gameGrid");
  const favoritesTitle = document.getElementById("favoritesTitle");
  const favoritesGrid = document.getElementById("favoritesGrid");
  const themeSelect = document.getElementById("themeSelect");

  function applyTheme(themeKey) {
    document.documentElement.dataset.theme = themeKey;
  }

  // Star button is a sibling overlay on the card, not a nested <a>/<button>
  // inside the link element (invalid HTML + awkward click handling) — click
  // stops propagation so tapping the star never navigates into the game.
  function buildCard(game) {
    const ready = game.status === "ready";
    const el = document.createElement(ready ? "a" : "div");
    el.className = "game-card" + (ready ? "" : " planned");
    if (ready) el.href = game.path;
    el.innerHTML =
      `<span class="game-card-icon">${game.icon}</span>` +
      `<span class="game-card-title">${game.title}</span>` +
      (ready ? "" : '<span class="game-card-badge">即將推出</span>');

    if (ready) {
      const star = document.createElement("button");
      star.type = "button";
      star.className = "favorite-star";
      const applyStarState = () => {
        const fav = GameHubStorage.isFavorite(game.id);
        star.textContent = fav ? "★" : "☆";
        star.classList.toggle("active", fav);
        star.setAttribute("aria-label", fav ? "取消最愛" : "加入最愛");
      };
      applyStarState();
      star.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        GameHubStorage.toggleFavorite(game.id);
        applyStarState();
        renderGames();
      });
      el.appendChild(star);
    }

    return el;
  }

  function renderGames() {
    const favoriteIds = new Set(GameHubStorage.getFavorites());
    const favoriteGames = GAMES.filter((g) => g.status === "ready" && favoriteIds.has(g.id));

    if (favoriteGames.length > 0) {
      favoritesTitle.classList.remove("hidden");
      favoritesGrid.classList.remove("hidden");
      favoritesGrid.innerHTML = "";
      const favFrag = document.createDocumentFragment();
      favoriteGames.forEach((game) => favFrag.appendChild(buildCard(game)));
      favoritesGrid.appendChild(favFrag);
    } else {
      favoritesTitle.classList.add("hidden");
      favoritesGrid.classList.add("hidden");
    }

    gameGrid.innerHTML = "";
    const frag = document.createDocumentFragment();
    GAMES.forEach((game) => frag.appendChild(buildCard(game)));
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
