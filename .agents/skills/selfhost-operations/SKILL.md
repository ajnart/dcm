---
name: selfhost-operations
description: Base operations capability. Plan bounded upgrades, migrations, rollbacks, and troubleshooting for one owned self-hosted Compose project. Use for version or schema changes, recovery, compatibility, backup/restore, health, acceptance, and rollback gates. Produce a secret-free plan and delegate every Compose mutation to `selfhost-compose`.
license: Apache-2.0; see LICENSE.txt
compatibility: Requires Bun 1.4.0 or newer for the bundled planner; execution is delegated to selfhost-compose.
---

# Self-host operations

Turn one owned project operation into gated choreography. Keep planning read-only and keep actual Compose changes inside `selfhost-compose`.

## Workflow

1. Confirm the exact Docker context, project ID, owner, current manifest reference, observed version, and ownership evidence. Invoke `selfhost-host` when these facts are absent.
2. Read [operation-contract.md](references/operation-contract.md). Use immutable current and target versions, current compatibility evidence, and opaque references only.
3. Run `bun scripts/plan-operation.ts plan --input operation.json`. Resolve `conflict` before `blocked`; neither result authorizes mutation.
4. Require backup capture and restore-drill evidence for migrations, rollback operations, stateful or schema-risk changes, and every forward-only operation.
5. Confirm every named sibling skill is installed; mark the plan blocked and name any missing capability. Read [choreography.md](references/choreography.md). For a mutating operation, hand the exact target manifest to `selfhost-compose` for validation, render, config preflight, approval, and apply. Do not run Docker directly from this skill.
6. Run the named health and acceptance checks after apply. If a gate fails, stop and follow the recorded rollback or forward-recovery statement; do not improvise resource deletion.
7. Record evidence through the owning backup and verification capabilities. Rerun the planner with new evidence when a revised plan is needed.

## Commands

Resolve the script relative to this `SKILL.md`.

```text
bun scripts/plan-operation.ts validate --input operation.json
bun scripts/plan-operation.ts plan --input operation.json
```

The script accepts only a regular non-symlink input file, performs no Docker, filesystem mutation, or network access, and exits 3 for `blocked` or `conflict`. `pass` means the supplied evidence makes the choreography reviewable; it never means the operation ran or passed acceptance.

## Hard boundaries

- Require an exact observed Docker context and matching project, owner, and manifest identifiers. Never adopt an existing project because its name looks familiar.
- Require pinned current and target versions. Reject floating labels, ranges, interpolation, and missing compatibility evidence for mutating operations.
- Distinguish `read-only`, `reversible`, and `forward-only`. Forward-only work requires its explicit approval gate, verified restore evidence, and a concrete forward-recovery statement.
- Require health and acceptance gates before mutation. Process liveness or HTTP 200 alone is not acceptance.
- Keep secret values, credentials, tokens, private keys, cookies, and interpolated variables out of input, plans, evidence, commands, and output. Use opaque references.
- Delegate apply and rollback Compose changes to `selfhost-compose`. Never emit or run broad teardown, `down --volumes`, prune, or delete-volume commands.

## Completion criteria

Complete a plan only when ownership and current state match; versions are pinned; compatibility, backup/restore, health, acceptance, and rollback gates fit the risk; forward-only work is explicitly acknowledged; and every mutation step names its owning capability. Report execution and verification as pending until independent evidence exists.
