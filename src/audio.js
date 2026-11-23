// Spin sound: two seamless ~1 s loops whose volume follows the ball's spin: silent at rest,
// full during Golden Rotation.
//   hamon  - 3.0-4.0 s of the source video's clip: plays from rest up to full speed
//   golden - the "Spinning | Free Sound Effect" whoosh (YouTube AWbNJVsW-ig): the golden-ratio
//            noise, which takes over from hamon once the spin passes hamon's full volume
import hamonUrl from './assets/hamon-loop.wav';
import goldenUrl from './assets/spinning-loop.wav';

const LEVEL = 0.8;
const GOLDEN_LEVEL = 0.8; // trim for the golden loop on top of LEVEL
const SMOOTH = 0.08; // seconds: time constant of the volume follow
const IDLE_STOP = 1; // seconds of silence before the loop sources are torn down

let ctx = null;
let master = null;
const RING_TAU = 2.2; // seconds: how slowly a toss's ring fades (volume then falls to the spin's own)
let ring = 0; // 0..1, a toss's lingering loudness: holds the sound up while the spin dies away
let amount = 0; // 0..1, how loud the spin wants it
let muted = false;
let silentFor = 0;

// One loop each: its decoded buffer, its own gain into the master, and the running source.
const tracks = {
  hamon: { url: hamonUrl, level: 1, buffer: null, gain: null, source: null },
  golden: { url: goldenUrl, level: GOLDEN_LEVEL, buffer: null, gain: null, source: null },
};

function setup() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  for (const t of Object.values(tracks)) {
    t.gain = ctx.createGain();
    t.gain.gain.value = 0;
    t.gain.connect(master);
    fetch(t.url)
      .then((r) => r.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .then((b) => { t.buffer = b; })
      .catch(() => {});
  }
}

// Call from a user gesture (browsers block audio until then); safe to call repeatedly.
export function unlockHamon() {
  setup();
  if (ctx.state !== 'running') ctx.resume();
}

function startLoop(t) {
  if (!t.buffer || t.source) return;
  t.source = ctx.createBufferSource();
  t.source.buffer = t.buffer;
  t.source.loop = true;
  t.source.connect(t.gain);
  t.source.start();
}

function stopLoop(t) {
  if (!t.source) return;
  t.source.stop();
  t.source = null;
}

// Call every frame. value: 0..1 spin loudness (0 = at rest). goldenMix: 0..1, how far the spin
// is past hamon's full-volume speed (0 = hamon only, 1 = golden loop only). dt in seconds.
export function setSpinAmount(value, goldenMix, dt) {
  ring *= Math.exp(-dt / RING_TAU);
  amount = Math.max(value, ring);
  if (!ctx || ctx.state !== 'running') return;
  if (amount > 0.001) {
    silentFor = 0;
    for (const t of Object.values(tracks)) startLoop(t);
  } else if ((silentFor += dt) > IDLE_STOP) {
    for (const t of Object.values(tracks)) stopLoop(t);
  }
  // Equal-power crossfade, so the blend doesn't dip in the middle.
  const a = goldenMix * Math.PI / 2;
  tracks.hamon.gain.gain.setTargetAtTime(Math.cos(a), ctx.currentTime, SMOOTH);
  tracks.golden.gain.gain.setTargetAtTime(Math.sin(a) * tracks.golden.level, ctx.currentTime, SMOOTH);
  master.gain.setTargetAtTime(muted ? 0 : amount * LEVEL, ctx.currentTime, SMOOTH);
}

// Call when the ball is tossed, with 0..1 for how hard: the sound rings on, fading slowly,
// on top of the whirring instead of dropping with the spin.
export function ringOut(strength) {
  ring = Math.max(ring, strength);
}

export function setMuted(value) {
  muted = value;
}
