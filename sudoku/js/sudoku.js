// Sudoku core engine: pure logic, no DOM access.
// Generation uses a real MRV (minimum-remaining-values) heuristic + backtracking
// (bitmask row/col/box candidate tracking), and difficulty for easy/medium/hard/
// expert is gated by logicalSolve()'s naked/hidden-single + locked-candidates
// technique-tier detection (tier 0/1/2), not just clue count. "superEasy" is the
// one difficulty defined purely by clue count (see superEasyClueRange) — it's
// meant for beginners and skips tier-gating entirely.
var Sudoku = (function () {
  var Rng =
    typeof window !== "undefined" && window.SudokuRng
      ? window.SudokuRng
      : typeof require !== "undefined"
      ? require("./rng.js")
      : null;

  const SIZE = 9;
  const BOX = 3;
  const FULL_MASK = 0b1111111110; // bits 1-9

  function rowOf(i) {
    return Math.floor(i / SIZE);
  }
  function colOf(i) {
    return i % SIZE;
  }
  function boxOf(i) {
    const r = rowOf(i),
      c = colOf(i);
    return Math.floor(r / BOX) * BOX + Math.floor(c / BOX);
  }

  function popcount(mask) {
    let count = 0;
    while (mask) {
      mask &= mask - 1;
      count++;
    }
    return count;
  }

  // -- unit tables (built once) --------------------------------------------
  const ROWS = [];
  const COLS = [];
  const BOXES = [];
  for (let r = 0; r < SIZE; r++) {
    const row = [];
    for (let c = 0; c < SIZE; c++) row.push(r * SIZE + c);
    ROWS.push(row);
  }
  for (let c = 0; c < SIZE; c++) {
    const col = [];
    for (let r = 0; r < SIZE; r++) col.push(r * SIZE + c);
    COLS.push(col);
  }
  for (let br = 0; br < BOX; br++) {
    for (let bc = 0; bc < BOX; bc++) {
      const box = [];
      for (let rr = 0; rr < BOX; rr++) {
        for (let cc = 0; cc < BOX; cc++) {
          box.push((br * BOX + rr) * SIZE + (bc * BOX + cc));
        }
      }
      BOXES.push(box);
    }
  }
  const UNITS = ROWS.concat(COLS, BOXES);
  const BOX_SETS = BOXES.map((b) => new Set(b));
  const ROW_SETS = ROWS.map((r) => new Set(r));
  const COL_SETS = COLS.map((c) => new Set(c));

  // -- MRV backtracking core, shared by full-grid generation and solution
  // counting. `rand` truthy => shuffle candidate digit order (varied random
  // full grids); `rand` falsy => ascending digit order (deterministic,
  // faster, used only for counting solutions).
  function* solutionsGen(grid, rowMask, colMask, boxMask, empty, rand) {
    if (empty.size === 0) {
      yield grid.slice();
      return;
    }

    let bestCell = -1;
    let bestCand = 0;
    let bestCount = 10;
    for (const idx of empty) {
      const r = rowOf(idx),
        c = colOf(idx),
        b = boxOf(idx);
      const cand = FULL_MASK & ~(rowMask[r] | colMask[c] | boxMask[b]);
      if (cand === 0) return; // dead branch
      const cnt = popcount(cand);
      if (cnt < bestCount) {
        bestCount = cnt;
        bestCell = idx;
        bestCand = cand;
        if (cnt === 1) break;
      }
    }

    const r = rowOf(bestCell),
      c = colOf(bestCell),
      b = boxOf(bestCell);
    const digits = [];
    for (let d = 1; d <= 9; d++) {
      if (bestCand & (1 << d)) digits.push(d);
    }
    if (rand) Rng.shuffleWith(digits, rand);

    empty.delete(bestCell);
    for (const d of digits) {
      const bit = 1 << d;
      grid[bestCell] = d;
      rowMask[r] |= bit;
      colMask[c] |= bit;
      boxMask[b] |= bit;

      yield* solutionsGen(grid, rowMask, colMask, boxMask, empty, rand);

      grid[bestCell] = 0;
      rowMask[r] &= ~bit;
      colMask[c] &= ~bit;
      boxMask[b] &= ~bit;
    }
    empty.add(bestCell);
  }

  function generateSolvedGrid(rand) {
    const useRand = rand || Math.random;
    const grid = new Array(SIZE * SIZE).fill(0);
    const rowMask = new Array(SIZE).fill(0);
    const colMask = new Array(SIZE).fill(0);
    const boxMask = new Array(SIZE).fill(0);
    const empty = new Set();
    for (let i = 0; i < SIZE * SIZE; i++) empty.add(i);
    const gen = solutionsGen(grid, rowMask, colMask, boxMask, empty, useRand);
    return gen.next().value;
  }

  function countSolutions(grid, limit) {
    limit = limit === undefined ? 2 : limit;
    const g = grid.slice();
    const rowMask = new Array(SIZE).fill(0);
    const colMask = new Array(SIZE).fill(0);
    const boxMask = new Array(SIZE).fill(0);
    const empty = new Set();
    for (let idx = 0; idx < SIZE * SIZE; idx++) {
      const v = g[idx];
      if (v === 0) {
        empty.add(idx);
        continue;
      }
      const r = rowOf(idx),
        c = colOf(idx),
        b = boxOf(idx);
      const bit = 1 << v;
      if (rowMask[r] & bit || colMask[c] & bit || boxMask[b] & bit) return 0;
      rowMask[r] |= bit;
      colMask[c] |= bit;
      boxMask[b] |= bit;
    }
    let count = 0;
    for (const _ of solutionsGen(g, rowMask, colMask, boxMask, empty, null)) {
      count++;
      if (count >= limit) break;
    }
    return count;
  }

  // Single-cell hole digging (no symmetry constraint), keeping the puzzle
  // uniquely solvable at every step via countSolutions. May stop with more
  // clues than targetClues if uniqueness can't be preserved further — expected.
  function digHoles(solution, targetClues, rand) {
    const useRand = rand || Math.random;
    const puzzle = solution.slice();
    const positions = [];
    for (let i = 0; i < SIZE * SIZE; i++) positions.push(i);
    Rng.shuffleWith(positions, useRand);
    let remaining = SIZE * SIZE;
    for (const idx of positions) {
      if (remaining <= targetClues) break;
      const backup = puzzle[idx];
      puzzle[idx] = 0;
      if (countSolutions(puzzle, 2) === 1) {
        remaining--;
      } else {
        puzzle[idx] = backup;
      }
    }
    return puzzle;
  }

  // -- logical solving / technique-tier detection --------------------------
  function recomputeCandidates(g) {
    const cand = new Array(SIZE * SIZE).fill(0);
    for (let idx = 0; idx < SIZE * SIZE; idx++) {
      if (g[idx] !== 0) continue;
      const r = rowOf(idx),
        c = colOf(idx);
      let used = 0;
      for (let cc = 0; cc < SIZE; cc++) {
        const v = g[r * SIZE + cc];
        if (v) used |= 1 << v;
      }
      for (let rr = 0; rr < SIZE; rr++) {
        const v = g[rr * SIZE + c];
        if (v) used |= 1 << v;
      }
      const br = Math.floor(r / BOX) * BOX,
        bc = Math.floor(c / BOX) * BOX;
      for (let rr = br; rr < br + BOX; rr++) {
        for (let ccx = bc; ccx < bc + BOX; ccx++) {
          const v = g[rr * SIZE + ccx];
          if (v) used |= 1 << v;
        }
      }
      cand[idx] = FULL_MASK & ~used;
    }
    return cand;
  }

  function eliminatePeers(idx, d, cand) {
    const r = rowOf(idx),
      c = colOf(idx);
    const bit = 1 << d;
    for (let cc = 0; cc < SIZE; cc++) {
      const p = r * SIZE + cc;
      if (p !== idx) cand[p] &= ~bit;
    }
    for (let rr = 0; rr < SIZE; rr++) {
      const p = rr * SIZE + c;
      if (p !== idx) cand[p] &= ~bit;
    }
    const br = Math.floor(r / BOX) * BOX,
      bc = Math.floor(c / BOX) * BOX;
    for (let rr = br; rr < br + BOX; rr++) {
      for (let ccx = bc; ccx < bc + BOX; ccx++) {
        const p = rr * SIZE + ccx;
        if (p !== idx) cand[p] &= ~bit;
      }
    }
  }

  function nakedSinglesPass(g, cand) {
    let changed = false;
    for (let idx = 0; idx < SIZE * SIZE; idx++) {
      const c = cand[idx];
      if (g[idx] === 0 && c !== 0 && (c & (c - 1)) === 0) {
        const d = 31 - Math.clz32(c);
        g[idx] = d;
        cand[idx] = 0;
        eliminatePeers(idx, d, cand);
        changed = true;
      }
    }
    return changed;
  }

  function hiddenSinglesPass(g, cand) {
    let changed = false;
    for (const unit of UNITS) {
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << d;
        const cells = unit.filter((idx) => cand[idx] & bit);
        if (cells.length === 1) {
          const idx = cells[0];
          if (g[idx] === 0) {
            g[idx] = d;
            cand[idx] = 0;
            eliminatePeers(idx, d, cand);
            changed = true;
          }
        }
      }
    }
    return changed;
  }

  function lockedCandidatesPass(cand) {
    let changed = false;

    // pointing: box -> row/col
    for (let bIdx = 0; bIdx < BOXES.length; bIdx++) {
      const box = BOXES[bIdx];
      const boxSet = BOX_SETS[bIdx];
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << d;
        const cells = box.filter((idx) => cand[idx] & bit);
        if (cells.length === 0) continue;
        const rows = new Set(cells.map(rowOf));
        const cols = new Set(cells.map(colOf));
        if (rows.size === 1) {
          const r = [...rows][0];
          for (const idx of ROWS[r]) {
            if (!boxSet.has(idx) && cand[idx] & bit) {
              cand[idx] &= ~bit;
              changed = true;
            }
          }
        }
        if (cols.size === 1) {
          const c = [...cols][0];
          for (const idx of COLS[c]) {
            if (!boxSet.has(idx) && cand[idx] & bit) {
              cand[idx] &= ~bit;
              changed = true;
            }
          }
        }
      }
    }

    // claiming: row -> box
    for (let rIdx = 0; rIdx < ROWS.length; rIdx++) {
      const row = ROWS[rIdx];
      const rowSet = ROW_SETS[rIdx];
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << d;
        const cells = row.filter((idx) => cand[idx] & bit);
        if (cells.length === 0) continue;
        const boxes = new Set(cells.map(boxOf));
        if (boxes.size === 1) {
          const b = [...boxes][0];
          for (const idx of BOXES[b]) {
            if (!rowSet.has(idx) && cand[idx] & bit) {
              cand[idx] &= ~bit;
              changed = true;
            }
          }
        }
      }
    }

    // claiming: col -> box
    for (let cIdx = 0; cIdx < COLS.length; cIdx++) {
      const col = COLS[cIdx];
      const colSet = COL_SETS[cIdx];
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << d;
        const cells = col.filter((idx) => cand[idx] & bit);
        if (cells.length === 0) continue;
        const boxes = new Set(cells.map(boxOf));
        if (boxes.size === 1) {
          const b = [...boxes][0];
          for (const idx of BOXES[b]) {
            if (!colSet.has(idx) && cand[idx] & bit) {
              cand[idx] &= ~bit;
              changed = true;
            }
          }
        }
      }
    }

    return changed;
  }

  // Returns {grid, solved, tier}. tier 0 = naked/hidden singles only,
  // tier 1 = needed locked-candidates (pointing/claiming) at least once,
  // tier 2 = still stuck after all of the above (proxy for "needs advanced
  // techniques or guessing"). Priority order matters: always retry the
  // cheapest techniques first; only escalate when genuinely stuck.
  function logicalSolve(grid) {
    const g = grid.slice();
    const cand = recomputeCandidates(g);
    let tier = 0;
    while (true) {
      if (nakedSinglesPass(g, cand)) continue;
      if (hiddenSinglesPass(g, cand)) continue;
      if (lockedCandidatesPass(cand)) {
        tier = Math.max(tier, 1);
        continue;
      }
      break;
    }
    const solved = g.every((v) => v !== 0);
    if (!solved) tier = 2;
    return { grid: g, solved, tier };
  }

  function meetsDifficulty(tier, difficulty) {
    if (difficulty === "easy") return tier === 0;
    if (difficulty === "medium") return tier <= 1;
    if (difficulty === "hard") return tier >= 1;
    if (difficulty === "expert") return tier >= 2;
    return true;
  }

  // -- difficulty configuration ---------------------------------------------
  const CLUE_RANGES = {
    easy: { min: 36, max: 44 },
    medium: { min: 30, max: 34 },
    hard: { min: 26, max: 29 },
    expert: { min: 22, max: 25 },
  };
  const MAX_GENERATION_ATTEMPTS = 20;
  const MIN_SENSIBLE_BLANKS = 12; // even at x=90 keep it feeling like a puzzle

  // "superEasy" has x% fewer blank cells than "easy" (more pre-filled numbers,
  // strictly easier), x clamped to 10-90 and user-adjustable. Examples:
  // x=30 (default) -> blanks [26,32] -> clues [49,55]; x=90 -> blanks clamp to
  // [12,12] -> clues [69,69]; x=10 -> blanks [33,41] -> clues [40,48].
  function superEasyClueRange(percent) {
    const x = Math.max(10, Math.min(90, Math.round(percent)));
    const easy = CLUE_RANGES.easy;
    const minBlanksEasy = SIZE * SIZE - easy.max;
    const maxBlanksEasy = SIZE * SIZE - easy.min;
    const scale = 1 - x / 100;
    const minBlanks = Math.max(MIN_SENSIBLE_BLANKS, Math.round(minBlanksEasy * scale));
    const maxBlanks = Math.max(minBlanks, Math.round(maxBlanksEasy * scale));
    const minClues = Math.max(17, Math.min(80, SIZE * SIZE - maxBlanks));
    const maxClues = Math.max(minClues, Math.min(80, SIZE * SIZE - minBlanks));
    return { min: minClues, max: maxClues };
  }

  // opts: { rand, superEasyPercent }
  function generatePuzzle(difficulty, opts) {
    opts = opts || {};
    const rand = opts.rand || Math.random;

    if (difficulty === "superEasy") {
      const solution = generateSolvedGrid(rand);
      const range = superEasyClueRange(
        opts.superEasyPercent != null ? opts.superEasyPercent : 30
      );
      const targetClues = range.min + Math.floor(rand() * (range.max - range.min + 1));
      const puzzle = digHoles(solution, targetClues, rand);
      return { puzzle, solution, requiresAdvanced: false };
    }

    const range = CLUE_RANGES[difficulty] || CLUE_RANGES.medium;
    let fallback = null;
    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
      const solution = generateSolvedGrid(rand);
      const targetClues = range.min + Math.floor(rand() * (range.max - range.min + 1));
      const puzzle = digHoles(solution, targetClues, rand);
      const { tier } = logicalSolve(puzzle);
      const requiresAdvanced = tier === 2;
      if (!fallback) fallback = { puzzle, solution, requiresAdvanced };
      if (meetsDifficulty(tier, difficulty)) return { puzzle, solution, requiresAdvanced };
    }
    return fallback;
  }

  function computeConflicts(values) {
    // values: array of 81 numbers (0 = empty). Returns boolean[81].
    const conflict = new Array(SIZE * SIZE).fill(false);
    for (const unit of UNITS) {
      const seen = new Map();
      for (const idx of unit) {
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
    return conflict;
  }

  return {
    SIZE,
    BOX,
    CLUE_RANGES,
    rowOf,
    colOf,
    boxOf,
    generateSolvedGrid,
    countSolutions,
    digHoles,
    logicalSolve,
    superEasyClueRange,
    generatePuzzle,
    computeConflicts,
  };
})();

if (typeof window !== "undefined") {
  window.Sudoku = Sudoku;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = Sudoku;
}
