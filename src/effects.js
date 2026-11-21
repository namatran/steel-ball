import * as THREE from 'three';
import { PHI } from './ball.js';

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
function ribbon({ shell, z, arc, width, wobble, seed }) {
  const steps = 96;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * arc;
    const r = shell + wobble * Math.sin(a * 3 + seed * 5);
    const zc = z + wobble * 1.6 * Math.sin(a * 1.3 + seed * 11);
    const half = width * Math.sin(Math.PI * t) * (0.6 + 0.4 * Math.sin(a * 5 + seed * 3) ** 2);
    for (const side of [-1, 1]) {
      const zz = zc + side * half;
      const rr = Math.sqrt(Math.max(r * r - zz * zz, 0.01)); // stay on the shell
      positions.push(rr * Math.cos(a), rr * Math.sin(a), zz);
      uvs.push(t, side * 0.5 + 0.5);
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

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float edge = abs(vUv.y - 0.5) * 2.0;                    // 0 center, 1 edge
        vec3 col = mix(vec3(0.74, 0.93, 0.29), vec3(0.16, 0.33, 0.04), smoothstep(0.35, 0.7, edge));
        col = mix(col, vec3(0.93, 1.0, 0.7), 1.0 - smoothstep(0.0, 0.18, edge)); // bright core
        float tail = smoothstep(0.0, 0.5, vUv.x);               // fades behind, sharp at the head
        gl_FragColor = vec4(col, uOpacity * tail);
      }
    `,
  });

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

  return {
    group,
    spinner,
    setOpacity(o) {
      material.uniforms.uOpacity.value = o;
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

  const inner = new THREE.Group();
  const gridGeometry = new THREE.BufferGeometry();
  gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(grid, 3));
  inner.add(new THREE.LineSegments(gridGeometry, material));
  inner.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(spiral), 600, 0.008, 5), spiralMaterial));
  inner.position.set(-(x + w / 2), -(y + h / 2), 0); // the eye

  const group = new THREE.Group();
  group.add(inner);
  group.position.z = -1.5;
  return {
    group,
    setOpacity(o) {
      material.opacity = o * 0.9;
      spiralMaterial.opacity = o;
      group.visible = o > 0.002;
    },
  };
}
