# Video work

Before changing the showreel, read [the handoff](reel/HANDOFF.md) for the approved baseline and
[the storyboard](reel/STORYBOARD.md) for direction, timing, factual sources and validation.

## Scope

Keep video source, documentation, assets and generated files inside `video/`. Work from `video/reel/`;
its package and lockfile own the renderer dependencies. Product code is reference material, not a
prerequisite for rendering. The terminal, dashboard and chat are deterministic mock-ups; use those
instead of connecting to a real Project or reading credentials.

## Change loop

1. Read the requested scene and its timing in `timeline.js`. Preserve the approved direction unless
   the request explicitly changes it. Check Git status and existing render processes before editing.
2. Make the focused change. Every pixel must follow `window.seek(t)`, including backwards and
   out-of-order seeks. Use the existing timeline, seeded randomness and per-frame functions; wall-clock
   timers and autonomous CSS animations break rendering. Register readable text with `read()` and
   sound effects with `cue()` beside their visual events.
3. Render affected stills and inspect them, including transition boundaries. Run the storyboard's
   lint workflow; completion means no readability, overlap, bounds, terminology or determinism failures.
   Adjust the composition or timing when these fail. Beat-event notes are informational.
4. For picture or sound changes, regenerate cues, mix audio and render. Inspect the final contact sheet
   and relevant motion sequences. Evaluate the verification report: `verify` reports measurements,
   so a zero exit status alone is not acceptance. Use the storyboard's output and loudness targets.
5. Update the storyboard when direction, timing, sound, claims or measured results change. Stage only
   owned files under `video/`. Commit/push to the requested feature branch; merge only when requested.

For documentation-only changes, validate links and the diff; a new video render is unnecessary.

## Asset and delivery rules

For music changes, read [audio provenance](reel/audio/SOURCES.md) before selecting or redistributing a
track. Keep source audio in the ignored `reel/audio/track/`; the downloader verifies the existing track.
For agent-logo changes, consult [logo provenance](reel/assets/agents/SOURCES.md).

Use `reel/out/` for temporary review frames, logs and chunks. The tracked deliverables are
`reel/out/selfhost-reel.mp4` and `reel/out/contact.png`; generated audio and intermediate renders stay
ignored. On requested iPhone delivery, run `tailscale file cp out/selfhost-reel.mp4 iphone:` from
`video/reel/` and check the command's own exit status, without piping through a filter.
