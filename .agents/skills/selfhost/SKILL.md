---
name: selfhost
description: Base planning router. Route self-hosting goals into short, composable, read-only plans from the curated catalog. Use for `/selfhost`, `$selfhost`, replacing hosted services, choosing apps, or deciding how media, photos, files, passwords, automation, networking, backups, monitoring, or local AI fit a host. Include Homarr as the standard private control plane.
license: Apache-2.0; see LICENSE.txt
compatibility: Requires Bun 1.4.0 or newer for bundled planning scripts; host mutation remains capability-owned and approval-gated.
---

# Selfhost

Turn a goal into a bounded plan. Keep planning separate from mutation.

## Workflow

1. Read [references/conversation.md](references/conversation.md). Reuse stated
   intent, recommend one answer first, and ask only for open choices that alter
   safety or topology. `defaults` accepts private-first planning defaults; it
   never selects optional roles or approves mutation.
2. Confirm one exact project root. Invoke `scripts/selfhost.ts plan` with the
   stated goal. With no new goal, use that command to resume only the supplied
   root. Never search unrelated directories for project state.
3. If the result is ambiguous or needs composition, show its candidates or
   components and resolve every open intent. Preserve all branches of a clear
   composite request.
4. Use `catalog search` or `catalog show` for individual applications instead
   of loading the full catalog. Treat a media-title search as a
   `selfhost-homarr` read-only search, never as approval to request media.
5. Invoke `selfhost-host` for fresh facts on every new or returning project.
   Saved checkpoints explain intent but never prove current host state. Adopt a
   resource only after its ownership is known.
6. Present selected services, their purposes, alternatives, required skills,
   gates, unresolved decisions, and Homarr coverage. Homarr is the required
   private control plane for every plan.
7. After confirmed non-secret intent, use `state init` or `state revise` as the
   separate persistence step. Record a checkpoint only for work that happened
   and only with a real typed evidence ID.
8. Stop at the redacted plan until the user separately approves an apply step
   owned by the selected capability or adapter.
9. For a new stack that should be changed, tell the user to invoke
   `$selfhost-setup` explicitly. For work on an existing
   `.selfhost/stack.json`, tell them to invoke `$selfhost-upkeep` explicitly.
   This planning skill creates neither stack metadata nor mutation authority.

## Command boundary

Resolve this skill directory and invoke its script by absolute path. Run
`scripts/selfhost.ts --help` for the authoritative syntax; do not copy a stale
command table into the conversation.

`--project-root` must name an existing absolute real directory and derives `<project>/.selfhost/preferences.json`; `--path` is the explicit absolute-file alternative. Omitting both uses no stored preferences for planning and is rejected for preference writes. Paths inside the installed skill are rejected. Preferences store chosen, non-secret values with provenance. Secret-like keys and values are rejected without echoing them.

The same root derives `<project>/.selfhost/project.json`. State writes refuse
replacement, retain one goal, and clear stale progress after a revised choice.
A resumed plan marks saved inspection and evidence stale until their owners
provide fresh proof.

Treat bare `VPN` as intentionally ambiguous: ask whether the user wants private remote access or downloader-only privacy. Preserve that choice inside composites such as `photos and VPN`; clarification is mandatory before planning. Phrases such as `route qBittorrent through VPN` resolve to downloader privacy, while `access from phone` resolves to remote access. Clear combinations such as `photos and backups` and `make Immich private on my phone` return a composition instead of dropping one intent.

Read [references/catalog.md](references/catalog.md) for support levels,
curation tiers, app facts, image provenance, and Homarr coverage. A stack's
best automation never upgrades a weaker selected app. Homarr is the default
control plane and its bridge remains inspect-and-search only.

## Enforce the plan boundary

Keep planning read-only. Use `inspect -> plan -> approval -> apply -> verify` for every mutation. Require separate gates for public exposure, destructive work, VPN routing, privilege expansion, and forward-only migrations. Default service exposure to loopback or private networking. Treat a downloader VPN kill-switch failure test and a backup restore drill as evidence requirements, not optional prose.

Never put credentials, tokens, keys, cookies, secret values, or raw rendered Compose with interpolated secrets in preferences, catalog records, plans, logs, screenshots, or reports. Pass secret references only to the narrow apply boundary.

## Load references on demand

- Read [references/catalog.md](references/catalog.md) when adding or reviewing taxonomy, app, or goal records.
- Read [references/planning.md](references/planning.md) when composing capability skills, approval gates, or acceptance evidence.
- Read [references/preferences.md](references/preferences.md) when changing preference fields, persistence, or redaction behavior.
- Read [references/project-state.md](references/project-state.md) when resuming prior work, recording progress, or changing the final summary.

Completion means the goal resolves deterministically, every selected service has a plain-language purpose, required sibling skills are named, prior project context is separated from current host evidence, unresolved decisions and gates are visible, the final summary says exactly what did and did not happen, and no unapproved host mutation occurred.
