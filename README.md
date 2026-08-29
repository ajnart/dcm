# Replace subscriptions with private services you own

Run popular services on your hardware, keep control of your data, and reuse the
server you already have. `selfhost-skills` helps an agent plan and operate a
private setup without treating a broad request as permission to change your
host.

Not every subscription has a practical self-hosted replacement. The catalog
shows the tradeoffs and keeps the final choice yours.

## Install once

The recommended private-repository install adds all 12 packaged skills to Codex
and Claude Code:

```bash
npx skills@latest add ajnart/selfhost-skills --skill '*' --agent codex --agent claude-code --yes
```

Before running it, install Git and Node.js 22.20.0 or newer, including npm/npx.
Node.js 24 is recommended. Give Git access to the private repository with your
existing credential helper, `gh auth login`, or SSH. Never place a repository
token in the command, a clone URL, a prompt, shell history, or a checked-in
file.

`--all` is deliberately broader: it selects every skill for every agent target
supported by the CLI. Use it only when that fan-out is intentional.

## Ask for what you want

| Client | Example |
| --- | --- |
| Claude Code | `/selfhost netflix` |
| Codex | `$selfhost netflix` |
| Either | `/selfhost` to browse common goals |
| Natural language | “Help me replace Google Photos on my existing server.” |

More examples:

```text
/selfhost photos
/selfhost documents and OCR
/selfhost backups
/selfhost remote access
/selfhost route qBittorrent through a VPN
```

A bare `vpn` stays ambiguous because private remote access and downloader-only
VPN routing solve different problems.

## One optional control plane with Homarr

Homarr is the recommended bonus layer for supported stacks: one dashboard for
apps and widgets, plus one MCP endpoint that a coding agent can use to inspect
connected services. It stays optional. A stack must remain useful without
Homarr, and choosing it never grants permission to change another service.

Use `$selfhost homarr` in Codex or `/selfhost homarr` in Claude Code for a
standalone deployment plan. Call the `selfhost-homarr` skill directly when an
existing instance only needs onboarding, integrations, or MCP setup. Inside
another supported plan, use the exact opt-in shown by the router, such as
`--select dashboard=homarr`.

A practical remote setup can expose only Homarr and user-facing apps such as
Jellyfin while keeping Sonarr, Radarr, Prowlarr, and qBittorrent administration
private. Public access is never automatic: the plan still needs an explicit
ingress and authentication decision with one owner for DNS, TLS, and ports
80/443. Keep Homarr's native `/api/mcp` private; a public dashboard route must
deny that path, while the packaged read-only bridge reaches it over loopback,
LAN, or a private tailnet.

The packaged Homarr MCP bridge is currently read-only. An agent can inspect
integrations and search Seerr, then show the exact match, but it cannot submit
a request or modify an app. Future write actions must use a separate, narrowly
approved capability rather than inheriting access from the dashboard. Homarr's
native MCP remains the extension point for those future agent actions, so each
connected service does not need a separate public agent endpoint.

## What can it replace?

| Goal | Common self-hosted choices | What they do |
| --- | --- | --- |
| Streaming library | Jellyfin, Seerr, Sonarr, Radarr | Play owned media and organize requests |
| Google Photos | Immich | Back up, browse, and share photos |
| Dropbox or Drive | Nextcloud, Syncthing | Store or synchronize files |
| Document subscriptions | Paperless-ngx, Stirling PDF | Search scanned documents and work with PDFs |
| Password manager | Vaultwarden | Keep an encrypted password vault |
| Home monitoring | Home Assistant, Frigate | Automate a home and manage camera events |
| Remote access | Tailscale, Headscale, Caddy, Pangolin | Reach selected services safely |
| Cloud AI tools | Ollama, Open WebUI | Run supported models on your own hardware |

The validated catalog contains 107 applications across 14 goal stacks for media, photos,
documents, files, passwords, home automation, networking, monitoring, backups,
containers, developer tools, productivity, databases, storage, and local AI.

## Every run ends in plain language

The final summary tells you:

- what the agent inspected, planned, changed, and verified;
- what every selected service does;
- what existing containers, networks, paths, or proxies it reused—or that the
  current host could not be inspected;
- what it left unchanged;
- what is blocked or still needs your decision; and
- the safest next step.

A planning run says clearly that it changed nothing. A running container or an
HTTP 200 response is reported as a narrow observation, not proof that the whole
service works.

## Returning to an existing setup

Use the same project root when you return. The workflow loads confirmed,
secret-free choices and prior progress from:

```text
.selfhost/preferences.json
.selfhost/project.json
```

`preferences.json` remembers choices such as paths and exposure.
`project.json` remembers the goal, selected services, plan fingerprint,
workflow checkpoint, and short opaque evidence IDs—not credentials or raw host
data. Invoke `/selfhost` or `$selfhost` again from the same project folder to
rebuild the current plan. With no new goal, the skill checks only that folder
for saved state before it shows the catalog menu.
The first local-state write also creates `.selfhost/.gitignore`, so these files
do not rely on the target repository already having an ignore rule.

The workflow still re-inspects the real host because containers, ports, disks,
networks, and proxies may have changed since the previous run. Saved progress
is stale until that check succeeds. Existing resources are marked `reuse`,
`coexist`, or `conflict` only after ownership is known. A familiar name is
never enough to auto-adopt a container or network.

Preferences may remember paths, locale, exposure, and backup choices with their
source. Credentials, tokens, keys, cookies, and other secrets are rejected.

## Safe by default

Every workflow follows:

```text
inspect -> plan -> approval -> apply -> verify
```

Inspection and planning are read-only. Applying changes requires approval for
the exact project, paths, network exposure, and operation. Public access,
destructive work, downloader VPN routing, extra privileges, and migrations have
separate gates.

The default is local, LAN, or private-tailnet access. A public route needs one
clear owner for DNS, TLS, ports 80/443, and authentication. The pack never runs
a host-wide Docker teardown, prunes volumes, or casually mounts the Docker
socket.

Downloader VPN safety requires a recorded tunnel-break test that proves traffic
fails closed. Backup safety requires an isolated restore; a backup file on the
same disk is not independent recovery.

## Small skills that compose

`selfhost` is the user-facing router. It selects only the capabilities needed
for the goal:

| Skill | Plain-language job |
| --- | --- |
| `selfhost-host` | Inspect the current host and recommend safe paths |
| `selfhost-compose` | Own one clearly identified Docker Compose project |
| `selfhost-ingress` | Plan LAN, tailnet, reverse proxy, DNS, TLS, or tunnels |
| `selfhost-vpn` | Isolate only the downloader behind a VPN |
| `selfhost-backup` | Plan backups and prove recovery with a restore |
| `selfhost-observe` | Plan health checks, logs, metrics, and alerts |
| `selfhost-operations` | Plan upgrades, migrations, rollback, and recovery |
| `selfhost-research` | Gather current official deployment evidence |
| `selfhost-verify` | Independently decide whether evidence is sufficient |
| `selfhost-media` | Manage the opt-in Homarr-enhanced media harness |
| `selfhost-homarr` | Add the optional Homarr dashboard and read-only agent gateway |

The checked registry contains 12 packaged skills, including 2 specialized adapters:
the stack-scoped `selfhost-media` and application-scoped `selfhost-homarr`. The registry is
`.agents/skills/selfhost/references/catalog/skills.json`. Capabilities remain
separate so a photo setup does not inherit media or public-network authority.

## Media and Homarr boundary

The managed seven-service owned-content harness is an explicitly
Homarr-enhanced adapter. Generic media plans can omit Homarr. When this adapter
is selected, it connects Seerr, Jellyfin, Sonarr, Radarr, Prowlarr,
qBittorrent, and Homarr. Homarr must use exactly:

```text
ghcr.io/homarr-labs/homarr-test:v2
```

Invoke `$selfhost-media` in Codex or `/selfhost-media` in Claude Code for that
exact harness. `/selfhost netflix` is the generic guided plan and keeps Homarr
off until you select it.

The harness publishes each service as `${PORT:-default}:container-port` without
forcing a host IP. This is easier on LAN hosts, but Docker may listen on every
host interface; keep the machine behind a trusted firewall and use the ingress
skill before making anything internet-facing.

Homarr app tiles, integrations, and widgets are verified as separate claims.
Its API key stays in a private profile and the local bridge injects it at
runtime. The default client fragment remains strictly read-only. It can search
for a movie, show the exact match, and ask for confirmation, but it does not
submit a request.

The pack does not provide a mutation-capable Homarr client fragment or bridge.
`integration_requestMedia`, `app_update`, `mediaRequests_answerRequest`, and
other unapproved tools remain unavailable. The media stack supports only
legally obtained, owned, public-domain, or otherwise authorized content.

## Install fewer skills

List the available skills without installing:

```bash
npx skills@latest add ajnart/selfhost-skills --list
```

For a smaller install, replace `--skill '*'` with a named selection such as
`--skill selfhost-host`, repeat it as needed, and keep only the intended
`--agent` targets. Install every required sibling named by the selected stack.
A missing sibling blocks apply; it is never silently replaced.

Use the `--copy` option where symlinks are unavailable. The complete skill
directory, including `scripts/`, `references/`, and `assets/`, is the
installable unit.

## Requirements when something is missing

- **Git and Node:** install Git and Node.js 22.20.0 or newer from a supported
  source, preferably Node.js 24. Verify `git`, `node`, `npm`, and `npx`, then
  configure private GitHub access without exposing a token.
- **Docker:** install Docker Engine or Docker Desktop and Docker Compose v2 from
  official platform documentation. Verify the intended Docker context before
  starting containers or changing exposure.
- **Browser checks:** install `agent-browser` from its current skill
  instructions and use an isolated named session. Never disable Chromium's
  sandbox automatically.

## Validate this repository

The dependency-free repository gate runs on Node.js 18 or newer. That lower
floor does not apply to the external installer:

```bash
node scripts/validate-repo.mjs
node scripts/validate-repo.mjs --json
```

It checks skill metadata, references, catalog semantics, required sibling
skills, the Homarr image, bundled media drift, prohibited runtime material, and
Node/Bash syntax. It does not use Docker, a browser, or the network.

The explicit installer smoke test is separate:

```bash
bash scripts/smoke-install.sh
```

The smoke check requires Node.js 22.20.0 or newer. It uses disposable projects
to verify the default symlink layout and explicit copy layout without changing
a real client or global configuration.

## Troubleshooting

- **Private repository not found:** verify GitHub CLI, credential-helper, or SSH
  access directly. Keep tokens out of commands and URLs.
- **A required skill is missing:** install the full pack or the exact siblings
  named by the plan.
- **Host facts are unavailable:** grant only the narrow read access needed, or
  leave them unknown.
- **Catalog facts are stale:** refresh official lifecycle, image, and deployment
  evidence before applying a plan.
- **Media bundle drift:** update the canonical harness through its owning
  workflow and regenerate the bundle. Do not patch the generated copy.
- **Browser checks are blocked:** fix the browser prerequisite or report the UI
  as unverified.

## Advanced reference

- [How invocation and composition work](.agents/invocation.md)
- [Installation details](.agents/install.md)
- [Shared concepts and safety model](.agents/CONTEXT.md)
- [Catalog design](.agents/skills/selfhost/references/catalog.md)
- [Media harness guide](docs/README.md)
- [Contribution and release rules](CONTRIBUTING.md)

Affiliate relationships, if any are added later, must be disclosed beside the
link and cannot influence rankings or defaults. Product names, trademarks,
upstream licenses, hosted-service terms, and media rights remain with their
respective owners.
