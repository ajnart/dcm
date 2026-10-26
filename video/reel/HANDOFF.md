# Showreel handoff

## Approved baseline

The maintainer approved **v5**: “perfect … I really like what it looks like now.” There is no pending
creative revision. Preserve this cut as the starting point for subsequent requests.

- Branch: `feat/showreel-v2`.
- Review: [PR #190](https://github.com/ajnart/self-host/pull/190), merged on 2026-10-11.
- Implementation: `de8e68ca`; concurrent Access terminology integration: `3d7546ab`.
- Delivered MP4: `out/selfhost-reel.mp4`; review sheet: `out/contact.png`.
- Taildrop of the approved cut to `iphone:` succeeded.

Both commits and deliverables were pushed before this handoff. Check live Git/PR state before the
next change; the branch may have advanced. All video work belongs under `video/`.

## What the approval means

V4 had become too static and marketing-oriented. V5 restores camera movement, grouped entrances,
animated transitions and UI effects mixed with the licensed music. Its technical style uses two fonts,
sharp corners and restrained command colours. Setup has a longer reading window, the Compose Project
icons fit inside their card, and the flurry uses dynamic compositions rather than a progress bar.

The detailed direction and 34-second scene map live in [STORYBOARD.md](STORYBOARD.md). The older
strict “something on every beat” and banned-animation brief is superseded by the approved v5 direction.
Keep reading holds meaningful while allowing controlled movement.

The approved v5 end command was **`npx selfhost install`**, specifically requested by the maintainer
as a preview of the planned npm installer. The later canonical-domain request supersedes that copy:
the current release candidate uses **`curl -fsSL https://self-host.fyi/install | bash`** and
shows the repository, **`github.com/ajnart/self-host`**. The approved motion, music
and other product copy are unchanged.
Catalog counts and product behaviour should be rechecked before changing those claims. Provenance is
recorded in the storyboard and asset source files.

## Canonical-domain release candidate

This revision is not a new creative approval. The source repository is **`ajnart/self-host`**, public
since 2026-10-26, which is the repository the end card names. The anonymous installer and release
binaries passed on a clean machine on 2026-10-26
([issue #295](https://github.com/ajnart/self-host/issues/295));
[issue #193](https://github.com/ajnart/self-host/issues/193) tracks distribution decisions. Do not
publish the raw music.
[Issue #268](https://github.com/ajnart/self-host/issues/268) tracks the reel's publication checks.
The corrected candidate's artifact measurements are recorded in the storyboard, separately from
approved v5 and the earlier canonical-domain render.

No release URL was found in the existing self-host OpenChamber scheduled task. Its Claude harness
retry instructions and model selection were left unchanged, as were the repository workflows.

## Where to work

| Change                                     | Start here                                                  |
| ------------------------------------------ | ----------------------------------------------------------- |
| Duration, scene boundaries, music sections | `timeline.js`                                               |
| One scene                                  | Its named module, e.g. `setup.js`, `agents.js`, `flurry.js` |
| Typography, corners, layout                | `styles.css`, `index.html`                                  |
| Shared animation, reading holds, cues      | `lib.js`; registration and runtime checks in `main.js`      |
| Music balance and mastering                | `audio/mix.mjs`                                             |
| Synthesised UI sounds                      | `audio/sfx.mjs`                                             |
| Track tempo and downbeat analysis          | `audio/analyze.mjs`                                         |
| Rendering, stills, lint, verification      | `render.mjs`                                                |

Read `package.json` for current dependencies and scripts. The project is JavaScript and has no
configured TypeScript typecheck. The existing renderer requires Node, the installed Playwright Chromium
browser, and `ffmpeg`/`ffprobe`; fonts are bundled through the local dependencies.

## Rendering gotchas

- Run commands from `video/reel/`. Rebuild `audio/cues.json` after changing scene timing, typed text or
  cue registrations; rebuild the soundtrack before rendering the MP4.
- Chunks are cached under `out/chunks-*`. The cache hash excludes `render.mjs` and audio. Renderer or
  frame-sampling changes require `video --fresh`; audio-only changes can reuse picture chunks and remux.
- Keep a single final render writing the deliverable at a time. Check for an existing process before
  starting another, especially when resuming a session.
- `scene()` visibility and all per-frame state must recover after arbitrary seeks. A forward playback
  looking correct does not establish determinism; the lint explicitly revisits frames out of order.
- Slow drift is allowed during reading holds. Short entrances must finish before the declared hold;
  the approved cut needed fixes for the hook, replacement names and the approval-button press.
- `verify` prints a report rather than enforcing every acceptance target. Inspect matching stream
  durations, resolution/fps, loudness and peaks, luminance findings and beat offsets. Its average-luma
  scan is limited; also inspect rapid transitions visually.
- Contact sheets sample once per second and can land exactly on an entrance. Use targeted stills
  around a suspected transition before treating a blurred or empty contact-sheet cell as a defect.

## Last verification

The approved file is 34.000 seconds, 2,040 frames, 1920×1080 at 60 fps, about 7.62 MB. Audio is
−13.9 LUFS integrated with −1.8 dBTP peak. All 102 reading holds and deterministic-seek checks passed;
the automated luminance scan detected no flashes. Seventeen picture cuts were within 1.10 ms of
the detected beat. These are measurements of v5, not guaranteed properties of future renders.

The concurrent branch update added a check for retired rendered wording. It was retained and rerun:
zero occurrences of “Exposure” or obsolete `new-cli/` paths. The background's real lowercase
`--exposure` flag remains valid. Repository validation passed all 12 checks.

Follow [../AGENTS.md](../AGENTS.md) for the change and delivery workflow, and the storyboard for
reproduction commands. Refresh this handoff when a new cut becomes the approved baseline.
