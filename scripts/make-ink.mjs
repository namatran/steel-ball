// Writes src/assets/ink-template.png (guide lines to paint over) and a
// procedurally painted starter src/assets/ink.png. Run: npm run ink
//
// The starter art imitates the anime's glossy lime chrome: per panel a smooth
// lime->green gradient, a few big smooth dark reflection shapes, one long
// white glint, black ink along groove edges, flame tips and bunches of hatching.
import { writeFileSync, mkdirSync } from 'node:fs';
import zlib from 'node:zlib';
import { ATLAS, CELL, PANEL, HEX, cellOrigin, DEG, GROOVE, SEG, DEFAULT_SHAPE, thetaEdge } from '../src/inkAtlas.js';

const GW = GROOVE * 458.4; // groove half-width in px (~23)
const { apothem, bulge, slotGap } = DEFAULT_SHAPE;
const sEdgeCorner = Math.PI / 2 - thetaEdge(SEG / 2, apothem, bulge);
const slotEndY = PANEL.edgeY * (1 - slotGap / sEdgeCorner);
const SS = 2; // supersampling per axis

// ---- tiny PNG writer ----
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function png(w, h, rgba) {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head[8] = 8;
  head[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- helpers ----
const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hash = (a, b = 0, c = 0) => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const LIME = hex('#B4DE48'), MIDG = hex('#7DB22C'), DARK = hex('#4A8018'), CORE = hex('#2E5A0C');
const WHITE = hex('#F4FFDC'), HALO = hex('#D8F29A'), INK = hex('#0A1204'), LIP = hex('#CDEB78'), CHAN = hex('#3F7516');
const paint = (c, col, a) => (a > 0 ? mixc(c, col, Math.min(1, a)) : c);

// ---- fields ----
function panelField(x, y) {
  if (x < 0 || x > PANEL.w || y < 0 || y > PANEL.maxY - PANEL.y) return null;
  const dx = Math.min(x, PANEL.w - x);
  const dSlot = y > slotEndY ? Math.hypot(dx, y - slotEndY) : dx;
  const dEdge = Math.abs(PANEL.edgeY - y);
  if (dSlot < dEdge) return { g: dSlot, kind: 'slot' };
  return { g: dEdge, kind: 'edge', inside: y > PANEL.edgeY };
}
function hexField(hx, hy) {
  const X = hx / HEX.pxPerUnit, Z = hy / HEX.pxPerUnit;
  const r = Math.hypot(X, Z);
  if (r > 0.999) return null;
  const theta = Math.asin(r);
  const lon = Math.atan2(Z, X);
  const dp = lon - Math.round(lon / SEG) * SEG;
  const d = (thetaEdge(dp, apothem, bulge) - theta) * 458.4;
  return { g: Math.abs(d), d, inside: d > 0, kind: 'hex' };
}
const hexEdgePoint = (ang, back) => {
  const dp = ang - Math.round(ang / SEG) * SEG;
  const r = Math.sin(thetaEdge(dp, apothem, bulge)) * 458.4 - back;
  return [Math.cos(ang) * r, Math.sin(ang) * r];
};

// ---- per-cell art: a list of hand-placed shapes, seeded per panel ----
const lens = (t) => (t <= 0 || t >= 1 ? 0 : Math.pow(Math.sin(Math.PI * t), 0.75));

function ribbon(o) {
  // o: x0 (centre line start), amp, freq, ph, y0, y1, w0
  return {
    ...o,
    cx: (y) => o.x0 + o.amp * Math.sin(y * o.freq + o.ph) + (o.drift || 0) * (y - o.y0),
    w: (y) => o.w0 * lens((y - o.y0) / (o.y1 - o.y0)),
    t: (y) => (y - o.y0) / (o.y1 - o.y0),
  };
}

function strokes(cx, cy, dirx, diry, n, spacing, len, seed) {
  const r = rng(seed);
  const px = -diry, py = dirx; // across the bunch
  const list = [];
  for (let k = 0; k < n; k++) {
    const off = (k - n / 2) * spacing + (r() - 0.5) * 2;
    const L = len * (0.55 + 0.45 * Math.sin((Math.PI * (k + 0.5)) / n)) * (0.8 + r() * 0.4);
    const sx = cx + px * off, sy = cy + py * off;
    list.push({ x0: sx, y0: sy, x1: sx + dirx * L + px * (r() - 0.5) * 6, y1: sy + diry * L + py * (r() - 0.5) * 6, w: 1.5 + r() * 0.8 });
  }
  const xs = list.flatMap((s) => [s.x0, s.x1]), ys = list.flatMap((s) => [s.y0, s.y1]);
  return { list, box: [Math.min(...xs) - 4, Math.min(...ys) - 4, Math.max(...xs) + 4, Math.max(...ys) + 4] };
}
function strokeAlpha(bunches, x, y) {
  let a = 0;
  for (const b of bunches) {
    if (x < b.box[0] || x > b.box[2] || y < b.box[1] || y > b.box[3]) continue;
    for (const s of b.list) {
      const dx = s.x1 - s.x0, dy = s.y1 - s.y0;
      const l2 = dx * dx + dy * dy;
      const t = Math.min(1, Math.max(0, ((x - s.x0) * dx + (y - s.y0) * dy) / l2));
      const d = Math.hypot(x - (s.x0 + dx * t), y - (s.y0 + dy * t));
      a = Math.max(a, sstep(s.w * (1 - t) + 0.5, s.w * (1 - t) - 0.4, d) * (t < 0.98 ? 1 : 0));
    }
  }
  return a;
}
function inTri(p, a, b, c) {
  // soft point-in-triangle: signed distance-ish
  const e = (u, v) => ((p[0] - u[0]) * (v[1] - u[1]) - (p[1] - u[1]) * (v[0] - u[0])) / Math.hypot(v[0] - u[0], v[1] - u[1]);
  const s = Math.min(e(a, b), e(b, c), e(c, a));
  const o = Math.max(e(a, b), e(b, c), e(c, a));
  const d = Math.sign(o) === Math.sign(s) ? 0 : 0;
  void d;
  // all same sign -> inside; distance = min |edge| when inside
  const inside = (e(a, b) >= 0 && e(b, c) >= 0 && e(c, a) >= 0) || (e(a, b) <= 0 && e(b, c) <= 0 && e(c, a) <= 0);
  const m = Math.min(Math.abs(e(a, b)), Math.abs(e(b, c)), Math.abs(e(c, a)));
  return inside ? sstep(0, 1.2, m) : 0;
}

function buildPanel(idx) {
  const r = rng(101 + idx * 31);
  const side = r() < 0.5 ? -1 : 1; // which slot the dark shapes hug
  const gx = side < 0 ? 0 : PANEL.w;
  const shapes = [];
  const y0 = 18 + r() * 60;
  const len = 300 + r() * 140;
  shapes.push(ribbon({ x0: gx - side * (40 + r() * 20), amp: 12 + r() * 16, freq: 0.012 + r() * 0.008, ph: r() * 6, y0, y1: Math.min(y0 + len, 500), w0: 46 + r() * 26, drift: side * (r() - 0.3) * 0.06 }));
  if (r() < 0.7) {
    const yy = 200 + r() * 120;
    shapes.push(ribbon({ x0: gx + side * -(190 + r() * 40) * -1 * -1, amp: 10, freq: 0.02, ph: r() * 6, y0: yy, y1: yy + 120 + r() * 80, w0: 22 + r() * 12 }));
  }
  const gl = ribbon({ x0: 130 + r() * 200, amp: 22 + r() * 22, freq: 0.008 + r() * 0.006, ph: r() * 6, y0: 70 + r() * 110, y1: 330 + r() * 100, w0: 16 + r() * 10, drift: (r() - 0.5) * 0.2 });
  const glint2 = r() < 0.6 ? ribbon({ x0: gl.x0 + (r() < 0.5 ? -1 : 1) * (50 + r() * 40), amp: 8, freq: 0.02, ph: r() * 6, y0: gl.y1 - 30, y1: gl.y1 + 60, w0: 7 + r() * 4 }) : null;
  const grad = r() * Math.PI * 2;
  // flames on the hugged slot, pointing into the panel
  const flames = [];
  for (let k = 0; k < 3; k++) {
    const fy = shapes[0].y0 + 40 + r() * (shapes[0].y1 - shapes[0].y0 - 80);
    const len = 34 + r() * 30;
    flames.push([[gx - side * (GW - 2), fy - 8], [gx - side * (GW - 2), fy + 8 + r() * 6], [gx - side * (GW + len), fy + 4 + (r() - 0.3) * 18]]);
  }
  const hatch = [
    strokes(gx - side * (GW + 6), shapes[0].y0 + 80 + r() * 100, -side, 0.18, 10, 5.5, 46, idx * 7 + 1),
    strokes(gx - side * (GW + 6), shapes[0].y0 + 230 + r() * 80, -side, -0.15, 8, 5.5, 38, idx * 7 + 2),
    strokes(30 + r() * 380, PANEL.edgeY - GW - 6, 0.12, -1, 9, 5.5, 44, idx * 7 + 3), // near the hexagon rim
  ];
  return { side, gx, shapes, gl, glint2, grad, flames, hatch, seed: idx };
}
function buildHex(idx) {
  const r = rng(907 + idx * 53);
  const a0 = r() * 6.28;
  const hatch = [];
  for (let k = 0; k < 3; k++) {
    const ang = a0 + k * 2.1 + r() * 0.5;
    const [sx, sy] = hexEdgePoint(ang, GW + 6);
    hatch.push(strokes(sx, sy, -Math.cos(ang), -Math.sin(ang), 9, 5.5, 44, idx * 5 + k));
  }
  return {
    glint: { cx: -150 + r() * 30, cy: -140 + r() * 40, R: 150 + r() * 40, a0: 0.15, a1: 1.25 + r() * 0.3, w0: 20 + r() * 8 },
    wave: { amp: 28 + r() * 16, k: 0.022 + r() * 0.008, ph: r() * 6, yc: 20 + r() * 40, x0: -125, x1: 120, w0: 30 + r() * 12, tilt: (r() - 0.5) * 0.5 },
    hatch, grad: r() * 6.28, seed: 40 + idx,
  };
}

function colorPanel(a, x, y, f) {
  const wob = (vnoise(x * 0.03, y * 0.03, a.seed) - 0.5) * 9;
  const gt = ((x - 240) * Math.cos(a.grad) + (y - 264) * Math.sin(a.grad)) / 340 * 0.5 + 0.5;
  let c = mixc(LIME, MIDG, sstep(0.15, 0.95, gt));
  // reflection shapes: hard-edged dark with a darker core
  let inkEdge = 0;
  a.shapes.forEach((s, i) => {
    if (y < s.y0 || y > s.y1) return;
    const w = s.w(y), d = x - s.cx(y);
    const sd = Math.abs(d) - w + wob;
    c = paint(c, DARK, sstep(1, -1, sd));
    const sdc = Math.abs(d - Math.sign(d || 1) * 0 + a.side * w * 0.18) - w * 0.45 + wob * 0.6;
    c = paint(c, CORE, sstep(1, -1, sdc));
    if (i === 0) {
      // brush stroke of ink along the groove-facing edge, thick to thin
      const t = s.t(y);
      const th = 11 * Math.pow(1 - t, 1.1) + 1.5;
      const toward = (d * a.side < 0) ? 1 : 0; // groove-facing half
      inkEdge = Math.max(inkEdge, toward * sstep(1, -1, Math.abs(sd + th * 0.3) - th * 0.5));
    }
  });
  // main glint: pale halo, crisp white core
  for (const g of [a.gl, a.glint2]) {
    if (!g || y < g.y0 || y > g.y1) continue;
    const w = g.w(y), d = x - g.cx(y);
    const sd = Math.abs(d) - w * 2.2 + wob * 0.5;
    c = paint(c, HALO, sstep(1, -1, sd) * 0.95);
    c = paint(c, WHITE, sstep(1, -1, Math.abs(d) - w + wob * 0.3));
  }
  c = paint(c, INK, inkEdge);
  for (const t of a.flames) c = paint(c, INK, inTri([x, y], t[0], t[1], t[2]));
  c = paint(c, INK, strokeAlpha(a.hatch, x, y));
  return grooves(c, f);
}
function colorHex(a, hx, hy, f) {
  const wob = (vnoise(hx * 0.03 + 9, hy * 0.03, a.seed) - 0.5) * 9;
  const gt = (hx * Math.cos(a.grad) + hy * Math.sin(a.grad)) / 380 * 0.5 + 0.5;
  let c = mixc(LIME, MIDG, sstep(0.3, 1.0, gt));
  // dark squiggly reflection across the middle
  const w = a.wave;
  if (hx > w.x0 && hx < w.x1) {
    const t = (hx - w.x0) / (w.x1 - w.x0);
    const yc = w.yc + hx * w.tilt + w.amp * Math.sin(hx * w.k + w.ph);
    const sd = Math.abs(hy - yc) - w.w0 * lens(t) + wob;
    c = paint(c, DARK, sstep(1, -1, sd));
    c = paint(c, CORE, sstep(1, -1, Math.abs(hy - yc - 6) - w.w0 * lens(t) * 0.45 + wob * 0.6));
    const th = 9 * (1 - t) + 1.5;
    c = paint(c, INK, sstep(1, -1, Math.abs(sd + th * 0.3 - (hy < yc ? 0 : 1e3)) - th * 0.5) * (hy < yc ? 1 : 0));
  }
  // big curved white glint
  const g = a.glint;
  const ang = Math.atan2(hy - g.cy, hx - g.cx);
  const tt = (ang - g.a0) / (g.a1 - g.a0);
  if (tt > 0 && tt < 1) {
    const gw = g.w0 * lens(tt), dd = Math.abs(Math.hypot(hx - g.cx, hy - g.cy) - g.R);
    c = paint(c, HALO, sstep(1, -1, dd - gw * 2.2 + wob * 0.5) * 0.95);
    c = paint(c, WHITE, sstep(1, -1, dd - gw + wob * 0.3));
  }
  c = paint(c, INK, strokeAlpha(a.hatch, hx, hy));
  return grooves(c, f);
}
function grooves(c, f) {
  // light lip, darker channel, black outline on both sides
  c = paint(c, LIP, sstep(GW + 11, GW + 6, f.g) * sstep(GW - 2, GW + 1, f.g) * 0.85);
  c = paint(c, CHAN, sstep(GW, GW - 2, f.g));
  c = paint(c, mixc(CHAN, LIME, 0.5), sstep(GW * 0.45, 0, f.g) * 0.6);
  return paint(c, INK, sstep(3.4, 1.4, Math.abs(f.g - GW)));
}

function cellColorFn(idx, mode) {
  const isHex = idx >= 6;
  const art = mode === 'ink' ? (isHex ? buildHex(idx) : buildPanel(idx)) : null;
  return (lx, ly) => {
    const f = isHex ? hexField(lx - HEX.cx, ly - HEX.cy) : panelField(lx - PANEL.x, ly - PANEL.y);
    const unused = !f || (isHex && f.d < -2) || (!isHex && f.kind === 'edge' && f.inside);
    if (mode === 'template') {
      if (!f || (isHex && !f.inside && f.g > GW * 1.5)) return [150, 150, 146];
      let c = isHex ? [232, 236, 226] : [238, 238, 232];
      if (!isHex && f.kind === 'edge' && f.inside) c = [200, 205, 195];
      if (f.g < GW) c = [168, 214, 196];
      if (Math.abs(f.g - GW) < 1.6) c = [200, 40, 40];
      if (f.g < 0.9) c = [60, 90, 200];
      if (!isHex && Math.abs(lx - PANEL.x - PANEL.w / 2) < 0.6) c = [205, 205, 225];
      if (!isHex && Math.abs(ly - PANEL.y) < 0.9) c = [200, 140, 40];
      return c;
    }
    if (unused) return CORE;
    return isHex ? colorHex(art, lx - HEX.cx, ly - HEX.cy, f) : colorPanel(art, lx - PANEL.x, ly - PANEL.y, f);
  };
}

function render(mode) {
  const buf = Buffer.alloc(ATLAS.w * ATLAS.h * 4, 255);
  const ss = mode === 'ink' ? SS : 1;
  for (let c = 0; c < 8; c++) {
    const [ox, oy] = cellOrigin(c);
    const fn = cellColorFn(c, mode);
    for (let y = 0; y < CELL.h; y++)
      for (let x = 0; x < CELL.w; x++) {
        let r = 0, g = 0, b = 0;
        for (let sy = 0; sy < ss; sy++)
          for (let sx = 0; sx < ss; sx++) {
            const col = fn(x + (sx + 0.5) / ss, y + (sy + 0.5) / ss);
            r += col[0]; g += col[1]; b += col[2];
          }
        const o = ((oy + y) * ATLAS.w + ox + x) * 4, n = ss * ss;
        buf[o] = Math.round(r / n); buf[o + 1] = Math.round(g / n); buf[o + 2] = Math.round(b / n);
      }
  }
  return png(ATLAS.w, ATLAS.h, buf);
}

mkdirSync(new URL('../src/assets/', import.meta.url), { recursive: true });
writeFileSync(new URL('../src/assets/ink-template.png', import.meta.url), render('template'));
writeFileSync(new URL('../src/assets/ink.png', import.meta.url), render('ink'));
console.log('wrote src/assets/ink-template.png and src/assets/ink.png');
