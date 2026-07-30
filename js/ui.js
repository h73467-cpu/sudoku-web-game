// The only file that touches the DOM. Renders state -> DOM and wires events.
(function () {
  const boardEl = document.getElementById("board");
  const numpadEl = document.getElementById("numpad");
  const difficultySelect = document.getElementById("difficultySelect");
  const newGameBtn = document.getElementById("newGameBtn");
  const notesToggleBtn = document.getElementById("notesToggleBtn");
  const hintBtn = document.getElementById("hintBtn");
  const hintCountEl = document.getElementById("hintCount");
  const timerDisplay = document.getElementById("timerDisplay");
  const bestTimeDisplay = document.getElementById("bestTimeDisplay");
  const winModal = document.getElementById("winModal");
  const winMessage = document.getElementById("winMessage");
  const winCloseBtn = document.getElementById("winCloseBtn");

  function isPeer(selIdx, idx) {
    if (selIdx == null || selIdx === idx) return false;
    return (
      Sudoku.rowOf(selIdx) === Sudoku.rowOf(idx) ||
      Sudoku.colOf(selIdx) === Sudoku.colOf(idx) ||
      Sudoku.boxOf(selIdx) === Sudoku.boxOf(idx)
    );
  }

  function cellClasses(cell, state) {
    const classes = ["cell"];
    if (cell.given) classes.push("given");
    if (cell.hinted) classes.push("hinted");
    const row = Math.floor(cell.index / 9);
    if (row % 3 === 2 && row !== 8) classes.push("box-bottom");
    if (state.selectedIndex === cell.index) classes.push("selected");
    else if (isPeer(state.selectedIndex, cell.index)) classes.push("peer");
    if (cell.conflict) classes.push("conflict");
    else if (cell.value !== 0 && cell.value !== state.solution[cell.index])
      classes.push("wrong");
    return classes.join(" ");
  }

  function cellContent(cell) {
    if (cell.value !== 0) {
      return "<span>" + cell.value + "</span>";
    }
    if (cell.notes.size > 0) {
      let html = '<div class="notes-grid">';
      for (let d = 1; d <= 9; d++) {
        html += "<span>" + (cell.notes.has(d) ? d : "") + "</span>";
      }
      html += "</div>";
      return html;
    }
    return "";
  }

  function renderBoard(state) {
    const frag = document.createDocumentFragment();
    state.cells.forEach((cell) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.index = String(cell.index);
      btn.className = cellClasses(cell, state);
      btn.innerHTML = cellContent(cell);
      frag.appendChild(btn);
    });
    boardEl.innerHTML = "";
    boardEl.appendChild(frag);
  }

  function renderToolbar(state) {
    timerDisplay.textContent = SudokuGame.formatTime(
      SudokuGame.getElapsedMs()
    );
    bestTimeDisplay.textContent = SudokuGame.formatTime(
      SudokuGame.getBestTime(state.difficulty)
    );
    const remaining = state.maxHints - state.hintsUsed;
    hintCountEl.textContent = String(remaining);
    hintBtn.disabled = remaining <= 0 || state.status !== "playing";
    notesToggleBtn.setAttribute(
      "aria-pressed",
      state.notesMode ? "true" : "false"
    );
    if (difficultySelect.value !== state.difficulty) {
      difficultySelect.value = state.difficulty;
    }
  }

  function renderWinModal(state) {
    if (state.status === "won") {
      const time = SudokuGame.formatTime(state.elapsedMs);
      const isNewBest = state.justWon && state.justWon.isNewBest;
      winMessage.textContent =
        "花費時間 " +
        time +
        (isNewBest ? "（新紀錄！）" : "") +
        "，使用提示 " +
        state.hintsUsed +
        " 次";
      winModal.classList.remove("hidden");
    } else {
      winModal.classList.add("hidden");
    }
  }

  function render(state, event) {
    if (!state) return;
    if (event !== "tick") {
      renderBoard(state);
    }
    renderToolbar(state);
    renderWinModal(state);
  }

  function moveSelection(key, idx) {
    let row = Math.floor(idx / 9);
    let col = idx % 9;
    if (key === "ArrowUp") row = Math.max(0, row - 1);
    if (key === "ArrowDown") row = Math.min(8, row + 1);
    if (key === "ArrowLeft") col = Math.max(0, col - 1);
    if (key === "ArrowRight") col = Math.min(8, col + 1);
    SudokuGame.selectCell(row * 9 + col);
  }

  boardEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".cell");
    if (!btn) return;
    SudokuGame.selectCell(Number(btn.dataset.index));
  });

  numpadEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".num-btn");
    if (!btn) return;
    const state = SudokuGame.getState();
    if (!state || state.selectedIndex == null) return;
    SudokuGame.setValue(state.selectedIndex, Number(btn.dataset.digit));
  });

  newGameBtn.addEventListener("click", () => {
    if (
      SudokuGame.hasProgress() &&
      !confirm("目前遊戲進行中，確定要開始新遊戲嗎？進度將會遺失。")
    ) {
      return;
    }
    SudokuGame.newGame(difficultySelect.value);
  });

  difficultySelect.addEventListener("change", (e) => {
    const newDifficulty = e.target.value;
    const state = SudokuGame.getState();
    if (SudokuGame.hasProgress()) {
      if (!confirm("切換難度將開始新遊戲，確定嗎？")) {
        e.target.value = state.difficulty;
        return;
      }
    }
    SudokuGame.newGame(newDifficulty);
  });

  notesToggleBtn.addEventListener("click", () => {
    SudokuGame.toggleNotesMode();
  });

  hintBtn.addEventListener("click", () => {
    SudokuGame.useHint();
  });

  winCloseBtn.addEventListener("click", () => {
    SudokuGame.newGame(difficultySelect.value);
  });

  document.addEventListener("keydown", (e) => {
    const state = SudokuGame.getState();
    if (!state || state.selectedIndex == null) return;
    if (e.key >= "1" && e.key <= "9") {
      SudokuGame.setValue(state.selectedIndex, Number(e.key));
    } else if (e.key === "Backspace" || e.key === "Delete") {
      SudokuGame.setValue(state.selectedIndex, 0);
    } else if (e.key.indexOf("Arrow") === 0) {
      e.preventDefault();
      moveSelection(e.key, state.selectedIndex);
    } else if (e.key === "n" || e.key === "N") {
      SudokuGame.toggleNotesMode();
    }
  });

  SudokuGame.onChange(render);
  SudokuGame.loadOrNew(difficultySelect.value);
})();
