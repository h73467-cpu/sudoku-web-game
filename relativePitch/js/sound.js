// Tiny Web Audio synth for 相對音感 — no audio files, matching the rest of
// the hub. AudioContext is created lazily on first play() (a real user
// gesture). Independent copy of pitchTrain/js/sound.js (this hub's
// convention is every game's sound.js is fully self-contained, never
// imported cross-game), generalized to play an arbitrary frequency blended
// across one or more oscillator types at once.
var RelativePitchSound = (function () {
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

  // The actual pitch-training tone: plays `freq` across every oscillator
  // type in `types`, each at volume/types.length so a 2-type blend isn't
  // just louder than a single type. Short attack + exponential decay to
  // avoid a click at the start/end.
  function playNote(freq, duration, types, volume, startOffset) {
    const audioCtx = ensureCtx();
    if (!audioCtx) return;
    const startAt = audioCtx.currentTime + (startOffset || 0);
    const perOscVolume = volume / types.length;
    types.forEach((type) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(perOscVolume, startAt + 0.015);
      gain.gain.setValueAtTime(perOscVolume, startAt + Math.max(0.02, duration - 0.08));
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(startAt);
      osc.stop(startAt + duration + 0.02);
    });
  }

  // Reference/tonic tone — always a plain sine (distinct from whatever
  // timbre the tier's question notes use), a touch longer so it reads as
  // "the anchor" rather than just another question note.
  function playReference(freq, startOffset) {
    playNote(freq, 0.7, ["sine"], 0.16, startOffset || 0);
  }

  function beep(freq, duration, type, volume, startOffset) {
    playNote(freq, duration, [type], volume, startOffset);
  }

  function chime(freqs, type, gap) {
    freqs.forEach((freq, i) => {
      beep(freq, 0.16, type, 0.22, (i * (gap || 100)) / 1000);
    });
  }

  // Short, neutral click for UI taps (piano keys, degree buttons) — cheap
  // enough to fire on every tap without ever feeling laggy.
  function tap() {
    beep(700, 0.06, "sine", 0.12);
  }

  function play(event, extra) {
    if (!enabled) return;
    switch (event) {
      case "tap":
        tap();
        break;
      case "correct": {
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
    }
  }

  return {
    playNote,
    playReference,
    play,
    setEnabled: (v) => {
      enabled = v;
    },
    isEnabled: () => enabled,
  };
})();

if (typeof window !== "undefined") {
  window.RelativePitchSound = RelativePitchSound;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = RelativePitchSound;
}
