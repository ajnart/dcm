---
name: selfhost-backup
description: Plan and assess secret-free backup and restore protection for self-hosted services. Use for data classification, encrypted targets, retention, immutability, consistency hooks, RPO/RTO, alerts, or isolated restore evidence. This capability plans and evaluates evidence; it does not run, prune, overwrite, or restore backups.
license: Apache-2.0; see LICENSE.txt
compatibility: Requires Bun 1.4.0 or newer for the bundled planner; accepts redacted JSON facts only.
---

# Self-host backup

Design for recovery, then distinguish the plan from direct restore evidence. Treat snapshots and replication as availability aids until an independent copy and isolated restore prove more.

## Workflow

1. Inventory configuration, user data, databases, and caches. Mark caches excluded only when they are explicitly rebuildable.
2. Read [plan-contract.md](references/plan-contract.md). Record source and target failure domains, consistency methods, owners, RPO/RTO, retention, pruning approval, encryption references, recovery-key custody, and failure routing.
3. Run `scripts/plan-backup.ts` with bounded, secret-free JSON. The planner performs no filesystem discovery, backup, pruning, notification, or restore.
4. Resolve overlap, failure-domain, database-consistency, custody, destructive-target, and pruning gates before handing a plan to an apply capability.
5. Keep the result `not-verified` until evidence records a timestamped restore into an isolated target, integrity checks, application acceptance, and RTO compliance.
6. Present the JSON with a concise explanation of blocked gates and the narrow restore claim. Request separate approval before any later quiesce, snapshot, export, prune, overwrite, or restore action.

## Run the planner

Resolve the script relative to this `SKILL.md`.

```bash
bun <skill-directory>/scripts/plan-backup.ts --input backup-input.json
bun <skill-directory>/scripts/plan-backup.ts --json '{"schemaVersion":1,"project":{"id":"photos","owner":"operator"},"objectives":{"rpoMinutes":1440,"rtoMinutes":240},"sources":[],"targets":[],"schedule":{"cadenceMinutes":1440,"retention":{"keepLast":7,"daily":7,"weekly":4,"monthly":6},"pruning":{"enabled":false,"approved":false,"owner":""}},"notifications":{"failureOwner":"operator","routeRefs":["alerts.backup"]},"restoreDrill":null}'
```

Use `--json` only for non-secret input safe in a process argument. Supply encryption and repository credentials only as opaque identifiers in `secretRefs`; the planner never resolves them.

## Hard boundaries

- Keep backup destinations outside every protected source tree. Treat an off-host label in the same storage failure domain as local staging.
- Capture databases with an application-native export or an explicitly quiesced copy/snapshot. A live database volume copy is not application-consistent evidence.
- Require accountable ownership for sources, targets, retention, recovery-key custody, and failure notification.
- Require explicit approval for a destructive target and for pruning. A plan cannot grant either approval.
- Keep at least one independently encrypted off-host copy and record immutable, versioned, or offline protection where selected. Keep recovery material in independent custody through references only.
- Restore into a disposable or isolated target. A backup listing, successful upload, repository check, snapshot, or checksum alone does not prove application recovery.

## Result contract

`pass` means the supplied plan is internally safe and the supplied isolated restore evidence meets its narrow acceptance contract. `blocked` means required facts or evidence are missing. `conflict` means overlap or an unapproved destructive condition must be resolved. `restore.state: verified` covers only the recorded sources, evidence, timestamp, application checks, and RTO; it is not a guarantee about future backups.

## Completion criteria

Planning is complete when every durable source has local and independent off-host coverage; database capture is consistent; encryption and recovery custody use opaque references; retention, RPO/RTO, owners, and failure routing are explicit; destructive and pruning work is separately approved; restore evidence is either fully accepted or visibly blocked; and no secret value, mutation, or unearned verification claim appears.
