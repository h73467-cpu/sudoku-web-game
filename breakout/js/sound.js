// Tiny Web Audio synth for Breakout's collision/event sounds — no audio
// files, stays consistent with the rest of the site's zero-dependency
// philosophy. AudioContext is created lazily on first play() call (real
// user gesture, e.g. launching the ball), not at page load, to avoid
// browser autoplay-policy warnings.
var BreakoutSound = (function () {
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

  // Short sequential notes — used for power-ups / level-clear / game-over
  // so those moments sound distinctly different from plain collision beeps.
  function chime(freqs, type) {
    const audioCtx = ensureCtx();
    if (!audioCtx) return;
    freqs.forEach((freq, i) => {
      setTimeout(() => beep(freq, 0.12, type, 0.22), i * 90);
    });
  }

  function play(event, extra) {
    if (!enabled) return;
    switch (event) {
      case "wall":
        beep(220, 0.05, "sine", 0.12);
        break;
      case "paddle":
        // Pitch rises with combo streak so repeated rallies don't sound
        // identical every time.
        beep(300 + Math.min((extra && extra.combo) || 0, 15) * 10, 0.06, "square", 0.18);
        break;
      case "brick":
        // Slight random pitch variance per hit — avoids a flat, robotic feel.
        beep(420 + Math.random() * 120, 0.07, "triangle", 0.22);
        break;
      case "brickBreak":
        beep(260, 0.09, "sawtooth", 0.2);
        break;
      case "powerupGood":
        chime([523, 659, 784], "sine");
        break;
      case "powerupBad":
        chime([392, 330], "sawtooth");
        break;
      case "lifeLost":
        beep(150, 0.3, "sawtooth", 0.3);
        break;
      case "levelClear":
        chime([523, 659, 784, 1046], "sine");
        break;
      case "gameover":
        chime([392, 330, 262, 220], "sawtooth");
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
  window.BreakoutSound = BreakoutSound;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = BreakoutSound;
}
