# Terminal intro animation for Onboarding's welcome (#360)

Research date 2026-10-13. Read-only. Sources are module source in the Go module cache, official docs and specs, and project repos.
Versions in `go.mod`: bubbletea v2.1.0, lipgloss v2.0.6, bubbles v2.2.1, colorprofile v0.4.3, x/ansi v0.11.9, ultraviolet `v0.0.0-20261008173134-6b8d4baf91b4`.
Cite format: `MC` = `$(go env GOMODCACHE)`, then `tea` = `MC/charm.land/bubbletea/v2@v2.1.0`, `uv` = `MC/github.com/charmbracelet/ultraviolet@v0.0.0-20261008173134-6b8d4baf91b4`, `cp` = `MC/github.com/charmbracelet/colorprofile@v0.4.3`, `ansi` = `MC/github.com/charmbracelet/x/ansi@v0.11.9`, `lg` = `MC/charm.land/lipgloss/v2@v2.0.6`, `bb` = `MC/charm.land/bubbles/v2@v2.2.1`. Repo paths are relative to the repo root.
"Measured" means a throwaway `go test -overlay` harness (kept outside the repo, not committed). It fed `preboot.Render` frames through `uv.TerminalRenderer`, the same diff renderer Bubble Tea uses, in fullscreen mode. No real terminal, SSH link or Docker was used.

---

## 1. Rendering pipeline facts (Bubble Tea v2 / ultraviolet / colorprofile / lipgloss v2)

### Frame loop and FPS cap

- Default flush rate is **60 fps, max 120**: `defaultFPS = 60`, `maxFPS = 120` (`tea/renderer.go:10-15`). The value is clamped in `tea/tea.go:648-652` and set with `tea.WithFPS(n)` (`tea/options.go:146-153`). self-host uses defaults: `tea.NewProgram(m, tea.WithContext(ctx))` (`internal/tui/run.go:13`).
- The renderer is pull-based. Every message ends with `p.render(model)`, which calls `View()` and stores the result (`tea/tea.go:907`, `913-917`, `cursed_renderer.go:642-648`). A `time.Ticker` at `1/fps` then calls `flush` (`tea/tea.go:1437-1464`). So `View()` runs once per message, but at most one frame per tick reaches the terminal. Intermediate views are dropped.
- The app's own 24 fps clock (a one-shot timer per frame, `internal/tui/model.go:213-225`) is independent of the 60 Hz flush ticker. Each 41.7 ms frame is shown up to 16.7 ms late. **Inference:** this causes small cadence jitter. `WithFPS(120)` halves it (8.3 ms). An unchanged view costs one string compare per tick (`cursed_renderer.go:326`).
- **Frames drift late; they never drop:** the next timer starts only after `Update` handles `frameMsg` (`model.go:239-262`), so under load the scene slows instead of skipping frames. That keeps it deterministic (§6).

### Diff and flush

- `flush` returns early when the whole `View` is unchanged (`viewEquals`, `cursed_renderer.go:326-329`, `886-930`). Otherwise it clears the cell buffer and re-parses the full `View.Content` string into cells: `cellbuf.Clear()` plus `uv.NewStyledString(...).Draw` (`cursed_renderer.go:307`, `350-351`). It then diffs that buffer against the previous screen: `s.scr.Render(...)` (`:525`).
- The diff is per line: `transformLine` "diffs row y against the model and writes only what changed", using ICH/DCH for shifts (`uv/terminal_renderer.go:950-1010`). Runs of identical cells use `ECH`/`REP` when that is cheaper (`:643-700`). Whitespace and repeated background are therefore cheap.
- **Cell equality is checked before downsampling; pen changes after:** `cellEqual` → `Style.Equal` → `colorEqual` compares raw RGBA (`uv/cell.go:179-185`, `416-426`; `terminal_renderer.go:489-503`). `updatePen` converts both styles to the profile before diffing SGR (`terminal_renderer.go:596-621`). On an ANSI256 terminal, a 1-unit RGB change still rewrites the cell (cursor move plus glyph) but costs no new SGR. **Quantising colours in the scene removes those rewrites** (measured in §3).
- SGR diffs emit only changed fg/bg/attrs. `\x1b[m` is used when the new pen is plain (`uv/cell.go:264-300`).
- One `io.Copy` per frame writes the whole update (`cursed_renderer.go:627-633`).

### Synchronized output (mode 2026)

- Spec: wrap a frame in `CSI ? 2026 h` … `CSI ? 2026 l`. Detect support with `DECRQM CSI ? 2026 $ p`. A reply of `2` (reset) means supported. ([contour vt-extensions/synchronized-output.md](https://github.com/contour-terminal/vt-extensions/blob/master/synchronized-output.md)). Support listed there: Alacritty, Contour, foot, Ghostty, iTerm2, kitty, mintty, Warp, WezTerm, Windows Terminal (wt#18826), xterm.js, Zellij. **VTE/GNOME Terminal: "not yet" (vte#15).** Konsole: unknown.
- Bubble Tea sends the query only when `shouldQuerySynchronizedOutput` is true (`tea/tea.go:990-1012`, sent at `:1136-1143`). That covers: no `TERM_PROGRAM` and no `SSH_TTY`; or `WT_SESSION`; or `TERM_PROGRAM` without "Apple" and no `SSH_TTY`; or `TERM` containing ghostty/wezterm/alacritty/kitty/rio. **So Apple Terminal and most SSH sessions never get 2026.** Sync turns on only for a `ModeReset` reply (`tea/tea.go:810-817`), and each flush is then wrapped (`cursed_renderer.go:591-618`). Without it, frames can tear when a frame spans several reads; the cure is fewer bytes per frame.
- Mode 2027 (Unicode core / grapheme width) is queried in the same probe (`tea/tea.go:818-821`, `cursed_renderer.go:755-760`).

### Colour profile detection and downsampling

- Bubble Tea calls `colorprofile.Detect(output, environ)` once, unless `WithColorProfile` is set (`tea/tea.go:1109-1116`, `options.go:155-163`). A terminfo `RGB`/`Tc` capability reply upgrades it to TrueColor later (`tea/tea.go:800-808`).
- Detection rules (`cp/env.go:18-54`, `74-112`, `142-200`):
  - `TERM=dumb`, or not a TTY → `NoTTY`.
  - `TERM` containing alacritty/contour/foot/ghostty/kitty/rio/st/wezterm → TrueColor.
  - `WT_SESSION` → TrueColor.
  - `COLORTERM=truecolor|24bit|yes|true` → TrueColor, except under tmux/screen.
  - `*256color` → ANSI256; tmux/screen → ≥ ANSI256; `xterm*` → ANSI.
  - Detection returns the max of env, terminfo and `tmux info`.
- **NO_COLOR in colorprofile:** `strconv.ParseBool(NO_COLOR)` (`cp/env.go:115-118`), so only `1/t/true/...` count, and the profile drops to `ASCII` (`:84-89`). The no-color.org spec says "present and not an empty string (regardless of its value)" ([no-color.org](https://no-color.org/)). self-host follows the spec itself: `NoColor: Getenv("NO_COLOR") != ""` (`internal/cli/cli.go:238`). With `NO_COLOR=yes`, Pre-boot drops colour (its own path) while lipgloss-styled views keep theirs.
- Downsampling happens in the renderer via `uv.ConvertStyle(style, profile)` (`uv/cell.go:434-457`):
  - TrueColor: passthrough.
  - ANSI256/ANSI: `Profile.Convert` (`cp/profile.go:58-110`). That is `ansi.Convert256` (tmux-derived 6×6×6 cube versus grey ramp, choosing the nearer in HSLuv; `ansi/color.go:185-240`) or `Convert16` (`:252`).
  - `ASCII`: fg/bg/underline colour set to nil, **bold/faint kept**.
  - `NoTTY`: `Style{}`, every attribute dropped.
- `Convert` keeps an unbounded process-wide cache keyed by `color.Color` (`cp/profile.go:50-55`, `80-89`). Continuously lerped RGBA values grow it for ANSI/ANSI256 users. This is minor, and quantising also bounds it.
- lipgloss v2 `Style.Render` always emits full-fidelity SGR. Downsampling moved to the output layer ("Bubble Tea v2 handles downsampling internally", `lg/UPGRADE_GUIDE_V2.md:245-276`). The scene should therefore emit truecolor and trust the renderer. It must not branch on profile, except for deliberate palette choices.
- Terminal.app: before macOS 26 it is effectively 256-colour (`TERM=xterm-256color`). macOS 26 adds 24-bit ([MacRumors WWDC25](https://www.macrumors.com/2025/06/16/apples-terminal-app-macos-tahoe/), [termstandard/colors#69](https://github.com/termstandard/colors/issues/69)), but `colorprofile` only sees it if `COLORTERM` is set. Terminal.app does not answer DECRPM ([terminfo.dev](https://terminfo.dev/terminals/terminal-app)).

### Background (light/dark)

- In-TUI: `tea.RequestBackgroundColor` (OSC 11 query, `tea/color.go:12-16`, executed at `tea/tea.go:846-847`) leads to `tea.BackgroundColorMsg`. Its `IsDark()` is HSL lightness < 0.5, and a nil colour counts as dark (`uv/decoder.go:1785-1793`).
- Standalone: `lipgloss.HasDarkBackground(in, out)` returns **true on error** (`lg/query.go:86-92`). `lipgloss.LightDark(isDark)` picks a colour (`lg/color.go:205`).
- self-host requests it in `Init` (`internal/tui/model.go:205`), starts dark (`newTheme(true)`, `:189`), and on reply keeps only `IsDark()` (`:420-421`). On a light terminal, any frame before the reply is drawn in the dark palette. Terminals that never answer stay dark.
- `tea.View.BackgroundColor`/`ForegroundColor` can _set_ the terminal's default colours (OSC 10/11) and are reset on exit (`tea/tea.go:133-139`, `cursed_renderer.go:242-246`, `461-475`). This is powerful but invasive (it overrides the person's theme). Not recommended for #360.

### Width

- Half/full blocks `▀▄█▌`, box drawing `─━│`, `◆`, `▲`, `◢` and `·` are East Asian Width **Ambiguous**. Quadrants `▖…▟`, `▐░`, braille, sextants, octants, `✦` and `✶` are **Neutral** ([EastAsianWidth-18.0.0.txt](https://www.unicode.org/Public/UCD/latest/ucd/EastAsianWidth.txt)). Ambiguous glyphs can render two cells wide in CJK-configured terminals. This is a tail risk for 80-column layouts that rely on `█`/`◆`.

---

## 2. Sub-cell resolution techniques

| Technique              | Code points (Unicode version) | Pixels/cell | Colours/cell                                   | Notes                                                              |
| ---------------------- | ----------------------------- | ----------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| Half block `▀ ▄ █`     | U+2580/2584/2588 (1.1)        | 1×2         | **2 independent** (fg = one pixel, bg = other) | True colour pixels. 80×24 gives 80×48 px.                          |
| Quadrants `▖▗▘▙▚▛▜▝▞▟` | U+2596-259F (3.2)             | 2×2         | 2 for 4 px                                     | Shape plus 2-colour quantisation per cell.                         |
| Sextants `🬀…🬻`         | U+1FB00-1FB3B (13.0)          | 2×3         | 2 for 6 px                                     | 80×24 gives 160×72 px. Font and terminal caveats below.            |
| Octants                | U+1CD00-1CDE5 (16.0)          | 2×4         | 2 for 8 px                                     | Newest; little support.                                            |
| Braille `⠁…⣿`          | U+2800-28FF (3.0)             | 2×4 dots    | 1 (fg dots) + bg                               | Dots have gaps, so it suits particles, lines and plots, not fills. |

Versions are from [DerivedAge-18.0.0](https://www.unicode.org/Public/UCD/latest/ucd/DerivedAge.txt). Charts: [U2580](https://www.unicode.org/charts/PDF/U2580.pdf), [U2800](https://www.unicode.org/charts/PDF/U2800.pdf), [U1FB00](https://www.unicode.org/charts/PDF/U1FB00.pdf), [U1CC00](https://www.unicode.org/charts/PDF/U1CC00.pdf).

Who draws these procedurally (exact fill, no font dependency) and who relies on the font:

- **Ghostty**: sprite renderer, with one draw function per range. That includes `block.zig`, `braille.zig` and `symbols_for_legacy_computing.zig`, which has sextants via `draw1FB00_1FB3B` ([ghostty src/font/sprite/draw](https://github.com/ghostty-org/ghostty/tree/main/src/font/sprite/draw)).
- **kitty**: box/block in native code. Changelog: "Implement special rendering for … Symbols for Legacy Computing from the Unicode 13 standard", "Add support for the octant box-drawing characters", supplement block support ([kitty docs/changelog.rst](https://github.com/kovidgoyal/kitty/blob/master/docs/changelog.rst)).
- **WezTerm**: `custom_block_glyphs` (default true) covers U+2500 box drawing, U+2580 block elements, U+1FB00 sextants and smooth mosaics, and U+2800 braille ([docs](https://wezterm.org/config/lua/config/custom_block_glyphs.html)).
- **iTerm2**: `blockDrawingCharacters` lists half blocks, eighths, quadrants and `iTermBlockSextant*` ([iTermBoxDrawingBezierCurveFactory.m:31-117](https://github.com/gnachman/iTerm2/blob/master/sources/Drawing/iTermBoxDrawingBezierCurveFactory.m)).
- **GNOME Terminal (VTE)**: draws U+2500-259F and, since 2020, U+1FB00-1FBAF ([VTE commit e1162ba5](https://lists.gnome.org/archives/commits-list/2020-February/msg08625.html)).
- **Windows Terminal**: `builtinGlyphs` (default true) covers only U+2500-259F plus Powerline ([PR #16729](https://github.com/microsoft/terminal/pull/16729), [BuiltinGlyphs.h](https://github.com/microsoft/terminal/blob/83d0d9df/src/renderer/atlas/BuiltinGlyphs.h)). A sextant built-in PR was **closed unmerged** ([#19841](https://github.com/microsoft/terminal/pull/19841)), so sextants rely on the font. Cascadia Code and Mono include them since v2404.23 ([release notes](https://github.com/microsoft/cascadia-code/releases/tag/v2404.23)). Which Cascadia version a given Windows Terminal build bundles was not verified.
- **macOS Terminal.app**: no evidence of procedural drawing was found, so assume it uses the font. On stock macOS, `fc-list :charset=1FB15` finds only `.LastResort`; Menlo, SF Mono and JetBrains Mono lack sextants ([zed#56342](https://github.com/zed-industries/zed/issues/56342)). **Expect sextants to show as tofu.** Half blocks and quadrants are in the stock fonts. Font-drawn blocks can leave hairline gaps between rows ([zed#56342 refs](https://github.com/zed-industries/zed/issues/56342), [WT PR #16729 discussion](https://github.com/microsoft/terminal/pull/16729)).
- Cross-terminal tally: [arewelegacycomputingyet.com](https://arewelegacycomputingyet.com/) gives U+1FB00 coverage of Ghostty 85%, kitty 74%, VTE 86%, xterm.js 91%, urxvt 0%.

Colour limits and tricks:

- Half block is the only mosaic with fully independent pixels. To keep the terminal's own background (themes, transparency), paint "empty" pixels with **default bg**, not an explicit black or white. Put the lit pixel in fg (`▀` or `▄`), and set bg only where both pixels are lit. This is the same reasoning iTerm2 notes for block characters "next to an empty space whose background color should match" (`iTermBoxDrawingBezierCurveFactory.m:28-30`).
- Without colour (NO_COLOR, ASCII profile), every mosaic collapses to 1-bit shapes. Braille and half-block motion survives as shape. Fills that rely on fg≠bg vanish, so map luminance to glyph and weight instead (§6, `canvas.go:93-110`).
- **Safest at 80×24 across all listed terminals:** half blocks plus braille. Both are native or present in default fonts everywhere above. Use quadrants for edges. Use sextants only behind an opt-in gate: no standard terminal query reports glyph coverage.

---

## 3. Perf budget

Measured through `uv.TerminalRenderer`, steady frames 25-119, dark palette:

| Scene                                                | Profile         | Bytes/frame   | Changed cells/frame | KiB/s @24 | @60   |
| ---------------------------------------------------- | --------------- | ------------- | ------------------- | --------- | ----- |
| Pre-boot 80×24                                       | TrueColor       | 8 008         | 386 / 1 920         | 188       | 469   |
| Pre-boot 80×24                                       | ANSI256         | 4 355         | 386                 | 102       | —     |
| Pre-boot 80×24                                       | ANSI / NO_COLOR | 3 086 / 1 444 | —                   | 72 / 34   | —     |
| Pre-boot 120×30                                      | TrueColor       | 12 949        | 594 / 3 600         | 303       | —     |
| Pre-boot 80×24, fg in steps of 32 (8 levels/channel) | TrueColor       | 4 917         | 190                 | 115       | —     |
| Full-screen `▀` plasma 80×24 (fg+bg every cell)      | TrueColor       | 63 092        | 1 920               | 1 479     | 3 697 |
| same, steps of 32                                    | TrueColor       | 19 331        | —                   | 453       | 1 133 |
| same, unquantised                                    | ANSI256         | 14 821        | —                   | 347       | 868   |

Takeaways:

- A changed truecolor fg cell costs about **21 B** (cursor jump plus `38;2;r;g;b` plus glyph). A cell that changes both fg and bg costs about **33 B**. The raw `View` string (~10 KB at 80×24) is not what crosses the wire; only the diff does.
- Quantising fg to 16 or 8 levels per channel (steps of 16 or 32) cut changed cells by 39-51% (386 → 234 or 190) and bytes by 27-39%, because `cellEqual` uses raw RGBA (§1). The visual cost was not evaluated; coarse steps may show banding on slow fades.
- A full-screen colour field is 10× the current Pre-boot budget. Over SSH it has no sync output (§1), so tearing becomes likely. Keep dense mosaic work to a **bounded hero region** (for example ≤ 40×12 cells), with sparse particles elsewhere.
- Rule of thumb from the numbers (an inference, not a terminal benchmark): stay at **≤ 10 KB/frame and ≤ ~500 changed cells at 24 fps** (≈ 240 KiB/s ≈ 2 Mbit/s) to match today's Pre-boot. Prefer 24 fps over 30 or 60: Ghostty's own animation is 24 fps (`OUTPUT_FPS=24`, [video-to-terminal.sh:6](https://github.com/ghostty-org/website/blob/main/bin/video-to-terminal/video-to-terminal.sh)).
- Static text costs nothing unless its colour animates. A per-letter `Sweep` on a title (`internal/preboot/text.go:98-100`) rewrites every title cell each frame. Animate colour on few cells, or step it at a lower rate.

---

## 4. Accessibility and motion conventions

- **NO_COLOR** ([no-color.org](https://no-color.org/)): disable _added colour_ when the variable is set and non-empty, whatever its value. The FAQ says it should **not** disable bold, underline or italic. Pre-boot's "brightness becomes weight" (`canvas.go:93-110`) matches this, and so does #360's "NO_COLOR keeps glyph motion".
- **Reduced motion has no terminal standard.** Prior art:
  - CSS `prefers-reduced-motion` ([Media Queries 5 §12.1](https://www.w3.org/TR/mediaqueries-5/)).
  - WCAG 2.2.2: moving content that starts automatically, lasts **> 5 s** and sits beside other content needs a pause/stop/hide mechanism ([Understanding 2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)).
  - WCAG 2.3.1: **no more than 3 flashes per second** ([2.3.1](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)).
  - WCAG 2.3.3: allow disabling non-essential motion ([2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)).
- CLI precedents:
  - `gh`: `GH_SPINNER_DISABLED` "replace the spinner animation with a textual progress indicator", plus `GH_ACCESSIBLE_PROMPTER` and `GH_ACCESSIBLE_COLORS` (`gh help environment`, gh 2.102.0).
  - Astro's `useAscii()` fallback glyph sets (cli-kit `src/messages/index.ts:43-46`).
  - self-host's `SELF_HOST_REDUCED_MOTION` (`internal/cli/cli.go:238`).
- **Non-TTY, CI, dumb:**
  - self-host opens the TUI only when stdin and stdout are terminals and `--json` is off (`internal/system/real.go:107`, `internal/cli/cli.go:234-236`).
  - `is-interactive` (used by ora and others) also treats `TERM=dumb` and any `CI` as non-interactive ([index.js](https://github.com/sindresorhus/is-interactive/blob/main/index.js)).
  - colorprofile maps `TERM=dumb` to `NoTTY`, which strips even bold (`cp/env.go:76-82`, `uv/cell.go:443-444`). The TUI still starts in that case.
  - **Gap:** a dumb terminal or CI with a pty would get an animation it cannot draw. Treating `TERM=dumb` like reduced motion would be cheap.

---

## 5. Prior art for motion design

- **Ghostty homepage / `ghostty +boo`**
  - Effect: a looping 3D-rendered ghost in ASCII at 24 fps, 100 columns.
  - Technique: ffmpeg frames, squashed by font ratio `.44`. Pixels are kept only if near two target colours (blue `0,0,230` / white `215,215,215`), and Rec.709 luminance maps to a 10-step ramp `· ~ o x + = * % $ @` ([video-to-terminal.sh:4-62, 121-130](https://github.com/ghostty-org/website/blob/main/bin/video-to-terminal/video-to-terminal.sh)). The frames ship compressed in the binary for `ghostty +boo`, adding 348 KB ([ghostty#4876](https://github.com/ghostty-org/ghostty/pull/4876)).
  - Why it feels premium: a real rendered source, **two-tone restraint, negative space**, a perceptual luminance ramp and steady 24 fps.
- **charmbracelet/harmonica**
  - Effect: a damped spring, ported from Ryan Juckett.
  - API: `NewSpring(FPS(n), angularFreq, damping)` and `Update(pos, vel, target)` (`MC/github.com/charmbracelet/harmonica@v0.2.0/spring.go:67,132,216`). Damping < 1 overshoots, = 1 settles fastest without ringing ([README](https://github.com/charmbracelet/harmonica)). `bubbles/progress` uses it (`bb/progress/progress.go:14,289`).
  - Why it feels premium: retargetable motion that keeps velocity, so it never "restarts". The math is closed form, about 73 non-comment lines (`spring.go:56-224`).
- **bubbles spinner sets** (`bb/spinner/spinner.go:28-83`)
  - Each set carries its own rate: Line 10 fps, Dot `⣾⣽⣻⢿⡿⣟⣯⣷` 10 fps, MiniDot `⠋⠙⠹…` 12 fps, Pulse `█▓▒░` 8 fps, Points `∙●∙` 7 fps, Meter `▱▰`.
  - Lesson: **spinners run slower than the scene** (7-12 fps), so a 24 fps scene should step its spinner every 2-3 frames.
- **Bubble Tea examples** ([examples/](https://github.com/charmbracelet/bubbletea/tree/main/examples))
  - `splash`: a port of Textual's splash. Each row draws a rotating multi-stop gradient as `▀` with separate fg/bg colours.
  - `doom-fire`: half-block fire with indexed ANSI colours, 50 ms tick.
  - `space`: a 60 fps half-block starfield with an FPS counter, ported from Orhun Parmaksız.
  - These are canonical half-block references in v2 APIs.
- **Astro `create-astro` Houston** ([withastro/cli-kit](https://github.com/withastro/cli-kit))
  - Effect: a 3-row boxed mascot face (`╭─────╮` / `│ ● ○ ●  message` / `╰─────╯`) "speaks" word by word. Each word waits a random **75-200 ms**, the mouth and eyes flip per word, a smile `◡`/`◠` holds for 1.2-1.4 s, and any key skips (`src/messages/index.ts:10-88`).
  - Spinner: an 8-step purple→green block gradient sweeping back and forth (`src/spinner/index.ts:7-44`).
  - Why it feels premium: **personality plus human timing variance**, always skippable, with an ASCII fallback.
- **terminaltexteffects (tte)** ([README](https://github.com/ChrisBuilds/terminaltexteffects), [Showroom](https://chrisbuilds.github.io/terminaltexteffects/showroom/))
  - Engine: per-character Paths and Waypoints with easing and Bézier curves, Scenes, and gradient generation in XTerm-256 and RGB.
  - Effects: Beams, BinaryPath, Blackhole, BouncyBalls, Bubbles, Burn, ColorShift, Crumble, Decrypt ("movie style text decryption"), ErrorCorrect, Expand ("characters expand from the center"), Fireworks, Highlight ("specular highlight across the text"), LaserEtch, Matrix, MiddleOut, OrbittingVolley, Overflow, Pour, Print, Rain, RandomSequence, Rings, Scattered, Slice, Slide, Smoke, Spotlights, Spray, Swarm, Sweep, SynthGrid, Thunderstorm, Unstable, VHSTape, Waves, Wipe.
  - Why it feels premium: each glyph has its own eased choreography, and every effect **ends with a final gradient settle** onto the readable text.
- **cmatrix** ([README](https://github.com/abishekvashok/cmatrix))
  - Effect: ncurses column rain with bold, update delay (`-u`), colour (`-C`) and rainbow options.
  - Lesson: a bright head with a decaying tail (one glyph's brightness falling over time) reads as motion with very few changed cells.
- **asciiquarium / Term::Animation** ([robobunny](https://robobunny.com/projects/asciiquarium/html/), [Term::Animation](https://metacpan.org/pod/Term::Animation))
  - Technique: sprite entities with multiple frames, a **depth (z) layer**, per-entity callbacks and wrap.
  - Why it feels premium: layered parallax and ambient "life" that never repeats exactly.
- Not covered: Claude Code, opencode, Warp and Bun. No primary-source motion code was found for them (closed source, no intro animation, or not located in this pass).

---

## 6. What `internal/preboot` and the frame chain already provide

**Contract and determinism**

- A frame is a pure function of (frame number, size, Progress, palette, noColor), with no clock (`internal/preboot/preboot.go:7-9`). Time is `n/FPS` (`:89`). `FPS=24`, `EntranceFrames=12`, `ExitFrames=44` (`:17-26`).
- Randomness comes from an integer hash/`noise(a,b,c)` (`palette.go:82-93`), so particles are stable per index and cycle.
- Golden helper with `-update` (`preboot_test.go:16-35`). Goldens at 80×24, 120×30 and 70×20 (`:62-89`, `testdata/*.golden`). There are repeatability and "next frame moves" tests (`:101-125`) and a NO_COLOR test (no `38;2`/`38;5`; bold/faint present; `:127-140`).
- The asciicast preview flag `-entrance-preview` writes byte-identical casts (`internal/tui/preboot_test.go:22-24`, `docs/tui-entrances-proof.md:26-50`).

**Canvas** (`canvas.go`)

- A cell grid with `{rune, fg RGBA, lum, bold}` (`:10-31`), plus a **braille sub-layer** of eight dots per cell, merged under cells by `flush` (`:67-91`).
- Rows are run-length styled through `ansi.Style` (`:142-169`).
- No bg colour per cell, so it has **no half-block layer yet**.
- NO_COLOR: `look()` maps `lum ≥ 0.8` to bold and `< 0.35` to faint (`:93-110`).

**Palette** (`palette.go`)

- Dark/Light sets of purple, pink, cyan, gold, text, muted, faint, star and bg (`:10-38`).
- `Sweep(x)` is a 4-stop cycle with smoothstep (`:46-55`). `Fade` lerps toward `Bg` (`:57-58`). `Glow` pushes toward white on dark and black on light (`:60-66`).
- `Bg` is hard-coded `#000`/`#FFF`, but the real terminal background is discarded (`internal/tui/model.go:420-421`). On non-black dark themes, faded glyphs sit darker than the background.
- Chosen from `m.theme.dark` (`internal/tui/preboot.go:111-114`).

**Easing in use**

- `smooth` smoothstep (`palette.go:68-71`).
- Ease-out cubic for the entrance (`preboot.go:157`) and the Dashboard accent settle (`internal/tui/entrance.go:15-16`).
- Cubic warp acceleration (`starfield.go:29`).
- `sin(π·life)` flare envelope (`brand.go:27`).
- Gaussian glint and shimmer bands (`brand.go:73`, `text.go:180`).
- `sin²` star twinkle (`starfield.go:31-32`).
- No spring.

**Scene pieces**

- `sky` is a 3-layer parallax starfield with density scaled by area (`starfield.go:8-60`). Brightness picks the glyph `· + ✦ ✶`, so twinkle survives without colour (`brand.go:10-23`).
- Also in `starfield.go`: shooting stars (`:62-90`), sparkles that **avoid the text box** (`:92-111`) and braille aurora ribbons (`:113-127`).
- `brand` draws a ◆ built from `▲▼◢◣◥◤◀▶█` with a moving glint, a pulse and ▓/▒ shading under NO_COLOR (`brand.go:46-88`). Diamond halo rings (`:90-112`) and tip flares (`:114-127`) complete it.
- Layout tiers: full ≥100×28, medium ≥80×24, small otherwise, which drops the brand (`preboot.go:58-81`).
- Text: `centred` picks the first variant that fits, else cuts with `…` (`text.go:64-87`). Text rows clear 2 cells of margin (`:148-160`).
- The narrative line keeps **fixed-width animated dots** so it never shifts (`text.go:195-212`). This is the direct pattern for #360's pinned Doctor line.
- An eighth-block progress bar with a shimmer (`text.go:162-193`).

**Entrance and exit**

- `RenderEntrance` reveals art centre-out over 12 frames while text is present from frame 0 (`preboot.go:127-159`).
- `RenderExit` stretches stars into streaks, then `reveal` wipes in an arbitrary `under` screen along a slanted edge with `ansi.Cut`, styles preserved (`preboot.go:161-171`, `wipe.go:17-81`). This is reusable as the hand-off into the What step.

**Frame chain** (`internal/tui`)

- `frameMsg` (`model.go:57-58`) comes from a **cancellable one-shot timer** using `frameContext` (`:213-225`). Ticking restarts only via `startTicking` (`:227-234`) and stops once nothing animates (`:236-262`). `Run` cancels it on exit (`run.go:12`).
- `framePeriod` is 24 fps while Pre-boot plays, 12 fps otherwise (`preboot.go:42-49`). Activity's counter advances every other Pre-boot frame (`preboot.go:17-19`, `model.go:247-254`).
- The Dashboard opening is a 3-frame accent settle (`entrance.go:8-29`).

**Reduced motion / NO_COLOR wiring**

- `Options.ReducedMotion` and `NoColor` (`model.go:89-99`) come from `SELF_HOST_REDUCED_MOTION != ""` and `NO_COLOR != ""` (`internal/cli/cli.go:238`).
- Reduced motion zeroes the opening (`model.go:181-184`) and skips Pre-boot (`internal/tui/onboarding.go:768-770`).

**What #360 replaces**

- The `Initializing` reveal lists a check every 6 frames at 12 fps, then auto-continues (`onboarding.go:40-41`, `130-157`, `939-956`).
- Doctor results arrive **all at once** (`doctorMsg{checks: backend.Doctor(ctx)}`, 30 s timeout, `model.go:317-323`). A per-check `⠋ Checking Docker…` line would need streamed check events, or must stay generic ("Checking this machine…").

**Existing half-block use**: the QR code (`internal/tui/qr.go:67-95`).

**harmonica is not a dependency.** It is absent from `go.mod`/`go.sum`. It sits in the module cache only because `bubbles/v2@v2.2.1/go.mod:10` requires it for `progress`, which self-host does not import (`go mod why -m github.com/charmbracelet/harmonica` → "main module does not need module"). #360 also says "add no new animation goroutine, ticker or dependency".

---

## Implications for #360

1. **Build the welcome scene as a sibling of Pre-boot, sharing its canvas.** Put it in `internal/preboot`, or extract `canvas`/`palette`/`noise` into a small shared package. Keep the pure `Render(n, w, h, state, pal, noColor) []string` contract and goldens at 80×24 and 120×30. Reuse the `sky`, `brand`, `RenderEntrance`-style centre-out reveal and the `reveal` wipe as the hand-off to What.
2. **Add the welcome state to `framePeriod` and the `nextFrame` keep-ticking condition.** Do not add a ticker. Bound the scene's lifetime and keep `enter` as skip: WCAG 2.2.2 applies once motion exceeds 5 s, and Doctor can take up to 30 s.
3. **Sub-cell choice: half blocks (`▀▄`) for any solid hero art, braille for particles and ribbons.** Both are safe in every terminal surveyed. Do not use sextants or octants by default (tofu in Terminal.app; font-dependent in Windows Terminal). Leave empty half-pixels on the default bg so terminal themes show through. A half-block layer needs a `bg` field in `cell` plus a 1-bit NO_COLOR fallback.
4. **Budget about 10 KB/frame at 24 fps.** Confine dense colour to a hero box of about 40×12 cells or less. Quantise animated colours (8-16 levels per channel, or a small LUT), and check for banding. Do not animate colour across all title letters every frame. This matters most over SSH and in Terminal.app, where Bubble Tea never enables 2026 sync.
5. **Emit truecolor and let Bubble Tea downsample.** Remove per-profile branches. Optionally use `tea.WithFPS(120)` to cut flush jitter for 24 fps scenes; an unchanged view is a cheap compare.
6. **Fix the palette's background assumption.** Keep the colour from `BackgroundColorMsg`, not just `IsDark()`, and fade toward it. Hold or blank the first frames until the reply, or a ~100 ms timeout, so light terminals don't flash the dark palette.
7. **The pinned Doctor line reuses the narrative pattern** (fixed-width trailing animation, `text.go:195-212`) and the braille spinner stepped at about 8-12 fps. Since Doctor reports in one batch, say "Checking this machine…", then `✓ This machine is ready.` Name a check only on fail or warn.
8. **Motion to steal, ranked:**
   - (a) tte **Decrypt/Expand-style title resolve** of "Welcome to self-host", from scrambled glyphs into text, with a final gradient settle.
   - (b) a **specular highlight sweep** (tte Highlight; Pre-boot already has the Gaussian glint math) across the ◆ and title once Doctor passes.
   - (c) a **critically damped spring** (harmonica's closed-form math reimplemented inline, under 80 lines, no dependency) for the brand and title settling into place, plus Houston-style 75-200 ms jittered cadence on the status line.
   - Ghostty's lesson for all three: two-tone restraint and negative space beat filling the screen.
9. **Accessibility:**
   - `SELF_HOST_REDUCED_MOTION` lands directly on the static result.
   - NO_COLOR keeps glyph and weight motion (bold/faint stay legal per the spec).
   - Keep sparkle and pulse flashes under 3 per second.
   - Consider treating `TERM=dumb` as reduced motion.
   - Mind Ambiguous-width glyphs (`█▀◆·─`) in the 80-column fit.
