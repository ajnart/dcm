# Catalog contract

The catalog is data, not deployment authority. `catalog/taxonomy.json` defines goal-facing categories, `catalog/apps/*.json` contains app records, and `catalog/stacks/*.json` contains goal recipes. JSON Schemas live in `catalog/schemas/`.

`catalog/affiliates.json` is an optional, empty-by-default disclosure registry. An entry may contain only an app/provider ID, disclosed URL, disclosure text, regions, check date, and enabled flag. Affiliate data is presentation-only: it never changes search scores, ordering, defaults, stack resolution, or plan choices. Never add a link without a real disclosed relationship and a current destination.

## Add an application

1. Choose a stable lower-case ID and one or more taxonomy categories.
2. Keep the upstream project, source repository, documentation, and container image as separate fields.
3. Record lifecycle and `checkedAt`; use `verify` when current status is uncertain and `retired` only with migration evidence.
4. Select automation support independently from T0/T1/T2 priority. `managed` requires an installed `adapterSkill`.
5. Record Homarr as `supported`, `partial`, or `gap`; a URL tile is `partial`, not a dedicated integration.
6. Include roles, dependencies, alternatives, security requirements, pitfalls, and primary sources. Use `null` for unknown deployment facts.
7. Run `node scripts/selfhost.mjs catalog validate`.

## Add a stack

Model a user goal rather than a product bundle. Each required role needs choices and one default. Optional roles remain off unless the request or preferences select them. Put cross-cutting work in `requiredSkills`, and represent risk decisions in `gates`.

Aliases must describe genuine intent. Keep them distinct enough for deterministic longest-phrase resolution. If two stacks share an alias, catalog validation fails.

The taxonomy may declare an alias in `ambiguousAliases` only when at least two stacks intentionally own it. Resolution then returns every top-scoring meaning instead of choosing. `vpn` is deliberately shared by private remote access and downloader-only privacy.

## Support promotion

Promote `discovery -> guided` after primary installation and lifecycle guidance is current. Promote `guided -> managed` only after the named adapter provides versioned deterministic rendering, focused preflight, idempotent apply, acceptance checks, and rollback. Popularity and Homarr support do not promote automation.
