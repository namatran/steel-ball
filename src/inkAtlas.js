// Layout of the ink atlas (src/assets/ink.png), shared by the shader and
// by scripts/make-ink.mjs so both agree on where everything sits.
//
// Every panel gets its own cell (the panels are NOT painted alike), and each
// pole gets one for its hexagon. Cells are 512x640, four per row:
//   cells 0-5  the six panels, north half (panel k of the ball -> cell k mod 6)
//   cell 6     hexagon at +Y (north), cell 7 hexagon at -Y (south)
//   cells 8-13 the same six panels, south half (cell 8 + k mod 6): north and south are painted
//              separately, nothing is mirrored
// Inside a panel cell:
//   x: across the panel, dp in -30deg..30deg (the slots are the left/right edges)
//   y: from the equator (top) down to the hexagon edge, straightened so the
//      hexagon groove is always the horizontal line at PANEL.edgeY. Each half has its own cell.
// Inside a hexagon cell: flat projection around the pole, 8 px per degree.
export const ATLAS = { w: 2048, h: 2560 };
export const CELL = { w: 512, h: 640 };
export const PANEL = { x: 16, y: 16, w: 480, edgeY: 528, maxY: 580 }; // 8 px/deg
export const HEX = { cx: 256, cy: 256, r: 240, pxPerUnit: 458.4 }; // 8 px/deg at the center
export const cellOrigin = (i) => [(i % 4) * CELL.w, Math.floor(i / 4) * CELL.h];
export const DEG = Math.PI / 180;
export const GROOVE = 0.05; // groove half-width, radians
export const SEG = 60 * DEG;
// Shape the template and starter ink are drawn for.
export const DEFAULT_SHAPE = { apothem: 24 * DEG, bulge: 78 * DEG, slotGap: 9 * DEG };

// Colatitude of the hexagon's edge at longitude offset dp from a side's middle.
export function thetaEdge(dp, apothem, bulge) {
  const cc = apothem - bulge;
  const a = Math.sin(cc) * Math.cos(dp);
  const b = Math.cos(cc);
  return Math.atan2(a, b) + Math.acos(Math.min(1, Math.max(-1, Math.cos(bulge) / Math.hypot(a, b))));
}
