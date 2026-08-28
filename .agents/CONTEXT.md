# Selfhost Skills domain

This repository is an installable Agent Skills pack for planning, deploying,
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
- **Host profile**: observed host facts plus non-secret choices. Facts,
  choices, derived values, and secret references keep distinct provenance.
- **Project**: the bounded unit of ownership for Compose names, networks,
  paths, ports, backups, and rollback. No command targets every deployment.
- **Plan**: a redacted, reviewable diff between the observed host and desired
  stack. A plan has no authority to apply itself.
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

The `selfhost` skill owns intent routing, the catalog, preferences, and the
plan contract. Capability skills own one operational concern. App or stack
adapters own special API/UI behavior and package their runtime assets inside
their skill directory so `npx skills` copy mode remains functional.

Skills may locate an installed sibling by name, but must fail clearly when a
required sibling is absent. They must not depend on files outside the installed
skill directories. Root-level compatibility entry points may delegate inward;
the installed skill remains the single implementation source.

## Safety invariants

- Inspect before planning; plan before apply; verify after apply.
- Bind private or loopback by default. Public exposure is a separate approved
  capability with one DNS/TLS/port owner and an authentication policy.
- Persist non-secret preferences only. Never put credentials in catalog data,
  preferences, commands, screenshots, reports, or client configuration.
- Reuse existing resources only after ownership and lifecycle are known.
- Never use a broad Docker teardown, delete volumes during routine upgrades,
  mount the Docker socket casually, or claim VPN safety without a kill-switch
  failure test.
- Preserve a rollback path before schema migration or replacement.
- Affiliate relationships are disclosed beside human-facing links and never
  affect machine-readable ranking or defaults.
