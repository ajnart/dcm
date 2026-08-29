# Acceptance evidence contract

`verify-evidence.mjs` is a dependency-free schema-version-2 manifest aggregator. It accepts exact-key JSON, evaluates freshness against the caller-supplied `evaluatedAt`, and emits deterministic schema-version-2 JSON. It never performs a check or treats a plan/configuration record as observation.

The exact profile shape is:

```json
{
  "publicIngress": false,
  "downloaderVpn": false,
  "backups": false,
  "media": false,
  "homarr": false
}
```

`media` and `homarr` are independent. Select `homarr` only when the optional Homarr control plane is in the accepted scope.

## Manual version 1 conversion

There is no executable or automatic migration. The verifier rejects version 1
and does not infer Homarr scope from `profile.media`, supplied check IDs, or
evidence references. Convert each manifest according to its intended claim:

1. Set `schemaVersion` to `2`.
2. Add the exact boolean `profile.homarr`: use `true` when Homarr is part of the
   intended accepted scope, or `false` when it is not.
3. If `profile.homarr` is `true`, change the `capability` of
   `homarr-integration-search`, `homarr-app-search`, `homarr-widget-search`, and
   `homarr-mcp-search` from the version 1 value `media` to `homarr`. Existing
   evidence remains usable only when its timestamp and acceptance window are
   still valid.
4. If both `profile.publicIngress` and `profile.homarr` are `true`, supply new
   `homarr-native-mcp-private` evidence. Version 1 contains no equivalent row,
   so it cannot be inferred during conversion.

With `profile.homarr` set to `false`, old Homarr search rows are unrequired and
should normally be removed. Version 2 replaces the combined
`media-homarr-acceptance` output with independent
`media-service-graph-acceptance` and `homarr-control-plane-acceptance` claims.

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

Media: `media-service-graph`.

Homarr: `homarr-integration-search`, `homarr-app-search`, `homarr-widget-search`, `homarr-mcp-search`.

Homarr plus public ingress: `homarr-native-mcp-private`, proving that the public dashboard edge denies native `/api/mcp` while the packaged bridge remains on a private route.

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

The media profile emits `media-service-graph-acceptance`. The Homarr profile emits the independent `homarr-control-plane-acceptance`; it does not become mandatory merely because media is selected.
