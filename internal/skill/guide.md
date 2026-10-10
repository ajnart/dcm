# self-host agent guide (binary version {{version}})

`self-host` installs, configures, backs up and repairs self-hosted Apps with one
Docker Compose Project in `~/.self-host`. Every action is a plain command with
human output, or one JSON event per line with `--json`. Use `--json` whenever
you read the output yourself.

This guide is built into the binary, so it describes exactly the commands this
version registers. Run `self-host skill` again after `self-host self-update`.

## Workflow

1. `self-host doctor --json` checks the host (see "Doctor checks"). Fix every
   failed check first; each one carries a hint.
2. `self-host apps list --json` lists Apps and Recipes (named bundles such as
   `media`). `self-host apps info <app> --json` shows an App's image, port,
   inputs and Links.
3. `self-host install <app|recipe>... --yes --json` installs and runs Setup.
   Without `--yes` a non-terminal run refuses. Answer an App's inputs with
   `--set app.key=value` for non-secret fields (repeatable); `--set app.port=N`
   picks its port. Private inputs use the file references described in Secrets.
   Host choices for a new Project: `--exposure`, `--media-root`,
   `--downloads-root`, `--admin-user`. The Admin password comes from
   `SELF_HOST_ADMIN_PASSWORD` or is generated.
4. Read the events (below). The run ends with `run.end`.
5. When a step fails, finish it (see "When a step fails"), then rerun
   `self-host setup <app>`. Finished steps are skipped, so reruns are safe.
6. `self-host status --json` is the source of truth: URL, state, health, Setup
   result and failed steps of every App. `self-host status --updates --json`
   also asks registries whether newer images exist.

## Two kinds of users

Decide who you are talking to from how they talk, and keep that register.

- **New**: states a goal in plain words ("I want to watch my movies on the TV").
- **Advanced**: names Apps, ports, Exposure or folders.

When unclear, ask at most one short question. Never quiz a newcomer on settings.

### New users

1. Recommend a Recipe, or one or two Apps, that meets the goal (read
   `self-host apps list --json`). To watch movies they already own that is
   `owned-video-library` plus `homarr`; add `media` only when they also want to
   request and download. Use the catalog defaults: Exposure `lan`, the default media and
   downloads folders, a generated Admin login. Homarr is the dashboard.
2. Explain each App in one plain sentence (its `description`). Explain
   Exposure in plain words: devices on the same Wi-Fi or router can open the
   Apps at this computer's LAN address; nothing is opened to the internet.
3. If the person sits at the machine's terminal, suggest they run `self-host`
   themselves. Onboarding asks What, Where, Who, Look and Review, explains
   every question, writes nothing until they approve Review, and plays a
   pre-boot screen while the images download.
4. Otherwise show the plan, get approval, then run
   `self-host install <recipe> --yes --json`.
5. Afterwards give the dashboard and App URLs from `self-host status --json`.
   Say that `self-host credentials` shows the Admin login and never paste it.
   Finish any Manual steps for them (see "When a step fails").

### Advanced users

Respect their exact choices and expose every knob:

- Specific Apps; `--set app.port=N`, `--set app.key=value`, private inputs with
  `--set-file`.
- `--exposure local`, `--media-root`, `--downloads-root`, `--admin-user`.
- `self-host config set` and `self-host config review`.
- Unmanaged apps.
- `self-host logs <app> --follow`, `self-host update`,
  `self-host status --updates --json`.
- Encrypted backups and partial restores.
- An isolated Project with `SELF_HOST_HOME` plus `SELF_HOST_COMPOSE_PROJECT`
  (see "Project folder").
- Optionally the Dashboard's Settings sub-tabs: Host, Appearance, Backups,
  Tools and About.

### Both

Follow inspect → plan → approval → apply → verify. The CLI has no plan
command: build the plan from `self-host doctor --json`,
`self-host apps info <app> --json` and `self-host status --json`, show it, and
only then pass `--yes`. `--yes` is authorization, never a preview flag.

## Commands

| Command | Purpose |
| --- | --- |
| `self-host` | On a terminal: Onboarding until a Project exists, then the Dashboard. Without a terminal: prints help |
| `self-host doctor` | Host, Docker and per-App checks (see "Doctor checks") |
| `self-host install <app\|recipe>...` | Install Apps or Recipes and run Setup |
| `self-host setup [app...]` | Rerun Setup; finished steps are skipped |
| `self-host status` | Exposure, Host settings, every App's URL, state, Setup |
| `self-host credentials` | Admin login and per-App API keys |
| `self-host apps list` | Catalog of Apps and Recipes |
| `self-host apps info <app>` | One App's image, port, inputs, Links |
| `self-host start [app...]` | Start Apps (all when none named) |
| `self-host stop [app...]` | Stop Apps |
| `self-host up` | Start every App in the Project |
| `self-host down` | Take down the Project's containers and networks; App files, state and volumes stay |
| `self-host restart [app...]` | Restart Apps |
| `self-host update [app...]` | Pull newer images, recreate Apps, rerun checks |
| `self-host remove <app>...` | Remove Apps; data is kept unless `--purge` |
| `self-host config set KEY=value...` | Change Host settings and recreate affected Apps (`LAN_IP=auto` re-detects) |
| `self-host config review [--yes]` | Compare Host settings with this machine now; `--yes` fixes drifted LAN IP and time zone, keeping every install |
| `self-host logs <app>` | Container logs |
| `self-host backup [app...]` | Write one compressed archive, optionally encrypted |
| `self-host restore <file> [app...]` | Restore every App in a Backup, or only those named |
| `self-host self-update` | Replace the binary with the latest verified release |
| `self-host skill` | Print this guide |

Global flags: `--json` (one JSON event per line; document commands print one
JSON document), `--verbose` or `-v` (also print every command and step start).

Command flags:

- install: `--yes`, `--set`, `--set-file`, `--exposure`, `--media-root`, `--downloads-root`,
  `--admin-user`
- status: `--updates`
- remove: `--purge` (also deletes the App's data folder), `--yes`
- logs: `--follow`, `--tail N` (default 200)
- backup: `--output <path>` or `-o` (default `~/.self-host/backups/selfhost-DATE.tar.zst`,
  `.tar.zst.age` with `--encrypt`), `--encrypt`
- restore: `--yes` (replaces the current data of the restored Apps)

Pass `--yes` for `install`, `remove` and `restore` when no terminal is attached.
Never pass `--purge` or `--yes` to `remove` unless the user asked to delete data.

## JSON events

With `--json`, `install`, `setup`, `start`, `stop`, `restart`, `update`,
`remove`, `config set`, `backup`, `restore` and `doctor` print one JSON object
per line:

```json
{"event":"step.fail","app":"sonarr","step":"download-client","msg":"…","error":"qBittorrent refused login","url":"http://192.168.1.20:8989","credential":"admin","hint":"Add qBittorrent under Settings › Download Clients.","docs":"https://…"}
```

Fields (all but `event` are omitted when empty):

| Field | Meaning |
| --- | --- |
| `event` | `run.start`, `run.end`, `step.start`, `step.ok`, `step.skip`, `step.warn`, `step.fail`, `step.manual`, `command`, `info`, `pull.progress` |
| `app`, `step` | What the event is about |
| `msg` | Human summary |
| `error` | Why a step or the run failed (`run.end` carries it when the run failed) |
| `url` | Where to finish the step by hand |
| `credential` | Which login to use; read it with `self-host credentials` |
| `hint` | The next action, in words |
| `docs` | Upstream documentation |
| `command` | The shell command run (`command` events) |
| `image`, `layer` | The image and layer a `pull.progress` event is about (`layer` is empty for image-level events) |
| `status` | Pull status: `Downloading`, `Extracting`, `Pull complete`, `Pulling`, `Pulled` |
| `current`, `total` | Bytes done and expected for a `pull.progress` event |

`step.warn` is not a failure but needs a look. `step.skip` means the work was
already done.

Document commands (`status`, `credentials`, `apps list`, `apps info`, `logs`)
print one result on stdout and only errors on stderr with `--json`.

## Exit codes

- `0`: success
- `1`: error (read the `error` field of the last `run.end` or `step.fail`)
- `2`: Setup incomplete. Everything is installed, but at least one Setup step
  failed. Read the `step.fail` events or `self-host status --json`.
- `3`: Only Manual steps remain after install or Setup. Read the `step.manual`
  hints or `self-host status --json` (`setup` and step `status` are `manual`).
  Finish them in the browser, then retry Setup. A browser-only verification
  remains manual on retry; a successful probe does not prove that step finished.

`self-host doctor` exits `1` when any check fails.

## When a step fails

On `step.fail`, the event gives you everything to hand off:

1. Open `url`, sign in with the login named in `credential` (run
   `self-host credentials --json` to read it), and do what `hint` says.
2. If you drive a browser, use agent-browser: run `agent-browser skills get core`
   for its usage. Use it only for steps Setup could not do headlessly; the
   binary already does everything it can by API.
3. Rerun `self-host setup <app>` and confirm the step is `step.ok` or
   `step.skip`. Container liveness or an HTTP 200 does not prove Setup worked;
   check `self-host status --json`.

## Reachability and Exposure

Exposure is `lan` (the default) or `local`. `lan` publishes every App's port on
`0.0.0.0`, so other devices on the network can connect; `local` publishes on
`127.0.0.1`, so only this machine can. `LAN_IP` only builds the links people
open; it never decides who can connect. Exposure explains most "I can't reach
it from my TV or phone" reports, and `self-host status` shows it first.
Tailscale, Cloudflare Tunnel and HTTPS with Caddy appear in the Dashboard as
"coming soon" and cannot be set. To switch, run
`self-host config set EXPOSURE=lan` (or `local`). Never open ports to the
internet; public access is the user's decision and needs their own reverse
proxy or VPN.

## Doctor checks

Without a Project, `self-host doctor` runs the Docker checks and stops at the
first failure: `docker` (CLI found), `docker-socket` (daemon answers),
`compose` (v2 plugin) and `docker-userns` (rootless detection, a warning when
undetermined). With a Project it adds `project-lock`, `project-userns`
(rootless with non-zero PUID/PGID), `project`, `exposure`, `lan-ip` and
`firewall` (both only under `lan`), and per App `running`, `binding` and
`reachable`.

Doctor does not check that ports are free or how much disk is left (issue
#140). `self-host install` takes the next free port from an App's default and
emits `step.warn` step `port`; an explicit `--set app.port=N` is used as given,
so check that port yourself. Free disk space is yours to check too.

The LAN IP is detected at first install and stored. When the machine moves to
another network (office to home), every App URL points at the old address:
`status --json` then has `"lan_ip_stale": true` with the current `host_ips`,
and `doctor` warns on `lan-ip`. Fix it with `self-host config set LAN_IP=auto`
(or `self-host config review --yes`); only Apps that use the address are
recreated.

## Unmanaged apps

For software outside the Catalog, add an Unmanaged app. The CLI starts, stops,
updates and backs it up, but runs no Setup for it.

1. Write `~/.self-host/apps/<id>/compose.yml` with one service. Do not publish
   ports with a bare `"8080:80"`. Use the shared settings, which Compose reads
   from the Project's `.env`:
   - `${BIND_IP}` for the published address, for example
     `"${BIND_IP}:8099:80"`
   - `${TZ}`, `${PUID}`, `${PGID}`, `${UMASK}`
   - `${MEDIA_ROOT}`, `${DOWNLOADS_ROOT}`
2. Keep persistent data under `~/.self-host/apps/<id>/`, so backups include it.
3. Run `self-host start <id>`, then `self-host status --json`: the App shows
   with setup `unmanaged`.

Never mount the Docker socket in an Unmanaged app.

Never run `docker compose` or `docker` against the Project by hand when a
`self-host` command exists; the Project is the single mutation boundary.

## Beszel

Installing `beszel` also enrols this machine: a `beszel-agent` service and a
`beszel-socket-proxy` service that gives the agent read-only access to the
Docker socket. That proxy is the only Docker socket mount any App may declare.
Both services are held back from Compose until Setup stores the Hub's key and
token, so finding them not running before Setup finishes is expected: finish
Setup and recheck with `self-host status --json`. Installing Homarr next to it
adds a Link that puts a Beszel System Stats widget on its board.

## Project folder

The Project lives in `~/.self-host`. For an isolated Project, set
`SELF_HOST_HOME` to an absolute directory and `SELF_HOST_COMPOSE_PROJECT` to a
unique lowercase name (letters, digits, `-`, `_`), and keep both the same for
every later command. A Project made by a pre-release build in `~/self-host` is
not picked up; point `SELF_HOST_HOME` at it only if the user asks.

## Backups

`self-host backup [app...]` writes one archive of App configuration, databases
and secrets. Media libraries are not included.

- Without `--output`, the file goes to `~/.self-host/backups` as
  `selfhost-DATE.tar.zst`, or `.tar.zst.age` when encrypted.
- `--encrypt` reads the passphrase from `SELF_HOST_BACKUP_PASSPHRASE`. When
  that is unset it prompts on a terminal; without a terminal it fails.
- An unencrypted backup emits `step.warn` step `unencrypted`: it contains
  passwords and API keys, so keep it private or encrypt it.
- `self-host restore <file> [app...]` restores every App in the archive or only
  those named, and reads the same variable for an encrypted archive.
- The Dashboard's Settings → Backups lists, makes and restores archives
  interactively.

Test a backup by restoring one App, not by assuming it works.

## Secrets

Never print, log or paste a password or API key into your reply, a command line
or a file you write. The only way to read them is `self-host credentials`; use
its output where needed (a login form, an API header) and say only where it
came from. Secrets live in `~/.self-host/secrets.env` with mode 0600; do not
read that file directly.

For inputs marked `private` by `self-host apps info <app> --json`, pass
`--set-file app.key=/owned/private/credential-file` during install. Use an
existing regular, owner-only file belonging to the Project owner; the CLI
reads it privately and saves its value in the secret store. Use
`--set-file app.key=-` to read from the command's stdin instead, with at most
one `-` per command. Both transports accept at most 64 KiB and strip trailing
CR/LF; values must be a single line without NUL bytes. Never put the value in
command arguments. Missing required private inputs fail before a first Install
creates a Project or its settings. Interactive private
inputs are masked. Provider accounts and approvals remain prerequisites.

## Telemetry

`self-host` sends anonymous usage and error data to the project's PostHog (ADR
0006): a random install ID (`~/.self-host/telemetry-id`), version, OS and
architecture, command names and outcomes, App and Recipe IDs, the Access choice,
failed step IDs, and errors as `$exception` events carrying the error type and
failed step only. It never sends paths, host names, inputs, secrets, App data or
error text. The data is published on a public dashboard (link: coming with
#207).

- It is on by default. The first plain command (not `--json`) prints one notice
  line on stderr, and Onboarding shows it once; nothing is sent before that. A
  person who asks about privacy gets the facts above and this switch.
- Off with `SELF_HOST_NO_TELEMETRY=1` or `DO_NOT_TRACK=1`, always off when `CI`
  is set and on development builds. Set it for the person when they ask; do not
  disable it on your own.
- It never delays or fails a command and is dropped when the network is slow.

## Updating the binary

`self-host self-update` selects the highest stable CLI release from
`ajnart/selfhost-skills` (tags `vX.Y.Z` or the earlier `new-cli-vX.Y.Z`; only a
release that carries the `self-host_<version>_<os>_<arch>.tar.gz` archives and
`checksums.txt` counts, so the skill-pack releases are never picked), verifies its sha256
checksum, and replaces the running binary. It prints the old and new versions
and refuses on a checksum mismatch. A development build must be replaced with
a release using the install script instead. `SELF_HOST_RELEASE_REPO=owner/name`
points it at another repository, for a fork or after a rename.

You are told about a newer release without asking, and never in a way that
disturbs an agent:

- The terminal Dashboard (bare `self-host`) asks "Update now? y/n" once it is
  idle. `y` runs the same verified update and restarts into the new version;
  `n` remembers that release in `<user cache dir>/self-host/update.json`, so it
  does not ask again until a newer one appears. It never appears during
  Onboarding or pre-boot, or while an Action runs.
- A plain command in an interactive terminal prints one line,
  `self-host <new> is available: run self-host self-update`, at most once every
  24 hours. The check runs in parallel and is dropped if it is slow.
- Neither appears under `--json`, when stdin or stdout is not a terminal, when
  `CI` is set, on a development build, for `self-update` itself, or when
  `SELF_HOST_NO_UPDATE_CHECK=1`. An agent that passes `--json` is never
  interrupted.

Linux and macOS amd64/arm64 are build targets. Use the Linux binary
inside WSL; native Windows is unsupported. Cross-compilation
alone does not prove native platform support.

When GitHub refuses an unauthenticated download (a 404 or authentication
error), run `gh auth login` or provide `SELF_HOST_GITHUB_TOKEN` through your
credential provider. It is used for authenticated API downloads and is never printed.
Never put its value in commands, reports or saved client configuration.
