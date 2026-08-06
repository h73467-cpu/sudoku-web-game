// Tiny Web Audio synth for maze's move/invalid/undo/hint/win sounds — no
// audio files, same zero-dependency approach as game2048/js/sound.js. Kept
// as its own independent copy per this codebase's convention of small
// per-game duplication over cross-game coupling.
var MazeSound = (function () {
  let ctx = null;
  let enabled = true;

  function ensureCtx() {
    if (!ctx) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return null;
      ctx = new AudioCtor();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function beep(freq, duration, type, volume) {
    const audioCtx = ensureCtx();
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  }

  function chime(freqs, type) {
    const audioCtx = ensureCtx();
    if (!audioCtx) return;
    freqs.forEach((freq, i) => {
      setTimeout(() => beep(freq, 0.14, type, 0.22), i * 100);
    });
  }

  function play(event) {
    if (!enabled) return;
    switch (event) {
      case "move":
        beep(300 + Math.random() * 30, 0.05, "triangle", 0.14);
        break;
      case "invalid":
        beep(140, 0.1, "sawtooth", 0.14);
        break;
      case "undo":
        beep(260, 0.09, "square", 0.16);
        break;
      case "hint":
        beep(520, 0.1, "sine", 0.16);
        break;
      case "win":
        chime([523, 659, 784, 1046], "sine");
        break;
    }
  }

  return {
    play,
    setEnabled: (v) => {
      enabled = v;
    },
    isEnabled: () => enabled,
  };
})();

if (typeof window !== "undefined") {
  window.MazeSound = MazeSound;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = MazeSound;
}
