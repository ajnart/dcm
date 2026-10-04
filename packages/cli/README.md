# self-host CLI

Select apps, review one Docker Compose project, then run scripted setup.
Reopen `self-host` to inspect the saved project, add apps, start/stop units,
review compatible recipe changes or view private credentials. Homarr is an
optional dashboard and MCP front door.

This deterministic package works without AI. The optional Agent Skill helps
with choices and exceptional repairs; both use the same CLI and saved owner.
Recipe availability, setup readiness and live acceptance are reported
separately. Catalog entries without recipes are not installed.

The current source catalog has 94 apps: 81 static Compose recipes and 13
derived recipes, each with a setup adapter. This is coverage, not 94 verified
installs. Some apps need external credentials or explicit host authority;
manual jobs validate saved configuration without executing backups or updates.
Passbolt uses a native client-key bundle rather than an invented password/API
key. Its private handoff reports where that bundle is saved.

App authors can reuse the shared [writable private-config contract](docs/mutable-config.md)
for upstream-generated configuration instead of adding another installer flow.

## Start here

The package remains private; there is no public `npx` package or CLI asset in
the current release. With access to the private repository, install a
standalone command from a local tarball:

```bash
gh auth status
gh repo clone ajnart/selfhost-skills
cd selfhost-skills
git switch feat/headless-fallback-handoff
bun install --frozen-lockfile
bun packages/cli/scripts/build.ts
cli_tgz=$(npm pack ./packages/cli --ignore-scripts --pack-destination . --silent)
npm install -g "./$cli_tgz" --ignore-scripts
self-host
```

This requires Bun 1.4+ to build and Node.js 20.12+ to run. The installed
command no longer depends on the source checkout. If an owner already gave
you a CLI tarball, install it with `npm install -g /absolute/path/to/file.tgz`.
To run directly from source instead, build with
`bun packages/cli/scripts/build.ts` and replace `self-host` below with
`node packages/cli/bin/selfhost.mjs`.

Run `self-host` in a terminal. It opens the saved project in the current
directory, or `~/.selfhostedskills` when that is the saved project. If both
exist, choose one. The first screen lists saved apps and URLs immediately;
Docker health and registry image checks run in the background and remain
`unknown` when they cannot be verified. **Refresh status and image updates**
waits for those checks. The panel can start or stop only its exact saved app
projects, and **Continue saved setup** retains the older account, media,
household, and Homarr recovery paths. On interactive launch, the CLI checks the
latest private GitHub release. When a newer package is available, it shows
installed/available versions and asks **Update CLI?**; Enter accepts, No keeps
the current version. Failed or unavailable checks leave setup usable.
**Check for CLI update** also performs a fresh check when this is the active global npm installation. It
requires `gh` authentication, a newer release containing
`ajnart-selfhost-VERSION.tgz` and `CLI-SHA256SUMS` (legacy `SHA256SUMS` is also
accepted), and explicit confirmation. Downloaded size, SHA-256, package identity
and installed version are checked. Updating replaces the global CLI; restart
`self-host` afterward. It never silently replaces itself. A
source checkout or native binary must be updated by its owner. The current
release has no CLI tarball, so this option cannot yet update it.

**Select apps for a new project** now compiles the selected v2 recipes into one
shared Compose project. Type to filter, use Space to toggle, Backspace to edit,
and Enter to review the exact apps, private ports, and direct-versus-pending
first-run coverage. Homarr starts selected and can be deselected. Applying starts
only that reviewed project. Scripted setup collects declared non-secret app
choices, retains them through retries, and reviews each current batch of exact
mutating steps together. Leaving an optional choice blank does not configure
its related library or path. An app with no first-run adapter
is shown as pending, not as configured. The shared project can be inspected with
`self-host app shared status --project-root ROOT --project-id selfhost --json`.

**Choose what to self-host** uses the existing goal catalog to recommend that
same shared project. The review distinguishes selected apps from database/cache
services already bundled inside their recipes. You can customize the result;
an explicit Homarr opt-out survives. In an existing shared project, the review
shows additions and retained apps, then deploys only the additions. Setup also
resumes retained apps selected for that goal, reusing saved credentials. The
saved panel offers this as **Add a capability**. Unresolved access/VPN decisions
or unavailable recipes stop here; they never launch a separate legacy installer.

The saved-project control panel rediscovers shared projects, shows saved app URLs,
can add apps or start or stop one app (or all selected apps) within the same Compose owner,
continue scripted setup, and offer an explicit private credential view.
Docker state and documented health are checked in the background; unknown stays
unknown when inspection or an upstream health check is unavailable. It can add
validated recipes to an existing shared project without recreating retained
services. Image checks compare the saved digest against the same pinned recipe
tag asynchronously; they do not discover newer version tags or replace images.
**Change app selection** uses the same searchable picker with installed apps
preselected. Review additions, retained apps, available image updates, and
removals. Approved removal stops/removes only the selected containers, preserving
data and credentials. Required dependencies, configured service links, private
HTTPS routes and the final app are protected. Supported removed apps can be
restored from their exact saved selection; special restore cases remain blocked.
**Update app images** uses the same image-transition
review/apply commands below: review old/new digest pins for one running app,
then confirm its exact scoped recreation. Saved settings, data and credentials
remain. An interrupted pre-Docker review needs a fresh approval; attempted or
uncertain updates require inspection. Recheck login, app function and Homarr
widgets afterward. The
shared Uptime Kuma recipe now has a scripted Socket.IO first-admin and login
route. Only exact namespace-connect and pong frames skip per-frame approval;
application events remain reviewed, and the one-time account write has a
pre-send checkpoint. This route has
passed a focused protocol fixture, not fresh-container acceptance.

For an exact shared-project lifecycle change without the menu, review first,
then pass the fresh approval returned by that review:

```bash
self-host app shared stop --project-root /absolute/project --project-id selfhost --app paperless-ngx --json
self-host app shared stop --project-root /absolute/project --project-id selfhost --app paperless-ngx --approve SELECTED-STOP:selfhost:REVIEWED_DIGEST --json
self-host app shared start --project-root /absolute/project --project-id selfhost --app paperless-ngx --json
```

Repeat `--app` to target multiple units. Only services in units that need the
change are passed to Compose; existing volumes and private credentials remain.
The CLI rechecks the exact owner and runtime before mutation and verifies the
selected containers afterward. App login, function, and restart acceptance
are separate checks.

To add apps later, review the proposed delta, then apply its fresh token:

```bash
self-host app shared add --project-root /absolute/project --project-id selfhost --app gatus --json
self-host app shared add --project-root /absolute/project --project-id selfhost --app gatus --approve SHARED-ADD:selfhost:REVIEWED_DIGEST --json
self-host app shared setup --project-root /absolute/project --project-id selfhost --app gatus --json
```

The add command inspects the existing Compose owner, ports, networks, volumes,
and bind mounts, then starts only the newly selected services. Keep the exact
reviewed image and port choices; a failed or partial add requires inspection,
not a blind retry. The setup command has its own approval and reports any
missing first-run adapter as pending. No fresh live add/restart acceptance has
yet been recorded for this route.

To remove an app's containers without deleting its data or credentials:

```bash
self-host app shared remove --project-root /absolute/project --project-id selfhost --app gatus --json
self-host app shared remove --project-root /absolute/project --project-id selfhost --app gatus --apply --approval SHARED-REMOVE:selfhost:REVIEWED_DIGEST --json
```

Removal uses each app's validated original Compose file, including apps added
or recreated later. Retained containers are not restarted. It does not delete
Homarr resources, purge volumes, or retire the whole project. Unknown outcomes
leave an inspection checkpoint rather than replaying container removal.

To restore a removed standard app, review and approve its saved selection:

```bash
self-host app shared reinstall --project-root /absolute/project --project-id selfhost --app gatus --json
self-host app shared reinstall --project-root /absolute/project --project-id selfhost --app gatus --approve SHARED-REINSTALL:selfhost:REVIEWED_DIGEST --json
```

Restore reuses the historical images, ports, data and credential files. It starts
only that app's services and runs no account setup. Missing resources, conflicts,
recipe drift or uncertain removal block it. Derived recipes, manual jobs,
canonical HTTPS, bootstrap closure, mutable/private configuration and pre-start
authority need additional restore support. `restored-unverified` means existing
credentials and app function still need verification; it is not live acceptance.

Headless setup can approve independent reviewed actions together with repeated
`--approve-step TOKEN` flags. Keep `--approve` set to the shared setup review
token; each step token still binds its exact action and saved state. A newly
discovered action or changed checkpoint needs a fresh step review. The control
panel retains accepted step tokens during the setup session.

Homarr's onboarding and login cookies are saved privately so interrupted
setup can resume without losing its first-run claim. With Homarr selected,
Uptime Kuma setup also creates an empty `default` status page for Homarr's
integration. That page has no monitors or external targets and follows the
project's existing private exposure; it is not protected by an app login.

### Connect media apps

Account setup and app-to-app wiring are separate. After both apps are set up
in the same saved Compose project, review and apply a supported connection:

```bash
self-host connect plan --project-root /absolute/project --project-id selfhost \
  --source sonarr --target qbittorrent --json
self-host connect apply --project-root /absolute/project --project-id selfhost \
  --source sonarr --target qbittorrent --approve EXACT_CONNECT_TOKEN --json
# Review each returned step, then repeat apply with its --approve-step TOKEN.
```

Supported pairs: Sonarr/Radarr → qBittorrent, Prowlarr → Sonarr/Radarr,
and Seerr → Sonarr/Radarr. The engine reads credentials from the saved owner,
uses internal service addresses, tests the connection and reads back its
configuration. Required folders, downloader categories and profiles must
already exist. It does not add an indexer, request media, or prove acquisition
or restart persistence. The panel offers these connections after account
setup, and **Connect installed apps** lets you retry them later. Each exact
connection and returned mutation step is reviewed before applying; blocked
or declined connections remain unfinished.

For older independently saved app projects, **Change app selection** opens a searchable multi-select. Type an app name or
ID to filter, use Space to toggle the highlighted app, Backspace to edit the
filter, and Enter to review added, retained, image-update-available, and
removed apps. Removing an app from the active selection stops its container;
its data, state, and credentials remain. The active/excluded choice is saved
privately in `.selfhost/control-panel.json`. The new-project picker instead
lists validated shared Compose recipes and marks missing first-run adapters
as pending; apps without recipes are discovery-only. Image update
availability is informational: this panel does not yet replace images.

Each scripted first-run adapter lives beside its app's recipe and manifest.
The shared setup engine runs independent account steps concurrently where safe,
with approval prompts serialized. It saves passwords and Homarr's API key in
the exact project's private app files. For a shared owner, use
`self-host app shared handoff --project-root ROOT --project-id ID --app APP --show`
only when you deliberately want their values. Older standalone owners retain
`self-host app handoff --id APP --project-root ROOT --show`.
The shared JSON handoff also returns `recovery`: saved checkpoint stage,
attempted actions, exact owner identity and private session-file references.
Missing checkpoints or invalid recovery files stay marked for inspection
without hiding otherwise valid credentials. Optional session files may be
absent on API-only routes. Cookie files are HTTP transport envelopes, not
browser profiles. This snapshot neither restores a browser session nor
authorizes replaying an uncertain setup write.
TCP-only apps such as PostgreSQL and Valkey report connection endpoints, not
browser links or Homarr tiles. Prepared jobs such as Restic and Borgmatic list
their named passphrase files; explicit `--show` displays their values. Neither
has an invented administrator login or API key.
Homarr publication describes TCP apps, prepared jobs and private connectors in
a managed recap Notebook without inventing web links or runtime-health claims.
Functional checks, a safe restart, and Homarr integrations/widgets remain
separate work; a Compose start alone does not prove them. The global CLI update
route is packaged but cannot be exercised until a newer private release ships
the checksummed CLI tarball.

Derived app recipes use declared non-secret installation choices before both
fresh creation and addition. The panel collects them; scripts repeat exact
`--input APP.KEY=VALUE` values in `app shared plan`/`apply` or `add`. HAProxy
requires a selected frontend, Headscale requires its origin/domain, and
AIStor/MinIO requires an explicit licensed edition/root identity plus an
owner-issued private license file. All selected main/extra application TCP
ports are shown, checked and locked; `--port APP.PORT-ID=PORT` overrides a
declared extra port. This is not permission to publish a Docker API, database
or public ingress. Tailscale's portless daemon has separate, file-bound
enrollment/Serve steps; client access and ACL acceptance remain unverified.

Prowlarr's standalone recipe keeps `/config` in an owned Docker volume. Its
approved first run reads the private `config.xml` API key, enables required
Forms login, and saves both credentials. `self-host app login-check --id
prowlarr --project-root ROOT --json` rechecks the current login and API access
without changing settings. No indexer or Sonarr/Radarr link is selected for you.

After standalone apps have recorded their own functional/restart acceptance,
the menu can offer optional Homarr and read back local-host bookmark tiles and
a stack Notebook. This late-added route does not retrofit their Docker network.
If Homarr is onboarded first, the selected app frontends can join its approved
private bridge; **Review Homarr dashboard** revisits tiles, Notebook, and
native app connections. Browser rendering and remote-device access remain
separate. Declining Homarr never blocks the apps.

Native CLI preview on Linux x64: from this checkout, build the existing assets,
then compile one source-independent artifact with Bun 1.4.0. The resulting
binary embeds its runtime and catalog; the read-only catalog, planner, doctor,
and terminal menu work without Node or Bun installed on the target. It
extracts its bundled code into an owner-only temporary directory while running.
This is a local probe, not a published download or proof of app deployment:

```bash
bun packages/cli/scripts/build.ts
bunx bun@1.4.0 packages/cli/scripts/build-native.ts \
  --target bun-linux-x64 --outfile /absolute/output/self-host
/absolute/output/self-host doctor --scope plan --json
/absolute/output/self-host --interactive
```

The builder prints the SHA-256. It also accepts `bun-linux-arm64`,
`bun-darwin-x64`, `bun-darwin-arm64`, `bun-windows-x64`, and
`bun-windows-arm64` (use an `.exe` output for Windows). Target-runner
catalog, planner, and doctor checks are deferred while CI is manual-only.
Linux media and household apply still need their separately
checked Docker/Bun/Bash tools; a native planning smoke is not a native
multi-platform apply claim.

When run manually, CI keeps tested binaries private as short-lived GitHub
Actions artifacts, each paired with `SHA256SUMS`. With repository access, find a
successful manually dispatched run on the feature branch and download the artifact for your OS and
CPU; this needs neither a source checkout nor a local build tool:

```bash
gh auth status
gh run list --repo ajnart/selfhost-skills --branch feat/headless-fallback-handoff \
  --workflow validate.yml --limit 5
gh run download RUN_ID --repo ajnart/selfhost-skills \
  --name self-host-native-bun-linux-x64 --dir /absolute/install-dir
cd /absolute/install-dir
sha256sum -c SHA256SUMS
chmod 700 self-host
./self-host doctor --scope plan --json
./self-host --interactive
```

Use `bun-linux-arm64`, `bun-darwin-x64`, or `bun-darwin-arm64` in the artifact
name for those systems. On macOS, replace `sha256sum -c` with
`shasum -a 256 -c SHA256SUMS`. GitHub's artifact ZIP does not retain Unix
executable mode, hence `chmod`. For Windows PowerShell, use the matching
`bun-windows-x64` or `bun-windows-arm64` artifact and verify its checksum:

```powershell
gh run download RUN_ID --repo ajnart/selfhost-skills `
  --name self-host-native-bun-windows-x64 --dir C:\self-host-bin
Set-Location C:\self-host-bin
$expected = ((Get-Content .\SHA256SUMS -Raw) -split '\s+')[0].ToLowerInvariant()
$actual = (Get-FileHash .\self-host.exe -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw 'Native CLI checksum mismatch' }
.\self-host.exe doctor --scope plan --json
.\self-host.exe --interactive
```

These are 30-day private CI artifacts, not a durable release. The OS-specific
binary has been run for read-only commands; Docker Desktop/WSL deployment,
supported app onboarding, and functional acceptance remain separate gates.

For a human at a terminal, run `self-host --interactive` (or just `self-host`
with no arguments in a TTY). The menu searches the catalog, lets you combine
goals and specific apps, explains the selected services, and can save or revise
non-secret choices in a project. From an existing project directory it suggests
that directory when it finds saved app, batch, household bundle, or journey
state; it does not search other directories. For headless planning,
repeat exact catalog IDs:

```bash
self-host plan --goal photos --app docmost --compose --project-root /absolute/project --json
self-host state init --goal photos --app docmost --compose --project-root /absolute/project --json
self-host state revise --goal photos --app docmost --compose --project-root /absolute/project --select photos.photo-library=immich --json
```

`--compose` confirms the combined scope; it never installs services. The CLI
blocks unknown, duplicate, or retired IDs. An existing project cannot be
reassigned to unrelated goals; choose a fresh project directory for that.
**Set up a
household bundle** is the no-AI path for the exact Media + Photos + Docs + Vault
catalog selection. On a Linux Docker host it checks Bun, Docker, Compose and
Buildx, asks for account identity and a private-HTTPS intention, inspects the
host, and prepares an owner-only plan. Its local-Caddy default is an intended
Vaultwarden origin, not a configured route: private DNS, TLS trust and client
access remain later gates. The menu selects ten high, isolated host ports after
a bounded read-only listener check; preparation checks them again. This helps
separate concurrent projects without claiming that a port remains free forever.
Headless `bundle begin` retains its documented port defaults and explicit port
flags. The menu shows the exact bundle approval and can advance
one bounded, explicitly approved cycle to the next checkpoint, then offers
the next separate review in the same session. **Resume a
project** selects a saved bundle, shows its safe review facts, and offers the
exact next runner action only when a separate adapter approval is available.
It can continue through up to twelve reviewed checkpoints in one menu session,
asking for each approval separately. It stops at manual browser, Homarr,
and recovery gates. For the exact new host-only `vaultwarden.localhost` route,
it can generate and apply shared Caddy, bind Vaultwarden's private bridge, and
record HTTPS readiness only after the user confirms loopback resolution and
intended-browser CA trust. A custom or existing route stays with its owner.
For a newly managed media run, it can also inspect
and bind the exact media web network to the untouched Immich and Docmost inputs,
then offer their initial Compose applies together. The menu asks for each app's
approval separately, refreshes host evidence before apply, and stops for
individual recovery if either apply fails. Account setup and acceptance do
not run in parallel. Caddy transport proof, including an HTTP 502 while
Vaultwarden is absent, does not prove login, client trust, or application
acceptance. The menu resumes exact saved Caddy inputs and an applied current
checkpoint; ambiguous or stopped checkpoints require the owner's recovery
command and are never replayed as a fresh apply.
The separate **Install personal media** path checks Linux/Docker prerequisites,
asks for identity and exposure, creates a private seven-service plan, shows
its exact digest and ports, and applies only after a second explicit approval.
The indexer can be deferred without inventing a content source; that leaves
technical acceptance pending. Other catalog goals remain plans until their
adapters support a bounded interactive apply. Planning names the next supported CLI path or
says plainly when the selection remains planning-only. In CI or an AI agent, pass
explicit arguments; a
non-interactive `self-host` still prints help, and `--interactive` fails fast
without a TTY. The terminal menu uses the same catalog and planner as the
argument-driven commands. Node.js 20.12+ is required for the package; Bun is
needed for source builds and the media installer, not for catalog planning.
From **Explore apps**, a single-app plan asks directly whether to include
Homarr. For a supported recipe on Linux, **Off** continues with that app alone;
**On** offers a staged Homarr setup and onboarding first, then plans and applies
the app with its frontend on Homarr's owned bridge. Each project has its own
reviewed approval. If Homarr onboarding is declined or incomplete, the app is
not started. After app apply, the menu can prepare an owner-only attach input
using the catalog icon, optionally accept an existing browser URL, review a
separate Homarr board approval, and read back the app tile and stack Notebooks.
Leave the URL blank for a server-only link; type `later` to defer the tile.
Neither choice invents a LAN address or remote route. A saved local link works
only in a browser on the Docker host; changing it later needs a separately
reviewed repair or a manual change in Homarr. Browser reachability,
rendered layout, integrations, widgets, and live app function remain separate
checks. A mixed selection of two to eight bounded app-only recipes can continue
to an independent app batch after one explicit confirmation of every displayed
app plan and the batch digest. After the parallel Compose jobs, the TUI
continues each running app's separate account and functional checkpoints in
sequence; an interrupted or declined check remains resumable, not accepted.
With Homarr
on, the menu first completes its separate onboarding, then joins app frontends
to the verified owned bridge and offers separate tile/Notebook attachments.
Goal-composed and unsupported mixed plans remain planning-only. The TUI reviews
images, paths, private ports, and exact apply approvals without dropping a
selected stage. **Resume a project** offers Paperless's saved
login, OCR, restart, and cleanup checkpoints as well as Immich's setup path.
At app-only completion, the menu tries `app info --live` for the saved URL,
service purposes, credential-file location, exact restart command, and owned
container state. If live inspection fails, it shows the saved recap with a
runtime warning; neither recap path replays the completed apply.

The new-project picker uses this shared-project route to compile selected v2
recipes into **one** Compose project. Headless first-run adapters can run
against its saved owner; HTTP is the usual route, while an exact-owned
container command can verify non-HTTP software such as PostgreSQL. None of
this alone proves app function, cross-app links, or restart persistence. The
same route is available non-interactively on a non-root Linux Docker host with
an existing private project directory:

```bash
self-host app shared plan --project-root /absolute/project --project-id household \
  --app sonarr --app radarr --json
# Review the images, ports, units and SHARED-APPLY token in the plan.
self-host app shared apply --project-root /absolute/project --project-id household \
  --app sonarr --app radarr --approve SHARED-APPLY:household:REVIEWED_DIGEST --json
self-host app shared status --project-root /absolute/project --project-id household --json
self-host app shared setup --project-root /absolute/project --project-id household \
  --app sonarr --app radarr --json
# Review SHARED-SETUP, then run the same command with --approve SHARED-SETUP:household:REVIEWED_DIGEST.
# If it reports a step token, review that action and rerun with --approve-step APP-SETUP-ACTION:APP:REVIEWED_DIGEST.
self-host app shared handoff --project-root /absolute/project --project-id household \
  --app sonarr --json
# Add --show only in a private terminal when you need the saved password and API key values.
```

For host-only private HTTPS, the control panel offers **Set up private HTTPS**.
The headless route reviews and adds only Caddy, then separately verifies TLS:

```bash
self-host app shared https-plan --project-root /absolute/project --project-id household \
  --app homarr --app immich --hostname immich=photos.localhost --https-port 4443 --json
# Review the Caddy-only unit, exact routes, image and SHARED-HTTPS-ADD approval.
self-host app shared https-apply --project-root /absolute/project --project-id household \
  --app homarr --app immich --hostname immich=photos.localhost --https-port 4443 \
  --approve SHARED-HTTPS-ADD:household:RETURNED_DIGEST --json
self-host app shared https-proof --project-root /absolute/project --project-id household --json
# Review the public CA export and hostname probes, then repeat with:
# --approve SHARED-HTTPS-PROOF:household:RETURNED_DIGEST
```

Existing apps, passwords, keys, ports and storage are retained. This does not
change DNS, install a CA into any device, or expose public access. The CLI uses
the owned CA and an explicit loopback hostname resolution for setup requests;
it does not disable certificate verification. A saved TLS target changing
during approval stops the request rather than downgrading to HTTP. A Caddy TLS
listener is reported with its HTTPS routes, not a fabricated HTTP URL.

Use `--hostname immich=photos.home.arpa`, or an explicitly selected FQDN such as
`--hostname immich=photos.example.com`, when you need that host-only origin.
This grants no domain ownership, public exposure, or DNS cutover.
Setup and TLS probes use an exact per-request loopback
override with CA/SNI verification. This does not make the name resolve in your
browser or on other devices; LAN DNS and client CA trust remain separate work.

An interrupted **reviewed**, pre-Docker Caddy addition can be reviewed again
with the same arguments for a fresh `resume-reviewed` token. An attempted or
uncertain addition requires inspection; it is never automatically replayed.

Apps with bundled canonical-origin declarations can separately review their
own settings after a successful saved TLS proof. Initially this covers
Vaultwarden `DOMAIN` and Docmost `APP_URL`:

```bash
self-host app shared canonical-origin-plan --project-root /absolute/project --project-id household \
  --app vaultwarden --json
self-host app shared canonical-origin-apply --project-root /absolute/project --project-id household \
  --app vaultwarden --approve CANONICAL-ORIGIN:vaultwarden:RETURNED_DIGEST --json
```

Only that complete app unit is recreated; credentials and storage are not
regenerated. Continue scripted setup to verify effective settings. Vaultwarden
still requires official-client encrypted enrollment and unlock; generating a
master password is not account creation. Portainer can prepare its administrator
and save its API key, but remains setup-pending until a separately approved
Docker endpoint and its authority are verified. Neither is scored as accepted
from these source fixtures.

Some recipes depend on the saved project rather than having a fixed
`recipe.json`. The bundled app compiler declares the non-secret choices, then
the shared engine pins images and saves an immutable owner-bound recipe. The
control panel collects these choices for new projects and additions. For an
existing project:

```bash
# Review, then repeat with the returned SHARED-ADD approval.
self-host app shared add --project-root /absolute/project --project-id household \
  --app haproxy --input haproxy.target-app-id=homarr --json
self-host app shared add --project-root /absolute/project --project-id household \
  --app headscale --input headscale.canonical-origin=https://headscale.example.test \
  --input headscale.magic-dns-domain=mesh.example.test --json
```

HAProxy targets only a selected frontend in that same owner. Headscale's origin
is configuration, not DNS, ingress or client enrollment proof. These additions
also use the shared new-project path, not a standalone installer. First-run
and functional acceptance remain separate capabilities; a compiled recipe is
not proof of a working app. Restart validates the exact saved source, inputs,
images and generated configuration instead of reconstructing a guessed default.

Derived compilers are discovered from their app folders, not an app-ID router.
Activation requires `derived-recipe-adapter.json` with exactly
`{"schemaVersion":1,"kind":"shared-derived-recipe-adapter","appId":"APP-ID"}`
and a fixed `derived-recipe.ts` exporting the shared adapter contract. Declare
its non-secret inputs and app-relative source dependencies. Packaging compiles
only opted-in entries; review binds their declaration, source graph and actual
packaged executable. Changed source requires a fresh process and review—never
reuse a warm import against a new fingerprint. Staged helpers without this
declaration remain inactive.

For compatible changes to an already installed recipe, the control panel offers
**Review saved recipe changes**. The equivalent headless path is:

```bash
self-host app shared recipe-migration-plan --project-root /absolute/project --project-id household \
  --app ntfy --json
# Review the settings and exact saved unit, then use the returned approval.
self-host app shared recipe-migration-apply --project-root /absolute/project --project-id household \
  --app ntfy --approve RECIPE-MIGRATION:ntfy:RETURNED_DIGEST --json
```

This route supports only exactly reconstructed additive static environment
changes. It recreates the selected app unit, preserves credentials and storage,
and refuses incompatible image, path, port, account or privilege changes.
If interrupted at a proven pre-Docker `reviewed` checkpoint, rerun the same
plan command for `resume-reviewed` and a fresh approval. The original token is
not reused. An attempted or uncertain outcome requires inspection, not
automatic replay. Login and
application acceptance remain separate.

Update only one running app's images without changing its settings:

```bash
self-host app shared image-transition-plan --project-root /absolute/project --project-id household \
  --app homarr --json
self-host app shared image-transition-apply --project-root /absolute/project --project-id household \
  --app homarr --approve IMAGE-TRANSITION:homarr:RETURNED_DIGEST --json
```

Review the old/new immutable image pins before applying. The command verifies
the existing container owner and recreates only that app unit. Data, credentials,
ports and other apps remain unchanged. Other recipe changes are refused;
source-owned image history keeps earlier Homarr test-image projects resumable.
An uncertain attempt needs inspection, not automatic replay. Verify login,
integrations and widget data after the update; image recreation is not acceptance.

Read trusted local verification receipts without importing a report file:

```bash
self-host catalog compatibility --project-root /absolute/project --project-id household --json
```

The full catalog remains the score denominator. ntfy and Paperless-ngx have
reviewed live/restart verifiers; a complete live receipt can earn that
dimension's 20 points, not full-app acceptance. Missing receipts and
source/fixture passes earn zero. Saved recipe drift needs migration; changed or
rolled-back verification history fails closed. See [catalog compatibility](docs/catalog-compatibility.md).

Paperless verification reads an existing document that you explicitly authorize;
it does not choose a private document or upload one. Its original file must be
nonempty and at most 1 MiB. Review the returned token before beginning:

```bash
self-host app shared acceptance-begin --project-root /absolute/project --project-id household \
  --app paperless-ngx --input paperless-ngx.document-id=1 --json
# Repeat with the returned --approve token after reviewing the document scope.
self-host app shared acceptance-finish --project-root /absolute/project --project-id household \
  --app paperless-ngx --json
# Review, then repeat with its --approve token for the selected stop/start.
```

Finish reuses the saved document choice and verifies the same original bytes
after a scoped restart. It does not prove upload, OCR, or search. These source
contracts have passed focused fixtures; no live Paperless receipt is claimed.

Private HTTPS targets must already belong to that shared project; omitted
names become `APP.localhost`. The reviewed addition checks saved container
ports and the new loopback listener. It cannot replace an installed Caddy or
configure LAN/public DNS. TLS route verification does not establish browser
trust, intended-device access, or application acceptance.

For a recipe whose review lists `ownerSecretIds`, supply each declared secret
only on approved `shared apply` or `shared add` (or a pre-Docker `resume`):

```bash
self-host app shared apply --project-root /absolute/project --project-id household \
  --app example --approve SHARED-APPLY:household:REVIEWED_DIGEST \
  --secret-file example:auth-token=/absolute/owner-only/token --json
# Or pipe one nonempty payload: ... --secret-stdin example:auth-token
```

The source file must be owned by the current user and mode `0600`; stdin must
be a non-interactive pipe. The payload is saved once in the exact project's
mode-`0600` app secret file. Retry without input to reuse it, or supply the
same value; a different value is rejected. Neither the payload nor its digest
appears in the plan, approval, or ordinary status. The interactive shared
create/add flow asks for the source file path after approval. Opaque imported
files may be consumed through declared file bindings, not service environment
values (which Docker operators could inspect).

The route resolves immutable image digests again at apply, re-observes every
selected TCP port, and rejects a changed approval. It preserves data and
records a private checkpoint before Compose mutation. If preparation stopped
before Docker, `status` shows a saved `resumeApproval` only for a reviewed
path still absent or a checkpointed prepared path; use `app shared resume`
with that exact token. An attempted Compose apply is never blindly retried.
Resume rechecks the host. A path that appeared before preparation was
checkpointed needs manual inspection; it is never automatically adopted.
The shared-project compiler supports one project-owned
`<project>/.selfhost/shared/<id>/data/shared` directory. Arr/download recipes
mount it writable at `/data`; Jellyfin mounts it read-only at `/data`. Its
prepared layout includes `/data/media`, `/data/torrents`, and `/data/usenet`.
Before apply, the host probe requires the new path to be absent. These media
recipes remain inspect-only for the standalone `app apply` route; `app shared`
accepts their pinned, source-backed v2 recipes under the exact shared approval.
Shared setup reuses each app's generated password and packaged first-run
adapter where one exists. `catalog recipes --json` shows the current choices;
the setup review separates scripted apps from pending ones. Seerr reuses the
exact project's verified Jellyfin admin and saves
Seerr's own API key; it has no separate generated password. Once Jellyfin's
Movies and Shows libraries are verified, Seerr syncs, enables, and reads them
back. Arr links, initialization, and restart acceptance remain pending.
For Jellyfin libraries, select two existing directories inside its read-only
`/data` mount during shared setup:

```bash
self-host app shared setup --project-root /absolute/project --project-id household \
  --app jellyfin --input jellyfin.movies-path=/data/media/movies \
  --input jellyfin.shows-path=/data/media/tv --json
```

Review the returned `SHARED-SETUP` token, then repeat the same command with
`--approve` and any prompted `--approve-step` token. Inputs are non-secret
choices bound to those approvals; the saved setup checkpoint retains the paths
for recovery. The adapter verifies exact library name, type, and path after
creation. It does not infer or create the directories, or configure Seerr's
library selection until Seerr's separate shared setup runs.
Sonarr and Radarr also accept an explicit root folder inside their writable
`/data` mount:

```bash
self-host app shared setup --project-root /absolute/project --project-id household \
  --app sonarr --app radarr \
  --input sonarr.root-folder-path=/data/media/tv \
  --input radarr.root-folder-path=/data/media/movies --json
```

Both adapters require the selected directory to exist and pass their API
readback. Their saved passwords and API keys work without this optional step;
neither root folder configures a downloader, indexer, or Seerr connection.
When qBittorrent and either Arr app are selected in the same reviewed shared
project, qBittorrent creates only that Arr app's canonical category
(`tv-sonarr` or `movies-radarr`) under `/data/torrents`, then reads it back.
The shared setup review lists these installed-peer effects even when the
command targets only qBittorrent.
It refuses a conflicting existing path and never blindly retries an uncertain
create. The Arr download-client connections are still a separate setup step.

The normal handoff prints credential-file references; `--show` deliberately
prints their values and must not be captured in a log or screenshot.
Homarr, Immich, and Paperless-ngx have shared-owner first-run adapters. Review
`app shared setup` for current direct/pending coverage; adapter readiness does
not replace functional or restart acceptance. Recipe-declared post-first-account
environment closure uses separately reviewed `app shared transition-plan` and
`transition-apply`, followed by setup verification. Seerr's Sonarr/Radarr links,
initialization, and restart proof remain separate from
its first-admin/key checkpoint. A successful Compose start or adapter checkpoint is not full service
acceptance. No fresh shared-stack Docker run has been claimed by this route.
Rootless Docker media binds are deferred until the container UID mapping can
write that owner-only directory; the CLI does not open it with world-write bits.
Other selected host paths, extra published ports, and the legacy v1 format
remain unavailable through this route. The shared saved-project panel offers
reviewed additions and selected-app start/stop; these reuse saved units and
retain data rather than tearing down the project.

After Homarr and selected app credentials are saved, use `app shared
homarr-plan --project-root /absolute/project --project-id household --app homarr
--app sonarr --app radarr --json`. Review its tiles, supported integrations,
widgets, pending inputs, and omitted prerequisite-dependent widgets. Repeat
the same selection with `homarr-apply --approve EXACT_HOMARR_TOKEN --json` only
after approval. The command reuses saved credentials, reads dashboard resources
back, and saves an owner-only connection export; live service function and
rendered widget content remain separate checks. No manual credential copy is
needed for generated credentials supported by the selected adapters.
The same review includes internal ping-target changes derived from saved
Compose addresses. Null targets are configured automatically; custom targets
are preserved until separately reviewed. Browser-facing links stay unchanged.

To check a saved dashboard without making changes:

```bash
self-host app shared homarr-status --project-root /absolute/project --project-id household \
  --app homarr --app sonarr --app radarr --json
```

The control panel exposes the same command as **Check dashboard and recap**.
It privately reuses the saved Homarr key and board choice, then reports each
app link, integration linkage, expected widget, and Notebook content/layout.
Missing resources remain visible; duplicates, a public board, or conflicting
ownership stop the check. Readback queries run in parallel and share an
invocation-local inventory cache. No account, key, integration, or widget is
created, and no credential export is rewritten. `attached` means the dashboard
configuration matches—not that service function, integration connectivity,
rendered widget content, or restart persistence has passed. Those checks remain
separate. Required album/system selections are listed as omitted widgets rather
than made up.

The terminal recap explains recognized query failures: API-key access, route
compatibility, timeouts/rate limits, or Homarr-to-app reachability. Explanations
come from bounded status codes, never raw responses. A server error still needs
diagnosis; it does not establish that credentials or Docker DNS are wrong.

Add `--live` to the same command for fixed, read-only Homarr-server pings and
supported widget queries. Results show individual failures and omitted checks,
not raw widget data, API keys or upstream errors. A mismatched saved ping target
is refused before any request; publish its reviewed correction first.
Integration retests, browser rendering and restart persistence remain separate.
The existing image lacks the saved-integration test API proposed in
[Homarr PR #6981](https://github.com/homarr-labs/homarr/pull/6981).
These checks do not create compatibility receipts or raise the verified score.

For headless mixed-app setup without Homarr, run `self-host app batch plan --project-root
/absolute/project --app uptime-kuma=3001 --app paperless-ngx=8000
--without-homarr --json`. The JSON contains the pinned `images`, per-app
`approval`, the batch `approval`, and a ready-to-copy POSIX `applyCommand`
with equivalent `applyArgs` for script callers. Review each app's Compose
candidate, then run that exact command after approval; it includes every
pinned `--image ID=PINNED_SPEC`, each `--app-approve ID=TOKEN`, and
`--approve BATCH:DIGEST` and any selected data or Immich identity flags. No
Homarr dashboard or integration is created in this mode.
By default the plan resolves image digests from registries. If that lookup is
unavailable, a reviewed source of exact pins can be supplied to the **plan**
with one `--image APP=TAG@sha256:DIGEST` for a single-service recipe, or one
`--image APP=SERVICE=TAG@sha256:DIGEST` for each service of a multi-service
recipe. Cover every selected app; partial pin sets are rejected. This checks
the pins against bundled recipe tags but does not revalidate registry or
platform provenance. Record where the pins came from and approve the resulting
plan only if they are appropriate for this host; never guess a digest.
Without `--json`, the same plan prints its catalog job graph, service purposes,
images, paths, ports, gates, exact app approvals, and the final batch command.
For a connected batch, first apply and onboard the standalone Homarr recipe
with its own exact approvals; `self-host app status --id homarr --project-root
/absolute/project --live --json` must show an applied, onboarded, running
project. Then use `--connect-homarr` instead of `--without-homarr` in the batch
plan and apply. The returned batch approval binds Homarr's exact project and
bridge. App tiles and Notebooks still need separate `app homarr-input` and
`homarr attach plan|apply|status` approvals and read-backs; integrations,
widgets, rendered layout, and browser reachability are further checks. The CLI
re-inspects the exact plans and approvals, writes a mode-0600 ledger at
`<project>/.selfhost/app-batch.json`, and starts at most two independent app
projects at a time. Read `self-host status --project-root /absolute/project
--json` afterward; it delegates to `app batch status` for this saved batch and
infers the saved Homarr mode. `self-host info --project-root /absolute/project`
also lists each service's purpose, saved URL, data and credential-file location,
plus any additional app checkpoints outside the batch. `recorded` means the
ledger and saved app states agree, not that login, app function, restart, or
backup restore passed. `needs-inspection` means an app or job needs review;
batch apply cannot be retried. In the interactive journey, a partial batch can
continue account and acceptance checks for jobs that independently match their
saved approval and running resources; it asks first and leaves failed jobs
untouched. A connected batch also requires Homarr's saved running project.
A version-3 ledger can dispatch one job still
marked `pending` after a fresh plan and separate approval:

```bash
self-host app batch resume-plan --project-root /absolute/project --job paperless-ngx --json
# Copy the fresh approval only after reviewing that exact pending app plan.
self-host app batch resume --project-root /absolute/project --job paperless-ngx \
  --approve BATCH-RESUME:REVIEWED_DIGEST --json
self-host app batch status --project-root /absolute/project --json
```

For a recorded, running Uptime Kuma job, the first post-apply graph step can
prepare its private administrator credential without claiming an account login:

```bash
self-host app batch step-plan --project-root /absolute/project --job uptime-kuma --json
# Review the fresh account plan and copy its exact BATCH-STEP approval.
self-host app batch step --project-root /absolute/project --job uptime-kuma \
  --approve BATCH-STEP:REVIEWED_DIGEST --json
self-host app batch status --project-root /absolute/project --json
```

The batch step rechecks its original app and Homarr ownership, running state,
and the exact credential plan under the batch lock. It saves an attempted
checkpoint before invoking the app's credential writer. If interrupted,
inspect the named app and owner-only credential file; the batch will not
blindly repeat a possible write. Account creation/login, monitor proof, app
acceptance, and Homarr attachment still have separate approvals. Other apps do
not yet have an executable post-apply batch step.

The CLI takes an exclusive owner-only batch lock, rechecks the bundled catalog,
Homarr prerequisite, original images and ownership, and records
`launch-attempted` before the child starts. A live executor or stale lock
blocks dispatch; after confirming no batch process is active, inspect and
remove only the exact lock path reported by the CLI. `launch-attempted`,
`inspect-checkpoint`, and `blocked` jobs are never batch-replayed. Older ledgers
cannot reconstruct the exact inputs; use each app's saved `app status` and
separately approved recovery path. Each mutating `app` command also holds an
owner-only lock for its app ID. A concurrent command targeting that app fails
closed; read-only plan/status remain
available. `app apply`, `app resume`, and `app up` also lock their selected or
saved host port within this project through Compose apply. Batch children use
the same lock, so distinct app IDs in this project cannot race for one port;
disjoint ports still run concurrently. This does not reserve a port
across different project roots or unrelated processes, so the fresh host check
and Docker bind remain necessary. Mutating app commands require a project root
without group or world write access because these temporary locks live there.
A stale per-app or port lock
reports its exact path and requires confirmation
that no matching CLI process is active before manual removal. Distinct app IDs
remain independent for other resources, so inspect their shared paths before
concurrent operations. After an interrupted apply or separate repair,
`app batch status` checks its original approval and exact running resources;
`recovered-unverified` means all saved app applies now match, while the batch
ledger keeps its historical outcomes. This is not account or functional
acceptance. A stopped app or unavailable Docker inspection is
`needs-inspection`; saved URLs, service purposes, and credential-file paths
remain visible for recovery. If an isolated app child fails, the
owner-only batch ledger and `app batch status --json` retain only its bounded
failure code, not raw output or credentials. This code points to the first
diagnostic; it does not prove that the child made no partial writes.
**Resume a project** shows saved batch job history alongside current per-app
runtime and Homarr inspection states. For a sole batch owner, it can review
and approve one pending job through that same CLI route before offering per-app
checkpoints. It never replays an attempted job. The batch route is experimental and
Linux-only for apply; the menu
requires the exact independent-app graph (and the dashboard prerequisite when
Homarr is selected).
Plans return a read-only `workflow.jobs` graph with dependencies and phase
gates, plus `workflow.parallelGroups`. The TUI shows every planned job's owner,
prerequisites, and plain-language gates before saving the selection; it does
not treat that display as apply approval. The shared executor allows a later
job to reuse its prerequisite's mutable resources, but rejects independent
jobs that claim the same resource. Ready jobs run concurrently only when their
ownership is disjoint. The current batch route executes approved Compose-apply
jobs and Uptime Kuma's separately approved credential-preparation step; other
account, Homarr, and acceptance gates are still outside the batch executor. In the household plan, media
comes first; after its internal web network is inspected and bound, Immich and
Docmost are a candidate parallel group. Homarr attachments wait for selected
apps. These groups are not approvals or running jobs. After media-web routing,
`bundle parallel-plan` reviews both initial app applies; `bundle parallel-apply`
executes those two graph jobs with bounded concurrency, distinct project/port
ownership, separate exact adapter tokens, and isolated processes. Both the TUI
and headless route require the current bundled graph to bind exactly
`media → {app-immich, app-docmost}` with its declared
gates; a changed graph leaves the sequential `bundle run` path available.
Before launching either job, the CLI creates a private
`.selfhost/bundles/ID/parallel-apply.json` history. Each job is recorded as
launch-attempted just before its child is invoked, then as applied or needing
checkpoint inspection. `bundle status` and the TUI recap show that saved progress. A
second `parallel-apply` is refused, including after an interrupted run; inspect
the exact Immich and Docmost adapters before a separately reviewed recovery.
Account setup and acceptance remain separate. `bundle run`
still follows its sequential checkpoint order.
Use `self-host doctor --scope plan` for the local catalog/TUI prerequisites,
including on macOS and Windows. `self-host doctor` (or `--scope media`) checks
the current Linux Docker deployment path. Planning on macOS or Windows does
not mean the existing Linux-only apply adapters can deploy there; a remote
Linux host or a future platform adapter is still required.
`self-host target list --json` discovers already-running WSL or Lima Linux
guests without starting them. In a terminal, `self-host target launch --name
EXACT_RUNNING_GUEST` opens the CLI already installed inside that guest, starting
in its Linux home directory so a new project is not suggested on a host mount.
This is an explicit target handoff, not VM provisioning or native macOS/Windows
apply. Check the guest architecture and Docker setup, then independently verify
host-visible ports and CA trust before claiming access from the host.
For Windows, the existing Linux apply CLI can be run inside a WSL2 distro
with Docker Desktop integration, for example `wsl -d Ubuntu -- self-host
--interactive` after installing the CLI in that distro. Keep the project on
the distro's Linux filesystem. On macOS, `limactl shell INSTANCE self-host
--interactive` can enter an already prepared Lima Linux guest with its own
Docker Engine and installed CLI. These are guest-side commands, not native
apply support: verify host-side forwarded ports and private exposure
separately. The current household bundle still requires an x86_64 Linux
guest, so an ordinary Apple Silicon ARM guest is not supported for it.

| What you need | Command | Effect |
| --- | --- | --- |
| Open the control panel | `self-host` | Opens a saved project when found; otherwise offers new app selection and the existing planning/setup routes. `--interactive` is equivalent. |
| Prepare a household bundle | `self-host --interactive` → **Set up a household bundle** | Catalog-checked Linux setup; host inspection and plan first, separate approvals afterward. |
| Check prerequisites | `self-host doctor` | Reports installed tools; does not install them. |
| Choose apps | `self-host catalog search photos` | Searches the bundled catalog. |
| Inspect an app recipe | `self-host catalog recipe uptime-kuma --json` | Shows a validated, read-only Compose candidate and its digest; it installs nothing. |
| Find app-only recipes | `self-host catalog recipes --json` | Lists validated bundled recipes with service count, default port, and apply maturity. An available apply route is not application acceptance. |
| Inspect a multi-service candidate | `self-host catalog recipe paperless-ngx --json` | Shows the experimental three-service Paperless/Valkey/PostgreSQL model and private-file inputs. Login and document checks remain separate. |
| Inspect Immich's recipe | `self-host catalog recipe immich --json` | Shows its four-service topology and experimental bounded apply route; app acceptance is separate. |
| Resolve Immich's image indexes | `self-host app image --id immich --json` | Reads the official recipe's four registry indexes without changing Docker resources. |
| Plan Immich | `self-host app plan --id immich --project-root /absolute/project --resolve-images --port 2283 --json` | Inspects the exact host and Compose candidate; returns its apply approval. |
| Check one Immich photo | `self-host app photo-check --id immich --project-root /absolute/project --approve APP-PHOTO-CHECK:immich:REVIEWED_DIGEST --json` | After setup closure, logs in as the saved admin, uploads a tiny synthetic photo, retrieves identical bytes, and moves that exact asset to recoverable trash. `app status` supplies the token; restart persistence remains separate. |
| Prove Immich restart persistence | `self-host app persistence-start --id immich --project-root /absolute/project --approve APP-PERSISTENCE-START:immich:REVIEWED_DIGEST --json` | Saves one exact canary; separately approve `app down` and `app up`, then use `app persistence-finish` with its current status token to check the same asset after restart. |
| Resolve its images | `self-host app image --id paperless-ngx --json` | Reads three registry indexes and returns one immutable digest per service when Docker Buildx is available; it changes no Docker resources. |
| Plan a catalog app | `self-host app plan --id uptime-kuma --project-root /absolute/project --resolve-images --port 3001 --json` | Resolves its immutable registry index, inspects local port/data-path facts, and returns an exact apply token; changes nothing. |
| Resolve a recipe image | `self-host app image --id uptime-kuma --json` | Reads the registry index and checks this machine's Linux architecture; returns a pinned image to copy into `app plan`. No Docker resources are changed. |
| Apply the reviewed recipe | `self-host app apply --id uptime-kuma --project-root /absolute/project --image louislam/uptime-kuma:2@sha256:DIGEST --port 3001 --approve APP-APPLY:uptime-kuma:REVIEWED_DIGEST --json` | Re-inspects a local Linux Docker host, records a private checkpoint, renders and starts only that Compose project. App acceptance remains separate. |
| Inspect or resume a recipe | `self-host app status --id uptime-kuma --project-root /absolute/project --json` | Shows the saved stage, URL and data path; `app resume` needs the saved token and refuses ambiguous partial Docker resources. Add `--live` on the Linux host with Bun and local Docker access for a read-only check of the exact owned Compose containers and network. Container health is not app acceptance. |
| Explain a saved app | `self-host app info --id paperless-ngx --project-root /absolute/project --json` | Shows saved services, their recipe-backed purposes when still available, URL, data and credential references, plus exact restart/resume argument lists. Without `--json`, it prints copyable commands. Add `--live` to check owned containers; this does not prove login, app function, or restart persistence. |
| Use an app-only project | `self-host info --project-root /absolute/project --json` | Detects one saved app or a saved mixed-app batch without a media, bundle, or legacy stack owner. For a batch, `info/status` summarize its ledger and saved app states; start, stop, and recovery still require one exact app ID and approval. For one app, top-level `up`, `down`, and `resume` delegate to its engine. `--live` applies only to a single app. |
| Stop or restart a recipe | `self-host app down --id uptime-kuma --project-root /absolute/project --approve APP-DOWN:uptime-kuma:REVIEWED_DIGEST --json` | `app status` returns separate up/down tokens. Each action checks the exact Compose file, container and network ownership labels; `down` stops without removing data, and `up` starts the same project. |
| Prepare first-account credentials | `self-host app account-plan --id uptime-kuma --project-root /absolute/project --username admin --json` | Review the private `.env` target and account approval, then run `app account-prepare` with that exact token. This prepares credentials, not an app account. |
| Export the full private handoff | `self-host app handoff --id uptime-kuma --project-root /absolute/project --show` | Explicitly prints username, generated password, and URL from the owner-only `.env`. Omit `--show` to print only its path. |
| Inspect saved choices | `self-host config show --project-root /absolute/project` | Reads non-secret project preferences. |
| Resume a household setup | `self-host bundle next --project-root /absolute/project` | Returns the current checkpoint and exact next command. |
| Review pending approvals | `self-host bundle approvals --project-root /absolute/project` | Shows review tokens without applying them. |
| See what is running | `self-host bundle status --project-root /absolute/project` | Reads the household bundle's state. |
| Get links and explanations | `self-host bundle info --project-root /absolute/project` | Summarizes household services and private credential-file paths. |
| Export saved credentials | `self-host bundle handoff --project-root /absolute/project --input /absolute/project/.selfhost/bundles/home/household-bundle.json` | Writes an owner-only `.env`; prints its path, not its contents. |

The runtime catalog reads app folders independently. Removing an optional
`apps/<id>/manifest.json` folder from a custom package removes that app, its
dependent apps, and goals whose required default is missing. It does not
silently choose another app. `self-host catalog validate` remains the strict
publication check and reports the resulting dangling references until the
catalog recipes are updated. Homarr's catalog record remains required.

You can preview a JSON catalog data directory outside the package without rebuilding
the CLI:

```bash
self-host catalog search uptime --catalog-dir /absolute/catalog --json
self-host catalog recipe uptime-kuma --catalog-dir /absolute/catalog --json
self-host plan --app uptime-kuma --project-root /absolute/project --catalog-dir /absolute/catalog --json
self-host state init --app uptime-kuma --project-root /absolute/project --catalog-dir /absolute/catalog --json
self-host state resume --project-root /absolute/project --json
```

The directory must contain `taxonomy.json`, `affiliates.json`, `apps/`, and
`stacks/` in the packaged layout. The CLI reports its canonical source path
and SHA-256 fingerprint; a missing optional app is unavailable rather than
silently read from the package. Packaged workflow IDs and Homarr integration
identifiers remain authoritative. Project state saves the source path and
fingerprint. Resume uses the saved path and reports source drift; use
`state revise` with the same goal to review changed data and reset progress.
External catalogs remain **read-only data**: the interactive installer, app
apply, and external apply/verification checkpoints do not use them yet.
External support claims and recipes need separate review before deployment.
The terminal menu can browse an external directory and plan from it. For a
saved project, it reuses that project's catalog automatically; choose a new
project directory if you want a different source.

The interactive menu offers the media and household installers only while their
default catalog plans match the fixed installers. Headless preparation makes
the same check before creating a run. App records with `cliSetup` expose an existing
bounded CLI route in the plan; they are still guided setups with separate
application acceptance, not one-command installs. New media and household
preparation, plus standalone app apply, refuse missing catalog features before
creating or changing a project. Read-only status and scoped upkeep remain
packaged so an existing project can still be inspected.

On Linux, **Set up one app** lists bundled recipes whose scoped apply route is
available. Homarr is offered by default but can be switched off. With Homarr
on, its separate project is onboarded before the app plan; only the app
frontend joins the approved bridge. The optional tile-and-Notebook step uses
the same `app homarr-input` and `homarr attach plan|apply|status` commands as
headless setup. A supplied browser URL is labeled unverified until checked on
the intended device. A blank menu URL uses the existing CLI's host-local link,
not a guessed LAN route; no **View dashboard** acceptance is inferred from the API
read-back alone. For Uptime Kuma, it can continue through a second exact
approval to the native integration and widget after a status page exists. It
uses a separate owner-only input, asks for a non-default slug through a masked
prompt and private stdin, and
reports populated, empty, and live-unverified widget states distinctly.
The wizard resolves pinned images and
reviews each exact project, private port, data path, and approval.
**Resume a project** finds saved app checkpoints and offers exact start/stop
or partial-apply resume without creating a duplicate. For Uptime Kuma, the
menu can prepare an owner-only admin password under a separate approval; the
first account and monitor still need direct checks. For Paperless-ngx, apply
prepares the private admin password and the menu points to its handoff; login,
document/OCR, and restart checks still need direct verification.

`app ... --json` returns a nonzero, parseable `status: "failed"` result on
failure, with the failed command, a bounded error code, and
`partialWritePossible`. `mutation: null` means a mutating step may have left a
checkpoint: inspect `app status` and exact resource ownership before retrying.
For a read-only failure, rerun the same command without `--json` locally for
the detailed diagnostic. The TUI shows the safe error code but never echoes
raw child output.

Homarr has an experimental one-container recipe independent of the seven-service
media harness. Plan with `self-host app plan --id homarr --project-root
/absolute/project --resolve-images --port 7575 --json`, then apply with the
returned pinned image as `--image homarr=TAG@sha256:DIGEST` and the exact
approval; this recipe uses the multi-service image-argument format even though
it currently runs one container. A bare `--image TAG@sha256:DIGEST` is invalid.
It creates private `/appdata`, a
64-character encryption key, and an admin password file. Run `self-host app
status --id homarr --project-root /absolute/project --json` to get the exact
`approvals.onboard` token, then `self-host app onboard --id homarr --project-root
/absolute/project --approve REVIEWED_ONBOARD_TOKEN --json`. This API-first step
creates or reverifies the admin, submits zero integrations to the initial
personal-board setup, and stores an API key in a private mode-0600 file. It
checkpoints irreversible attempts and stops on uncertain retries. `app handoff
--id homarr --project-root /absolute/project --show` explicitly prints the
admin password and, after successful onboarding, the API key. Board content,
Notebook, integrations, widgets, and restart persistence remain separate
acceptance checks. No Docker socket is mounted.

Optional Homarr MCP uses the CLI directly; no installed Agent Skill or target-side
Bun is needed. After shared setup, get the existing `apiKeyFile` reference from
`self-host app shared handoff --app homarr --project-root /absolute/project
--project-id EXACT_ID --json`. For a legacy standalone owner, use `app handoff
--id homarr` instead. Reuse the returned URL and key file without `--show` or
creating another key, then prepare a separate read-only profile:

```bash
self-host homarr mcp prepare --project-root /absolute/project --profile read-only \
  --base-url http://127.0.0.1:7575 --api-key-file /absolute/reviewed/homarr-api-key \
  --require-read-only
self-host homarr mcp status --project-root /absolute/project --profile read-only
self-host homarr mcp verify --project-root /absolute/project --profile read-only
self-host homarr mcp fragment --project-root /absolute/project --profile read-only --format codex
```

The key is read from an owner-only mode-0600 file into the private profile; it
never enters command arguments or the generated client fragment. `verify` checks
canonical MCP authentication and the read-only bridge, not dashboard acceptance.
`--require-read-only` rejects a preexisting policy-enabled profile before key
import; the interactive flow always uses this guard.
`fragment` writes a secret-free, no-clobber file under the profile and does not
install it. Review the target client config and obtain the separate literal
`INSTALL-MCP:read-only` approval before a merge. Shared dashboard publication
offers this same profile, and the saved control panel has **Set up Homarr MCP**.
Legacy standalone Homarr setup also offers it after onboarding. Each can generate a client fragment;
declining it leaves Homarr setup unchanged. The fragment launches the
installed CLI itself, so a native binary does not leave a client pointing at
its temporary extraction directory. MCP profiles currently require POSIX
ownership checks and are unsupported on Windows native binaries. The CLI creates
no capability policy; an approved `media-request` or `integration-request`
policy must be selected separately through the Homarr workflow before generating
its capability-labeled fragment.

For a fresh app plan in the same project root, repeat `--connect-homarr` on
both `app plan` and `app apply` after Homarr onboarding. The plan checks the
exact Homarr-owned bridge and binds it to the approval; apply joins only the
app frontend to that bridge. Database and cache containers stay on their app's
private network. This does not attach an already-applied app, create a tile,
configure an integration, or prove the endpoint works from Homarr. Use the
separate `homarr attach` commands and live checks for those steps.

Uptime Kuma has a functionally checked Linux apply preview. Paperless-ngx has
an experimental three-service Compose apply path:
`self-host app plan --id paperless-ngx --project-root /absolute/project
--resolve-images --port 8000 --json`. For a separately reviewed image source,
pass each digest as `--image SERVICE=IMAGE@sha256:DIGEST` instead.
Copy all three returned image values into repeated `--image SERVICE=...`
arguments for `app apply`, along with the exact plan's `--approve` token,
project root, and port. Apply prepares owner-only application, database, and
admin-password files, supplies Paperless's first-admin creation settings,
renders one scoped Compose project, and starts it. Database, broker, data, and
media are exact project-owned Docker volumes; `consume` and `export` use
project-path binds. Back up both storage types. `app status`, `app resume`,
and separately approved `app down`/`app up` use the saved project. `app handoff`
returns the private password-file path; `app handoff --show` explicitly prints
the full admin `.env`. Once all three services are running, use
`self-host app login-check --id paperless-ngx --project-root /absolute/project
--json` to verify the managed credentials against Paperless's private user API.
The check requires exactly one active superuser matching the configured admin;
it neither prints nor saves the password. This proves login only. Next, read
`approvals.documentCheck` from `app status` and approve one synthetic PNG upload:

```bash
self-host app status --id paperless-ngx --project-root /absolute/project --json
self-host app document-check --id paperless-ngx --project-root /absolute/project \
  --approve APP-DOCUMENT-CHECK:paperless-ngx:SAVED_STATUS_DIGEST --json
```

If Paperless is still processing, the command returns `processing` with a saved
task UUID. Read a fresh approval from `app status` and rerun the same command;
it will inspect that task or saved document, not upload again. A passed result
requires OCR text and exact original-byte SHA-256 readback. If the upload
response was lost before its task UUID could be saved, the CLI stops at
`upload-attempted`: inspect the exact canary title before any recovery. The TUI
offers the same steps after apply or on resume. The canary remains in Paperless
for a separately approved restart check. Read `approvals.persistenceStart`,
then review and run `app down` and `app up` with their own fresh status tokens,
and finally run `app persistence-finish` with `approvals.persistenceFinish`.
The finish command rechecks admin login, OCR, and original bytes before
recording restart acceptance. The test document remains in Paperless until you
separately approve `app document-cleanup`. That action checks the exact saved
document and moves it to recoverable trash, then reads the trash back. A retry
checks trash first, so a lost response cannot cause a blind second delete. An
isolated rootless trial passed these steps; the repository's
`product/control-panel-proof.md` records the exact proof boundary.
The API has no ID-filtered trash lookup; if its bounded scan cannot cover a
large trash history, cleanup stops for manual inspection.

```bash
self-host app persistence-start --id paperless-ngx --project-root /absolute/project \
  --approve APP-PERSISTENCE-START:paperless-ngx:SAVED_STATUS_DIGEST --json
self-host app status --id paperless-ngx --project-root /absolute/project --json
self-host app down --id paperless-ngx --project-root /absolute/project \
  --approve APP-DOWN:paperless-ngx:SAVED_STATUS_DIGEST --json
self-host app status --id paperless-ngx --project-root /absolute/project --json
self-host app up --id paperless-ngx --project-root /absolute/project \
  --approve APP-UP:paperless-ngx:SAVED_STATUS_DIGEST --json
self-host app status --id paperless-ngx --project-root /absolute/project --json
self-host app persistence-finish --id paperless-ngx --project-root /absolute/project \
  --approve APP-PERSISTENCE-FINISH:paperless-ngx:SAVED_STATUS_DIGEST --json
self-host app status --id paperless-ngx --project-root /absolute/project --json
self-host app document-cleanup --id paperless-ngx --project-root /absolute/project \
  --approve APP-DOCUMENT-CLEANUP:paperless-ngx:SAVED_STATUS_DIGEST --json
```

Use the fresh token from each preceding status output; do not reuse one token
for a different action. The TUI offers the same separately reviewed sequence.
Recoverable trash may be emptied later by Paperless's retention settings; do
not treat the cleanup as a backup. Saved acceptance is historical, not a claim
that the app is healthy now.

After a later stop makes that proof stale, renew only after the prior canary is
confirmed in recoverable trash. The renewal archives its document ID and proof
times in the owner-only project state, chooses a distinct title, and creates no
document. Then repeat `document-check`, `persistence-start`, the separate
`down`/`up` approvals, `persistence-finish`, and cleanup for the new canary:

```bash
self-host app document-renew-plan --id paperless-ngx --project-root /absolute/project --json
self-host app document-renew --id paperless-ngx --project-root /absolute/project \
  --approve APP-DOCUMENT-RENEW:paperless-ngx:REVIEWED_DIGEST --json
self-host app status --id paperless-ngx --project-root /absolute/project --json
```

Use the fresh `approvals.documentCheck` from that status. An uncertain upload
still stops at its saved checkpoint; renewal never replays it.

Immich has an experimental four-service generic apply route. Run `app plan`
with `--resolve-images`, review its exact images, paths, port, and approval,
then pass all four returned `SERVICE=IMAGE@sha256:DIGEST` values to `app apply`
with the same project root, port, and `--approve` token. Optionally pass
`--email you@example.com --name "Your Name"` to both commands; the selected
first-admin identity is bound to the approval. Without those flags, the
defaults are `admin@example.test` and `Admin`. The TUI asks for these values
and accepts Enter for the defaults. After it starts, use
`app status --id immich --project-root /absolute/project --json` for the
separate `approvals.onboard` token. Run `app onboard --id immich
--project-root /absolute/project --approve TOKEN`; it saves an attempt before
the first API signup and verifies managed login on retry. Then run `app
close-plan --id immich --project-root /absolute/project --json`, review the
owned resources and `IMMICH_ALLOW_SETUP=false` change, and run `app
close-setup --id immich --project-root /absolute/project --approve TOKEN`.
After closure, take `approvals.photoCheck` from `app status` and separately
approve `app photo-check --id immich --project-root /absolute/project
--approve TOKEN`. If a request fails after upload, status retains the exact
test asset ID and digest; retry checks that asset without uploading another.
For restart proof, take `approvals.persistenceStart` from status and run
`app persistence-start` with that token. It leaves a second exact test photo
in the library. Review `approvals.down` and `approvals.up` separately, then
run `app down` and `app up` with their respective tokens. Once the exact
services are healthy, status exposes `approvals.persistenceFinish`; run
`app persistence-finish` to re-read the saved photo, compare its SHA-256,
record acceptance, and move it to recoverable trash. Acceptance is checkpointed
before cleanup. If trash is unconfirmed, `app status` retains the exact asset ID
and a new `approvals.persistenceFinish` for cleanup-only retry; no new upload or
restart is sent. An interrupted start also reuses its saved canary without
another upload. `app status` reports recorded proof but does not inspect current
health; a later stop makes the proof stale. Resolve pending cleanup before
starting another proof. The terminal menu
offers each stage with its own confirmation. Use
`app handoff --id immich --project-root /absolute/project --show` only when
you explicitly want the secretful `.env`. Homarr integration and backup
recovery remain separate even after restart proof. The
older `self-host immich` adapter remains available.

By default, an app's data lives at `<project>/.selfhost/app-data/<app-id>`.
For a different disk, pass `--data-parent /absolute/owned/directory` to both
`app plan` and `app apply`; the CLI creates only a new `<app-id>` child there.
The parent must already exist, be owned and writable by the current user,
have no symlink traversal, and not be writable by other users. Planning
inspects its local filesystem and free space, and the exact child path is
bound into the approval and saved for resume. This does not adopt existing data.

```bash
self-host app plan --id paperless-ngx --project-root /absolute/project \
  --resolve-images --port 8000 --json
self-host app apply --id paperless-ngx --project-root /absolute/project \
  --image paperless-ngx=ghcr.io/paperless-ngx/paperless-ngx:3.2.1@sha256:REVIEWED_DIGEST \
  --image broker=docker.io/valkey/valkey:9-alpine@sha256:REVIEWED_DIGEST \
  --image db=docker.io/library/postgres:18@sha256:REVIEWED_DIGEST \
  --port 8000 --approve APP-APPLY:paperless-ngx:REVIEWED_PLAN_DIGEST --json
```

Replace every digest and the approval with the exact values returned by the
plan. `app status --id paperless-ngx --project-root /absolute/project --json`
reports resume or restart approvals without reading secret payloads. Use
`self-host app handoff --id paperless-ngx --project-root /absolute/project
--show` only when you want the full secret-bearing `.env` on stdout.
For Uptime Kuma, `--resolve-images` resolves its immutable index digest during
`app plan`; then review the returned `APP-APPLY` token and exact
image, port, data path, and Docker context.
Apply requires local Linux Docker, Bun 1.4+, and Bash.
`app image` uses Docker Buildx to read upstream registry manifests. It accepts
fixed tags or exact `repository@sha256:DIGEST` references and rejects a missing
or ambiguous Linux manifest for this machine's architecture. For a single-image
manifest, it verifies the raw manifest digest and digest-bound configuration
bytes before trusting the platform. Config reads are anonymous HTTPS pulls
from reviewed public registries; private or unsupported authentication fails
closed. Existing multi-platform Buildx resolution retains its authentication
path. Multi-service recipes resolve up to three independent images concurrently;
resolution is read-only. Copy the plan's `image` value into `app apply`;
the approval binds that exact digest. Planning also accepts an operator-supplied
digest but does not independently re-query the registry. If apply stops after
recording `approved` or `rendered`, inspect `app
status`, correct the cause, then run `self-host app resume --id uptime-kuma
--project-root /absolute/project --approve SAVED_TOKEN`. Resume only continues
when fresh inspection finds no project container or network; otherwise stop
for exact ownership review. After a successful apply, obtain separate tokens
from `app status`, then use `app down` and `app up` to restart this exact project.
Those commands verify Compose container/network ownership labels and leave the
data mount in place. New project roots receive distinct deterministic Compose
project and network names; pre-existing `selfhost-uptime-kuma` projects remain
readable and restartable. Compose success does not prove first-account setup,
a working monitor, or post-restart login.
One isolated rootless-Linux trial on 2026-09-28 completed those checks; other
hosts and macOS/Windows Docker deployment remain unproven. This trial is not a
measured ease score.

```bash
self-host app plan --id uptime-kuma --project-root /absolute/project \
  --resolve-images --port 3001 --json
# Copy the returned image and reviewed approval into app apply.
```

For a first account, the CLI can generate and remember an owner-only password
without claiming that the account exists yet. Review the file-only plan, pass
its exact approval, then review the separate `app status` onboarding token.
The experimental Uptime Kuma v2 `app onboard` checks the saved login first,
sends at most one `setup` Socket.IO event after a durable attempted checkpoint,
and checks the login again. An interrupted attempt is never blindly replayed;
inspect its saved stage and use the browser fallback if the upstream socket contract has
changed. This source path has not yet had a fresh live trial. A repeated
credential prepare reuses the same file and password. The request shape follows
Uptime Kuma v2.5.5's [setup page](https://github.com/louislam/uptime-kuma/blob/2.5.5/src/pages/Setup.vue)
and [server handlers](https://github.com/louislam/uptime-kuma/blob/2.5.5/server/server.js).
For an account you already created, use `--adopt-existing` on both account commands after
placing an owner-only `<project>/.selfhost/credentials/<app-id>.env` with the
expected `APP_ID_USERNAME`, `APP_ID_PASSWORD`, and `APP_ID_URL` keys. The CLI
validates and records that reference without printing the password by default.

```bash
self-host app account-plan --id uptime-kuma --project-root /absolute/project \
  --username admin --json
self-host app account-prepare --id uptime-kuma --project-root /absolute/project \
  --username admin --approve APP-ACCOUNT:uptime-kuma:REVIEWED_DIGEST --json
self-host app status --id uptime-kuma --project-root /absolute/project --json
self-host app onboard --id uptime-kuma --project-root /absolute/project \
  --approve APP-ONBOARD:uptime-kuma:CURRENT_STATUS_DIGEST --json
self-host app handoff --id uptime-kuma --project-root /absolute/project
self-host app handoff --id uptime-kuma --project-root /absolute/project --show
```

`--show` is intentionally secrets-full: keep its output out of logs and issue
comments. `app onboard` proves only the saved admin login at that moment.
Optionally review and approve a CLI-created local self-check. It targets
`http://127.0.0.1:3001/` **inside Uptime Kuma's own container** every 60 seconds;
it is not an external availability check. The create path saves an attempted
checkpoint before emitting Uptime Kuma v2.5.5's internal Socket.IO `add` event,
then reads back the exact monitor. An uncertain reply requires inspection; it
will not blindly emit a second `add`. The TUI offers this path or an existing
monitor. You can still create a useful external target in the UI. The
[upstream API warning](https://github.com/louislam/uptime-kuma/wiki/Internal-API)
applies: this interface is not a stable third-party contract. Automated
creation requires the live server to report exactly v2.5.5; the floating v2
recipe may resolve a newer image, in which case choose the UI path. The exact
approval binds the full configuration. The create path is source-built but has
not had a fresh live trial.

Then use the read-only monitor list and plan to choose an **up** monitor. The
exact approved check records a baseline.
Stop and start only this app with the separate tokens from `app status`, then
plan and check the same monitor again. `app up` first records the latest
heartbeat after startup; the final check requires a newer successful heartbeat,
then re-verifies the admin login and target identity before recording persistence. The monitor
readback uses Uptime Kuma's version-sensitive internal Socket.IO API; if its
reply shape changes, the CLI stops and the browser path remains available.
The current readback handles HTTP, ping, and TCP-port monitors; other monitor
types need browser inspection.
Neither path proves browser layout.

```bash
self-host app monitor-create-plan --id uptime-kuma --project-root /absolute/project --json
self-host app monitor-create --id uptime-kuma --project-root /absolute/project \
  --approve APP-MONITOR-CREATE:uptime-kuma:REVIEWED_DIGEST --json
# Wait for the newly created monitor to report up, or use an existing up monitor.
self-host app monitor-list --id uptime-kuma --project-root /absolute/project --json
self-host app monitor-plan --id uptime-kuma --project-root /absolute/project --monitor-id 1 --json
self-host app monitor-check --id uptime-kuma --project-root /absolute/project \
  --monitor-id 1 --approve APP-MONITOR:uptime-kuma:REVIEWED_DIGEST --json
self-host app status --id uptime-kuma --project-root /absolute/project --json
self-host app down --id uptime-kuma --project-root /absolute/project \
  --approve APP-DOWN:uptime-kuma:REVIEWED_DIGEST --json
self-host app up --id uptime-kuma --project-root /absolute/project \
  --approve APP-UP:uptime-kuma:REVIEWED_DIGEST --json
# Repeat monitor-plan, then monitor-check with its fresh approval.
```

A username other than `admin` can be chosen;
custom password input is not yet supported by the generated-credential route.

Start a new setup with `bundle begin` below. To resume, use `bundle next`
instead of creating a second run. A failed step should be inspected or resumed,
not repaired by deleting containers or regenerating account credentials.
Lifecycle commands require the exact existing input and approval; `down`
preserves data. Multiple household bundles require an explicit `--input`.

## Prepare a household stack

For a fresh four-service household bundle, the interactive menu collects
defaults without requiring you to know a LAN IP, DNS owner, or client list
up front. For scripts or headless runs, `bundle begin` is the preparation
command. Create one exact project directory first, then provide
the account identity, private HTTPS origin/owners, and either registry-resolved
or reviewed immutable images:

```bash
mkdir -m 700 -p /absolute/project
self-host bundle begin --project-root /absolute/project --id home \
  --email admin@example.com --name "Home Admin" --resolve-images \
  --vaultwarden-origin https://vaultwarden.localhost:28443 \
  --https-route-owner caddy-home --https-tls-owner caddy-home
```

`begin` starts the owner-only same-boot journey journal, runs the bundled
bounded host probe with exact selected-port checks, creates the mode-`0600`
report and eight owner-only bundle inputs, then prints the fingerprinted
`bundle plan` as one JSON document on stdout; preparation progress goes to
stderr. It defaults new media to `--media-bind-mode host-only`; use
`all-interfaces` only with a reviewed private firewall scope. Choose
`--media-port-start FIRST` to check seven exact media ports as well. This
command performs no Docker apply, image pull, HTTPS readiness assertion, or
service acceptance. Review its plan and use read-only `bundle next` to inspect
the first checkpoint; `bundle run` still requires each exact approval before
mutation. If preparation stops, inspect the
reported path and use the separate `journey status`, `inspect-host`, `bundle
init`, and `bundle plan` commands below to resume; repeating `begin` never
overwrites an existing journal, report, or bundle.

To extend a project with an existing CLI-managed media run, choose **Set up a
household bundle** in the terminal menu and select that project. It reads the
run's validated CLI config, approved media plan, and live seven-service status,
then asks whether to reuse it. Only the three new app ports are chosen; the
media run keeps its data, bind, ports, networks, and approval. An all-interface
run requires an explicit private-firewall confirmation before preparation and
again when a later menu session resumes its approval flow.
The headless equivalent is:

```bash
self-host config show --project-root /absolute/project
self-host install media info --project-root /absolute/project --run-id EXISTING_RUN
self-host install media status --project-root /absolute/project --run-id EXISTING_RUN
self-host bundle begin --project-root /absolute/project --id home-plus \
  --media-run-id EXISTING_RUN --email admin@example.com --name "Home Admin" \
  --immich-port 32383 --docmost-port 32384 --vaultwarden-port 32385 \
  --vaultwarden-origin https://vaultwarden.localhost:28443 \
  --https-route-owner caddy-home --https-tls-owner caddy-home --resolve-images
```

Use the existing media administrator as `--username` if it is not `admin`.
Adoption requires the private media credential handoff and seven running
services; `bundle begin` rechecks both. Do not pass new-media bind, port-start,
or network-subnet flags. Bundle media `apply`/`resume` refuse adopted runs; use
the original media CLI for upkeep. Review the returned `mediaSelection`, exact
`mediaPorts`, and `mediaExposure` before approving anything. The benchmark
labels an adopted run as an extension, not a fresh full-stack speed result.

For the bounded household request “Netflix, Google Photos, Notion and
passwords,” `bundle init` turns one fresh host-inspection report and a bounded
set of account, bind, image, and private-HTTPS choices into the eight required
owner-only JSON files. It refuses existing output, observed port and network
collisions, truncated inspection evidence, mutable or missing image digests,
and unsafe host evidence. With `--resolve-images`, it asks Docker Buildx for the
raw registry manifest of each reviewed version tag and stores its exact content
digest. Pending Vaultwarden HTTPS remains an explicit stage gate. It pulls no
image, starts no container, and grants no apply approval.

Run it without arguments to see the required choice groups. The defaults are
`admin`, host-only `127.0.0.1`, and ports 2283, 3000, and 8080; supply a private
`--host-ip` or different ports when intended and supported by the inspection.
Those three defaults are for Immich, Docmost, and Vaultwarden. Media still
defaults to all-interface short port mappings. On a public host without
verified private firewall scope, choose `--media-bind-mode host-only` during
`bundle init`; all seven media ports then bind to 127.0.0.1 and need a separate
approved Caddy route for access from another device.

`--resolve-images` requires Docker Buildx plus registry access and resolves the
reviewed Docmost 0.96.0, PostgreSQL 18.6, Redis 8.10.2, and Vaultwarden 1.37.3
tags. The four explicit immutable image options remain available as an offline
or pre-reviewed alternative and cannot be mixed with `--resolve-images`.
For an exact isolated media allocation, pass `--media-port-start FIRST` to
`bundle init`. It reserves `FIRST` through `FIRST+6` (20000–44999), checks
all seven in the fresh host report, and fails rather than leaving that range.
Keep these seven distinct from the selected app and later Caddy ports.
If Docker reports `all predefined address pools have been fully subnetted`,
do not prune other projects or edit daemon-wide networking as an implicit
repair. For a new media run only, `bundle init --media-network-subnets
DEFAULT_CIDR,WEB_CIDR` (or media-only `config init` with the same flag) sets
explicit, distinct RFC1918 `/24`–`/28` subnets
on its two project-owned networks. Check both CIDRs against every current
Docker network and host route first; this CLI option validates the CIDR form
and freezes the choice in the approval, but cannot prove the host-wide
absence of an overlapping route. An existing run keeps its original network
choice. For the same household init, use `--immich-network-subnet`,
`--docmost-network-subnet`, and `--vaultwarden-network-subnet` for those
projects when needed; all selected subnets must be mutually non-overlapping.
The private Caddy route has separate network choices at its own approval gate:
`bundle caddy-inputs plan|apply --vaultwarden-network-subnet CIDR
--ingress-network-subnet CIDR`. Keep these distinct from the five application
subnets and recheck the host before applying.
The host report must be created inside the project root as a mode-`0600` file
with `self-host inspect-host` no more than 15 minutes
before initialization. Ask it to check the three selected app ports, plus the
seven media ports when `--media-port-start` is used, explicitly;
additional checks, such as the planned Caddy port, may share that report.
These checks remain complete even when the general listener inventory truncates.
Bundle initialization is local-engine only and accepts the inspected `default`
or `rootless` Docker context; use a separate remote-host inspection and plan for
remote contexts. The installed package bundles this read-only probe; no source
checkout or `.agents` path is required. Create the chosen project directory
first; the inspector will not create its output parent.

```bash
mkdir -m 700 -p /absolute/project
self-host bundle journey start --project-root /absolute/project --id home
self-host inspect-host --limit 50 \
  --check-tcp-port 2283 --check-tcp-port 3000 --check-tcp-port 8080 \
  --output /absolute/project/host-inspection.json
```

```bash
self-host bundle init --project-root /absolute/project --id home \
  --email admin@example.com --name "Home Admin" \
  --host-inspection /absolute/project/host-inspection.json --resolve-images \
  --media-bind-mode host-only \
  --vaultwarden-origin https://vaultwarden.localhost:28443 \
  --https-route-owner caddy-home --https-tls-owner caddy-home
```

That example is for this machine only. The CLI can inspect candidate LAN
addresses and resolvers before a household route is planned; a resolver is not
necessarily the DNS server you control. If you later want phones or other
computers to reach the vault, choose those clients then, configure private DNS,
and trust Caddy's local CA on each one. No LAN IP, DNS owner, or client list is
needed for the host-only route.

For pre-reviewed or offline inputs, omit `--resolve-images` and pass all four
`--docmost-image`, `--postgres-image`, `--redis-image`, and
`--vaultwarden-image` tag-plus-digest references instead.

This creates the independent service inputs while Vaultwarden HTTPS remains
explicitly pending. Media, Immich, and Docmost can be planned and staged.
Vaultwarden prepare and apply stay blocked. After the private route is actually
configured and its certificate is trusted by the intended client, record that
confirmation on the same bundle and re-plan with the newly returned approval:

```bash
self-host bundle https-ready --project-root /absolute/project \
  --input /absolute/project/.selfhost/bundles/home/household-bundle.json \
  --approve BUNDLE:home:CURRENT_DIGEST \
  --https-route-status configured --https-trust verified-for-intended-client
```

This is an owner assertion, not a DNS or CA probe. Check the intended client
without a certificate-warning bypass before recording it. A route that was
already verified before initialization may instead be recorded with the same
two HTTPS flags on `bundle init`.

To reuse a media stack already managed by this CLI in the same project, add
`--media-run-id EXACT_RUN_ID`. Initialization adopts it only when the media
adapter verifies that exact run identity and observes all seven expected
services running. It does not read credentials, create containers, or approve
an apply. Without the flag, initialization keeps creating a distinct media run.

When an existing Homarr should reach Immich directly, add
`--homarr-network EXACT_EXISTING_NETWORK`. The fresh inspection must contain
that exact network in its complete Docker-network inventory. The initializer
records it as externally owned and adds only `immich-server` to it; Immich's
database, Redis, and machine-learning services remain on their private network.
This neither creates nor adopts a network and does not make this bundle own the Homarr
media run. Approve cross-project attachment with the existing Homarr/network
owner before applying Immich. Without this flag, no cross-project attachment is
generated.

Use `--docmost-network EXACT_EXISTING_NETWORK` to attach only Docmost's
application container to an observed network. Its PostgreSQL and Redis
services remain on the Docmost-private network. An adopted media run with
`autostack-RUN_web` can supply that network to both `--homarr-network` and
`--docmost-network`; those inputs record its internal status. A fresh media run
creates the web network only after media apply, so it cannot be selected during
the initial `bundle init`.

For a fresh bundle, apply and verify media first, then refresh the host
inspection with checks for the Immich and Docmost ports. Before either app is
deployed, bind both application containers to the media-owned internal web
network with the current bundle approval:

```bash
self-host inspect-host --limit 50 \
  --check-tcp-port 2283 --check-tcp-port 3000 --check-tcp-port 28443 \
  --output /absolute/project/host-inspection-after-media.json
self-host bundle route-network --service media-web \
  --project-root /absolute/project \
  --input /absolute/project/.selfhost/bundles/home/household-bundle.json \
  --host-inspection /absolute/project/host-inspection-after-media.json \
  --network autostack-home-media_web --approve BUNDLE:home:CURRENT_DIGEST
```

The command checks the exact media run and network membership, validates both
revised app plans, and returns a new bundle approval. It changes only private
input files; rerun `bundle plan` before applying either app. The network name
must match the media run ID printed by `bundle init`.

To overlap only the initial Immich and Docmost Compose applies, review the new
bundle plan and both adapter plans. Refresh a host report with exact checks for
their selected ports, then run:

```bash
self-host bundle parallel-plan --project-root /absolute/project \
  --host-inspection /absolute/project/host-inspection-fresh.json
self-host bundle parallel-apply --project-root /absolute/project \
  --host-inspection /absolute/project/host-inspection-fresh.json \
  --approve BUNDLE:home:CURRENT_DIGEST \
  --immich-approve APPLY:home-immich:IMMICH_DIGEST \
  --docmost-approve APPLY:home-docmost:DOCMOST_DIGEST
```

The first command is read-only and prints the current three tokens. The second
rechecks the fresh report, exact internal network, untouched app projects, and
both adapter plans before starting separate CLI processes. It waits for both
and reports each outcome without printing child output or retrying a failed
apply. If either side needs inspection, use `bundle status` and that adapter's
plan/status before resuming it separately. Bootstrap, Docmost owner creation,
Homarr attachment, direct acceptance, and recovery remain distinct steps.

For a separately approved local Caddy route to Vaultwarden, add
`--vaultwarden-route-network EXACT_EXISTING_NETWORK`. The same fresh complete
inventory rule applies. Only the single Vaultwarden service joins the external
network; the initializer neither creates nor adopts it and performs no manual
network attachment. This records reachability topology only. The HTTPS origin,
DNS, client CA trust, Caddy runtime, and route acceptance remain independent
requirements enforced by their existing flags and checkpoints. When both
optional networks are selected, the Vaultwarden route network must differ from
the Homarr/media network so plain HTTP port 8080 remains behind its dedicated
Caddy route.

After initialization, `bundle` keeps those four adapters in one reviewed input
without pretending they share one unsafe approval. `bundle plan` fingerprints the
input and every referenced file, explains the ordered checkpoints, and returns
one bundle approval. `bundle stage` then delegates to the existing media,
Immich, Docmost, or Vaultwarden adapter; every host-changing phase also needs
that adapter's exact approval. Re-run a stage after repair to resume from the
adapter-owned state.

For `bundle plan`, `approvals`, `next`, `run`, `status`, and `info`, `--input` is optional
when the exact `--project-root` contains one safe owner-only
`.selfhost/bundles/ID/household-bundle.json`. Zero, multiple, linked, or unsafe
inputs stop discovery; pass `--input` to select an exact bundle explicitly.

`bundle approvals --project-root /absolute/project` is a read-only resume
inbox. It returns the current bundle approval, service gates, next checkpoint,
and, where available, the adapter's exact review command, safe summary, token,
and `current.runAfterReview` argv. The summary is explicitly partial; review
the full plan and adapter facts before supplying either token to `bundle
run` or `stage`; the inbox does not approve or apply anything. Repeat it after
each state change because tokens bind to the current input and checkpoint.
After that review and approval, use `runAfterReview` without reconstructing
the command. It never adds firewall scope or asserts client trust for you.

`bundle next` is the read-only resume coordinator. It fingerprints the same
bundle, inspects all four adapters, and returns exactly one argv command or one
manual checkpoint. With no token it returns `bundle plan`. After reviewing that
plan, pass its exact `--approve` token; pass `--stage-approve` only after the
returned adapter plan exposes the matching token. `next` validates tokens but
never executes them. Private HTTPS, first-owner setup, credentials, direct
acceptance, and finalization remain separate owner gates. Eligible pinned
Vaultwarden runs use the separately approved `vaultwarden signup` path;
legacy or attempted runs permit existing-login reconciliation only.
For a stopped, fully applied bundle it first preflights all four lifecycle
checkpoints. It returns `bundle up` only when the exact CLI-managed local-HTTPS
input and run ID are also supplied; otherwise it stops at the recorded route
owner checkpoint.

`bundle run` uses that same decision engine but executes consecutive safe CLI
checkpoints only when their exact bundle and adapter approvals are already
supplied or recorded. It suppresses intermediate adapter output and returns one
structured record of completed checkpoints plus the first missing approval or
manual gate. A supplied adapter token is consumed by one matching stage and is
not carried into the next adapter. Re-run the returned resume command after
reviewing the next adapter plan. Newly API-created Docmost workspaces include
the separately approved synthetic page/attachment check in this sequence;
consumed ambiguous attempts stop at manual readback guidance and cannot upload
again. Its recorded API proof does not accept browser or Homarr gates, or
separately selected backup/restore protection.
Private HTTPS, other direct acceptance, Homarr attachment, finalization, and
recovery never run automatically. The pinned Vaultwarden signup path requires its own separate
plan and approval outside this coordinator.
On failure, run the returned `diagnosis.command` for read-only status first.
`failedStageCommand` is context, not a diagnostic retry; repair the named
checkpoint before resuming a mutation.
If an approved stage revises a bundle input, `bundle run` discards the old
bundle and stage tokens and returns to `bundle plan`. Review the changed plan
and use its new approval; do not retry a token from the earlier input.
If the media stage fails after starting containers, repair its recorded step,
then resume without creating a second media-only config:

```bash
self-host install media diagnose --project-root /absolute/project --run-id MEDIA_RUN_ID
```

This read-only command names the failed stage, any known safe Docker failure
category, the private benchmark and browser-handoff paths, allowlisted failure
metadata, and the exact media resume arguments.
It does not print the benchmark or credentials. `install media info` and
`install media diagnose` emit JSON by default and also accept `--json yes`;
`install media benchmark` emits JSON directly.
Diagnose and repair that stage before using `bundle stage --phase resume` for
a household bundle.

To inspect the latest measured `setup-media-run.ts` invocation without opening
credential files or invoking Docker or a browser, use:

```bash
self-host install media benchmark --project-root /absolute/project --run-id MEDIA_RUN_ID
```

The command validates every benchmark record for that CLI-owned run as an
owner-only v1 artifact, then returns the latest wall time and stage outcomes.
It reports whether the selected command invocation completed and whether its
command stages took under ten minutes. Session preparation and manual browser
repair are outside that measured scope, so the command always leaves the full
setup under-ten claim false. Timing also never claims full-stack acceptance.
Use the acceptance matrix and its direct evidence for that separate decision.

```bash
self-host bundle stage --project-root /absolute/project \
  --input /absolute/project/.selfhost/bundles/home/household-bundle.json \
  --service media --phase resume --from FAILED_STAGE \
  --approve BUNDLE:home:CURRENT_DIGEST --stage-approve MEDIA_DIGEST
```

The bundle token must still match its unchanged input; the media digest must
match the frozen adapter plan. `bundle status` remains an observation, not a
claim that every setup stage passed.

Indexer choice is separate from deploying the seven media services. For a
reviewed run that intentionally has no indexer, add `--defer-indexer` only to
the exact approved media apply or resume (`self-host up`/`resume`, or the media
`bundle stage`; guided `bundle next/run` also forwards it with both approvals).
The verifier still checks Prowlarr authentication and its
Sonarr/Radarr applications plus every non-indexer service. It reports the
selected indexer and both synced-indexer edges as `PENDING`, exits `2`, and
records `pending-owner-choice` with technical acceptance false. Without this
flag verification stays strict; neither mode invents an indexer or request.

For a freshly generated Homarr board with untouched starter cards, the
optional board-only cleanup is exposed through the installed CLI:

```bash
self-host install media board-polish plan --project-root /absolute/project \
  --run-id MEDIA_RUN_ID --board personal
self-host install media board-polish apply --project-root /absolute/project \
  --run-id MEDIA_RUN_ID --board personal --approve sha256:REVIEWED_DIGEST
```

The plan is read-only and returns an approval only for seven exact upstream
starter items. Apply re-reads the board and preserves managed widgets, service
tiles, the recap, and any user content. A changed or partial starter set is
refused; a browser screenshot is still needed to accept the visual result.

For a board with added services, add `--reflow-all` to **both** plan and apply
to pack shortcuts first, widgets next, then the primary recap, its companion,
and other notes. Review its separate
mode-bound approval: this explicitly moves all items, including user-owned
ones, in desktop and mobile layouts. It deletes nothing and preserves every
item's content and dimensions. Without the flag, user-owned positions stay
fixed. Packing does not fix a widget that was created too small.

For an already-verified private HTTPS route, save its media URL through the CLI:

```bash
self-host install media access-proxy plan --project-root /absolute/project \
  --run-id MEDIA_RUN_ID --service jellyfin \
  --origin https://jellyfin.localhost:28443 --private-dns-confirmed
self-host install media access-proxy apply --project-root /absolute/project \
  --run-id MEDIA_RUN_ID --service jellyfin \
  --origin https://jellyfin.localhost:28443 --private-dns-confirmed \
  --approve sha256:REVIEWED_DIGEST
```

This changes only one run's saved access metadata; it does not create a proxy,
change Docker ports, configure DNS, trust a CA, or update Homarr. Confirm private
DNS only after checking that hostname on the intended client. Review the exact
plan, then use the returned commands to reconcile Homarr links and its recap
under separate snapshot-bound approvals. Internal integration and ping URLs stay on
the Docker network. A working host-only `.localhost` route does not prove that
phones or other computers can reach it.

```bash
self-host install media reconcile-links plan --project-root /absolute/project \
  --run-id MEDIA_RUN_ID --board personal
self-host install media reconcile-links apply --project-root /absolute/project \
  --run-id MEDIA_RUN_ID --board personal --approve sha256:REVIEWED_LINK_DIGEST
# Plan the recap after links have finished; its board snapshot has its own token.
self-host install media reconcile-notebook plan --project-root /absolute/project \
  --run-id MEDIA_RUN_ID --board personal
self-host install media reconcile-notebook apply --project-root /absolute/project \
  --run-id MEDIA_RUN_ID --board personal --approve sha256:REVIEWED_NOTE_DIGEST
```

Links reconciliation updates only the six managed media app records' navigation,
ping and purpose fields, preserving their names and icons. Recap reconciliation
changes only the marked primary Notebook, with its exact planned content and
collision-checked sizing. Both require an already-approved CLI-managed media
run, reject changed plans, and read back their own changes. Neither deploys
containers, repairs legacy widgets, changes integrations, exports credentials,
or proves rendered widgets, client trust or full-stack acceptance. An ambiguous
failure names the failed step and a read-only diagnosis command; inspect it
before planning again.

An existing CLI-managed media project can adopt the runtime bundled by a newer
CLI without recreating its run or changing Docker state:

```bash
self-host install media runtime-sync plan --project-root /absolute/project
self-host install media runtime-sync apply --project-root /absolute/project \
  --approve sha256:REVIEWED_DIGEST
```

Plan verifies both the installed and packaged manifests and reports the exact
file transition. Both commands require a current-owner project root without
group/world write access and real owner-only `.selfhost` and media-runtime
directories. Apply requires that exact token, holds the project runtime
lock, preserves `.sessions` byte-for-byte, installs the new manifest last, and
records the old and new manifest hashes in an owner-only transition ledger.
The old runtime remains in the content-addressed rollback store. Existing run
intents and deployment approvals keep their original runtime hash; the ledger
authorizes that immutable intent through the reviewed transition. No Docker
command or live service mutation is part of runtime sync. Close other media CLI
operations before the first sync. If an apply is interrupted, rerun the same
apply with the same CLI package and approval token; other media commands remain
blocked until that transaction is recovered.

The runtime lock fails closed and is never reclaimed from PID status alone. If
an interrupted CLI leaves `/absolute/project/.selfhost-media-runtime.lock`,
first confirm that its recorded PID is gone and that no media CLI command uses
the project. Inspect that exact file's owner, mode, inode, and link count. Then
remove only that exact lock file. A link count of two means acquisition stopped
between creating the lock hardlink and removing its uniquely named
`.selfhost-media-runtime.lock.candidate-PID-UUID` sibling; after confirming the
same inode and an idle project, remove those two exact pathnames individually.
Do not use a wildcard, recursive removal, or PID liveness alone as proof that
the lock is stale.

`bundle handoff-check --project-root PROJECT --input BUNDLE` compares the
existing private `.env` Vaultwarden password with the adapter-owned browser
credential without printing either value or changing the handoff. A matching
value is not proof that the browser filled it or that the account can log in.
Before first media apply in the default all-interface mode, `bundle next` and
`bundle run` stop for confirmed private firewall scope. After checking the actual router or Docker-aware
policy, add `--firewall-scope router-private` or
`--firewall-scope docker-aware-private` with the exact media stage approval.
The CLI records this operator confirmation; it cannot verify firewall rules.
An explicitly selected host-only media run skips that firewall-scope gate;
inspect its 127.0.0.1 bind before applying.
Vaultwarden's first-account route is a Bitwarden client-compatibility flow,
not a documented stable public bootstrap API; the official client derives and
wraps vault keys before registration ([upstream registration flow](https://github.com/bitwarden/clients/blob/main/libs/auth/src/angular/registration/registration-finish/default-registration-finish.service.ts#L89-L115)).
The browser checkpoint must verify a fresh sign-in and actual vault unlock.
The standalone package includes the skill's protected household browser helper.
After opening the approved HTTPS origin in the isolated
`selfhost-household-RUN_ID` agent-browser session and taking a fresh form
snapshot, fill only the selected refs without putting a password on the command
line:

```bash
self-host browser fill --project-root /absolute/project --run-id RUN_ID \
  --service vaultwarden --origin https://vaultwarden.localhost:28443 \
  --input email=@e1 --input password=@e2
```

Repeat `--input password=@eN` for a confirmation field. The helper checks the
private origin and field types, then sends managed values to agent-browser over
stdin and verifies that each selected field retained its value, without printing
that value. It needs Bun and agent-browser but no Agent Skill install. A certificate
warning bypass is not client-trust evidence; install and verify Caddy's local
CA on the intended client before treating the web vault as accepted.
After signup, sign out and use the managed email and password for a fresh login
and vault unlock. From the initial **Email address**/**Continue** login form in
the existing CA-trusted named session, the bounded Vaultwarden-only helper is:

```bash
self-host browser login --project-root /absolute/project --run-id RUN_ID \
  --service vaultwarden --origin https://vaultwarden.localhost:28443
```

It privately discovers fresh refs, fills the managed email and master password
over stdin, and submits each known step once. It returns only a narrow JSON
fresh-login result: the exact invalid-master-password error is `rejected`;
`accepted` requires an observed unlocked vault UI and matching managed account.
Unknown forms, errors, or account controls stop at a safe failure stage for
private inspection; it never signs up, resets a password, or records application
acceptance. Raw snapshots, field values, and URL queries/fragments stay private.
If login is rejected, stop: a saved signup-evidence file or a
successful field fill does not prove the account exists or has that password.
Inspect and reconcile the existing account privately; never repeat signup or
close registration on the strength of a stale or contradictory evidence file.
If more than one `agent-browser` installation exists, add `--browser-bin
/absolute/path/to/agent-browser` to the helper command and open the fixed
session with that same executable. This avoids a `PATH` change selecting a
different session store. A failure reports its safe stage without exposing
credentials; inspect the stage before using the browser fallback.

```bash
self-host bundle run --project-root /absolute/project \
  --input /absolute/project/.selfhost/bundles/home/household-bundle.json
```

If the dedicated Caddy network is created after bundle initialization, revise
only Vaultwarden's generated input with a fresh, complete host inspection that
also checks its selected backend TCP port, and the current bundle approval:

```bash
self-host bundle route-network --project-root /absolute/project \
  --input /absolute/project/.selfhost/bundles/home/household-bundle.json \
  --host-inspection /absolute/project/host-inspection.json \
  --network selfhost-caddy-route --approve BUNDLE:home:CURRENT_DIGEST
```

The command requires the exact observed network, rejects the Homarr and private
networks, refreshes Vaultwarden's port/network observation, atomically replaces
only its mode-0600 input, and returns a changed approval for re-planning. It
does not change Docker, DNS, TLS, or client certificate trust.

`bundle status` calls every adapter's read-only status path and continues when
one is unavailable. Its aggregate remains incomplete: browser, Homarr,
application and timing checks remain separate from saved plans or container
observations; those observations are not a full-acceptance claim. Recovery is
reported as unverified, not silently selected as a setup gate. Its
`finalizationEvidence` section reassesses an adjacent
`finalization-evidence.json` through the read-only finalizer. It distinguishes
missing, unavailable, blocked and recorded declarations without writing a
checkpoint, copying evidence payloads or promoting declarations to current
runtime acceptance. Its
`privateHttps` section shows the selected origin and owners, but labels route
and client-trust readiness as operator-recorded; it does not claim that the
bundle independently tested DNS or CA trust on another device. Unless an
already-applied local Caddy route is supplied explicitly, status warns that
its lifecycle remains with the recorded route owner.

After all four adapters have applied, `bundle up` and `bundle down` reuse the
current bundle approval. They preflight every adapter-owned checkpoint and
immutable Compose file before changing a container. `down` stops only those
exact projects; it does not delete volumes or prune resources.
After `up`, run `bundle info` for a concise list of each app's purpose,
planned/private link, Homarr board link, and credential-file path. `info` is
read-only and does not claim that those links or applications are healthy.
Root `self-host status` and `self-host info` select the sole saved household
bundle automatically. If several bundles exist, pass `--input` explicitly.
Root `self-host up` and `self-host down` require `--input` and the bundle's
current `--approve` token in a household project; add the exact local-HTTPS
input and run ID when Caddy belongs to the same lifecycle. To operate only the
older media profile, pass `--profile media` to those root commands.

After direct acceptance of Immich, Docmost, and Vaultwarden, generate their
reviewed Homarr shortcut inputs from the unchanged canonical bundle:

```bash
self-host bundle homarr-inputs plan --project-root /absolute/project \
  --input /absolute/project/.selfhost/bundles/home/household-bundle.json \
  --shared-caddy-input /absolute/project/.selfhost/bundles/home/caddy/shared-caddy.json
self-host bundle homarr-inputs apply --project-root /absolute/project \
  --input /absolute/project/.selfhost/bundles/home/household-bundle.json \
  --shared-caddy-input /absolute/project/.selfhost/bundles/home/caddy/shared-caddy.json \
  --approve HOMARR-INPUTS:home:REVIEWED_DIGEST
```

The read-only plan shows the exact private Homarr origin and `personal` board,
the three purpose-bearing URLs, existing dashboard-icons URLs, bounded storage
paths, owner-only targets, and one approval bound to the bundle fingerprint and
generated bytes. Apply creates only those three mode-`0600` files in the bundle
directory. It never overwrites different content and is idempotent for identical
bytes. The optional shared-Caddy input requires the current applied host-private
route and live trusted transport for all three apps; it gives the tiles the
friendly `https://*.localhost` links. Omit it to use direct local backend links.
These `.localhost` links work on this host only until another client's private
DNS and Caddy CA trust have been configured and verified. When the managed media
run has produced `connections.env`, both commands return its path without
reading or printing the key and the exact attachment-plan argv commands. Three
commands create app shortcuts plus recap Notebook entries only: Docmost and
Vaultwarden are tile-only. The fourth command is Immich's separate native
`homarr attach immich` adapter and approval.

After `homarr-inputs apply`, inspect the ordered attachment queue instead of
assembling four different adapter command lines:

```bash
self-host bundle homarr-attach status --project-root /absolute/project \
  --input /absolute/project/.selfhost/bundles/home/household-bundle.json
```

The report uses the fixed order Immich shortcut, Docmost shortcut, Vaultwarden
shortcut, then native Immich. It checks only strict owner-only file metadata,
prints exact adapter plan/status argv, and reports missing Homarr key, native
input, limited Immich key, or acceptance evidence. It does not read credentials,
call Homarr, mutate the board, or claim an adapter is already attached. Run each
returned plan, review its exact adapter approval, then run its apply and status
directly. One aggregate approval is intentionally unavailable: each shortcut
changes the shared board snapshot bound by the next approval, while native
Immich cannot plan until its app exists. Media-owned Homarr, Jellyfin, and Seerr
links must already be reconciled by the media/access workflow; this command does
not rewrite them.

Add `--inspect` for fresh, read-only adapter status calls using adapter-owned
credentials. Inspection skips only strictly validated attached resources and
stops at the first unresolved entry; failed or malformed status is unknown,
never attached. Shortcut status exposes resource IDs and the exact private
board; native Immich status delegates board validation to its owner and verifies
the integration ID and exact live widget-kind set, not individual widget IDs.
Late `bundle next` and `bundle approvals` include exact attachment plan/status
commands alongside the unchanged Vaultwarden or finalization checkpoint. Apply
one reviewed adapter plan directly, then obtain a fresh plan for the next app.
No attachment apply or aggregate approval is automated.

```bash
self-host bundle down --project-root /absolute/project \
  --input /absolute/project/.selfhost/bundles/home/household-bundle.json \
  --approve BUNDLE:home:CURRENT_DIGEST
self-host bundle up --project-root /absolute/project \
  --input /absolute/project/.selfhost/bundles/home/household-bundle.json \
  --approve BUNDLE:home:CURRENT_DIGEST
self-host bundle info --project-root /absolute/project \
  --input /absolute/project/.selfhost/bundles/home/household-bundle.json
```

To include an existing legacy Vaultwarden `local-https` route, add both
`--local-https-input ABSOLUTE` and `--local-https-run-id ID` to `status`, `up`,
or `down`. The route must already have an applied checkpoint, own the recorded
Vaultwarden HTTPS origin, and use the exact external network bound in the
Vaultwarden input. These commands never create or widen a route.

Shared `caddy-private` is a separate lifecycle, not a `--local-https-*` route.
For a household restart, read its exact shared-Caddy input/checkpoint `status`
and use the returned `STOP` token for `caddy-private down`; then `bundle down`
and `bundle up` with the fresh bundle-plan token; finally read shared-Caddy
`status` again and use its returned `UP` token for `caddy-private up`.
Use the exact original inputs/checkpoint IDs, not the example IDs or stale
tokens. This stops/starts only the owned projects and retains their data;
see the existing `caddy-private` lifecycle commands below.

`bundle finalize` is the final evidence checkpoint. It does not call Docker,
an application, or a browser. It binds one exact bundle input to explicit
owner-only, mode-`0600` redacted observation files for direct media, Immich,
Docmost, and Vaultwarden acceptance; Homarr board, widget, Notebook, read-only
Seerr search UI, and MCP
checks; one hashed PNG/JPEG/WebP screenshot; measured timestamps for those five
stages and the whole run; and cleanup state. A missing or non-passing row keeps
the checkpoint `blocked` (malformed, mismatched, linked, oversized, or
secret-labelled JSON evidence fails closed). Complete input is labelled
`recorded`, not independently verified. The result is saved beside the bundle
input as `finalization.json` and printed without evidence payloads.

`bundle finalize status` accepts the same flags and evaluates the same bound
evidence without writing or replacing a checkpoint. It reports a read-only
assessment, not a fresh runtime probe. Use it when resuming or reviewing a run.
The bundle does not select backup protection: isolated restore becomes required
when that extension is selected or before migrating real vault contents.

If an active same-boot journey reaches ten minutes, `bundle benchmark` reports
`threshold-exceeded-in-progress`: that run can no longer meet the speed target.
Its final duration, application acceptance and ease score remain unmeasured.

Create the owner-only editable manifest first. The scaffold binds the exact
bundle, project root, and four run IDs without opening referenced account or
credential files. Every evidence and timing slot starts blocked or empty, and
an existing scaffold is never overwritten.

```bash
self-host bundle finalize scaffold --project-root /absolute/project \
  --input /absolute/project/.selfhost/bundles/home/household-bundle.json
self-host bundle finalize record --project-root /absolute/project \
  --input /absolute/project/.selfhost/bundles/home/household-bundle.json \
  --subject immich --check direct-acceptance \
  --observed-at 2026-09-25T12:07:30.000Z --observer operator-1 \
  --status pass --redacted true --reference artifact:immich-login-observed
self-host bundle finalize --project-root /absolute/project \
  --input /absolute/project/.selfhost/bundles/home/household-bundle.json \
  --evidence /absolute/project/.selfhost/bundles/home/finalization-evidence.json
# Reassess later without changing the saved checkpoint:
self-host bundle finalize status --project-root /absolute/project \
  --input /absolute/project/.selfhost/bundles/home/household-bundle.json \
  --evidence /absolute/project/.selfhost/bundles/home/finalization-evidence.json
self-host bundle journey finish --project-root /absolute/project --id home \
  --input /absolute/project/.selfhost/bundles/home/household-bundle.json
```

`bundle journey start` must run before host inspection and bundle initialization.
It creates one owner-only journal using the Linux boot identity and monotonic
clock. `journey status` reports read-only elapsed time while that boot remains
active. `journey finish` rejects a reboot, incomplete finalization, changed
bundle input, changed evidence hash, or changed screenshot hash. Its finish gate
does not turn operator-recorded acceptance into independent verification.

Each referenced observation is exact JSON with `schemaVersion: 1`, kind
`redacted-observation`, the matching `bundleId`, `subject`, `runId`, and
`check`, an ISO UTC `observedAt`, bounded `observer`, `status: "pass"`, one or
more opaque non-URL `evidenceRefs`, and `redacted: true`. Subjects are
`BUNDLE:SERVICE`, `BUNDLE:homarr`, or `BUNDLE:bundle`; checks are
`direct-acceptance`, `board`, `widgets`, `notebook`, `search`, `mcp`, or `cleanup`.
`bundle finalize record` creates one owner-only mode-`0600` observation and
attaches it to the exact empty, blocked scaffold slot. It requires an explicit
observed time, observer, passing-status assertion, redaction assertion, and one
or more opaque `--reference` values; it neither probes the app nor invents a
time or pass result. Run it once per application and Homarr check. For cleanup,
use `--subject bundle --check cleanup` plus `--temporary-artifacts removed`,
`--browser-session closed|not-used`, `--test-data removed|recoverable-trash|not-created`,
and `--stack-state running|stopped`. Existing observations or filled slots are
never overwritten. Timing, screenshot, and final manifest observer/evaluation
time remain explicit owner entries before finalization. A failed or unobserved
check stays blocked; do not invoke `record` for it. Recording `homarr.search`
also upgrades an older scaffold that predates that slot while preserving its
other fields; it still requires observed search proof.
The `homarr.search` observation must come from opening Homarr's search bar,
selecting Media mode, and seeing an exact Seerr title result in the rendered
UI. Record no request click; API/MCP search alone is insufficient.
The finalization manifest uses kind `household-bundle-finalization` and groups
those file paths under `applications`, `homarr`, and `cleanup`. It also records:

- `screenshot`: exact mode-`0600` path, `sha256:` digest, and `redacted: true`
  (use `chmod 600 PATH` before finalizing an existing group-readable capture);
- `timing.stages`: exactly `media`, `immich`, `docmost`, `vaultwarden`, and
  `homarr`, each with `startedAt` and `completedAt`;
- `timing.endToEnd`: measured start and completion timestamps;
- `cleanup`: pass/blocked/fail, `temporaryArtifacts: "removed"`, browser state
  `closed` or `not-used`, test data state, retained stack state, and evidence.

An under-ten-minute result is emitted only when all five stage timestamp pairs
and the enclosing end-to-end timestamps are present. Screenshot redaction is
an operator assertion bound to the file hash; the finalizer checks the bounded
file identity and image signature but does not inspect pixels or metadata
content. A recorded checkpoint therefore covers only the supplied redacted
evidence window, not an independently verified live acceptance run or future
availability.

`bundle benchmark` is the read-only audit for both timing boundaries. It validates
the selected owner-only bundle and adjacent `finalization.json`, then reports
the five recorded application/Homarr stage durations alongside the still
unknown host-inspection, planning/approval, private-Caddy, browser, and cleanup
phases. It never calls Docker, an application, Caddy, or a browser, and it does
not read credential handoffs.

```bash
self-host bundle benchmark --project-root /absolute/project \
  --input /absolute/project/.selfhost/bundles/home/household-bundle.json
```

Without a finished journey journal, complete setup time stays `not-measured`:
the finalizer's five timestamp pairs are not a full journey. A finished,
same-boot journal makes only full elapsed and its under-ten threshold measured;
the individual unknown phase breakdown remains explicit. Ease stays
`not-measured`, and acceptance stays recorded rather than independently verified.

`bundle backup plan` derives an exact, read-only local recovery-drill plan from
the owner-controlled bundle inputs. The backup and restore targets must be
absent, absolute, outside the project, and non-overlapping. The output
identifies each durable app path, cache exclusion, quiesced-copy boundary,
runtime identity, and prerequisite for a new isolated restore. It stays
blocked and `not-verified`: it does not inspect source data, stop containers,
create a target, copy or restore files, rewrite Compose inputs, or prove
recovery. A same-host target is local staging, not independent off-host
protection.

```bash
self-host bundle backup plan --project-root /absolute/project \
  --input /absolute/project/.selfhost/bundles/home/household-bundle.json \
  --backup-target /absolute/local-backups/home-drill \
  --restore-target /absolute/restore-drills/home-drill
```

For this bundle's retained shared-Caddy route, add
`--shared-caddy-input /absolute/project/.selfhost/bundles/home/caddy/shared-caddy.json`.
This inventories only validated control metadata and exact config/data/CA/state
paths against its applied checkpoint and pinned image, without reading CA/key
material or persistence or calling Docker. Without the flag the route is
explicitly uncovered. Capture and isolated restore remain unimplemented; preserve
the original CA/private key and verify DNS/client trust separately during recovery.

After the managed credential files exist, `bundle handoff` refreshes one
owner-only `.selfhost/bundles/ID/private-handoff.env` with service URLs,
usernames, generated passwords, and recorded API keys. It prints only the
file path and a list of keys not recorded; it does not claim that an account
or integration works. If Immich's separate one-time Homarr API key was saved,
the exporter automatically includes it from the bundle's
`immich-homarr-api-key` file. Use `--immich-api-key-file` for a different
owner-only path.
Keep the resulting file private and never add it to Git.
It uses POSIX-shell-safe assignments, including for values containing quotes or
shell metacharacters. The media and Immich HTTP URLs are local access links;
do not mistake them for public HTTPS routes. Source the file only in a trusted
shell, and avoid exporting it into an unrelated process environment.

```bash
self-host bundle handoff --project-root /absolute/project \
  --input /absolute/project/.selfhost/bundles/home/household-bundle.json \
  --immich-api-key-file /absolute/project/immich-homarr-api-key
```

```bash
node packages/cli/bin/selfhost.mjs bundle plan \
  --project-root /absolute/project --input /absolute/project/.selfhost/bundles/home/household-bundle.json
node packages/cli/bin/selfhost.mjs bundle status \
  --project-root /absolute/project --input /absolute/project/.selfhost/bundles/home/household-bundle.json
node packages/cli/bin/selfhost.mjs bundle finalize \
  --project-root /absolute/project --input /absolute/project/.selfhost/bundles/home/household-bundle.json \
  --evidence /absolute/project/finalization-evidence.json
node packages/cli/bin/selfhost.mjs bundle stage \
  --project-root /absolute/project --input /absolute/project/.selfhost/bundles/home/household-bundle.json \
  --service immich --phase plan
node packages/cli/bin/selfhost.mjs bundle stage \
  --project-root /absolute/project --input /absolute/project/.selfhost/bundles/home/household-bundle.json \
  --service immich --phase apply --approve BUNDLE:home:BUNDLE_DIGEST \
  --stage-approve APPLY:immich:IMMICH_DIGEST
node packages/cli/bin/selfhost.mjs bundle stage \
  --project-root /absolute/project --input /absolute/project/.selfhost/bundles/home/household-bundle.json \
  --service immich --phase close-setup --approve BUNDLE:home:BUNDLE_DIGEST \
  --stage-approve CLOSE_SETUP:immich:IMMICH_DIGEST
```

The generated owner-only input has `schemaVersion`, `id`, `projectRoot`, and exactly four
service records: media (`runId`, `username`, `credentialHandoff`), Immich and
Docmost (`input`, `runId`, `accountFile`), and Vaultwarden (`input`, `runId`,
`accountFile`, `httpsPlan`). Every referenced file must be an owned regular
file inside the project. Media preparation and Vaultwarden preparation create
private local state, so they require the bundle approval even before Docker
apply. Vaultwarden stops for trusted private HTTPS and a separate signup
approval on eligible new pinned runs (existing-login reconciliation otherwise);
Docmost stops for first-owner browser acceptance. Homarr attachment comes only
after each app is accepted. This coordinator makes no under-ten-minute claim.

From a source checkout:

```bash
bun packages/cli/scripts/build.ts
node packages/cli/bin/selfhost.mjs doctor
node packages/cli/bin/selfhost.mjs catalog search photos --json
node packages/cli/bin/selfhost.mjs plan photos --project-root /absolute/project --json
node packages/cli/bin/selfhost.mjs config init --project-root /absolute/project --profile media --run-id home --username admin
node packages/cli/bin/selfhost.mjs up --project-root /absolute/project
```

Immich keeps host inspection input and private account metadata in files below
the selected project root. The account file is mode `0600`, contains only
`schemaVersion`, `name`, `username`, and `email`, and never contains a password.

```bash
node packages/cli/bin/selfhost.mjs immich plan \
  --project-root /absolute/project --input /absolute/project/immich-input.json \
  --run-id home-immich --account-file /absolute/project/immich-account.json
node packages/cli/bin/selfhost.mjs immich apply \
  --project-root /absolute/project --input /absolute/project/immich-input.json \
  --run-id home-immich --account-file /absolute/project/immich-account.json \
  --approve APPLY:immich:PLAN_DIGEST
node packages/cli/bin/selfhost.mjs immich bootstrap \
  --project-root /absolute/project --input /absolute/project/immich-input.json \
  --run-id home-immich --account-file /absolute/project/immich-account.json \
  --approve BOOTSTRAP:immich:PLAN_DIGEST
node packages/cli/bin/selfhost.mjs immich close-setup \
  --project-root /absolute/project --input /absolute/project/immich-input.json \
  --run-id home-immich --account-file /absolute/project/immich-account.json \
  --approve CLOSE_SETUP:immich:PLAN_DIGEST
node packages/cli/bin/selfhost.mjs immich status \
  --project-root /absolute/project --input /absolute/project/immich-input.json
node packages/cli/bin/selfhost.mjs immich accept \
  --project-root /absolute/project --input /absolute/project/immich-input.json \
  --run-id home-immich --account-file /absolute/project/immich-account.json \
  --integration-url http://immich-server:2283 \
  --acceptance-file /absolute/project/immich-acceptance.json
node packages/cli/bin/selfhost.mjs immich homarr-key plan \
  --project-root /absolute/project --input /absolute/project/immich-input.json \
  --run-id home-immich --account-file /absolute/project/immich-account.json \
  --acceptance-file /absolute/project/immich-acceptance.json \
  --key-file /absolute/project/immich-homarr-api-key
```

`immich plan` is read-only and delegates manifest validation and planning to
`selfhost-compose`. Its approval digest binds the exact manifest, image
digests, paths, port, run, and account metadata. `apply` generates the existing
owner-only household handoff, materializes only the database secret, renders
without overwrite, and runs the exact-project Compose preflight and apply.
`bootstrap` checks initialization before any signup request, sends the generated
password only in an in-memory JSON body, verifies login, and requests browser
fallback rather than retrying an uncertain signup. After success,
`close-setup` revalidates the exact rendered Compose ownership, four healthy
services, live port, mount and network evidence, initialization, and managed
owner login. It atomically changes only the owner-only input to
`allowSetup: false` with verified-existing observations, then prints the new
read-only plan and exact apply approval. It does not apply Compose. Re-run
`bundle plan` after a bundle-routed closure because its input fingerprint and
approval change. `status` reports narrow Compose and initialization
observations, not full Immich or Homarr acceptance. `accept` supplies direct
login, release, closed-setup, and generated-image round-trip evidence; it
leaves only the exact test asset in recoverable trash. The separate
`homarr-key create` step needs the token from `homarr-key plan`, verifies the
limited key, and saves its one-time value only in a mode-`0600` file.

Multiple passing `caddy-private` ingress plans can share one CLI-owned Caddy
container. Save an owner-only mode-`0600` adapter input inside the selected
project root:

For the managed household bundle, the CLI generates those six route plans and
the shared input after media is running and the Immich/Docmost app-only network
binding has been planned. Refresh the host inspection with an exact check for
the Vaultwarden HTTPS origin's high port, then run:

```bash
self-host bundle caddy-inputs plan --project-root /absolute/project \
  --input /absolute/project/.selfhost/bundles/home/household-bundle.json \
  --host-inspection /absolute/project/host-inspection-after-media.json
self-host bundle caddy-inputs apply --project-root /absolute/project \
  --input /absolute/project/.selfhost/bundles/home/household-bundle.json \
  --host-inspection /absolute/project/host-inspection-after-media.json \
  --approve CADDY-INPUTS:home:REVIEWED_DIGEST
self-host caddy-private plan --project-root /absolute/project \
  --input /absolute/project/.selfhost/bundles/home/caddy/shared-caddy.json
```

By default, the plan resolves the reviewed Caddy image through Docker Buildx.
An already verified immutable `--caddy-image` is an alternative. Applying
`caddy-inputs` writes only private files; the subsequent `caddy-private plan`
returns its own Docker-apply approval. The generated `.localhost` routes are
host-only; a LAN domain needs a separate DNS, client-trust, and exposure plan.
The Caddy adapter may prove TLS with a 502 while Vaultwarden has not joined its
new bridge. Refresh inspection and use `bundle route-network` for Vaultwarden,
then verify CA trust and use `bundle https-ready` before Vaultwarden prepare.

For a custom topology, create the adapter input directly:

For the managed media services, use the observed `autostack-RUN_web` network:
it contains Homarr, Jellyfin, and Seerr, while their default network also
contains Arr and qBittorrent. Immich and Docmost accept an optional
`integrationNetwork` in their app inputs with `internal: true` for this
network; only their application container joins it. A shared Caddy route can
use that web network without reaching the
two apps' databases or queues. Verify actual network membership before apply.
For a fresh Vaultwarden route, Caddy may own one separate internal upstream
bridge before Vaultwarden is deployed. Declare it as
`{"id":"vaultwarden","name":"home-edge-vaultwarden","owner":"home-edge","internal":true,"ownership":"new"}`
in `upstreamNetworks`, and reference `"network":"vaultwarden"` from the
Vaultwarden route plan. Caddy's first TLS proof may return 502 until the app
joins; this proves transport only. After Caddy applies, refresh host inspection
and use `bundle route-network` to attach only Vaultwarden to that observed
bridge. Keep it distinct from the media web network. Re-plan the bundle,
verify client CA trust, record `bundle https-ready`, then prepare Vaultwarden.
On a stopped Caddy update, mark an already-created owned bridge
`"ownership":"verified-existing"` and include its observed ownership; a
fresh apply never adopts it silently.

```json
{
  "schemaVersion": 1,
  "project": {
    "dockerContext": "default",
    "id": "home-edge",
    "owner": "home-edge",
    "root": "/srv/home",
    "directory": "/srv/home/home-edge",
    "ownership": "new"
  },
  "caddyImage": "docker.io/library/caddy:2.11.4-alpine@sha256:VERIFIED_DIGEST",
  "routes": [
    {"planPath": "/srv/home/homarr-caddy-plan.json", "network": "homarr"},
    {"planPath": "/srv/home/jellyfin-caddy-plan.json", "network": "jellyfin"}
  ],
  "upstreamNetworks": [
    {"id": "homarr", "name": "homarr-private", "owner": "homarr", "internal": true},
    {"id": "jellyfin", "name": "jellyfin-private", "owner": "jellyfin", "internal": true}
  ],
  "observed": {
    "checkedAt": "2026-09-25T10:00:00Z",
    "project": null,
    "ports": [],
    "paths": [],
    "networks": [
      {"name": "homarr-private", "owner": "homarr"},
      {"name": "jellyfin-private", "owner": "jellyfin"}
    ]
  },
  "portObservation": {
    "hostIp": "192.168.1.10",
    "port": 28443,
    "protocol": "tcp",
    "inUse": false,
    "checkedAt": "2026-09-25T10:00:00Z"
  }
}
```

Every referenced ingress plan must already be `pass`, use container Caddy,
share the project owner, exact private bind, high HTTPS port, and the project
`config`/`data` paths, and name a unique hostname. Each route maps to one
observed existing Docker network; the adapter attaches Caddy to those networks
but does not attach or modify an upstream service. The `internal` value is
caller-declared planning metadata: because these are reused external networks,
the adapter neither inspects nor enforces their actual Docker isolation.

```bash
self-host caddy-private plan --project-root /srv/home --input /srv/home/shared-caddy.json
self-host caddy-private apply --project-root /srv/home --input /srv/home/shared-caddy.json \
  --approve APPLY:home-edge:PLAN_DIGEST
self-host caddy-private status --project-root /srv/home --input /srv/home/shared-caddy.json
self-host caddy-private down --project-root /srv/home --input /srv/home/shared-caddy.json \
  --approve STOP:home-edge:CHECKPOINT_DIGEST
self-host caddy-private up --project-root /srv/home --input /srv/home/shared-caddy.json \
  --approve UP:home-edge:CHECKPOINT_DIGEST

# If the input itself is unreadable, select the retained checkpoint explicitly.
self-host caddy-private status --project-root /srv/home --checkpoint home-edge
self-host caddy-private down --project-root /srv/home --checkpoint home-edge \
  --approve STOP:home-edge:CHECKPOINT_DIGEST
```

`plan` writes nothing and its approval covers the normalized Compose plan,
Caddyfile, port observation, route-plan paths and hashes, and network mapping.
Apply renders only the owned Caddy project and creates owner-only config/data.
Before Compose can mutate, it records the exact input path, secret-free
manifest, Compose file identity, Caddyfile hash, and conservative lifecycle
phase in mode-`0600` state. The `compose-started` phase means Compose may have
started, including when its invocation returned an error. After a successful
start, the adapter exports Caddy's local CA and checks every hostname with
`curl --cacert` and `--resolve`. A failed TLS proof leaves a recoverable
`compose-started` checkpoint. An HTTP 502 still proves only Caddy's TLS route.
For host-only `.localhost` routes, verify loopback resolution on this host;
LAN routes need private DNS configured and verified on each intended client.
Install the exported CA in each intended client trust store, confirm every upstream is attached and resolvable
on its declared network, complete the reported application-specific proxy
settings, and test the application live. DNS, client trust, firewall scope,
authentication, and application acceptance always remain unverified by this
adapter. `status` reports exact checkpoint-bound `STOP:` and `UP:` approvals.
`down` requires its exact approval and uses scoped Compose `stop` against the
retained manifest; it does not remove networks, data, or volumes. This remains
available if a referenced route plan is missing or invalid. If the adapter
input itself cannot identify its project, use the explicit checkpoint ID shown
by the prior plan/apply. The retained checkpoint validates its project,
original input path, exact Compose target, and approval before any lifecycle
mutation. After an approved stop, a newly reviewed plan and exact `APPLY:`
approval may update the route. `up` also needs its exact status approval and
repeats the TLS transport proofs against the retained manifest. Upstream
network isolation, like DNS and client trust, remains unverified.

Every `apply`, `up`, and `down` holds one owner-only lock for that Caddy project
from checkpoint read through the final checkpoint write. Concurrent mutations
of the same project fail closed; other Caddy project IDs use separate locks.
The adapter never guesses that an existing lock is stale. Before manually
removing one, confirm no matching CLI process is active and inspect the exact
checkpoint and Docker project state; then rerun `status` for a fresh approval.
During a stopped route update, the Caddyfile must contain either the retained
bytes or the newly approved bytes. A retry after the new file was swapped into
place is idempotent, while any third content is rejected. Until that retry
records the new checkpoint, old `up` remains blocked and old approved `down`
remains available.

Vaultwarden needs a pre-existing, user-trusted private HTTPS origin. For a
host-only route, the CLI can first plan and apply a separate Caddy project. It
defaults to the candidate `https://vaultwarden.localhost:28443`, but accepts
`localhost` or another `.localhost` name. The input must include a fresh
observation that the selected loopback high port is unused and an official
version-tagged Caddy 2 image with an immutable digest:

```bash
self-host inspect-host \
  --check-tcp-port 28443 \
  --output /absolute/project/host-inspection.json
self-host vaultwarden local-https init \
  --project-root /absolute/project --run-id home-vault-route \
  --host-inspection /absolute/project/host-inspection.json \
  --caddy-image docker.io/library/caddy:2.11.4-alpine@sha256:VERIFIED_DIGEST
```

`init` requires a current-user-owned mode-`0600` inspection from the last 15
minutes, complete exact selected-port and untruncated Docker-network
observations, and the local `default` or `rootless` Docker context. The bounded
general listener inventory may be truncated because the exact selected-port
probe is authoritative for the chosen port. It creates one mode-`0600`,
no-clobber route input below
`.selfhost/vaultwarden/local-https/<run-id>/` and prints the next `plan`
command. It runs no Docker command. The generated input has this shape:

```json
{
  "schemaVersion": 1,
  "project": {
    "dockerContext": "default",
    "id": "home-vault-route",
    "owner": "home-vault-route",
    "root": "/absolute/project",
    "directory": "/absolute/project/home-vault-route",
    "ownership": "new"
  },
  "observed": {
    "checkedAt": "2026-09-25T10:00:00Z",
    "project": null,
    "ports": [],
    "paths": [],
    "networks": []
  },
  "caddyImage": "docker.io/library/caddy:2.11.4-alpine@sha256:VERIFIED_DIGEST",
  "hostname": "vaultwarden.localhost",
  "httpsPort": 28443,
  "portObservation": {
    "hostIp": "127.0.0.1",
    "port": 28443,
    "protocol": "tcp",
    "inUse": false,
    "checkedAt": "2026-09-25T10:00:00Z"
  }
}
```

The `init` flags `--hostname` and `--https-port` may be omitted to use the shown
candidates. The generated port observation must still be no older than one hour
at plan and apply.

```bash
node packages/cli/bin/selfhost.mjs vaultwarden local-https plan \
  --project-root /absolute/project --run-id home-vault-route \
  --input /absolute/project/vaultwarden-local-https.json
node packages/cli/bin/selfhost.mjs vaultwarden local-https apply \
  --project-root /absolute/project --run-id home-vault-route \
  --input /absolute/project/vaultwarden-local-https.json \
  --approve APPLY:PROJECT:PLAN_DIGEST
node packages/cli/bin/selfhost.mjs vaultwarden local-https status \
  --project-root /absolute/project --run-id home-vault-route \
  --input /absolute/project/vaultwarden-local-https.json
```

The route owns only Caddy, a loopback high port, persistent `/config` and
`/data`, an internal upstream bridge, and a separate ingress bridge needed for
rootless Docker to publish the loopback port. Vaultwarden joins only the
internal bridge. Caddy mounts no Docker socket. Apply
exports Caddy's local CA and verifies TLS with `curl --cacert` plus an explicit
`--resolve` mapping. That check does not prove ordinary DNS resolution, trust
in a browser or another client, or Vaultwarden acceptance; status reports those
boundaries separately. Before Vaultwarden exists, an HTTP 502 response is an
expected TLS-route result. Configure and verify name resolution and CA trust on
the intended client, then pass the reported integration network to the
Vaultwarden project.

On Linux, an installed `agent-browser` with `--ca-cert` can verify the exported
public root in an isolated browser session without changing system-wide trust.
The option needs `certutil` (Debian/Ubuntu: `libnss3-tools`); check
`agent-browser --help` first. Use the `caExportPath` printed by `local-https
status` and the fixed browser session used by the credential helper:

```bash
agent-browser --session selfhost-household-home-vault \
  --ca-cert /absolute/project/.selfhost/vaultwarden/local-https/home-vault-route/caddy-local-root.crt \
  open https://vaultwarden.localhost:28443
```

[agent-browser's CA option](https://agent-browser.dev/proxy) keeps normal
hostname and validity checks; do not add a certificate-error bypass. A browser
on a phone or another computer still needs its own private name resolution and
CA trust before that client is accepted.

After that, supply an owner-only mode-`0600` account file inside the project containing only
`schemaVersion`, `username`, and `email`, plus the inspected household manifest
and a non-secret HTTPS plan. `prepare` creates or reuses the private credential
handoff. Deployment pauses before account creation. The separately approved
`signup` path uses the official WebCrypto client, never a guessed signup API.
It supports only the exact observed Vaultwarden 1.37.3 image digest shown in its
plan and newly prepared, originally-new runs; legacy runs have unknown signup
history and must use existing-account login reconciliation. Deployment, signup,
and registration closure each require their own exact approval digest:

```bash
node packages/cli/bin/selfhost.mjs vaultwarden prepare \
  --project-root /absolute/project --run-id home-vault \
  --account-file /absolute/project/vaultwarden-account.json \
  --input /absolute/project/vaultwarden-input.json \
  --https-plan /absolute/project/vaultwarden-https.json
node packages/cli/bin/selfhost.mjs vaultwarden apply \
  --project-root /absolute/project --run-id home-vault --approve PLAN_DIGEST
node packages/cli/bin/selfhost.mjs vaultwarden signup plan \
  --project-root /absolute/project --run-id home-vault \
  --browser-bin /absolute/path/to/agent-browser --ca-cert /absolute/path/to/public-root.crt
node packages/cli/bin/selfhost.mjs vaultwarden signup apply \
  --project-root /absolute/project --run-id home-vault \
  --browser-bin /absolute/path/to/agent-browser --ca-cert /absolute/path/to/public-root.crt \
  --approve SIGNUP_DIGEST
node packages/cli/bin/selfhost.mjs vaultwarden signup status \
  --project-root /absolute/project --run-id home-vault
node packages/cli/bin/selfhost.mjs vaultwarden close-registration \
  --project-root /absolute/project --run-id home-vault \
  --input /absolute/project/vaultwarden-verified-existing.json \
  --signup-evidence /absolute/project/.selfhost/vaultwarden/home-vault/signup-evidence.json
node packages/cli/bin/selfhost.mjs vaultwarden close-registration \
  --project-root /absolute/project --run-id home-vault --approve CLOSE_DIGEST
node packages/cli/bin/selfhost.mjs vaultwarden status \
  --project-root /absolute/project --run-id home-vault
```

Use `vaultwarden help` for the exact flags. The signup evidence must record a
secure context, working WebCrypto, account creation, and a fresh login; the
browser step and post-closure login/registration checks remain required.
Signup binds the applied bootstrap identity, manifest/image, HTTPS owners,
public CA, exact executable, managed-credential fingerprint, and pinned UI
policy. It needs Bun and NSS `certutil`, creates a fresh CA-trusted isolated
browser, leaves breach lookup off, submits account creation once, signs out,
and requires identity-matched fresh login before writing evidence. The browser
executable must be a canonical regular file, executable and not group/world
writable; use the installed canonical native binary if an npm launcher is
unsafe. The sandbox
defaults to enabled; a host that requires `--browser-sandbox disabled` must
include that exact choice in both signup plan and apply. TLS certificate
checks remain enabled. A mode-`0600` no-clobber attempt ledger is flushed before
browser work and before submission. Interrupted, rejected, or unknown attempts
can never repeat signup; status directs existing-account login reconciliation
only. Its owned nonce session is also flushed before launch, so interrupted
status can offer private takeover without claiming launch or TLS provenance.
Failures report a fixed stage and the adapter-owned unpredictable browser
session, retained for private takeover without replaying actions. Do not print
populated snapshots, field values, full URLs, or raw browser envelopes. The
ordinary fixed-session login command does not target that retained nonce
session. Successful signup closes only its owned session. It never resets the
vault or re-enables registration. Another device
still needs its own DNS and CA trust.
`status` reports saved phase checkpoints, not live vault health. In rootless
Docker, first apply creates the exact `/data` directory and uses one scoped
Compose helper container to map it to the configured container UID/GID;
registration closure preserves that mapped ownership. Direct host-user reads
of `/data` may fail, so backups and restores need an owner-approved container
path. Fresh login/unlock and registration closure remain setup gates; verify
isolated recovery before migrating real vault contents or claiming protection.

To add an already-verified app to an existing private Homarr board, create an
owner-only `0600` JSON input with `schemaVersion: 1`,
`homarr: {origin, boardName}`, and
`service: {id, name, description, href, iconUrl, access, storagePath}`.
For a CLI-managed app and onboarded Homarr saved under the same project root,
`self-host app homarr-input --id APP --project-root ABSOLUTE`
creates a version-2 input with an exact credential handoff path and prints the
exact `homarr attach plan` command. It leaves a pre-existing version-1 input
untouched and prepares a separate `.v2.json` input for reviewed Notebook
enrichment; use that new input for later board status. The private Notebook
shows the path, never the password or API key;
the file may not exist until separate account preparation is complete.
The plan and status expose that path for review and exact Notebook read-back.
The currently supported Uptime Kuma, Immich, and Paperless-ngx recipes use
their reviewed Dashboard Icons URL; pass `--icon-url HTTPS_URL` to override it
or to supply an icon for another catalog app. The icon URL is not a rendered
icon check. A rerun without `--href` or `--icon-url` preserves a valid
owner-only input's saved browser URL and icon; changing either needs an
explicit reviewed repair, not a silent overwrite.
Use `--href HTTP_OR_HTTPS_URL` only for an operator-supplied route;
without it, the tile link is host-local loopback and is not remote-access proof.
The Notebook labels a supplied route as unverified until its privacy and reachability are checked.
This step does not create a shortcut, companion Notebook, integration, or widget
or verify either app's live health.
Keep the Homarr API key in an owner-only `0600` file; a managed media run's
`connections.env` can be used directly without copying the key. The key's user
needs Homarr `app-modify-all`, `app-create`, and board `modify`
permissions. An admin-created key has those permissions; a lower-privilege key
may stop at the read-only plan. Then:

```bash
self-host homarr attach plan \
  --input /absolute/project/.selfhost/homarr-attach/APP.v2.json --api-key-file /absolute/project/homarr-api-key
self-host homarr attach apply \
  --input /absolute/project/.selfhost/homarr-attach/APP.v2.json --api-key-file /absolute/project/homarr-api-key \
  --approve ATTACH:BOARD_ID:PLAN_DIGEST
self-host homarr attach status \
  --input /absolute/project/.selfhost/homarr-attach/APP.v2.json --api-key-file /absolute/project/homarr-api-key
```

`status` returns `boardUrl` only when the exact private tile and
Notebook read-back passes. The TUI then shows **View dashboard** with the
host-local URL; another device needs a separately reviewed private route or
tunnel, and browser rendering remains unverified.

To replace an already attached server-only link after a private browser route
exists, prepare an immutable candidate; the CLI never overwrites the original
input. Review the returned `inputFile`, then use that exact path for all three
attach commands:

```bash
self-host app homarr-input --id APP --project-root /absolute/project \
  --href https://app.example.internal --route-revision --json
self-host homarr attach plan --input REVIEWED_CANDIDATE_INPUT \
  --api-key-file HOMARR_KEY_FILE --repair-existing-link
self-host homarr attach apply --input REVIEWED_CANDIDATE_INPUT \
  --api-key-file HOMARR_KEY_FILE --repair-existing-link --approve ATTACH:BOARD_ID:REVIEWED_DIGEST
self-host homarr attach status --input REVIEWED_CANDIDATE_INPUT \
  --api-key-file HOMARR_KEY_FILE --repair-existing-link
```

The plan shows the old and new URL. Repair requires one existing linked tile
and a managed Notebook entry matching the candidate in every other field.
Apply preserves the app ID, tile, icon, description, ping URL, and other board
items, then reads back the new link and recap. If an API call partly commits,
inspect status and obtain a fresh approval; do not replay the old token. The
route remains unverified until it is opened privately on the intended device.

The exact approval covers the current board and app state. Apply creates or
reuses one app shortcut. On a fresh private board, a short managed service recap
lives in the primary `Your homelab at a glance` Notebook. A companion
`More services in your homelab` Notebook is used when the primary would exceed
12 estimated mobile rows, or the board already has a media/custom primary or
companion. Existing embedded service details move to the companion only when
needed, without changing media instructions; later media reruns preserve both notes. It
records the credential handoff path for version-2 inputs without copying any
secret into Homarr; a missing handoff file or uncreated account remains a gate. It
does not configure an integration or widget, and it does not prove the app is
healthy. Homarr's current board API rejects names containing spaces; use the
checked browser path for such a board.
The plan lists any migration, companion creation, Notebook-height changes,
and any collision-checked move that closes the gap between the notes. Apply
changes only the planned notes and placements through Homarr's `board.saveBoard`
mutation, preserving the other board items and sections, then reads the private
board back. Estimates are capped at Homarr's 24-row limit; exceptionally long
recaps stop for splitting before mutation. A browser check still must prove
that the resulting note or notes render without clipping.
Media reconciliation and app attachment share one content-aware height estimate.
Reconciliation only grows an undersized recap; attachment may compact it under
its exact reviewed plan. Later reconciliation will not restore obsolete fixed
heights when that same content is already sized correctly.
For an existing same-name app with the correct URL and icon, the plan shows any
one-line description repair before apply. To preserve an existing same-URL
app's icon and description instead, pass `--adopt-existing-app` to both plan
and apply; the plan shows those values and uses them in the recap. A different
URL remains a separate, explicit repair rather than a silent overwrite.

Immich has a second, native Homarr attachment step after its app tile and
`immich accept` pass. Create an owner-only input with
`homarr: {origin, boardName}` and
`immich: {appName, integrationName, url, widgets}`. Set `url` to the
container-reachable Immich origin on their shared Docker network. Then use
`homarr attach immich plan|apply|status` with that input, the Homarr key file,
the Immich key file from `homarr-key create`, and the acceptance file. Its
fresh approval binds the private board, accepted service, and selected widget
options; status reads back the native integration and widgets. App tile,
integration, and rendered widget remain distinct checks.

For an Immich project installed through the generic `app` recipe, run
`self-host app homarr-immich-input --id immich --project-root /absolute/project
--json` only after its accepted, cleaned restart canary and Homarr tile. This
prepares owner-only native input and acceptance files after fresh owned-runtime,
admin-login, and release checks. It does not create the limited Immich API key
or attach the integration: its `nextCommand` stays `null` until that separate
credential gate is completed. Review and approve that gate separately:

```bash
self-host app homarr-immich-key-plan --id immich --project-root /absolute/project --json
self-host app homarr-immich-key-create --id immich --project-root /absolute/project --approve REVIEWED_KEY_TOKEN --json
```

The create step stores the one-time secret in a private file and verifies the
exact key identity and permissions. If creation is uncertain and the secret
was not saved, it stops for manual recovery; it does not create a second key.
Pass the input, acceptance, Homarr key, and returned Immich key paths to the
separate `homarr attach immich plan|apply|status` commands above. Only its
status readback can claim the native widget. Do not use the household-only
`immich homarr-key` command against a generic app project.

Paperless-ngx can use its saved administrator API token for a native Homarr
integration after its tile and private bridge are verified. Fresh TUI setup
plans and saves the token with a separate approval; resumed setup rechecks it
without rotation. For a headless or interrupted project, run
`app paperless-token-plan`, review its `APP-PAPERLESS-TOKEN` approval, then
`app paperless-token-create` and `app paperless-token-status`. The token must
authenticate as the exact managed administrator and read Paperless statistics.
Then prepare the owner-only integration input and use its returned paths:

```bash
self-host app homarr-paperless-input --id paperless-ngx --project-root /absolute/project --json
self-host homarr attach paperless plan --input INPUT_FILE \
  --api-key-file HOMARR_KEY_FILE --paperless-api-key-file PAPERLESS_TOKEN_FILE
self-host homarr attach paperless apply --input INPUT_FILE \
  --api-key-file HOMARR_KEY_FILE --paperless-api-key-file PAPERLESS_TOKEN_FILE \
  --approve ATTACH-PAPERLESS:BOARD_ID:REVIEWED_DIGEST
self-host homarr attach paperless status --input INPUT_FILE \
  --api-key-file HOMARR_KEY_FILE --paperless-api-key-file PAPERLESS_TOKEN_FILE
```

The plan requires one existing Paperless tile on the private board and an
exact Homarr-to-Paperless bridge route. Apply tests live statistics before
adding one widget; status independently reads all five counts. Existing
integration secrets are redacted by Homarr, so matching a saved token byte for
byte is not possible; a stale connection stops before widget placement. A
rendered dashboard remains a separate browser check.

Uptime Kuma has a separate native integration/widget step after its app tile
exists and its public status page is configured in Uptime Kuma. Homarr reads
that page's status and heartbeat endpoints; the app's first-admin setup alone
does not create one. For a connected CLI-owned Uptime Kuma app, run
`self-host app status-page-plan --id uptime-kuma --project-root ABSOLUTE --json`,
review its separate `APP-STATUS-PAGE` approval, then run `status-page-create`
with that token and `status-page-status` to read back the exact `default` page,
one `Services` group, and the saved local self-monitor's heartbeat. The helper
requires Uptime Kuma v2.5.5, a current UP self-monitor, loopback host binding,
and Homarr's approved private bridge. It refuses an existing unowned `default`
page and never blindly repeats an uncertain Socket.IO write. The TUI can
review and attach an existing unowned default page without changing it;
Homarr's separate connection plan must still pass. A previously saved custom
slug remains usable through its owner-only slug file. Kuma serves the
status-page API without authentication even when its `published` field is false.
The helper checks the loopback bind and approved private bridge, but cannot
rule out an existing proxy or tunnel. Review those routes before approval;
public ingress needs its own decision.

```bash
self-host app status-page-plan --id uptime-kuma --project-root /absolute/project --json
self-host app status-page-create --id uptime-kuma --project-root /absolute/project \
  --approve APP-STATUS-PAGE:uptime-kuma:REVIEWED_DIGEST --json
self-host app status-page-status --id uptime-kuma --project-root /absolute/project --json
```

After the page is verified, run
`self-host app homarr-uptime-input --id uptime-kuma --project-root ABSOLUTE --json`
to derive the exact Homarr bridge URL and create a distinct owner-only input;
the command reports the key-file path and next plan command without revealing
the key. Pass `--slug-stdin` only for a non-default status-page slug: the command
reads one raw value from stdin and saves it in a separate owner-only file, never
an argument, environment variable, or ordinary report. A rerun verifies and
reuses the same input and saved slug rather than replacing them. The helper
requires the saved Uptime Kuma app to use Homarr's approved bridge; it does not
retrofit an unconnected app. For a manual
setup, use an owner-only (0600) JSON input with `schemaVersion: 1`,
`homarr: {origin, boardName}`, and
`uptimeKuma: {appName, integrationName, url}`; `url` is the Homarr-reachable
Uptime Kuma origin. Run `homarr attach uptime-kuma plan|apply|status --input
ABSOLUTE --api-key-file ABSOLUTE`, adding `--slug-file ABSOLUTE` and/or
`--uptime-api-key-file ABSOLUTE` only when needed. Each optional file holds one
raw value (not an environment assignment) and must also be owner-only. Review
the exact `ATTACH-UPTIME-KUMA` plan token before `apply --approve TOKEN`. The
adapter requires one existing app tile on the selected private board, tests
the native integration before adding one widget, and checks live dashboard
data through Homarr. An attached widget with an unreachable endpoint remains
live-unverified; rendered layout still needs a browser check. This command
does not create or repair the app tile.

New Immich statistics widgets use a readable 4×2 size (width is capped by
Homarr's layout columns). To repair an older clipped statistics widget, run
`homarr attach immich layout-plan` with the same four input/key/acceptance flags,
review its separate `RESIZE-IMMICH-STATS` token, then run `layout-apply --approve
TOKEN`. This changes only the exact selected statistics widget's dimensions
and, if needed, position; other content stays untouched. It requires a simple
board and refuses ambiguous layouts. Reflow the board separately afterward if
you want the repaired widget packed above the recap. A final desktop/mobile
check—not its API response—must establish readability.

Docmost has `plan`, `recover-plan`, `recover-postgres-parent plan|apply`,
`repair-pgdata plan|apply`, `apply`, and `status` commands. It requires three verified
image digests, a freshly inspected host manifest, and a selected non-root
UID/GID. Apply holds generated secrets in owner-only files and starts only its
exact Compose project. `docmost owner plan|apply|status` provides separately
approved source-pinned owner setup and fresh login; a protected browser remains
the fallback. Health 200 is not full acceptance or
backup proof. The narrowly gated rootless PGDATA repair preserves an inaccessible
failed-initialization directory in a deterministic quarantine and never starts
Docker or deletes data. Rootless PostgreSQL 18 uses an owner-only startup wrapper
to transfer only its bind-mounted parent to the mapped `postgres` identity before
the official entrypoint drops privileges. Existing stopped projects require the
exact `recover-postgres-parent` approval; normal `docmost apply` remains separate. The
[Docmost input and recovery contract](dist/docs/docmost-cli.md) ships with this package.
For its local first-owner or login form, `self-host docmost browser-password
--project-root ABSOLUTE --run-id ID --ref @eN` fills the generated password
through `agent-browser` stdin in the isolated `selfhost-docmost-ID` browser
session. It never prints the value. The helper requires a healthy checkpoint,
an exact loopback setup/login page, and a fresh enabled password field; the
other account fields and submission remain explicit browser steps.
When multiple browser installations exist, add `--browser-bin ABSOLUTE` and
open the named session with that same executable. The helper resolves a symlink
once and uses the canonical executable for every call; it never falls back to
another browser after failure. Omission preserves the existing PATH default.

After the exact healthy 0.96.0 managed-owner checkpoint, run `docmost accept
plan|apply|status` with the same `--project-root`, `--input`, and `--run-id`.
Plan/apply also require `--account-file`; apply requires its separate
`--approve ACCEPT-DOCMOST:PROJECT:DIGEST` token. Plan and status are read-only.
Apply makes one synthetic nonce page, replaces only its content, uploads one
synthetic text attachment, then uses a second fresh login to verify content,
attachment ownership and downloaded byte hash. Cookies stay in memory and
requests stay on the approved loopback origin, without redirects. The page and
file are retained for inspection; status reports their UUIDs and fixed stage.
A durable attempt, including an interrupted or unknown result, cannot replay.
If create/edit completed but upload is unknown, `docmost accept verify` with the
same account/input flags performs fresh managed-owner readback only. It finds
the exact unique synthetic file through bounded pagination, verifies ownership
and bytes, and writes separate owner-only verification evidence without changing
the original attempt. Status labels this `verified-readback`, distinct from a
successful write attempt. No upload, edit or deletion is retried.
This proves API editing, attachment linkage and retrieval—not browser editor
rendering, Homarr, backup or isolated restore. These Community routes are pinned
to exact source, not advertised as a supported public API.

For a native single-database export, use `docmost db-export plan|apply|status`:

```bash
self-host docmost db-export plan --project-root /absolute/project \
  --input /absolute/project/docmost-input.json --run-id initial \
  --account-file /absolute/project/docmost-account.json \
  --destination /absolute/private-backups \
  --output /absolute/private-backups/docmost.dump
```

The destination must already be a real, caller-owned mode-`0700` directory
outside the project. Review the returned `EXPORT-DOCMOST` token, then repeat
the same flags with `apply --approve TOKEN`. The output and attempt records
must be absent; no overwrite or replay is supported. Apply streams native
PostgreSQL custom format to private mode-`0600` staging, capped at 512 MiB.
The container deadline is 120 seconds plus a five-second termination grace;
the CLI watchdog is 130 seconds. `status` with the same flags checks the retained archive's hash.
Interrupted or damaged attempts remain `unknown-no-replay` for diagnosis.
No database payload, password, or raw Docker output is printed.

This captures only the selected database, not attachments, Redis, secret files,
or cluster-global roles. It does not stop writers, encrypt the archive, create
off-host protection, or verify any restore. Treat the archive as private data;
full application recovery still requires a separately approved isolated drill.

The package has a Node-compatible `self-host` bin; `selfhost` remains an alias.
It is not public on npm. For now, use the source checkout or a locally built
tarball. After a tagged private release, authenticate `gh` to the repository,
then download and install the CLI asset without cloning the repo:

```bash
gh release download v1.1.0 -R ajnart/selfhost-skills -p 'ajnart-selfhost-1.1.0.tgz'
npm install -g ./ajnart-selfhost-1.1.0.tgz
self-host doctor
```

Use the actual released version in both commands. The release also ships
`CLI-SHA256SUMS`; verify it with `sha256sum --check CLI-SHA256SUMS` before
installing when downloading both assets. Public `npx` publishing is disabled
unless the repository explicitly opts in later.

`plan` changes no host services. The first `up` copies the verified
runtime into the chosen project, creates one private session with generated
credentials, reserves ports, and prints the exact plan and approval digest. It
does **not** start containers. Review it, then use the printed `self-host up
... --approve DIGEST` command. Later `up` restarts only the approved run.
`resume --from STAGE --approve DIGEST` continues a failed stage after repair.
With `--profile media`, root `status`, `info`, and `down` affect only that run;
`down` leaves bind-mounted data. `doctor` checks API transport, credential and
run-lock utilities, Docker and Compose reachability, and Buildx for the default
household image-resolution path. It warns when the Linux inotify limit may
constrain parallel runs and never changes host settings. The installer requires
Linux, Bun, Bash, Docker Engine and Compose.
The basic catalog commands need Node 20.12+ only. Media Docker image references
are not digest-pinned; the Immich path requires the recorded official v3.2.2
tags and digests.
`bundle begin` defaults to host-only. The default `bundle init` and media-only
configuration mode publishes all seven ports on every host interface. The
approval plan names that exposure; configure router or Docker-aware private
firewall rules before applying it. First apply requires `--firewall-scope router-private` or
`--firewall-scope docker-aware-private` in addition to the exact approval
digest. The CLI records your confirmation, not proof of the live rules. To
select host-only media deliberately, pass `--media-bind-mode host-only` to
`bundle init` or media-only `config init`; these commands do not default to host-only. The approved
host-only plan binds all seven ports to 127.0.0.1 without a firewall-scope
assertion. An older CLI-managed loopback run can still use its original saved
approval for `info`, `up`, `down`, and resume; it does not silently migrate.

`config` stores the media profile, run ID, username, optional host-only bind,
optional first media port, and handoff choice in
`.selfhost/cli.json` (0600). `config preferences` stores non-secret paths,
timezone, network, and other choices separately. The first `up` is an explicit
local-state action. Run the read-only `plan netflix` first to review service
choices before creating the private run.
Successful apply writes an owner-only file with service URLs, usernames,
passwords and available API keys by default. Use `--credential-handoff no` to
opt out. Neither mode prints secret values in terminal output.

The successful setup summary points to the Homarr board and, by default,
the private mode-0600 credential handoff. Keep that handoff private. On failure, the AI skill can read
the run-specific fallback artifact and use agent-browser to finish the failed
step, then resume. Catalog planning and media setup do not need a browser;
household Vaultwarden signup does need a protected browser, and the bundled
helper commands require the separate `agent-browser` binary.

The package contains catalog records and workflow identifiers for planning,
but no `SKILL.md`, `GUIDE.md`, AI prompts, or browser runtime. The catalog's
skill identifiers will become neutral capability IDs as the core is extracted.
The packaged media scripts include optional browser-fallback helpers, but not
the `agent-browser` binary or an AI client.
The `/self-host` syntax belongs to coding-agent clients, not a shell.
