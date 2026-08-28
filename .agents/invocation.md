# Skill invocation model

## Entry point

`selfhost` is the single user-facing router. It supports explicit calls such
as `/selfhost netflix` in Claude Code and `$selfhost netflix` in Codex, plus
natural-language goals such as “replace Google Photos” or “make Immich private
on my phone.” Its discovery description therefore permits implicit invocation.

The router never treats invocation as approval to mutate a host. It resolves
the goal, inspects what is safe to inspect, loads non-secret preferences,
selects a stack, and presents a redacted plan. It asks only for decisions that
materially change storage, exposure, secrets, destructive work, or rollback.

When no goal is supplied, it presents categories and a small set of common
goals. It does not dump every catalog record into the context window.

## Capability skills

Capability skills are model-invoked and may also be called explicitly for a
bounded task. Initial boundaries are:

- `selfhost-host`: host/runtime/storage/network inspection and path advice.
- `selfhost-compose`: project rendering, preflight, apply, and ownership.
- `selfhost-ingress`: LAN, tailnet, reverse proxy, DNS, TLS, and tunnels.
- `selfhost-vpn`: downloader-only VPN routing and kill-switch evidence.
- `selfhost-backup`: backup policy, app-consistent capture, and restore drills.
- `selfhost-observe`: health, metrics, logs, alerts, and edge checks.
- `selfhost-operations`: upgrades, migrations, rollback, and troubleshooting.
- `selfhost-research`: current primary-source and browser research harness.
- `selfhost-verify`: independent acceptance and secret-free evidence.
- `selfhost-media`: managed personal-media adapter.
- `selfhost-homarr`: Homarr integration, dashboard, API, and MCP adapter.

Do not create one skill per catalog row. An app earns a dedicated skill only
when it has reusable special behavior beyond declarative facts.

## Composition rules

1. Route from a goal to a stack and role choices.
2. Inspect the selected host with `selfhost-host`.
3. Reuse compatible infrastructure or report a conflict.
4. Compose only the selected capabilities and apps; optional roles remain off.
5. Present the plan and obtain the relevant approval.
6. Apply through the owning capability or adapter.
7. Verify through `selfhost-verify`, including edge/VPN/restore proof when the
   plan selected those capabilities.
8. Persist only confirmed non-secret preferences and evidence paths.

Capability output uses `pass`, `warn`, `blocked`, or `conflict`. A capability
must not silently repair a failed verification unless the user asked it to
change the system.

## Product overlays

Canonical `SKILL.md` files use Agent Skills standard frontmatter. Codex UI and
invocation metadata lives in `agents/openai.yaml`. Client-specific packaging
may project the same canonical skills, but it must not create a second editable
source tree.
