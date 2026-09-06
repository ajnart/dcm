# Selfhost Skills

**Replace subscriptions with private services, keep your data on hardware you
control, and decide exactly who can reach it.**

`selfhost-skills` gives Codex and Claude Code a conversational, safety-gated
way to plan and operate self-hosted software. Ask for an outcome such as “my
own Netflix,” “replace Google Photos,” or “back up this server.” The agent
turns that goal into a reviewable stack without treating the request as
permission to change your host.

Not every subscription has a practical self-hosted replacement. The catalog
explains tradeoffs and keeps the final choice yours.

## Install and choose your stack

Before running it, install Git and Bun 1.4.0 or newer, including `bunx`.

Start the interactive installer from the project that will own the stack:

```bash
bunx --bun skills@latest add ajnart/selfhost-skills
```

Choose all seven entries labeled Base, then only the Media pack or Optional
entries you want. The required `basic` profile is setup, upkeep, planning,
host inspection, Compose, operations, and verification. The `media` pack adds the exact
seven-service Media + Homarr workflow. Backup, ingress, observability, research,
and downloader VPN are independent extensions. Setup checks this dependency
closure and installs anything you missed.

To install the complete pack globally into Codex and Claude Code instead:

```bash
bunx --bun skills@latest add ajnart/selfhost-skills --skill '*' --agent codex --agent claude-code --global --copy --yes
```

`--global` makes the selection available outside one project. `--copy` gives
each client complete standalone skill directories. Neither mode needs this
source checkout after installation.

The versioned release ZIP contains the native `skills/`, `.codex-plugin/`, and
`.claude-plugin/` layout used for plugin validation and public-directory
submission. The source checkout deliberately remains canonical under
`.agents/skills/`, so it is not advertised as a repo marketplace plugin.

See the generated [skill index](SKILL_INDEX.md) for risk, activation, and
compatibility metadata. Never put a token in an install command, clone URL,
prompt, shell history, or a checked-in file.

From a source checkout, inspect the same checked profiles through the Bun
TypeScript CLI:

```bash
bun run stack profiles
```

## Your first conversation

Invoke setup on purpose when you want changes:

| Client | Start here |
| --- | --- |
| Codex | `$selfhost-setup media` |
| Claude Code | `/selfhost-setup media` |
| Existing stack | `$selfhost-upkeep` or `/selfhost-upkeep` |
| Plan only | `$selfhost photos`, `/selfhost netflix`, or ordinary language |

The skill keeps the conversation short. It asks only for choices that affect
the result:

- what you want to run, replace, protect, or reach;
- which host should own it and whether existing services may be reused;
- who needs access: this machine, the LAN, a private tailnet, or the public;
- your username policy, when the selected apply capability supports one;
- whether that capability should generate credentials or resolve an existing
  secret reference; and
- whether you want optional pieces such as Homarr, backups, or monitoring.

Say “use the defaults” to accept the recommended stack, private access, one
bounded Compose project, and generated credentials where implemented. An
unsupported credential choice becomes a visible blocker instead of a promise.
Homarr is offered prominently when useful but remains opt-in. Public exposure,
destructive work, migrations, and secret entry still require an explicit
decision.

For example:

```text
You:    $selfhost-setup photos
Agent:  I can plan Immich on this host. Private access is the default.
        Should I use the recommended credential policy and services, or do
        you want to change them or add the optional Homarr dashboard?
You:    Use the defaults, but add Homarr.
Agent:  I’ll inspect the host read-only and show you the plan before changes.
```

Do not paste an existing password or API key into chat. The setup agent resolves
or generates values only at the narrow apply boundary. For the managed media
pack, it tells you the generated `admin` password at final handoff.

## Homarr: the optional front door

[Homarr](https://homarr.dev) is the recommended optional control plane for
supported stacks. It can provide one dashboard for apps and widgets plus one
private MCP endpoint for read-only agent inspection. The underlying stack must
still work without it, and selecting Homarr never grants authority over another
service or makes anything public.

Use `$selfhost homarr` in Codex or `/selfhost homarr` in Claude Code for a
standalone Homarr plan. In another goal, accept it when the router offers the
optional dashboard role. Direct administration for Sonarr, Radarr, Prowlarr,
and qBittorrent can remain private even when approved users reach Homarr or
Jellyfin remotely.

![Illustrative Homarr dashboard with local widgets and app links](./homarr-dashboard.png)

_Illustrative, redacted screenshot from the repository harness. It shows the
kind of dashboard Homarr can provide; it is not evidence that a current
deployment or every integration is verified._

## How it works

![Selfhost conversation and approval flow](docs/images/selfhost-flow.svg)

1. **Resolve the selected profile.** `$selfhost-setup` first checks the required
   Base, Pack, and Extension skills without mutating browser state. Through the
   normal approval flow it installs missing selected skills plus the official
   `agent-browser` skill, CLI, and browser, then runs the gated browser check.
2. **Understand the goal.** The router turns a purpose into a small set of
   service choices and offers recommended defaults.
3. **Inspect read-only.** `selfhost-host` checks the platform, Docker context,
   ports, paths, disks, networks, and bounded existing resources it can see.
4. **Build a plan.** The selected capabilities describe reuse, conflicts,
   paths, exposure, secrets, backups, acceptance, and rollback without secret
   values.
5. **Ask for approval.** The agent shows the exact project and operations.
   Material choices remain visible instead of being hidden behind defaults.
6. **Apply narrowly.** Only the owning capability may change its explicitly
   identified Compose project or configuration boundary.
7. **Verify independently.** Evidence is checked against the selected stack's
   acceptance contract. A running process or HTTP 200 is not broad success.
8. **Record and hand back.** Private `.selfhost/stack.json` records the profile,
   owned services, explicit extension-to-service bindings, adapter pointers,
   and typed checkpoint evidence for upkeep. The
   final summary includes the media admin password when one was generated.

Every run follows the same lifecycle:

```text
select -> inspect -> plan -> approval -> apply -> verify -> handoff
```

Planning is a valid stopping point. If the host cannot be inspected, a secret
is unavailable, or evidence is weak, the workflow reports that limit instead
of inventing certainty.

## Common goals and stacks

| Ask for | Common choices | Purpose |
| --- | --- | --- |
| “My own Netflix” | Jellyfin, Seerr, Sonarr, Radarr | Play an authorized library and organize requests |
| “Replace Google Photos” | Immich | Back up, browse, search, and share photos |
| “Replace Dropbox or Drive” | Nextcloud, Syncthing | Store files or synchronize them between devices |
| “Scan and search documents” | Paperless-ngx, Stirling PDF | OCR an archive and perform private PDF work |
| “Host my password vault” | Vaultwarden | Run an encrypted vault with deliberate recovery |
| “Automate my home” | Home Assistant, Frigate | Connect local automations and camera events |
| “Reach it from my phone” | Tailscale, Headscale, Caddy, Pangolin | Add private or separately approved public access |
| “Back up this server” | Restic, BorgBackup, Kopia | Protect configuration, data, and databases off-host |
| “Monitor my services” | Uptime Kuma, Gatus, Beszel | Observe health and route actionable alerts |
| “Run AI locally” | Ollama, Open WebUI | Serve supported models behind a private interface |

The validated catalog contains 107 applications across 14 goal stacks for
media, photos, documents, files, passwords, home automation, networking,
monitoring, backups, containers, developer tools, productivity, databases,
storage, and local AI.

A bare `vpn` stays ambiguous because remote access and downloader-only VPN
routing solve different problems. The skill asks which purpose you mean.

## Resume an existing project

Return to the same project directory and explicitly invoke `$selfhost-upkeep`
or `/selfhost-upkeep`. It reads confirmed intent and lifecycle state from:

```text
.selfhost/preferences.json
.selfhost/project.json
.selfhost/stack.json
```

`preferences.json` remembers choices such as paths, locale, exposure, and
backup policy. `project.json` remembers the goal, selected services, plan
fingerprint, and planning checkpoint. `stack.json` records selected profiles,
installed skills, owned services, explicit consuming-profile bindings, runtime
and connection-file pointers, and typed lifecycle evidence. The first write
creates `.selfhost/.gitignore`;
these records contain neither raw host inventory nor secret values.

Upkeep re-inspects the real host, then resumes, extends, updates, repairs, or
re-verifies the exact recorded stack. Saved context explains intent; it does
not prove that containers, ports, disks, networks, or proxies remain healthy.

## Credential handoff

The conversation may collect a username and credential policy only when the
selected apply capability implements it. Secret values stay out of prompts,
plans, logs, screenshots, fixtures, and client configuration.

For the seven-service media harness, one mode-`0600` `connections.env` retains
local URLs, usernames, and available API keys so later extensions can wire
services without rediscovery. It never stores the initial admin password.
After verification, setup runs the explicit handoff command and tells the user
the generated `admin` password directly. The stack record stores only the
connection-file path and its non-secret schema, never its values.

## Safe by default

- Inspection and planning are read-only. Apply requires approval for the exact
  project, paths, exposure, and operation.
- Local, LAN, or private-tailnet access is the default. Public access needs a
  separate plan with one owner for DNS, TLS, ports 80/443, and authentication.
- One Compose project is the mutation boundary. The pack never runs a
  host-wide Docker teardown, prunes volumes, or casually mounts the Docker
  socket.
- Existing containers, networks, paths, and proxies are reused only after
  ownership and lifecycle are known.
- Downloader VPN safety requires a recorded tunnel-break test that proves
  traffic fails closed.
- Backup verification requires an isolated restore. A backup file on the same
  disk is not independent recovery.
- The media stack supports only legally obtained, owned, public-domain, or
  otherwise authorized content.

## Composable architecture

![Markdown-led skill architecture with bounded deterministic scripts](docs/images/selfhost-architecture.svg)

The repository is intentionally Markdown-led. Markdown defines the
conversation, workflows, safety gates, references, and completion criteria.
Declarative JSON holds catalog facts and stack choices. Small scripts perform
bounded deterministic work such as inspection, rendering, validation,
verification, and debugging; they do not become a second policy layer.

`selfhost-setup` and `selfhost-upkeep` are explicit lifecycle entry points.
`selfhost` remains the planning router. Together they compose only the
capabilities needed for the selected profile and goal:

| Skill | Boundary it owns |
| --- | --- |
| `selfhost-setup` | Prerequisites, selected-profile setup, stack metadata, and final access handoff |
| `selfhost-upkeep` | Resume, extension, upgrade, repair, and re-verification of a recorded stack |
| `selfhost` | Goal routing, catalog choices, preferences, and a redacted plan |
| `selfhost-host` | Read-only host discovery and path advice |
| `selfhost-compose` | One explicitly owned Docker Compose project |
| `selfhost-ingress` | LAN, tailnet, reverse proxy, DNS, TLS, and tunnels |
| `selfhost-vpn` | Downloader-only VPN isolation and fail-closed evidence |
| `selfhost-backup` | Backup policy and isolated restore proof |
| `selfhost-observe` | Health, logs, metrics, alerts, and edge checks |
| `selfhost-operations` | Upgrades, migrations, rollback, and troubleshooting |
| `selfhost-research` | Current official deployment and lifecycle evidence |
| `selfhost-verify` | Independent, secret-free acceptance aggregation |
| `selfhost-media` | Opt-in Homarr-enhanced media harness |
| `selfhost-homarr` | Optional dashboard, integrations, API, and read-only MCP |

The checked registry contains 14 packaged skills, including 2 specialized adapters:
the stack-scoped `selfhost-media` and application-scoped `selfhost-homarr`.
Capabilities remain separate so a photo setup does not inherit media,
downloader, or public-network authority.

### Repository map

```text
.agents/
├── skills/selfhost/              # Router, catalog, stack selection
├── skills/selfhost-setup/        # Explicit new-stack lifecycle
├── skills/selfhost-upkeep/       # Explicit continuation lifecycle
├── skills/selfhost-*/            # One operational boundary per capability
├── CONTEXT.md                    # Shared product and safety vocabulary
├── invocation.md                 # Composition and resume contract
└── install.md                    # Distribution contract
docs/                             # Human service notes and diagrams
prompts/                          # Segmented media workflow stages
scripts/                          # Focused validation and debugging tools
PROMPT.md                         # Canonical media-harness entry point
docker-compose.yml                # Canonical media-harness Compose source
README.md                         # Human entry point
```

The exact package registry is
`.agents/skills/selfhost/references/catalog/skills.json`. Installed skills
carry their own `scripts/`, `references/`, and `assets/`, so runtime behavior
does not depend on arbitrary files in this repository.

## Media and Homarr boundary

The managed owned-content adapter connects Seerr, Jellyfin, Sonarr, Radarr,
Prowlarr, qBittorrent, and Homarr. Generic media plans can omit Homarr. Invoke
`$selfhost-media` in Codex or `/selfhost-media` in Claude Code only when you
want that exact seven-service harness.

The harness publishes each service as `${PORT:-default}:container-port`
without forcing a host IP. This is convenient on LAN hosts, but Docker may
listen on every host interface. Keep the machine behind a trusted firewall and
use `selfhost-ingress` before making anything internet-facing.

Homarr must use exactly:

```text
ghcr.io/homarr-labs/homarr-test:v2
```

Homarr app tiles, integrations, and widgets are separate acceptance claims.
Its API key stays in a private profile, and the local bridge injects it only at
runtime. The default client fragment remains strictly read-only. It can inspect
integrations and search Seerr, then show the exact match and ask for
confirmation, but it cannot submit a request or modify an app.

The pack does not provide a mutation-capable Homarr client fragment or bridge.
`integration_requestMedia`, `app_update`, `mediaRequests_answerRequest`, and
other unapproved tools remain unavailable. Keep Homarr's native `/api/mcp`
private; a public dashboard route must deny that path while the packaged bridge
reaches it over loopback, LAN, or a private tailnet.

## Installation options

For a non-interactive project-local install of the complete pack:

```bash
bunx --bun skills@latest add ajnart/selfhost-skills --skill '*' --agent codex --agent claude-code --yes
```

List available skills without installing:

```bash
bunx --bun skills@latest add ajnart/selfhost-skills --list
```

For a smaller install, replace `--skill '*'` with a named selection such as
`--skill selfhost-setup`, repeat it for the desired profile, and keep only the
intended `--agent` targets. The setup prerequisite gate resolves and offers to
install every missing required sibling before apply.

`--all` is deliberately broader: it selects every skill for every agent target
supported by the CLI. Use it only when that fan-out is intentional. See
[the installation contract](.agents/install.md) for exact Base, Pack,
Extension, global, project-local, copy, and selective-install behavior.

## Requirements

- **Git and Bun:** Git plus Bun 1.4.0 or newer for installation. Verify `git`,
  `bun`, and `bunx`, then
  install from the public repository without embedding credentials in URLs.
- **Docker:** Docker Engine or Docker Desktop with Docker Compose v2 for stacks
  that use Compose. Confirm the intended Docker context before any apply.
- **Storage:** enough suitable storage for the selected workload, plus a
  distinct backup target when recovery matters.
- **Browser evidence:** setup installs the official `agent-browser` skill, Bun
  CLI package, and Chrome for Testing when they are absent. Its first
  prerequisite pass is non-mutating; after approval, `--verify-browser` may
  clean stale agent-browser daemon sidecars through the official doctor.
  Browser-backed checks use an isolated named session and never disable
  Chromium's sandbox automatically.
- **Platform-specific dependencies:** follow the official source selected by
  `selfhost-research`; discovery never implies permission to install them.

## Validate this repository

The repository maintenance gate runs on Bun 1.4.0 or newer:

```bash
bun scripts/skillpack.ts validate --scope all
bun scripts/skillpack.ts validate --scope all --json
```

It checks skill metadata, references, catalog semantics, required siblings,
the Homarr image, bundled-media drift, prohibited runtime material, and
Bun TypeScript/Bash syntax. It does not use Docker, a browser, or the network.

The explicit installer smoke test is separate:

```bash
bash scripts/smoke-install.sh
```

The smoke check requires Bun 1.4.0 or newer. It resolves the installer through
`bunx --bun` and uses disposable projects to verify default symlink, explicit
copy, and selected-profile layouts. It does not change a real client or global
configuration.

## Troubleshooting

- **Repository not found:** confirm the repository and requested release or
  branch exist; keep credentials out of commands and URLs.
- **A required skill is missing:** install the full pack or the exact siblings
  returned by `$selfhost-setup` or `$selfhost-upkeep` prerequisite checks.
- **The skill works only inside the source repo:** reinstall with both
  `--global` and `--copy`, then start a new client session.
- **An existing project does not resume:** invoke `$selfhost-upkeep` from the
  directory that owns `.selfhost/stack.json`.
- **Host facts are unavailable:** grant only the narrow read access needed, or
  leave those facts unknown.
- **Catalog facts are stale:** refresh official lifecycle, image, and
  deployment evidence before apply.
- **Media bundle drift:** update the canonical harness through its owning
  workflow and regenerate the bundle. Do not patch the generated copy.
- **Browser checks are blocked:** fix the prerequisite or report the UI as
  unverified.

## More detail

- [Invocation and composition](.agents/invocation.md)
- [Installation contract](.agents/install.md)
- [Shared concepts and safety model](.agents/CONTEXT.md)
- [Catalog design](.agents/skills/selfhost/references/catalog.md)
- [First-party skills repository research](research/skills-repo-patterns.md)
- [Media harness guide](docs/README.md)
- [Contribution and release rules](CONTRIBUTING.md)

Affiliate relationships, if added later, must be disclosed beside the link and
cannot influence rankings or defaults. Product names, trademarks, upstream
licenses, hosted-service terms, and media rights remain with their respective
owners.
