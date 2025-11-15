// ===== Audio 基本セットアップ =====
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContextClass();

const mainGain = audioCtx.createGain();
mainGain.gain.value = 0.7; // 初期ボリューム 70%
mainGain.connect(audioCtx.destination);

const volumeDisplay = document.getElementById("volumeDisplay");

// サステイン状態 & 全ボイス管理
let sustainOn = false;
const allVoices = new Set(); // { osc, gain, sustained }

// pointerId -> voice（タッチごとの音）
const pointerVoices = new Map();

// キーボード key -> voice
const keyVoices = {};

// ===== 音階定義 =====
// 星ボタン：Cメジャーペンタトニックを2オクターブにまたがる
// C4, D4, E4, G4, A4, C5, D5, E5
const chordFreqs = [
  261.63, // C4
  293.66, // D4
  329.63, // E4
  392.0,  // G4
  440.0,  // A4
  523.25, // C5
  587.33, // D5
  659.25  // E5
];

// 笛メロディ用：少し高めのペンタ系（C5〜D6）
const melodyFreqs = [
  523.25, // C5
  587.33, // D5
  659.25, // E5
  783.99, // G5
  880.0,  // A5
  1046.5, // C6
  1174.7  // D6
];

// ===== ユーティリティ =====

function ensureAudioRunning() {
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

function createVoice(freq) {
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();

  osc.type = "sine"; // 必要なら "triangle" や "square" に変更
  osc.frequency.value = freq;

  g.gain.value = 0;
  osc.connect(g).connect(mainGain);

  const voice = { osc, gain: g, sustained: false };
  allVoices.add(voice);
  return voice;
}

function startVoice(freq) {
  ensureAudioRunning();
  const voice = createVoice(freq);
  const now = audioCtx.currentTime;
  voice.gain.cancelScheduledValues(now);
  voice.gain.linearRampToValueAtTime(1.0, now + 0.03); // アタック
  voice.osc.start(now);
  return voice;
}

function releaseVoice(voice, releaseTime = 0.25) {
  if (!voice) return;
  const now = audioCtx.currentTime;
  voice.gain.cancelScheduledValues(now);
  voice.gain.linearRampToValueAtTime(0, now + releaseTime);
  voice.osc.stop(now + releaseTime + 0.05);
  allVoices.delete(voice);
}

function stopVoice(voice) {
  if (!voice) return;
  if (sustainOn) {
    // サステインON中なら止めずにフラグだけ
    voice.sustained = true;
    return;
  }
  // 通常時はすぐにフェードアウト
  releaseVoice(voice, 0.2);
}

function releaseSustainedVoices() {
  const voicesToRelease = [];
  for (const v of allVoices) {
    if (v.sustained) voicesToRelease.push(v);
  }
  voicesToRelease.forEach((v) => releaseVoice(v, 0.3));
}

function setSustain(on) {
  if (on === sustainOn) return;
  sustainOn = on;
  const moon = document.getElementById("moonButton");
  if (sustainOn) {
    moon.classList.add("sustain-on");
  } else {
    moon.classList.remove("sustain-on");
    // 溜めていた音を全部放す
    releaseSustainedVoices();
  }
}

// ===== 太陽ボタン（音量ドラッグ） =====
const sunButton = document.getElementById("sunButton");

let isAdjustingVolume = false;
let startY = 0;
let startGain = mainGain.gain.value;

// 1pxあたりの変化量
const dragSensitivity = 0.003;

function updateVolumeDisplay() {
  volumeDisplay.textContent = Math.round(mainGain.gain.value * 100) + "%";
}

sunButton.addEventListener("pointerdown", (e) => {
  ensureAudioRunning();
  isAdjustingVolume = true;
  startY = e.clientY;
  startGain = mainGain.gain.value;
  sunButton.setPointerCapture(e.pointerId);
});

sunButton.addEventListener("pointermove", (e) => {
  if (!isAdjustingVolume) return;
  const dy = e.clientY - startY; // 上にドラッグするとマイナス
  let newGain = startGain - dy * dragSensitivity;
  if (newGain < 0) newGain = 0;
  if (newGain > 1) newGain = 1;
  mainGain.gain.value = newGain;
  updateVolumeDisplay();

  const scale = 0.9 + newGain * 0.3;
  sunButton.style.transform = `scale(${scale})`;
});

function endVolumeDrag(e) {
  if (!isAdjustingVolume) return;
  isAdjustingVolume = false;
  try {
    sunButton.releasePointerCapture(e.pointerId);
  } catch (err) {
    // noop
  }
}

sunButton.addEventListener("pointerup", endVolumeDrag);
sunButton.addEventListener("pointercancel", endVolumeDrag);

// 初期表示
updateVolumeDisplay();

// ===== 月ボタン（サステインペダル：押してる間ON） =====
const moonButton = document.getElementById("moonButton");

moonButton.addEventListener("pointerdown", (e) => {
  ensureAudioRunning();
  setSustain(true);
  moonButton.setPointerCapture(e.pointerId);
});

function endSustain(e) {
  setSustain(false);
  try {
    moonButton.releasePointerCapture(e.pointerId);
  } catch (err) {
    // noop
  }
}

moonButton.addEventListener("pointerup", endSustain);
moonButton.addEventListener("pointercancel", endSustain);

// ===== 星ボタン（和音、マルチタッチ） =====

function getFreqByElement(el) {
  const type = el.dataset.noteType;
  const idx = Number(el.dataset.noteIndex);
  if (type === "chord") {
    return chordFreqs[idx];
  } else if (type === "melody") {
    return melodyFreqs[idx];
  }
  return null;
}

function handleKeyPointerDown(el, e) {
  e.preventDefault();
  ensureAudioRunning();

  const freq = getFreqByElement(el);
  if (!freq) return;

  const voice = startVoice(freq);
  pointerVoices.set(e.pointerId, voice);

  el.classList.add("active");
  el.setPointerCapture(e.pointerId);
}

function handleKeyPointerUp(el, e) {
  const voice = pointerVoices.get(e.pointerId);
  if (voice) {
    stopVoice(voice);
    pointerVoices.delete(e.pointerId);
  }
  el.classList.remove("active");
  try {
    el.releasePointerCapture(e.pointerId);
  } catch (err) {
    // noop
  }
}

// 魔法陣
document.querySelectorAll(".magic-key").forEach((el) => {
  el.addEventListener("pointerdown", (e) => handleKeyPointerDown(el, e));
  el.addEventListener("pointerup", (e) => handleKeyPointerUp(el, e));
  el.addEventListener("pointercancel", (e) => handleKeyPointerUp(el, e));
  el.addEventListener("pointerleave", (e) => handleKeyPointerUp(el, e));
});

// 星
document.querySelectorAll(".star-key").forEach((el) => {
  el.addEventListener("pointerdown", (e) => handleKeyPointerDown(el, e));
  el.addEventListener("pointerup", (e) => handleKeyPointerUp(el, e));
  el.addEventListener("pointercancel", (e) => handleKeyPointerUp(el, e));
  el.addEventListener("pointerleave", (e) => handleKeyPointerUp(el, e));
});

// ===== キーボード入力対応 =====

const keyToNoteInfo = {};
// melody: A S D F J K L
document.querySelectorAll(".magic-key").forEach((el) => {
  const key = (el.dataset.key || "").toLowerCase();
  if (!key) return;
  keyToNoteInfo[key] = {
    type: el.dataset.noteType,
    index: Number(el.dataset.noteIndex),
    element: el
  };
});

// chord: Z X C V B N M ,
document.querySelectorAll(".star-key").forEach((el) => {
  const key = (el.dataset.key || "").toLowerCase();
  if (!key) return;
  keyToNoteInfo[key] = {
    type: el.dataset.noteType,
    index: Number(el.dataset.noteIndex),
    element: el
  };
});

window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (!(key in keyToNoteInfo)) return;

  // リピートで noteOn 連打しない
  if (e.repeat) return;
  if (keyVoices[key]) return;

  ensureAudioRunning();

  const info = keyToNoteInfo[key];
  const freq =
    info.type === "chord"
      ? chordFreqs[info.index]
      : melodyFreqs[info.index];

  const voice = startVoice(freq);
  keyVoices[key] = voice;

  if (info.element) {
    info.element.classList.add("active");
  }
});

window.addEventListener("keyup", (e) => {
  const key = e.key.toLowerCase();
  const voice = keyVoices[key];
  if (!voice) return;

  stopVoice(voice);
  keyVoices[key] = null;

  const info = keyToNoteInfo[key];
  if (info && info.element) {
    info.element.classList.remove("active");
  }
});
