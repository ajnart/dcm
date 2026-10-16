# New Apps release visual

From `video/reel`, after `npm ci` and installing Playwright Chromium:

```bash
npm run release-visual -- --apps cleanuparr,immich --version 0.5.11 --out out/release
```

Writes `new-apps-0.5.11.png` (2× resolution) and `new-apps-0.5.11.svg` (animated, reduced-motion aware), and prints alt text. One hub connects the self-host Logo to 1–6 Apps. Names and categories come from the site Catalog; icons and outlined fonts are local, with no network requests during rendering. Identical inputs and installed dependencies produce deterministic SVGs; PNGs also depend on the installed Chromium and platform.

Empty, unknown, duplicate and more than six App ids fail before launching Chromium. Missing local icons fail explicitly. `--preview` renders all six sample counts under `release/out/preview`; `index.html` provides an optional local preview.

From the repository root, discover newly added App ids:

```bash
scripts/release-new-apps.sh v0.5.8 v0.5.9
```

This prints `cleanuparr`. The second ref defaults to `HEAD`; both refs must use the Go layout. The helper lists App definitions, including Apps currently hidden from the Catalog. Skip the visual when the result is empty; split releases with more than six additions into separate images. No release is created or uploaded by these commands.
