import * as THREE from 'three';
import GUI from 'lil-gui';
import { createBall, PHI, SHAPE_DEFAULTS, OPENING_POSE } from './ball.atlas.js';
import { createShadow, createStreaks, createGoldenRect } from './effects.js';
import { unlockHamon, setSpinAmount, setMuted, throwSound } from './audio.js';

// ?embed: compact mode for iframes (no caption, card fills the frame, controls collapsed).
const embedded = new URLSearchParams(location.search).has('embed');
document.documentElement.classList.toggle('embed', embedded);

const card = document.getElementById('card');
const canvas = document.getElementById('scene');
const readout = document.getElementById('readout');

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: import.meta.env.DEV });
const pixelRatio = Math.min(window.devicePixelRatio, 1.5);
renderer.setPixelRatio(pixelRatio);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
camera.position.set(0, 0, 6.8);

const { group: ballGroup, ball, material } = createBall();
scene.add(ballGroup);

const shadow = createShadow();
shadow.rotation.x = -Math.PI / 2.6;
scene.add(shadow);

const streaks = createStreaks();
ballGroup.add(streaks.group);

// Spin axis: a thin rod through the ball, along the current spin direction.
const axisRod = new THREE.Mesh(
  new THREE.CylinderGeometry(0.012, 0.012, 3.2, 12).rotateX(Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xd93a2b, transparent: true }),
);
axisRod.visible = false;
let axisFlash = 0; // seconds left of the rod showing after a tilt/lean slider moved
const motorDir = new THREE.Vector3();
ballGroup.add(axisRod);

// The rectangle's normal is the spin axis; its "up" follows screen-up as far as the plane
// allows, and it eases to a new orientation when the axis changes. `rectHolder` carries the
// orientation, and sits at the ball's centre.
const goldenRect = createGoldenRect();
goldenRect.group.position.z = 0;
const rectHolder = new THREE.Group();
rectHolder.position.z = 0; // through the ball's centre, so the near half draws over the ball
rectHolder.add(goldenRect.group);
scene.add(rectHolder);
const rectUp = new THREE.Vector3(0, 1, 0); // last usable "up", kept when the axis points along screen-up
const rectX = new THREE.Vector3();
const rectY = new THREE.Vector3();
const rectZ = new THREE.Vector3();
const rectBasis = new THREE.Matrix4();
const rectTarget = new THREE.Quaternion();

function resize() {
  const { width, height } = card.getBoundingClientRect();
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(card);

// ---------- controls ----------
const params = {
  speed: 0, // motor target, rad/s; starts at rest in the opening pose
  tilt: -18, // axis lean toward/away from the viewer, degrees
  lean: 12, // axis lean left/right, degrees
  friction: 0.8, // how fast the spin settles back to the motor speed
  size: 1, // ball scale
  blur: true,
  shadow: 0.25,
  streaks: true,
  hover: true, // gentle float up and down
  axis: false, // show the spin axis through the ball
  diagram: false, // show the golden rectangle outside Golden Rotation too
  diagramSize: 2.3,
  ...SHAPE_DEFAULTS,
  golden: () => toggleGolden(),
  pose: () => openingPose(),
  reset: () => resetSettings(),
};

// Any tilt/lean slider move flashes the axis rod and marks the axis as the user's own.
let axisTouched = false;
const sliderAxis = new THREE.Vector3(); // motor axis the sliders gave last time we looked
const newSliderAxis = new THREE.Vector3();
const sliderTurn = new THREE.Quaternion();
function onAxisSlider() {
  axisFlash = 1.4;
  axisTouched = true;
  // A toss-started spin keeps its own axis, so a slider move turns that axis by the same
  // rotation the slider's own axis just made (speed lines follow the spin axis).
  motorAxis(newSliderAxis);
  if (tossed) tossDir.applyQuaternion(sliderTurn.setFromUnitVectors(sliderAxis, newSliderAxis));
  sliderAxis.copy(newSliderAxis);
}

const gui = new GUI({ container: card, title: 'Spin' });
gui.add(params, 'speed', 0, 60, 0.1).name('Spin speed').listen();
gui.add(params, 'tilt', -90, 90, 1).name('Axis tilt').listen().onChange(onAxisSlider);
gui.add(params, 'lean', -90, 90, 1).name('Axis lean').listen().onChange(onAxisSlider);
gui.add(params, 'friction', 0.05, 3, 0.05).name('Settle rate');
gui.add(params, 'size', 0.4, 1.3, 0.01).name('Ball size');
gui.add(params, 'blur').name('Motion blur');
gui.add(params, 'shadow', 0, 1, 0.01).name('Shadow strength').onChange((v) => { if (material.uniforms.uShadow) material.uniforms.uShadow.value = v; });
gui.add(params, 'streaks').name('Speed lines');
gui.add(params, 'hover').name('Hover');
gui.add(params, 'axis').name('Show axis');
gui.add(params, 'diagram').name('Golden rectangle');
gui.add(params, 'diagramSize', 0.8, 3.5, 0.01).name('Rectangle size');
if (embedded) gui.close();
const shape = gui.addFolder('Shape');
const deg = THREE.MathUtils.degToRad;
shape.add(params, 'plate', 14, 34, 0.5).name('Hexagon size').onChange((v) => (material.uniforms.uApothem.value = deg(v)));
shape.add(params, 'curve', 40, 90, 1).name('Side curve').onChange((v) => (material.uniforms.uBulge.value = deg(v)));
shape.add(params, 'slotGap', 0, 25, 0.5).name('Slot gap').onChange((v) => (material.uniforms.uSlotGap.value = deg(v)));
shape.add(params, 'depth', 0.005, 0.05, 0.001).name('Groove depth').onChange((v) => (material.uniforms.uDepth.value = v));
shape.close();
const goldenButton = gui.add(params, 'golden').name('✦ Golden Rotation');
gui.add(params, 'pose').name('◎ Opening pose');
gui.add(params, 'reset').name('↺ Reset settings');

// ---------- golden rotation ----------
// Winds the motor up in steps of ×φ, one step every 1/φ seconds.
const GOLDEN_BASE = 3;
const golden = { active: false, t: 0, step: 0, glow: 0 };

// Golden Rotation turns the axis to face the camera, so the rectangle faces you and the ball
// spins like a wheel, but only while the user hasn't set the axis themselves. If it did,
// releasing puts the sliders back; if the user touches them meanwhile, it leaves them be.
const savedAxis = { tilt: 0, lean: 0, auto: false };
const tossDir = new THREE.Vector3(); // spin direction a toss-started Golden Rotation keeps
let tossed = false;

// fromToss: keep the spin the ball already has (axis and direction) instead of re-aiming it.
function toggleGolden(fromToss = false) {
  golden.active = !golden.active;
  golden.t = 0;
  golden.step = 0;
  if (golden.active) {
    // Pick up at the step nearest above the current speed, so a toss doesn't slow down first.
    const now = omega.length();
    golden.step = now > GOLDEN_BASE ? Math.ceil(Math.log(now / GOLDEN_BASE) / Math.log(PHI)) : 0;
    golden.t = golden.step / PHI;
    tossed = fromToss && now > 0.5;
    if (tossed) {
      tossDir.copy(omega).normalize();
      motorAxis(sliderAxis); // slider moves from here on turn the toss axis
    }
    savedAxis.auto = !axisTouched && !tossed;
    if (savedAxis.auto) {
      savedAxis.tilt = params.tilt;
      savedAxis.lean = params.lean;
      params.tilt = 90;
      params.lean = 0;
    }
  } else {
    if (savedAxis.auto && !axisTouched) {
      params.tilt = savedAxis.tilt;
      params.lean = savedAxis.lean;
    }
    tossed = false;
    params.speed = 0; // release: let it coast down
  }
  goldenButton.name(golden.active ? '✦ Release' : '✦ Golden Rotation');
}

// Stop the ball and turn it to match the opening's 1:21 frame.
function openingPose() {
  if (golden.active) toggleGolden();
  params.speed = 0;
  omega.set(0, 0, 0);
  ball.quaternion.copy(OPENING_POSE);
}

function resetSettings() {
  if (golden.active) toggleGolden();
  gui.reset(); // every control back to its starting value
  params.tilt = 90; // ...and the axis faces the camera again, as Golden Rotation starts it
  params.lean = 0;
  axisTouched = false;
}

// ---------- spin physics ----------
const omega = new THREE.Vector3(0, 0, 0); // angular velocity, world space, rad/s
const spinAxis = new THREE.Vector3(0, 1, 0); // last non-zero spin direction
const target = new THREE.Vector3();
const euler = new THREE.Euler();
const q = new THREE.Quaternion();
const qInv = new THREE.Quaternion();

function motorAxis(out) {
  euler.set(THREE.MathUtils.degToRad(params.tilt), 0, THREE.MathUtils.degToRad(-params.lean));
  return out.set(0, 1, 0).applyEuler(euler);
}

function rotateBall(axis, angle) {
  q.setFromAxisAngle(axis, angle);
  ball.quaternion.premultiply(q);
}

// ---------- drag to flick ----------
const drag = { active: false, x: 0, y: 0, time: 0, velocity: new THREE.Vector3() };
const dragAxis = new THREE.Vector3();
const RAD_PER_PX = 0.009;

canvas.addEventListener('pointerdown', (e) => {
  if (golden.active) toggleGolden(); // grabbing the ball cancels the Golden Rotation
  canvas.setPointerCapture(e.pointerId);
  drag.active = true;
  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.time = performance.now();
  drag.velocity.set(0, 0, 0);
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag.active) return;
  const now = performance.now();
  const dt = Math.max((now - drag.time) / 1000, 1 / 240);
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  const len = Math.hypot(dx, dy);
  if (len > 0) {
    // Dragging right spins around +Y, dragging down spins around +X.
    dragAxis.set(dy, dx, 0).normalize();
    const angle = len * RAD_PER_PX;
    rotateBall(dragAxis, angle);
    const instant = dragAxis.clone().multiplyScalar(angle / dt);
    drag.velocity.lerp(instant, 0.6);
  }
  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.time = now;
});

function endDrag() {
  if (!drag.active) return;
  drag.active = false;
  // Holding still before letting go means no flick.
  const idle = performance.now() - drag.time > 80;
  omega.copy(idle ? target.set(0, 0, 0) : drag.velocity).clampLength(0, 90);
  // hold the opening sound a moment; a hard throw's whoosh rings on over the whirring
  throwSound(THREE.MathUtils.smoothstep(omega.length(), 1.7, 20), THREE.MathUtils.smoothstep(omega.length(), 20, 54));
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ---------- sound button ----------
// Corner speaker button: mutes the hamon loop. Reset settings leaves it alone.
const speakerOn = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" fill="none"/></svg>';
const speakerOff = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9l5 6M21 9l-5 6" fill="none"/></svg>';
const soundButton = document.createElement('button');
soundButton.className = 'sound-button';
let muted = embedded; // embeds start silent; the button turns sound on
setMuted(muted);
function renderSound() {
  soundButton.innerHTML = muted ? speakerOff : speakerOn;
  soundButton.setAttribute('aria-label', muted ? 'Turn sound on' : 'Turn sound off');
  soundButton.setAttribute('aria-pressed', String(muted));
  soundButton.title = muted ? 'Sound off' : 'Sound on';
}
soundButton.addEventListener('click', () => {
  muted = !muted;
  setMuted(muted);
  renderSound();
});
renderSound();
card.appendChild(soundButton);

// ---------- golden chip ----------
// After a toss, a button hovers at the bottom while the ball still has momentum, to start the
// Golden Rotation before it coasts to a stop.
const chip = document.createElement('button');
chip.className = 'golden-chip';
chip.textContent = '✦ Golden Spin';
chip.addEventListener('click', () => { if (!golden.active) toggleGolden(true); });
card.appendChild(chip);

// Browsers only allow audio after a gesture: any press on the page unlocks it (and retries until it runs).
// Safari and some embedded browsers only count click/touchend/keydown, so listen for all of them.
for (const type of ['pointerdown', 'pointerup', 'click', 'touchend', 'keydown']) addEventListener(type, unlockHamon);

// ---------- loop ----------
const clock = new THREE.Clock();
let hoverAmt = 1;
const rpmFormat = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }); // 1.2M rpm
const zAxis = new THREE.Vector3(0, 0, 1);

// Embed: focus inside the iframe swallows Escape, so hand it to the host (which closes its lightbox).
if (embedded) addEventListener('keydown', (e) => { if (e.key === 'Escape') parent.postMessage({ type: 'steel-ball:close' }, '*'); });

// Embed: tell the host after the first frame (it hides its poster), and idle while scrolled offscreen.
let readySent = false;
let onscreen = true;
if (embedded && 'IntersectionObserver' in window) {
  new IntersectionObserver(([e]) => {
    const was = onscreen;
    onscreen = e.isIntersecting;
    if (onscreen && !was) { clock.getDelta(); requestAnimationFrame(tick); }
  }).observe(canvas);
}

function tick() {
  if (!onscreen) return;
  const dt = Math.min(clock.getDelta(), 1 / 30);
  const time = clock.elapsedTime;

  if (golden.active) {
    golden.t += dt;
    golden.step = Math.floor(golden.t * PHI); // no cap: keeps winding up ×φ every 1/φ s
    params.speed = Math.round(GOLDEN_BASE * Math.pow(PHI, golden.step) * 10) / 10;
  }
  golden.glow += ((golden.active ? 1 : 0) - golden.glow) * (1 - Math.exp(-3 * dt));

  if (drag.active) {
    omega.set(0, 0, 0); // the hand holds the ball
  } else {
    // Ease ω toward the motor's target spin.
    // Negative: the ball turns clockwise about the axis (the rectangle's normal), the way the
    // golden spiral winds in toward its eye.
    if (tossed) target.copy(tossDir).multiplyScalar(params.speed); // a toss keeps its own spin
    else motorAxis(target).multiplyScalar(-params.speed);
    omega.sub(target).multiplyScalar(Math.exp(-params.friction * dt)).add(target);
  }

  const speed = omega.length();
  // Hamon is full at ~190 rpm (20 rad/s); past that the spinning whoosh takes over, finished by
  // golden step 7 (~510 rpm), so Golden Rotation starts on hamon and winds up into the whoosh.
  setSpinAmount(
    golden.active ? 1 : THREE.MathUtils.smoothstep(speed, 1.7, 20), // ~0.5 volume at 100 rpm
    THREE.MathUtils.smoothstep(speed, 20, 54),
    dt,
  );
  if (speed > 1e-3) {
    spinAxis.copy(omega).divideScalar(speed);
    rotateBall(spinAxis, speed * dt);
  }

  // Shader: spin axis in the ball's own space, and how far it sweeps per frame.
  qInv.copy(ball.quaternion).invert();
  material.uniforms.uAxis.value.copy(spinAxis).applyQuaternion(qInv);
  material.uniforms.uBlur.value = params.blur ? Math.min(speed * (1 / 60) * 1.4, Math.PI * 2) : 0;

  // Moving a tilt/lean slider flashes the rod along the axis the slider sets (the real spin
  // axis lags behind it), then fades it out.
  axisFlash = Math.max(0, axisFlash - dt);
  axisRod.visible = params.axis || axisFlash > 0;
  axisRod.material.opacity = params.axis ? 1 : Math.min(1, axisFlash / 0.5);
  // While spinning it shows the real spin axis; at rest, the axis the motor will use.
  const shownAxis = axisFlash > 0 || speed <= 1e-3 ? motorAxis(motorDir) : motorDir.copy(spinAxis).negate();
  axisRod.quaternion.setFromUnitVectors(zAxis, shownAxis);

  // Golden rectangle plane: normal = axis, up = screen-up projected into the plane.
  rectZ.copy(shownAxis);
  rectY.set(0, 1, 0).addScaledVector(rectZ, -rectZ.y); // screen-up minus its part along the normal
  if (rectY.lengthSq() > 1e-4) rectUp.copy(rectY).normalize();
  else rectUp.addScaledVector(rectZ, -rectUp.dot(rectZ)).normalize(); // axis along screen-up: keep the last up
  rectX.crossVectors(rectUp, rectZ);
  rectBasis.makeBasis(rectX, rectUp, rectZ);
  rectTarget.setFromRotationMatrix(rectBasis);
  rectHolder.quaternion.slerp(rectTarget, 1 - Math.exp(-6 * dt));

  // Speed lines follow the spin.
  streaks.group.quaternion.setFromUnitVectors(zAxis, spinAxis);
  // Capped so the strokes glide instead of strobing at high speed.
  streaks.spinner.rotation.z += Math.min(speed, 9) * dt;
  // Golden Rotation swaps the lime lines for yellow golden spirals, which show up earlier.
  const g = golden.glow;
  const streakLevel = THREE.MathUtils.lerp(THREE.MathUtils.smoothstep(speed, 6, 20), THREE.MathUtils.smoothstep(speed, 3, 10), g);
  // Past ~15 rad/s the strokes would only strobe, so they melt into unbroken rings around the ball.
  const ringMix = THREE.MathUtils.smoothstep(speed, 15, 45);
  streaks.setOpacity(params.streaks ? streakLevel : 0, g, time, ringMix);

  // Golden rectangle: shown with the toggle, and fades in with Golden Rotation.
  const show = Math.max(params.diagram ? 1 : 0, golden.glow);
  goldenRect.setOpacity(show, time);
  goldenRect.group.scale.setScalar(params.diagramSize * (0.94 + 0.06 * show));

  // Gentle float, with the shadow tightening as the ball dips.
  hoverAmt += ((params.hover ? 1 : 0) - hoverAmt) * (1 - Math.exp(-4 * dt)); // eases in and out, no snap
  const bob = Math.sin(time * 1.3) * 0.06 * hoverAmt;
  ballGroup.scale.setScalar(params.size);
  ballGroup.position.y = 0.12 + bob;
  rectHolder.position.y = ballGroup.position.y;
  shadow.position.y = 0.12 - 1.67 * params.size;
  shadow.scale.setScalar(params.size * (1 - bob * 0.8));
  shadow.material.opacity = 1 - bob * 2;

  chip.classList.toggle('show', !golden.active && !drag.active && speed > 2);

  const rpm = rpmFormat.format(Math.round((speed * 60) / (Math.PI * 2)));
  readout.textContent = golden.active ? `φ^${golden.step} · ${rpm} rpm` : `${rpm} rpm`;

  renderer.render(scene, camera);
  if (embedded && !readySent) { readySent = true; parent.postMessage({ type: 'steel-ball:ready' }, '*'); }
  requestAnimationFrame(tick);
}

resize();
tick();

// Dev-only handle for inspecting the ball from the console.
if (import.meta.env.DEV) window.__steel = { ball, omega, params, material, THREE, ballGroup };
