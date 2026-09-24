---
name: selfhost-verify
description: Base verification capability. Independently aggregate secret-free acceptance evidence without mutation. Use after planning or apply to assess source class, expected and actual classifications, timestamps, hashes, freshness, missing or conflicting evidence, public ingress, VPN fail-closed behavior, restore proof, media graphs, or Homarr claims. Emit claims only from supplied evidence.
license: Apache-2.0; see LICENSE.txt
compatibility: Requires Bun 1.4.0 or newer; evaluates local redacted evidence documents without probing the target.
---

# Self-host verify

Evaluate evidence independently from the capability that made the change. A green process, HTTP response, uploaded backup, or configured route proves only its own narrow observation.

## Workflow

1. Establish one manifest ID and deterministic `evaluatedAt` timestamp. Select specialized profiles only for capabilities actually in scope.
2. Read [evidence-contract.md](references/evidence-contract.md). Collect classifications and artifact references, never raw response bodies, headers, credentials, cookies, host inspection dumps, or secret payloads.
3. Run `scripts/verify-evidence.ts`. It reads the manifest, performs no probe, and changes nothing.
4. Treat missing, stale, duplicate, conflicting, failed, and blocked checks as non-pass. Resolve evidence problems through the owning verifier; this skill does not repair a service.
5. Report only emitted narrow claims. Include the optional Markdown summary when the caller needs a human-readable acceptance artifact.

## Run the aggregator

Resolve the script relative to this `GUIDE.md`.

```bash
bun <skill-directory>/scripts/verify-evidence.ts --input evidence-manifest.json
bun <skill-directory>/scripts/verify-evidence.ts --json '{"schemaVersion":2,"manifestId":"change-001","evaluatedAt":"2026-08-28T12:00:00Z","profile":{"publicIngress":false,"downloaderVpn":false,"backups":false,"media":false,"homarr":false},"requirements":[],"checks":[],"options":{"markdownSummary":true}}'
```

Use `--json` only for non-secret manifests safe in a process argument. Evidence references are opaque IDs and hashes are `sha256:` identifiers; store any underlying protected artifact outside the manifest.

### Convert a version 1 manifest manually

The verifier accepts version 2 only. It has no migration command and never
infers Homarr scope from `profile.media` or from supplied check IDs.

1. Change `schemaVersion` from `1` to `2`.
2. Add the exact boolean `profile.homarr`. Set it to `true` for every new stack
   in this pack. Use `false` only when evaluating a legacy or external evidence
   scope that explicitly predates or excludes the Homarr control plane.
3. When `profile.homarr` is `true`, change the `capability` on the four existing
   `homarr-*-search` checks from `media` to `homarr`. Keep their evidence only
   when it was collected for the same acceptance window.
4. When both `profile.publicIngress` and `profile.homarr` are `true`, collect a
   new `homarr-native-mcp-private` check. Do not manufacture or infer that
   evidence from the old manifest.

Setting `profile.homarr` to `false` makes old Homarr rows unrequired; remove
them unless retaining clearly labeled unrequired rows is useful to the caller.
Version 2 emits separate `media-service-graph-acceptance` and
`homarr-control-plane-acceptance` claims.

## Mandatory gates

- Generic acceptance always requires container/process state, application API readiness, and storage capacity evidence.
- Public ingress additionally requires DNS, TLS, authentication enforcement, and direct-port privacy evidence.
- Downloader VPN additionally requires healthy egress, a timestamped tunnel-break failure, DNS fail-closed behavior, restored tunnel egress, and route/firewall audit evidence.
- Backups additionally require an isolated restore, integrity/ownership, and application acceptance evidence. Backup existence is insufficient.
- Media additionally requires only the private media service graph.
- Homarr is the default control-plane profile requiring integration, app,
  widget, and MCP search evidence. Search evidence never authorizes a media
  request or other mutation.
- Homarr combined with public ingress additionally requires proof that the public dashboard route denies native `/api/mcp`; the read-only bridge must use a private route.

## Result contract

`pass` means every mandatory and custom required row has one fresh, metadata-matching, passing check with evidence. `blocked` means evidence is missing, stale, failed, classification-mismatched, duplicated identically, or explicitly blocked. `conflict` means duplicates disagree or a check contradicts its required source/probe/capability contract. Failed rows remain listed under `findings.failed`.

Each emitted claim covers only its listed check IDs and evidence window. It does not assert general security, availability, anonymity, recoverability beyond the restored scope, or future behavior.

## Completion criteria

Verification is complete when all selected mandatory rows and custom requirements are accounted for exactly once; freshness is evaluated against the supplied clock; conflicts and failures are visible; required Homarr claims and optional media claims pass only with their own complete evidence sets; outputs contain classifications and opaque evidence identifiers without payloads or secrets; and `mutationsPerformed` remains false.
