import * as THREE from 'three';
import GUI from 'lil-gui';
import { createBall, PHI, SHAPE_DEFAULTS, OPENING_POSE, STILL_POSES } from './ball.atlas.js';
import { createShadow, createStreaks, createGoldenRect } from './effects.js';

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

const goldenRect = createGoldenRect();
scene.add(goldenRect.group);

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
  streaks: true,
  diagram: false, // show the golden rectangle outside Golden Rotation too
  diagramSize: 2.3,
  ...SHAPE_DEFAULTS,
  golden: () => toggleGolden(),
  pose: () => openingPose(),
  still: 'g018',
  reset: () => resetSettings(),
};

const gui = new GUI({ container: card, title: 'Spin' });
gui.add(params, 'speed', 0, 60, 0.1).name('Spin speed').listen();
gui.add(params, 'tilt', -90, 90, 1).name('Axis tilt');
gui.add(params, 'lean', -90, 90, 1).name('Axis lean');
gui.add(params, 'friction', 0.05, 3, 0.05).name('Settle rate');
gui.add(params, 'size', 0.4, 1.3, 0.01).name('Ball size');
gui.add(params, 'blur').name('Motion blur');
gui.add(params, 'streaks').name('Speed lines');
gui.add(params, 'diagram').name('Golden rectangle');
gui.add(params, 'diagramSize', 0.8, 3.5, 0.01).name('Rectangle size');
const shape = gui.addFolder('Shape');
const deg = THREE.MathUtils.degToRad;
shape.add(params, 'plate', 14, 34, 0.5).name('Hexagon size').onChange((v) => (material.uniforms.uApothem.value = deg(v)));
shape.add(params, 'curve', 40, 90, 1).name('Side curve').onChange((v) => (material.uniforms.uBulge.value = deg(v)));
shape.add(params, 'slotGap', 0, 25, 0.5).name('Slot gap').onChange((v) => (material.uniforms.uSlotGap.value = deg(v)));
shape.add(params, 'depth', 0.005, 0.05, 0.001).name('Groove depth').onChange((v) => (material.uniforms.uDepth.value = v));
shape.close();
const goldenButton = gui.add(params, 'golden').name('✦ Golden Rotation');
gui.add(params, 'pose').name('◎ Opening pose');
gui.add(params, 'still', Object.keys(STILL_POSES)).name('Pose of still').onChange((n) => {
  if (golden.active) toggleGolden();
  params.speed = 0;
  omega.set(0, 0, 0);
  ball.quaternion.set(...STILL_POSES[n]).normalize();
});
gui.add(params, 'reset').name('↺ Reset settings');

// ---------- golden rotation ----------
// Winds the motor up in steps of ×φ, one step every 1/φ seconds.
const GOLDEN_BASE = 3;
const GOLDEN_STEPS = 6;
const golden = { active: false, t: 0, step: 0, glow: 0 };

function toggleGolden() {
  golden.active = !golden.active;
  golden.t = 0;
  golden.step = 0;
  if (!golden.active) params.speed = 0; // release: let it coast down
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
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ---------- loop ----------
const clock = new THREE.Clock();
const zAxis = new THREE.Vector3(0, 0, 1);

function tick() {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  const time = clock.elapsedTime;

  if (golden.active) {
    golden.t += dt;
    golden.step = Math.min(Math.floor(golden.t * PHI), GOLDEN_STEPS);
    params.speed = Math.round(GOLDEN_BASE * Math.pow(PHI, golden.step) * 10) / 10;
  }
  golden.glow += ((golden.active ? 1 : 0) - golden.glow) * (1 - Math.exp(-3 * dt));

  if (drag.active) {
    omega.set(0, 0, 0); // the hand holds the ball
  } else {
    // Ease ω toward the motor's target spin.
    motorAxis(target).multiplyScalar(params.speed);
    omega.sub(target).multiplyScalar(Math.exp(-params.friction * dt)).add(target);
  }

  const speed = omega.length();
  if (speed > 1e-3) {
    spinAxis.copy(omega).divideScalar(speed);
    rotateBall(spinAxis, speed * dt);
  }

  // Shader: spin axis in the ball's own space, and how far it sweeps per frame.
  qInv.copy(ball.quaternion).invert();
  material.uniforms.uAxis.value.copy(spinAxis).applyQuaternion(qInv);
  material.uniforms.uBlur.value = params.blur ? Math.min(speed * (1 / 60) * 1.4, Math.PI * 2) : 0;

  // Speed lines follow the spin.
  streaks.group.quaternion.setFromUnitVectors(zAxis, spinAxis);
  // Capped so the strokes glide instead of strobing at high speed.
  streaks.spinner.rotation.z += Math.min(speed, 9) * dt;
  streaks.setOpacity(params.streaks ? THREE.MathUtils.smoothstep(speed, 6, 20) : 0);

  // Golden rectangle: shown with the toggle, and fades in with Golden Rotation.
  const show = Math.max(params.diagram ? 1 : 0, golden.glow);
  goldenRect.setOpacity(show);
  goldenRect.group.scale.setScalar(params.diagramSize * (0.94 + 0.06 * show));

  // Gentle float, with the shadow tightening as the ball dips.
  const bob = Math.sin(time * 1.3) * 0.06;
  ballGroup.scale.setScalar(params.size);
  ballGroup.position.y = 0.12 + bob;
  goldenRect.group.position.y = ballGroup.position.y;
  shadow.position.y = 0.12 - 1.67 * params.size;
  shadow.scale.setScalar(params.size * (1 - bob * 0.8));
  shadow.material.opacity = 1 - bob * 2;

  const rpm = Math.round((speed * 60) / (Math.PI * 2));
  readout.textContent = golden.active ? `φ^${golden.step} · ${rpm} rpm` : `${rpm} rpm`;

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

resize();
tick();

// Dev-only handle for inspecting the ball from the console.
if (import.meta.env.DEV) window.__steel = { ball, omega, params, material, STILL_POSES, THREE, ballGroup };
