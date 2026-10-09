# Self-host

## Quick start

Two steps. Deploying needs Docker with the Compose v2 plugin. Linux, macOS, or
Windows through WSL.

1. **Install the CLI:**

   ```bash
   curl -fsSL https://raw.githubusercontent.com/ajnart/selfhost-skills/main/new-cli/install.sh | bash
   export PATH="$HOME/.local/bin:$PATH"
   self-host --version
   ```

2. **Add the skill to your agent** (needs Git and Bun 1.4+):

   ```bash
   bunx --bun skills@latest add ajnart/selfhost-skills --skill self-host
   ```

Then ask your agent to use the self-host skill ("use self-host to watch my
movies on the TV"; `/self-host` in Claude Code, `$self-host` in Codex), or run
`self-host` yourself for the terminal Dashboard. Installing deploys nothing.

If something fails:

- `self-host: command not found`: add `~/.local/bin` to `PATH`.
- The agent's guide has no New and Advanced paths: run `self-host self-update`.
- Docker missing or stopped: install or start it, then run `self-host doctor`.
- A 404 or authentication error: run `gh auth login`, then
  `gh api -H 'Accept: application/vnd.github.raw+json' repos/ajnart/selfhost-skills/contents/new-cli/install.sh | SELF_HOST_GITHUB_TOKEN="$(gh auth token)" bash`.
- `curl` reports an error but the command seems to succeed: a pipe hides
  curl's exit status. In scripts run `set -o pipefail` first.
- Windows: use WSL; native Windows is unsupported.

### Staying up to date

Run `self-host self-update` to install the newest release, checksum verified.
The terminal Dashboard also asks "Update now? y/n" when one is available, and a
plain command prints a one-line reminder at most once a day on a terminal.
`--json` (agents), CI, development builds and `SELF_HOST_NO_UPDATE_CHECK=1`
never see either. Details: [new-cli/README.md](https://github.com/ajnart/selfhost-skills/blob/main/new-cli/README.md#staying-up-to-date).

The Go CLI is the current product: [installation, terminal Dashboard, agent
commands and support status](https://github.com/ajnart/selfhost-skills/blob/main/new-cli/README.md). Agents run `self-host skill` and
follow the guide it prints, which matches the installed binary. It has its own
release channel (`vX.Y.Z` tags; earlier releases use `new-cli-vX.Y.Z`).

Everything from here on describes the **older TypeScript CLI** and its legacy
workflows. They stay for saved legacy projects (`.selfhost/` owners) and are not
what a fresh install of `self-host` runs.

Own your apps, data, and credentials instead of depending on another
subscription. `self-host` is a private terminal control panel for choosing,
installing, and maintaining self-hosted apps. Its optional AI skill helps you
describe a goal such as “replace Google Photos” and guides the same reviewed
setup. Neither route requires Homarr.

The control panel reuses the existing catalog, per-app setup routes, and
project-scoped Compose lifecycle. It inspects first, shows a plan, asks for
approval, applies only the selected project, and reports what was actually
verified. Installing the CLI or skill alone does not deploy anything.

![Inspect, review, approve, apply, and verify](docs/images/selfhost-flow.svg)

## Install the legacy TypeScript CLI

The older CLI is not on public npm. Build a
standalone package and install it globally:

```bash
git clone https://github.com/ajnart/selfhost-skills.git
cd selfhost-skills
bun install --frozen-lockfile
cli_tgz=$(npm pack ./packages/cli --pack-destination . --silent)
npm install -g "./$cli_tgz"
self-host
```

Building requires Bun 1.4+; running this package requires Node.js 20.12+.
Docker deployment also needs Bun 1.4+ on `PATH` and local Linux Docker/Compose;
`self-host doctor` reports missing prerequisites before deployment.
The installed CLI contains its catalog and does not need the checkout or an
AI account. If an owner gives you a CLI tarball, install it with
`npm install -g /absolute/path/to/file.tgz`. There is no public `npx` CLI
package or CLI tarball in the current release. The
[CLI manual](packages/cli/README.md) covers source execution, checksummed
native artifacts when available, and all command flags.

## Install the AI skill separately

From the project where you want your agent to work, install just the skill:

```bash
bunx --bun skills@latest add ajnart/selfhost-skills --skill self-host --agent codex --copy --yes
```

This needs Git and Bun 1.4+. Then ask
Codex `$self-host photos` or select it with `/skills`. For Claude Code, use
`--agent claude-code` and `/self-host photos`. Pi can invoke
`/skill:self-host photos`; other clients and named-command setup are in the
[install guide](.agents/install.md). Omit `--copy` for the installer's normal
symlink layout. Omit `--agent` to choose a client interactively.

There is only
**one skill** to select. Its internal workflows, catalog, scripts, and media
harness travel together; they are not separate skills to install. It can
locate the private CLI, but the skill itself is not a shell executable.

For a global copy for the supported clients:

```bash
bunx --bun skills@latest add ajnart/selfhost-skills --skill self-host --agent codex --agent claude-code --agent opencode --agent pi --agent openclaw --agent hermes-agent --global --copy --yes
```

Use only the `--agent` flags you need. The CLI and skill are independent:
install either or both. The skill handles conversational choices and targeted
browser repair; deterministic planning and lifecycle actions stay in the CLI.

## Use the control panel

### Optional Homarr dashboard

Homarr starts selected for a new project; deselect it if you don't want a
dashboard. After your apps' scripted first-run setup, the control
panel offers a reviewed dashboard operation: app tiles, supported integrations,
compatible widgets, and a private Notebook explaining the installed services.
Use **Set up Homarr dashboard** to resume it on an existing shared project.
This uses Homarr's API, not Docker labels or a Docker socket.
Use **Check dashboard and recap** to inspect the saved links, integrations,
widgets, Notebook, and live widget data without changing anything or creating
another API key. Failed or unavailable data is reported separately from a
successfully saved board. Known failures include a short next-step explanation;
an HTTP 500 is not presented as proof of a bad password or a DNS failure.

The saved-project menu also offers **Set up private HTTPS**: add a Caddy proxy
for selected apps, verify its hostname-bound certificate, and review supported
app URL settings. This is host-only access; browser/device CA trust and remote
access are separate. Existing apps and saved credentials are retained.

Each app can declare its mapping in `catalog/apps/<id>/homarr.json`, alongside
its recipe and setup adapter. Names, descriptions, ports, and internal URLs come
from the catalog and saved Compose project. Album carousels and individual-system
widgets require an actual selected album/system; they are not invented.

Approved dashboard setup also writes `.selfhost/shared/<project-id>/connections.json`
with service URLs, paths, usernames, passwords, and API keys. This is an
owner-only mode-0600 private file, not normal non-secret preferences. Keep it out
of Git and do not share it. The original per-app credential files remain canonical.
See [app credential types](docs/app-credentials.md) for scopes, expiry, and apps
whose API password or metrics key is not a general management token.

For a saved shared project, the deterministic equivalent is:

```bash
self-host app shared homarr-plan --project-root /absolute/project --project-id selfhost \
  --app homarr --app immich --json
# Review the returned approval, then repeat the same selection with homarr-apply:
self-host app shared homarr-apply --project-root /absolute/project --project-id selfhost \
  --app homarr --app immich --approve SHARED-HOMARR:selfhost:RETURNED_DIGEST --json
# Read-only dashboard check; no approval needed:
self-host app shared homarr-status --project-root /absolute/project --project-id selfhost \
  --app homarr --app immich --live --json
```

Dashboard setup does not wire download clients, subtitle providers, or indexers
between apps. Missing credentials block integration setup. Resource readback is
not rendered-widget or restart acceptance; retained integrations are not silently
reported as freshly connection-tested. Portainer's recipe can initialize its
administrator and save an API key; a Docker endpoint still needs separate
approval and verification. Beszel agent pairing remains unsupported in this
shared flow.

Run `self-host` in a project directory. It opens a saved project if one is
found, shows apps and URLs immediately, and loads Docker health and image
checks in the background. Unknown health stays **unknown**. With no saved
project, choose what you want to self-host or select apps directly. A supported
goal recommends apps for the same shared Compose flow; it does not send you to
a separate installer. Immich, Paperless-ngx, and Docmost reuse their bundled
database/cache services instead of adding duplicate containers. You can
customize the recommendation and opt out of Homarr. Existing shared projects
are extended, not replaced. Review
the exact project, ports, paths, images, and approvals before starting any
container.

**Change app selection** is a searchable multi-select:

| Key | Action |
| --- | --- |
| Type | Filter by app name or ID. |
| Space | Toggle the highlighted app. |
| Backspace | Edit the search. |
| Enter | Review added, retained, image-update-available, and removed apps. |

For a new project, the picker compiles selected recipe-backed apps into **one
shared Compose project**. It shows which apps have a scripted first-run adapter
and which would still need setup. App-specific install choices are collected
before review, including derived HAProxy, Headscale and licensed AIStor/MinIO
recipes. Generated ports and extra application ports are shown together.
Tailscale is a portless connector: starting it is separate from approving
enrollment and private Serve. No fake browser link or app API key is generated.
Its saved-project screen currently shows
URLs, Docker state and documented health, starts or stops exact app units,
resumes setup, and offers a deliberate private credential view. Image checks
load in the background; **Refresh health and image updates** reviews their
results without pulling or replacing containers. These checks compare the
saved digest with the registry's current digest for the same recipe tag;
they do not discover newer version tags. Changed recipes and failed checks
show **unknown**. **Update app images** performs a fresh, one-app review of
old/new digest pins before recreating only that app unit. Data, settings, ports
and saved credentials stay unchanged. Existing login, app function and Homarr
widgets still need rechecking; uncertain updates are not retried automatically.
The shared screen also offers the private CLI update check.
**Change app selection** reviews additions and removes deselected app containers
from the same owner, keeping data and credentials. Dependencies and configured
links must remain intact. Removing the final app remains unsupported; stop the
project when needed. Standard removed apps can be restored through a reviewed
reinstall that preserves data and credentials; specialized recipes may still
require a separate recovery path.
Start/stop preserves volumes, data, and credentials; a
running container is not proof that an app works.

Homarr integration requirements remain explicit. Caddy's managed recipe exposes
only the read-only statistics routes its provider needs, not its administrative
API. Frigate needs an owned HTTPS route and its CA trusted by Homarr before
native publication. Tiles and Notebook descriptions can still be added while
an integration is pending. Configuration alone is not live acceptance, and the
CLI does not weaken authentication to make an integration work.

The older separate-project panel saves a completed selection privately and
reconstructs interrupted work from observed app state. A removed app is stopped
only after review; its data, state, and credentials remain. Image updates are
reported, not installed by this screen. Partial or attempted setup is not
replayed automatically; use **Continue saved setup** or the exact recovery command.
From a saved project, **Select apps for a new project** asks for a different
absolute directory without changing the opened project. The panel also has
scoped Start/Stop and a private CLI update check. The
updater needs a newer checksummed private release, which is not available in
the current release.

Run `self-host catalog recipes --json` for the current installable subset.
Apps without a static recipe are not offered in the new-project picker.
HAProxy and Headscale have reviewed, project-derived recipes for adding to an
existing project; the [CLI manual](packages/cli/README.md) lists their inputs
and setup limits. Other entries without a recipe remain discovery-only; recipe-backed apps
without a first-run adapter are clearly marked setup-pending. A Compose start
or adapter checkpoint does not by itself prove app function or restart persistence.
The catalog now contains only Compose-provisionable apps or bounded Compose
workloads; host operating systems, local-only clients, formats, and retired
products are not app choices.
Older media, household, Vaultwarden, and Docmost routes remain available
through their explicit CLI flows; they do not make the whole catalog
installable. A mixed batch can run independent supported app jobs with
separate exact approvals, but account setup, functional checks, restart
checks, and acceptance remain distinct. See the
[per-app first-run contracts](product/per-app-setup-contract.md).
[single-project CLI route](packages/cli/README.md) is the new-project picker’s
deployment route. Most first-run adapters use private HTTP; non-HTTP apps need
an exact-owned, approval-bound method. Shared-project removal, container-image
upgrade application, and full functional/restart acceptance remain in progress.
App-scoped start/stop and source-backed media link adapters are available;
their presence is not live proof on your host. Seerr's first-admin route requires Jellyfin in that project and
saves Seerr's own API key. Jellyfin can set up owner-selected Movies and Shows
libraries; Seerr now syncs, enables, and reads back exactly those libraries.
qBittorrent now creates and verifies only the categories for selected Sonarr
and Radarr peers. These links and Seerr initialization need independent
verification; restart acceptance remains separate.

For a read-only search or plan outside the menu:

```bash
self-host catalog search photos
self-host catalog recipes --json
self-host plan --goal photos --app docmost --compose --project-root /absolute/project --json
```

Catalog presence and a successful Compose start do not prove that an app
works. The [isolated control-panel proof](product/control-panel-proof.md)
records fresh and resumed two-app Linux trials: Paperless login/document/OCR and
Uptime login/monitor checks passed, including scoped restart persistence.
An approved Paperless API-token step also passed managed-admin identity and
statistics read-back on that existing project; replay did not request another
token. The token is stored separately from the generated password.
An isolated Prowlarr trial also passed generated-admin/API-key setup and a
data-preserving restart; no indexer or downstream app was configured.
It does not establish acceptance on your host, for the other recipes, or for
backup and remote access.

## Homarr is optional

You can run the selected apps without a dashboard. If Homarr is added *after*
standalone apps, the panel can read back host-local bookmark tiles and a stack
Notebook; it does not silently change their Docker networks. If Homarr is
onboarded *before* the apps, their frontends can join its approved private
bridge. In an isolated Homarr-first project, the CLI saved the admin/key,
both app tiles, and the Notebook; native Paperless and Uptime integrations
and widgets then returned live data through Homarr. **Review Homarr dashboard**
can revisit connected apps and standalone bookmarks. API read-back does not
show that a browser link opens from your device.

A tile, a native integration, a working widget, and rendered board access are
separate claims. Specialized native integration/widget commands exist for
some apps and require their own approval and verification. A separately
prepared read-only MCP profile is not installed into your AI client by
default. Homarr uses `ghcr.io/homarr-labs/homarr:dev`; its API and image
contracts are version-sensitive. The [proof record](product/control-panel-proof.md)
establishes native integration/widget data only for the isolated Homarr-first
Paperless and Uptime project. It does not establish browser rendering,
external-device reachability, or every catalog app. The synthetic Paperless
proof document was moved to recoverable trash after read-back. Kuma's
status-page API is unauthenticated; its loopback host bind and private bridge
do not prove that an existing proxy or tunnel cannot expose it.

## Status, restart, and credentials

Use the same absolute project root each time. `status` and `info` summarize
one saved app or batch; lifecycle changes still target an exact app ID:

```bash
self-host status --project-root /absolute/project
self-host info --project-root /absolute/project
self-host app status --id uptime-kuma --project-root /absolute/project --json
self-host app info --id uptime-kuma --project-root /absolute/project
```

`app status` supplies fresh, action-specific approval tokens. Review the
owned Compose project, then use those exact tokens to stop and restart it:

```bash
self-host app down --id uptime-kuma --project-root /absolute/project --approve APP-DOWN:uptime-kuma:REVIEWED_DIGEST --json
self-host app up --id uptime-kuma --project-root /absolute/project --approve APP-UP:uptime-kuma:REVIEWED_DIGEST --json
self-host app status --id uptime-kuma --project-root /absolute/project --live --json
```

Replace `REVIEWED_DIGEST` with the current token from status; do not reuse a
token after the plan changes. `down` stops only that owned Compose project and
does not delete volumes. `--live` checks owned containers on a Linux Docker
host; it is not login, functional, or post-restart acceptance. For media or
household projects, use their owner-specific `session` or `bundle` commands
in the [CLI manual](packages/cli/README.md), not an app command against a
different owner.

Passwords and API keys stay in owner-only project files, not chat, commands,
screenshots, or ordinary reports. Ask for a private handoff only when you
need it; the default command returns its path, while `--show` deliberately
prints secret values in your terminal:

```bash
self-host app handoff --id uptime-kuma --project-root /absolute/project
```

The project stores private state under `.selfhost/`; older skill-managed
profiles use `.selfhost/stack.json`. Removing an app from selection keeps
those records and credentials. Back up the actual durable paths and prove an
isolated restore before claiming recovery protection.

## Host and access limits

The terminal catalog and planner run with Node.js on Linux, macOS, and
Windows. Compose apply routes are supported on a local Linux host with Bun,
Docker Engine, and Compose. From macOS or Windows, the CLI can launch an
already-provisioned Lima or WSL Linux guest; it does not provision that guest
or establish host-side port, DNS, TLS, or browser access.

Private or loopback access is the default intent. Some older media Compose
routes publish ports on all host interfaces; review their firewall scope
before approval. A `127.0.0.1` link is host-local, not a remote-client
access check. Public exposure, VPN egress, backups, and HTTPS need separate
plans and evidence. App health, HTTP 200, a tile, or an API key alone is not
end-to-end acceptance. Media content and indexer sources are yours to
provide; the apps do not include a streaming subscription catalog.

## More detail

- [Full CLI manual](packages/cli/README.md): commands, approvals, resume,
  media/household routes, and private install alternatives.
- [Reuse map](product/control-panel-reuse-map.md) and
  [control-panel proof](product/control-panel-proof.md): implementation scope
  versus host-specific observations.
- [Skill entry](.agents/skills/self-host/SKILL.md),
  [workflow index](SKILL_INDEX.md), and [install guide](.agents/install.md).
- [Research](research/skill-command-comparison-2026-09-24.md),
  [setup-route audit](docs/setup-routes.md), and
  [canonical media harness](PROMPT.md). The packaged harness is generated
  from the root source, not edited independently.
- [Contributing](CONTRIBUTING.md) and [release checks](docs/release.md).

Contributors can inspect the package with
`bun scripts/skillpack.ts validate --scope all`. Changes to the canonical
media harness are regenerated with `bun scripts/refresh-media-bundle.ts`.
