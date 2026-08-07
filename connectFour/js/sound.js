// Tiny Web Audio synth for connect four's drop/undo/win/draw sounds — no
// audio files, same zero-dependency approach as jigsaw/js/sound.js. Kept as
// its own independent copy (not shared) to match this codebase's existing
// convention of small per-game duplication over cross-game coupling.
var ConnectFourSound = (function () {
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

  // A short descending pitch sweep — plays the instant a coin starts
  // falling, so the sound tracks the "whoosh" of it dropping through the
  // empty column rather than a flat click.
  function whoosh() {
    const audioCtx = ensureCtx();
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(560, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(190, audioCtx.currentTime + 0.22);
    gain.gain.value = 0.14;
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.24);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.24);
  }

  function play(event) {
    if (!enabled) return;
    switch (event) {
      case "fall":
        whoosh();
        break;
      case "land":
        // A low thud plus a tiny high click layered together, for a
        // coin-hitting-plastic "clink" instead of a single flat tone.
        beep(115, 0.13, "sine", 0.3);
        beep(720, 0.045, "square", 0.12);
        break;
      case "invalid":
        beep(140, 0.12, "sawtooth", 0.18);
        break;
      case "undo":
        beep(260, 0.09, "square", 0.16);
        break;
      case "win":
        chime([523, 659, 784, 1046], "sine");
        break;
      case "draw":
        chime([392, 330], "sine");
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
  window.ConnectFourSound = ConnectFourSound;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = ConnectFourSound;
}
