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
const THROW_HOLD = 0.8; // seconds a throw's opening sound is held before it follows the spin
const THROW_FADE = 0.5; // seconds: time constant of the hand-over to the spin's own loudness
let throwLevel = 0; // 0..1, loudness held right after a throw so the opening isn't cut short
let throwWhoosh = 0; // 0..1, the throw's whoosh: rings on over the whirring while the spin slows
let throwAge = Infinity; // seconds since the throw
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
  throwAge += dt;
  if (throwAge > THROW_HOLD) {
    throwLevel *= Math.exp(-dt / THROW_FADE);
    throwWhoosh *= Math.exp(-dt / THROW_FADE);
  }
  amount = Math.max(value, throwLevel);
  if (!ctx || ctx.state !== 'running') return;
  if (amount > 0.001) {
    silentFor = 0;
    for (const t of Object.values(tracks)) startLoop(t);
  } else if ((silentFor += dt) > IDLE_STOP) {
    for (const t of Object.values(tracks)) stopLoop(t);
  }
  // Hamon fades out equal-power as the spin goes past it; the whoosh follows the same mix but a
  // throw's whoosh is held a little longer, ringing on top of hamon as the spin slows.
  const h = Math.cos(goldenMix * Math.PI / 2);
  const w = Math.sin(Math.max(goldenMix, throwWhoosh) * Math.PI / 2) * tracks.golden.level;
  const norm = 1 / Math.max(1, Math.hypot(h, w)); // both audible: keep the sum from clipping
  tracks.hamon.gain.gain.setTargetAtTime(h * norm, ctx.currentTime, SMOOTH);
  tracks.golden.gain.gain.setTargetAtTime(w * norm, ctx.currentTime, SMOOTH);
  master.gain.setTargetAtTime(muted ? 0 : amount * LEVEL, ctx.currentTime, SMOOTH);
}

// Call when the ball is thrown. strength: 0..1 how loud the opening is; whoosh: 0..1 how much of
// it is the golden whoosh (a hard throw). Both are held for a moment so the opening isn't cut
// off, then ease back to the spin's own sound (nothing lingers once the spin is done).
export function throwSound(strength, whoosh) {
  throwLevel = strength;
  throwWhoosh = whoosh;
  throwAge = 0;
}

export function setMuted(value) {
  muted = value;
}
