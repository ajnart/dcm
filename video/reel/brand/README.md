# Brand kit

Generates every Logo asset into `docs/assets/brand/` from `docs/assets/logo-dark.svg` and `docs/assets/logo-light.svg`.

```bash
cd video/reel
npm run brand
```

Needs Chromium through Playwright (PNG) and `cwebp` (`brew install webp`) for the WebP files. The output is deterministic: a second run is byte-identical. It throws if the source Logo geometry changes.

## Gallery

```bash
python3 -m http.server 8796 --bind 127.0.0.1
```

Open `http://127.0.0.1:8796/video/reel/brand/index.html` from the repository root. Every asset is shown on light, dark and mid-grey, with a GitHub README mock and file sizes.

## Files

| Folder             | Contents                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `mark/`            | The Logo mark: `color`, `dark`, `light`, `mono`, `mono-white`; SVG and square PNG at 512, 256 and 128, with padding so the pulse never clips |
| `wordmark/`        | `self-host` in JetBrains Mono Bold (SIL OFL 1.1) as SVG outlines, no web font; `dark` and `light`; SVG and PNG at 256 and 128 high                |
| `lockup/`          | The mark with the wordmark, `horizontal` and `stacked`; `dark` and `light`; SVG and PNG at 256 and 128 high                                   |
| `animated/`        | `build`, `light-up`, `pulse`; `dark` and `light`; CSS keyframes, seamless loops, `prefers-reduced-motion` shows the finished mark            |
| `dashboard-icons/` | The Dashboard Icons submission set: `svg/`, `png/`, `webp/`, `meta/`; cropped to the mark, as their guidelines ask                           |
| `manifest.json`    | Every file with its size, read by the gallery                                                                                                |

`dark` means artwork for dark backgrounds and `light` means artwork for light backgrounds. Dashboard Icons names them the other way round: their `-light` is for dark backgrounds. The set in `dashboard-icons/` follows their convention, and `self-host.svg` is the `color` mark.

The wordmark letters come from `jetbrains-mono-latin-wght-normal.woff2` in `@fontsource-variable/jetbrains-mono`, read by `readme/glyphs.mjs`, so the SVGs hold paths only. `site/public/logo.svg` is byte-identical to `docs/assets/logo-dark.svg`, the generator's source, and the site icons are the same artwork on an opaque background, so they stay as they are.
