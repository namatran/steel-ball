// Hamon sound: a seamless ~1 s loop (3.0-4.0 s of the source clip) whose volume follows the
// ball's spin: silent at rest, full during Golden Rotation.
import hamonUrl from './assets/hamon-loop.wav';

const LEVEL = 0.8;
const SMOOTH = 0.08; // seconds: time constant of the volume follow
const IDLE_STOP = 1; // seconds of silence before the loop source is torn down

let ctx = null;
let gain = null;
let source = null;
let buffer = null;
let amount = 0; // 0..1, how loud the spin wants it
let muted = false;
let silentFor = 0;

function setup() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);
  fetch(hamonUrl)
    .then((r) => r.arrayBuffer())
    .then((data) => ctx.decodeAudioData(data))
    .then((b) => { buffer = b; })
    .catch(() => {});
}

// Call from a user gesture (browsers block audio until then); safe to call repeatedly.
export function unlockHamon() {
  setup();
  if (ctx.state !== 'running') ctx.resume();
}

// Call every frame with 0..1 (0 = at rest). dt in seconds.
export function setSpinAmount(value, dt) {
  amount = value;
  if (!ctx || ctx.state !== 'running') return;
  if (amount > 0.001) {
    silentFor = 0;
    if (buffer && !source) {
      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain);
      source.start();
    }
  } else if (source && (silentFor += dt) > IDLE_STOP) {
    source.stop();
    source = null;
  }
  gain.gain.setTargetAtTime(muted ? 0 : amount * LEVEL, ctx.currentTime, SMOOTH);
}

export function setMuted(value) {
  muted = value;
}
