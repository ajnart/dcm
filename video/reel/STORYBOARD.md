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
| 30–34 s     | End          | The wordmark lands on the final hit, `curl -fsSL https://self-host.fyi/install \| bash` types, agent names appear and the counts resolve with `github.com/ajnart/self-host`. A slow push and caret keep the card alive.                         |

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
  **`https://self-host.fyi/install`**. The repository line now names the existing
  **`ajnart/self-host`** repository. This supersedes the
  approved v5 npm preview, without changing the 34-second timeline or creative direction. The longer
  command uses 40 px type; the repository line uses 36 px and shares the counts' entrance.
- **Publication is held pending anonymous installer and release-binary verification.** As of the
  current-release reconciliation on 2026-10-13, the website is live and `ajnart/self-host` remains
  private. This source correction does not rename or publish it.
  [Issue #295](https://github.com/ajnart/self-host/issues/295) tracks installer/site acceptance,
  [issue #193](https://github.com/ajnart/self-host/issues/193) tracks distribution decisions, and
  [issue #268](https://github.com/ajnart/self-host/issues/268) tracks reel publication acceptance.
  A successful mock render does not establish a working anonymous installer or public binaries.
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

### Verified repository correction, 2026-10-13

- Merged current `main` (`6c0482ea`) and corrected only the end-card repository to
  `github.com/ajnart/self-host`. The existing GSAP/Playwright renderer, frozen dependency
  versions, fonts, 34-second timeline, motion and track provenance are retained.
- Regenerated the 218-cue sheet, byte-identical to the preceding candidate. The original raw track
  cache was unavailable. To preserve the approved sound without downloading media, the preceding
  candidate's AAC was decoded to ignored `audio/out/soundtrack.wav` for the existing picture render;
  its original AAC stream was then copied into the final MP4 with `ffmpeg -c copy` and faststart.
  Extracted AAC streams compare byte-identical (SHA-256
  `d44f41bb6934fa2eb2e4addc46ac9ae4074db8c47704d9dfb6b18f6fc022907e`).
- Rendered all 34 chunks through `node render.mjs video --workers 8 --sub 8`. Final MP4: 2,040
  frames, 1920×1080 at 60 fps, H.264 High `yuv420p`, faststart; AAC 48 kHz stereo. Picture, sound and
  container all measure 34.000 seconds; size 7.73 MB. Loudness remains −13.8 LUFS, −2.0 dBTP, 6.0 LU.
- The final-file scan reports no flashes under its limited frame-average measure. All 17 cuts have
  maximum and mean absolute beat offsets of 1.00 ms.
- All 103 reading holds pass at 30 Hz, with no overlap, bounds, undeclared-text or terminology
  failures. Full lint passes all 68 out-of-order samples and 23 fresh-page samples; 25 comparisons
  show sub-pixel glyph raster noise (worst 53.6 dB PSNR, above the 30 dB failure threshold).
  Eleven targeted end-card seek samples and four fresh-page comparisons are pixel-identical.
- Inspected eight source stills, sixteen quarter-second samples from the final rendered end card,
  and the regenerated 34-frame contact sheet. The full repository line retains 97 px bottom
  clearance at 33.95 seconds, with no clipping or overlap observed.
- Changed JavaScript syntax and `git diff --check` pass. Product code, Docker and runtime tests
  were not part of this focused composition correction.
- MP4 SHA-256: `4ea555e40653d6df72cc957b6d94e678a2dae0b9de385cd6e6b9b10f20d0c6f0`.

This is source and render acceptance. Anonymous installation, public binary distribution and reel
publication remain separate gates under #295, #193 and #268.

### Verified canonical-address re-render, 2026-10-13

- Re-rendered the deliverables from `main` (`b368a712`) so the end card shows
  `curl -fsSL https://self-host.fyi/install.sh | bash`. No source, timing or direction changes.
  `audio/cues.json` was regenerated (212 cues, since the typed command differs) and the original
  track was fetched and verified by `audio/mix.mjs`.
- Final MP4: 2,040 frames, 1920×1080 at 60 fps, H.264 High `yuv420p`, faststart; AAC 48 kHz stereo.
  Picture, sound and container all measure 34.000 seconds; size 7.69 MB.
- Loudness −13.8 LUFS, true peak −2.0 dBTP, loudness range 6.0 LU. No flashes under the limited
  luminance scan; 17 cuts have a mean absolute beat offset of 0.94 ms (worst 2.16 ms).
- All 103 reading holds pass at 30 Hz, with no overlap, bounds, undeclared-text or terminology failures.
  All 68 out-of-order and fresh-page seek samples pass (worst raster noise 53.4 dB PSNR).
- The command fits its card at 40 px with no clipping; the repository line is unchanged.
- MP4 SHA-256: `dac4f31932a77e1d9d86455220f112c9c85b23a00ead30daf136320e2e4f70a6`.

### Verified extensionless-installer re-render, 2026-10-13

- Re-rendered from `main` (`aee05f87`) so the end card shows `curl -fsSL https://self-host.fyi/install | bash`,
  with Playwright updated 1.63.0 → 1.64.0 (the other packages were already latest; Chromium reinstalled).
  No timeline, timing or direction changes. `audio/cues.json` was regenerated (209 cues, since the typed
  command is shorter) and the original track was fetched and verified by `audio/mix.mjs`.
- Final MP4: 2,040 frames, 1920×1080 at 60 fps, H.264 High `yuv420p`, faststart; AAC 48 kHz stereo.
  Picture, sound and container all measure 34.000 seconds; size 7.69 MB.
- Loudness −13.8 LUFS, true peak −2.0 dBTP, loudness range 6.0 LU. No flashes under the limited
  luminance scan; 17 cuts have a mean absolute beat offset of 0.94 ms (worst 2.16 ms).
- All 103 reading holds pass at 30 Hz, with no overlap, bounds, undeclared-text or terminology failures.
  All 68 out-of-order and fresh-page seek samples pass (worst raster noise 53.4 dB PSNR).
- Inspected the end-card stills at 31, 32, 33 and 33.95 seconds and the 34-frame contact sheet; the
  command fits its card with no clipping.
- MP4 SHA-256: `e2b9ec389c0d567ca6f870ce6c3c5dd188eecbf7cfa316ad706c92737ee0bd1c`.

# Cut 2: Replace the SaaS you pay for

[Issue #523](https://github.com/ajnart/self-host/issues/523). A 30-second cut beside the media cut above: 15 bars at the same 120 BPM, on
the same engine, styles, track and sound pipeline. It is a separate timeline and set of scenes in `saas/`; the media cut renders unchanged.
Select it with `--cut saas` on every `render.mjs` mode and on `audio/mix.mjs`; it writes `out/selfhost-reel-saas.mp4`,
`audio/cues-saas.json` and `audio/out/soundtrack-saas.wav` beside the media files. Delivered as `site/public/reel-saas.mp4` and its
poster `site/public/reel-saas.jpg` (thumbnail variant 18, `thumbs/`, made the way `reel.jpg` is).

## Direction

The same technical product demo as the media cut: Inter Tight for headlines, JetBrains Mono for code and the Dashboard, sharp corners,
cuts on the beat. The story is one sentence to an agent (or `self-host install`), then five quick swaps. Each swap flips a rented tile
into the Catalog App that replaces it, says what Setup did, and brings that App's row up in the Dashboard with its Address and Status.

## Timeline

| Time        | Scene   | Motion and content                                                                                                                                                                                                                                       |
| ----------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–3 s       | Hook    | “Replace the SaaS / you pay for.” lands in two gestures. Five rented tiles (Photos, Drive, Dropbox, a smart-home glyph, UptimeRobot) fly in dim behind it and lock one after another.                                                                    |
| 3–8 s       | Ask     | The six agents drop in. The chat types “Swap my subscriptions for apps I own.”; the plan lists the five Apps by Catalog category; the cursor clicks Approve & install; the `self-host install` command appears and the five Apps check.                   |
| 8–24 s      | Swaps   | The drop (beat 16): a diamond with a violet edge opens onto the Dashboard Overview, five Apps spinning. Five swaps of 3, 3, 3, 3 and 4 s: a rented tile lands, “Replaces …”, it flips to the App, its name and Setup result land, its row comes up. |
| 24–26 s     | Flurry  | The media cut's four phrases (“Your hardware.” … “Your data.”), one per beat, on the track's riser.                                                                                                                                                     |
| 26–30 s     | End     | The wordmark lands on the final hit, `curl -fsSL https://self-host.fyi/install \| bash` types, then **self-host.fyi** and “Or ask your agent.” A slow push and caret keep the card alive.                                                                |

The five swaps, in order, with what each row shows (`saas/data.js`):

| Rented                 | App            | Address               | Setup result shown | Status    |
| ---------------------- | -------------- | --------------------- | ------------------ | --------- |
| Google Photos          | Immich         | `192.168.1.20:2283`   | Admin created      | ok        |
| Dropbox                | Syncthing      | `192.168.1.20:8384`   | Web login set      | ok        |
| Google Drive           | Nextcloud      | `192.168.1.20:8080`   | Admin login ready  | ok        |
| cloud smart-home apps  | Home Assistant | `192.168.1.20:8123`   | Owner created      | attention |
| UptimeRobot            | Uptime Kuma    | `192.168.1.20:3001`   | none               | attention |

## Music and UI sound

The same track, “Let's Move” (see `audio/SOURCES.md`), re-cut for 15 bars in `saas/timeline.js`:

| Reel bars      | Source bars | Purpose                                                                        |
| -------------- | ----------- | ------------------------------------------------------------------------------ |
| 0–11 (0–24 s)  | 4–15        | Quiet intro lifted 8 dB under the hook and the ask; the drop at reel bar 4 (8 s) opens the swaps. |
| 12 (24–26 s)   | 35          | The track's biggest riser, under the flurry.                                   |
| 13–14 (26–30 s) | 48–49      | The final hit and ring-out, under the end card.                                |

139 cues come from the same `audio/sfx.mjs` kinds (typing, lock thocks, flips, pops, checks, whooshes, slams, impacts, success).

## Facts

Checked against the Catalog on 2026-10-14 (`self-host apps list --json` from a fresh build of `main`, `4a7d120c`: 89 Apps, 19 Recipes).

- Names, categories and default ports are the Catalog's: Immich (Photos, 2283), Syncthing (Files, 8384), Nextcloud (Files, 8080),
  Home Assistant (Home automation, 8123), Uptime Kuma (Monitoring, 3001). Addresses are the Home network ones at the reel's mock LAN address.
  The install command, `self-host install immich syncthing nextcloud home-assistant uptime-kuma`, uses the real App IDs.
- Setup follows `internal/apps`. Immich creates its first administrator through the API; Syncthing sets the web login through its REST
  API; Nextcloud verifies the administrator's sign-in and trusts the Project's Addresses.
- **Status is not ok for two of the five, and the cut says so.** `service.Level` gives a Manual step the Status *attention*. Uptime Kuma has
  no HTTP setup API, so its first administrator is a Manual step (`internal/apps/uptimekuma`). Home Assistant's Setup creates the owner, but
  the core-config, analytics and integration choices stay a Manual step (`internal/apps/homeassistant`). Their rows show yellow
  *attention* and “Finish in browser”, never ok. The runtime matrix (`docs/runtime-matrix.md`, an older head) records Uptime Kuma as manual.
- The agent flow follows `internal/skill/guide.md`: the plan names the Apps, the person approves, then the agent installs. The Approve click
  comes before the command (ADR 0005: loading the skill is never approval).
- Nextcloud is shown replacing Google Drive only. The Catalog's `files` Recipe says “replacing Google Drive, OneDrive and Dropbox”; it does not
  describe a Notion-style docs workspace (Docmost is the Catalog's notes App), so no docs claim is made. Smart-home is the generic “cloud
  smart-home apps”, not a named speaker: Home Assistant's trap notes say a smart-speaker experience needs separate hardware.
- No prices. The media cut's illustrative subscription totals are not reused.
- The end card repeats the media cut's installer line (`END_INSTALL`); the publication gate in the release notes above applies to this
  cut as well. UptimeRobot's icon is `assets/icons/uptimerobot.svg`, from the same dashboard-icons CDN as the other icons.

## Validation and reproduction

```sh
node render.mjs lint --cut saas
node render.mjs cues --cut saas
node audio/mix.mjs --cut saas
node render.mjs video --cut saas --workers 8 --sub 8
node render.mjs verify --cut saas
node audio/seams.mjs --cut saas
node render.mjs contact --cut saas
ffmpeg -y -i thumbs/v18-saasswaps-1280x720.png -q:v 3 ../../site/public/reel-saas.jpg   # after node thumbs/build.mjs
```

The lint contract is the media cut's, unchanged. `verify` reads a short edit's beat phase half a beat off (every cut reads exactly
-250 ms with the tempo right at 119.99 BPM), so the music's seams are measured directly by `audio/seams.mjs`.

### Verified render, 2026-10-14

- 1,800 frames at 60 fps, 1920×1080, H.264 High `yuv420p`, faststart; AAC 48 kHz stereo. Video, audio and container all measure 30.000
  seconds; 4.14 MB (4,136,368 bytes). Rendered in 57 s with eight workers and eight sub-frames.
- Integrated loudness −14.0 LUFS, true peak −1.6 dBTP, loudness range 6.6 LU. No flashes by the limited luminance scan (the drop opens as
  a violet-edged diamond, not a full-frame flood, for this reason).
- All 84 reading holds pass at 30 Hz, with no overlap, bounds, undeclared-text or terminology failures; the tightest are the flurry
  phrases at 0.41 s against 0.4 s. All 60 out-of-order and fresh-page seek samples pass (worst raster noise 79.6 dB PSNR).
- The music's three seams (the drop at 8 s, the riser at 24 s, the final hit at 26 s) land within 1.0 ms of the grid. Picture cuts sit on the
  0.5 s grid (lint). `verify`'s detected-phase beat offsets are not a valid measure for this edit, see above.
- The media cut renders byte-identical stills at 20 sampled times, its cue sheet is unchanged, and its full lint still passes (103 holds, 68 samples).
- Inspected stills at every scene boundary (hook→ask, ask→drop, each swap change, swaps→flurry→end), the drop's opening frames, and the 30-frame contact sheet.
- MP4 SHA-256: `cb323b328a45840810d52e2153e82dbb3491aaf25559d8d8e66b3540ce694b2c`; poster SHA-256: `bde9573f37ef0df8be22404d19af6d5be9e6c5e10a90288c374f994f90bd7fdf`.
