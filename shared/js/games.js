// Static game-hub catalogue. To add a new game once it's built, add one
// entry here with status:"ready" and a path — the home page renders from
// this list, no other hub code needs to change.
var GAMES = [
  { id: "sudoku", title: "數獨", icon: "🔢", path: "sudoku/index.html", status: "ready" },
  { id: "memoryMatch", title: "記憶翻牌", icon: "🃏", path: "memory/index.html", status: "ready" },
  { id: "guessNumber", title: "1A2B 猜數字", icon: "🕵️", path: "guess/index.html", status: "ready" },
  { id: "nonogram", title: "數織", icon: "🧩", path: "nonogram/index.html", status: "ready" },
  { id: "sokoban", title: "推箱子", icon: "📦", path: "sokoban/index.html", status: "ready" },
  { id: "connectFour", title: "四子棋", icon: "🔴", path: "connectFour/index.html", status: "ready" },
  { id: "othello", title: "黑白棋", icon: "⚫", path: "othello/index.html", status: "ready" },
  { id: "breakout", title: "打磚塊", icon: "🧱", path: "breakout/index.html", status: "ready" },
  { id: "fifteenPuzzle", title: "15 數字推盤", icon: "🔀", path: "fifteen/index.html", status: "ready" },
  { id: "jigsaw", title: "拼圖", icon: "🖼️", path: "jigsaw/index.html", status: "ready" },
  { id: "klotski", title: "華容道", icon: "🚗", path: "klotski/index.html", status: "ready" },
  { id: "lianliankan", title: "連連看", icon: "🔗", path: "lianliankan/index.html", status: "ready" },
  { id: "minesweeper", title: "踩地雷", icon: "💣", path: "minesweeper/index.html", status: "ready" },
  { id: "game2048", title: "2048", icon: "🧮", path: "game2048/index.html", status: "ready" },
  { id: "maze", title: "迷宮遊戲", icon: "🌀", path: "maze/index.html", status: "ready" },
  { id: "wordGame", title: "拼字遊戲", icon: "🔤", path: "wordGame/index.html", status: "ready" },
  { id: "shellGame", title: "三個杯子", icon: "🎩", path: "shellGame/index.html", status: "ready" },
  { id: "frogger", title: "青蛙過河", icon: "🐸", path: "frog/index.html", status: "ready" },
  { id: "smokeCar", title: "迷魂車", icon: "🏎️", path: "smokeCar/index.html", status: "ready" },
  { id: "pitchTrain", title: "絕對音感", icon: "🎧", path: "pitchTrain/index.html", status: "ready" },
];

if (typeof window !== "undefined") {
  window.GAMES = GAMES;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = GAMES;
}
