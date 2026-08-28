---
name: selfhost-verify
description: Independently aggregate secret-free acceptance evidence for self-hosted changes without mutating the system. Use after a plan or apply stage when checks must declare capability, timestamp, source/probe class, expected and actual classification, result, evidence references and hashes, and freshness; when missing, stale, duplicate, conflicting, failed, or blocked evidence must prevent acceptance; or when gating public ingress, downloader VPN fail-closed behavior, backup restores, and media plus Homarr integration/app/widget/MCP search claims. Emits narrow JSON claims and an optional Markdown summary only from supplied evidence.
---

# Self-host verify

Evaluate evidence independently from the capability that made the change. A green process, HTTP response, uploaded backup, or configured route proves only its own narrow observation.

## Workflow

1. Establish one manifest ID and deterministic `evaluatedAt` timestamp. Select specialized profiles only for capabilities actually in scope.
2. Read [evidence-contract.md](references/evidence-contract.md). Collect classifications and artifact references, never raw response bodies, headers, credentials, cookies, host inspection dumps, or secret payloads.
3. Run `scripts/verify-evidence.mjs`. It reads the manifest, performs no probe, and changes nothing.
4. Treat missing, stale, duplicate, conflicting, failed, and blocked checks as non-pass. Resolve evidence problems through the owning verifier; this skill does not repair a service.
5. Report only emitted narrow claims. Include the optional Markdown summary when the caller needs a human-readable acceptance artifact.

## Run the aggregator

Resolve the script relative to this `SKILL.md`.

```bash
node <skill-directory>/scripts/verify-evidence.mjs --input evidence-manifest.json
node <skill-directory>/scripts/verify-evidence.mjs --json '{"schemaVersion":1,"manifestId":"change-001","evaluatedAt":"2026-08-28T12:00:00Z","profile":{"publicIngress":false,"downloaderVpn":false,"backups":false,"media":false},"requirements":[],"checks":[],"options":{"markdownSummary":true}}'
```

Use `--json` only for non-secret manifests safe in a process argument. Evidence references are opaque IDs and hashes are `sha256:` identifiers; store any underlying protected artifact outside the manifest.

## Mandatory gates

- Generic acceptance always requires container/process state, application API readiness, and storage capacity evidence.
- Public ingress additionally requires DNS, TLS, authentication enforcement, and direct-port privacy evidence.
- Downloader VPN additionally requires healthy egress, a timestamped tunnel-break failure, DNS fail-closed behavior, restored tunnel egress, and route/firewall audit evidence.
- Backups additionally require an isolated restore, integrity/ownership, and application acceptance evidence. Backup existence is insufficient.
- Media additionally requires the service graph plus Homarr integration, app, widget, and MCP search evidence. Search evidence never authorizes a media request or other mutation.

## Result contract

`pass` means every mandatory and custom required row has one fresh, metadata-matching, passing check with evidence. `blocked` means evidence is missing, stale, failed, classification-mismatched, duplicated identically, or explicitly blocked. `conflict` means duplicates disagree or a check contradicts its required source/probe/capability contract. Failed rows remain listed under `findings.failed`.

Each emitted claim covers only its listed check IDs and evidence window. It does not assert general security, availability, anonymity, recoverability beyond the restored scope, or future behavior.

## Completion criteria

Verification is complete when all selected mandatory rows and custom requirements are accounted for exactly once; freshness is evaluated against the supplied clock; conflicts and failures are visible; specialized claims pass only with their complete evidence set; outputs contain classifications and opaque evidence identifiers without payloads or secrets; and `mutationsPerformed` remains false.
