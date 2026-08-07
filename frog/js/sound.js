// Web Audio synth for the frog game's sound effects PLUS a continuously
// looping background track — the first game in this hub with actual bgm
// rather than just discrete event beeps, per an explicit request that this
// game (unlike every other one so far) needs music playing throughout, not
// just SFX on events. No audio files, same zero-dependency approach as
// every other game's sound.js.
//
// The bgm loop uses the standard "precise Web Audio scheduling" pattern
// (look ahead and schedule exact oscillator start times via
// audioCtx.currentTime, driven by a short setInterval poll) instead of
// chaining setTimeout calls per note — a setTimeout-per-note loop drifts
// over a long play session since setTimeout delay is not exact, which
// would be very audible in a bgm loop meant to run for minutes at a time.
var FrogSound = (function () {
  let ctx = null;
  let enabled = true;
  let bgmGain = null;
  let bgmTimer = null;
  let bgmStepIndex = 0;
  let bgmNextTime = 0;

  const BGM_STEP_SEC = 0.15;
  const BGM_LOOKAHEAD_SEC = 0.2;
  const BGM_POLL_MS = 40;
  // 8-step bassline (repeats twice per 16-step melody bar) and a 16-step
  // melody with rests (null) — a small, chirpy, slightly adventurous loop
  // that fits a "hopping across danger" mood without overstaying its
  // welcome on repeat.
  const BASS_NOTES = [110, 110, 130.81, 110, 146.83, 110, 130.81, 98];
  const MELODY_PATTERN = [
    440, null, 523.25, null, 587.33, 523.25, 440, null,
    392, null, 440, null, 523.25, 440, 392, null,
  ];

  function ensureCtx() {
    if (!ctx) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return null;
      ctx = new AudioCtor();
      bgmGain = ctx.createGain();
      bgmGain.gain.value = enabled ? 0.16 : 0;
      bgmGain.connect(ctx.destination);
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

  function playBassNote(freq, time) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.5, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, time + BGM_STEP_SEC * 0.9);
    osc.connect(gain);
    gain.connect(bgmGain);
    osc.start(time);
    osc.stop(time + BGM_STEP_SEC);
  }

  function playMelodyNote(freq, time) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.3, time + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, time + BGM_STEP_SEC * 0.75);
    osc.connect(gain);
    gain.connect(bgmGain);
    osc.start(time);
    osc.stop(time + BGM_STEP_SEC);
  }

  function bgmPoll() {
    if (!ctx) return;
    while (bgmNextTime < ctx.currentTime + BGM_LOOKAHEAD_SEC) {
      playBassNote(BASS_NOTES[bgmStepIndex % BASS_NOTES.length], bgmNextTime);
      const melody = MELODY_PATTERN[bgmStepIndex % MELODY_PATTERN.length];
      if (melody) playMelodyNote(melody, bgmNextTime);
      bgmStepIndex++;
      bgmNextTime += BGM_STEP_SEC;
    }
  }

  function startBgm() {
    const audioCtx = ensureCtx();
    if (!audioCtx || bgmTimer) return;
    bgmStepIndex = 0;
    bgmNextTime = audioCtx.currentTime + 0.05;
    bgmTimer = setInterval(bgmPoll, BGM_POLL_MS);
  }

  function stopBgm() {
    if (bgmTimer) {
      clearInterval(bgmTimer);
      bgmTimer = null;
    }
  }

  function play(event, extra) {
    if (!enabled) return;
    switch (event) {
      case "hop":
        beep(520 + Math.random() * 60, 0.05, "square", 0.14);
        break;
      case "carHit":
        chime([180, 120], "sawtooth");
        break;
      case "drown":
      case "edgeFall":
        // A short descending "glug" for going under.
        beep(420, 0.05, "sine", 0.16);
        setTimeout(() => beep(260, 0.08, "sine", 0.14), 60);
        setTimeout(() => beep(160, 0.12, "sine", 0.12), 130);
        break;
      case "gapFall":
        beep(200, 0.16, "triangle", 0.2);
        break;
      case "slotFilled":
        chime([659, 880], "sine");
        break;
      case "bump":
        beep(150, 0.06, "square", 0.16);
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
    startBgm,
    stopBgm,
    setEnabled: (v) => {
      enabled = v;
      if (bgmGain) bgmGain.gain.setTargetAtTime(v ? 0.16 : 0, ctx.currentTime, 0.05);
    },
    isEnabled: () => enabled,
  };
})();

if (typeof window !== "undefined") {
  window.FrogSound = FrogSound;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = FrogSound;
}
