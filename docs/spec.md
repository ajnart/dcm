# Spec: self-host, a single-binary TUI for self-hosting Apps

Vocabulary: `CONTEXT.md`. Decisions: `docs/adr/`. Design notes: `PLAN.md`.

## Problem Statement

Self-hosting a useful set of apps (a media server, a password manager,
notifications) means installing Docker, writing Compose files, choosing
images, fixing file ownership and time zones, then clicking through every
app's first-run wizard and wiring apps to each other by copying API keys
around. The previous `self-host` tool tried to automate this but is about
60k lines of TypeScript, needs a private repo, Bun, Node and an npm tarball
to install, and every app is a small bespoke program that an agent cannot
extend. When something breaks, nobody (human or agent) can tell quickly
what is running, what is reachable, what failed, or what to do next.

## Solution

`self-host` is one static binary installed with a single `curl | bash` line.
Running it with no arguments opens a full-screen terminal dashboard, in the
spirit of the Homarr developer CLI: a live table of the Project's Apps with
coloured health dots, a health pill summarising the doctor checks, an
updates badge, a sidebar with logs and Setup results, and many keybinds.
(Superseded by docs/adr/0002: one Dashboard with persistent panels and a
fixed set of keybinds; the screens, sidebar and tasks overlay below are gone.)
On a fresh host the same TUI walks the user through choosing a Recipe or
Apps, Host settings and an Admin login, then installs and runs headless
Setup with live progress.

Every action is also a plain subcommand with human or `--json` output, so
an agent can drive the whole lifecycle, read exactly what happened, and,
when automatic Setup cannot finish, take over with agent-browser using the
hint, URL and credential name the CLI gives it. `self-host skill` prints a
version-matched guide for agents.

## User Stories

### Install and first run

1. As a home-server owner, I want to install the tool with one `curl | bash` line, so that I do not need Node, Bun, npm or a source checkout.
2. As a home-server owner, I want the installer to verify the binary checksum, so that I know the download was not tampered with.
3. As a non-root user, I want the binary installed to `~/.local/bin`, so that I do not need sudo just to install it.
4. As a root user, I want the binary installed to `/usr/local/bin`, so that it is on every user's path.
5. As a user, I want `self-host --version` to print the version, so that I can report it when asking for help.
6. As a user without Docker, I want the tool to tell me Docker is missing and link to the official install docs (OrbStack on macOS), so that I know exactly what to do.
7. As a user whose Docker socket is not accessible, I want a clear message linking to the Docker post-install docs, so that I can fix permissions myself.
8. As a user with Docker but Compose v1 only, I want the tool to say Compose v2 is required, so that I do not get confusing errors later.
9. As a rootless-Docker or OrbStack user, I want the tool to use my active Docker context, so that it works without special flags.
10. As a user running under sudo, I want my Project created in my own home and files owned by me, so that nothing ends up owned by root.

### First-run wizard (TUI)

11. As a new user, I want the TUI to detect that no Project exists and start the setup wizard, so that I am guided from zero.
12. As a new user, I want to see the host checks (Docker, Compose, socket, disk space) as green/yellow/red dots before anything is installed, so that I trust the machine is ready.
13. As a new user, I want to choose Exposure (local network by default, or this machine only), so that I decide who can reach my Apps.
14. As a new user, I want detected Host settings (time zone, user/group IDs, umask, LAN IP) pre-filled and editable, so that Apps get correct file ownership and clocks.
15. As a new user, I want to enter my media and downloads folders with validation that they exist, so that media Apps are wired to the right place.
16. As a new user, I want to choose a Recipe (e.g. Media) or pick individual Apps with a filterable multi-select, so that I install exactly what I want.
17. As a new user, I want Homarr pre-selected but optional, so that I get a dashboard by default without being forced to.
18. As a new user, I want to type my own Admin login or let the tool generate one, so that I have one login for every App.
19. As a new user, I want App-specific inputs asked only for the Apps I selected, so that the wizard stays short.
20. As a new user, I want a review screen listing Apps, images, ports, Exposure, Host settings and Links that will be made, so that I approve exactly what will happen.
21. As a new user, I want to see live install progress per App and per Setup step, with a native terminal progress bar, so that I know it is not stuck.
22. As a new user, I want a recap at the end with every App's URL on my LAN IP and its Setup result, so that I can start using them immediately.

### Dashboard (TUI)

23. As a returning user, I want `self-host` to open a dashboard of my Project, so that I see everything at a glance.
24. As a user, I want each App row to show a coloured dot (green running and healthy, yellow starting or Setup incomplete, red stopped, unhealthy or failed), so that problems stand out.
25. As a user, I want each App row to show its URL, port, container state, health and Setup result, so that I do not need to run separate commands.
26. As a user, I want a health pill in the header that summarises the doctor checks as a green, yellow or red dot with a count, so that I know at a glance if the host is healthy.
27. As a user, I want a `⚠ N updates` badge in the header when newer images exist, so that I know when to update.
28. As a user, I want an Updates screen listing which Apps have newer images, so that I can update one or all.
29. As a user, I want a Doctor screen listing every check with its dot, details and fix hint, so that I can diagnose problems myself.
30. As a user, I want a Catalog screen to browse and add Apps and Recipes to my existing Project, so that I can grow my setup.
31. As a user, I want a Backups screen to create a Backup and restore one App or all, so that I can protect my configuration.
32. As a user, I want a sidebar showing the selected App's live container logs, so that I can see errors without leaving the TUI.
33. As a user, I want a sidebar tab showing the selected App's Setup steps and hints, so that I can see what was configured and what failed.
34. As a user, I want a sidebar tab showing the selected App's info (image, ports, folders, Links, credential names), so that I know how it is configured.
35. As a user, I want to filter the App table with `/`, so that I can find Apps quickly in a large Project.
36. As a user, I want keybinds to start/stop, restart, update, rerun Setup, remove, open in browser, and copy the URL or password, so that I can operate everything from the keyboard.
37. As a user, I want `?` to show a help overlay listing every keybind for the current screen, so that I can learn the tool.
38. As a user, I want a footer showing the most useful keybinds for the current context, so that I do not have to memorise them.
39. As a user, I want long actions (install, update, backup) to run as background tasks that I can watch in a tasks overlay and cancel, so that the dashboard stays responsive.
40. As a user, I want destructive actions (remove, purge, restore) to ask for confirmation in a dialog, so that I do not lose data by accident.
41. As a user, I want the dashboard to refresh automatically on an interval and when the terminal regains focus, so that what I see is current.
42. As a user, I want mouse clicks to select rows and switch tabs, so that I can use the TUI without memorising keys.
43. As a user, I want the TUI to adapt colours to light or dark terminals, so that it stays readable.
44. As a user, I want the TUI to lay out correctly on narrow terminals by hiding the sidebar and less important columns, so that it works over SSH from a phone.
45. As a user, I want the terminal window title to show the Project and health, so that I can see status from my terminal tabs.
46. As a user, I want Unmanaged apps shown in the table with a distinct label, so that I know the tool will not run Setup for them.

### Commands for agents and scripts

47. As an agent, I want `self-host install <app|recipe>… --set key=value --yes`, so that I can install without the TUI.
48. As an agent, I want a missing required input to fail immediately naming the key, so that I never hang on a prompt.
49. As an agent, I want `self-host apps list --json` and `apps info <id> --json` listing Apps, Recipes and their inputs, so that I can plan an install.
50. As an agent, I want `--json` to emit one JSON event per line (`run.start`, `step.start`, `step.ok`, `step.skip`, `step.fail`, `run.end`), so that I can parse progress reliably.
51. As an agent, I want each `step.fail` to include the App, step, error, App URL, credential name and a hint, so that I can finish the step with agent-browser.
52. As an agent, I want every `docker compose` command the tool runs logged verbatim, so that I can reproduce and debug it.
53. As an agent, I want secret values never printed in logs or events, so that transcripts stay safe.
54. As an agent, I want `self-host setup <app>` to rerun Setup and skip steps that are already done, so that I can retry after fixing something manually.
55. As an agent, I want `self-host status --json` to return Exposure, LAN IP, Host settings and every App's URL, state, health and Setup result, so that I can answer "why can't my TV reach Jellyfin".
56. As an agent, I want `self-host doctor --json` to check port bindings, firewalls and LAN reachability, so that I can diagnose network problems.
57. As an agent, I want `self-host credentials` to print the Admin login and per-App API keys on request, so that I can log in to an App to finish Setup.
58. As an agent, I want `self-host skill` to print a version-matched usage guide, so that I use the exact commands this binary supports.
59. As an agent, I want exit codes that distinguish success, partial Setup failure and hard errors, so that scripts can branch on them.
60. As an agent, I want a second mutating command to fail fast if another is running, so that two agents do not corrupt the Project.

### Apps, Recipes and Links

61. As a media user, I want the Media Recipe (Prowlarr, Radarr, Sonarr, qBittorrent, Jellyfin, Seerr, Homarr) installed and wired together headlessly, so that it works without clicking through wizards.
62. As a media user, I want Sonarr and Radarr connected to qBittorrent and Prowlarr automatically, so that searches and downloads work immediately.
63. As a media user, I want Jellyfin's admin account and libraries created from my media folders, so that I can start watching.
64. As a media user, I want Seerr connected to Jellyfin, Sonarr and Radarr, so that requests flow through.
65. As a Homarr user, I want every installed App added to Homarr with its integration, so that my dashboard is ready.
66. As a user, I want to install ntfy with its admin account created, so that I can receive notifications.
67. As a user, I want to install Vaultwarden with admin access configured, so that I can store passwords.
68. As a user adding Radarr later, I want only Radarr's Links (and Links pointing to it) to run, so that existing configuration is untouched.
69. As a user removing an App, I want Links pointing at it removed from other Apps, so that nothing references a dead App.
70. As a user, I want every App to use my time zone, user/group IDs and umask, so that files and schedules are correct.
71. As a user, I want port conflicts resolved by picking the next free port and showing it, so that installs never fail silently on a busy host.

### Lifecycle

72. As a user, I want `self-host start` and `stop` for one App or all, so that I can control what runs.
73. As a user, I want `self-host update [app…]` to pull newer images, recreate and re-check, so that I stay current.
74. As a user, I want `self-host self-update` to replace the binary after verifying its checksum, so that I get new Apps and fixes.
75. As a user, I want to be told in the TUI when a newer binary exists, so that I do not miss fixes.
76. As a user, I want `self-host remove <app>` to keep my data unless I pass `--purge`, so that removing is reversible.
77. As a user, I want `self-host config set KEY=value` to update Host settings and recreate only affected Apps, so that I can change my time zone or Exposure later.
78. As an agent, I want to add an Unmanaged app by writing its Compose file in the Project, then have start/stop/update/backup work on it, so that I can install things outside the catalog.

### Backup and restore

79. As a user, I want `self-host backup [app…] -o file` to write one compressed archive of App config and databases plus secrets, so that I can recover my setup.
80. As a user, I want each App stopped only while it is archived, so that database files are consistent and downtime is short.
81. As a user, I want media libraries excluded from Backups, so that archives stay small.
82. As a user, I want `--encrypt` to protect the archive with a passphrase, so that I can store it off-site safely.
83. As a user, I want a warning when a Backup is not encrypted, since it contains secrets, so that I make an informed choice.
84. As a user, I want `self-host restore file [app…]` to restore one App or everything, so that I can recover from a single broken App without touching the rest.
85. As an agent, I want Backups to be plain files with a manifest, so that I can schedule them and sync them with rclone or rsync myself.

## Implementation Decisions

- **Language and libraries.** Go (minimum version set by the newest Charm modules; Go auto-downloads the toolchain). TUI on `charm.land/bubbletea/v2`, `charm.land/bubbles/v2` (table, viewport, textinput, spinner, progress, help, key), `charm.land/lipgloss/v2` (styles, tables, layer compositor for overlays and mouse hit-testing), `charm.land/huh/v2` for wizard forms. Commands with `spf13/cobra`. Backups with `klauspost/compress/zstd` and `filippo.io/age`. Everything else uses the standard library.
- **Bubble Tea v2 features used.** Declarative `tea.View` (AltScreen, WindowTitle, MouseMode, ReportFocus, native ProgressBar during installs), `KeyPressMsg` with bubbles `key` bindings and `help`, background-colour detection with `LightDark` palettes, focus messages to trigger refresh, `tea.Tick` polling, lipgloss compositor layers for help/tasks/confirm overlays.
- **Modules.**
  - **events**: one step logger with a human renderer and an NDJSON renderer; secret redaction at this boundary; the TUI subscribes to the same event stream.
  - **host**: Docker/Compose/socket detection, Host settings detection (TZ, PUID/PGID with sudo awareness, UMASK, LAN IP), free-port selection, doctor checks returning `{id, level: ok|warn|fail, detail, hint}`.
  - **project**: Project layout, include-list root Compose file, `.env`, `secrets.env` (0600), `state.json`, PID lock; discovers catalog Apps from `apps/*/compose.yml` and Unmanaged apps from `extra/*/compose.yml` (and, for older Projects, from `apps/*/compose.yml`).
  - **compose**: the only place that runs `docker compose`; logs every command; parses `ps --format json`, `logs --follow`, `pull`.
  - **registry**: compares local image digests to the registry manifest digest for floating tags to detect updates (Docker Hub, GHCR, lscr).
  - **catalog**: registry of Apps and Recipes compiled into the binary.
  - **apps/<id>**: one package per App implementing the App contract (`ID`, `Info`, `Inputs`, `Compose`, `Setup`, `Check`, `Links`).
  - **helpers**: shared Setup toolkit: `Step(id, check, do, hint)` idempotent step runner, HTTP client with retries/auth, wait-until-healthy, container exec, secrets, XML/INI/YAML/JSON config edits, App URL resolution.
  - **backup**: tar + zstd archive with `manifest.json`, optional age passphrase encryption, per-App stop/archive/start, restore one or all.
  - **cli**: cobra commands mapping 1:1 to dashboard actions; exit codes 0 ok, 1 hard error, 2 Setup incomplete.
  - **tui**: model with screens (Apps, Catalog, Updates, Doctor, Backups), modes (normal, filter, confirm, help, tasks, wizard), sidebar tabs (logs, setup, info), background task manager, keymap, theme and badges.
  - **skill**: embedded agent guide printed by `self-host skill`.
- **Core service.** A single `Service` (Project + host + compose + registry + catalog + events) exposes the operations (status, doctor, install, setup, start, stop, update, remove, config set, backup, restore, credentials). Both cli and tui call it; neither talks to Docker directly.
- **Dependencies are injected** through one `Deps` value: process runner (for `docker`), HTTP client, filesystem root/home, environment lookup, clock, stdout/stderr. Real implementations in production; fakes in tests.
- **Compose layout.** Each App renders `apps/<id>/compose.yml` referencing `${TZ}`, `${PUID}`, `${PGID}`, `${UMASK}`, `${MEDIA_ROOT}`, `${DOWNLOADS_ROOT}`, and a bind address derived from Exposure. The root file only `include:`s app fragments. Config is bind-mounted under `apps/<id>/`; no named volumes.
- **Images.** linuxserver.io first, official images second, floating stable tags.
- **Setup contract.** Steps check first and skip when done; on failure they emit a hint and the run continues with independent Apps; Links run only after both ends finish Setup. No command marks a step done without its check passing.
- **Credentials.** One Admin login for every App; per-App API keys generated or read back from the App and stored in `secrets.env`; events reference credentials by name.
- **Exposure.** `lan` binds `0.0.0.0`, `local` binds `127.0.0.1`. Shown in recap, status and doctor.
- **Lock.** PID file; mutating commands fail if a live PID holds it; stale locks are replaced.
- **Distribution.** goreleaser builds linux amd64/arm64 and darwin arm64 with checksums; `install.sh` served from GitHub raw; `self-update` downloads and verifies the matching release asset.

## Testing Decisions

- Good tests exercise external behaviour through the highest seam and assert on what a user or agent sees: events emitted, files written in the Project, `docker` commands requested, HTTP calls made to an App, and what the TUI renders. They never assert on private struct fields when an observable result exists.
- **Seam 1, the Service with fake Deps.** All command behaviour (install, setup, status, doctor, update, remove, config, backup, restore, lock) is tested by calling the Service (or the cobra root with arguments) against a temp home, a scripted fake process runner standing in for `docker`, and `httptest` servers standing in for App APIs and registries.
- **Seam 2, the TUI model.** Screens, modes and keybinds are tested by feeding messages (window size, loaded snapshot, key presses, task updates) into the model and asserting on state and on rendered view text, following the Homarr developer CLI's `harness_test.go`. A few golden snapshots via teatest v2 lock the dashboard layout.
- **App Setup** is tested through Seam 1: each App gets a fake HTTP server modelling the subset of its API that Setup uses, and tests assert idempotency (second run skips every step) and the failure hint.
- **Real Docker e2e** per Recipe lives behind a build tag and runs nightly and on release in CI, not on every change.
- Prior art: `homarr-labs/homarr/tools/homarr-dev` (tui harness tests, docker parsing tests). The current repo has no Go tests.

## Out of Scope

- Installing Docker, public internet exposure (DNS, TLS, reverse proxy), VPN egress, scheduled or remote backups, monitoring stacks.
- Windows outside WSL; macOS Intel.
- Migrating Projects created by the previous TypeScript CLI.
- Browser automation inside the binary; agents use agent-browser themselves.
- Apps beyond the Media Recipe, ntfy and Vaultwarden.

## Further Notes

- The previous repo's `FINDINGS.md` and per-app notes document each media App's first-run quirks (forced auth on *arr apps, qBittorrent's temporary password, Homarr's onboarding); port that knowledge, not the code.
- `ajnart/self-host` already exists on GitHub with an npm placeholder; publishing `new-cli` there is a later, separate decision.
