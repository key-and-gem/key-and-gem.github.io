// js/transcript.js
import { state } from './state.js';

const list    = document.getElementById('tr-list');
const count   = document.getElementById('tr-count');
const subText = document.getElementById('sub-text');

let els = [];
let activeIdx = -1;

function ts(s) {
  s = Math.floor(s || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function build(segs, seekFn) {
  list.innerHTML = '';
  els = [];
  activeIdx = -1;
  count.textContent = segs.length;

  segs.forEach((seg, i) => {
    const el = document.createElement('div');
    el.className = 'tr-seg';
    el.innerHTML = `<span class="tr-ts">${ts(seg.start)}</span><span class="tr-body">${seg.text}</span>`;
    el.addEventListener('click', () => seekFn(i));
    list.appendChild(el);
    els.push(el);
  });
}

export function update(t) {
  const segs = state.transcript;
  if (!segs.length) return;

  // Sabse baad wala segment jiska start <= t
  let idx = -1;
  for (let i = segs.length - 1; i >= 0; i--) {
    if (t >= segs[i].start) { idx = i; break; }
  }

  if (idx === activeIdx) return;
  activeIdx = idx;

  els.forEach((el, i) => el.classList.toggle('active', i === idx));

  if (idx >= 0) {
    els[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (state.captionsOn) {
      subText.textContent = segs[idx].text;
      subText.classList.add('on');
    }
  } else {
    subText.classList.remove('on');
  }
}

export function reset() {
  els.forEach(el => el.classList.remove('active'));
  activeIdx = -1;
  subText.classList.remove('on');
}

export function setCaptions(on) {
  if (!on) {
    subText.classList.remove('on');
  } else if (activeIdx >= 0) {
    subText.classList.add('on');
  }
}