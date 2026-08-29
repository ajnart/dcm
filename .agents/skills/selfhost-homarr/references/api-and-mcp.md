# API and MCP

## Agent gateway boundary

Homarr can give a coding agent one MCP endpoint for inspecting integrations
across a selected self-hosted stack. This reduces the need to expose each
administrative UI, but it does not make Homarr mandatory and does not transfer
authorization from Homarr to the connected services.

The shipped bridge is strictly read-only. It supports inspection and exact
Seerr search only. It does not request media, update applications, or decide
requests. Describe broader action workflows as future capabilities unless a
separate implementation supplies an explicit tool allowlist, narrow approval,
confirmation, and verification contract.

## Authentication and routes

Create Authentication under Homarr `/manage/tools/api`. Native Streamable HTTP uses the `ApiKey` request header at canonical `/api/mcp`. Treat `/api/mcp/mcp` as a compatibility route and report it separately whenever used.

The bridge receives only an absolute profile path. It reads the key privately and emits JSON-RPC on stdout. Errors are fixed and must not include response bodies, credentials, or credential-derived text.

## Catalog behavior

Project only the known read-only tools from a valid native `tools/list` catalog. A curated fallback is allowed only when the RPC code is exactly `-32603` and the complete message is exactly `Date cannot be represented in JSON Schema`. Decorated messages, authentication failures, malformed responses, transport failures, HTTP 500, and unrelated RPC failures remain failures.

Try `/api/mcp/mcp` only when the first canonical probe returns definitive HTTP 404/405 without a valid JSON-RPC response. Fall back from modern discovery to legacy `tools/list` on the same endpoint only for a valid HTTP 2xx RPC `-32601` method-not-found response.

The bridge labels catalog mode as `native-read-only-projection` or `curated-date-schema-fallback`, bridge mode as `read-only`, and endpoint mode as `canonical` or `compatibility`.

## Media workflow

1. Identify exactly one configured Seerr integration with a usable ID.
2. Call `integration_searchMediaRequests` with `integrationIds: [id]`.
3. Require a non-empty structured results array containing a `title` or `name` that exactly normalizes to the query.
4. Present and disambiguate the match, then stop pending confirmation.

The default bridge has no mutation path. It rejects media requests, app updates, and request decisions even after search or confirmation. Treat a future one-use, expiring, exact-result authorization bridge as separate work; never imply it is installed.
