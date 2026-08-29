# Catalog contract

The catalog is data, not deployment authority. `catalog/taxonomy.json` defines goal-facing categories, `catalog/apps/*.json` contains app records, and `catalog/stacks/*.json` contains goal recipes. `catalog/skills.json` declares every packaged skill and whether a specialized adapter is scoped to one application or one complete stack. `catalog/homarr-integrations.json` is the checked registry of exact Homarr integration identifiers and display names. JSON Schemas live in `catalog/schemas/`.

`catalog/affiliates.json` is an optional, empty-by-default disclosure registry. An entry may contain only an app/provider ID, disclosed URL, disclosure text, regions, check date, and enabled flag. Affiliate data is presentation-only: it never changes search scores, ordering, defaults, stack resolution, or plan choices. Never add a link without a real disclosed relationship and a current destination.

## Add an application

1. Choose a stable lower-case ID and one or more taxonomy categories.
2. Keep the upstream project, source repository, documentation, and container image as separate fields.
3. Record lifecycle and `checkedAt`; use `verify` when current status is uncertain and `retired` only with migration evidence.
4. Select automation support independently from T0/T1/T2 priority. `managed` requires an installed `adapterSkill`.
5. Record Homarr as `supported`, `partial`, or `gap`; a URL tile is `partial`, not a dedicated integration.
6. Include roles, dependencies, alternatives, security requirements, pitfalls, and primary sources. Use `null` for unknown deployment facts.
7. Run `node scripts/selfhost.mjs catalog validate`.

## Maintain Homarr coverage

Update `catalog/homarr-integrations.json` only from its official sources, preserving exact identifier case and display punctuation. Standard integrations and the Docker/Kubernetes special surfaces must each map to exactly one `supported` app record. Keep development-only mock definitions, Search.ch widget behavior, and release-provider widget behavior outside the global integration registry. Use `node scripts/selfhost.mjs catalog homarr [--status supported|gap]` to inspect deterministic coverage; a supported integration remains independent from upstream lifecycle and automation support.

## Add a stack

Model a user goal rather than a product bundle. Each required role needs choices and one default. Optional roles remain off unless the request or preferences select them. A `recommended: true` role is prominent advice, not an implicit selection: it must be optional and have a `null` default. Put cross-cutting work in `requiredSkills`, and represent risk decisions in `gates`.

Use a recommended Homarr role only where a private front door adds value. Report dedicated integration coverage separately from app-links-only coverage instead of hiding the recommendation when a selected alternative has no integration. Homarr remains an optional control plane; selecting it adds its application adapter and Homarr-specific acceptance claims, while leaving it off adds no Homarr service, skill, or evidence requirement.
The `homarr-control-plane` goal is the narrow exception: its required Homarr
role is valid because the user explicitly asked for Homarr itself.

Aliases must describe genuine intent. Keep them distinct enough for deterministic longest-phrase resolution. If two stacks share an alias, catalog validation fails.

When one request directly names multiple distinct goal aliases, resolution returns `needsComposition` with ordered components. An ambiguous alias alongside a clear component remains an `unresolvedIntent` with every valid choice and `needsClarification`; planning waits for that choice. Keep app-specific and access phrases explicit enough that composition retains every clear and unresolved intent.

The taxonomy may declare an alias in `ambiguousAliases` only when at least two stacks intentionally own it. Resolution then returns every top-scoring meaning instead of choosing. `vpn` is deliberately shared by private remote access and downloader-only privacy.

Every adapter and required skill must exist in `catalog/skills.json`. Only an `adapter: true` record with `scope: application` may appear as an application's `adapterSkill`; a `scope: stack` adapter is invoked directly for its complete, documented bundle. Non-adapters use a `null` scope. Keep the registry sorted by exact skill ID and conform it to `schemas/skills.schema.json`; change the schema only when the registry shape changes. Managed defaults must remain managed, lower-automation alternatives are allowed and lower the generated plan's `effectiveAutomation`, and retired applications cannot be stack choices.

`selfhost-homarr` is the Homarr application adapter. `selfhost-media` is the explicit Homarr-enhanced seven-service stack adapter, not managed support for each individual media application. Generic personal-media plans remain guided and do not load that bundle implicitly.

## Support promotion

Promote `discovery -> guided` after primary installation and lifecycle guidance is current. Promote `guided -> managed` only after the named adapter provides versioned deterministic rendering, focused preflight, idempotent apply, acceptance checks, and rollback. Popularity and Homarr support do not promote automation.
