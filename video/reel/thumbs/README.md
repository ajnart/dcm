# Reel thumbnails

Poster and social-card candidates for the showreel, made from the reel's own frames, fonts, colours and logo. 18 variants, each in two sizes:

- `1280x720`: video poster / YouTube.
- `1200x630`: OG / social card.

**Shipped:** `v13-herolockup` is both the reel's poster (`site/public/reel.jpg`, the `poster=` of the hero reel and the `VideoObject` thumbnail in `site/src/pages/index.astro`) and its share card (`site/src/assets/og.png`, used for `og:image` and `twitter:image` in `site/src/layouts/Base.astro`).

`v18-saasswaps` is the poster of the SaaS cut (`--cut saas`), which is not shipped on the site; it is not committed as a deliverable.

The variant sources are in `build.mjs`. The rendered `v*.html`, `v*.png` and `variants.json` are generated and git-ignored; run `npm run thumbs` to get them.

## Look at them

```bash
cd video/reel && npm run thumbs
cd thumbs && python3 -m http.server 8765
# http://localhost:8765/index.html?v=13   (← / → switch variants)
```

The page shows both sizes plus a 320x180 and a 200x105 preview, which is how small they appear in a feed. Check a new variant at that size before choosing it.

## Regenerate

```bash
cd video/reel
bun install        # fonts + Playwright (needs a Chromium: npx playwright install chromium)
npm run thumbs     # node thumbs/build.mjs
```

`build.mjs` is the only source of truth. It holds every variant as a `{ id, name, css, html }` entry in the `V` array and, on each run:

1. writes `v<N>-<id>.html` (open one directly to tweak it in a browser),
2. renders both sizes to `v<N>-<id>-<size>.png` with Playwright, `deviceScaleFactor` 1,
3. writes `variants.json`, which `index.html` reads.

Sizes are in `vmin` through `--u`, so a layout holds at 1280x720 and 1200x630. The exception is the logo, which is sized in whole pixels (see below).

## Add a variant

Append an entry to `V` in `build.mjs` (new variants go at the end so existing `?v=N` numbers stay put), then `npm run thumbs`. Helpers:

- `logo`: the logo `<img>`. Size it in px (below).
- `ic("jellyfin")`: an App or service icon from `../assets/icons/`.
- `frame("f-18.6.png")`: a reel frame as a background.

Colours are the reel's: bg `#09080f`, accent `#7a57d3` / `#a88df2`, ok `#00d787`, fail `#ff5f5f`, mono `JetBrains Mono`, words `Inter Tight`.

## Logo size

`site/public/logo.svg` is a grid of 12 px rects (viewBox 228x216). At sizes where a rect edge falls between pixels it shows seams. Use heights that are a multiple of 54 px (quarter scale, 3 px rects): 54, 108, 162, 216, 324, 432.

## Frames

`frames/f-<seconds>.png` are stills from `video/reel/out/selfhost-reel.mp4`. Variants 1 to 7, 11 and 17 use them. If the reel changes, re-extract:

```bash
cd video/reel/thumbs
for t in 0 1.0 1.5 1.8 2.4 4.2 5.6 15.2 18.6 20.5 25.5 33.5; do
  ffmpeg -y -ss $t -i ../out/selfhost-reel.mp4 -frames:v 1 frames/f-$t.png
done
```

## Ship one

Poster (JPEG at the same path, no code change):

```bash
ffmpeg -y -i video/reel/thumbs/v13-herolockup-1280x720.png -q:v 3 site/public/reel.jpg
```

Share card (`og:image`, `twitter:image`): `site/src/assets/og.png` is a 1200x630 PNG. Copy the `-1200x630.png` of the chosen variant over it, and keep `imageAlt` in `Base.astro` describing it.

## Variants

| #   | id          | Idea                                                                      |
| --- | ----------- | ------------------------------------------------------------------------- |
| 1   | firstframe  | the reel's first frame, "Stop renting"                                    |
| 2   | stoprenting | "Stop renting your software." with the subscription tiles                 |
| 3   | wall        | "Their servers. $92"                                                      |
| 4   | yours       | "Your servers. $0"                                                        |
| 5   | dashboard   | "Builds your dashboard."                                                  |
| 6   | endcard     | logo, wordmark and the curl command                                       |
| 7   | hook        | "Your Apps. Your home. One binary." over a blurred dashboard              |
| 8   | rentvsfree  | red struck-through $92 against green $0, logo badge                       |
| 9   | curl        | "Install any App. One command." with the curl line                        |
| 10  | purplelogo  | giant logo on purple                                                      |
| 11  | links       | "Apps that wire themselves." over the Links cards                         |
| 12  | splitbrand  | v8 split with a brand bar, icons and a curl footer                        |
| 13  | herolockup  | **shipped.** "Stop renting your software.", $92 to $0, curl box, big logo |
| 14  | bands       | rented icons and $92 / install band / owned icons and $0                  |
| 15  | purplecard  | purple card, logo tile, "Install any App. One command.", $92 to $0        |
| 16  | terminal    | terminal running `self-host install media homarr` and a big $0            |
| 17  | dashprice   | blurred dashboard, $92 to $0, hook line, curl                             |
| 18  | saasswaps   | the SaaS cut's poster. "Replace the SaaS you pay for.", five swaps, curl |

The $92 is the reel's illustrative subscription total (see `../STORYBOARD.md`), not a measured price.
