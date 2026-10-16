# README images

The image pipeline behind the README header and hero (issue #568). One command renders every README image into `docs/assets/readme/`, which is committed. Rendering twice gives byte-identical files.

```bash
cd video/reel
bun install        # fonts + Playwright (needs a Chromium: npx playwright install chromium)
npm run readme     # node readme/build.mjs
```

It exits 1 if a file is over its budget: hero PNG 600 KB, hero SVG 400 KB, status-lights loops 1.5 MB.

## What README.md uses

| README section           | file                                  | alt text                                    |
| ------------------------ | ------------------------------------- | ------------------------------------------- |
| What it replaces (#563)  | `docs/assets/readme/replaces-meet.svg` | every pair, generated (`variants.json`)     |
| above Install            | `docs/assets/readme/hero-command.svg`  | the command and the nine Apps it is wired to |
| Links: Apps that wire themselves (#565) | `docs/assets/readme/links-graph.svg` | the Links drawn                |

The top image stays the committed `docs/assets/social-card.png`. `hero-lockup`, `hero-swaps` and `status-lights` (and their PNGs) are kept in `docs/assets/readme/` for later and are not referenced. The README embeds each as `<p align="center"><img src="…svg" width="880" alt="…"></p>`; the PNG of each is a static fallback, not referenced. If an alt text changes in `build.mjs`, update README.md by hand.

## Look at them

```bash
python3 -m http.server 8790 --bind 127.0.0.1   # from the repository root
# http://localhost:8790/video/reel/readme/index.html?v=1   (← / → switch variants)
```

The gallery shows each variant inside a mock of the README header, with toggles for GitHub light and dark, the tagline `<h1>` (the heroes repeat it), a narrow width, and SVG or PNG for the format. Query: `?v=N&t=light|dark&h1=0|1&w=920|640|390&f=svg|png`. It also lists every file against its budget.

## What it makes

| #   | file                    | Idea                                                                              |
| --- | ----------------------- | --------------------------------------------------------------------------------- |
| 1   | `hero-lockup.svg/png`  | headline, $92 to $0, curl, the big Logo: the curl line types in, the four status lights come on, $92 counts down to $0 |
| 2   | `hero-swaps.svg/png`   | eight rented SaaS against the App that replaces each; the swaps flip in one by one, $92 to $0 |
| 3   | `hero-command.svg/png` | a wide 880x240 section divider: the curl command wired to nine Apps, data pulses travel the wires|
| 4   | `status-lights.svg`     | the Overview's six status lights going waiting, starting, running; a 6 s loop     |
| ·   | `section-dashboard.png` | the Dashboard Overview on its own, for a README section                           |

The three heroes are animated SVGs with a static PNG. The README keeps its current top image, so none of them is the header; swaps and command are section images. The gallery swaps a hero into the social-card slot of a mock header to compare.

The $92 is the reel's illustrative subscription total (see `../STORYBOARD.md`), not a measured price.

## Hero scenes

`hero.mjs` holds the three heroes, each a function `({ animate }) => svg`. `animate: false` is the fully lit base state: the PNG is a screenshot of it. `animate: true` adds per-element CSS keyframes on a loop (lockup 6 s, swaps 6.6 s, command 3.2 s). Swaps uses no opacity ramps: frame 0 is the composed start state, rows slide in and the loop ends by sliding them out, so the seam is exact. Command is already fully wired at frame 0; the loop is only data pulses travelling the nine wires (dash offset, hidden at the seam), and its box is sized from the measured glyph width of the command (JetBrains Mono 800, the Logo's wordmark face). Each scene has its own size in `SIZES` (command is 880x240). `prefers-reduced-motion` shows the base state. Headline and text are glyph outlines (Inter Tight 800, JetBrains Mono 600-800; `glyphs.mjs` interpolates the variable fonts' gvar and HVAR for the weight). Icons and the Logo are inlined once and `<use`d.

## Static images

880 css px wide at `deviceScaleFactor` 2, so 1760x880 files shown at `width="880"`. The static PNGs are transparent with a rounded dark card and a 1px inset border, so the same file reads on GitHub light and dark. Colours, fonts and the Logo come from the thumbs system (`../thumbs/`).

## Loop: animated SVG

`scene.mjs` is the single source: one SVG of the Dashboard Overview with CSS keyframes (6 s loop, honours `prefers-reduced-motion`; the base state is fully lit, which is also the static render). `build.mjs` writes that SVG as is. There are no GIFs: animated SVG only, with a static PNG where one is wanted.

Text in the SVG is glyph outlines, not `<text>`. GitHub renders `<img>` SVGs in a sandbox that loads no fonts, so `glyphs.mjs` reads the bundled JetBrains Mono WOFF2 and emits paths (no dependency; the font's → ✓ ● ◆ are drawn as shapes). The SVG therefore looks the same everywhere.

| format | size   | corners                  | notes                                                                     |
| ------ | ------ | ------------------------ | ------------------------------------------------------------------------- |
| SVG    | ~67 KB | rounded, transparent     | vector, sharp at any DPI, `prefers-reduced-motion` stops it, smooth 60fps |

Recommendation: the SVG. Same size, crisp at retina, transparent rounded corners, and it respects reduced motion. Not yet confirmed on github.com itself; see the PR.

## What it replaces (#563)

`section-replaces.mjs` renders the "What it replaces" image as an animated SVG plus a static PNG (`replaces-meet.svg/.png`): one pair at a time, the paid service loses its colour, the arrow turns purple and the App gains colour (CSS `filter: grayscale()` keyframes, one layer per tile, overlapping steps), then all pairs wind back together in 0.4 s. The eight pairs are the showreel's SaaS cut (`../hook.js` `TILES`); the build throws if an App is not in `site/src/data/catalog.json`, and the "+ N more" count and the category labels are read from it. Text is glyph paths, the base state is the finished replacement (the PNG is that state, rendered with reduced motion), the loop is 10 s with matching first and last frames, and `prefers-reduced-motion` stops it. Budgets: SVG 400 KB, PNG 400 KB. The gallery lists it under "#563 What it replaces" with the alt text; the alt text names every pair. No prices appear in the image.

## Add a variant

Append an entry to `V` in `build.mjs` (at the end, so `?v=N` numbers stay put): `{ id, name, desc, alt, css, html }` for a static PNG, or `{ id, name, desc, alt, scene }` with a scene function in `hero.mjs` for an animated SVG and PNG (add its size to `SIZES` if not 880x440). The card is 880x440; `ic("jellyfin")` gives an App icon, `logo` the Logo (size it as a multiple of 54 px, see `../thumbs/README.md`), `win(width, { crop })` a piece of the Dashboard. Then `npm run readme`.

Generated and git-ignored: `v*.html`, `variants.json`. Committed: everything in `docs/assets/readme/`.

## Section: Apps that wire themselves (#565)

`section-links.mjs` draws the Links between Apps as an animated SVG (`links-graph.svg`) with a static PNG fallback (`links-graph.png`). Apps pop in within the first 3 s and the Links draw straight away; the fully drawn graph holds for about 3 s of the 8 s loop, then the build rewinds in 0.8 s (arrows retract in reverse order, chips pop out) onto the first frame, so the loop has no jump. Every Link drawn is asserted against `site/src/data/catalog.json` when the module loads, so a Link that leaves the Catalog fails the build; the Homarr tile count is read from the same file. Budget: 400 KB per file. The base state is fully drawn, which is what `prefers-reduced-motion` and the PNG show. The gallery's bottom block shows it; `?s=1` shows the PNG.

## Section: 30 seconds setup (#564)

`section-setup.mjs` (variants and `buildSetup`) and `setup-engine.mjs` (glyph-path terminal, scenes, timeline) write the looping animated SVG with a static PNG fallback to `docs/assets/readme/setup-terminal.{svg,png}`. It plays a ~22.6 s story: the install one-liner, Onboarding one question at a time, the Review plan and its `enter approve`, then the Dashboard with the Apps running. Screens come from `internal/tui/testdata/` and `install.sh`, trimmed to 22 rows. Nothing fades: elements appear by motion and the loop restarts with a hard cut to the first frame.

| id               | idea                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------- |
| `setup-terminal` | faithful 104-column terminal, an Install / Onboarding / Approve / Running strip above |

Budget: SVG 400 KB, PNG 600 KB. The base state (no animation, `prefers-reduced-motion`) is the finished Dashboard, which is what the PNG shows. README.md shows `setup-terminal.svg` under "30 seconds setup". The gallery lists it under the header variants; `section-setup.json` is generated and git-ignored.
