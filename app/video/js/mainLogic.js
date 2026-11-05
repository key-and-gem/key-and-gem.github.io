// js/mainLogic.js
/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║              TTS + Video Synchronized Playback — mainLogic.js           ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║                                                                          ║
 * ║  OVERVIEW                                                                ║
 * ║  Yeh module Web Speech API (TTS) aur HTML video ko segment-by-segment   ║
 * ║  sync karta hai. TTS prototype ke teen design decisions yahan bhi hain:  ║
 * ║    1. PAUSE = CANCEL + POSITION SAVE  (browser ~14s baad kill kar deta) ║
 * ║    2. SILENT HEARTBEAT  (engine warm rakhta hai pause ke baad)           ║
 * ║    3. BTN_DELAY (500ms)  (button click ke baad nahi, audio confirm pe)  ║
 * ║                                                                          ║
 * ║  SYNC CASES                                                              ║
 * ║  Case A — TTS > Video segment:                                           ║
 * ║    Video next boundary cross karne ko ready, TTS abhi bhi bol raha.     ║
 * ║    → Video pause, dono buttons disable — jab tak TTS bhi ready na ho.   ║
 * ║  Case B — TTS < Video segment:                                           ║
 * ║    TTS khatam, video abhi segment mein chal rahi.                        ║
 * ║    → Sirf video pe play/pause kaam karega, TTS pe koi asar nahi.        ║
 * ║  Case C — Perfect sync:                                                  ║
 * ║    Dono ek saath khatam — kuch karne ki zaroorat nahi.                   ║
 * ║                                                                          ║
 * ║  PUBLIC API (import karke use karo)                                      ║
 * ║    init()             → Player screen kholte waqt call karo             ║
 * ║    destroy()          → Player screen band karte waqt call karo         ║
 * ║    play()             → Play button click handler                        ║
 * ║    pause()            → Pause button click handler                       ║
 * ║    seekToSegment(idx) → Arrow keys + transcript click handler            ║
 * ║                                                                          ║
 * ║  REQUIRED HTML CHANGES  (index.html mein)                                ║
 * ║    1. pp-btn ke andar sirf play SVG rakhna (pause SVG hata do)          ║
 * ║    2. pp-btn ke baad naya pause-btn add karna:                           ║
 * ║       <button class="c-btn" id="pause-btn"                               ║
 * ║               aria-label="Pause" disabled>                               ║
 * ║         <svg viewBox="0 0 24 24">                                        ║
 * ║           <rect x="6" y="4" width="4" height="16"/>                     ║
 * ║           <rect x="14" y="4" width="4" height="16"/>                    ║
 * ║         </svg>                                                            ║
 * ║       </button>                                                           ║
 * ║    3. mainLogic.js ka script tag add karna (player.js ke baad):          ║
 * ║       <script type="module" src="js/mainLogic.js"></script>              ║
 * ║                                                                          ║
 * ║  REQUIRED CHANGES IN EXISTING FILES                                      ║
 * ║  player.js:                                                              ║
 * ║    - import * as MainLogic from './mainLogic.js'; add karo               ║
 * ║    - `const toggle = ...` aur uske 2 event listeners hatao              ║
 * ║      (ppBtn click aur tapOv click wale)                                  ║
 * ║    - pp-btn aur tapOv ke naye listeners add karo:                        ║
 * ║        ppBtn.addEventListener('click', () => MainLogic.play());          ║
 * ║        tapOv.addEventListener('click', () => MainLogic.play());          ║
 * ║        document.getElementById('pause-btn')                              ║
 * ║          .addEventListener('click', () => MainLogic.pause());            ║
 * ║    - setPlay() mein sirf center overlay icons handle karo;               ║
 * ║      pp-btn ke ic-play/ic-pause wali lines hatao (ab sirf ek icon hai)  ║
 * ║    - open() mein aakhir mein: MainLogic.init(); add karo                 ║
 * ║    - backBtn listener mein: MainLogic.destroy(); add karo                ║
 * ║    - Transcript.build() call badlo:                                      ║
 * ║        Transcript.build(state.transcript,                                ║
 * ║          (idx) => MainLogic.seekToSegment(idx));                         ║
 * ║                                                                          ║
 * ║  arrowKeys.js:                                                           ║
 * ║    - import * as MainLogic from './mainLogic.js'; add karo               ║
 * ║    - `video.currentTime = ...` aur uske neeche wali `if paused` line    ║
 * ║      dono hatao. Replace karo:                                           ║
 * ║        MainLogic.seekToSegment(targetIdx);                               ║
 * ║                                                                          ║
 * ║  transcript.js:                                                          ║
 * ║    - build() ke andar seekFn call badlo:                                 ║
 * ║        seekFn(seg.start)  →  seekFn(i)                                   ║
 * ║      (Ab seekFn ko time nahi, segment index milega)                      ║
 * ║                                                                          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { state } from './state.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const BTN_DELAY = 500; // ms — same as TTS prototype
const BUSY_TIMEOUT = 8000; // ms — start/pause phase itna lamba atke toh auto-recover

// ─── DOM ──────────────────────────────────────────────────────────────────────
const video    = document.getElementById('main-video');
const playBtns = Array.from(document.querySelectorAll('.pp-toggle')); // control-bar + on-video toggle

// ─── TTS Engine ───────────────────────────────────────────────────────────────
const synth = window.speechSynthesis;
let voices = [];

function _loadVoices() { voices = synth.getVoices(); }

if (speechSynthesis.onvoiceschanged !== undefined) {
  speechSynthesis.onvoiceschanged = _loadVoices;
}
let _voiceAttempts = 0;
const _voiceIv = setInterval(() => {
  _loadVoices();
  if (++_voiceAttempts > 15 || voices.length) clearInterval(_voiceIv);
}, 200);

/**
 * Preferred voice: "हिन्दी 5" → hi-IN fallback → first available.
 * Integration: agar alag voice chahiye toh yahan condition update karo.
 */
function _getVoice() {
  if (state.voiceURI) {
    const chosen = voices.find(v => v.voiceURI === state.voiceURI);
    if (chosen) return chosen;
  }
  const hi5  = voices.find(v => v.name.replace(/\s+/g, ' ').includes('हिन्दी 5'));
  if (hi5) return hi5;
  const hiIN = voices.find(v => v.lang && v.lang.includes('hi-IN'));
  return hiIN || voices[0] || null;
}

// ─── Module State ─────────────────────────────────────────────────────────────
let _moduleActive    = false;
let _ttsState        = 'idle';  // 'idle' | 'playing' | 'paused' | 'segDone'
let _currentSegIdx   = -1;      // Index of segment jiska TTS abhi loaded hai
let _resumeText      = '';      // Current segment ka poora text (pause/resume ke liye)
let _resumeIndex     = 0;       // charIndex save-point for resume within segment
let _lastCharIndex   = 0;       // onboundary se update hota hai (current word position)
let _pendingPause    = false;   // synth.cancel() intentional tha (pause ke liye)
let _heartbeatOn     = false;

// Sync flags — har segment start pe reset hote hain
let _videoReadyForNext = false; // Video next segment ki territory mein aa gayi
let _ttsReadyForNext   = false; // Current segment ka TTS khatam ho gaya
let _nextSegForVideo   = -1;    // Video abhi jis segment mein hai (checkBothReady ke liye)

// Case A flag
let _caseAHold = false;

// timeupdate mein segment crossing track karne ke liye
let _lastVidSegIdx = -1;

// ─── Heartbeat (TTS engine warm rakhta hai pause ke baad) ─────────────────────
function _heartbeat() {
  if (!_heartbeatOn) return;
  const utt   = new SpeechSynthesisUtterance('\u00A0'); // Non-breaking space (silent)
  utt.volume  = 0;
  utt.voice   = _getVoice();
  utt.onend   = () => { if (_heartbeatOn) _heartbeat(); };
  utt.onerror = () => { if (_heartbeatOn) _heartbeat(); };
  synth.speak(utt);
}
function _startHeartbeat() {
  if (_heartbeatOn) return;
  _heartbeatOn = true;
  _heartbeat();
}
function _stopHeartbeat() {
  _heartbeatOn = false;
  // Note: synth.cancel() caller khud karega — yahan sirf flag off
}

// ─── Single Play/Pause Toggle Button + Click Queue ───────────────────────────
/**
 * Button ke 3 modes:
 *   'paused'  → play icon dikhta hai, click = play
 *   'playing' → pause icon dikhta hai, click = pause
 *   'busy'    → restricted: spinner dikhta hai (button disable jaisa dim), lekin
 *               click REGISTER hota hai — action queue mein jaata hai aur busy
 *               khatam hote hi apne aap perform hota hai.
 *
 * _busyTarget : busy khatam hone par jis mode mein pahunchenge ('playing'|'paused')
 * _queued     : user ka pending action ('play' | 'pause' | null) — sirf ek, latest
 */
let _mode        = 'paused';
let _busyTarget  = 'playing';
let _queued      = null;
let _busyTimer   = null;
let _userWantsPlay = true;
let _epoch       = 0;   // seek/resume/destroy pe badhta hai — purane timeouts ko stale banane ke liye

/**
 * Spinner (loading) + button DISABLE in 2 situations:
 *   1. Video abhi load ho rahi hai (metadata aayi nahi).
 *   2. User ka click QUEUE mein register ho chuka hai — button disable + spinner,
 *      taaki user ko pata chale ki click chala gaya hai aur action thodi der mein hoga
 *      (technical issue ya "kuch hua hi nahi" jaisa na lage). Queue flush/drop hote hi
 *      button wapas normal ho jaata hai.
 *
 * Normal busy (queue ke bina) mein button normal dikhta hai aur pehla click queue ho jaata hai.
 * Icon optimistic hota hai: jo state user ke last click ke baad hogi, wahi icon dikhta hai
 * (playing → pause icon, paused → play icon).
 */
let _videoErr = false;
const _videoBlocked = () => video.readyState < 1 && !_videoErr;

function _logicalState() {
  if (_mode !== 'busy') return _mode;
  return _queued ? (_queued === 'play' ? 'playing' : 'paused') : _busyTarget;
}

function _renderBtn() {
  const blocked = _videoBlocked();
  const queued  = !!_queued;
  const loading = blocked || queued;
  const lg = _logicalState();
  for (const b of playBtns) {
    b.disabled = loading;
    b.classList.toggle('loading', loading);
    b.classList.toggle('playing', !loading && lg === 'playing');
    b.setAttribute('aria-busy', loading ? 'true' : 'false');
    b.setAttribute('aria-label', loading ? (queued ? 'Queued' : 'Loading') : (lg === 'playing' ? 'Pause' : 'Play'));
  }
}
video.addEventListener('loadstart',      () => { _videoErr = false; _renderBtn(); });
video.addEventListener('loadedmetadata', () => _renderBtn());
video.addEventListener('error',          () => { _videoErr = true;  _renderBtn(); });

function _clearBusyTimer() {
  if (_busyTimer) { clearTimeout(_busyTimer); _busyTimer = null; }
}

/**
 * @param {'paused'|'playing'|'busy'} mode
 * @param {'playing'|'paused'} [target] - sirf busy ke liye
 * @param {boolean} [long] - true = lamba wait normal hai (Case A hold), watchdog nahi lagega
 */
function _setMode(mode, target, long) {
  _mode = mode;
  _clearBusyTimer();

  if (mode === 'busy') {
    _busyTarget = target || 'playing';
    if (!long) {
      // Watchdog: speech engine kabhi onstart/onerror na de toh spinner par atke na rahe
      _busyTimer = setTimeout(() => {
        if (!_moduleActive || _mode !== 'busy') return;
        _epoch++;
        _pendingPause = false;
        _caseAHold    = false;
        _stopHeartbeat();
        synth.cancel();
        video.pause();
        _ttsState = 'idle';
        _setMode('paused');
      }, BUSY_TIMEOUT);
    }
  }

  _renderBtn();
  if (mode !== 'busy') _flushQueue();
}

function _dropQueue() { _queued = null; _renderBtn(); }

/** Busy khatam hone par queued action chalao (agar ab bhi kaam ka ho). */
function _flushQueue() {
  const q = _queued;
  _queued = null;
  _renderBtn();
  if (!q || !_moduleActive) return;
  if (q === 'play'  && _mode === 'paused')  play();
  if (q === 'pause' && _mode === 'playing') pause();
}

/**
 * Toggle button / video tap handler.
 * Busy ho toh click queue mein jaata hai. Queue register hote hi button disable + spinner
 * ho jaata hai (_renderBtn), isliye ek waqt mein sirf ek hi click queue hota hai.
 */
export function toggle() {
  if (!_moduleActive) return;
  if (_videoBlocked()) return; // video abhi load ho rahi hai — spinner dikh raha hota hai
  if (_queued) return;         // click pehle se queue mein hai — spinner dikh raha hai

  if (_mode === 'busy') {
    _queued = _busyTarget === 'playing' ? 'pause' : 'play';
    _userWantsPlay = _queued === 'play';
    _renderBtn();
    return;
  }
  if (_mode === 'playing') pause(); else play();
}

// ─── Core TTS: speakFrom() ────────────────────────────────────────────────────
/**
 * @param {string} text       - Poora segment text
 * @param {number} startIndex - Kahan se shuru karna hai (resume ke liye)
 * @param {number} segIdx     - Konsa segment hai (stale callback check ke liye)
 */
function _speakFrom(text, startIndex, segIdx) {
  const slice = text.slice(startIndex);
  if (!slice.trim()) {
    // Segment text khatam — TTS done
    _onTTSDone(segIdx);
    return;
  }

  const utt  = new SpeechSynthesisUtterance(slice);
  utt.voice  = _getVoice();

  // onboundary: current word position track karo (pause position ke liye)
  utt.onboundary = (e) => {
    _lastCharIndex = startIndex + e.charIndex;
  };

  // onstart: TTS actually shuru ho gayi
  utt.onstart = () => {
    if (!_moduleActive) return;
    _ttsState = 'playing';

    // TTS start hote hi paused video play karo (play aur seek-to-segment dono cases)
    if (video.paused) video.play();

    // BTN_DELAY baad buttons update karo (audio confirm hone ka wait)
    const ep = _epoch;
    setTimeout(() => {
      if (!_moduleActive || ep !== _epoch) return;
      // Case A hold ya pending pause chal raha ho toh mode mat badlo
      if (!_caseAHold && !_pendingPause && _ttsState === 'playing') _setMode('playing');
    }, BTN_DELAY);
  };

  // onend: TTS naturally khatam ho gayi (interrupted nahi)
  utt.onend = () => {
    if (_pendingPause) return; // Yeh cancel-for-pause tha — ignore karo
    _ttsState = 'segDone';
    _onTTSDone(segIdx);
  };

  // onerror: do types ke errors
  utt.onerror = (e) => {
    if (e.error === 'interrupted' && _pendingPause) {
      // ── User ne pause kiya ──────────────────────────────────────────────────
      _pendingPause = false;
      video.pause(); // TTS ruk gayi — ab video bhi pause karo

      const ep = _epoch;
      setTimeout(() => {
        if (!_moduleActive || ep !== _epoch) return;
        _ttsState = 'paused';
        _setMode('paused');
        _startHeartbeat(); // Engine warm rakhna shuru karo
      }, BTN_DELAY);

    } else if (e.error === 'interrupted') {
      // ── Seek/resume ke waqt cancel hua — nayi utterance handle karegi ───────
      // Kuch nahi karna
    } else {
      // ── Unexpected error ────────────────────────────────────────────────────
      _ttsState = 'idle';
      _dropQueue();
      _setMode('paused');
    }
  };

  synth.cancel(); // Pehle se kuch chal raha ho toh saaf karo
  synth.speak(utt);
}

// ─── Segment Completion + Sync Logic ─────────────────────────────────────────

/**
 * TTS for a segment khatam ho gayi.
 */
function _onTTSDone(segIdx) {
  if (segIdx !== _currentSegIdx) return; // Stale callback — ignore
  if (video.ended) {                     // Video already khatam — kuch mat karo
    _ttsState = 'idle';
    return;
  }
  _ttsReadyForNext = true;
  _checkBothReady();
}

/**
 * Video next segment ki territory mein aa gayi.
 * vidSegIdx — jis segment ki territory mein video abhi hai
 */
function _onVideoEnteredSeg(vidSegIdx) {
  _nextSegForVideo   = vidSegIdx;
  _videoReadyForNext = true;

  if (!_ttsReadyForNext) {
    // ── Case A: TTS abhi bhi bol raha hai — video ko rok do ──────────────────
    _caseAHold = true;
    video.pause();

    // Button turant busy (spinner) — TTS khatam hone tak lamba wait normal hai
    _setMode('busy', 'playing', true);
  } else {
    // TTS already khatam tha (Case B/C) — dono ready hain
    _checkBothReady();
  }
}

/**
 * Dono flags check karo — agar dono ready hain toh next segment shuru karo.
 */
function _checkBothReady() {
  if (!_videoReadyForNext || !_ttsReadyForNext) return;

  const segs      = state.transcript;
  const targetIdx = _nextSegForVideo; // Video jis segment mein hai

  if (targetIdx < 0 || targetIdx >= segs.length) {
    // Sab segments khatam
    _caseAHold = false;
    _ttsState  = 'idle';
    _dropQueue();
    _setMode('paused');
    return;
  }

  _caseAHold = false;
  _advanceToSegment(targetIdx);
}

/**
 * Diye gaye segment par ja — TTS shuru karo, video follow karegi.
 */
function _advanceToSegment(idx) {
  const segs = state.transcript;
  const seg  = segs[idx];
  if (!seg) return;

  _currentSegIdx     = idx;
  _videoReadyForNext = false;
  _ttsReadyForNext   = false;
  _nextSegForVideo   = -1;
  _caseAHold         = false;
  _resumeText        = seg.text;
  _resumeIndex       = 0;
  _lastCharIndex     = 0;

  // Case A: video paused thi — exact segment start par le jao
  // Case B: video already chal rahi thi — seek mat karo, current position pe rehne do
  if (video.paused) {
    video.currentTime = seg.start;
  }

  // TTS shuru karo → onstart → video.play()
  _speakFrom(seg.text, 0, idx);
}

// ─── Video: Segment Boundary Detection ───────────────────────────────────────

video.addEventListener('timeupdate', () => {
  if (!_moduleActive || !state.transcript.length) return;

  const segs = state.transcript;

  // Video abhi kis segment mein hai
  let vidSegIdx = -1;
  for (let i = segs.length - 1; i >= 0; i--) {
    if (video.currentTime >= segs[i].start) { vidSegIdx = i; break; }
  }

  // Sirf FORWARD movement pe react karo (naya segment)
  if (vidSegIdx > _lastVidSegIdx) {
    _lastVidSegIdx = vidSegIdx;

    // Video current TTS segment se aage nikal gayi
    if (vidSegIdx > _currentSegIdx) {
      _onVideoEnteredSeg(vidSegIdx);
    }
  }
});

video.addEventListener('ended', () => {
  if (!_moduleActive) return;
  // Video khatam — clean up (TTS apni utterance naturally complete karegi)
  _caseAHold = false;
  _ttsState  = 'idle';
  _dropQueue();
  _setMode('paused');
});

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Play button click handler.
 * Cases:
 *   - paused  → TTS + video resume
 *   - segDone → Case B: sirf video play
 *   - idle    → Fresh start: TTS shuru → video follow
 */
export function play() {
  if (!_moduleActive) return;
  _userWantsPlay = true;

  // ── Case: Resume after pause ─────────────────────────────────────────────
  if (_ttsState === 'paused') {
    _stopHeartbeat();
    synth.cancel(); // Heartbeat utterance cancel karo
    _caseAHold = false;

    // Saved position se TTS resume karo → onstart → video.play()
    _epoch++;
    _speakFrom(_resumeText, _resumeIndex, _currentSegIdx);
    _setMode('busy', 'playing'); // TTS start hone ka wait
    return;
  }

  // ── Case B: TTS khatam, sirf video chal/ruk rahi hai ─────────────────────
  if (_ttsState === 'segDone' || _ttsReadyForNext) {
    if (video.paused) video.play();
    _setMode('playing');
    return;
  }

  // ── Case: Fresh play (idle state) ────────────────────────────────────────
  if (_ttsState === 'idle') {
    const seg = state.transcript[_currentSegIdx];
    if (!seg) return;

    _resumeText    = seg.text;
    _resumeIndex   = 0;
    _lastCharIndex = 0;

    // TTS shuru karo → onstart → video.play()
    _speakFrom(_resumeText, 0, _currentSegIdx);
    _setMode('busy', 'playing'); // TTS start hone ka wait
  }

  // Note: _ttsState === 'playing' pe kuch nahi karna (button disabled hoga)
  // Note: _caseAHold mein bhi kuch nahi (dono buttons disabled hote hain)
}

/**
 * Pause button click handler.
 * Cases:
 *   - playing → TTS pause first → (onerror mein) video pause
 *   - segDone → Case B: sirf video pause
 */
export function pause() {
  if (!_moduleActive) return;
  _userWantsPlay = false;

  // ── TTS chal rahi hai — pehle use pause karo ─────────────────────────────
  if (_ttsState === 'playing') {
    _resumeIndex  = _lastCharIndex; // Current word position save karo
    _pendingPause = true;            // onerror ko batao yeh intentional cancel hai
    _setMode('busy', 'paused'); // turant spinner — double-click se double cancel nahi hoga
    synth.cancel();
    // Aage ka kaam (video.pause + button update) onerror 'interrupted' mein hoga
    return;
  }

  // ── Case B: TTS khatam tha — sirf video pause karo ───────────────────────
  if (!video.paused) {
    video.pause();
  }
  _setMode('paused');
}

/**
 * Segment navigation handler (arrow keys + transcript clicks).
 * Current TTS cancel karo, diye gaye segment par jaao.
 *
 * @param {number} idx - Target segment index
 */
export function seekToSegment(idx) {
  if (!_moduleActive) return;
  const segs = state.transcript;
  if (idx < 0 || idx >= segs.length) return;

  // Sab kuch band karo
  _stopHeartbeat();
  _pendingPause = false;  // Pending pause ignore karo
  _epoch++;               // Purane timeouts stale
  synth.cancel();

  // State reset
  _caseAHold         = false;
  _currentSegIdx     = idx;
  _lastVidSegIdx     = idx;   // Backward seek pe purani boundary re-trigger na ho
  _videoReadyForNext = false;
  _ttsReadyForNext   = false;
  _nextSegForVideo   = -1;
  _ttsState          = 'idle';
  _resumeText        = segs[idx].text;
  _resumeIndex       = 0;
  _lastCharIndex     = 0;

  video.currentTime = segs[idx].start;
  video.pause();

  if (!_userWantsPlay) {
    _stopHeartbeat();
    _setMode('paused');
    return;
  }

  _speakFrom(segs[idx].text, 0, idx);
  _setMode('busy', 'playing');
}

/**
 * Player screen kholte waqt call karo (player.js ke open() mein).
 * Saari state reset hoti hai, first segment ke liye ready.
 */
export function init() {
  _moduleActive      = true;
  _ttsState          = 'idle';
  _caseAHold         = false;
  _videoReadyForNext = false;
  _ttsReadyForNext   = false;
  _nextSegForVideo   = -1;
  _lastVidSegIdx     = -1;
  _pendingPause      = false;
  _heartbeatOn       = false;
  _epoch++;
  _queued            = null;
  _userWantsPlay     = true;

  const segs = state.transcript;
  if (segs.length) {
    _currentSegIdx = 0;
    _resumeText    = segs[0].text;
    _resumeIndex   = 0;
    _lastCharIndex = 0;
  } else {
    _currentSegIdx = -1;
  }

  _setMode('paused'); // user ke play click ka wait
}

/**
 * Player screen band karte waqt call karo (player.js ke backBtn listener mein).
 * TTS cancel, heartbeat band, cleanup.
 */
export function destroy() {
  _moduleActive = false;
  _epoch++;
  _queued = null;
  _pendingPause = false;
  _clearBusyTimer();
  _stopHeartbeat();
  synth.cancel();
  _ttsState  = 'idle';
  _caseAHold = false;
  _mode = 'paused';
  _renderBtn();
}
