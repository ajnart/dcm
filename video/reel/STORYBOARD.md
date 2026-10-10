# self-host showreel v3: 16 bars, 32 s, locked to the beat

1920×1080 · 60 fps · H.264 `yuv420p` `+faststart` · AAC 192 kb/s stereo 48 kHz.
Every pixel is a pure function of `t` (`window.seek(t)`). The music is "Let's Move" by Michael Ramir C.
(Mixkit Stock Music Free License; see `audio/SOURCES.md`), cut on its own bar lines.
Palette from the TUI: accent `#7A57D3`, accentText `#A88DF2`, ok `#00D787`, fail `#FF5F5F`.
Type: Inter Tight, Unbounded, JetBrains Mono and Instrument Serif, bundled through fontsource.

`timeline.js` holds the grid (120 BPM: a beat is 0.5 s, a bar 2 s, reel time 0 is a downbeat), the scene
windows and the edit of the track. The scenes, `render.mjs` and `audio/mix.mjs` (through `audio/cues.json`)
all read it.

## Direction

Flat UI, crisp motion. Entrances are masks and expo-out moves of 0.2 s (0.08 s in the flurry); scene changes
are hard cuts, a diamond, a circle or a match cut, always on a beat. There is no bouncy or overshooting ease,
no particle or warp burst, no glow, bloom or text shadow, no gradient on any panel, bar or button, no grain
or vignette. The UI glyphs the reel draws (lock, key, check) share one 2 px round stroke. Between beats
nothing drifts: things move on the beat and then sit still.

## The edit (`timeline.js` `EDIT`, built by `audio/mix.mjs`)

| Reel bars       | Source bars (start) | What the music does                                     |
| --------------- | ------------------- | ------------------------------------------------------- |
| 0-2 (0-6 s)     | 5-7 (10.03 s)       | the intro build, lifted 8 dB, hats rising into the drop |
| 3-8 (6-18 s)    | 8-13 (16.03 s)      | the drop on reel bar 3, then the full groove            |
| 9-12 (18-26 s)  | 15-18 (30.03 s)     | the fill, then the louder second section                |
| 13 (26-28 s)    | 35 (70.03 s)        | the track's brightest riser                             |
| 14-15 (28-32 s) | 48-49 (96.03 s)     | the final hit and its ring-out, to silence              |

Each cut starts 6 ms before the bar's attack with a 4 ms equal-power crossfade. `mix.mjs` measures the grid
from the audio on every run (`audio/analyze.mjs`: 119.997 BPM, first downbeat 0.0297 s, 181 attacks fitted,
3.8 ms RMS).

## Bar and beat map

Beat numbers count from 0 inside each bar. "Cut" marks a picture cut on that beat.

| Bar | Time  | Beat 1                                                                                   | Beat 2                                                                       | Beat 3                                                                                                                        | Beat 4                                                                |
| --- | ----- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 0   | 0-2   | Cut. "Stop"                                                                              | "renting"                                                                    | "your _software._"                                                                                                            | eight dark subscription tiles fly in from the edges                   |
| 1   | 2-4   | their prices pop                                                                         | the tiles step inward                                                        | the headline exits, the tiles snap into a wall: "Their servers."                                                              | row 1 locks, the meter counts to $49                                  |
| 2   | 4-6   | row 2 locks: `$92 per month, rented`                                                     | a red line strikes "Their servers."                                          | the tiles flip: "Your servers.", each Catalog App that replaces the service, "yours"; the meter runs to `$0 per month, yours` | each tile shows the service it replaced as a small badge              |
| 3   | 6-8   | Cut. **The drop:** a violet diamond floods the frame, `self-host` rises letter by letter | the violet collapses into the ◆ mark                                         | the lockup docks top-left, "One command."                                                                                     | `self-host install media homarr` types                                |
| 4   | 8-10  | enter; "A whole _stack._"; the Compose Project box draws                                 | four Apps land in it                                                         | three more                                                                                                                    | the box opens into the TUI window                                     |
| 5   | 10-12 | Cut (match). The TUI Activity view, "Sets up every App."                                 | Apps go ready, one per eighth note                                           | …                                                                                                                             | the camera pushes into the Links box                                  |
| 6   | 12-14 | Cut. "Links them together." Sonarr → qBittorrent card                                    | Prowlarr card; wire 1 draws, the key travels                                 | Seerr card; wire 2                                                                                                            | Homarr card; wire 3; card 1 ticks                                     |
| 7   | 14-16 | wire 4; card 2 ticks                                                                     | card 3 ticks                                                                 | card 4 ticks                                                                                                                  | the counter turns green: 4 of 4 linked                                |
| 8   | 16-18 | Cut (circle). The Homarr board and its seven App tiles, "Builds your dashboard."         | the large widgets                                                            | the small widgets                                                                                                             | Cut. "Don't want to learn"… "the _CLI?_" on the off-beat              |
| 9   | 18-20 | the wall of real CLI flags steps sideways                                                | steps                                                                        | steps                                                                                                                         | steps                                                                 |
| 10  | 20-22 | Cut. Six agent logos, "Just ask your agent.", the chat in Claude Code                    | the request: "I want to watch my movies on the TV."                          | Codex: `self-host apps list --json`                                                                                           | ✓ 20 Recipes; the plan lands with Approve & install                   |
| 11  | 22-24 | OpenChamber; the cursor reaches Approve                                                  | click: Approved; `self-host install owned-video-library homarr --yes --json` | Hermes Agent; both Apps tick                                                                                                  | "All set.", the dashboard URL, "Admin login: `self-host credentials`" |
| 12  | 24-26 | OpenCode                                                                                 | the cursor opens the dashboard link                                          | Pi                                                                                                                            | all six agents light up                                               |
| 13  | 26-28 | Cut. **"Your hardware."**                                                                | Cut. **"Your rules."**                                                       | Cut. **"No rent."**                                                                                                           | Cut. **"Your data."** (the bar under them fills a quarter per beat)   |
| 14  | 28-30 | Cut on the final hit: ◆ **self-host**                                                    | the install one-liner                                                        | the six agents                                                                                                                | `93 Apps · 20 Recipes · 1 binary`                                     |
| 15  | 30-32 | still                                                                                    | still                                                                        | still                                                                                                                         | still                                                                 |

The end card holds 4 s (bars 14-15) on the final hit and its ring-out, and every element is still from
29.7 s. The flurry sits on the track's brightest riser and builds into the logo on the next downbeat.

## Lint (`node render.mjs lint`)

- **The beat.** Every beat up to the end card's still hold (29.7 s) has a declared event (`on()`/`cut()` in
  `lib.js`) and changes at least 0.2 % of the frame between 30 ms before and 200 ms after it. Every cut, sound
  cue and event sits on the 0.5 s grid.
- **Readability.** Every text meant to be read is declared with `read(el, from, to)`. A sentence must hold
  0.4 s + 0.25 s per word after it has landed; a phrase of one to three words may hold a single beat, which
  leaves it 0.4 s still after its 0.1 s entrance. Sampled at 30 Hz through the hold, no word may be under 32 px,
  less than fully opaque, overlapped, off screen, outside the 56 px safe margin, changing text or moving by
  more than 0.6 px. Every other visible text sits under `[data-deco]` (the TUI and Homarr mock-ups, the flag
  wall, the meter while it counts, spinners) or lint fails on it.
- **Retired wording.** No rendered text, at any time, contains "Exposure" (now Access) or "new-cli/". The real
  `--exposure` flag in the flag wall is lower case and stays.
- **Determinism.** Frames revisited out of order and on a fresh page must match (30 dB PSNR floor).

| Hold (s)    | Have ≥ need | Text                                                                                                  |
| ----------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| 1.20-3.00   | 1.80 ≥ 1.40 | Stop renting your software.                                                                           |
| 3.20-4.99   | 1.79 ≥ 0.40 | Their servers.                                                                                        |
| 3.34-4.88   | 1.54 ≥ 0.40 | the eight service names and prices (Netflix $15/mo … ChatGPT $20/mo)                                  |
| 4.08-4.99   | 0.91 ≥ 0.40 | $92 · per month, rented (3.70-4.99)                                                                   |
| 5.20-5.99   | 0.79 ≥ 0.40 | Your servers. · per month, yours · $0 (5.31-5.99)                                                     |
| 5.36-5.99   | 0.63 ≥ 0.40 | the eight replacements and their "yours" pills                                                        |
| 6.38-6.99   | 0.61 ≥ 0.40 | self-host (wordmark)                                                                                  |
| 7.20-9.49   | 2.29 ≥ 0.40 | One command.                                                                                          |
| 7.88-9.49   | 1.61 ≥ 1.40 | $ self-host install media homarr                                                                      |
| 8.20-9.49   | 1.29 ≥ 0.40 | A whole stack. · ◆ one Compose Project                                                                |
| 10.20-11.99 | 1.79 ≥ 1.40 | Sets up every App.                                                                                    |
| 12.20-15.99 | 3.79 ≥ 1.90 | Adds qBittorrent as Sonarr's download client (and its names and key)                                  |
| 12.70-15.99 | 3.29 ≥ 2.15 | Syncs Prowlarr's indexers to Sonarr and Radarr                                                        |
| 13.20-15.99 | 2.79 ≥ 2.15 | Sends your requests to Sonarr and Radarr                                                              |
| 13.70-15.99 | 2.29 ≥ 2.15 | Adds Jellyfin's tile and widgets to Homarr                                                            |
| 12.20-15.99 | 3.79 ≥ 0.40 | Links them together.                                                                                  |
| 16.20-17.49 | 1.29 ≥ 0.40 | Builds your dashboard.                                                                                |
| 17.95-19.99 | 2.04 ≥ 1.90 | Don't want to learn the CLI?                                                                          |
| 20.26-25.99 | 5.73 ≥ 1.40 | Just ask your agent. · One skill. Every agent. (20.76) · the six agent names                          |
| 20.70-25.99 | 5.29 ≥ 2.65 | I want to watch my movies on the TV.                                                                  |
| 21.20-25.99 | 4.79 ≥ 1.40 | self-host apps list --json · 20 Recipes (21.65)                                                       |
| 21.70-25.99 | 4.29 ≥ 1.40 | The plan: Recipe owned-video-library · Dashboard Homarr · Access Home network                          |
| 21.70-22.49 | 0.79 ≥ 0.40 | Approve & install, then Approved (22.50-25.99)                                                        |
| 22.70-25.99 | 3.29 ≥ 1.40 | $ self-host install owned-video-library homarr --yes --json                                           |
| 23.70-25.99 | 2.29 ≥ 1.40 | All set. · http://192.168.1.20:7575 · Admin login: self-host credentials                              |
| each 0.41   | 0.41 ≥ 0.40 | Your hardware. · Your rules. · No rent. · Your data.                                                  |
| 28.70-32.00 | 3.30 ≥ 1.40 | $ curl -fsSL https://raw.githubusercontent.com/ajnart/selfhost-skills/main/install.sh \| bash            |
| 29.20-32.00 | 2.80 ≥ 2.40 | Claude Code · Codex · OpenChamber · Hermes Agent · OpenCode · Pi                                      |
| 29.70-32.00 | 2.30 ≥ 1.90 | 93 Apps · 20 Recipes · 1 binary                                                                       |

Each agent's name in the chat header holds its two beats (Pi: 25.00-25.99).

## Facts on screen, and where they come from

- **93 Apps, 20 Recipes:** `self-host apps list --json` from a binary built from `origin/main` (repository root) on 2026-10-10
  (93 `apps`, 20 `recipes`).
- **Replacements:** each pairing matches the App's Catalog description. Netflix → Jellyfin, Spotify → Navidrome,
  Drive → Nextcloud (the `files` Recipe replaces Google Drive and Dropbox), Dropbox → Syncthing, Google Photos →
  Immich, 1Password → Vaultwarden, Notion → Docmost, ChatGPT → Open WebUI. Prices are the ones the previous cut
  showed; their sum, $92, is what the meter counts.
- **Links:** `internal/apps/arr/links.go` (Sonarr and Radarr add qBittorrent as their download client
  with the Admin login; Prowlarr syncs indexers to Sonarr and Radarr with their API keys), `apps/seerr/seerr.go`
  (Seerr sends requests to Sonarr and Radarr with their API keys) and `apps/homarr/links.go` (Homarr adds a
  Jellyfin app tile, an integration holding its API key, and its widgets).
- **Agent demo:** `internal/skill/guide.md`, "Every conversation": pick the Recipe or Apps from `self-host apps list`,
  show the plan in goals and Apps, get approval, run `self-host install <app|recipe>... --yes --json`, and point to
  `self-host credentials` rather than pasting the login. Both `owned-video-library` and `homarr` are in the Catalog
  on `main`. Access is shown as "Home network" (the default, stored as `EXPOSURE=lan`; `CONTEXT.md`, Access).
- **Install line:** `install.sh` at the repository root on `main`, as in the README. The repository name lives in one
  constant, `END_INSTALL` in `end.js`, so the planned rename to `ajnart/selfhost` is a one-line change.
- **Agent logos:** `assets/agents/SOURCES.md`.

## Sound

`node render.mjs cues` writes `audio/cues.json`; `node audio/mix.mjs` fetches and verifies the track, builds the
edit above, adds nine short synthesised UI sounds, all on beats (two lock thocks at 3.5 and 4.0 s, the flip at
5.0 s, the enter key at 8.0 s, four soft ticks as the Links go green, the click on Approve at 22.5 s), and
masters to -14 LUFS integrated under -1 dBTP with a look-ahead limiter, by measurement (ffmpeg `ebur128`).

## Checks on the final MP4 (`node render.mjs verify`)

Streams and durations, loudness, a frame-by-frame luminance scan (Rec. 709 mean luma; a flash is a pair of
opposing changes of 20+ levels within 0.5 s) and beat sync (the picture cuts in `cues.json` against the beat
grid detected in the MP4's own audio).
