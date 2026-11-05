// js/arrowKeys.js
// Left/Right arrow → previous/next transcript segment

import { state } from './state.js';
import * as MainLogic from './mainLogic.js';

const video     = document.getElementById('main-video');
const playerSec = document.getElementById('player-screen');

/**
 * Current segment ka index nikalta hai segment ke START times ke basis par.
 * Jis segment ka start <= currentTime ho aur next segment ka start > currentTime,
 * woh segment active hai. Floating-point end-boundary issues se mukti.
 */
function getActiveIdx(t, segs) {
  if (!segs.length) return -1;
  if (t < segs[0].start) return -1; // video start se pehle

  // Sabse baad wala segment jiska start <= t hai
  for (let i = segs.length - 1; i >= 0; i--) {
    if (t >= segs[i].start) return i;
  }
  return -1;
}

/**
 * Previous (-1) / next (+1) segment par jao.
 * Keyboard arrows aur video par aane wale on-screen buttons dono yehi use karte hain.
 */
export function stepSegment(dir) {
  const segs = state.transcript;
  if (!segs.length) return;

  const curIdx = getActiveIdx(video.currentTime, segs);

  let targetIdx;
  if (dir < 0) {
    // Already pehle segment par hain toh wahi rehna
    targetIdx = curIdx <= 0 ? 0 : curIdx - 1;
  } else {
    // Already last segment par hain toh wahi rehna
    targetIdx = curIdx < segs.length - 1 ? curIdx + 1 : segs.length - 1;
  }

  MainLogic.seekToSegment(targetIdx);
}

document.addEventListener('keydown', (e) => {
  // Sirf player screen par kaam karo
  if (!playerSec.classList.contains('active')) return;

  // Text inputs mein type karte waqt skip karo
  // (range/scrubber ko allow karo — uska default override karenge)
  const tag  = e.target.tagName;
  const type = e.target.type;
  if (tag === 'TEXTAREA') return;
  if (tag === 'INPUT' && type !== 'range') return;

  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

  if (!state.transcript.length) return;

  // Browser default (scrubber slide, video shortcut) rokna
  e.preventDefault();

  stepSegment(e.key === 'ArrowLeft' ? -1 : 1);
});