// Sudoku core engine: pure logic, no DOM access.
window.Sudoku = (function () {
  const SIZE = 9;
  const BOX = 3;

  const DIFFICULTY_CLUES = {
    easy: { min: 40, max: 46 },
    medium: { min: 32, max: 39 },
    hard: { min: 28, max: 31 },
    expert: { min: 22, max: 27 },
  };

  function rowOf(i) { return Math.floor(i / SIZE); }
  function colOf(i) { return i % SIZE; }
  function boxOf(i) {
    const r = rowOf(i), c = colOf(i);
    return Math.floor(r / BOX) * BOX + Math.floor(c / BOX);
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function isValidPlacement(grid, pos, digit) {
    const r = rowOf(pos), c = colOf(pos), b = boxOf(pos);
    for (let i = 0; i < SIZE; i++) {
      if (grid[r * SIZE + i] === digit) return false;
      if (grid[i * SIZE + c] === digit) return false;
    }
    const br = Math.floor(r / BOX) * BOX, bc = Math.floor(c / BOX) * BOX;
    for (let dr = 0; dr < BOX; dr++) {
      for (let dc = 0; dc < BOX; dc++) {
        if (grid[(br + dr) * SIZE + (bc + dc)] === digit) return false;
      }
    }
    return true;
  }

  function fillCell(grid, pos) {
    if (pos === SIZE * SIZE) return true;
    if (grid[pos] !== 0) return fillCell(grid, pos + 1);
    const candidates = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const digit of candidates) {
      if (isValidPlacement(grid, pos, digit)) {
        grid[pos] = digit;
        if (fillCell(grid, pos + 1)) return true;
        grid[pos] = 0;
      }
    }
    return false;
  }

  function generateSolvedGrid() {
    let grid;
    let attempts = 0;
    do {
      grid = new Array(SIZE * SIZE).fill(0);
      attempts++;
    } while (!fillCell(grid, 0) && attempts < 10);
    return grid;
  }

  function findFirstEmpty(grid) {
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === 0) return i;
    }
    return -1;
  }

  function countSolutions(grid, limit) {
    limit = limit === undefined ? 2 : limit;
    const pos = findFirstEmpty(grid);
    if (pos === -1) return 1;
    let count = 0;
    for (let digit = 1; digit <= 9; digit++) {
      if (isValidPlacement(grid, pos, digit)) {
        grid[pos] = digit;
        count += countSolutions(grid, limit - count);
        grid[pos] = 0;
        if (count >= limit) break;
      }
    }
    return count;
  }

  function carvePuzzle(solvedGrid, targetClues) {
    const puzzle = solvedGrid.slice();
    const positions = shuffle(
      Array.from({ length: SIZE * SIZE }, (_, i) => i)
    );
    let clues = SIZE * SIZE;
    for (const pos of positions) {
      if (clues <= targetClues) break;
      // remove symmetric pair (pos and its 180-degree mirror) when possible
      const mirror = SIZE * SIZE - 1 - pos;
      if (puzzle[pos] === 0) continue;

      const backupA = puzzle[pos];
      const backupB = puzzle[mirror];
      puzzle[pos] = 0;
      if (mirror !== pos) puzzle[mirror] = 0;

      const test = puzzle.slice();
      if (countSolutions(test, 2) !== 1) {
        puzzle[pos] = backupA;
        puzzle[mirror] = backupB;
        continue;
      }
      clues -= mirror !== pos && backupB !== 0 ? 2 : 1;
    }
    return puzzle;
  }

  function pickTargetClues(difficulty) {
    const band = DIFFICULTY_CLUES[difficulty] || DIFFICULTY_CLUES.medium;
    return band.min + Math.floor(Math.random() * (band.max - band.min + 1));
  }

  function generatePuzzle(difficulty) {
    const solution = generateSolvedGrid();
    const targetClues = pickTargetClues(difficulty);
    const puzzle = carvePuzzle(solution, targetClues);
    return { puzzle, solution };
  }

  function computeConflicts(values) {
    // values: array of 81 numbers (0 = empty). Returns boolean[81].
    const conflict = new Array(SIZE * SIZE).fill(false);

    function markGroup(indices) {
      const seen = new Map();
      for (const idx of indices) {
        const v = values[idx];
        if (v === 0) continue;
        if (!seen.has(v)) seen.set(v, []);
        seen.get(v).push(idx);
      }
      for (const idxList of seen.values()) {
        if (idxList.length > 1) {
          for (const idx of idxList) conflict[idx] = true;
        }
      }
    }

    for (let r = 0; r < SIZE; r++) {
      const rowIdx = [];
      for (let c = 0; c < SIZE; c++) rowIdx.push(r * SIZE + c);
      markGroup(rowIdx);
    }
    for (let c = 0; c < SIZE; c++) {
      const colIdx = [];
      for (let r = 0; r < SIZE; r++) colIdx.push(r * SIZE + c);
      markGroup(colIdx);
    }
    for (let b = 0; b < SIZE; b++) {
      const br = Math.floor(b / BOX) * BOX, bc = (b % BOX) * BOX;
      const boxIdx = [];
      for (let dr = 0; dr < BOX; dr++) {
        for (let dc = 0; dc < BOX; dc++) {
          boxIdx.push((br + dr) * SIZE + (bc + dc));
        }
      }
      markGroup(boxIdx);
    }

    return conflict;
  }

  return {
    SIZE,
    BOX,
    DIFFICULTY_CLUES,
    rowOf,
    colOf,
    boxOf,
    generateSolvedGrid,
    countSolutions,
    carvePuzzle,
    generatePuzzle,
    computeConflicts,
  };
})();
