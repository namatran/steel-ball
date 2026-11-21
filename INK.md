# Repainting the ball's ink

`src/assets/ink.png` (2048×1280) is the whole painted look: base greens, light and dark
cel shapes, highlights and black ink. The shader only adds a fixed-light shadow on top,
so paint everything opaque; only the shadow changes as the ball turns.

1. Open `src/assets/ink-template.png` in Krita/Procreate as the bottom reference layer.
2. Paint on a new transparent layer above it. Red lines = groove edges (put the ink
   outline on them), blue = groove centre, teal = groove channel, grey = unused.
3. Hide the template, export the paint layer as `src/assets/ink.png` (RGBA, same size).
   Export it opaque, full colour.

Cells (512×640 each, 4 per row): top row and the first two of the second row are
panels 0–5 (each painted separately; the north and south halves of a panel share
the paint, mirrored at the equator). The last two cells are the north and south
hexagons. Panel cells: slots run down the left and right edges, the hexagon groove is
the horizontal line near the bottom, the equator is the top edge.

`npm run ink` regenerates both PNGs (starter art) and overwrites your paint.
