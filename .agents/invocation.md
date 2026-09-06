# Skill invocation model

## User entry points

Use `$selfhost-setup` explicitly for a new stack. It checks the selected base,
pack, and extensions, installs missing prerequisites through the active agent,
creates `.selfhost/stack.json`, and continues through approved apply, browser
configuration, verification, and access handoff.

Use `$selfhost-upkeep` explicitly for an existing `.selfhost/stack.json`
project. It refreshes host evidence before status, extension, upgrade,
migration, repair, reconnect, or re-verification work.

Use `selfhost` for planning. It supports explicit calls such as `/selfhost
netflix` in Claude Code and `$selfhost netflix` in Codex, plus natural-language
goals such as “replace Google Photos.” Its discovery description permits
implicit invocation, but it never treats invocation as approval to mutate a
host.

The router follows a short `explore -> present -> confirm -> write`
conversation, resolves the goal, inspects what is safe to inspect, loads
non-secret preferences, selects a stack, and presents a redacted plan. It leads
with a recommended answer, explains each service's purpose, skips settled
questions, and accepts `defaults` for safe planning choices. An explicit
request for Homarr itself routes to the
`homarr-control-plane` goal and its `selfhost-homarr` adapter; Homarr stays an
unselected recommendation when it is only an enhancement to another goal.

For a returning planning project, load `.selfhost/project.json` plus confirmed
non-secret preferences from its exact project root. The project record keeps
the goal, service choices, plan fingerprint, checkpoint, and bounded evidence
IDs; it does not keep raw host truth. Then inspect the real host again. Saved
context explains intent; it does not prove that a container, network, port,
path, proxy, or backup is still present or healthy. Resume at the first
incomplete stage and never adopt a same-name resource without ownership
evidence.

When no goal is supplied, first check only the exact current project root. If
it contains `.selfhost/project.json`, resume its recorded goal and service
choices. Only a root without saved state gets the categories and small set of
common goals. Never dump every catalog record into the context window.

## Conversation contract

The canonical intake is
[`selfhost/references/conversation.md`](skills/selfhost/references/conversation.md).
Ask only unresolved choices that change the plan: purpose, people and devices,
exact project root, services and optional Homarr, relevant paths, exposure,
backup and VPN policy when applicable, and credential policy. Recommend one
answer first and keep alternatives short. A one-word `defaults` answer accepts
catalog and private-first planning defaults; it does not select optional roles
or approve mutation and risk gates.

Collect credential policy, never credential payloads. The managed media adapter
uses fixed username `admin` with a generated per-run password. Final setup
tells the user that password directly without storing it. Other custom
credentials wait for a supported private apply boundary. Never request
password, token, key, cookie, or recovery-code values in chat.

## Base capabilities

Portable descriptions label every base entry. Clients that render the OpenAI
metadata also number them as setup, upkeep, planning, host inspection, Compose,
operations, then verification. Setup and upkeep are explicit-only; the other
capabilities are model-invoked and may also be called explicitly for a bounded
task.

- `selfhost-host`: host/runtime/storage/network inspection and path advice.
- `selfhost-compose`: project rendering, preflight, apply, and ownership.
- `selfhost-operations`: upgrades, migrations, rollback, and troubleshooting.
- `selfhost-verify`: independent acceptance and secret-free evidence.

## Packs and extensions

- `selfhost-media` and `selfhost-homarr`: the Media + Homarr pack, which
  extends the complete base.
- `selfhost-backup`: backup policy, app-consistent capture, and restore drills.
- `selfhost-ingress`: LAN, tailnet, reverse proxy, DNS, TLS, and tunnels.
- `selfhost-observe`: health, metrics, logs, alerts, and edge checks.
- `selfhost-research`: current primary-source and browser research harness.
- `selfhost-vpn`: downloader-only VPN routing and kill-switch evidence.

Each extension extends the complete base independently. Multiple selections
form a union; optional packs and extensions are never implied.

The Media + Homarr pack contains:

- `selfhost-media`: opt-in Homarr-enhanced personal-media adapter.
- `selfhost-homarr`: optional Homarr control-plane, dashboard, API, and
  read-only MCP adapter.

Do not create one skill per catalog row. An app earns a dedicated skill only
when it has reusable special behavior beyond declarative facts.

## Composition rules

1. Resume saved intent or confirm a goal, exact project root, and initial role
   choices through the conversation contract.
2. Inspect the selected host with `selfhost-host`, including returning projects.
3. Reuse compatible infrastructure or report a conflict.
4. Present host-dependent paths and gates, then confirm only unresolved choices.
5. Compose only the selected capabilities and apps; optional roles remain off.
6. When Homarr covers useful selected apps, offer it prominently as an
   optional control plane. Never auto-select it or make its absence block the
   base stack.
7. Present the plan and obtain the relevant approval.
8. Apply through the owning capability or adapter.
9. Verify through `selfhost-verify`, including edge/VPN/restore proof when the
   plan selected those capabilities.
10. Persist only confirmed non-secret preferences and evidence paths.

Homarr's dashboard can be the only remotely reachable administration surface while
service administration such as Sonarr, Radarr, Prowlarr, and qBittorrent stays
private. User-facing apps such as Jellyfin may also be exposed. That topology
still requires an explicit `selfhost-ingress` plan and approval for DNS, TLS,
ports 80/443, and authentication. Selecting Homarr does not approve public
access. Keep native `/api/mcp` access private and connect the packaged bridge
over loopback, LAN, or a private tailnet.

The shipped Homarr MCP bridge is strictly read-only: it supports inspection
and Seerr search, not requests or configuration changes. A future write path
must be a separate, narrowly scoped capability with its own approval and
verification contract.

## Required end summary

Every invocation ends with a short plain-language summary, including blocked
or read-only runs. State:

- the user's goal;
- what was inspected, planned, changed, and verified;
- what each selected service does;
- which owned resources were reused, created, left unchanged, or conflicted;
- unresolved decisions and blockers; and
- the next safe action.

When an adapter creates a private connection file, report its exact path
without opening or printing its API keys. The managed media file may contain
URLs, usernames, and API keys, but never its generated initial admin password.
Final `$selfhost-setup` handoff tells the user the `admin` username and generated
password directly; later upkeep displays a password only for a requested fresh
access handoff.

Do not hide uncertainty behind internal status names. Translate them for the
user while retaining exact structured values in machine-readable output. Say
explicitly when a plan changed nothing, when host state was not observable, or
when evidence was too weak or stale to verify a claim.

Capability output uses `pass`, `warn`, `blocked`, or `conflict`. A capability
must not silently repair a failed verification unless the user asked it to
change the system.

## Product overlays

Canonical `SKILL.md` files use Agent Skills standard frontmatter. Codex UI and
invocation metadata lives in `agents/openai.yaml`. Client-specific packaging
may project the same canonical skills, but it must not create a second editable
source tree.
