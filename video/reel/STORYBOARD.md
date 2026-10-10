# self-host showreel v2.1: 52.6 s storyboard

1920×1080 · 60 fps · H.264 `yuv420p` `+faststart` · AAC 192 kb/s stereo 48 kHz.
Every pixel is a pure function of `t` (`window.seek(t)`). Every sound is synthesised from the same timeline.
Palette from the TUI: accent `#7A57D3`, accentText `#A88DF2`, ok `#00D787`, fail `#FF5F5F`.
Type: Inter Tight, Unbounded, JetBrains Mono and Instrument Serif, all bundled through fontsource.

`timeline.js` holds the scene windows and music sections; the scenes, `render.mjs` and
`audio/synth.mjs` (through `audio/cues.json`) all read it.

## Shot list

| #   | Time        | Beat                            | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Music                                                                                  |
| --- | ----------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | 0.00–9.00   | **Hook and the rented wall**    | "Stop renting your software." lands word by word over eight drifting subscription tiles. The tiles snap into a wall: "Their servers.", each tile locks, and the meter counts to `$92 per month, rented`. The tiles flip to "Your servers.", each showing the Catalog App that replaces the service, labelled under its icon, with the original logo as a small badge in the corner. The meter runs down to `$0 per month, yours`. The tiles implode into the centre.                                                        | Build: pad swell, pulse bass, kick from 3 s, arps, snare build and riser               |
| 2   | 9.00–14.90  | **One command**                 | A violet diamond floods the frame (the lift) and `self-host` drops in letter by letter with an impact, then docks top-left. "One command. A whole _stack._" The command `self-host install media homarr` types out above the Compose Project box, which fills with seven App icons.                                                                                                                                                                                                                                         | Lift: full groove                                                                      |
| 3   | 14.40–18.60 | **Pre-boot**                    | The TUI's starfield opens from the icon row. "Let self-host do it." Seven rounded-square App tiles, each inside a matching rounded-square progress ring, fill one after another and tick green over a `Pulling images` bar. A warp rush hands over to the TUI.                                                                                                                                                                                                                                                              | Groove; checks chime up the scale; riser into the warp                                 |
| 4   | 18.50–22.10 | **Sets up every App.**          | The Activity view opens in a circle. One slow, small camera move (scale 1.00 → 1.08 over 3.1 s) while each App goes from `waiting` to `setting up` to `ready`. The camera pushes into the Links box.                                                                                                                                                                                                                                                                                                                        | Groove; a tick per App                                                                 |
| 5   | 22.00–28.10 | **Links them together.**        | Four Link cards build one by one. In each, a wire draws between the two Apps, a key chip (`••••`) travels from the App that owns the credential to the App being configured, and the receiving App ticks green. Then the card states what the Link did and which credential it used, masked.                                                                                                                                                                                                                                | Drive: brighter arps and melody                                                        |
| 6   | 28.00–31.10 | **Then builds your dashboard.** | The Homarr board rises in: seven App tiles, then the widgets the Homarr Links add (Downloads, Media server, Requests, Calendar, Indexers, Latest releases).                                                                                                                                                                                                                                                                                                                                                                 | Drive                                                                                  |
| 7   | 31.00–35.10 | **The pivot**                   | A wall of real CLI flags scrolls behind "Don't want to learn the _CLI?_", with the question mark in accentText purple.                                                                                                                                                                                                                                                                                                                                                                                                      | Breakdown: drums out, pad and plucks, reverb                                           |
| 8   | 35.00–46.70 | **Just ask your agent.**        | A strip of six agents, each with its logo, sits at the top; the active one lights up. The chat window's chrome (logo, name, accent colour) switches agent while the conversation continues: Claude Code (the request), Codex (`self-host skill`, `self-host apps list --json`), OpenChamber (the plan, and the click on Approve & install), Hermes Agent (`self-host install owned-video-library homarr --yes --json`, then "All set." with the dashboard URL), then OpenCode and Pi. All six light up together at the end. | Rebuild: half-time, filter opening, snare build and riser                              |
| 9   | 46.60–52.60 | **End card**                    | A circle opens from the dashboard URL onto a slow mosaic of Catalog icons. ◆ and `self-host` land with an impact; the install one-liner, `93 Apps · 20 Recipes · 1 binary` and the six agent names follow. From 48.2 s every element is still: the mosaic decelerates to rest and the grain fades out.                                                                                                                                                                                                                      | Payoff: impact, two bars of groove and melody, the final A minor add 9 chord rings out |

Transitions are match cuts or masks: imploding tiles → violet diamond; Compose icon row → starfield circle → icon row;
warp → TUI circle; TUI push into the Links box → Links wipe; circle → Homarr board; diamond → pivot; diamond → agents;
dashboard URL circle → end card. Camera shakes only on the two impacts (9.55 s and 47.0 s), settling before any hold.
There is no white flash anywhere: the old reel's end flash was a full-screen white overlay at 50 % opacity fired 0.55 s
into the end-card reveal (mean luma 39 → 128 at 23.38 s). The overlay is gone, and so is the product scene's 85 % flash.

## Readability holds

Every text meant to be read is declared with `read(el, from, to)` in its scene. `node render.mjs lint` fails when a
hold is shorter than **0.6 s + 0.3 s per word**, or when, sampled at 30 Hz through the hold, any word is below 32 px,
not fully opaque, overlapped by something that paints over it, off screen, outside the 56 px safe margin, changing text
or moving by more than 0.6 px. Words are counted as the viewer sees them (a visible gap or a line break separates
words). Every other visible text must sit under `[data-deco]` (TUI and Homarr mock-ups, the CLI flag wall, counters
and chrome subtitles) or lint fails on it too.

| Hold (s)    | Have ≥ need  | Text                                                                                                                                             |
| ----------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.15–3.05   | 1.90 ≥ 1.80  | Stop renting your software.                                                                                                                      |
| 3.80–5.35   | 1.55 ≥ 1.50  | per month, rented                                                                                                                                |
| 3.85–5.30   | 1.45 ≥ 0.90  | the eight service names and prices (Netflix $15/mo … ChatGPT $20/mo)                                                                             |
| 4.00–5.30   | 1.30 ≥ 1.20  | Their servers.                                                                                                                                   |
| 4.45–5.40   | 0.95 ≥ 0.90  | $92                                                                                                                                              |
| 5.90–8.66   | 2.76 ≥ 1.50  | per month, yours                                                                                                                                 |
| 6.00–8.66   | 2.66 ≥ 0.90  | $0                                                                                                                                               |
| 6.15–8.66   | 2.51 ≥ 1.20  | the eight replacements and their "yours" pills (the "Yours" state holds 2.5 s)                                                                   |
| 6.25–8.66   | 2.41 ≥ 1.20  | Your servers.                                                                                                                                    |
| 10.05–11.00 | 0.95 ≥ 0.90  | self-host (wordmark)                                                                                                                             |
| 11.55–14.30 | 2.75 ≥ 0.90  | self-host (docked)                                                                                                                               |
| 11.90–14.30 | 2.40 ≥ 1.20  | One command.                                                                                                                                     |
| 12.35–14.30 | 1.95 ≥ 1.80  | ◆ ~/.self-host · one Compose Project                                                                                                             |
| 12.40–14.30 | 1.90 ≥ 1.80  | $ self-host install media homarr                                                                                                                 |
| 12.45–14.30 | 1.85 ≥ 1.50  | A whole stack.                                                                                                                                   |
| 15.15–17.75 | 2.60 ≥ 0.90  | qBittorrent, Sonarr, Radarr, Prowlarr, Jellyfin, Seerr, Homarr                                                                                   |
| 15.40–17.75 | 2.35 ≥ 1.20  | Pulling images                                                                                                                                   |
| 15.55–17.45 | 1.90 ≥ 1.80  | Let self-host do it.                                                                                                                             |
| 19.25–21.60 | 2.35 ≥ 1.80  | Sets up every App.                                                                                                                               |
| 22.70–27.85 | 5.15 ≥ 1.50  | Links them together.                                                                                                                             |
| 22.90–27.85 | 4.95 ≥ 2.40  | Sonarr · qBittorrent · Adds qBittorrent as Sonarr's download client                                                                              |
| 23.50–27.85 | 4.35 ≥ 2.70  | Prowlarr · Sonarr · Radarr · Syncs Prowlarr's indexers to Sonarr and Radarr                                                                      |
| 24.00–27.85 | 3.85 ≥ 1.20  | Admin login ••••••                                                                                                                               |
| 24.10–27.85 | 3.75 ≥ 2.70  | Seerr · Sonarr · Radarr · Sends your requests to Sonarr and Radarr                                                                               |
| 24.60–27.85 | 3.25 ≥ 1.50  | Their API keys ••••••                                                                                                                            |
| 24.70–27.85 | 3.15 ≥ 3.00  | Homarr · Jellyfin · Adds a Jellyfin tile and widgets to Homarr                                                                                   |
| 25.20–27.85 | 2.65 ≥ 1.50  | Their API keys ••••••                                                                                                                            |
| 25.80–27.85 | 2.05 ≥ 1.50  | Jellyfin API key ••••••                                                                                                                          |
| 28.75–30.90 | 2.15 ≥ 1.80  | Then builds your dashboard.                                                                                                                      |
| 32.30–34.80 | 2.50 ≥ 2.40  | Don't want to learn the CLI?                                                                                                                     |
| 35.95–46.55 | 10.60 ≥ 1.20 | Claude Code · Codex · OpenChamber · Hermes Agent · OpenCode · Pi (strip)                                                                         |
| 36.20–46.55 | 10.35 ≥ 1.80 | Just ask your agent.                                                                                                                             |
| 36.75–41.95 | 5.20 ≥ 3.30  | I want to watch my movies on the TV.                                                                                                             |
| 36.85–46.55 | 9.70 ≥ 1.80  | One skill. Every agent.                                                                                                                          |
| 37.40–41.95 | 4.55 ≥ 1.80  | $ self-host skill ✓ guide loaded                                                                                                                 |
| 37.85–41.95 | 4.10 ≥ 2.40  | $ self-host apps list --json ✓ 20 Recipes                                                                                                        |
| 38.80–41.95 | 3.15 ≥ 1.20  | ◆ The plan                                                                                                                                       |
| 39.26–41.95 | 2.69 ≥ 2.10  | Recipe owned-video-library · Dashboard Homarr · Exposure Local network only · Admin login Generated for you                                      |
| 39.60–40.84 | 1.24 ≥ 1.20  | Approve & install                                                                                                                                |
| 39.60–41.95 | 2.35 ≥ 0.90  | Change                                                                                                                                           |
| 41.01–41.95 | 0.94 ≥ 0.90  | Approved ✓                                                                                                                                       |
| 36.05–46.55 | ≥ 0.9 each   | chat header: Claude Code 36.05–37.30, Codex 37.45–38.50, OpenChamber 38.65–41.30, Hermes Agent 41.45–44.25, OpenCode 44.40–45.35, Pi 45.50–46.55 |
| 42.75–46.55 | 3.80 ≥ 1.80  | $ self-host install owned-video-library homarr --yes --json                                                                                      |
| 43.95–46.55 | 2.60 ≥ 2.40  | All set. Your dashboard is ready. / Admin login: self-host credentials                                                                           |
| 44.15–46.55 | 2.40 ≥ 0.90  | http://192.168.1.20:7575                                                                                                                         |
| 47.80–52.60 | 4.80 ≥ 0.90  | self-host                                                                                                                                        |
| 47.90–52.60 | 4.70 ≥ 1.80  | $ curl -fsSL https://raw.githubusercontent.com/ajnart/selfhost-skills/main/new-cli/install.sh \ \| bash                                          |
| 48.05–52.60 | 4.55 ≥ 2.40  | 93 Apps · 20 Recipes · 1 binary                                                                                                                  |
| 48.20–52.60 | 4.40 ≥ 3.00  | Claude Code · Codex · OpenChamber · Hermes Agent · OpenCode · Pi                                                                                 |

The end card is fully still from 48.2 s to 52.6 s (4.4 s).

## Facts on screen, and where they come from

- **93 Apps, 20 Recipes:** `self-host apps list --json` from a binary built from `new-cli/` (93 `apps`, 20 `recipes`).
- **Replacements:** each pairing matches the App's Catalog description. Netflix → Jellyfin, Spotify → Navidrome,
  Drive → Nextcloud (the `files` Recipe replaces Google Drive and Dropbox), Dropbox → Syncthing ("keeps folders in
  sync between your own devices"), Google Photos → Immich, 1Password → Vaultwarden, Notion → Docmost,
  ChatGPT → Open WebUI.
- **Links:** `new-cli/internal/apps/arr/links.go` (Sonarr and Radarr add qBittorrent as their download client with
  the Admin login; Prowlarr syncs indexers to Sonarr and Radarr with their API keys), `apps/seerr/seerr.go`
  (Seerr sends requests to Sonarr and Radarr with their API keys) and `apps/homarr/links.go` (Homarr adds a Jellyfin
  app tile, an integration holding its API key, and its widgets).
- **Agent demo:** `new-cli/internal/skill/guide.md`, "Two kinds of users": for a new user who wants to watch movies
  they own, recommend `owned-video-library` plus `homarr` (not `media`, which also requests and downloads), show the
  plan, get approval, run `self-host install <recipe> --yes --json`, and point to `self-host credentials` rather than
  pasting the login.
- **Install line:** `new-cli/install.sh` on `main`, as in the README.
- **Agent logos:** `assets/agents/SOURCES.md`.

## Sound

`audio/synth.mjs` writes `audio/out/soundtrack.wav` from `audio/cues.json` (written by `node render.mjs cues`).
Everything is synthesised in the script: band-limited saw and square oscillators, sine kicks and bells, seeded noise,
RBJ biquad filters, a ping-pong delay and a Freeverb-style reverb. There are no samples and no third-party music.

- **Music (120 BPM, A minor):** Am–F–C–G. Build 0–9 s, lift 9 s, drive 22 s (with a lead motif from 17 s),
  breakdown 31 s, rebuild 35 s, payoff 47 s, and a final A minor add 9 chord ringing out under the still end card.
- **Sound design:** whooshes on every mask transition, a suck into the implode, a boom on the violet flood, impacts on
  both wordmarks, a key click per typed character, thumps on headline words, locks, a card-flip flurry, pops, chimes
  on checkmarks that climb the scale, zips and a passing key on the Link cards, switch swipes between agents, a mouse
  click on Approve, a success chime, and risers into the warp, the agents and the end card.
- **Mix:** kick sidechain on bass and pads; mastered by measurement (ffmpeg `ebur128`) to −14 LUFS integrated with a
  look-ahead limiter under −1 dBTP.
