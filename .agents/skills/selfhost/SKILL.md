---
name: selfhost
description: Route self-hosting goals into composable, read-only plans using a curated application and stack catalog. Use for `/selfhost`, `$selfhost`, "my own Netflix", replacing hosted services such as Google Photos or Dropbox, selecting self-hosted apps, planning storage or remote access, and deciding how media, photos, documents, passwords, home automation, DNS, backups, monitoring, or local AI should fit an existing host.
---

# Selfhost

Turn a goal into a bounded plan. Treat planning and mutation as separate authorities.

## Route the request

1. If no goal is present, check only the exact current project root for `.selfhost/project.json`. When it exists, run `project status` and `project resume` for that root. Otherwise run `node scripts/selfhost.mjs catalog menu` and show the short menu. Never search unrelated directories for resumable state.
2. Resolve a stated goal with `node scripts/selfhost.mjs stack resolve "<request>"`.
3. If resolution is ambiguous, show the ranked candidates and ask the user to choose. If it returns `needsComposition`, show every component and resolve every `unresolvedIntent` before planning against one shared host inspection. Never silently choose or drop one branch of a composite request.
4. Search or inspect individual applications with `catalog search` and `catalog show`; avoid loading the whole JSON catalog into context.
5. Confirm one exact project root. Read [references/project-state.md](references/project-state.md), then run `project status` when that root already has `.selfhost/project.json`. Use `project resume` instead of reconstructing its goal and service choices.
6. Read non-secret project preferences with `preferences show --project-root /absolute/project`. A missing preferences file is an empty choice set, not an error.
7. Invoke `selfhost-host` for fresh observed facts on every new or returning run. Saved checkpoints explain prior intent but are stale until rechecked. Prove ownership before calling a resource reusable.
8. For a new goal, run `stack plan "<request>"`. For a no-goal resume, use the plan rebuilt by `project resume`; do not require or invent a new request. Present its role choices, alternatives, required skills, safety gates, unresolved decisions, and plain-language service summary.
9. Confirm each named sibling skill is installed. If one is absent, keep the plan usable but mark apply as blocked and name the missing skill. Invoke only the capabilities named by the plan.
10. On a first run, after the user confirms the goal, service choices, and project root, disclose that only secret-free local resume state will be written and run `project init`. Do not let the planning command itself write state. If a record already exists, use `project revise` only for an explicitly changed choice.
11. Record progress only from work that actually happened. After `project init`, record `inspected` only when `selfhost-host` supplied a fresh typed inspection evidence ID. Then record `planned` after the rebuilt plan and ownership decisions have been reviewed. Never invent an evidence ID; when evidence is unavailable, leave the checkpoint at its earlier stage. On later runs, advance only through the legal next stage and keep saved evidence stale until its owner rechecks it.
12. Stop at the redacted plan until the user separately approves an apply step owned by a capability or adapter skill.
13. End every run, including blocked and read-only runs, with what happened, what each selected service does, what current evidence says was reused or changed, what was not changed, blockers, and the next safe action.

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

node scripts/selfhost.mjs project init <goal...> --project-root ABSOLUTE [--select role=app] [--json]
node scripts/selfhost.mjs project revise <same-goal...> --project-root ABSOLUTE [--select role=app] [--json]
node scripts/selfhost.mjs project status --project-root ABSOLUTE [--json]
node scripts/selfhost.mjs project resume --project-root ABSOLUTE [--json]
node scripts/selfhost.mjs project checkpoint <inspected|planned|applied|verified> --project-root ABSOLUTE [--evidence TYPE:ID] [--json]

node scripts/selfhost.mjs preferences init (--project-root ABSOLUTE | --path ABSOLUTE) [--json]
node scripts/selfhost.mjs preferences show (--project-root ABSOLUTE | --path ABSOLUTE) [--json]
node scripts/selfhost.mjs preferences set <field> <value> (--project-root ABSOLUTE | --path ABSOLUTE) [--json]
node scripts/selfhost.mjs preferences validate (--project-root ABSOLUTE | --path ABSOLUTE) [--json]
```

`--project-root` must name an existing absolute real directory and derives `<project>/.selfhost/preferences.json`; `--path` is the explicit absolute-file alternative. Omitting both uses no stored preferences for planning and is rejected for preference writes. Paths inside the installed skill are rejected. Preferences store chosen, non-secret values with provenance. Secret-like keys and values are rejected without echoing them.

The same root derives `<project>/.selfhost/project.json`. `project init` creates
it without replacing an existing record. `project revise` may change service
choices only for the same goal and clears old progress. `project status` and
`project resume` never inspect or change the host. A resumed plan always marks
saved inspection and evidence as stale until `selfhost-host` and the owning
capabilities provide fresh proof.

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
- Read [references/project-state.md](references/project-state.md) when resuming prior work, recording progress, or changing the final summary.

Completion means the goal resolves deterministically, every selected service has a plain-language purpose, required sibling skills are named, prior project context is separated from current host evidence, unresolved decisions and gates are visible, the final summary says exactly what did and did not happen, and no unapproved host mutation occurred.
