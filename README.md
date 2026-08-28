# selfhost-skills

A private, composable Agent Skills pack for planning, deploying, and operating
self-hosted software without turning a broad request into an unreviewed host
change.

## Install

The recommended private-repository install is one command:

```bash
npx skills@latest add ajnart/selfhost-skills --all
```

Before running it, install Git and Node.js 22.20.0 or newer, including npm/npx;
Node.js 24 is the recommended installer runtime. The current `skills` CLI does
not start on Node.js 18. Give Git access to the private GitHub repository
through an existing credential helper, `gh auth login` plus Git integration,
or a configured SSH key. Verify that access independently first.

Private repository tokens never belong in an install command, clone URL,
prompt, shell history, or checked-in file. The installer uses the Git
authentication already configured on the machine.

## Invoke it

| Client or style | Example |
| --- | --- |
| Claude Code | `/selfhost netflix` |
| Codex | `$selfhost netflix` |
| Interactive menu | `/selfhost` |
| Natural language | “Help me replace Google Photos on my existing server.” |

The same router understands goals such as `netflix`, `photos`, `pdf`,
`backups`, `remote access`, and “route qBittorrent through a VPN.” A bare
`vpn` is intentionally ambiguous: private remote access and downloader-only
egress are different designs.

Installing or invoking a skill grants no host authority. The workflow is:

```text
inspect -> plan -> approval -> apply -> verify
```

Inspection and planning are read-only. A mutation happens only after the user
approves the bounded owner, project, paths, exposure, and operation. Public
reachability, destructive work, downloader VPN routing, expanded privilege,
and forward-only migrations have separate gates.

## How the pack is composed

`selfhost` is the user-facing router. It resolves intent through a declarative
catalog, loads non-secret preferences, asks only for material choices, and
selects focused capabilities:

| Skill | Boundary |
| --- | --- |
| `selfhost-host` | Read-only host, runtime, port, identity, and storage inspection |
| `selfhost-compose` | One explicitly owned Docker Compose project |
| `selfhost-ingress` | LAN, tailnet, reverse proxy, DNS, TLS, and tunnels |
| `selfhost-vpn` | Downloader-only VPN topology and kill-switch evidence |
| `selfhost-backup` | Backup policy, consistency, retention, and restore proof |
| `selfhost-observe` | Health, APIs, dependencies, edge, storage, logs, metrics, and alerts |
| `selfhost-operations` | Upgrades, migrations, troubleshooting, rollback, and recovery |
| `selfhost-research` | Current primary-source, lifecycle, Compose, link, and browser research |
| `selfhost-verify` | Independent, secret-free acceptance aggregation |
| `selfhost-media` | Managed seven-service personal-media adapter and packaged harness |
| `selfhost-homarr` | Homarr app, integration, widget, API, and MCP workflow |

The checked pack registry contains 12 packaged skills, including 2 application adapters:
`selfhost-media` and `selfhost-homarr`. Its declarations at
`.agents/skills/selfhost/references/catalog/skills.json` must exactly match the
installed skill directories. Adding, removing, or renaming a skill therefore
updates the registry in the same change; only application adapters set
`adapter: true`.

Capabilities stay separate so a photo plan does not load a media runbook and an
ingress decision does not inherit Docker authority. An application gets a
dedicated skill only when it has reusable behavior that declarative catalog
data cannot safely express.

## Catalog and goals

The validated catalog contains 107 applications across 27 broad categories:
media and
downloads; photos; documents and OCR; files and sync; passwords and identity;
home automation and cameras; DNS, firewalls, ingress, and private access;
monitoring and observability; backups; containers, NAS, and virtualization;
developer tools; productivity and communication; analytics; databases and
storage; and local AI.

Current goal stacks cover:

- personal media;
- photos and mobile backup;
- documents, PDF, and OCR;
- files and synchronization;
- password vaults;
- home automation;
- remote access;
- backups and disaster recovery;
- monitoring and observability;
- DNS and network filtering;
- local AI;
- downloader privacy; and
- a new hosting platform.

Catalog priority and automation confidence are different axes:

| Field | Meaning |
| --- | --- |
| `managed` | A versioned adapter owns deterministic render, preflight, idempotent apply, acceptance, and rollback |
| `guided` | Current primary guidance and safety gates exist; generation remains host-specific |
| `discovery` | Selection and lifecycle context only; no deployment promise |
| `retired` | Migration and replacement routing only |
| `T0 / T1 / T2` | Curation priority, not deployment confidence or product quality |

A T0 app can still be guided, and a T2 alternative can be the right choice for
specific hardware, licensing, or operating constraints.

## Host, storage, and existing infrastructure

The host capability observes only bounded, redacted facts. It distinguishes
`not_installed` from `not_observable` and separates observed facts, user
choices, and derived recommendations. It supports macOS and Mac mini, Linux
and VPS hosts, Unraid, TrueNAS SCALE, and Proxmox VM/LXC decisions.

Confirmed non-secret choices may be stored at:

```text
.selfhost/preferences.json
```

Preferences can contain logical path choices, locale, exposure class, backup
cadence, and provenance. They reject credentials, tokens, keys, cookies, and
secret-like values. The file is local runtime state and is ignored by Git.

Storage planning keeps configuration, databases, downloads, media, caches, and
backups distinct. Databases and caches may use Docker-managed volumes on
macOS; Linux and NAS paths retain their platform ownership and ACL model.
Media automation uses one consistent container view such as `/data`, and
downloads plus media must share a filesystem when hardlinks or atomic moves
are expected. A backup on the same disk or pool is staging, not independent
recovery.

Existing containers, networks, ports, storage, and proxies are classified as
`reuse`, `coexist`, or `conflict` only after their owner and lifecycle are
known. The pack never adopts infrastructure because its name merely looks
familiar.

## Docker Compose and access

The Compose capability owns one context, project ID, manifest, network set,
path set, and exact file. It rejects floating production inputs, ambiguous
ownership, public protected ports, unsafe privilege, Docker socket mounts, and
secret values. Rendering, `docker compose config` preflight, apply, stop, and
acceptance remain separate stages. It never performs a host-wide teardown,
volume prune, or routine `down --volumes`.

Access is private-first:

- local or LAN binding when remote access is unnecessary;
- Tailscale Serve for private tailnet access, or Headscale when the operator
  intentionally owns the coordination plane;
- one existing Caddy, Traefik, or Nginx Proxy Manager owner for public
  DNS/TLS/80/443;
- Cloudflare Tunnel or Pangolin/Newt for an explicitly approved public route;
  and
- ngrok only for an approved, expiring development endpoint.

A tunnel supplies transport, not authorization. Databases, Docker control,
identity administration, Arr services, and downloader administration remain
private.

Downloader privacy is a separate capability. Only the downloader joins the
Gluetun or WireGuard gateway namespace; Arr, Seerr, Jellyfin, Homarr, proxies,
and host administration stay on their normal private network. A healthy tunnel
is not proof. Acceptance requires a recorded tunnel-break test in which
external IP and DNS access fail closed while the downloader remains running,
followed by restored VPN egress.

## Backups, observability, and operations

A backup plan classifies configuration, durable user data, databases, and
rebuildable caches. It records application-consistent capture, independent
encrypted off-host storage, retention, immutability or offline protection,
RPO/RTO, owners, alerts, and recovery-key custody through opaque references.
Only a timestamped restore into an isolated target can promote the narrow
restore claim to verified.

Observability covers process state, application readiness, dependencies, edge
DNS/TLS/auth, storage, backup freshness, logs, metrics, alerts, and routing.
`planned`, `configured`, and `observed` are distinct states. HTTP 200 or a
running container is never whole-application acceptance.

Upgrade and migration plans preserve current versions, compatibility evidence,
backup and restore gates, health and acceptance checks, and an executable
rollback or forward-recovery path. Every Compose mutation is delegated to the
Compose owner.

## Homarr: links, integrations, widgets, API, and MCP

Homarr models three different things:

- an **app tile** is primarily a board link plus a status/ping surface;
- an **integration** is a credentialed backend connection; and
- a **widget** presents data and may consume an integration.

A generic app tile does not prove an official integration, and an integration
does not prove that its widget works. The catalog records those claims
separately. The audited v2 surface contains 54 standard external integration
kinds, with Docker and Kubernetes documented as separate system surfaces.

The managed workflow keeps the Homarr API key in a private profile and uses
canonical `/api/mcp`. A local stdio bridge injects that key at runtime, so a
generated client fragment contains only the Node executable, bridge path, and
non-secret profile path. The key, Homarr URL, credential-file path, and
credential environment-variable name never enter client configuration. The
default client fragment remains strictly read-only and its real merge requires
`INSTALL-MCP:<profile>`. The bridge prefers Homarr's native catalog; its
bounded curated catalog exists only for the known upstream Date JSON-Schema
failure in `tools/list`.

If the user says “add Spider-Man,” the default bridge may search, present an
exact structured match, and ask for confirmation, but it still stops without
submitting a request. Search evidence and confirmation do not expand a
read-only fragment's authority.

The pack reserves a separate opt-in media-request fragment contract. Treat it
as unavailable unless the installed `selfhost-homarr` package contains and
validates its dedicated generator and bridge path. When present, generation
and client merge each require their own explicit approval; authorization is
limited to the exact integration, media ID, media type, and title selected by
the immediately preceding structured search, expires quickly, and is consumed
after one request attempt. Only `integration_requestMedia` may be exposed;
app updates, request decisions, and every other mutation remain blocked.

## Managed seven-service media graph

The first managed adapter is a private owned-content graph:

```text
Seerr -> Jellyfin
      -> Sonarr / Radarr -> Prowlarr -> qBittorrent
Homarr -> six integrations, six generated app tiles, and integration widgets
```

The seven services are Seerr, Sonarr, Radarr, Prowlarr, qBittorrent, Jellyfin,
and Homarr. The required Homarr image is exactly
`ghcr.io/homarr-labs/homarr-test:v2`.

The packaged harness assigns every candidate a unique `RUN_ID`. That identifier
owns its Compose project, network, ports, state root, browser session, private
secret store, and evidence. Parallel candidates may share the checkout but may
not inspect, reuse, stop, or modify another run.

The prompt-survival history is intentionally preserved:

| Generation | Result |
| --- | --- |
| 1 | Both Luna candidates were disqualified; a supervisor trace established the complete reference path |
| 2 | Both isolated runs completed; candidate A survived with 64 meaningful actions versus 70 |
| 3 | Homarr API/MCP augmentation survived on both Generation 2 runs; A needed 4 extra actions versus 7 and remained promoted |

Generation 3 proved native and bridged read-only search for “Spider-Man: No
Way Home.” Neither candidate invoked a media request or started a download.

This repository supports legally obtained, owned, public-domain, or otherwise
authorized content only. It does not grant acquisition rights, choose
infringing sources, or treat technical reachability as legal authorization.

## Research and browser proof

`selfhost-research` uses current primary sources, labels community packaging
separately, records lifecycle and image provenance, validates status-aware
links, and redacts extracted material before it is reported. Browser work uses
an isolated named `agent-browser` session, an explicit domain allowlist, fresh
accessibility references after navigation, no restored profile or auth state,
and cleanup on every exit path.

If Chromium cannot start with its sandbox, research stops with a browser
environment prerequisite. Disabling the browser sandbox is an explicit human
security decision and is never added automatically.

## Selective installation

List discoverable skills without installing:

```bash
npx skills@latest add ajnart/selfhost-skills --list
```

Run the installer without `--all` to select skills interactively, or use the
current CLI's documented `--skill` and `--agent` flags for a non-interactive
selection. Include every sibling listed under the selected stack's
`requiredSkills`. A missing sibling leaves the plan readable but blocks apply;
it is never silently substituted.

Use copy mode where symlinks are unavailable. The complete skill directory,
including `scripts/`, `references/`, and `assets/`, is the installable unit.

## Missing prerequisite prompts

Give an agent one of these compact prompts when a prerequisite is absent:

> Inspect this host, then install Git and Node.js 22.20.0 or newer from their
> supported upstream or OS package source; prefer Node.js 24. Verify
> `git --version`, `node --version`, `npm --version`, and `npx --version`.
> Configure private GitHub access through the existing credential helper,
> GitHub CLI, or SSH. Do not put a token in a command, URL, prompt, or file.

> Inspect this host, then install Docker Engine or Docker Desktop and the
> Docker Compose v2 plugin from official documentation for this platform.
> Verify only `docker version`, `docker compose version`, and the intended
> Docker context. Do not start containers, change firewall exposure, or mount
> the Docker socket until the selfhost plan is approved.

> Install and verify `agent-browser` using its current official skill
> instructions. Load its core workflow, create an isolated named session, and
> run a public allowlisted preflight without authentication or restored state.
> If Chromium requires `--no-sandbox`, stop and ask for explicit acceptance;
> never disable the sandbox automatically.

## Validation

The installed skill scripts and dependency-free repository gate target Node.js
18 or newer. This lower runtime floor does not apply to the external installer:

```bash
node scripts/validate-repo.mjs
node scripts/validate-repo.mjs --json
```

It validates skill metadata and local references, essential README and
contribution commands, JSON and catalog semantics, required sibling skills,
the Homarr image contract, packaged media-bundle integrity and source drift,
prohibited runtime material, and Node/Bash syntax. It does not use Docker, a
browser, or the network.

The explicit installer smoke test is separate:

```bash
bash scripts/smoke-install.sh
```

The smoke check requires Node.js 22.20.0 or newer. It validates first, resolves
the current `skills` package through npx, proves the required CLI flags from
local help output, and uses separate trap-owned projects to test the default
canonical-copy-plus-symlink layout and explicit `--copy` layout. Each layout
must preserve the exact skill payload. It never changes a real client or
global configuration.

## Troubleshooting

- **Private repository not found:** verify GitHub CLI/credential-helper or SSH
  access directly. Keep tokens out of the command.
- **A required skill is missing:** reinstall the full pack or install the
  exact siblings named by the plan.
- **Host facts are blocked:** grant only the narrow read capability needed, or
  keep the field `not_observable`. Do not widen privileges for convenience.
- **Catalog facts are stale:** refresh the official source, lifecycle date,
  image provenance, and alternatives before proposing apply.
- **Media bundle drift:** update the canonical harness through its owning
  workflow and regenerate the packaged bundle; never patch the generated copy
  to hide drift.
- **Browser environment blocked:** satisfy the browser prerequisite or report
  UI proof as unverified. Do not infer application failure.

## Affiliates, contributing, and license boundaries

The machine-readable affiliate registry is
[`affiliates.json`](.agents/skills/selfhost/references/catalog/affiliates.json)
and is currently empty. If an affiliate relationship is ever added, it must be
disclosed beside the human-facing link and must not influence catalog ranking,
defaults, or machine-readable selection.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for catalog, adapter, evidence, and
release requirements. Product names, trademarks, upstream licenses, container
image licenses, hosted-service terms, and media rights remain with their
respective owners.
