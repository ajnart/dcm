---
name: selfhost
description: Route self-hosting goals into composable, read-only plans using a curated application and stack catalog. Use for `/selfhost`, `$selfhost`, "my own Netflix", replacing hosted services such as Google Photos or Dropbox, selecting self-hosted apps, planning storage or remote access, and deciding how media, photos, documents, passwords, home automation, DNS, backups, monitoring, or local AI should fit an existing host.
---

# Selfhost

Turn a goal into a bounded plan. Treat planning and mutation as separate authorities.

## Route the request

1. If no goal is present, run `node scripts/selfhost.mjs catalog menu` and show the short menu.
2. Resolve a stated goal with `node scripts/selfhost.mjs stack resolve "<request>"`.
3. If resolution is ambiguous, show the ranked candidates and ask the user to choose. If it returns `needsComposition`, show every component and resolve every `unresolvedIntent` before planning against one shared host inspection. Never silently choose or drop one branch of a composite request.
4. Search or inspect individual applications with `catalog search` and `catalog show`; avoid loading the whole JSON catalog into context.
5. Read non-secret project preferences with `preferences show --project-root /absolute/project`. A missing file under that project is an empty preference set, not an error.
6. Run `stack plan "<request>"`. Present its role choices, alternatives, required skills, safety gates, and unresolved decisions.
7. Confirm each named sibling skill is installed. If one is absent, keep the plan usable but mark apply as blocked and name the missing skill.
8. Invoke `selfhost-host` for observed host facts before proposing any host-specific deployment. Invoke only the capability skills named by the plan.
9. Stop at the redacted plan until the user separately approves an apply step owned by a capability or adapter skill.

## Commands

Run all commands from this skill directory, or use absolute paths to `scripts/selfhost.mjs`.

```text
node scripts/selfhost.mjs catalog menu [--json]
node scripts/selfhost.mjs catalog list [--category NAME] [--support LEVEL] [--tier T0] [--json]
node scripts/selfhost.mjs catalog search <words...> [--json]
node scripts/selfhost.mjs catalog show <app-id> [--json]
node scripts/selfhost.mjs catalog homarr [--status supported|gap] [--json]
node scripts/selfhost.mjs catalog validate [--json]

node scripts/selfhost.mjs stack resolve <goal...> [--json]
node scripts/selfhost.mjs stack plan <goal...> [--select role=app] [--project-root ABSOLUTE | --preferences ABSOLUTE] [--json]

node scripts/selfhost.mjs preferences init (--project-root ABSOLUTE | --path ABSOLUTE) [--json]
node scripts/selfhost.mjs preferences show (--project-root ABSOLUTE | --path ABSOLUTE) [--json]
node scripts/selfhost.mjs preferences set <field> <value> (--project-root ABSOLUTE | --path ABSOLUTE) [--json]
node scripts/selfhost.mjs preferences validate (--project-root ABSOLUTE | --path ABSOLUTE) [--json]
```

`--project-root` must name an existing absolute real directory and derives `<project>/.selfhost/preferences.json`; `--path` is the explicit absolute-file alternative. Omitting both uses no stored preferences for planning and is rejected for preference writes. Paths inside the installed skill are rejected. Preferences store chosen, non-secret values with provenance. Secret-like keys and values are rejected without echoing them.

Treat bare `VPN` as intentionally ambiguous: ask whether the user wants private remote access or downloader-only privacy. Preserve that choice inside composites such as `photos and VPN`; clarification is mandatory before planning. Phrases such as `route qBittorrent through VPN` resolve to downloader privacy, while `access from phone` resolves to remote access. Clear combinations such as `photos and backups` and `make Immich private on my phone` return a composition instead of dropping one intent.

## Interpret support correctly

- `managed`: a named installed adapter owns deterministic render, apply, verify, and rollback.
- `guided`: current primary guidance and gates exist; generation remains host-specific.
- `discovery`: selection context only; verify current deployment facts before proposing an install.
- `retired`: migration routing only. Never select for a new deployment.

The stack's automation field describes its best supported capability. A generated plan also reports `effectiveAutomation`, reduced to the least automated selected or implied application. Every selected adapter skill appears in `requiredSkills`; a guided or discovery alternative never inherits a managed claim.

T0/T1/T2 are curation priorities, independent of automation support. An upstream project and a container image are separate facts; `null` image data means it must be researched at apply time.

Use `catalog homarr` to inspect the exact current Homarr identifier/display mapping and catalog coverage. `supported` includes the standard registry and Docker/Kubernetes special surfaces; `gap` lists catalog applications without a dedicated integration. Homarr support does not override upstream lifecycle or make a retired project selectable for a new deployment.

## Enforce the plan boundary

Keep planning read-only. Use `inspect -> plan -> approval -> apply -> verify` for every mutation. Require separate gates for public exposure, destructive work, VPN routing, privilege expansion, and forward-only migrations. Default service exposure to loopback or private networking. Treat a downloader VPN kill-switch failure test and a backup restore drill as evidence requirements, not optional prose.

Never put credentials, tokens, keys, cookies, secret values, or raw rendered Compose with interpolated secrets in preferences, catalog records, plans, logs, screenshots, or reports. Pass secret references only to the narrow apply boundary.

## Load references on demand

- Read [references/catalog.md](references/catalog.md) when adding or reviewing taxonomy, app, or goal records.
- Read [references/planning.md](references/planning.md) when composing capability skills, approval gates, or acceptance evidence.
- Read [references/preferences.md](references/preferences.md) when changing preference fields, persistence, or redaction behavior.

Completion means the goal resolves deterministically, every selected role has a reason and alternative, required sibling skills are named, unresolved host decisions and gates are visible, and no host mutation occurred.
