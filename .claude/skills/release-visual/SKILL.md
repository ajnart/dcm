---
name: release-visual
description: Generate the self-host release announcement visual when preparing a release or announcing newly added Apps. Discover added Apps between refs and render the approved Logo hub with pulses, rather than inventing a new layout.
---

# Release visual

Read `docs/releasing.md` for publication and `video/reel/release/README.md`
for renderer requirements. This skill prepares assets; publishing a release
still requires the user's approval.

## Discover

Confirm the release version, target ref and previous published stable CLI tag
with `gh release list` and `git log`. Use the highest stable CLI release with
binary archives, not the legacy skill-pack tags or the `new-cli-` twin.
Fetch the refs before comparing them.

From the repository root, run:

```bash
bash scripts/release-new-apps.sh <previous-tag> <target-ref>
```

Use exactly the returned App ids. An empty result means no new-Apps visual:
report that and continue with ordinary release notes. Do not substitute sample
Apps or announce existing Apps as new.

## Render

Work from the target ref so the Catalog and release agree. Read the renderer's
README for its existing dependencies; reuse the installed toolchain.
For one to six new Apps, run from `video/reel`:

```bash
npm run release-visual -- --apps <comma-separated-ids> --version X.Y.Z --out <absolute-output-directory>
```

For more than six, split the ids into groups of at most six in separate output
directories and rename each pair with a group suffix before uploading. Keep
all Apps represented once. Keep renders outside tracked source files.

Check that the PNG and animated SVG exist, show the correct version and every
selected App, and have readable labels. Preview the SVG through a local server
when visual verification is authorized; check its reduced-motion fallback.
Stop on a missing icon or unknown App rather than replacing it silently.
The approved design is the Logo hub, with pulses to the new Apps.

## Embed

After release approval, upload both files to the draft release. Use the PNG in
the release description because GitHub may sanitize animated SVGs. Link the
SVG separately for animation. Preserve the rest of the release notes.

Use the asset's returned download address, with descriptive alt text listing
the new Apps. Private repository assets require an authorized viewer; do not
claim anonymous availability. Download the uploaded files and compare them
with the originals before publishing, following `docs/releasing.md`.

Finish with the App ids, generated file paths, release link if published, and
any presentation check that could not be completed.
