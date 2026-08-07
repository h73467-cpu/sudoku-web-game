// Web Audio synth for 迷魂車's sound effects plus a continuously looping
// background track, same "precise Web Audio scheduling" approach as
// frog/js/sound.js (a setInterval poll that schedules exact oscillator
// start times via audioCtx.currentTime rather than chaining setTimeout
// calls, so the loop doesn't audibly drift over a long play session).
// The bgm here is an original up-tempo chase-y pattern — not a
// transcription of any specific existing game's soundtrack — since this
// hub only ever uses synthesized, self-authored audio.
var SmokeCarSound = (function () {
  let ctx = null;
  let enabled = true;
  let bgmGain = null;
  let bgmTimer = null;
  let bgmStepIndex = 0;
  let bgmNextTime = 0;
  let noiseBuffer = null;

  const BGM_STEP_SEC = 0.11;
  const BGM_LOOKAHEAD_SEC = 0.2;
  const BGM_POLL_MS = 40;
  const BASS_NOTES = [98, 98, 116.54, 98, 130.81, 98, 116.54, 87.31];
  const MELODY_PATTERN = [
    784, null, 698.46, null, 784, 880, null, 698.46,
    659.25, null, 587.33, null, 659.25, 784, null, 587.33,
  ];

  function ensureCtx() {
    if (!ctx) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return null;
      ctx = new AudioCtor();
      bgmGain = ctx.createGain();
      bgmGain.gain.value = enabled ? 0.14 : 0;
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
      setTimeout(() => beep(freq, 0.13, type, 0.22), i * 90);
    });
  }

  function playBassNote(freq, time) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.45, time + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, time + BGM_STEP_SEC * 0.85);
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
    gain.gain.linearRampToValueAtTime(0.26, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, time + BGM_STEP_SEC * 0.7);
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

  function ensureNoiseBuffer(audioCtx) {
    if (noiseBuffer) return noiseBuffer;
    const len = Math.floor(audioCtx.sampleRate * 0.4);
    noiseBuffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  // A filtered white-noise burst for the smoke release — a real
  // spray/hiss texture, not just another oscillator beep, layered on top
  // of (not replacing) the continuous bgm.
  function playSmokeHiss() {
    const audioCtx = ensureCtx();
    if (!audioCtx) return;
    const src = audioCtx.createBufferSource();
    src.buffer = ensureNoiseBuffer(audioCtx);
    const filter = audioCtx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(2600, audioCtx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.35);
    filter.Q.value = 0.7;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.001, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    src.start();
    src.stop(audioCtx.currentTime + 0.4);
  }

  function play(event) {
    if (!enabled) return;
    switch (event) {
      case "smoke":
        playSmokeHiss();
        break;
      case "flag":
        beep(720 + Math.random() * 80, 0.07, "square", 0.18);
        break;
      case "caught":
        chime([220, 160, 110], "sawtooth");
        break;
      case "trapped":
        beep(300, 0.09, "triangle", 0.2);
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
      if (bgmGain) bgmGain.gain.setTargetAtTime(v ? 0.14 : 0, ctx.currentTime, 0.05);
    },
    isEnabled: () => enabled,
  };
})();

if (typeof window !== "undefined") {
  window.SmokeCarSound = SmokeCarSound;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = SmokeCarSound;
}
