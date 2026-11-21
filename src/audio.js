// Hamon sound: a seamless ~1 s loop (3.0-4.0 s of the source clip) that fades in while
// Golden Rotation runs and out after.
import hamonUrl from './assets/hamon-loop.wav';

const FADE_IN = 0.15; // seconds
const FADE_OUT = 0.5;
const LEVEL = 0.8;

let ctx = null;
let gain = null;
let source = null;
let buffer = null;
let wanted = false; // whether the sound should currently be playing
let muted = false;

function setup() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);
  fetch(hamonUrl)
    .then((r) => r.arrayBuffer())
    .then((data) => ctx.decodeAudioData(data))
    .then((b) => {
      buffer = b;
      if (wanted) start();
    })
    .catch(() => {});
}

function start() {
  if (!buffer || source) return;
  source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(gain);
  source.start();
}

function ramp(to, seconds) {
  const t = ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(to, t + seconds);
}

// Call from a user gesture the first time (browsers block audio until then).
export function playHamon() {
  setup();
  wanted = true;
  ctx.resume();
  start();
  ramp(muted ? 0 : LEVEL, FADE_IN);
}

export function stopHamon() {
  if (!ctx) return;
  wanted = false;
  ramp(0, FADE_OUT);
  const s = source;
  setTimeout(() => {
    if (!wanted && s && s === source) {
      s.stop();
      source = null;
    }
  }, FADE_OUT * 1000 + 50);
}

export function setMuted(value) {
  muted = value;
  if (ctx && wanted) ramp(muted ? 0 : LEVEL, 0.1);
}
