// The only file that touches the DOM. Renders RelativePitchGame's state to
// both practice boards, orchestrates audio-playback timing via setTimeout
// chains (RelativePitchGame itself only exposes discrete step functions,
// same separation pitchTrain/js/ui.js and shellGame/js/ui.js established),
// and maps events to sound + celebratory visual effects.
(function () {
  const MODE_LABELS = { singleDegree: "單音辨識", melody: "旋律回奏", chord: "和弦練習" };
  const DIFFICULTY_LABELS = { superEasy: "超簡單", easy: "簡單", medium: "中等", hard: "困難", expert: "專家" };
  const MODE_DESCRIPTIONS = {
    singleDegree: "先聽 do，再聽一個音，猜猜是第幾級（1~7、i，或加開半音階的 #1 #2 #4 #5 #6）。",
    melody: "先聽 do，再聽一小段取自真實和弦走向的旋律，用鋼琴鍵盤或簡譜鍵盤依序點出你聽到的音。",
    chord: "先聽 do，「級數聽辨」再聽 I 級和弦當參考、接著聽目標和弦猜級數；「色彩聽辨」直接猜和弦的大小/色彩。",
  };
  const CHORD_SUB_MODE_LABELS = { progression: "級數聽辨", quality: "色彩聽辨" };
  const PARTICLE_GLYPHS = ["✨", "🎵", "⭐", "🎶", "🎉"];
  const CONFETTI_COLORS = ["#f43f5e", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];
  const MELODY_NOTE_TIMBRE = ["triangle"];
  const SINGLE_NOTE_DURATION = 0.9;
  const PIANO_BOUNDARIES = [1, 2, 4, 5, 6]; // white-key-row boundary positions for the 5 black keys

  // -- home view elements ---------------------------------------------------
  const homeViewEl = document.getElementById("homeView");
  const themeSelect = document.getElementById("themeSelect");
  const instructionsBtn = document.getElementById("instructionsBtn");
  const soundToggleBtn = document.getElementById("soundToggleBtn");
  const modeTabButtons = Array.from(document.querySelectorAll(".mode-tab"));
  const modeDescriptionEl = document.getElementById("modeDescription");
  const chordSubModeTabsEl = document.getElementById("chordSubModeTabs");
  const chordSubModeButtons = Array.from(document.querySelectorAll(".chord-sub-mode-tab"));
  const inputModeButtons = Array.from(document.querySelectorAll(".input-mode-tab"));
  const includeChromaticToggle = document.getElementById("includeChromaticToggle");
  const octaveRangeButtons = Array.from(document.querySelectorAll(".octave-range-tab"));
  const weaknessFocusToggle = document.getElementById("weaknessFocusToggle");
  const difficultyButtons = Array.from(document.querySelectorAll(".difficulty-btn"));
  const historyBtn = document.getElementById("historyBtn");
  const careerBtn = document.getElementById("careerBtn");
  const weaknessBtn = document.getElementById("weaknessBtn");

  // -- game view elements -----------------------------------------------------
  const gameViewEl = document.getElementById("gameView");
  const backHomeBtn = document.getElementById("backHomeBtn");
  const difficultyLabel = document.getElementById("difficultyLabel");
  const streakDisplay = document.getElementById("streakDisplay");
  const accuracyDisplay = document.getElementById("accuracyDisplay");
  const answeredDisplay = document.getElementById("answeredDisplay");
  const gameSoundToggleBtn = document.getElementById("gameSoundToggleBtn");
  const gameInstructionsBtn = document.getElementById("gameInstructionsBtn");

  const singleDegreeBoard = document.getElementById("singleDegreeBoard");
  const playReferenceAgainBtn = document.getElementById("playReferenceAgainBtn");
  const playSingleDegreeBtn = document.getElementById("playSingleDegreeBtn");
  const singlePianoKeyboard = document.getElementById("singlePianoKeyboard");
  const singleDegreeKeypad = document.getElementById("singleDegreeKeypad");
  const singleDegreeResultBanner = document.getElementById("singleDegreeResultBanner");
  const songHintBtn = document.getElementById("songHintBtn");
  const nextDegreeBtn = document.getElementById("nextDegreeBtn");

  const melodyBoard = document.getElementById("melodyBoard");
  const melodyHintText = document.getElementById("melodyHintText");
  const playMelodyReferenceBtn = document.getElementById("playMelodyReferenceBtn");
  const playMelodyBtn = document.getElementById("playMelodyBtn");
  const replayCountLabel = document.getElementById("replayCountLabel");
  const melodyAttemptTrack = document.getElementById("melodyAttemptTrack");
  const melodyPianoKeyboard = document.getElementById("melodyPianoKeyboard");
  const melodyDegreeKeypad = document.getElementById("melodyDegreeKeypad");
  const undoTapBtn = document.getElementById("undoTapBtn");
  const melodyResultBanner = document.getElementById("melodyResultBanner");
  const melodyResultTrack = document.getElementById("melodyResultTrack");
  const nextMelodyBtn = document.getElementById("nextMelodyBtn");

  const chordBoard = document.getElementById("chordBoard");
  const chordHintText = document.getElementById("chordHintText");
  const playChordReferenceAgainBtn = document.getElementById("playChordReferenceAgainBtn");
  const playChordAgainBtn = document.getElementById("playChordAgainBtn");
  const chordAnswerGrid = document.getElementById("chordAnswerGrid");
  const chordResultBanner = document.getElementById("chordResultBanner");
  const nextChordBtn = document.getElementById("nextChordBtn");

  // -- history / career view elements -----------------------------------------
  const historyViewEl = document.getElementById("historyView");
  const historyBackBtn = document.getElementById("historyBackBtn");
  const historyList = document.getElementById("historyList");
  const careerViewEl = document.getElementById("careerView");
  const careerBackBtn = document.getElementById("careerBackBtn");
  const careerTableSingle = document.getElementById("careerTableSingle");
  const careerTableMelody = document.getElementById("careerTableMelody");
  const careerTableChord = document.getElementById("careerTableChord");
  const weaknessViewEl = document.getElementById("weaknessView");
  const weaknessBackBtn = document.getElementById("weaknessBackBtn");
  const weaknessBarsSingle = document.getElementById("weaknessBarsSingle");
  const weaknessBarsMelody = document.getElementById("weaknessBarsMelody");
  const weaknessConfusionList = document.getElementById("weaknessConfusionList");

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

  const views = {
    home: homeViewEl,
    game: gameViewEl,
    history: historyViewEl,
    career: careerViewEl,
    weakness: weaknessViewEl,
  };
  function showView(name) {
    Object.entries(views).forEach(([key, el]) => el.classList.toggle("hidden", key !== name));
  }

  function applyTheme(themeKey) {
    document.documentElement.dataset.theme = themeKey;
  }

  function applySoundButtonState(btn, compact) {
    const on = RelativePitchSound.isEnabled();
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = compact ? (on ? "🔊" : "🔇") : on ? "🔊 音效：開" : "🔇 音效：關";
  }
  function toggleSound() {
    const next = !RelativePitchSound.isEnabled();
    RelativePitchSound.setEnabled(next);
    RelativePitchStorage.saveSettings({ soundEnabled: next });
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
  let selectedMode = "singleDegree";
  let lastMode = "singleDegree";
  let lastDifficulty = "superEasy";

  function renderHome() {
    themeSelect.value = GameHubStorage.getTheme();
    applySoundButtonState(soundToggleBtn, false);
    applySoundButtonState(gameSoundToggleBtn, true);
    modeTabButtons.forEach((btn) => btn.setAttribute("aria-pressed", btn.dataset.mode === selectedMode ? "true" : "false"));
    modeDescriptionEl.textContent = MODE_DESCRIPTIONS[selectedMode];
    chordSubModeTabsEl.classList.toggle("hidden", selectedMode !== "chord");
    const settings = RelativePitchStorage.getSettings();
    chordSubModeButtons.forEach((btn) =>
      btn.setAttribute("aria-pressed", btn.dataset.chordSubMode === settings.chordSubMode ? "true" : "false")
    );
    inputModeButtons.forEach((btn) =>
      btn.setAttribute("aria-pressed", btn.dataset.inputMode === settings.inputMode ? "true" : "false")
    );
    includeChromaticToggle.checked = !!settings.includeChromatic;
    octaveRangeButtons.forEach((btn) =>
      btn.setAttribute("aria-pressed", btn.dataset.octaveRange === settings.octaveRange ? "true" : "false")
    );
    weaknessFocusToggle.checked = !!settings.weaknessFocus;
  }

  modeTabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedMode = btn.dataset.mode;
      renderHome();
    });
  });
  chordSubModeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      RelativePitchStorage.saveSettings({ chordSubMode: btn.dataset.chordSubMode });
      renderHome();
    });
  });
  inputModeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      RelativePitchStorage.saveSettings({ inputMode: btn.dataset.inputMode });
      renderHome();
    });
  });
  includeChromaticToggle.addEventListener("change", () => {
    RelativePitchStorage.saveSettings({ includeChromatic: includeChromaticToggle.checked });
  });
  octaveRangeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      RelativePitchStorage.saveSettings({ octaveRange: btn.dataset.octaveRange });
      renderHome();
    });
  });
  weaknessFocusToggle.addEventListener("change", () => {
    RelativePitchStorage.saveSettings({ weaknessFocus: weaknessFocusToggle.checked });
  });

  difficultyButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      lastMode = selectedMode;
      lastDifficulty = btn.dataset.difficulty;
      RelativePitchGame.startSession(lastMode, lastDifficulty);
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
  weaknessBtn.addEventListener("click", () => {
    renderWeakness();
    showView("weakness");
  });
  historyBackBtn.addEventListener("click", () => {
    renderHome();
    showView("home");
  });
  careerBackBtn.addEventListener("click", () => {
    renderHome();
    showView("home");
  });
  weaknessBackBtn.addEventListener("click", () => {
    renderHome();
    showView("home");
  });

  // -- history / career rendering ----------------------------------------------
  function renderHistory() {
    const items = RelativePitchStorage.getHistory();
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
    RelativePitchGame.DIFFICULTY_ORDER.forEach((code) => {
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
    const career = RelativePitchStorage.getCareer();
    renderCareerTable(careerTableSingle, career.singleDegree);
    renderCareerTable(careerTableMelody, career.melody);
    renderCareerTable(careerTableChord, career.chord);
  }

  // -- weakness analytics rendering --------------------------------------
  // All 12 non-octave degree slots (FULL_DEGREE_LABELS index 12 is "i",
  // the octave — not worth a weakness bar of its own).
  const WEAKNESS_DEGREE_INDICES = Array.from({ length: 12 }, (_, i) => i);
  const MIN_CONFUSION_COUNT = 3;

  function renderWeaknessBars(container, mode) {
    const stats = RelativePitchStorage.getDegreeStats();
    const rows = WEAKNESS_DEGREE_INDICES.map((index) => {
      const entry = stats[mode + ":" + index];
      return {
        label: RelativePitchGame.FULL_DEGREE_LABELS[index],
        attempts: entry ? entry.attempts : 0,
        accuracy: entry && entry.attempts > 0 ? entry.correct / entry.attempts : null,
      };
    }).filter((row) => row.attempts > 0);

    container.innerHTML = "";
    if (rows.length === 0) {
      container.innerHTML = '<div class="empty-state">還沒有足夠的作答紀錄</div>';
      return;
    }
    rows.sort((a, b) => a.accuracy - b.accuracy);
    const frag = document.createDocumentFragment();
    rows.forEach((row) => {
      const wrap = document.createElement("div");
      wrap.className = "weakness-bar-row";
      const pct = Math.round(row.accuracy * 100);
      wrap.innerHTML =
        '<span class="weakness-bar-label">' + row.label + "</span>" +
        '<span class="weakness-bar-track"><span class="weakness-bar-fill" style="width:' + pct + '%"></span></span>' +
        '<span class="weakness-bar-value">' + pct + "%（" + row.attempts + " 次）</span>";
      frag.appendChild(wrap);
    });
    container.appendChild(frag);
  }

  function renderWeaknessConfusion() {
    const confusion = RelativePitchStorage.getConfusion();
    const entries = Object.keys(confusion)
      .map((pairKey) => ({ pairKey, count: confusion[pairKey] }))
      .filter((e) => e.count >= MIN_CONFUSION_COUNT && e.pairKey.indexOf("→") !== -1)
      .sort((a, b) => b.count - a.count);

    weaknessConfusionList.innerHTML = "";
    if (entries.length === 0) {
      weaknessConfusionList.innerHTML = '<div class="empty-state">還沒有明顯的混淆組合（需要每組至少答錯 ' + MIN_CONFUSION_COUNT + ' 次）</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    entries.forEach(({ pairKey, count }) => {
      const [wrongSide, pickedSide] = pairKey.split("→");
      const [mode, wrongIndex] = wrongSide.split(":");
      const [, pickedIndex] = pickedSide.split(":");
      const modeLabel = MODE_LABELS[mode] || mode;
      const wrongLabel = RelativePitchGame.FULL_DEGREE_LABELS[Number(wrongIndex)];
      const pickedLabel = RelativePitchGame.FULL_DEGREE_LABELS[Number(pickedIndex)];
      const row = document.createElement("div");
      row.className = "record-row";
      row.innerHTML =
        '<span class="record-tag">' + modeLabel + "</span>" +
        "<span>正確是 " + wrongLabel + "，卻常聽成 " + pickedLabel + "（" + count + " 次）</span>";
      frag.appendChild(row);
    });
    weaknessConfusionList.appendChild(frag);
  }

  function renderWeakness() {
    renderWeaknessBars(weaknessBarsSingle, "singleDegree");
    renderWeaknessBars(weaknessBarsMelody, "melody");
    renderWeaknessConfusion();
  }

  // -- toolbar ------------------------------------------------------------
  function renderToolbar(state) {
    difficultyLabel.textContent = MODE_LABELS[state.mode] + " · " + DIFFICULTY_LABELS[state.difficulty];
    streakDisplay.textContent = String(state.streak) + (state.streak >= 3 ? " 🔥".repeat(Math.min(5, state.streak - 2)) : "");
    accuracyDisplay.textContent = state.sessionAnswered > 0 ? formatPercent(state.sessionCorrect / state.sessionAnswered) : "--";
    answeredDisplay.textContent = String(state.sessionAnswered);
  }

  // -- celebration effects (adapted from pitchTrain/js/ui.js) ---------------
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
    RelativePitchSound.play("milestone");
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

  // -- shared input widgets: piano keyboard + 簡譜 keypad ----------------------
  // Both modes (單音辨識/旋律回奏) get their own instance of each widget
  // (built via these same two functions) rather than literally sharing one
  // DOM node — simpler than moving a shared node between two different
  // surrounding layouts, and every instance ends up wired identically.
  function buildPianoKeyboard(container) {
    container.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "piano-keyboard-wrap";
    const inner = document.createElement("div");
    inner.className = "piano-keyboard";
    const whiteWrap = document.createElement("div");
    whiteWrap.className = "piano-white-keys";
    RelativePitchGame.DIATONIC_INDICES.forEach((degreeIndex) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn piano-white-key";
      btn.dataset.degree = String(degreeIndex);
      btn.innerHTML = '<span class="piano-key-label">' + RelativePitchGame.FULL_DEGREE_LABELS[degreeIndex] + "</span>";
      whiteWrap.appendChild(btn);
    });
    const blackWrap = document.createElement("div");
    blackWrap.className = "piano-black-keys";
    RelativePitchGame.CHROMATIC_INDICES.forEach((degreeIndex, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "piano-black-key";
      btn.dataset.degree = String(degreeIndex);
      btn.style.left = (PIANO_BOUNDARIES[i] / 8) * 100 + "%";
      btn.innerHTML = '<span class="piano-key-label"></span>';
      blackWrap.appendChild(btn);
    });
    inner.appendChild(whiteWrap);
    inner.appendChild(blackWrap);
    wrap.appendChild(inner);
    container.appendChild(wrap);
  }

  function buildDegreeKeypad(container) {
    container.innerHTML = "";
    container.className = "degree-keypad";
    const diatonicRow = document.createElement("div");
    diatonicRow.className = "degree-row degree-row-diatonic";
    RelativePitchGame.DIATONIC_INDICES.forEach((degreeIndex) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn degree-btn";
      btn.dataset.degree = String(degreeIndex);
      btn.textContent = RelativePitchGame.FULL_DEGREE_LABELS[degreeIndex];
      diatonicRow.appendChild(btn);
    });
    const chromaticRow = document.createElement("div");
    chromaticRow.className = "degree-row degree-row-chromatic";
    RelativePitchGame.CHROMATIC_INDICES.forEach((degreeIndex) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn degree-btn degree-btn-chromatic";
      btn.dataset.degree = String(degreeIndex);
      btn.textContent = RelativePitchGame.FULL_DEGREE_LABELS[degreeIndex];
      chromaticRow.appendChild(btn);
    });
    container.appendChild(diatonicRow);
    container.appendChild(chromaticRow);
  }

  // Black keys are real <button disabled> elements when chromatic is off —
  // real disabled-button semantics (no click ever fires) rather than a
  // pointer-events hack, so the same enableInputContainer() below works
  // uniformly for every key regardless of white/black.
  function applyChromaticModeToPiano(container, includeChromatic) {
    Array.from(container.querySelectorAll(".piano-black-key")).forEach((btn) => {
      btn.classList.toggle("decorative", !includeChromatic);
      btn.disabled = !includeChromatic;
      btn.querySelector(".piano-key-label").textContent = includeChromatic
        ? RelativePitchGame.FULL_DEGREE_LABELS[Number(btn.dataset.degree)]
        : "";
    });
  }
  function applyChromaticModeToKeypad(container, includeChromatic) {
    container.querySelector(".degree-row-chromatic").classList.toggle("hidden", !includeChromatic);
  }

  function enableInputContainer(container, enabled) {
    Array.from(container.querySelectorAll("[data-degree]")).forEach((btn) => {
      if (btn.classList.contains("decorative")) {
        btn.disabled = true;
        return;
      }
      btn.disabled = !enabled;
    });
  }

  function clearInputMarks(container) {
    Array.from(container.querySelectorAll("[data-degree]")).forEach((btn) => {
      btn.classList.remove("picked-correct", "picked-wrong", "reveal-correct");
    });
  }

  function tapDegree(index) {
    const state = RelativePitchGame.getState();
    if (!state) return;
    RelativePitchSound.play("tap");
    if (state.mode === "singleDegree") RelativePitchGame.answerSingle(index);
    else RelativePitchGame.tapMelodyDegree(index);
  }

  function wireInputContainer(container) {
    container.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-degree]");
      if (!btn || btn.disabled) return;
      tapDegree(Number(btn.dataset.degree));
    });
  }
  [singlePianoKeyboard, singleDegreeKeypad, melodyPianoKeyboard, melodyDegreeKeypad].forEach(wireInputContainer);

  // Rebuilds a mode's pair of input widgets only when the settings that
  // affect their shape (inputMode/includeChromatic) actually changed since
  // the last build — settings are fixed for the whole session (chosen on
  // the home screen), so in practice this only rebuilds once per session,
  // not once per question/round.
  const builtSettingsKey = { single: null, melody: null };
  const inputContainers = {
    single: { piano: singlePianoKeyboard, degree: singleDegreeKeypad },
    melody: { piano: melodyPianoKeyboard, degree: melodyDegreeKeypad },
  };
  function ensureInputBuilt(kind, state) {
    const key = state.settings.inputMode + ":" + state.settings.includeChromatic;
    const c = inputContainers[kind];
    if (builtSettingsKey[kind] !== key) {
      buildPianoKeyboard(c.piano);
      buildDegreeKeypad(c.degree);
      applyChromaticModeToPiano(c.piano, state.settings.includeChromatic);
      applyChromaticModeToKeypad(c.degree, state.settings.includeChromatic);
      builtSettingsKey[kind] = key;
    }
    c.piano.classList.toggle("hidden", state.settings.inputMode !== "piano");
    c.degree.classList.toggle("hidden", state.settings.inputMode !== "degree");
  }

  // -- 單音辨識 -----------------------------------------------------------------
  function scheduleSingleDegreePlayback(state, onDone) {
    const tier = RelativePitchGame.singleTierFor(state.difficulty);
    schedule(() => RelativePitchSound.playReference(RelativePitchGame.midiToFreq(state.tonicMidi)), 0);
    schedule(
      () => RelativePitchSound.playNote(RelativePitchGame.midiToFreq(state.currentDegree.midi), SINGLE_NOTE_DURATION, tier.timbre, 0.22, 0),
      750
    );
    schedule(onDone, 750 + SINGLE_NOTE_DURATION * 1000 + 150);
  }

  function onSingleQuestion(state) {
    clearTimers();
    singleDegreeBoard.classList.remove("hidden");
    melodyBoard.classList.add("hidden");
    chordBoard.classList.add("hidden");
    ensureInputBuilt("single", state);
    clearInputMarks(singlePianoKeyboard);
    clearInputMarks(singleDegreeKeypad);
    enableInputContainer(singlePianoKeyboard, false);
    enableInputContainer(singleDegreeKeypad, false);
    singleDegreeResultBanner.textContent = "";
    singleDegreeResultBanner.className = "result-banner";
    nextDegreeBtn.classList.add("hidden");
    songHintBtn.classList.add("hidden");
    scheduleSingleDegreePlayback(state, () => {
      enableInputContainer(singlePianoKeyboard, true);
      enableInputContainer(singleDegreeKeypad, true);
    });
  }

  // 答答兩拍… 沒有，直接照 noteSequence 的 duration 依序播放，duration 的單位
  // 是「拍」，乘上 hintEntry.tempo（每拍幾毫秒）換算成排程間隔。
  function scheduleSongHint(tonicMidi, hintEntry, onDone) {
    let t = 0;
    hintEntry.noteSequence.forEach((note) => {
      const durationSec = Math.max(0.12, (note.duration * hintEntry.tempo * 0.85) / 1000);
      schedule(
        () => RelativePitchSound.playNote(RelativePitchGame.midiToFreq(tonicMidi + note.degree), durationSec, MELODY_NOTE_TIMBRE, 0.24, 0),
        t
      );
      t += note.duration * hintEntry.tempo;
    });
    schedule(onDone, t + 150);
  }

  function markPickedAndCorrect(container, lastResult, correct) {
    const pickedBtn = container.querySelector('[data-degree="' + lastResult.pickedIndex + '"]');
    if (pickedBtn) pickedBtn.classList.add(correct ? "picked-correct" : "picked-wrong");
    if (!correct) {
      const correctBtn = container.querySelector('[data-degree="' + lastResult.correctIndex + '"]');
      if (correctBtn) correctBtn.classList.add("reveal-correct");
    }
  }

  function onSingleAnswer(state, extra) {
    enableInputContainer(singlePianoKeyboard, false);
    enableInputContainer(singleDegreeKeypad, false);
    markPickedAndCorrect(singlePianoKeyboard, state.lastResult, extra.correct);
    markPickedAndCorrect(singleDegreeKeypad, state.lastResult, extra.correct);
    singleDegreeResultBanner.textContent = extra.correct
      ? "✅ 答對了！是 " + state.currentDegree.label
      : "❌ 答錯了，正確答案是 " + state.currentDegree.label;
    singleDegreeResultBanner.className = "result-banner " + (extra.correct ? "tone-correct" : "tone-wrong");
    RelativePitchSound.play(extra.correct ? "correct" : "wrong", { streak: state.streak });
    if (extra.milestone) celebrate(state.streak);
    nextDegreeBtn.classList.remove("hidden");
    const hintEntry = !extra.correct && RelativePitchGame.INTERVAL_SONG_HINTS[state.currentDegree.index];
    songHintBtn.classList.toggle("hidden", !hintEntry);
    if (hintEntry) songHintBtn.textContent = "🎵 聽「" + hintEntry.name + "」提示";
  }

  songHintBtn.addEventListener("click", () => {
    const state = RelativePitchGame.getState();
    if (!state || state.mode !== "singleDegree" || !state.currentDegree) return;
    const hintEntry = RelativePitchGame.INTERVAL_SONG_HINTS[state.currentDegree.index];
    if (!hintEntry) return;
    scheduleSongHint(state.tonicMidi, hintEntry, () => {});
  });

  playReferenceAgainBtn.addEventListener("click", () => {
    const state = RelativePitchGame.getState();
    if (!state || state.mode !== "singleDegree") return;
    RelativePitchSound.playReference(RelativePitchGame.midiToFreq(state.tonicMidi));
  });
  playSingleDegreeBtn.addEventListener("click", () => {
    const state = RelativePitchGame.getState();
    if (!state || state.mode !== "singleDegree" || !state.currentDegree) return;
    const tier = RelativePitchGame.singleTierFor(state.difficulty);
    RelativePitchSound.playNote(RelativePitchGame.midiToFreq(state.currentDegree.midi), SINGLE_NOTE_DURATION, tier.timbre, 0.22, 0);
  });
  nextDegreeBtn.addEventListener("click", () => RelativePitchGame.nextSingleQuestion());

  // -- 旋律回奏 -----------------------------------------------------------------
  function melodyNoteFreq(state, degreeIndex) {
    // FULL_DEGREE_LABELS is a "one slot per semitone" array, so the degree
    // index IS the semitone offset from the tonic — no separate semitone
    // lookup table needed.
    return RelativePitchGame.midiToFreq(state.tonicMidi + degreeIndex);
  }

  // Two-beat "答答" count-in (at the melody's own tempo, so the tick
  // spacing previews the beat the melody will play at) immediately
  // followed by the melody notes themselves — this is the reusable core
  // shared by both the automatic round-start intro (which prepends "do")
  // and the standalone "replay the question" button (which does not).
  function scheduleCountInAndMelody(state, startT, onDone) {
    const tier = RelativePitchGame.melodyTierFor(state.difficulty);
    const noteDurationSec = Math.max(0.16, (tier.tempoMs * 0.82) / 1000);
    let t = startT;
    schedule(() => RelativePitchSound.play("tick"), t);
    t += tier.tempoMs;
    schedule(() => RelativePitchSound.play("tick"), t);
    t += tier.tempoMs;
    state.melody.forEach((degree) => {
      schedule(() => RelativePitchSound.playNote(melodyNoteFreq(state, degree), noteDurationSec, MELODY_NOTE_TIMBRE, 0.24, 0), t);
      t += tier.tempoMs;
    });
    schedule(onDone, t + 120);
  }

  // Full round-start intro: do -> (750ms) -> 答答 count-in -> melody.
  function scheduleMelodyIntro(state, onDone) {
    schedule(() => RelativePitchSound.playReference(RelativePitchGame.midiToFreq(state.tonicMidi)), 0);
    scheduleCountInAndMelody(state, 750, onDone);
  }

  // Replay of just the question (答答 count-in -> melody, no "do" —
  // there's now a separate always-available button for replaying "do"
  // alone, see playMelodyReferenceBtn below). Unlimited, same as "再聽一次
  // Do" — the only gate is being in the input phase of the round.
  function scheduleMelodyReplay(state, onDone) {
    scheduleCountInAndMelody(state, 0, onDone);
  }

  function updateReplayLabel(state) {
    replayCountLabel.textContent = "可重播不限次數";
    playMelodyBtn.disabled = state.status !== "melody-input";
  }

  function renderLiveAttemptTrack(state) {
    melodyAttemptTrack.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (let i = 0; i < state.melody.length; i++) {
      const chip = document.createElement("span");
      if (i < state.playerAttempt.length) {
        chip.className = "attempt-chip";
        chip.textContent = RelativePitchGame.FULL_DEGREE_LABELS[state.playerAttempt[i]];
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
      const correctLabel = RelativePitchGame.FULL_DEGREE_LABELS[degree];
      chip.className = "attempt-chip " + (correct ? "correct" : "wrong");
      if (correct) {
        chip.textContent = correctLabel;
      } else {
        // Show the standard answer inline, not just via a hover title —
        // a title-only reveal is invisible on touch devices, which this
        // hub's audience skews toward.
        const pickedLabel = picked != null ? RelativePitchGame.FULL_DEGREE_LABELS[picked] : "—";
        chip.innerHTML =
          '<span class="chip-picked">' + pickedLabel + "</span>" +
          '<span class="chip-arrow">→</span>' +
          '<span class="chip-correct">' + correctLabel + "</span>";
      }
      frag.appendChild(chip);
    });
    melodyResultTrack.appendChild(frag);
  }

  function onMelodyRoundStart(state) {
    clearTimers();
    melodyBoard.classList.remove("hidden");
    singleDegreeBoard.classList.add("hidden");
    chordBoard.classList.add("hidden");
    ensureInputBuilt("melody", state);
    clearInputMarks(melodyPianoKeyboard);
    clearInputMarks(melodyDegreeKeypad);
    const progressionTag = state.progressionName ? "《" + state.progressionName + "》" : "";
    melodyHintText.textContent =
      "🔊 播放中：先報 do，答答兩拍後開始旋律…（共 " + state.melody.length + " 個音，取自" + progressionTag + "的和弦琶音）";
    renderLiveAttemptTrack(state);
    melodyResultBanner.textContent = "";
    melodyResultBanner.className = "result-banner";
    melodyResultTrack.classList.add("hidden");
    melodyAttemptTrack.classList.remove("hidden");
    nextMelodyBtn.classList.add("hidden");
    enableInputContainer(melodyPianoKeyboard, false);
    enableInputContainer(melodyDegreeKeypad, false);
    playMelodyBtn.disabled = true;
    updateReplayLabel(state);
    scheduleMelodyIntro(state, () => RelativePitchGame.markMelodyIntroDone());
  }

  function onMelodyInputReady(state) {
    melodyHintText.textContent = "換你了！依序點出你聽到的音";
    enableInputContainer(melodyPianoKeyboard, true);
    enableInputContainer(melodyDegreeKeypad, true);
    updateReplayLabel(state);
  }

  function onMelodyReplay(state) {
    melodyHintText.textContent = "🔊 播放中：答答兩拍後開始旋律…（共 " + state.melody.length + " 個音）";
    // (progression name already shown once at round start; replay keeps it brief)
    enableInputContainer(melodyPianoKeyboard, false);
    enableInputContainer(melodyDegreeKeypad, false);
    playMelodyBtn.disabled = true;
    updateReplayLabel(state);
    scheduleMelodyReplay(state, () => {
      melodyHintText.textContent = "換你了！依序點出你聽到的音";
      enableInputContainer(melodyPianoKeyboard, true);
      enableInputContainer(melodyDegreeKeypad, true);
      updateReplayLabel(RelativePitchGame.getState());
    });
  }

  function onMelodyTap(state) {
    renderLiveAttemptTrack(state);
    undoTapBtn.disabled = state.playerAttempt.length === 0;
  }

  function onMelodyResult(state, extra) {
    clearTimers();
    enableInputContainer(melodyPianoKeyboard, false);
    enableInputContainer(melodyDegreeKeypad, false);
    playMelodyBtn.disabled = true;
    melodyAttemptTrack.classList.add("hidden");
    melodyResultTrack.classList.remove("hidden");
    renderResultTrack(state);
    melodyResultBanner.textContent = extra.fullyCorrect
      ? "✅ 完全正確！(" + state.melodyResult.matched + "/" + state.melodyResult.total + ")"
      : "❌ 有些音不對 (" + state.melodyResult.matched + "/" + state.melodyResult.total + ")";
    melodyResultBanner.className = "result-banner " + (extra.fullyCorrect ? "tone-correct" : "tone-wrong");
    RelativePitchSound.play(extra.fullyCorrect ? "correct" : "wrong", { streak: state.streak });
    if (extra.milestone) celebrate(state.streak);
    nextMelodyBtn.classList.remove("hidden");
  }

  playMelodyBtn.addEventListener("click", () => {
    const state = RelativePitchGame.getState();
    if (!state || state.mode !== "melody") return;
    if (RelativePitchGame.requestMelodyReplay()) onMelodyReplay(RelativePitchGame.getState());
  });
  // Re-listening to "do" is unlimited and independent of the question's
  // replayLimit — same pattern as 單音辨識's playReferenceAgainBtn.
  playMelodyReferenceBtn.addEventListener("click", () => {
    const state = RelativePitchGame.getState();
    if (!state || state.mode !== "melody") return;
    RelativePitchSound.playReference(RelativePitchGame.midiToFreq(state.tonicMidi));
  });
  undoTapBtn.addEventListener("click", () => RelativePitchGame.undoMelodyTap());
  nextMelodyBtn.addEventListener("click", () => RelativePitchGame.startMelodyRound());

  // -- 和弦練習 -----------------------------------------------------------------
  const CHORD_NOTE_DURATION = 1.1;

  function chordFreqs(midiNotes) {
    return midiNotes.map((m) => RelativePitchGame.midiToFreq(m));
  }

  // Answer choices are the full theoretical set (all 7 roman numerals, or
  // all 6 chord qualities) regardless of difficulty tier — same convention
  // as the degree keypad, where the tier narrows what's ASKED, not what's
  // answerable.
  let builtChordSubMode = null;
  function buildChordAnswerGrid(subMode) {
    chordAnswerGrid.innerHTML = "";
    const items =
      subMode === "quality"
        ? Object.keys(RelativePitchGame.CHORD_QUALITIES).map((key) => ({
            value: key,
            label: RelativePitchGame.CHORD_QUALITIES[key].label,
          }))
        : Object.keys(RelativePitchGame.DIATONIC_CHORD_MAP).map((degreeIndex) => {
            const roman = RelativePitchGame.DIATONIC_CHORD_MAP[degreeIndex].roman;
            return { value: roman, label: roman };
          });
    const frag = document.createDocumentFragment();
    items.forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn chord-answer-btn";
      btn.dataset.chordAnswer = item.value;
      btn.textContent = item.label;
      frag.appendChild(btn);
    });
    chordAnswerGrid.appendChild(frag);
  }
  function ensureChordAnswerGridBuilt(state) {
    if (builtChordSubMode !== state.chordSubMode) {
      buildChordAnswerGrid(state.chordSubMode);
      builtChordSubMode = state.chordSubMode;
    }
  }
  chordAnswerGrid.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-chord-answer]");
    if (!btn || btn.disabled) return;
    RelativePitchSound.play("tap");
    RelativePitchGame.answerChord(btn.dataset.chordAnswer);
  });
  function enableChordAnswerGrid(enabled) {
    Array.from(chordAnswerGrid.querySelectorAll("[data-chord-answer]")).forEach((btn) => {
      btn.disabled = !enabled;
    });
  }
  function clearChordAnswerMarks() {
    Array.from(chordAnswerGrid.querySelectorAll("[data-chord-answer]")).forEach((btn) => {
      btn.classList.remove("picked-correct", "picked-wrong", "reveal-correct");
    });
  }
  function markChordPickedAndCorrect(lastChordResult) {
    const pickedBtn = chordAnswerGrid.querySelector('[data-chord-answer="' + lastChordResult.pickedValue + '"]');
    if (pickedBtn) pickedBtn.classList.add(lastChordResult.correct ? "picked-correct" : "picked-wrong");
    if (!lastChordResult.correct) {
      const correctBtn = chordAnswerGrid.querySelector('[data-chord-answer="' + lastChordResult.correctKey + '"]');
      if (correctBtn) correctBtn.classList.add("reveal-correct");
    }
  }

  // do -> (750ms) -> [progression sub-mode: I-chord context -> gap ->] target chord.
  function scheduleChordPlayback(state, onDone) {
    const tier = RelativePitchGame.chordTierFor(state.difficulty);
    schedule(() => RelativePitchSound.playReference(RelativePitchGame.midiToFreq(state.tonicMidi)), 0);
    const targetFreqs = chordFreqs(state.currentChord.midiNotes);
    if (state.chordSubMode === "progression" && state.currentChord.contextMidiNotes) {
      const contextFreqs = chordFreqs(state.currentChord.contextMidiNotes);
      schedule(() => RelativePitchSound.playChord(contextFreqs, CHORD_NOTE_DURATION, tier.timbre, 0.22, 0), 750);
      const targetAt = 750 + CHORD_NOTE_DURATION * 1000 + 200;
      schedule(() => RelativePitchSound.playChord(targetFreqs, CHORD_NOTE_DURATION, tier.timbre, 0.22, 0), targetAt);
      schedule(onDone, targetAt + CHORD_NOTE_DURATION * 1000 + 150);
    } else {
      schedule(() => RelativePitchSound.playChord(targetFreqs, CHORD_NOTE_DURATION, tier.timbre, 0.22, 0), 750);
      schedule(onDone, 750 + CHORD_NOTE_DURATION * 1000 + 150);
    }
  }

  function onChordQuestion(state) {
    clearTimers();
    chordBoard.classList.remove("hidden");
    singleDegreeBoard.classList.add("hidden");
    melodyBoard.classList.add("hidden");
    ensureChordAnswerGridBuilt(state);
    clearChordAnswerMarks();
    enableChordAnswerGrid(false);
    chordResultBanner.textContent = "";
    chordResultBanner.className = "result-banner";
    nextChordBtn.classList.add("hidden");
    const progressionTag = state.currentChord.progressionName ? "《" + state.currentChord.progressionName + "》" : "";
    chordHintText.textContent =
      state.chordSubMode === "progression"
        ? "🔊 播放中：先報 do，再聽" + (progressionTag || "I 級") + "和弦當參考，最後聽目標和弦…猜猜是第幾級"
        : "🔊 播放中：先報 do，再聽和弦…猜猜是什麼和弦色彩";
    playChordAgainBtn.disabled = true;
    scheduleChordPlayback(state, () => {
      enableChordAnswerGrid(true);
      playChordAgainBtn.disabled = false;
      chordHintText.textContent =
        state.chordSubMode === "progression"
          ? "這是哪一個級數的和弦？" + (progressionTag ? "（來自" + progressionTag + "）" : "")
          : "這是什麼色彩的和弦？";
    });
  }

  function onChordAnswer(state, extra) {
    enableChordAnswerGrid(false);
    markChordPickedAndCorrect(state.lastChordResult);
    const correctLabel =
      state.chordSubMode === "quality"
        ? RelativePitchGame.CHORD_QUALITIES[state.lastChordResult.correctKey].label
        : state.lastChordResult.correctKey;
    chordResultBanner.textContent = extra.correct ? "✅ 答對了！是 " + correctLabel : "❌ 答錯了，正確答案是 " + correctLabel;
    chordResultBanner.className = "result-banner " + (extra.correct ? "tone-correct" : "tone-wrong");
    RelativePitchSound.play(extra.correct ? "correct" : "wrong", { streak: state.streak });
    if (extra.milestone) celebrate(state.streak);
    nextChordBtn.classList.remove("hidden");
  }

  playChordReferenceAgainBtn.addEventListener("click", () => {
    const state = RelativePitchGame.getState();
    if (!state || state.mode !== "chord") return;
    RelativePitchSound.playReference(RelativePitchGame.midiToFreq(state.tonicMidi));
  });
  playChordAgainBtn.addEventListener("click", () => {
    const state = RelativePitchGame.getState();
    if (!state || state.mode !== "chord" || !state.currentChord) return;
    const tier = RelativePitchGame.chordTierFor(state.difficulty);
    RelativePitchSound.playChord(chordFreqs(state.currentChord.midiNotes), CHORD_NOTE_DURATION, tier.timbre, 0.22, 0);
  });
  nextChordBtn.addEventListener("click", () => RelativePitchGame.nextChordQuestion());

  // -- session end / navigation -------------------------------------------
  function renderSessionEnd(summary) {
    sessionEndTitle.textContent = "🎹 本輪練習成果";
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
    const summary = RelativePitchGame.endSession();
    if (summary && summary.answered > 0) {
      renderSessionEnd(summary);
    } else {
      renderHome();
      showView("home");
    }
  });

  sessionEndCloseBtn.addEventListener("click", () => {
    sessionEndModal.classList.add("hidden");
    RelativePitchGame.startSession(lastMode, lastDifficulty);
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
      case "melody-tap":
        onMelodyTap(state);
        break;
      case "melody-result":
        onMelodyResult(state, extra);
        break;
      case "chord-question":
        onChordQuestion(state);
        break;
      case "chord-answer":
        onChordAnswer(state, extra);
        break;
      default:
        break;
    }
  }

  // -- boot -----------------------------------------------------------------
  RelativePitchSound.setEnabled(RelativePitchStorage.getSettings().soundEnabled !== false);
  RelativePitchGame.onChange(render);
  applyTheme(GameHubStorage.getTheme());
  renderHome();
  showView("home");
})();
