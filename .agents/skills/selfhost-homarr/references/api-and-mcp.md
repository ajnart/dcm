# API and MCP

## Agent gateway boundary

Homarr can give a coding agent one MCP endpoint for inspecting integrations
across a selected self-hosted stack. This reduces the need to expose each
administrative UI, but it does not make Homarr mandatory and does not transfer
authorization from Homarr to the connected services.

The default bridge is strictly read-only. An optional `integration-request`
profile mode exposes Homarr's authenticated `integration_request` tool only
through exact integration ID, expected service kind, method, and path
rules. It does not expose Homarr's other mutating tools.

Homarr requires full integration access even for GET because arbitrary service
endpoints can expose credentials or change state. A policy is authorization for
only its listed request shapes; it is not permission to improvise endpoints.
Consult the selected service's current official API contract before adding a
rule. DELETE still requires `confirmed: true` after the user confirms its exact
effects.

## Authentication and routes

Create Authentication under Homarr `/manage/tools/api`. Native Streamable HTTP uses the `ApiKey` request header at canonical `/api/mcp`. Treat `/api/mcp/mcp` as a compatibility route and report it separately whenever used.

The bridge receives only an absolute profile path. It reads the key privately and emits JSON-RPC on stdout. Errors are fixed and must not include response bodies, credentials, or credential-derived text.

## Catalog behavior

Project only the known read-only tools from a valid native `tools/list` catalog. A curated fallback is allowed only when the RPC code is exactly `-32603` and the complete message is exactly `Date cannot be represented in JSON Schema`. Decorated messages, authentication failures, malformed responses, transport failures, HTTP 500, and unrelated RPC failures remain failures.

Try `/api/mcp/mcp` only when the first canonical probe returns definitive HTTP 404/405 without a valid JSON-RPC response. Fall back from modern discovery to legacy `tools/list` on the same endpoint only for a valid HTTP 2xx RPC `-32601` method-not-found response.

The bridge labels catalog mode as `native-read-only-projection` or `curated-date-schema-fallback`, bridge mode as `read-only` or `integration-request-policy`, and endpoint mode as `canonical` or `compatibility`. The optional tool requires native catalog discovery; it is never invented by the curated fallback.

## Integration-request policy

Select this mode before generating a client fragment. Pipe a secret-free policy to:

```text
bun <skill-dir>/scripts/profile.ts set-integration-policy <absolute-profile-path>
```

```json
{
  "schemaVersion": 1,
  "mode": "integration-request",
  "rules": [{
    "integrationId": "sonarr-main",
    "service": "sonarr",
    "methods": ["GET"],
    "paths": ["/api/v3/series"]
  }]
}
```

Rules accept only exact root-relative paths; query strings do not change the
matched path. Absolute URLs, fragments, backslashes, whitespace, and traversal
markers are rejected. Unlisted paths and
unlisted methods are rejected. At call time the bridge queries
`integration_byId` and requires the live integration kind to match `service`.
GET bodies are rejected; JSON bodies retain Homarr's 10 KiB limit. The bridge
passes Homarr's redacted `{status,data}` result through without logging it.

Policy creation does not call a service or install client configuration. Once a
fragment directory exists, capability mode cannot be enabled for that profile;
create a separate reviewed profile so installation approval reflects the
bridge's capability.

## Media workflow

1. Identify exactly one configured Seerr integration with a usable ID.
2. Call `integration_searchMediaRequests` with `integrationIds: [id]`.
3. Require a non-empty structured results array containing a `title` or `name` that exactly normalizes to the query.
4. Present and disambiguate the match, then stop pending confirmation.

The default bridge has no mutation path. A policy-enabled profile may use only
its configured `integration_request` routes. Media-request tools, app updates,
and request decisions remain unavailable unless the selected service exposes an
explicitly documented endpoint that was separately added to the policy.

Sources: [Homarr MCP management](https://v2.preview.homarr.dev/docs/management/mcp#authenticated-integration-requests),
[authenticated integration request implementation](https://github.com/homarr-labs/homarr/pull/6835).
