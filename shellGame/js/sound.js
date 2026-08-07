// Tiny Web Audio synth for the shell game — no audio files, matching the
// rest of the hub. AudioContext is created lazily on first play() (a real
// user gesture, e.g. tapping "開始遊戲"), not at page load.
var ShellGameSound = (function () {
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

  function beep(freq, duration, type, volume, startOffset) {
    const audioCtx = ensureCtx();
    if (!audioCtx) return;
    const startAt = audioCtx.currentTime + (startOffset || 0);
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    gain.gain.setValueAtTime(volume, startAt);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(startAt);
    osc.stop(startAt + duration);
  }

  // A short pitch-sweep "whoosh" for each cup swap — quick and cheap
  // enough to fire once per swap step without ever feeling laggy.
  function whoosh(basePitch) {
    const audioCtx = ensureCtx();
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(basePitch * 1.6, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(basePitch * 0.7, audioCtx.currentTime + 0.09);
    gain.gain.value = 0.1;
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
  }

  function chime(freqs, type, gap) {
    freqs.forEach((freq, i) => {
      beep(freq, 0.16, type, 0.22, (i * (gap || 100)) / 1000);
    });
  }

  function play(event, extra) {
    if (!enabled) return;
    switch (event) {
      case "reveal":
        beep(660, 0.14, "sine", 0.18);
        break;
      case "lidClose":
        beep(180, 0.09, "triangle", 0.16);
        break;
      case "swap":
        // Pitch drifts upward with shuffle speed so faster/later levels
        // sound audibly more frantic, not just visually faster.
        whoosh(320 + Math.min((extra && extra.level) || 0, 20) * 6);
        break;
      case "correct": {
        // Rising pitch with streak — a longer hot streak sounds brighter.
        const step = Math.min((extra && extra.streak) || 0, 10);
        chime([523 + step * 20, 659 + step * 24, 784 + step * 28], "sine", 90);
        break;
      }
      case "milestone":
        chime([523, 659, 784, 1046, 1318], "sine", 110);
        break;
      case "wrong":
        chime([311, 233], "sawtooth", 130);
        break;
      case "gameover":
        chime([392, 330, 294, 220], "sawtooth", 160);
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
  window.ShellGameSound = ShellGameSound;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = ShellGameSound;
}
