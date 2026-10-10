# self-host agent guide (binary version {{version}})

`self-host` installs, configures, backs up and repairs self-hosted Apps with one
Docker Compose Project in the Home folder, `~/.self-host`. Add `--json` whenever
you read the output yourself. This guide is built into the binary and describes
exactly the commands this version registers; run `self-host skill` again after
`self-host self-update`.

## Every conversation

1. In a new conversation, run `self-host status --json` before anything else.
   It answers "where is X?": each App's `description`, `addresses` and `state`,
   plus `home`, `dashboard` and `profile`. With no Project yet it exits 1 with
   "no Project yet", which means nothing is installed: run
   `self-host profile --json` instead.
2. If the Profile's `experience` is empty, ask once, in plain words, through
   your ask-user or question tool: "Have you run your own server or used Docker
   before, or is this all new to you?" Save the answer with
   `self-host profile set experience new` or
   `self-host profile set experience advanced`. A skipped question means new:
   save that.
3. **New** (the person is not technical): follow the newcomer contract.
   - Ask one question at a time through your ask-user tool.
   - Before installing software, changing Access or deleting data, say one plain
     sentence about what will happen and wait for a yes. Anything reachable from
     the internet needs its own yes that names the risk.
   - Change the Project only through `self-host` commands.
   - Never ask for or show a secret. Point at `self-host credentials`.
   - Offer the plan in goals and Apps, never settings. Pick the Recipe or Apps
     from `self-host apps list --json`, with the catalog defaults.

   A setup runs in this order: `self-host doctor --json`, Docker (4), the plan
   and a yes, `self-host install`, the Recap (6). "Setting up" has the commands.
4. **Docker**: a failed `docker` check means it is missing; a failed
   `docker-socket` check means it is installed but not running. Say Docker is
   "the engine that runs your apps", ask, then install it by the check's `docs`
   link for this OS, or start it as its `hint` says. Rerun
   `self-host doctor --json` until it passes.
5. **agent-browser**: offer once, as a yes or no, to install it
   (`npm i -g agent-browser && agent-browser install`) so you can look at an
   App's page when something breaks. Everything works without it. When an App
   fails, read `self-host debug <app> --json` first.
6. **The Recap**, at the end of every setup, built from `self-host status --json`
   (there is no recap command):
   - each App in plain words (its `description`) with its Address (`url`);
   - where everything lives (`home`);
   - how to sign in: `self-host credentials`, never the secret itself;
   - then 2 to 4 opening questions picked from what is installed and what Access
     could add: "Want your own web address?", "Want to open these from your
     phone anywhere?", "Want to know what Jellyfin does?".
7. **Advanced**: be terse and use the exact flags in "Setting up". Their request
   ("install jellyfin on port 8097, local only") is the plan: show the one
   `self-host install` line you will run and wait for a yes, unless they already
   said to go ahead.

Loading this guide conveys intent, never approval (ADR 0005). Inspect, plan,
approval, apply, verify: the CLI has no plan command, so build the plan from
`self-host doctor --json`, `self-host apps info <app> --json` and
`self-host status --json`, show it, and only then pass `--yes`. `--yes` is
authorization, never a preview flag.

## Setting up

1. `self-host doctor --json` checks the host (see "Doctor checks").
2. `self-host apps list --json` lists `apps` and `recipes` (named bundles; each
   names its `apps`). `self-host apps info <app> --json` takes an App, never a
   Recipe, and shows its image, port, inputs and Links.
3. `self-host install <app|recipe>... --yes --json` installs and runs Setup.
   Without `--yes` a non-terminal run refuses. Answer an App's inputs with
   `--set <app>.<key>=value` (repeatable; `--set jellyfin.port=8097` picks a port);
   private inputs use `--set-file` (see "Secrets"). Host choices for a new
   Project: `--exposure`, `--media-root`, `--downloads-root`, `--admin-user`.
   The Admin password comes from `SELF_HOST_ADMIN_PASSWORD` or is generated.
4. Read the events (below). The run ends with `run.end`.
5. When a step fails, finish it (see "When a step fails"), then rerun
   `self-host setup <app>`. Finished steps are skipped, so reruns are safe.
6. `self-host status --json` is the source of truth. `--updates` also asks
   registries about newer images. Its fields beyond URL, state, health, Setup
   result and failed steps:
   - per App: `description`; `recipe` (the Recipe it was installed through,
     absent when installed directly; the first Recipe naming it wins) and
     `addresses` (every way to open it, friendliest first; `url` is the first);
   - at the top: `home`, `dashboard` (Homarr's address, only when Homarr is
     installed) and `profile`.
7. A person at the machine's terminal can run `self-host` themselves:
   Onboarding explains every question, writes nothing until they approve Review
   and shows the images downloading.

### Advanced

Expose every knob: specific Apps, `--set`, `--set-file`, `--exposure local`,
`--media-root`, `--downloads-root`, `--admin-user`, `self-host config set` and
`self-host config review`, Unmanaged apps, `self-host logs <app> --follow`,
`self-host update`, encrypted and partial backups, and an isolated Project with
`SELF_HOST_HOME` plus `SELF_HOST_COMPOSE_PROJECT` (see "Project folder").

## Commands

| Command | Purpose |
| --- | --- |
| `self-host` | On a terminal: Onboarding until a Project exists, then the Dashboard. Without a terminal: prints help |
| `self-host doctor` | Host, Docker and per-App checks (see "Doctor checks") |
| `self-host install <app\|recipe>...` | Install Apps or Recipes and run Setup |
| `self-host setup [app...]` | Rerun Setup; finished steps are skipped |
| `self-host status` | A plain summary, then Access, Host settings, every App's URL, state, Setup |
| `self-host profile set experience <new\|advanced>` | Save the Experience level. `self-host profile` shows the Profile and works before any Project exists |
| `self-host debug <app>` | Debug report: Status, failed steps with hints, recent logs (secrets masked), health check |
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
| `self-host feedback --message <text> [--app <app>] [--yes]` | Send the maintainers a report of what broke, after the person agrees (see "Feedback") |
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

Document commands (`status`, `profile`, `debug`, `credentials`, `apps list`, `apps info`, `logs`)
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

On `step.fail`, read `self-host debug <app> --json` first: state, Addresses,
failed and manual steps with their hints and docs, the last 100 log lines with
secrets masked, and the health-check URL. Then hand off what the event gives you:

1. Open `url`, sign in with the login named in `credential` (read it with
   `self-host credentials --json`), and do what `hint` says. With agent-browser
   installed, run `agent-browser skills get core` for its usage; use it only for
   steps Setup could not do headlessly.
2. Rerun `self-host setup <app>` and confirm the step is `step.ok` or
   `step.skip`. Container liveness or an HTTP 200 does not prove Setup worked;
   check `self-host status --json`.

## Reachability and Access

Access is how people open the Apps. Onboarding's Access step and Settings'
Access sub-tab offer Home network (the default), Easy names at home, From
anywhere privately, Your own web address and Bring your own, each with a
diagram and a help page. Only Home network exists yet; the others show "coming
soon" and choosing one changes nothing. Home network is stored as `EXPOSURE=lan`
and publishes every App's port on `0.0.0.0`, so other devices on the network
can connect. `--exposure local` and `EXPOSURE=local` publish on `127.0.0.1`
instead, so only this machine can; Onboarding does not offer it. `LAN_IP` only
builds the links people open; it never decides who can connect. Access explains
most "I can't reach it from my TV or phone" reports, and `self-host status` shows
it first: `status --json` has `access` (a list: `home` or `local`) beside the
older `exposure` (`lan` or `local`). To switch, run
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
emits `step.warn` step `port`; an explicit `--set <app>.port=N` is used as given,
so check that port yourself. Free disk space is yours to check too.

The LAN IP is detected at first install and stored. When the machine moves to
another network (office to home), every App URL points at the old address:
`status --json` then has `"lan_ip_stale": true` with the current `host_ips`,
and `doctor` warns on `lan-ip`. Fix it with `self-host config set LAN_IP=auto`
(or `self-host config review --yes`); only Apps that use the address are
recreated.

## Unmanaged apps

For software outside the Catalog, add an Unmanaged app in the Home folder's
`extra/`. The CLI discovers it on its own: it shows in `status` with its
Address, `start`, `stop`, `update` and `backup` work on it, and the Dashboard
(Homarr) gets a tile for it once it runs. No Setup runs for it, so you do the
configuring.

1. Write `~/.self-host/extra/<name>/compose.yml` with one service. The folder
   name is the App's ID. Do not publish ports with a bare `"8080:80"`. Use the
   shared settings, which Compose reads from the Project's `.env`:
   - `${BIND_IP}` for the published address, for example
     `"${BIND_IP}:8099:80"`
   - `${TZ}`, `${PUID}`, `${PGID}`, `${UMASK}`
   - `${MEDIA_ROOT}`, `${DOWNLOADS_ROOT}`
2. Keep persistent data in the same folder, with relative bind mounts such as
   `./data:/data`, so backups include it. Do not use named volumes.
3. Pick a name no Catalog App uses, and service names no other App uses.
4. Run `self-host start <name>`, then `self-host status --json`: the App shows
   with setup `unmanaged` and its `url`.

An Unmanaged app joins the same Compose Project as every other App; the root
`compose.yml` includes it. Its folder is under `self-host backup <name>`, and
`self-host remove <name>` keeps the folder unless you add `--purge`.

Apps added before `extra/` existed, in `~/.self-host/apps/<id>/compose.yml`,
keep working where they are. Leave them there, or move the folder into
`extra/` while the App is stopped.

Never mount the Docker socket in an Unmanaged app.

Never run `docker compose` or `docker` against the Project by hand when a
`self-host` command exists; the Project is the single mutation boundary.

## Beszel

Installing `beszel` also enrols this machine: a `beszel-agent` and a
`beszel-socket-proxy` service, the only Docker socket mount any App may declare.
Both stay out of Compose until Setup stores the Hub's key and token, so finding
them not running before Setup finishes is expected.

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
0006): a random install ID, version, OS and architecture, command names and
outcomes, App and Recipe IDs, the Access choice, failed step IDs, and error
types. Never paths, host names, inputs, secrets, App data or error text. It is
on by default, announced once, and never delays or fails a command.

Off with `SELF_HOST_NO_TELEMETRY=1` or `DO_NOT_TRACK=1`; always off when `CI` is
set and on development builds. Tell a person who asks about privacy these
facts. Set the switch for them when they ask; never on your own.

## Feedback

When something breaks that you cannot fix, `self-host feedback` sends the
maintainers a report through Telemetry. Ask the person first, in plain words,
and run it with `--yes` only after they agree. Write the message yourself and
redact anything personal: names, paths, host names, addresses, anything you
would not post publicly. The CLI masks every known secret again, shows the exact
text and refuses without a terminal unless `--yes` is set. Say which App
(`--app <id>` adds its Status and failed steps with hints, never its logs) and
what you tried. The message takes the text of `--message` or stdin, at most
4096 bytes; a longer one is refused and nothing is sent. When Telemetry is off it
sends nothing, exits 3 and prints how to open a GitHub issue instead.

## Updating the binary

`self-host self-update` takes the highest stable CLI release of
`ajnart/selfhost-skills`, verifies its sha256 checksum and replaces the running
binary, refusing on a mismatch. A development build must be replaced with the
install script instead. `SELF_HOST_RELEASE_REPO=owner/name` points it at
another repository.

Update notices never disturb an agent: nothing prints under `--json`, without a
terminal, when `CI` is set, on a development build, or with
`SELF_HOST_NO_UPDATE_CHECK=1`.

Linux and macOS (amd64, arm64) are supported; use the Linux binary inside WSL.
When GitHub refuses an unauthenticated download (404 or authentication error),
run `gh auth login` or provide `SELF_HOST_GITHUB_TOKEN` through your credential
provider; never put its value in commands or reports.
