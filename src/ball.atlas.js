import * as THREE from 'three';
import inkUrl from './assets/ink.png';
import SHADE from './assets/shade.json';
import FRAME_POSES from './assets/frame-poses.json';
import { ATLAS, CELL, PANEL, HEX } from './inkAtlas.js';

export const PHI = (1 + Math.sqrt(5)) / 2;

// ---------- shape ----------
// One height field drives both the geometry (vertex displacement) and the
// per-pixel normals, so the shading always comes from the actual form.
//
// Layout: a regular hexagon plate at each pole, outlined by a groove. From
// each corner a long slot runs down the meridian toward the matching corner
// on the other side. Every groove has the same width and profile.
const shapeChunk = /* glsl */ `
  uniform float uApothem; // hexagon center-to-edge, radians
  uniform float uBulge;   // radius of each side's arc, radians (PI/2 = straight)
  uniform float uSlotGap; // gap between a hexagon corner and the slot end, radians
  uniform float uDepth;   // groove depth, in ball radii

  const float PI = 3.14159265;
  const float SEG = 1.04719755; // 60°
  const float GROOVE = 0.05;    // groove half-width, radians

  // Where p sits in the layout.
  struct Layout {
    float groove; // angle to the nearest groove center line
    float plate;  // signed angle to the hexagon edge, positive inside
    float dp;     // longitude from the middle of the panel
    float id;     // panel index
  };

  Layout layoutAt(vec3 p) {
    Layout o;
    float theta = acos(clamp(p.y, -1.0, 1.0));
    float lon = atan(p.z, p.x);

    // Hexagon around the nearer pole. Each side is an arc of a circle of
    // radius uBulge centered on its side's meridian, just past the pole, so
    // the sides bow out slightly. The nearest side by longitude is always
    // the binding one, so one test is exact.
    float k = floor(lon / SEG + 0.5);
    o.dp = lon - k * SEG;
    o.id = k;
    float cc = uApothem - uBulge;
    float toCenter = sin(theta) * sin(cc) * cos(o.dp) + abs(p.y) * cos(cc);
    o.plate = uBulge - acos(clamp(toCenter, -1.0, 1.0));

    // Slots: capsules along the corner meridians (30° + k·60°), stopping
    // uSlotGap short of the corners.
    float dl = mod(lon, SEG) - SEG * 0.5;
    // Corners: where neighbouring side arcs meet, 30° from a side's middle.
    float ka = sin(cc) * cos(SEG * 0.5), kb = cos(cc);
    float cornerTheta = atan(ka, kb) + acos(clamp(cos(uBulge) / length(vec2(ka, kb)), -1.0, 1.0));
    float halfLen = PI * 0.5 - cornerTheta - uSlotGap;
    float across = asin(clamp(sin(theta) * sin(dl), -1.0, 1.0));
    float along = max(abs(theta - PI * 0.5) - halfLen, 0.0);
    float slot = length(vec2(across, along));

    o.groove = min(abs(o.plate), slot);
    return o;
  }

  float heightAt(float g) {
    // Rounded channel with a low lip along each side, like the replicas.
    float h = -uDepth * (1.0 - smoothstep(GROOVE * 0.4, GROOVE, g));
    float lip = smoothstep(GROOVE * 0.8, GROOVE * 1.04, g) * (1.0 - smoothstep(GROOVE * 1.04, GROOVE * 1.5, g));
    return h + uDepth * 0.22 * lip;
  }

  float shapeHeight(vec3 p) {
    return heightAt(layoutAt(p).groove);
  }
`;

const vertexShader = /* glsl */ `
  ${shapeChunk}
  varying vec3 vDir;
  varying vec3 vPos;
  // normalMatrix, passed down so the fragment shader can light
  // object-space normals.
  varying vec3 vM0;
  varying vec3 vM1;
  varying vec3 vM2;

  void main() {
    vec3 dir = normalize(position);
    vDir = dir;
    vec3 displaced = dir * (1.0 + shapeHeight(dir));
    vM0 = normalMatrix[0];
    vM1 = normalMatrix[1];
    vM2 = normalMatrix[2];
    vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
    vPos = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

// Two layers, like the anime's CGI ball:
//  1. paint: a texture atlas in object space (greens, light and dark cel
//     shapes, ink). It sticks to the ball and turns with it.
//  2. shadow: one darkening from a fixed light, so it stays put while the
//     ball spins. All colour comes from the painting.
const fragmentShader = /* glsl */ `
  ${shapeChunk}
  uniform sampler2D uInk;
  uniform vec3 uLight;  // view space
  uniform vec3 uAxis;   // spin axis, object space
  uniform float uBlur;  // radians swept during one "shutter"

  varying vec3 vDir;
  varying vec3 vPos;
  varying vec3 vM0;
  varying vec3 vM1;
  varying vec3 vM2;

  uniform float uShadow; // 0..1, how much of the baked-frame shadow to apply
  uniform float uG[9]; // baked-frame shadow curve over dot(S,L) = -1..1
  float shadowAt(float d) {
    float x = clamp((d * 0.5 + 0.5) * 8.0, 0.0, 7.9999);
    int i = int(floor(x));
    float a = uG[0], b = uG[0];
    for (int j = 0; j < 9; j++) { if (j == i) a = uG[j]; if (j == i + 1) b = uG[j]; }
    return max(mix(a, b, fract(x)), 0.12);
  }

  vec3 rotateAround(vec3 v, vec3 k, float a) {
    float c = cos(a), s = sin(a);
    return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
  }

  // Atlas position (in pixels) of a spot on the ball. Layout: see inkAtlas.js.
  vec2 atlasPx(vec3 p, Layout o) {
    if (o.plate > 0.0) {
      // Hexagon: flat projection around the pole, scaled with its size.
      vec2 q = vec2(p.x, p.z) * (sin(${(24 * Math.PI / 180).toFixed(6)}) / sin(uApothem));
      if (p.y < 0.0) q.y = -q.y;
      q = clamp(q * ${HEX.pxPerUnit.toFixed(1)}, vec2(-${HEX.r.toFixed(1)}), vec2(${HEX.r.toFixed(1)}));
      float cell = p.y > 0.0 ? 6.0 : 7.0;
      return vec2(mod(cell, 4.0) * ${CELL.w.toFixed(1)}, floor(cell / 4.0) * ${CELL.h.toFixed(1)})
           + vec2(${HEX.cx.toFixed(1)}, ${HEX.cy.toFixed(1)}) + q;
    }
    // Panel: across by longitude, along by distance from the equator,
    // straightened so the hexagon's groove is the same line everywhere.
    float cc = uApothem - uBulge;
    float ea = sin(cc) * cos(o.dp), eb = cos(cc);
    float edge = atan(ea, eb) + acos(clamp(cos(uBulge) / length(vec2(ea, eb)), -1.0, 1.0));
    float s = abs(acos(clamp(p.y, -1.0, 1.0)) - PI * 0.5);
    float v = s / max(PI * 0.5 - edge, 0.01);
    float cell = mod(o.id, 6.0) + (p.y < 0.0 ? 8.0 : 0.0); // south half has its own cells 8-13
    vec2 local = vec2(${PANEL.x.toFixed(1)} + (0.5 + o.dp / SEG) * ${PANEL.w.toFixed(1)},
                      min(${PANEL.y.toFixed(1)} + v * ${PANEL.edgeY.toFixed(1)}, ${PANEL.maxY.toFixed(1)}));
    return vec2(mod(cell, 4.0) * ${CELL.w.toFixed(1)}, floor(cell / 4.0) * ${CELL.h.toFixed(1)}) + local;
  }

  vec3 sampleColor(vec3 p, float a, mat3 nm, vec3 S, vec3 V, vec3 L) {
    // (N below only shapes the groove; the shadow uses the true sphere normal S)
    // Shaped normal from the height field's slope along two tangents.
    vec3 t1 = normalize(cross(p, abs(p.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(p, t1);
    const float E = 0.0015;
    Layout o = layoutAt(p);
    float h = heightAt(o.groove);
    float g1 = (shapeHeight(normalize(p + t1 * E)) - h) / E;
    float g2 = (shapeHeight(normalize(p + t2 * E)) - h) / E;
    vec3 n = normalize(p * (1.0 + h) - (g1 * t1 + g2 * t2));
    vec3 N = normalize(nm * rotateAround(n, uAxis, -a));

    // The painting carries every colour. The only light is a fixed shadow:
    // the part of the ball facing away from the light goes darker, and it
    // stays put while the ball (and its paint) turns.
    vec2 px = atlasPx(p, o);
    // Texture derivatives from a seam-free coordinate: the north/south cells and the hexagon/panel cells
    // sit far apart in the atlas, so the raw jump would pick the blurriest mip level along the seams.
    vec2 pxd = o.plate > 0.0 ? px : atlasPx(vec3(p.x, abs(p.y), p.z), o);
    vec2 uv = vec2(px.x / ${ATLAS.w.toFixed(1)}, 1.0 - px.y / ${ATLAS.h.toFixed(1)});
    vec2 uvd = vec2(pxd.x / ${ATLAS.w.toFixed(1)}, 1.0 - pxd.y / ${ATLAS.h.toFixed(1)});
    vec3 col = textureGrad(uInk, uv, dFdx(uvd), dFdy(uvd)).rgb;
    col *= 2.0 * mix(1.0, shadowAt(dot(S, L)), uShadow); // paint is stored at half scale; 0 = fully lit, flat
    return col;
  }

  void main() {
    mat3 nm = mat3(vM0, vM1, vM2);
    vec3 L = normalize(uLight);
    vec3 V = normalize(-vPos);
    vec3 dir = normalize(vDir);
    vec3 S = normalize(nm * dir);

    vec3 col;
    if (uBlur < 0.01) {
      col = sampleColor(dir, 0.0, nm, S, V, L);
    } else {
      // Rotational motion blur: average the surface that passes under this
      // pixel during the shutter. Sample count grows with the sweep.
      const int MAX_SAMPLES = 10;
      int count = int(clamp(uBlur * 12.0, 4.0, float(MAX_SAMPLES)));
      float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      col = vec3(0.0);
      for (int i = 0; i < MAX_SAMPLES; i++) {
        if (i >= count) break;
        float a = ((float(i) + jitter) / float(count) - 0.5) * uBlur;
        col += sampleColor(rotateAround(dir, uAxis, a), a, nm, S, V, L);
      }
      col /= float(count);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Ball orientations that match the frames (fitted per frame; see scripts/paint).
export const STILL_POSES = FRAME_POSES;
export const OPENING_POSE = new THREE.Quaternion(...STILL_POSES.g018).normalize();

export const SHAPE_DEFAULTS = {
  plate: 24, // hexagon apothem, degrees
  curve: 78, // radius of each side's arc, degrees (90 = straight)
  slotGap: 9, // degrees between a hexagon corner and its slot
  depth: 0.022, // groove depth, ball radii
};

const deg = THREE.MathUtils.degToRad;

function loadInk() {
  const t = new THREE.TextureLoader().load(inkUrl);
  t.anisotropy = 8;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export function createBall() {
  const group = new THREE.Group();

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uApothem: { value: deg(SHAPE_DEFAULTS.plate) },
      uBulge: { value: deg(SHAPE_DEFAULTS.curve) },
      uSlotGap: { value: deg(SHAPE_DEFAULTS.slotGap) },
      uDepth: { value: SHAPE_DEFAULTS.depth },
      uInk: { value: loadInk() },
      uLight: { value: new THREE.Vector3(...SHADE.L).normalize() },
      uAxis: { value: new THREE.Vector3(0, 1, 0) },
      uBlur: { value: 0 },
      uG: { value: SHADE.g },
      uShadow: { value: 0.25 },
    },
  });

  // Dense enough that the grooves are real geometry, not just shading
  // (about 1° per segment; the groove is about 6° wide).
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 384, 192), material);
  // Starts at rest, posed like the opening's 1:21 frame.
  ball.quaternion.copy(OPENING_POSE);
  group.add(ball);

  // Ink outline: a back-face shell offset from the surface. It uses the same
  // height field as the ball, so the line follows the grooves and their
  // ridges at the silhouette, and it turns with the ball.
  const outline = new THREE.Mesh(
    ball.geometry,
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        uApothem: material.uniforms.uApothem,
        uBulge: material.uniforms.uBulge,
        uSlotGap: material.uniforms.uSlotGap,
        uDepth: material.uniforms.uDepth,
      },
      vertexShader: /* glsl */ `
        ${shapeChunk}
        void main() {
          vec3 dir = normalize(position);
          vec3 displaced = dir * (1.012 + shapeHeight(dir));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        void main() { gl_FragColor = vec4(0.1176, 0.2275, 0.0431, 1.0); } // 0x1e3a0b
      `,
    }),
  );
  ball.add(outline);

  return { group, ball, material };
}
