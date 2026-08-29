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

For a returning project, load `.selfhost/project.json` plus confirmed non-secret
preferences from its exact project root. The project record keeps the goal,
service choices, plan fingerprint, checkpoint, and bounded evidence IDs; it
does not keep raw host truth. Then inspect the real host again. Saved context
explains intent; it does not prove that a container, network, port, path, proxy,
or backup is still present or healthy. Resume at the first incomplete stage and
never adopt a same-name resource without ownership evidence.

When no goal is supplied, first check only the exact current project root. If
it contains `.selfhost/project.json`, resume its recorded goal and service
choices. Only a root without saved state gets the categories and small set of
common goals. Never dump every catalog record into the context window.

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

## Required end summary

Every invocation ends with a short plain-language summary, including blocked
or read-only runs. State:

- the user's goal;
- what was inspected, planned, changed, and verified;
- what each selected service does;
- which owned resources were reused, created, left unchanged, or conflicted;
- unresolved decisions and blockers; and
- the next safe action.

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
