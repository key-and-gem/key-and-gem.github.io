// js/upload.js
import { state } from './state.js';
import { open as playerOpen } from './player.js';

const iVid  = document.getElementById('input-video');
const iJson = document.getElementById('input-json');
const sVid  = document.getElementById('slot-video');
const sJson = document.getElementById('slot-json');
const hVid  = document.getElementById('hint-video');
const hJson = document.getElementById('hint-json');
const cVid  = document.getElementById('chip-video');
const cJson = document.getElementById('chip-json');
const btn   = document.getElementById('proceed-btn');
const prog  = document.getElementById('upload-progress');
const sVoice = document.getElementById('select-voice');
const bTest  = document.getElementById('voice-test');
const VOICE_KEY = 'playerVoiceURI';

function defaultVoice(list) {
  const hi5  = list.find(v => v.name.replace(/\s+/g, ' ').includes('हिन्दी 5'));
  if (hi5) return hi5;
  const hiIN = list.find(v => v.lang && v.lang.includes('hi-IN'));
  return hiIN || list[0] || null;
}

function loadVoiceOptions() {
  const list = speechSynthesis.getVoices();
  if (!list.length) return;
  let saved = null;
  try { saved = localStorage.getItem(VOICE_KEY); } catch (e) { saved = null; }
  const keep = state.voiceURI || saved;
  const pick = list.find(v => v.voiceURI === keep) || defaultVoice(list);
  sVoice.innerHTML = '';
  list.forEach(v => {
    const o = document.createElement('option');
    o.value = v.voiceURI;
    o.textContent = `${v.name} (${v.lang})`;
    sVoice.appendChild(o);
  });
  if (pick) {
    sVoice.value = pick.voiceURI;
    state.voiceURI = pick.voiceURI;
  }
}

if (speechSynthesis.onvoiceschanged !== undefined) {
  speechSynthesis.onvoiceschanged = loadVoiceOptions;
}
loadVoiceOptions();
let voiceTries = 0;
const voiceIv = setInterval(() => {
  loadVoiceOptions();
  if (++voiceTries > 15 || sVoice.options.length) clearInterval(voiceIv);
}, 200);

sVoice.addEventListener('change', () => {
  state.voiceURI = sVoice.value;
  try { localStorage.setItem(VOICE_KEY, sVoice.value); } catch (e) {}
});

let testToken = 0;
let startTimer = null;
let endTimer = null;

function setTesting(on, speaking) {
  sVoice.disabled = on;
  bTest.disabled = on;
  bTest.innerHTML = on && !speaking ? '<span class="spinner"></span>' : 'Test';
}

function clearTestTimers() {
  clearTimeout(startTimer);
  clearTimeout(endTimer);
}

bTest.addEventListener('click', () => {
  const v = speechSynthesis.getVoices().find(x => x.voiceURI === state.voiceURI);
  const token = ++testToken;
  clearTestTimers();
  const finish = () => {
    if (token !== testToken) return;
    clearTestTimers();
    setTesting(false, false);
  };
  setTesting(true, false);
  if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance('हैलो फोक्स, मैं माइकल और आपका स्वागत है मेरे चैनल पर');
  if (v) { u.voice = v; u.lang = v.lang; }
  u.onstart = () => {
    if (token !== testToken) return;
    clearTimeout(startTimer);
    setTesting(true, true);
    endTimer = setTimeout(() => {
      if (token === testToken) {
        speechSynthesis.cancel();
        finish();
      }
    }, 12000);
  };
  u.onend = finish;
  u.onerror = finish;
  startTimer = setTimeout(() => {
    if (token === testToken) {
      speechSynthesis.cancel();
      finish();
    }
  }, 5000);
  setTimeout(() => {
    if (token === testToken) {
      speechSynthesis.resume();
      speechSynthesis.speak(u);
    }
  }, 60);
});

function sync() {
  const ok = state.videoFile && state.jsonFile;
  btn.disabled = !ok;
  prog.style.width = ((state.videoFile ? 50 : 0) + (state.jsonFile ? 50 : 0)) + '%';
  btn.textContent = ok                                  ? 'Open player →'
    : (!state.videoFile && !state.jsonFile)             ? 'Choose both files'
    : !state.videoFile                                  ? 'Video file is also required'
    :                                                     'JSON file is also required';
}

function mark(slot, hint, chip, file, ext) {
  slot.classList.toggle('ready', !!file);
  hint.textContent = file ? file.name : `Choose a ${ext} file`;
  chip.textContent = file ? '✓' : ext;
}

iVid.addEventListener('change', () => {
  const f = iVid.files[0]; if (!f) return;
  state.videoFile = f;
  mark(sVid, hVid, cVid, f, '.mp4');
  sync();
});

iJson.addEventListener('change', () => {
  const f = iJson.files[0]; if (!f) return;
  state.jsonFile = f;
  mark(sJson, hJson, cJson, f, '.json');
  sync();
});

btn.addEventListener('click', async () => {
  if (!state.videoFile || !state.jsonFile) return;
  speechSynthesis.cancel();
  try {
    const raw = JSON.parse(await state.jsonFile.text());
    state.transcript = Array.isArray(raw) ? raw : JSON.parse(raw.stdout);
  } catch (e) {
    alert('JSON parse error: ' + e.message);
    return;
  }
  if (state.videoURL) URL.revokeObjectURL(state.videoURL);
  state.videoURL = URL.createObjectURL(state.videoFile);
  playerOpen(state.videoURL, state.videoFile.name);
});