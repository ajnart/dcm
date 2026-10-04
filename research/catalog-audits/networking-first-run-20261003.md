# Networking first-run boundaries — 2026-10-03

Implemented app-local compiler/helpers, not deployable recipes or setup adapters.
No Docker, browser, private runtime, CI, credentials, ingress, device/capability
grants, network adoption, commits or live acceptance. Support is unchanged.
Context7 resolved `/fosrl/pangolin` and fetched deployment/API documentation;
mutable indexed examples were checked against pinned publisher source before use.

## Implemented first

- `netbird/bootstrap.ts` produces the pinned private `POST /api/setup` request
  using the existing shared `SetupHttpRequest` wire shape. It requires actual
  boolean fresh-state/pre-send-attempt facts, validates saved credentials,
  requests a one-day PAT only when the reviewed server flag enables issuance,
  and refuses every replay after an attempted write. Its private response
  validator checks exact owner identity and expected PAT presence. The caller
  must save a returned token before any readback; no owner/password login,
  authenticated token readback, transport approval or checkpoint persistence is
  implemented by these pure helpers. They are not `setup.ts` discovery entries.
- `pangolin/configuration.ts` compiles selected canonical HTTPS and resource
  base-domain choices for explicit `local-only` mode. It reuses shared
  `exactHttpsOrigin`, existing `privateConfigs` literal/file-reference parts and
  generated alphanumeric files. Its fingerprint binds all selected values and
  candidate bytes, source/version and blockers. No server-secret payload enters
  the candidate. Gerbil's config hostname is retained because the pinned config
  schema still requires it; there is no Gerbil service, privilege or tunnel.
  Telemetry and raw resources are disabled explicitly. Private config readability,
  writable `/app/config` state, image digest and domain/TLS/edge ownership remain
  blockers. The app's separate frontends are dashboard 3002, external API 3000,
  private internal API 3001; a future edge must not expose the latter casually.
- ZeroTier now declares `frontend: none`, preventing an invented HTTP/Homarr
  tile. Its overlay role still requires separately reviewed device authority,
  chosen controller/network, membership authorization and real client routes.
  The publisher's unprivileged standalone-controller mode does not join
  networks and is not a substitute for an overlay client.

## Pinned first-owner/key/enrollment evidence

NetBird [v0.80.0 handler](https://raw.githubusercontent.com/netbirdio/netbird/v0.80.0/management/server/http/handlers/instance/instance_handler.go),
[JSON schema](https://raw.githubusercontent.com/netbirdio/netbird/v0.80.0/shared/management/http/api/types.gen.go)
and [setup service](https://raw.githubusercontent.com/netbirdio/netbird/v0.80.0/management/server/instance/setup_service.go)
define `GET /api/instance`, `POST /api/setup`, email/password/name and optional
`create_pat`/`pat_expire_in`, returning `user_id`, `email` and optional
`personal_access_token`. PAT issuance requires `NB_SETUP_PAT_ENABLED=true`;
default expiry is one day. The retained `configuration.ts` pins server 0.80.0
and independent dashboard v2.94.0 OCI indices. Its protocol-aware edge and direct
STUN requirements remain unchanged; localhost TLS is not the selected identity.
The pinned [manager validation](https://raw.githubusercontent.com/netbirdio/netbird/v0.80.0/management/server/instance/manager.go)
uses Go string length: passwords must contain 8–72 UTF-8 bytes, not JavaScript
code units. The request helper uses `Buffer.byteLength` after a string type guard;
the affected fixture covers ASCII and multibyte lower/upper boundaries and overflow.

Pangolin [1.24.0 Compose](https://raw.githubusercontent.com/fosrl/pangolin/1.24.0/install/config/docker-compose.yml),
[config](https://raw.githubusercontent.com/fosrl/pangolin/1.24.0/install/config/config.yml)
and [schema](https://raw.githubusercontent.com/fosrl/pangolin/1.24.0/server/lib/readConfigFile.ts)
support the reviewed configuration shape. The [external router](https://raw.githubusercontent.com/fosrl/pangolin/1.24.0/server/routers/external.ts)
under [API prefix](https://raw.githubusercontent.com/fosrl/pangolin/1.24.0/server/apiServer.ts)
registers `GET /api/v1/auth/initial-setup-complete`,
`POST /api/v1/auth/validate-setup-token`, `PUT /api/v1/auth/set-server-admin`
and `POST /api/v1/auth/login`. The [owner handler](https://raw.githubusercontent.com/fosrl/pangolin/1.24.0/server/routers/auth/setServerAdmin.ts)
accepts email/password/setupToken, atomically consumes an unused token and rejects
an existing server admin. Setup-complete only proves an admin exists; it does
not prove ownership. Root `PUT /api/v1/api-key` requires server-admin session
(non-SaaS build); org `PUT /api/v1/org/:orgId/api-key` needs org/action grants.
[Root-key creation](https://raw.githubusercontent.com/fosrl/pangolin/1.24.0/server/routers/apiKeys/createRootApiKey.ts)
returns the one-time `apiKey` plus `apiKeyId`. A setup token, session and durable
API key are separate identities. Newt `POST /api/v1/auth/newt/get-token` is an
enrollment credential route, not local-only acceptance. No connector is claimed.

ZeroTier [Docker guide](https://docs.zerotier.com/docker/) requires overlay-client
capabilities/device access, while its [controller explanation](https://docs.zerotier.com/what-is-a-controller/)
separately permits a controller without joining networks. The [local service API](https://docs.zerotier.com/api-service/)
is localhost-only by default with local token authentication; [Central](https://docs.zerotier.com/api-central/)
uses separately issued owner/service-account tokens. No current immutable official
container pin or shared controller setup was established; no tag is invented.

## Shared primitives, concrete examples and reuse boundary

| Primitive | Concrete source examples | Required boundary |
| --- | --- | --- |
| Canonical identity/config selection | NetBird issuer/redirects in pinned installer; Pangolin dashboard/CORS/base domain in pinned config | Reuse canonical-origin, private config and shared derived-recipe owners; register compilers only after remaining edge/frontend constraints work. Shared localhost HTTPS does not replace selected identity. |
| One-time bootstrap checkpoint and private output capture | NetBird setup response PAT; Pangolin setup-token consumption and root-key output | Shared setup transport approval + before-send checkpoint; bind exact owner/source; save one-time output immediately. Existing Frigate bootstrap-log capture is not a Pangolin token recognizer. Never replay ambiguous writes. |
| Explicit enrollment authority and private token provenance | NetBird owner PAT differs from peer enrollment; Pangolin Newt route differs from owner session; ZeroTier local token differs from Central | Keep owner inputs and secret files explicit. Reuse portless connector execution only for a proven unprivileged client; never authorize device/capability grants through it. |
| Intended-client and restart evidence | NetBird HTTP/WebSocket/gRPC plus UDP; Pangolin local proxy versus Gerbil tunnels; ZeroTier authorized membership and peer route | Shared acceptance aggregation records actual identity/client-path/persistence evidence, not dashboard status or enrollment-request success. |

## Focused validation

Bun 1.4.0 ran only `netbird-bootstrap.test.ts` and
`pangolin-configuration.test.ts`; both pass. Both new modules build with
`--target=bun --outfile=/dev/null`. Fixtures cover deterministic private wire
requests, strict fresh-state/replay refusal, identity/PAT validation, exact HTTPS
and domain rejection, secret references and fingerprint changes. Manifest JSON
parsing and focused diff checks pass. None of this proves fresh-instance API,
edge, owner login, enrollment, route, key lifecycle or restart acceptance.
