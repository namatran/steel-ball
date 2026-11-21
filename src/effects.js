import * as THREE from 'three';
import { PHI } from './ball.atlas.js';

const GOLD = 0xc9a227;

// Soft contact shadow under the ball.
export function createShadow() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(40, 45, 30, 0.35)');
  g.addColorStop(1, 'rgba(40, 45, 30, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 1.0),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
    }),
  );
  return mesh;
}

// One painted ribbon wrapped around the spin axis (local +Z). It lies on a
// shell around the ball, wobbles in radius and height like a brush stroke,
// tapers at both ends, and carries uv: x along the stroke, y across it.
function ribbon({ shell, z, arc, width, wobble, seed, zOf, ring }) {
  const steps = 96;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * arc;
    const r = shell + wobble * Math.sin(a * 3 + seed * 5);
    const zc = zOf ? zOf(a) : z + wobble * 1.6 * Math.sin(a * 1.3 + seed * 11);
    // A ring is a closed loop of even width with no tail fade, so spinning it can't be seen.
    const half = ring ? width : width * Math.sin(Math.PI * t) * (0.6 + 0.4 * Math.sin(a * 5 + seed * 3) ** 2);
    for (const side of [-1, 1]) {
      const zz = zc + side * half;
      const rr = Math.sqrt(Math.max(r * r - zz * zz, 0.01)); // stay on the shell
      positions.push(rr * Math.cos(a), rr * Math.sin(a), zz);
      uvs.push(ring ? 1 : t, side * 0.5 + 0.5);
    }
    if (i < steps) {
      const k = i * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

// Speed lines like the anime opening: three bundles of lime ribbons hugging
// the middle of the ball, dark green at the edges, fading out at the tail.
export function createStreaks() {
  const group = new THREE.Group(); // oriented so local +Z = spin axis
  const spinner = new THREE.Group(); // spun around local Z
  group.add(spinner);

  // Lime in the show; yellow while the Golden Rotation is on (uGold 0..1).
  const makeMaterial = () => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uOpacity: { value: 0 }, uGold: { value: 0 }, uHalo: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform float uGold;
      uniform float uHalo;
      varying vec2 vUv;
      void main() {
        float edge = abs(vUv.y - 0.5) * 2.0;                    // 0 center, 1 edge
        vec3 mid = mix(vec3(0.74, 0.93, 0.29), vec3(0.98, 0.84, 0.2), uGold);
        vec3 core = mix(vec3(0.93, 1.0, 0.7), vec3(1.0, 0.97, 0.7), uGold);
        vec3 col = mix(mid, vec3(0.16, 0.33, 0.04), smoothstep(0.35, 0.7, edge));
        col = mix(col, core, 1.0 - smoothstep(0.0, 0.18, edge)); // bright core
        float tail = smoothstep(0.0, 0.5, vUv.x);               // fades behind, sharp at the head
        if (uHalo > 0.5) {                                      // soft golden glow around a strand
          float fall = 1.0 - edge * edge;
          gl_FragColor = vec4(vec3(1.0, 0.82, 0.25), uOpacity * tail * fall * fall);
          return;
        }
        gl_FragColor = vec4(col, uOpacity * tail);
      }
    `,
  });
  const material = makeMaterial();
  const spiralMaterial = makeMaterial();
  const haloMaterial = makeMaterial();
  haloMaterial.uniforms.uHalo.value = 1;
  // Full rings that take over from the streaks as the spin gets fast.
  const limeRingMaterial = makeMaterial();
  const goldRingMaterial = makeMaterial();
  const haloRingMaterial = makeMaterial();
  haloRingMaterial.uniforms.uHalo.value = 1;

  // Three bundles near the middle, each a few strands at slightly different heights.
  const lanes = [-0.3, 0, 0.3];
  lanes.forEach((lane, b) => {
    for (let j = 0; j < 3; j++) {
      const seed = b * 3 + j + 1;
      const mesh = new THREE.Mesh(
        ribbon({
          shell: 1.05 + j * 0.025,
          z: lane + (j - 1) * 0.06,
          arc: 2.2 + ((seed * 7) % 5) * 0.25,
          width: j === 1 ? 0.06 : 0.035,
          wobble: 0.015,
          seed,
        }),
        material,
      );
      mesh.rotation.z = (b * Math.PI * 2) / 3 + j * 0.5;
      spinner.add(mesh);
    }
  });

  // Lime rings at the same latitudes as the bundles.
  lanes.forEach((lane, b) => {
    for (let j = 0; j < 3; j++) {
      const mesh = new THREE.Mesh(
        ribbon({
          shell: 1.05 + j * 0.025,
          z: lane + (j - 1) * 0.06,
          arc: Math.PI * 2,
          width: j === 1 ? 0.03 : 0.018,
          wobble: 0,
          seed: b * 3 + j + 1,
          ring: true,
        }),
        limeRingMaterial,
      );
      spinner.add(mesh);
    }
  });

  // Golden strands: rings of constant latitude, as a spinning ball's surface
  // really moves. Their heights shrink by φ from ring to ring (0.93, 0.57,
  // 0.35 ...), one set per hemisphere, each ring a partial arc at its own phase.
  for (const side of [-1, 1]) {
    for (let k = 0; k < 6; k++) {
      const z = side * 0.93 * Math.pow(PHI, -k);
      const mesh = new THREE.Mesh(
        ribbon({
          shell: 1.05 + (k % 2) * 0.02,
          arc: Math.PI * (1.3 + (k % 3) * 0.2),
          width: 0.045,
          wobble: 0,
          seed: k + 1,
          zOf: () => z,
        }),
        spiralMaterial,
      );
      mesh.rotation.z = k * 2.4 + (side > 0 ? 0 : 1.1);
      spinner.add(mesh);
      const halo = new THREE.Mesh(
        ribbon({
          shell: 1.05 + (k % 2) * 0.02,
          arc: Math.PI * (1.3 + (k % 3) * 0.2),
          width: 0.16,
          wobble: 0,
          seed: k + 1,
          zOf: () => z,
        }),
        haloMaterial,
      );
      halo.rotation.z = mesh.rotation.z;
      spinner.add(halo);
      // Closed versions, shown at high speed.
      for (const [width, mat] of [[0.022, goldRingMaterial], [0.1, haloRingMaterial]]) {
        spinner.add(new THREE.Mesh(
          ribbon({ shell: 1.05 + (k % 2) * 0.02, arc: Math.PI * 2, width, wobble: 0, seed: k + 1, zOf: () => z, ring: true }),
          mat,
        ));
      }
    }
  }

  return {
    group,
    spinner,
    // o: overall visibility; gold: 0 = lime straight lines, 1 = yellow golden spirals.
    // ring: 0 = short streaks, 1 = unbroken rings around the ball (fast spin).
    setOpacity(o, gold = 0, time = 0, ring = 0) {
      const pulse = 0.5 + 0.12 * Math.sin(time * 4);
      const arcs = 1 - ring;
      haloMaterial.uniforms.uOpacity.value = o * gold * arcs * pulse;
      haloRingMaterial.uniforms.uOpacity.value = o * gold * ring * pulse;
      material.uniforms.uOpacity.value = o * (1 - gold) * arcs;
      material.uniforms.uGold.value = gold;
      limeRingMaterial.uniforms.uOpacity.value = o * (1 - gold) * ring;
      limeRingMaterial.uniforms.uGold.value = gold;
      spiralMaterial.uniforms.uOpacity.value = o * gold * arcs;
      spiralMaterial.uniforms.uGold.value = 1;
      goldRingMaterial.uniforms.uOpacity.value = o * gold * ring;
      goldRingMaterial.uniforms.uGold.value = 1;
    },
  };
}

// Golden vortex: arms of a logarithmic spiral swirling around the spin axis, like air
// dragged along by the ball. The radius grows by φ every half turn, and each arm drifts
// outward along the axis (a funnel) so it reads from the front as well as from above.
export function createVortex() {
  const group = new THREE.Group(); // oriented so local +Z = spin axis
  const spinner = new THREE.Group(); // turned around local Z
  group.add(spinner);

  const makeMaterial = (color, strength) => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec2 vUv;
      void main() {
        // vUv.x runs along the arm: fade in from the ball, thin out toward the far end.
        float a = smoothstep(0.0, 0.18, vUv.x) * (1.0 - smoothstep(0.55, 1.0, vUv.x));
        gl_FragColor = vec4(uColor, uOpacity * uStrength * a);
      }
    `,
  });
  const coreMaterial = makeMaterial(0xf6c92d, 1.0);
  const glowMaterial = makeMaterial(0xffc933, 0.28);

  const R0 = 0.85; // starts inside the ball, so arms emerge from it
  const TURNS = 1.2;
  for (const side of [-1, 1]) {
    for (let arm = 0; arm < 2; arm++) {
      const pts = [];
      const n = 160;
      for (let i = 0; i <= n; i++) {
        const th = (i / n) * TURNS * Math.PI * 2;
        const r = R0 * Math.pow(PHI, th / Math.PI); // ×φ per half turn
        const ph = th + arm * Math.PI + (side > 0 ? 0 : Math.PI / 2);
        pts.push(new THREE.Vector3(r * Math.cos(ph), r * Math.sin(ph), side * 0.28 * (r - R0)));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      spinner.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 240, 0.014, 6), coreMaterial));
      spinner.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.06, 8), glowMaterial));
    }
  }

  return {
    group,
    spinner,
    setOpacity(o, time = 0) {
      const pulse = 0.88 + 0.12 * Math.sin(time * 4);
      coreMaterial.uniforms.uOpacity.value = o * pulse;
      glowMaterial.uniforms.uOpacity.value = o * pulse;
      group.visible = o > 0.002;
    },
  };
}

// The golden rectangle: a φ:1 rectangle cut into ever smaller squares,
// with the quarter-circle spiral through them. Centered on the spiral's eye,
// so the ball sits where the spiral ends up.
export function createGoldenRect() {
  let x = 0, y = 0, w = PHI, h = 1;
  const grid = [0, 0, 0, w, 0, 0, w, 0, 0, w, h, 0, w, h, 0, 0, h, 0, 0, h, 0, 0, 0, 0];
  const spiral = [];
  const cut = (x1, y1, x2, y2) => grid.push(x1, y1, 0, x2, y2, 0);

  for (let k = 0; k < 14; k++) {
    const d = k % 4;
    const s = Math.min(w, h);
    let cx, cy;
    if (d === 0) { cx = x + s; cy = y; cut(x + s, y, x + s, y + h); x += s; w -= s; }          // square on the left
    else if (d === 1) { cx = x; cy = y + h - s; cut(x, y + h - s, x + w, y + h - s); h -= s; } // on top
    else if (d === 2) { cx = x + w - s; cy = y + h; cut(x + w - s, y, x + w - s, y + h); w -= s; } // on the right
    else { cx = x + w; cy = y + s; cut(x, y + s, x + w, y + s); y += s; h -= s; }             // on the bottom
    const a0 = Math.PI - (d * Math.PI) / 2;
    for (let j = 0; j <= 24; j++) {
      const a = a0 - (j / 24) * (Math.PI / 2);
      spiral.push(new THREE.Vector3(cx + s * Math.cos(a), cy + s * Math.sin(a), 0));
    }
  }

  const material = new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0 });
  const spiralMaterial = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0 });
  // Glow: two wider, faint tubes around the spiral.
  const glowMaterials = [0.045, 0.1].map(() => new THREE.MeshBasicMaterial({ color: 0xffc933, transparent: true, opacity: 0, depthWrite: false }));

  const inner = new THREE.Group();
  const gridGeometry = new THREE.BufferGeometry();
  gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(grid, 3));
  inner.add(new THREE.LineSegments(gridGeometry, material));
  const spiralCurve = new THREE.CatmullRomCurve3(spiral);
  inner.add(new THREE.Mesh(new THREE.TubeGeometry(spiralCurve, 600, 0.008, 5), spiralMaterial));
  [0.03, 0.07].forEach((r, i) => inner.add(new THREE.Mesh(new THREE.TubeGeometry(spiralCurve, 400, r, 8), glowMaterials[i])));
  inner.position.set(-(x + w / 2), -(y + h / 2), 0); // the eye

  const group = new THREE.Group();
  group.add(inner);
  group.position.z = -1.5;
  return {
    group,
    setOpacity(o, time = 0) {
      material.opacity = o * 0.9;
      spiralMaterial.opacity = o;
      const pulse = 0.85 + 0.15 * Math.sin(time * 4);
      glowMaterials[0].opacity = o * 0.3 * pulse;
      glowMaterials[1].opacity = o * 0.13 * pulse;
      group.visible = o > 0.002;
    },
  };
}
