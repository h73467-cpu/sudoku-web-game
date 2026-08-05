// Seedable PRNG utilities, used for deterministic daily-challenge puzzle
// generation. Math.random() cannot be seeded, so daily mode routes through
// mulberry32 instead — same date string in, same puzzle out, for every
// visitor on that day. No relation to (and no attempt to match) the desktop
// Python app's Mersenne-Twister-seeded puzzles; each platform is
// self-consistent only.
var SudokuRng = (function () {
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Stable string -> uint32 hash (rolling hash, base 131). Deterministic
  // across runs/browsers, unlike JS's lack of a builtin string hash.
  function hashSeed(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (Math.imul(h, 131) + str.charCodeAt(i)) >>> 0;
    }
    return h >>> 0;
  }

  function shuffleWith(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  return { mulberry32, hashSeed, shuffleWith };
})();

if (typeof window !== "undefined") {
  window.SudokuRng = SudokuRng;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = SudokuRng;
}
