# Selfhost Skills domain

This repository is an self-contained Agent Skill for planning, deploying,
and operating self-hosted software. The seven-service media harness is its
first proven adapter, not the architecture of the whole product.

## Vocabulary

- **Goal**: what the user wants, such as `netflix`, `photos`, `pdf`, `backups`,
  or `remote-access`. A goal is not an application name.
- **Stack**: a declarative recipe that satisfies a goal by selecting app roles,
  alternatives, reusable capabilities, and acceptance checks.
- **App**: one upstream product or external appliance. Upstream software and
  its container image are separate catalog facts.
- **Capability**: reusable operational behavior such as host inspection,
  Compose rendering, ingress, VPN isolation, backup, or verification.
- **Adapter**: special implementation for an app or stack whose lifecycle
  cannot be expressed safely with generic catalog data.
- **Default control plane**: the Homarr dashboard and agent-facing integration
  surface included with every plan. It is the standard access layer, not a
  runtime dependency of the underlying services.
- **Host profile**: observed host facts plus non-secret choices. Facts,
  choices, derived values, and secret references keep distinct provenance.
- **Project**: the bounded unit of ownership for Compose names, networks,
  paths, ports, backups, and rollback. No command targets every deployment.
- **Plan**: a redacted, reviewable diff between the observed host and desired
  stack. A plan has no authority to apply itself.
- **Install profile**: an additive workflow and service selection. `basic` is the required
  setup/upkeep base; every pack or extension extends it without selecting any
  other optional profile. The profile also declares service consumption and
  exact approval/verification evidence obligations.
- **Stack record**: private continuation metadata in
  `.selfhost/stack.json`, created by the setup workflow and resumed
  or extended by upkeep through `self-host`.
- **Secret reference**: a name or location resolved only at the narrow apply
  boundary. It is never the secret value.
- **Evidence**: bounded, secret-free proof from health, API, edge, VPN, backup,
  and UI checks. Process liveness alone is not acceptance.

## Support levels

Catalog priority and automation support are independent:

- **managed**: this repository owns a versioned adapter, renders deterministic
  output, validates it, applies it idempotently, and defines rollback.
- **guided**: current primary documentation and safety gates exist, but an
  agent must generate or adapt deployment files for the observed host.
- **discovery**: the product is searchable with lifecycle, alternatives, and
  sources; no deployment promise is made.
- **retired**: kept only for migration and replacement routing. Never propose
  it for a new installation.

T0/T1/T2 express catalog curation priority, not deployment confidence.

## Stable boundaries

The public `self-host` entry owns user-facing routing. Its bundled
`workflows/selfhost` module owns the catalog, preferences, and plan contract.
Other workflow modules own one operational concern; adapters own special API/UI
behavior. All live inside the single installed skill, including runtime assets.

Internal module IDs remain stable in saved state and the registry. Resolve
`workflows/<id>/GUIDE.md` within the installed skill; load only the selected
workflow and necessary references. No separately discoverable internal skills
or repository checkout are required. A separate public skill must justify an
independent user task and trigger rather than an internal execution step.

## Safety invariants

- Inspect before planning; plan before apply; verify after apply.
- Include Homarr as the standard private dashboard and MCP control plane. Its
  outage must not block the independently operating underlying services.
- Bind private or loopback by default. Public exposure is a separate approved
  capability with one DNS/TLS/port owner and an authentication policy.
- Persist non-secret preferences only. Never put credentials in catalog data,
  preferences, commands, screenshots, reports, or client configuration.
- Adapter-owned private connection files may retain API keys, URLs, and
  usernames for later wiring and remain password-free. An explicitly requested
  media export may save the generated password, usernames, available API keys,
  URLs and storage paths in `.sessions/<run>/artifacts/private-handoff.json`
  (0600). Ordinary reports return only its path; upkeep requires a fresh request.
- Reuse existing resources only after ownership and lifecycle are known.
- Never use a broad Docker teardown, delete volumes during routine upgrades,
  mount the Docker socket casually, or claim VPN safety without a kill-switch
  failure test.
- Preserve a rollback path before schema migration or replacement.
- Affiliate relationships are disclosed beside human-facing links and never
  affect machine-readable ranking or defaults.
