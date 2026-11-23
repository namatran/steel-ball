# Portfolio embed plan (localhost first)

Decision: copyright on the anime-derived assets is not a blocker (owner's call).

## Research: how marvinschwaibold.com shows work

Inspected in the browser pane (DOM + network):
- No iframes, no canvases, no live demos on the home page. One JS bundle (Vite-style hashed `assets/index-*.js`).
- "Latest Work" is a grid of cards. Each card is a looping, muted, autoplaying `<video>` (mp4 on a CDN) with a still `poster`. Videos below the fold have an empty `src` and load only on scroll (lazy).
- Each card links out to the live project (twombly.app, shopify.design, ...).

Takeaway (superseded by the correction below): the carousel is video only, but the Lab section has real interactive iframe demos.

### Correction: the interactive demos (found after you pointed it out)

I first only looked at the "Latest Work" carousel, which is mp4/HLS video. The interactive ones live in the "Experiments & Lab" grid:
- 7 tiles carry a **"Demo"** tag. Tile thumbnails are lazy muted videos; clicking one opens a lightbox (`.lab-viewer`) and pushes a route (`/lab/expanding-music-player`) so it is deep-linkable.
- Inside the lightbox the demo is a plain **`<iframe class="lab-interactive-demo-frame" src="/lab/component-anatomy/index.html">`**: same-origin, static HTML page hosted next to the site, no `sandbox`, no `allow`, `title` set for a11y.
- A still `<img>` preview sits under the iframe and is hidden when the iframe sets `data-ready="true"` (no blank flash while it loads).
- Tile aspect ratio is stored per demo (e.g. 0.92 for the music player), so the lightbox fits the demo.
- Not a JS widget or web component: each demo is a self-contained static page in an iframe.

So the iframe plan is right, and his pattern gives us a concrete shape: tile (video or poster) -> lightbox with iframe -> still preview until ready.

## Approach

Match Marvin's Lab pattern: a "Demo"-tagged tile with a poster/short loop; click opens a lightbox containing the live iframe (`?embed` mode, already built), with the poster shown underneath until the app signals ready, plus an "Open full screen" popout. Inline-in-page iframe is the simpler alternative. Both avoid loading three.js + audio until the visitor asks.
Add a ready signal: the embed does `parent.postMessage({type:'steel-ball:ready'}, '*')` after first frame so the host can hide the poster (his `data-ready` trick, cross-origin safe).

Why not a JS widget/web component: needs the portfolio to share our build, CSS and three.js version; the iframe isolates all of that for free.

## Steps (all on localhost)

1. Embed polish in `embed.html` test host
   - Mimic a portfolio card: rounded card, caption, popout link, dark and light host backgrounds.
   - Click-to-activate overlay (poster + play button) so scrolling the host page isn't hijacked by the canvas; iframe `src` set on click, `loading="lazy"` otherwise.
   - Add `allow="autoplay"`, and test sound unlock inside the iframe (needs a user gesture in the frame).
2. Embed-mode behavior in the app
   - Confirm touch drag inside an iframe on mobile (`touch-action: none`) does not trap page scroll; consider requiring a first tap to "activate".
   - Pause rendering when the iframe is offscreen (IntersectionObserver / `visibilitychange`) to save battery.
   - Decide if sound is off by default in embed mode.
3. Preview asset
   - Record a 4-6 s loop (Golden Spin) as mp4 + poster jpg, small (<1 MB). Used as the card preview and the iframe placeholder.
4. Responsive check
   - Host page at 375 / 768 / 1280 widths; iframe aspect ratio and popout link placement.
5. Prod-readiness for the embed (only what the embed needs)
   - Page `<title>`, favicon, og:image (also helps the popout link when shared).
   - Headers: ensure no `X-Frame-Options: DENY`; when deployed, allow framing from the portfolio origin only (CSP `frame-ancestors`).
   - Bundle is 539 kB; try lazy-loading the GUI (lil-gui) in non-embed mode, or dynamic import.
6. Later, when approved: deploy (Vercel), then point the portfolio iframe at the live URL and replace `/` popout link with the deployed URL.

## Questions for you

1. What is your portfolio built with (Next/React, Astro, plain HTML, Framer, other)? That decides whether I build a drop-in snippet or a component.
2. Card style: live iframe from the start, or poster/video first with click to load (my recommendation)?
3. Sound: off by default in the embed, with the existing sound button to enable?
4. Should the popout open the full-screen app (`/`) in a new tab, or the same tab?
5. Do you want the portfolio test page on localhost to replicate your real site's look, or is the neutral dark `embed.html` fine?
