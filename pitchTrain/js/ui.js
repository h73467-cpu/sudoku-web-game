// The only file that touches the DOM. Renders PitchTrainGame's state to
// both practice boards, orchestrates audio-playback timing via setTimeout
// chains (PitchTrainGame itself only exposes discrete step functions, same
// separation shellGame/js/ui.js established), and maps events to sound +
// celebratory visual effects (particle/confetti/milestone-banner técnica
// adapted from shellGame/js/ui.js).
(function () {
  const MODE_LABELS = { singleNote: "聽音辨識", melody: "旋律回奏" };
  const DIFFICULTY_LABELS = { superEasy: "超簡單", easy: "簡單", medium: "中等", hard: "困難", expert: "專家" };
  const MODE_DESCRIPTIONS = {
    singleNote: "聽一個合成音，從音名按鈕點選你覺得是哪一個音（不分八度）。",
    melody: "聽一小段旋律，用「1 2 3 4 5 6 7 i」簡譜鍵盤依序點出你聽到的音。",
  };
  const PARTICLE_GLYPHS = ["✨", "🎵", "⭐", "🎶", "🎉"];
  const CONFETTI_COLORS = ["#f43f5e", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];
  const QUESTION_NOTE_DURATION = 0.9;
  const MELODY_NOTE_TIMBRE = ["triangle"];

  // -- home view elements ---------------------------------------------------
  const homeViewEl = document.getElementById("homeView");
  const themeSelect = document.getElementById("themeSelect");
  const instructionsBtn = document.getElementById("instructionsBtn");
  const soundToggleBtn = document.getElementById("soundToggleBtn");
  const modeTabButtons = Array.from(document.querySelectorAll(".mode-tab"));
  const modeDescriptionEl = document.getElementById("modeDescription");
  const melodyKeyOption = document.getElementById("melodyKeyOption");
  const melodyRandomKeyToggle = document.getElementById("melodyRandomKeyToggle");
  const difficultyButtons = Array.from(document.querySelectorAll(".difficulty-btn"));
  const historyBtn = document.getElementById("historyBtn");
  const careerBtn = document.getElementById("careerBtn");

  // -- game view elements -----------------------------------------------------
  const gameViewEl = document.getElementById("gameView");
  const backHomeBtn = document.getElementById("backHomeBtn");
  const difficultyLabel = document.getElementById("difficultyLabel");
  const streakDisplay = document.getElementById("streakDisplay");
  const accuracyDisplay = document.getElementById("accuracyDisplay");
  const answeredDisplay = document.getElementById("answeredDisplay");
  const gameSoundToggleBtn = document.getElementById("gameSoundToggleBtn");
  const gameInstructionsBtn = document.getElementById("gameInstructionsBtn");

  const singleNoteBoard = document.getElementById("singleNoteBoard");
  const playNoteBtn = document.getElementById("playNoteBtn");
  const playReferenceBtn = document.getElementById("playReferenceBtn");
  const noteAnswerGrid = document.getElementById("noteAnswerGrid");
  const singleResultBanner = document.getElementById("singleResultBanner");
  const nextNoteBtn = document.getElementById("nextNoteBtn");

  const melodyBoard = document.getElementById("melodyBoard");
  const melodyHintText = document.getElementById("melodyHintText");
  const playMelodyBtn = document.getElementById("playMelodyBtn");
  const replayCountLabel = document.getElementById("replayCountLabel");
  const melodyAttemptTrack = document.getElementById("melodyAttemptTrack");
  const degreeKeypad = document.getElementById("degreeKeypad");
  const undoTapBtn = document.getElementById("undoTapBtn");
  const melodyResultBanner = document.getElementById("melodyResultBanner");
  const melodyResultTrack = document.getElementById("melodyResultTrack");
  const nextMelodyBtn = document.getElementById("nextMelodyBtn");

  // -- history / career view elements -----------------------------------------
  const historyViewEl = document.getElementById("historyView");
  const historyBackBtn = document.getElementById("historyBackBtn");
  const historyList = document.getElementById("historyList");
  const careerViewEl = document.getElementById("careerView");
  const careerBackBtn = document.getElementById("careerBackBtn");
  const careerTableSingle = document.getElementById("careerTableSingle");
  const careerTableMelody = document.getElementById("careerTableMelody");

  // -- modals -----------------------------------------------------------------
  const particleLayerEl = document.getElementById("particleLayer");
  const screenFlashEl = document.getElementById("screenFlash");
  const sessionEndModal = document.getElementById("sessionEndModal");
  const sessionEndTitle = document.getElementById("sessionEndTitle");
  const sessionEndSubtitle = document.getElementById("sessionEndSubtitle");
  const sessionEndStats = document.getElementById("sessionEndStats");
  const sessionEndCloseBtn = document.getElementById("sessionEndCloseBtn");
  const sessionEndHomeBtn = document.getElementById("sessionEndHomeBtn");
  const instructionsModal = document.getElementById("instructionsModal");
  const instructionsCloseBtn = document.getElementById("instructionsCloseBtn");

  const views = { home: homeViewEl, game: gameViewEl, history: historyViewEl, career: careerViewEl };
  function showView(name) {
    Object.entries(views).forEach(([key, el]) => el.classList.toggle("hidden", key !== name));
  }

  function applyTheme(themeKey) {
    document.documentElement.dataset.theme = themeKey;
  }

  function applySoundButtonState(btn, compact) {
    const on = PitchTrainSound.isEnabled();
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = compact ? (on ? "🔊" : "🔇") : on ? "🔊 音效：開" : "🔇 音效：關";
  }
  function toggleSound() {
    const next = !PitchTrainSound.isEnabled();
    PitchTrainSound.setEnabled(next);
    PitchTrainStorage.saveSettings({ soundEnabled: next });
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
  }

  function statRow(label, value) {
    return '<div class="win-stat-row"><span>' + label + "</span><span>" + value + "</span></div>";
  }
  function formatPercent(x) {
    return x == null ? "--" : Math.round(x * 100) + "%";
  }

  // -- home view ---------------------------------------------------------------
  let selectedMode = "singleNote";
  let lastMode = "singleNote";
  let lastDifficulty = "superEasy";

  function renderHome() {
    themeSelect.value = GameHubStorage.getTheme();
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
    modeTabButtons.forEach((btn) => btn.setAttribute("aria-pressed", btn.dataset.mode === selectedMode ? "true" : "false"));
    modeDescriptionEl.textContent = MODE_DESCRIPTIONS[selectedMode];
    melodyKeyOption.classList.toggle("hidden", selectedMode !== "melody");
    melodyRandomKeyToggle.checked = !!PitchTrainStorage.getSettings().melodyRandomKey;
  }

  modeTabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedMode = btn.dataset.mode;
      renderHome();
    });
  });

  melodyRandomKeyToggle.addEventListener("change", () => {
    PitchTrainStorage.saveSettings({ melodyRandomKey: melodyRandomKeyToggle.checked });
  });

  difficultyButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      lastMode = selectedMode;
      lastDifficulty = btn.dataset.difficulty;
      PitchTrainGame.startSession(lastMode, lastDifficulty);
      showView("game");
    });
  });

  themeSelect.addEventListener("change", () => {
    const theme = themeSelect.value;
    applyTheme(theme);
    GameHubStorage.setTheme(theme);
  });

  instructionsBtn.addEventListener("click", () => instructionsModal.classList.remove("hidden"));
  gameInstructionsBtn.addEventListener("click", () => instructionsModal.classList.remove("hidden"));
  instructionsCloseBtn.addEventListener("click", () => instructionsModal.classList.add("hidden"));
  soundToggleBtn.addEventListener("click", toggleSound);
  gameSoundToggleBtn.addEventListener("click", toggleSound);

  historyBtn.addEventListener("click", () => {
    renderHistory();
    showView("history");
  });
  careerBtn.addEventListener("click", () => {
    renderCareer();
    showView("career");
  });
  historyBackBtn.addEventListener("click", () => {
    renderHome();
    showView("home");
  });
  careerBackBtn.addEventListener("click", () => {
    renderHome();
    showView("home");
  });

  // -- history / career rendering ----------------------------------------------
  function renderHistory() {
    const items = PitchTrainStorage.getHistory();
    historyList.innerHTML = "";
    if (items.length === 0) {
      historyList.innerHTML = '<div class="empty-state">還沒有任何紀錄</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    items.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "record-row";
      const date = entry.completedAt ? entry.completedAt.slice(0, 10) : "-";
      const label = (MODE_LABELS[entry.mode] || entry.mode) + "　" + (DIFFICULTY_LABELS[entry.difficulty] || entry.difficulty);
      row.innerHTML =
        '<span class="record-tag">' + label + "　" + date + "</span>" +
        "<span>連續 " + entry.streak + " 次　正確率 " + formatPercent(entry.accuracy) + "　作答 " + entry.answered + " 題</span>";
      frag.appendChild(row);
    });
    historyList.appendChild(frag);
  }

  function renderCareerTable(tbody, modeCareer) {
    tbody.innerHTML = "";
    const frag = document.createDocumentFragment();
    PitchTrainGame.DIFFICULTY_ORDER.forEach((code) => {
      const entry = modeCareer[code] || { bestStreak: 0, bestAccuracy: null, totalAnswered: 0 };
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + DIFFICULTY_LABELS[code] + "</td>" +
        "<td>" + entry.bestStreak + "</td>" +
        "<td>" + formatPercent(entry.bestAccuracy) + "</td>" +
        "<td>" + entry.totalAnswered + "</td>";
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
  }

  function renderCareer() {
    const career = PitchTrainStorage.getCareer();
    renderCareerTable(careerTableSingle, career.singleNote);
    renderCareerTable(careerTableMelody, career.melody);
  }

  // -- toolbar ------------------------------------------------------------
  function renderToolbar(state) {
    difficultyLabel.textContent = MODE_LABELS[state.mode] + " · " + DIFFICULTY_LABELS[state.difficulty];
    streakDisplay.textContent = String(state.streak) + (state.streak >= 3 ? " 🔥".repeat(Math.min(5, state.streak - 2)) : "");
    accuracyDisplay.textContent = state.sessionAnswered > 0 ? formatPercent(state.sessionCorrect / state.sessionAnswered) : "--";
    answeredDisplay.textContent = String(state.sessionAnswered);
  }

  // -- celebration effects (adapted from shellGame/js/ui.js; anchored to
  // the viewport center via CSS rather than a specific stage element) -----
  function flashScreen(cls) {
    screenFlashEl.classList.remove("flash-good", "flash-bad");
    void screenFlashEl.offsetWidth;
    screenFlashEl.classList.add(cls);
  }

  function spawnParticles(count) {
    for (let i = 0; i < count; i++) {
      const span = document.createElement("span");
      span.className = "particle";
      span.textContent = PARTICLE_GLYPHS[Math.floor(Math.random() * PARTICLE_GLYPHS.length)];
      const angle = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 90;
      const dx = Math.cos(angle) * dist;
      const dy = -Math.abs(Math.sin(angle) * dist) - 30;
      span.style.setProperty("--dx", dx.toFixed(1) + "px");
      span.style.setProperty("--dy", dy.toFixed(1) + "px");
      span.style.setProperty("--rot", (Math.random() * 360 - 180).toFixed(0) + "deg");
      span.style.animationDelay = Math.random() * 120 + "ms";
      particleLayerEl.appendChild(span);
      setTimeout(() => span.remove(), 1100);
    }
  }

  function spawnConfetti() {
    const overlay = document.createElement("div");
    overlay.className = "confetti-overlay";
    for (let i = 0; i < 60; i++) {
      const piece = document.createElement("span");
      piece.className = "confetti-piece";
      piece.style.left = Math.random() * 100 + "%";
      piece.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
      piece.style.animationDuration = 1.2 + Math.random() * 1 + "s";
      piece.style.animationDelay = Math.random() * 0.3 + "s";
      overlay.appendChild(piece);
    }
    document.body.appendChild(overlay);
    setTimeout(() => overlay.remove(), 2300);
  }

  function showMilestoneBanner(streak) {
    const banner = document.createElement("div");
    banner.className = "milestone-banner";
    banner.textContent = "🏆 連續答對 " + streak + " 次！太厲害了！";
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 2100);
  }

  function celebrate(streak) {
    flashScreen("flash-good");
    spawnParticles(streak >= 10 ? 16 : 9);
    PitchTrainSound.play("milestone");
    spawnConfetti();
    showMilestoneBanner(streak);
  }

  // -- timers (audio scheduling lives here, not in game.js) -------------------
  let pendingTimers = [];
  function schedule(fn, delay) {
    const id = setTimeout(fn, delay);
    pendingTimers.push(id);
    return id;
  }
  function clearTimers() {
    pendingTimers.forEach((id) => clearTimeout(id));
    pendingTimers = [];
  }

  // -- 聽音辨識 -----------------------------------------------------------------
  function buildNoteAnswerGrid(tier) {
    noteAnswerGrid.innerHTML = "";
    const classes = tier.notePool === "white" ? PitchTrainGame.WHITE_KEY_CLASSES : PitchTrainGame.NOTE_NAMES.map((_, i) => i);
    const frag = document.createDocumentFragment();
    classes.forEach((pc) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "note-answer-btn";
      btn.dataset.pitchClass = String(pc);
      btn.textContent = PitchTrainGame.NOTE_NAMES[pc];
      frag.appendChild(btn);
    });
    noteAnswerGrid.appendChild(frag);
  }

  function enableNoteButtons(enabled) {
    Array.from(noteAnswerGrid.children).forEach((btn) => {
      btn.disabled = !enabled;
    });
  }

  function clearNoteButtonMarks() {
    Array.from(noteAnswerGrid.children).forEach((btn) => {
      btn.classList.remove("picked-correct", "picked-wrong", "reveal-correct");
    });
  }

  function playCurrentNote(state) {
    const tier = PitchTrainGame.singleTierFor(state.difficulty);
    if (tier.referenceTone) {
      PitchTrainSound.playReference(440);
      PitchTrainSound.playNote(state.currentNote.freq, QUESTION_NOTE_DURATION, tier.timbre, 0.22, 0.85);
    } else {
      PitchTrainSound.playNote(state.currentNote.freq, QUESTION_NOTE_DURATION, tier.timbre, 0.22, 0);
    }
  }

  function onSingleQuestion(state) {
    clearTimers();
    singleNoteBoard.classList.remove("hidden");
    melodyBoard.classList.add("hidden");
    const tier = PitchTrainGame.singleTierFor(state.difficulty);
    buildNoteAnswerGrid(tier);
    clearNoteButtonMarks();
    enableNoteButtons(true);
    playReferenceBtn.classList.toggle("hidden", !tier.referenceTone);
    singleResultBanner.textContent = "";
    singleResultBanner.className = "result-banner";
    nextNoteBtn.classList.add("hidden");
    playCurrentNote(state);
  }

  function onSingleAnswer(state, extra) {
    enableNoteButtons(false);
    const pickedBtn = noteAnswerGrid.querySelector('[data-pitch-class="' + state.lastResult.pickedPitchClass + '"]');
    if (pickedBtn) pickedBtn.classList.add(extra.correct ? "picked-correct" : "picked-wrong");
    if (!extra.correct) {
      const correctBtn = noteAnswerGrid.querySelector('[data-pitch-class="' + state.lastResult.correctPitchClass + '"]');
      if (correctBtn) correctBtn.classList.add("reveal-correct");
    }
    singleResultBanner.textContent = extra.correct
      ? "✅ 答對了！是 " + state.currentNote.label.name
      : "❌ 答錯了，正確答案是 " + state.currentNote.label.name;
    singleResultBanner.className = "result-banner " + (extra.correct ? "tone-correct" : "tone-wrong");
    PitchTrainSound.play(extra.correct ? "correct" : "wrong", { streak: state.streak });
    if (extra.milestone) celebrate(state.streak);
    nextNoteBtn.classList.remove("hidden");
  }

  playNoteBtn.addEventListener("click", () => {
    const state = PitchTrainGame.getState();
    if (!state || state.mode !== "singleNote" || !state.currentNote) return;
    const tier = PitchTrainGame.singleTierFor(state.difficulty);
    PitchTrainSound.playNote(state.currentNote.freq, QUESTION_NOTE_DURATION, tier.timbre, 0.22, 0);
  });
  playReferenceBtn.addEventListener("click", () => PitchTrainSound.playReference(440));

  noteAnswerGrid.addEventListener("click", (e) => {
    const btn = e.target.closest(".note-answer-btn");
    if (!btn || btn.disabled) return;
    PitchTrainGame.answerSingle(Number(btn.dataset.pitchClass));
  });

  nextNoteBtn.addEventListener("click", () => PitchTrainGame.nextSingleQuestion());

  // -- 旋律回奏 -----------------------------------------------------------------
  let degreeKeypadBuilt = false;
  function buildDegreeKeypad() {
    if (degreeKeypadBuilt) return;
    const frag = document.createDocumentFragment();
    PitchTrainGame.DEGREE_LABELS.forEach((label, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "degree-btn";
      btn.dataset.degree = String(i);
      btn.textContent = label;
      frag.appendChild(btn);
    });
    degreeKeypad.appendChild(frag);
    degreeKeypadBuilt = true;
  }

  function enableMelodyInput(enabled) {
    Array.from(degreeKeypad.children).forEach((btn) => {
      btn.disabled = !enabled;
    });
    undoTapBtn.disabled = !enabled;
  }

  function updateReplayLabel(state) {
    const tier = PitchTrainGame.melodyTierFor(state.difficulty);
    const remaining = tier.replayLimit - state.replaysUsed;
    replayCountLabel.textContent = tier.replayLimit === 0 ? "（只播放一次）" : "剩餘重播次數：" + Math.max(0, remaining);
    playMelodyBtn.disabled = state.status !== "melody-input" || remaining <= 0;
  }

  function renderLiveAttemptTrack(state) {
    melodyAttemptTrack.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (let i = 0; i < state.melody.length; i++) {
      const chip = document.createElement("span");
      if (i < state.playerAttempt.length) {
        chip.className = "attempt-chip";
        chip.textContent = PitchTrainGame.DEGREE_LABELS[state.playerAttempt[i]];
      } else {
        chip.className = "attempt-chip empty";
        chip.textContent = "?";
      }
      frag.appendChild(chip);
    }
    melodyAttemptTrack.appendChild(frag);
  }

  function renderResultTrack(state) {
    melodyResultTrack.innerHTML = "";
    const frag = document.createDocumentFragment();
    state.melody.forEach((degree, i) => {
      const chip = document.createElement("span");
      const picked = state.playerAttempt[i];
      const correct = state.melodyResult.perNote[i];
      const correctLabel = PitchTrainGame.DEGREE_LABELS[degree];
      chip.className = "attempt-chip " + (correct ? "correct" : "wrong");
      if (correct) {
        chip.textContent = correctLabel;
      } else {
        // Show the standard answer inline, not just via a hover title —
        // a title-only reveal is invisible on touch devices, which this
        // hub's audience skews toward.
        const pickedLabel = picked != null ? PitchTrainGame.DEGREE_LABELS[picked] : "—";
        chip.innerHTML =
          '<span class="chip-picked">' + pickedLabel + "</span>" +
          '<span class="chip-arrow">→</span>' +
          '<span class="chip-correct">' + correctLabel + "</span>";
      }
      frag.appendChild(chip);
    });
    melodyResultTrack.appendChild(frag);
  }

  function melodyNoteFreq(state, degreeIndex) {
    const midi = state.tonicMidi + PitchTrainGame.DEGREE_SEMITONES[degreeIndex];
    return PitchTrainGame.midiToFreq(midi);
  }

  // Schedules the actual audio for a melody playback (used for both the
  // automatic first play and any player-requested replay) — tonic
  // announcement only plays when practicing in random-key mode, since a
  // fixed-C session's tonic never changes round to round.
  function scheduleMelodyPlayback(state, onDone) {
    const tier = PitchTrainGame.melodyTierFor(state.difficulty);
    const noteDurationSec = Math.max(0.18, (tier.tempoMs * 0.82) / 1000);
    let t = 0;
    if (state.settings.melodyRandomKey) {
      schedule(() => PitchTrainSound.playReference(PitchTrainGame.midiToFreq(state.tonicMidi)), t);
      t += 750;
    }
    state.melody.forEach((degree, i) => {
      schedule(() => PitchTrainSound.playNote(melodyNoteFreq(state, degree), noteDurationSec, MELODY_NOTE_TIMBRE, 0.24, 0), t);
      t += tier.tempoMs;
    });
    schedule(onDone, t + 120);
  }

  function onMelodyRoundStart(state) {
    clearTimers();
    melodyBoard.classList.remove("hidden");
    singleNoteBoard.classList.add("hidden");
    buildDegreeKeypad();
    melodyHintText.textContent = "🔊 播放中，仔細聽…（共 " + state.melody.length + " 音）";
    renderLiveAttemptTrack(state);
    melodyResultBanner.textContent = "";
    melodyResultBanner.className = "result-banner";
    melodyResultTrack.classList.add("hidden");
    melodyAttemptTrack.classList.remove("hidden");
    nextMelodyBtn.classList.add("hidden");
    enableMelodyInput(false);
    playMelodyBtn.disabled = true;
    updateReplayLabel(state);
    scheduleMelodyPlayback(state, () => PitchTrainGame.markMelodyIntroDone());
  }

  function onMelodyInputReady(state) {
    melodyHintText.textContent = "換你了！依序點出你聽到的音";
    enableMelodyInput(true);
    updateReplayLabel(state);
  }

  function onMelodyReplay(state) {
    melodyHintText.textContent = "🔊 播放中，仔細聽…（共 " + state.melody.length + " 音）";
    enableMelodyInput(false);
    playMelodyBtn.disabled = true;
    updateReplayLabel(state);
    scheduleMelodyPlayback(state, () => {
      melodyHintText.textContent = "換你了！依序點出你聽到的音";
      enableMelodyInput(true);
      updateReplayLabel(PitchTrainGame.getState());
    });
  }

  function onMelodyTap(state) {
    renderLiveAttemptTrack(state);
    undoTapBtn.disabled = state.playerAttempt.length === 0;
  }

  function onMelodyResult(state, extra) {
    clearTimers();
    enableMelodyInput(false);
    playMelodyBtn.disabled = true;
    melodyAttemptTrack.classList.add("hidden");
    melodyResultTrack.classList.remove("hidden");
    renderResultTrack(state);
    melodyResultBanner.textContent = extra.fullyCorrect
      ? "✅ 完全正確！(" + state.melodyResult.matched + "/" + state.melodyResult.total + ")"
      : "❌ 有些音不對 (" + state.melodyResult.matched + "/" + state.melodyResult.total + ")";
    melodyResultBanner.className = "result-banner " + (extra.fullyCorrect ? "tone-correct" : "tone-wrong");
    PitchTrainSound.play(extra.fullyCorrect ? "correct" : "wrong", { streak: state.streak });
    if (extra.milestone) celebrate(state.streak);
    nextMelodyBtn.classList.remove("hidden");
  }

  playMelodyBtn.addEventListener("click", () => {
    const state = PitchTrainGame.getState();
    if (!state || state.mode !== "melody") return;
    if (PitchTrainGame.requestMelodyReplay()) onMelodyReplay(PitchTrainGame.getState());
  });

  degreeKeypad.addEventListener("click", (e) => {
    const btn = e.target.closest(".degree-btn");
    if (!btn || btn.disabled) return;
    PitchTrainSound.play("tap");
    PitchTrainGame.tapMelodyDegree(Number(btn.dataset.degree));
  });

  undoTapBtn.addEventListener("click", () => PitchTrainGame.undoMelodyTap());
  nextMelodyBtn.addEventListener("click", () => PitchTrainGame.startMelodyRound());

  // -- session end / navigation -------------------------------------------
  function renderSessionEnd(summary) {
    sessionEndTitle.textContent = "🎧 本輪練習成果";
    sessionEndSubtitle.textContent = MODE_LABELS[summary.mode] + " · " + DIFFICULTY_LABELS[summary.difficulty];
    sessionEndStats.innerHTML =
      statRow("最長連續答對", summary.streak + " 次") +
      statRow("正確率", formatPercent(summary.accuracy)) +
      statRow("作答題數", String(summary.answered)) +
      (summary.isNewBestStreak ? statRow("紀錄", "🏆 最佳連續紀錄！") : "") +
      (summary.isNewBestAccuracy ? statRow("紀錄", "🏆 最佳正確率！") : "");
    sessionEndModal.classList.remove("hidden");
  }

  backHomeBtn.addEventListener("click", () => {
    clearTimers();
    const summary = PitchTrainGame.endSession();
    if (summary && summary.answered > 0) {
      renderSessionEnd(summary);
    } else {
      renderHome();
      showView("home");
    }
  });

  sessionEndCloseBtn.addEventListener("click", () => {
    sessionEndModal.classList.add("hidden");
    PitchTrainGame.startSession(lastMode, lastDifficulty);
  });
  sessionEndHomeBtn.addEventListener("click", () => {
    sessionEndModal.classList.add("hidden");
    renderHome();
    showView("home");
  });

  // -- dispatch -----------------------------------------------------------------
  function render(state, event, extra) {
    if (!state) return;
    renderToolbar(state);
    switch (event) {
      case "single-question":
        onSingleQuestion(state);
        break;
      case "single-answer":
        onSingleAnswer(state, extra);
        break;
      case "melody-round-start":
        onMelodyRoundStart(state);
        break;
      case "melody-input-ready":
        onMelodyInputReady(state);
        break;
      case "melody-replay":
        // handled synchronously by the playMelodyBtn click handler itself
        break;
      case "melody-tap":
        onMelodyTap(state);
        break;
      case "melody-result":
        onMelodyResult(state, extra);
        break;
      default:
        break;
    }
  }

  // -- boot -----------------------------------------------------------------
  PitchTrainSound.setEnabled(PitchTrainStorage.getSettings().soundEnabled !== false);
  PitchTrainGame.onChange(render);
  applyTheme(GameHubStorage.getTheme());
  renderHome();
  showView("home");
})();
