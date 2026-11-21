import * as THREE from 'three';
import paintUrl from './assets/ball-cube.png';
import SHADE from './assets/shade.json';

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

const fragmentShader = /* glsl */ `
  ${shapeChunk}
  // The paint (line work, black cel patches, greens, highlights) is copied from the show's
  // frames into an object-space cube map with the show's shadow divided out. Here it is
  // sampled per pixel and multiplied by that shadow again, from the current view-space
  // normal against a fixed light, so the shadow stays put while the ball turns.
  uniform samplerCube uPaint;
  uniform float uShade[9]; // shadow curve g(dot(n, L)) at 9 knots over -1..1
  uniform vec3 uLight;
  uniform vec3 uAxis;   // spin axis, ball space
  uniform float uBlur;  // radians swept during one "shutter"

  varying vec3 vDir;
  varying vec3 vM0;
  varying vec3 vM1;
  varying vec3 vM2;

  vec3 rotateAround(vec3 v, vec3 k, float a) {
    float c = cos(a), s = sin(a);
    return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
  }

  float shadowAt(float t) {
    float f = (clamp(t, -1.0, 1.0) + 1.0) * 4.0;
    int i = int(min(floor(f), 7.0));
    float a = uShade[0];
    float b = uShade[1];
    for (int k = 0; k < 8; k++) {
      if (k == i) { a = uShade[k]; b = uShade[k + 1]; }
    }
    return mix(a, b, f - float(i));
  }

  vec3 shade(vec3 dir) {
    vec3 S = normalize(mat3(vM0, vM1, vM2) * dir);
    // Paint is stored at half scale, so x2.
    return texture(uPaint, dir).rgb * 2.0 * shadowAt(dot(S, uLight));
  }

  void main() {
    vec3 dir = normalize(vDir);
    vec3 col;
    if (uBlur < 0.01) {
      col = shade(dir);
    } else {
      // Rotational motion blur: average the paint that passes under this pixel during
      // the shutter. Sample count grows with the sweep. The shadow stays in view space.
      const int MAX_SAMPLES = 8;
      int count = int(clamp(uBlur * 12.0, 3.0, float(MAX_SAMPLES)));
      float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      vec3 S = normalize(mat3(vM0, vM1, vM2) * dir);
      float sh = shadowAt(dot(S, uLight));
      col = vec3(0.0);
      for (int i = 0; i < MAX_SAMPLES; i++) {
        if (i >= count) break;
        float a = ((float(i) + jitter) / float(count) - 0.5) * uBlur;
        col += texture(uPaint, rotateAround(dir, uAxis, a)).rgb;
      }
      col = col / float(count) * 2.0 * sh;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

import FRAME_POSES from './assets/frame-poses.json';
// Poses of the frames the paint was baked from (scripts/paint), keyed by frame name.
export const STILL_POSES = FRAME_POSES;
export const OPENING_POSE = new THREE.Quaternion(...STILL_POSES.g018).normalize();

export const SHAPE_DEFAULTS = {
  plate: 24, // hexagon apothem, degrees
  curve: 78, // radius of each side's arc, degrees (90 = straight)
  slotGap: 9, // degrees between a hexagon corner and its slot
  depth: 0.022, // groove depth, ball radii
};

const deg = THREE.MathUtils.degToRad;

// Cube map from the baked 3x2 atlas (faces +X -X +Y -Y +Z -Z, three per row).
function paintTexture() {
  const tex = new THREE.CubeTexture();
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  const img = new Image();
  img.onload = () => {
    const n = img.width / 3;
    tex.image = [0, 1, 2, 3, 4, 5].map((f) => {
      const c = document.createElement('canvas');
      c.width = c.height = n;
      c.getContext('2d').drawImage(img, (f % 3) * n, Math.floor(f / 3) * n, n, n, 0, 0, n, n);
      return c;
    });
    tex.needsUpdate = true;
  };
  img.src = paintUrl;
  return tex;
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
      uAxis: { value: new THREE.Vector3(0, 1, 0) },
      uBlur: { value: 0 },
      uPaint: { value: paintTexture() },
      uShade: { value: SHADE.g },
      uLight: { value: new THREE.Vector3(...SHADE.L).normalize() },
    },
  });

  // Dense enough that the grooves are real geometry, not just shading
  // (about 1° per segment; the groove is about 6° wide).
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 384, 192), material);
  // Starts at rest, posed like the opening's 1:21 frame.
  ball.quaternion.copy(OPENING_POSE);
  group.add(ball);

  // Ink outline: a slightly larger back-face shell. Spheres look the same
  // from every angle, so it doesn't need to rotate with the ball.
  const outline = new THREE.Mesh(
    new THREE.SphereGeometry(1.012, 96, 64),
    new THREE.MeshBasicMaterial({ color: 0x1e3a0b, side: THREE.BackSide }),
  );
  group.add(outline);

  return { group, ball, material };
}
