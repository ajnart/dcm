# self-host showreel: v5 canonical-domain release candidate

1920×1080 · 60 fps · 17 bars at 120 BPM · H.264 `yuv420p`, `+faststart` · AAC stereo.
Every frame is determined by `window.seek(t)`. `timeline.js` owns scene windows and music edits;
the scenes export their sound cues through `node render.mjs cues`.

## Direction

A technical product demo with continuous camera movement, grouped entrances, match cuts and whip
transitions. Inter Tight handles headlines; JetBrains Mono handles code and the wordmark. Corners
are 2–6 px. Commands use light text and a muted prompt instead of multicolour syntax highlighting.

The previous requirement for a new event on every beat is retired. Picture cuts remain on the beat;
typing and other UI sounds follow their actual animation timing. Reading holds permit slow camera
drift, while checking opacity, overlap, text size, layout stability and bounds.

## Timeline

| Time        | Section      | Motion and content                                                                                                                                                                                                                                      |
| ----------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–6 s       | Hook         | “Stop renting your software.” lands in two gestures. Subscription tiles fly into a wall, locks land, the price counts up, and the tiles flip to the self-hosted replacements. The wall collapses into the next shot. No strike-through.                 |
| 6–10 s      | Command      | A violet diamond expands into the wordmark and folds back into its mark. The lockup docks, `self-host install media homarr` types, and the Recipe/App resolution appears. Seven icons land inside the Compose Project card, which expands into the TUI. |
| 10–14 s     | Setup        | “Sets up every App.” remains for four seconds. Apps finish one per beat while the camera eases toward the activity panels, then pushes into Links.                                                                                                      |
| 14–17.5 s   | Links        | Four cards arrive together. Wires draw, masked credential indicators travel to the configured Apps, and checkmarks land. The grid whips upward into Homarr.                                                                                             |
| 17.5–19.5 s | Dashboard    | The board tilts into place; App tiles and widgets arrive, numbers count up and the sparkline draws. A camera dive leads into the next shot.                                                                                                             |
| 19.5–22 s   | CLI question | “Don’t want to learn the CLI?” lands over moving command lines.                                                                                                                                                                                         |
| 22–28 s     | Agents       | A request types into the chat. Six agent headers switch while the plan, approval, install and result unfold. “One skill. Every agent.” uses the same sans-serif family as other prose.                                                                  |
| 28–30 s     | Flurry       | Four half-second compositions: “Your hardware.” scales down; “Your rules.” whips in on violet; “No rent.” enters from the opposite side; “Your data.” expands into place. Each keeps moving gently through its reading hold. No progress bar.           |
| 30–34 s     | End          | The wordmark lands on the final hit, `curl -fsSL https://selfhost.ajnart.dev/install.sh \| bash` types, agent names appear and the counts resolve with `github.com/ajnart/selfhost`. A slow push and caret keep the card alive.                         |

## Music and UI sound

“Let's Move” by Michael Ramir C., Mixkit item 836, under the Mixkit Stock Music Free License.
See `audio/SOURCES.md` for source, licence and download verification. The raw track is ignored by Git.

| Reel bars       | Source bars | Purpose                                                                       |
| --------------- | ----------- | ----------------------------------------------------------------------------- |
| 0–13 (0–28 s)   | 5–18        | Continuous intro, drop and groove; the first three reel bars are lifted 8 dB. |
| 14 (28–30 s)    | 35          | Build under the flurry.                                                       |
| 15–16 (30–34 s) | 48–49       | Final hit and ring-out.                                                       |

The source grid is measured by `audio/analyze.mjs`: approximately 119.997 BPM, first downbeat
0.0297 seconds. Track edits use a 4 ms equal-power crossfade beginning around 6 ms before the attack.

`audio/sfx.mjs` synthesises 218 cues: keys, enter/click sounds, lock thocks, flips, pops, checks,
success chimes, whooshes, zips and impacts. These are mixed with the music, including a small reverb
bus, rather than replacing it. `audio/mix.mjs` measures and masters the result toward −14 LUFS
integrated and a true peak below −1 dBTP.

## Facts and release gate

- The media Recipe resolves to qBittorrent, Sonarr, Radarr, Prowlarr, Jellyfin and Seerr;
  Homarr adds the seventh App. Source on `main`: `internal/catalog/default.go`.
- Link descriptions follow `internal/apps/arr/links.go`, `internal/apps/seerr/seerr.go` and
  `internal/apps/homarr/links.go` on `main`.
- The agent example follows `internal/skill/guide.md`, “Every conversation”: pick the Recipe or
  Apps from `apps list`, show the plan in goals and Apps, get approval, then install. The example
  uses `owned-video-library` plus Homarr, with Access shown as “Home network.”
- 93 Apps and 20 Recipes were checked against a fresh CLI build from `origin/main` for the
  preceding terminology update.
- Subscription prices are illustrative inherited examples, totalling $92. The $0 comparison
  concerns software subscriptions, not hardware, electricity or hosting costs.
- The maintainer's 2026-10-11 request changes the end card to the canonical installer Address,
  **`https://selfhost.ajnart.dev/install.sh`**, and repository **`ajnart/selfhost`**. It supersedes the
  approved v5 npm preview, without changing the 34-second timeline or creative direction. The longer
  command uses 40 px type; the repository line uses 36 px and shares the counts' entrance.
- **Publication is held pending live release verification.** On 2026-10-11 the domain did not resolve,
  `ajnart/selfhost` was unavailable through authenticated GitHub lookup, and `ajnart/selfhost-skills`
  was private. [Issue #193](https://github.com/ajnart/selfhost-skills/issues/193) records the rename and
  visibility gate. [Issue #268](https://github.com/ajnart/selfhost-skills/issues/268) tracks publication
  acceptance. A successful mock render does not establish working installer or public binaries.
- Agent logo provenance is in `assets/agents/SOURCES.md`.

## Validation and reproduction

```sh
node render.mjs cues
node audio/mix.mjs
node render.mjs lint
node render.mjs video --workers 8 --sub 8
node render.mjs verify
node render.mjs contact
```

Lint checks all declared reading holds at 30 Hz, undeclared text, safe-area bounds, beat-aligned
cuts and deterministic seeking. Sentences need 0.4 seconds plus 0.25 seconds per word; phrases of
up to three words need 0.4 seconds. Slow motion is limited per sample to 2.5% of text size, with a
2.5 px minimum allowance. Missing beat events are informational, not failures.
The retained terminology check rejects “Exposure” and obsolete `new-cli/` paths in rendered text;
the actual lowercase `--exposure` CLI flag remains valid in the background commands.

Review stills cover the corrected card, Setup, Links, board, chat, all four flurry compositions
and the end card. Final-file verification reports codecs, equal stream durations, loudness,
frame-average luminance changes and cut offsets against the beat grid detected in the mixed audio.
The luminance scan is a limited automated check, not a comprehensive photosensitivity assessment.

### Verified v5 render

- 2,040 frames at 60 fps; video and audio both 34.000 seconds; MP4 7.62 MB, faststart enabled.
- Integrated loudness −13.9 LUFS; true peak −1.8 dBTP; loudness range 6.1 LU.
- No flashes detected by the frame-average luminance scan.
- 17 picture cuts: worst beat offset 1.10 ms, mean absolute offset 1.06 ms.
- 102 reading holds pass; deterministic-seek and safe-area checks pass.
- JavaScript syntax checks and all 12 repository validation checks pass. The reel has no configured
  TypeScript typecheck; it is a JavaScript project.

### Verified canonical-domain candidate, 2026-10-11

- Regenerated `audio/cues.json` (218 cues), mixed the original verified track, and rendered all 34
  chunks with eight workers and eight sub-frames. No renderer or timeline changes, no new dependencies.
- Final MP4: 2,040 frames, 1920×1080 at 60 fps, H.264 High `yuv420p`, faststart; AAC 48 kHz stereo.
  Video, audio and container all measure 34.000 seconds; file size 7.72 MB.
- Final-file integrated loudness −13.8 LUFS, true peak −2.0 dBTP, loudness range 6.0 LU.
- No flashes detected by the limited frame-average luminance scan; 17 cuts have a maximum and mean
  absolute beat offset of 1.00 ms.
- All 103 reading holds pass at 30 Hz, with zero overlap, bounds, undeclared-text or terminology
  failures. The installer holds 2.74 seconds at 40 px nominal size; the repository holds 2.05 seconds
  at 36 px. At 33.95 seconds the repository text retains 97 px of bottom clearance.
- All 68 default out-of-order seek samples and 23 fresh-page samples pass. Twenty-seven comparisons
  contain only sub-pixel glyph raster noise
  (worst 53.4 dB PSNR, versus the 30 dB failure threshold). All 13 targeted transition/end samples
  are pixel-identical when revisited out of order; all five fresh-page samples are also identical.
- Inspected nine affected source stills, sixteen quarter-second samples extracted from the rendered
  end card, and the new 34-frame final contact sheet. Entrances, typing, count resolution and the
  final reading hold preserve the approved motion, with no new text clipping or overlap observed.
- JavaScript syntax checks and the reel's full lint pass. No TypeScript typecheck is configured;
  product code is unchanged and the Go/Docker runtime gates were not invoked for this video-only edit.
- MP4 SHA-256: `488d1241c70ebe3c1a4b34a51836fce5af746f5cb2bcafd8126cedef7801ffb5`.

These measurements belong to the release candidate, not a new creative approval or public installer
acceptance. Publication remains gated by #268.
