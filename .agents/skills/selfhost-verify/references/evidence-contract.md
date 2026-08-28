# Acceptance evidence contract

`verify-evidence.mjs` is a dependency-free manifest aggregator. It accepts exact-key JSON, evaluates freshness against the caller-supplied `evaluatedAt`, and emits deterministic JSON. It never performs a check or treats a plan/configuration record as observation.

## Check row

Every check declares:

```json
{
  "id": "api-readiness",
  "capability": "application",
  "observedAt": "2026-08-28T11:55:00Z",
  "sourceClass": "application-api",
  "probeClass": "readiness",
  "expectedClass": "ready",
  "actualClass": "ready",
  "result": "pass",
  "evidenceRefs": ["artifact://acceptance/api-readiness"],
  "evidenceHashes": ["sha256:0000000000000000000000000000000000000000000000000000000000000000"],
  "freshnessMinutes": 30
}
```

Classifications are short identifiers, never response bodies or secret payloads. Pass/fail rows require opaque evidence references and SHA-256 hashes; blocked rows may carry empty evidence arrays. Future observations and observations older than their declared freshness are blocked.

## Built-in requirements

Generic: `container-process`, `api-readiness`, `storage-capacity`.

Public ingress: `ingress-dns`, `ingress-tls`, `ingress-auth`, `ingress-direct-port`.

Downloader VPN: `vpn-healthy-egress`, `vpn-tunnel-break`, `vpn-dns-fail-closed`, `vpn-restored-egress`, `vpn-route-audit`.

Backup: `backup-isolated-restore`, `backup-integrity`, `backup-application-acceptance`.

Media: `media-service-graph`, `homarr-integration-search`, `homarr-app-search`, `homarr-widget-search`, `homarr-mcp-search`.

`requirements` adds project-specific mandatory rows with the same `id`, capability, source/probe class, and expected classification contract. IDs must not collide with built-ins.

## Non-pass rules

- No row: missing and `blocked`.
- One stale/future row: stale and `blocked`.
- Identical repeated IDs: duplicate and `blocked`.
- Repeated IDs that disagree: `conflict`.
- Wrong capability/source/probe/expected metadata: `conflict`.
- `fail` or expected/actual mismatch: finding `failed` and overall `blocked`.
- Explicitly blocked row: `blocked`.

The optional Markdown summary contains only manifest status, finding IDs, claim states, and counts. Unknown keys, secret-bearing fields/values, raw authorization material, unsafe URLs, and unbounded data are rejected without echo.
