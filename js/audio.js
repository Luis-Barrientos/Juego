/**
 * Procedural audio engine. All sounds are synthesised at runtime via the
 * Web Audio API — no external samples are loaded.
 *
 * Usage:
 *   import { Audio } from './audio.js';
 *   Audio.init();          // call once after a user gesture
 *   Audio.swordSwing();    // trigger a one-shot SFX
 */

let actx       = null;
let masterGain = null;
let droneGain  = null;
let initialised = false;

/** Initialise the audio context. Must be called from a user gesture. */
function init() {
  if (initialised) return;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return;
  actx       = new Ctor();
  masterGain = actx.createGain();
  masterGain.gain.value = 0.35;
  masterGain.connect(actx.destination);
  startDrone();
  initialised = true;
}

/**
 * Play a single oscillator tone with optional pitch slide.
 * @param {object} opts
 */
function tone({ freq = 440, type = 'sine', dur = 0.15, vol = 0.3, slide = 0, attack = 0.005, release = 0.05 }) {
  if (!actx) return;
  const t = actx.currentTime;
  const osc  = actx.createOscillator();
  const gain = actx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
  osc.connect(gain).connect(masterGain);
  osc.start(t);
  osc.stop(t + dur + release + 0.05);
}

/** Play band-pass filtered white noise — useful for impacts / hits. */
function noise({ dur = 0.15, vol = 0.3, freq = 1000 }) {
  if (!actx) return;
  const buf  = actx.createBuffer(1, actx.sampleRate * dur, actx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src    = actx.createBufferSource();
  const filter = actx.createBiquadFilter();
  const gain   = actx.createGain();
  src.buffer = buf;
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 4;
  gain.gain.value = vol;
  src.connect(filter).connect(gain).connect(masterGain);
  src.start();
}

/** Continuous low drone with subtle LFO modulation. */
function startDrone() {
  droneGain = actx.createGain();
  droneGain.gain.value = 0.04;
  droneGain.connect(masterGain);
  [55, 82.5, 110, 138].forEach((f, i) => {
    const o = actx.createOscillator();
    o.type = i % 2 ? 'triangle' : 'sine';
    o.frequency.value = f;
    const g = actx.createGain();
    g.gain.value = 0.25;
    o.connect(g).connect(droneGain);
    o.start();
    const lfo = actx.createOscillator();
    lfo.frequency.value = 0.05 + i * 0.03;
    const lfoGain = actx.createGain();
    lfoGain.gain.value = 0.1;
    lfo.connect(lfoGain).connect(g.gain);
    lfo.start();
  });
}

export const Audio = {
  init,
  swordSwing: () => { noise({ dur: 0.08, vol: 0.18, freq: 2400 }); tone({ freq: 320, type: 'square', dur: 0.05, vol: 0.08, slide: -180 }); },
  hit:        () => { noise({ dur: 0.06, vol: 0.22, freq: 600 });  tone({ freq: 180, type: 'square', dur: 0.06, vol: 0.15, slide: -120 }); },
  enemyDie:   () => { tone({ freq: 220, type: 'sawtooth', dur: 0.25, vol: 0.18, slide: -200 }); noise({ dur: 0.18, vol: 0.12, freq: 400 }); },
  bossHit:    () => { noise({ dur: 0.12, vol: 0.3, freq: 200 }); tone({ freq: 90, type: 'square', dur: 0.18, vol: 0.25, slide: -50 }); },
  magicShoot: () => { tone({ freq: 880, type: 'sine', dur: 0.18, vol: 0.18, slide: 600 }); tone({ freq: 1320, type: 'triangle', dur: 0.14, vol: 0.1 }); },
  playerHurt: () => { tone({ freq: 220, type: 'sawtooth', dur: 0.18, vol: 0.25, slide: -120 }); noise({ dur: 0.1, vol: 0.15, freq: 300 }); },
  pickup:     () => { tone({ freq: 660, type: 'sine', dur: 0.08, vol: 0.18 }); tone({ freq: 990, type: 'sine', dur: 0.1, vol: 0.18 }); },
  coin:       () => { tone({ freq: 1320, type: 'square', dur: 0.05, vol: 0.12 }); tone({ freq: 1760, type: 'square', dur: 0.06, vol: 0.12 }); },
  stairs:     () => { [440, 660, 880, 1100].forEach((f, i) => setTimeout(() => tone({ freq: f, type: 'triangle', dur: 0.18, vol: 0.18 }), i * 70)); },
  upgrade:    () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone({ freq: f, type: 'sine', dur: 0.22, vol: 0.18 }), i * 60)); },
  win:        () => { [523, 659, 784, 1047, 1318].forEach((f, i) => setTimeout(() => tone({ freq: f, type: 'sine', dur: 0.35, vol: 0.22 }), i * 130)); },
  death:      () => { tone({ freq: 440, type: 'sawtooth', dur: 1.2, vol: 0.3, slide: -380 }); },
  whisper:    () => {
    if (!actx) return;
    const dur = 1.6 + Math.random() * 1.2;
    const buf = actx.createBuffer(1, actx.sampleRate * dur, actx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      const env = Math.sin(Math.PI * t) * (0.6 + 0.4 * Math.sin(t * 18));
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = actx.createBufferSource();
    const f1  = actx.createBiquadFilter();
    const f2  = actx.createBiquadFilter();
    const gain = actx.createGain();
    src.buffer = buf;
    f1.type = 'bandpass'; f1.frequency.value = 320; f1.Q.value = 6;
    f2.type = 'bandpass'; f2.frequency.value = 780; f2.Q.value = 5;
    gain.gain.value = 0.09;
    src.connect(f1).connect(f2).connect(gain).connect(masterGain);
    src.start();
  },
  woodCreak:  () => {
    if (!actx) return;
    // A short, low-pitched creak: filtered noise with a slow amplitude
    // wobble plus a faint downward chirp on a triangle oscillator.
    const dur = 0.55 + Math.random() * 0.3;
    const buf = actx.createBuffer(1, actx.sampleRate * dur, actx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      // Slow tremolo so the noise reads as a wood "groan" not a hiss.
      const env = Math.sin(Math.PI * t) * (0.55 + 0.45 * Math.sin(t * 9));
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src  = actx.createBufferSource();
    const lp   = actx.createBiquadFilter();
    const bp   = actx.createBiquadFilter();
    const gain = actx.createGain();
    src.buffer = buf;
    lp.type = 'lowpass';  lp.frequency.value = 360;
    bp.type = 'bandpass'; bp.frequency.value = 180; bp.Q.value = 4;
    gain.gain.value = 0.07;
    src.connect(lp).connect(bp).connect(gain).connect(masterGain);
    src.start();
    // Pair with a very low groan tone for body.
    tone({ freq: 110, type: 'triangle', dur: dur * 0.8, vol: 0.05, slide: -28 });
  },
};
