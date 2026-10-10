# Soundtrack source

| Field        | Value                                                                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Title        | Let's Move                                                                                                                                      |
| Artist       | Michael Ramir C.                                                                                                                                |
| Publisher    | Mixkit (Envato), item 836, genre EDM, 1:41                                                                                                      |
| Page         | https://mixkit.co/free-stock-music/house/ (Mixkit has no per-track page; the track is listed here, and under the EDM, Driving and Fashion tags) |
| Download URL | https://assets.mixkit.co/music/836/836.mp3 (the URL Mixkit's own download dialog, `/free-stock-music/download/836/`, starts)                    |
| SHA-1        | `3d3cdda4224877867b9af506a5d3a5c12ea63b8f` (the file the earlier attempt left in `audio/track/` is byte-identical)                              |
| Licence      | Mixkit Stock Music Free License: https://mixkit.co/license/#musicFree (text served from https://mixkit.co/license/modal/musicFree/)             |
| User terms   | https://mixkit.co/terms/ (last revised October 2, 2025)                                                                                         |
| Checked      | 2026-10-10                                                                                                                                      |

## What the licence allows, and how the reel complies

The licence text, as read on 2026-10-10:

> Items under the Mixkit Stock Music Free License can be used in your commercial and non-commercial projects
> for free. You're permitted to download, copy, modify, distribute and publicly perform the Music Items on any
> web or social media platform, including internet-based video on demand services, podcasts and
> advertisements. You're not allowed to use them in CDs or DVDs, video games or tv or radio broadcast. You're
> also not allowed to remix them (or incorporate in a music-only track), claim them as your own or register
> them on any rights management service.

- **Commercial use in an online video:** allowed. **Attribution:** not required by the licence; this file
  records the source anyway.
- **Not a remix:** the reel uses the recording as published. `audio/mix.mjs` only cuts it on its own bar
  lines (source bars 5-13, 15-18, 35 and 48-49), lifts the quiet intro by 8 dB for the hook, places a few short
  synthesised UI sounds on beats, and sets the level. Nothing is added to the music itself and it never stands
  alone as a music-only track.
- **No redistribution of the file:** the user terms forbid making an Item available to third parties other than
  as the licence contemplates. So the MP3 is **not committed**: `audio/track/` is git-ignored. `node audio/mix.mjs`
  downloads it from the URL above into `audio/track/lets-move.mp3` when it is missing and refuses to continue
  unless its SHA-1 matches.
- **Not allowed:** CDs or DVDs, video games, TV or radio broadcast. Do not use the reel there without replacing
  the track. If a platform raises a content claim, Mixkit asks that it be forwarded to team@mixkit.co.

## Measured grid

`node audio/analyze.mjs audio/track/lets-move.mp3 --bars`: 119.997 BPM (beat 0.500013 s), first downbeat at
0.0297 s, 181 attacks fitted with 3.8 ms RMS residual (worst 7.3 ms). The drop is source bar 8 (16.03 s,
+15 dB); the brightest riser is bar 35 (70.03 s); the final hit is bar 48 (96.03 s), ringing out by bar 49.
`mix.mjs` re-measures the grid from the audio on every run rather than trusting these numbers.
