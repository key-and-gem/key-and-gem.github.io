// js/player.js
import { state } from './state.js';
import * as Transcript from './transcript.js';
import * as MainLogic from './mainLogic.js';
import { stepSegment } from './arrowKeys.js';

const uploadSec = document.getElementById('upload-screen');
const playerSec = document.getElementById('player-screen');
const video     = document.getElementById('main-video');
const tapOv     = document.getElementById('tap-overlay');
const centIcon  = document.getElementById('center-icon');
const ciPlay    = document.getElementById('ci-play');
const ciPause   = document.getElementById('ci-pause');
const ppBtn     = document.getElementById('pp-btn');
const icPlay    = document.getElementById('ic-play');
const scrubber  = document.getElementById('scrubber');
const scrubWrap = document.getElementById('scrub-wrap');
const segBar    = document.getElementById('seg-bar');
const timeLbl   = document.getElementById('time-lbl');
const fileName  = document.getElementById('file-name');
const backBtn   = document.getElementById('back-btn');
const capBtn    = document.getElementById('caption-btn');
const trBtn     = document.getElementById('transcript-btn');
const trPanel   = document.getElementById('tr-panel');

function ts(s) {
  s = Math.floor(s || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function setPlay(on) {
  ciPlay.style.display  = on ? 'none' : '';
  ciPause.style.display = on ? '' : 'none';
  centIcon.classList.toggle('hide', on);
}

// Transcript jahan se shuru hoti hai (e.g. 0:08) — usse pehle user ko jaane nahi dena
function minTime() {
  const t = state.transcript;
  return t.length ? Math.max(0, t[0].start || 0) : 0;
}

// Video agar transcript start se pehle hai toh apne aap wahan pahuch jaye
// (scrubber ki range poori 0:00 se hi rehti hai, sirf position snap hoti hai)
function applyStartLimit() {
  const min = minTime();
  if (video.currentTime < min) video.currentTime = min;
}

// ── Slider ko transcript parts ke hisaab se todna ──
// Har segment ek alag block hai, beech mein chhota gap. Pehle segment se pehle ka hissa
// (jahan user ja hi nahi sakta) nahi dikhta, isliye blocks ki ginti = transcript parts ki ginti.
const SEG_GAP = 1; // px — har boundary par aadha gap dono taraf, total 2px

function buildSegBar() {
  const segs = state.transcript;
  const dur  = video.duration;
  if (!segs.length || !dur || !isFinite(dur)) {
    scrubWrap.classList.remove('has-segs');
    segBar.style.maskImage = segBar.style.webkitMaskImage = '';
    return;
  }

  // Sirf valid, badhte hue start times (video ke andar)
  const starts = [];
  for (const sg of segs) {
    const st = Math.max(0, +sg.start || 0);
    if (st < dur && (!starts.length || st > starts[starts.length - 1])) starts.push(st);
  }
  if (!starts.length) { scrubWrap.classList.remove('has-segs'); return; }

  const stops = ['transparent 0'];
  starts.forEach((st, i) => {
    const s = (st / dur) * 100;
    const e = i < starts.length - 1 ? (starts[i + 1] / dur) * 100 : 100;
    const left  = i === 0 ? `${s}%` : `calc(${s}% + ${SEG_GAP}px)`;
    const right = i === starts.length - 1 ? '100%' : `calc(${e}% - ${SEG_GAP}px)`;
    stops.push(`transparent ${left}`, `#000 ${left}`, `#000 ${right}`, `transparent ${right}`);
  });
  const mask = `linear-gradient(to right, ${stops.join(', ')})`;
  segBar.style.maskImage = mask;
  segBar.style.webkitMaskImage = mask;
  scrubWrap.classList.add('has-segs');
}

function syncScrubber() {
  const pct = video.duration ? (video.currentTime / video.duration) * 100 : 0;
  scrubber.value = pct;
  scrubber.style.setProperty('--f', pct + '%');
  segBar.style.setProperty('--f', pct + '%');
  timeLbl.innerHTML = `${ts(video.currentTime)} <em>/ ${ts(video.duration)}</em>`;
  Transcript.update(video.currentTime);
}

const seekTo = (s) => { video.currentTime = s; if (video.paused) video.play(); };
ppBtn.addEventListener('click', () => MainLogic.toggle());

// ── On-video controls (prev / play-pause / next) ──
// Mouse: hover par dikhte hain. Touch: video par tap karo toh dikhte hain, kuch der baad chhup jaate hain.
const box      = document.querySelector('.player-box');
const vcWrap   = document.getElementById('vc-wrap');
const playerCol = box.parentElement;               // video + control bar dono isi mein hain
const ctrlBar  = document.querySelector('.controls');
let vcTimer = null;
let scrubbing = false;                             // scrubber drag chal raha hai toh chhupana mat

function showVC(ms = 3000) {
  box.classList.add('show-ctrl');
  clearTimeout(vcTimer);
  vcTimer = setTimeout(function tick() {
    // Mouse abhi button par hai toh chhupana mat
    if (scrubbing || vcWrap.querySelector('.vc-btn:hover') || ctrlBar.matches(':hover')) {
      vcTimer = setTimeout(tick, 1000); return;
    }
    box.classList.remove('show-ctrl');
  }, ms);
}
function hideVC() {
  clearTimeout(vcTimer);
  box.classList.remove('show-ctrl');
}

// Mouse events player-col par: control bar video ke upar overlay hai par DOM mein alag sibling hai
playerCol.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') showVC(); });
playerCol.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !scrubbing) hideVC(); });
// Keyboard focus se bhi controls dikhen
playerCol.addEventListener('focusin', () => showVC());
// Scrubber drag (touch/mouse) ke dauran controls visible rahein
scrubber.addEventListener('pointerdown', () => { scrubbing = true; showVC(); });
const endScrub = () => { if (scrubbing) { scrubbing = false; showVC(); } };
window.addEventListener('pointerup', endScrub);
window.addEventListener('pointercancel', endScrub);
ctrlBar.addEventListener('pointerdown', () => showVC());
// Touch/pen: tap se show/hide toggle
tapOv.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse') return;
  if (box.classList.contains('show-ctrl')) hideVC(); else showVC();
});
// Button dabane par controls kuch der aur visible rahein
vcWrap.addEventListener('click', () => showVC());

document.getElementById('vc-pp').addEventListener('click', () => MainLogic.toggle());
document.getElementById('vc-prev').addEventListener('click', () => stepSegment(-1));
document.getElementById('vc-next').addEventListener('click', () => stepSegment(1));
video.addEventListener('play',           () => setPlay(true));
video.addEventListener('pause',          () => setPlay(false));
video.addEventListener('ended',          () => setPlay(false));
video.addEventListener('timeupdate',     syncScrubber);
video.addEventListener('loadedmetadata', () => { applyStartLimit(); buildSegBar(); syncScrubber(); });
video.addEventListener('durationchange', () => buildSegBar());
// Kisi bhi tareeke se (scrubber, keyboard, native controls) peeche gaye toh wapas limit par
video.addEventListener('seeking', () => {
  const min = minTime();
  if (video.currentTime < min - 0.05) video.currentTime = min;
});

// Slider sirf progress dikhane ke liye hai — user ise aage/peeche nahi kar sakta.
// Kisi bhi tareeke se value badli (drag, keyboard, assistive tech) toh turant asli position par wapas.
scrubber.addEventListener('input', () => syncScrubber());

capBtn.addEventListener('click', () => {
  state.captionsOn = !state.captionsOn;
  capBtn.classList.toggle('on', state.captionsOn);
  Transcript.setCaptions(state.captionsOn);
});

trBtn.addEventListener('click', () => {
  const hidden = trPanel.classList.toggle('collapsed');
  trBtn.classList.toggle('on', !hidden);
});

// ── Fullscreen toggle ──
// Native fullscreen player-col par (video + controls dono saath). Jahan support nahi (iPhone Safari)
// wahan CSS fallback (.pseudo-fs) poori screen tak phailata hai.
const fsBtn = document.getElementById('fs-btn');
const nativeFS = () => document.fullscreenElement || document.webkitFullscreenElement || null;
const isFS = () => !!nativeFS() || playerCol.classList.contains('pseudo-fs');

function renderFS() {
  const on = isFS();
  playerCol.classList.toggle('is-fs', on);
  fsBtn.classList.toggle('is-fs', on);
  const label = on ? 'Exit fullscreen' : 'Fullscreen';
  fsBtn.setAttribute('aria-label', label);
  fsBtn.title = label;
}

async function enterFS() {
  const req = playerCol.requestFullscreen || playerCol.webkitRequestFullscreen;
  if (req) {
    try {
      await req.call(playerCol);
      // Phone/tablet par landscape lock (jahan allowed ho); desktop par silently fail
      try { await screen.orientation.lock('landscape'); } catch (_) {}
      return;
    } catch (_) { /* fallback neeche */ }
  }
  playerCol.classList.add('pseudo-fs');
  renderFS();
}

function exitFS() {
  playerCol.classList.remove('pseudo-fs');
  if (nativeFS()) {
    try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (_) {}
  }
  try { screen.orientation.unlock(); } catch (_) {}
  renderFS();
}

fsBtn.addEventListener('click', () => { if (isFS()) exitFS(); else enterFS(); });
const onFSChange = () => {
  if (!nativeFS()) { try { screen.orientation.unlock(); } catch (_) {} }
  renderFS();
  showVC();
};
document.addEventListener('fullscreenchange', onFSChange);
document.addEventListener('webkitfullscreenchange', onFSChange);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && playerCol.classList.contains('pseudo-fs')) exitFS();
});

backBtn.addEventListener('click', () => {
  exitFS();
  hideVC();
  video.pause();
  MainLogic.destroy();
  video.src = '';
  playerSec.classList.remove('active');
  playerSec.style.display = 'none';
  uploadSec.style.display = '';
  setPlay(false);
  Transcript.reset();
  scrubWrap.classList.remove('has-segs');
});

export function open(url, name) {
  uploadSec.style.display = 'none';
  playerSec.style.display = 'flex';
  playerSec.classList.add('active');
  fileName.textContent = name;
  trPanel.classList.add('collapsed');
  Transcript.build(state.transcript, (idx) => MainLogic.seekToSegment(idx));
  video.src = url;
  video.load();
  setPlay(false);
  MainLogic.init();
  buildSegBar();
  showVC(4000); // shuru mein thodi der controls dikhao (touch par discoverability)
}

const volBtn = document.getElementById('volume-btn');

// Muted icon (X wala) aur unmuted icon (waves wala)
const iconMuted   = `<svg viewBox="0 0 24 24"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;
const iconUnmuted = `<svg viewBox="0 0 24 24"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;

volBtn.addEventListener('click', () => {
  video.muted = !video.muted;
  volBtn.classList.toggle('on', !video.muted);
  volBtn.innerHTML = video.muted ? iconMuted : iconUnmuted;
});