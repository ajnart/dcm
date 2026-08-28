# Operation input contract

The input is UTF-8 JSON, at most 256 KiB, with `schemaVersion: 1`. Objects use only the exact documented keys. Unknown fields, unbounded collections, secret-bearing fields or values, command strings, and interpolation fail validation.

```json
{
  "schemaVersion": 1,
  "project": { "dockerContext": "default", "id": "photos", "owner": "photos", "manifestRef": "manifests/photos-v1", "ownershipVerified": true },
  "operation": {
    "id": "photos-upgrade-1-2",
    "type": "upgrade",
    "risk": "stateful",
    "currentVersion": "v1.1.0",
    "targetVersion": "v1.2.0",
    "reversibility": "reversible",
    "summary": "Upgrade after compatibility and restore gates pass.",
    "forwardOnlyApproved": false
  },
  "compatibilityEvidence": [{ "id": "upstream-upgrade-notes", "sourceRef": "https://docs.example.invalid/upgrade-1-2", "checkedAt": "2026-08-28T10:00:00Z", "claim": "The documented direct upgrade path supports this version pair." }],
  "backup": {
    "required": true,
    "artifactRef": "backups/photos/pre-upgrade-20260828",
    "capturedAt": "2026-08-28T10:05:00Z",
    "restoreEvidence": { "id": "restore-drill-20260828", "verifiedAt": "2026-08-28T10:20:00Z", "scope": "Application data and database restored into an isolated target." }
  },
  "rollback": { "mode": "compose-reapply", "manifestRef": "manifests/photos-v1", "statement": "Reapply the prior manifest, restore the recorded backup if data changed, then rerun acceptance checks." },
  "healthChecks": [{ "id": "application-health", "kind": "api", "criterion": "The authenticated application health contract passes." }],
  "acceptanceChecks": [{ "id": "core-workflow", "kind": "ui", "criterion": "A representative signed-in workflow reads and writes expected data." }],
  "observed": { "checkedAt": "2026-08-28T10:00:00Z", "project": { "dockerContext": "default", "id": "photos", "owner": "photos", "manifestRef": "manifests/photos-v1" }, "currentVersion": "v1.1.0", "health": "healthy" }
}
```

## Rules

- `type` is `upgrade`, `migration`, `rollback`, or `troubleshoot`. `risk` is `low`, `stateful`, or `schema`.
- Versions must identify an immutable release, digest, date release, or commit. Floating aliases, ranges, and interpolation are rejected. Mutating operations need different current and target versions; troubleshooting uses the same version.
- `reversibility` is `read-only`, `reversible`, or `forward-only`. Troubleshooting must be read-only. Other operations must be reversible or forward-only.
- Mutating operations need at least one compatibility evidence record. Evidence records state what a source supports; the planner does not contact or validate the source.
- Backup and restore-drill evidence is mandatory for migrations, rollbacks, stateful/schema risk, and forward-only work. Opaque artifact references are allowed; payloads are not.
- Reversible work names a prior Compose manifest and either `compose-reapply` or `restore-backup`. Forward-only work uses `forward-recovery`, an explicit approval, verified restore evidence, and a concrete recovery statement. Read-only troubleshooting uses `none`.
- Every plan names at least one health check and acceptance check. Criteria describe evidence, not raw commands, credentials, or a liveness-only claim.

The planner returns `pass`, `blocked`, or `conflict`. It reports `execution.performed: false` and `verification.completed: false` in every result.
