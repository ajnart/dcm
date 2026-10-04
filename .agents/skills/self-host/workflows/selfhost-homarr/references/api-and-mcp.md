# API and MCP

## Agent gateway boundary

Homarr can give a coding agent one MCP endpoint for inspecting integrations
across a selected self-hosted stack. This reduces the need to expose each
administrative UI, but it does not make Homarr mandatory and does not transfer
authorization from Homarr to the connected services.

The default bridge is strictly read-only. Optional profiles expose exactly one
mutation surface: `integration-request` allows Homarr's authenticated
`integration_request` only through exact integration ID, expected service kind,
method, and path rules; `media-request` allows only the wrapped native
`integration_requestMedia` for one configured Seerr integration ID. Neither
mode exposes Homarr's other mutating tools.

Homarr requires full integration access for generic `integration_request` calls,
even for GET, because arbitrary service endpoints can expose credentials or
change state. A policy is authorization for only its listed request shapes; it
is not permission to improvise endpoints. Consult the selected service's
current official API contract before adding a rule. DELETE still requires
`confirmed: true` after the user confirms its exact effects. The media wrapper
uses Homarr's native interact-access check instead.

For a generic request, use an existing integration ID and let Homarr apply its
saved authentication, including supported login sessions. Inspect `ok`,
`status`, and `data` in the result; a Homarr HTTP 200 does not prove the
upstream call succeeded. Check the integration's live behavior rather than a
`supportsHttpRequests` field in `integration_getKinds`, which `release/v2`
removed. iCalendar feeds and TrueNAS's WebSocket API are not generic HTTP
sources. qBittorrent needs an API key and version 5.2.0 or newer for generic
requests; UniFi needs an HTTPS integration URL with its actual controller port.
See the [saved-auth change](https://github.com/homarr-labs/homarr/commit/0ab84fbb3b0a57db4c19fe48d6d6e8ba8bb13e52).

## Authentication and routes

Create Authentication under Homarr `/manage/tools/api`. Native Streamable HTTP uses the `ApiKey` request header at canonical `/api/mcp`. Treat `/api/mcp/mcp` as a compatibility route and report it separately whenever used.

The bridge receives only an absolute profile path. It reads the key privately and emits JSON-RPC on stdout. Errors are fixed and must not include response bodies, credentials, or credential-derived text.

## Catalog behavior

Project only the known read-only tools from a valid native `tools/list` catalog. A curated fallback is allowed only when the RPC code is exactly `-32603` and the complete message is exactly `Date cannot be represented in JSON Schema`. Decorated messages, authentication failures, malformed responses, transport failures, HTTP 500, and unrelated RPC failures remain failures.

Try `/api/mcp/mcp` only when the first canonical probe returns definitive HTTP 404/405 without a valid JSON-RPC response. Fall back from modern discovery to legacy `tools/list` on the same endpoint only for a valid HTTP 2xx RPC `-32601` method-not-found response.

The bridge labels catalog mode as `native-read-only-projection` or `curated-date-schema-fallback`, bridge mode as `read-only`, `integration-request-policy`, or `media-request-policy`, and endpoint mode as `canonical` or `compatibility`. An optional mutation tool requires native catalog discovery; it is never invented by the curated fallback.

## Capability policies

Select one capability mode before generating a client fragment. Pipe its
secret-free policy to:

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

A media-request profile accepts exactly one scalar integration ID:

Homarr's `release/v2` [media search procedure](https://github.com/homarr-labs/homarr/blob/release/v2/packages/api/src/router/integration/integration-router.ts)
returns a flat array of results with `id`, `name`, `type`, and nested
`integration.id`/`integration.kind`; its [Seerr adapter](https://github.com/homarr-labs/homarr/blob/release/v2/packages/integrations/src/seerr/seerr-integration.ts)
uses the Overseerr-compatible request method. Keep this version-specific shape
check current when changing the bridge.

```json
{
  "schemaVersion": 1,
  "mode": "media-request",
  "integrationId": "seerr-main"
}
```

The bridge exposes a wrapper named `integration_requestMedia`, not the native
schema directly. Its call must include the configured `integrationId`, the
exact selected title as `query`, its `mediaId` and `mediaType`, and explicit
`confirmed: true`. The wrapper re-runs `integration_searchMediaRequests` with
only that ID and forwards native request fields only when one result has the
same normalized title, ID, type, and a live integration kind of `seerr`.
Requests through Jellyseerr, Overseerr, a second ID, or an unconfirmed or stale
match are rejected. A successful request can trigger downstream acquisition;
the agent must present that effect and obtain explicit user approval for the
specific result before setting `confirmed: true`. This flag is a caller
attestation, not proof of human approval: the bridge cannot independently
verify that the user saw or approved the request. A trusted client approval
channel would be required for an enforced human-confirmation gate.

Policy creation does not call a service, submit media, or install client configuration. Once a
fragment directory exists, capability mode cannot be enabled for that profile;
create a separate reviewed profile so installation approval reflects the
bridge's capability.

## Media workflow

1. Identify exactly one configured Seerr integration with a usable ID.
2. Call `integration_searchMediaRequests` with `integrationIds: [id]`.
3. Require a non-empty structured results array containing a `title` or `name` that exactly normalizes to the query.
4. Present and disambiguate the match, then stop pending confirmation.
5. On a separately approved `media-request` profile only, call the wrapper with
   the exact selected result and `confirmed: true` after the user confirms.

The default bridge has no mutation path. A generic integration-request profile
may use only its configured routes and cannot call the native media-request
tool. A media-request profile exposes only its one confirmed Seerr wrapper; app
updates, generic requests, and request decisions remain unavailable.

Sources: [Homarr MCP management](https://v2.preview.homarr.dev/docs/management/mcp#authenticated-integration-requests),
[authenticated integration request implementation](https://github.com/homarr-labs/homarr/pull/6835).
