// Static game-hub catalogue. To add a new game once it's built, add one
// entry here with status:"ready" and a path — the home page renders from
// this list, no other hub code needs to change.
var GAMES = [
  { id: "sudoku", title: "數獨", icon: "🔢", path: "sudoku/index.html", status: "ready" },
  { id: "memoryMatch", title: "記憶翻牌", icon: "🃏", path: "memory/index.html", status: "ready" },
  { id: "guessNumber", title: "1A2B 猜數字", icon: "🕵️", path: "guess/index.html", status: "ready" },
  { id: "nonogram", title: "數織", icon: "🧩", status: "planned" },
  { id: "sokoban", title: "推箱子", icon: "📦", status: "planned" },
  { id: "connectFour", title: "四子棋", icon: "🔴", status: "planned" },
  { id: "othello", title: "黑白棋", icon: "⚫", status: "planned" },
  { id: "breakout", title: "打磚塊", icon: "🧱", path: "breakout/index.html", status: "ready" },
  { id: "fifteenPuzzle", title: "15 數字推盤", icon: "🔢", status: "planned" },
  { id: "jigsaw", title: "拼圖", icon: "🖼️", status: "planned" },
  { id: "klotski", title: "華容道", icon: "🚗", status: "planned" },
];

if (typeof window !== "undefined") {
  window.GAMES = GAMES;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = GAMES;
}
