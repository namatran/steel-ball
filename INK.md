# Repainting the ball's ink

`src/assets/ink.png` (2048×1280) is the whole painted look: base greens, light and dark
cel shapes, highlights and black ink. The shader only adds a fixed-light shadow on top,
so paint everything opaque; only the shadow changes as the ball turns.

1. Open `src/assets/ink-template.png` in Krita/Procreate as the bottom reference layer.
2. Paint on a new transparent layer above it. Red lines = groove edges (put the ink
   outline on them), blue = groove centre, teal = groove channel, grey = unused.
3. Hide the template, export the paint layer as `src/assets/ink.png` (RGBA, same size).
   Export it opaque, full colour.

Cells (512×640 each, 4 per row, atlas 2048×2560): cells 0–5 are the six panels' north
halves, cells 6 and 7 the north and south hexagons, cells 8–13 the same six panels' south
halves (cell 8 + panel). Nothing is mirrored: every half is painted on its own. Panel cells: slots run down the left and right edges, the hexagon groove is
the horizontal line near the bottom, the equator is the top edge.

`npm run ink` regenerates both PNGs (starter art) and overwrites your paint.
