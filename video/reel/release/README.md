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

## Put the image in a release

Upload the PNG as a release asset and reference its URL in the body. The URL is fixed by tag and file name, so the body can be written before the upload, and it renders the same for signed-in collaborators now and for everyone once the repo is public, without editing old releases.

```bash
APPS=$(scripts/release-new-apps.sh "$PREV" "$REF" | paste -sd, -)
npm run release-visual -- --apps "$APPS" --version "$VERSION" --out /tmp/rv
cp "/tmp/rv/new-apps-$VERSION.png" /tmp/new-apps.png

gh release create "v$VERSION" --draft --title "v$VERSION" --notes-file notes.md
gh release upload "v$VERSION" /tmp/new-apps.png
# review the draft, then publish
gh release edit "v$VERSION" --draft=false
```

with this at the top of `notes.md`, using the alt text the command prints:

```markdown
![self-host X.Y.Z adds <App names>](https://github.com/ajnart/self-host/releases/download/vX.Y.Z/new-apps-X.Y.Z.png)
```

For a release that already exists, `gh release upload "v$VERSION" /tmp/new-apps.png` alone adds the asset. The animated SVG is for the site and README, which serve it as `image/svg+xml`; release assets download instead of render, so ship the PNG in release bodies.

Verified against a private repo: a draft release with the uploaded asset renders the image from this URL for an authenticated viewer.
