# self-host agent guide (binary version {{version}})

`self-host` installs, configures, backs up and repairs self-hosted Apps with one
Docker Compose Project in `~/self-host`. Every action is a plain command with
human output, or one JSON event per line with `--json`. Use `--json` whenever
you read the output yourself.

This guide is built into the binary, so it describes exactly the commands this
version registers. Run `self-host skill` again after `self-host self-update`.

## Workflow

1. `self-host doctor` checks Docker, Compose, ports, firewalls and LAN
   reachability. Fix every failed check first; each one carries a hint.
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

## Commands

| Command | Purpose |
| --- | --- |
| `self-host` | Terminal dashboard (only on a terminal; otherwise prints help) |
| `self-host doctor` | Host and Docker checks |
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
| `self-host backup [app...]` | Write one compressed archive |
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
- backup: `--output <path>` (default `~/self-host/backups/selfhost-DATE.tar.zst`),
  `--encrypt`
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

Exposure is `lan` (reachable from the local network, the default) or `local`
(this machine only). It explains most "I can't reach it from my TV or phone"
reports. `self-host status` shows it first. Run `self-host doctor` to see
bindings, firewall rules and LAN reachability; its hints name the fix. To
switch, run `self-host config set EXPOSURE=lan` (or `local`). Never open ports
to the internet; public access is the user's decision and needs their own
reverse proxy or VPN.

The LAN IP is detected at first install and stored. When the machine moves to
another network (office to home), every App URL points at the old address:
`status --json` then has `"lan_ip_stale": true` with the current `host_ips`,
and `doctor` warns on `lan-ip`. Fix it with `self-host config set LAN_IP=auto`
(or `self-host config review --yes`); only Apps that use the address are
recreated.

## Unmanaged apps

For software outside the Catalog, add an Unmanaged app. The CLI starts, stops,
updates and backs it up, but runs no Setup for it.

1. Write `~/self-host/apps/<id>/compose.yml` with one service. Do not publish
   ports with a bare `"8080:80"`. Use the shared settings, which Compose reads
   from the Project's `.env`:
   - `${BIND_IP}` for the published address, for example
     `"${BIND_IP}:8099:80"`
   - `${TZ}`, `${PUID}`, `${PGID}`, `${UMASK}`
   - `${MEDIA_ROOT}`, `${DOWNLOADS_ROOT}`
2. Keep persistent data under `~/self-host/apps/<id>/`, so backups include it.
3. Run `self-host start <id>`, then `self-host status --json`: the App shows
   with setup `unmanaged`.

Never run `docker compose` or `docker` against the Project by hand when a
`self-host` command exists; the Project is the single mutation boundary.

## Backups

`self-host backup` writes one archive of App configuration, databases and
secrets. Media libraries are not included. Add `--encrypt` and set
`SELF_HOST_BACKUP_PASSPHRASE` in the environment to encrypt it; the same
variable is read by `self-host restore`. Test a backup by restoring one App,
not by assuming it works.

## Secrets

Never print, log or paste a password or API key into your reply, a command line
or a file you write. The only way to read them is `self-host credentials`; use
its output where needed (a login form, an API header) and say only where it
came from. Secrets live in `~/self-host/secrets.env` with mode 0600; do not
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

## Updating the binary

`self-host self-update` selects the highest stable `new-cli-vX.Y.Z` release
from `ajnart/selfhost-skills`, verifies its sha256
checksum, and replaces the running binary. It prints the old and new versions
and refuses on a checksum mismatch. A development build must be replaced with
a release using the install script instead.

Linux and macOS amd64/arm64 are build targets. Use the Linux binary
inside WSL; native Windows is unsupported. Cross-compilation
alone does not prove native platform support.

For private releases, provide `SELF_HOST_GITHUB_TOKEN` through your credential
provider. It is used for authenticated API downloads and is never printed.
Never put its value in commands, reports or saved client configuration.
