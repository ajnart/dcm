# NetBird configuration boundary — 2026-10-03

Status: guided, unregistered. The app-local pure compiler freezes a reviewed
configuration candidate; it does not publish `recipe.json`, `setup.ts`, or a
derived-recipe registry entry. No Docker, service mutations, client enrollment,
TLS, password login, backup restore or restart acceptance was performed.

## Source and immutable candidate

[v0.80.0 installation source](https://raw.githubusercontent.com/netbirdio/netbird/v0.80.0/infrastructure_files/getting-started.sh)
still defaults server/dashboard to `latest`; dashboard has independent versions.
Public publisher metadata checked on this date supplies these multi-platform OCI
index pins, not a live compatibility assertion:

- [Server 0.80.0](https://hub.docker.com/v2/repositories/netbirdio/netbird-server/tags/0.80.0):
  `sha256:05b3d8d6d056e5062a2965d4d6e5d6d83f09f2bf9133947a8e5972e0e0e7a261`.
- [Dashboard v2.94.0](https://hub.docker.com/v2/repositories/netbirdio/dashboard/tags/v2.94.0):
  `sha256:70e0fc6dd3b7758148d182fb55ecd8d4f9ce01e9bba56c9389224e0b8354009d`.

`configuration.ts` requires exactly the canonical HTTPS FQDN origin (default
443), private IPv4 edge source address, and owner email. It rejects implicit
loopback identity, alternate scheme/port, credentials, URL paths, all-peer trust
and extra inputs. Dashboard endpoints, OAuth issuer/callbacks and exact `/32`
proxy trust derive from those choices. Its fingerprint binds choices, reviewed
pins, candidate recipe, private configuration declarations and pending claims.
Secrets remain private-file references; no payload enters public config.

The datastore [decoder](https://raw.githubusercontent.com/netbirdio/netbird/v0.80.0/util/crypt/crypt.go)
requires standard Base64 decoding to exactly 32 bytes. The embedded IdP
[session decoder](https://raw.githubusercontent.com/netbirdio/netbird/v0.80.0/management/server/idp/embedded.go)
also accepts that encoding. Shared `privateFiles.format: "base64"` now generates
actual random bytes and stores canonical padded encoding. Generation/resume and
private-config assembly enforce syntax, decoded byte count and exact re-encoding,
including unused padding bits. Direct `secretEnvironment` remains forbidden for
this format. It does not change URL-safe or `base64-prefixed` behavior.

## Exact seams still required

1. The shared recipe validator treats dashboard `AUTH_AUDIENCE`, `AUTH_CLIENT_ID`,
   `AUTH_AUTHORITY`, scopes and redirects as credential-named values. Promotion
   needs reviewed typed non-secret OIDC metadata provenance, not an arbitrary
   environment-name exception or weakening the generic secret guard.
2. Only the primary service may publish additional ports. NetBird needs both a
   private dashboard and a distinct combined-server HTTP frontend. Extend that
   ownership boundary explicitly; do not repurpose one published port for both.
3. The [official external edge](https://docs.netbird.io/selfhosted/external-reverse-proxy)
   must own HTTPS, HTTP API/OAuth, WebSocket relay/signal and native gRPC/h2c.
   Direct UDP 3478 is separate from HTTP/TLS. This compiler never installs a
   proxy, adopts another network, publishes public ports or grants a socket.
4. Keep one-time first-owner bootstrap separate from recipe preparation. The
   pinned [handler](https://raw.githubusercontent.com/netbirdio/netbird/v0.80.0/management/server/http/handlers/instance/instance_handler.go)
   exposes unauthenticated instance inspection and setup. The
   [setup service](https://raw.githubusercontent.com/netbirdio/netbird/v0.80.0/management/server/instance/setup_service.go)
   gates optional PAT creation with `NB_SETUP_PAT_ENABLED=true`; expiry defaults
   to one day (allowed 1–365). A future adapter must checkpoint before POST,
   privately save its one-time response before readback and refuse replay after
   ambiguity. PAT owner identity readback is not password-login proof. Expiry,
   rotation and independently proven login remain unimplemented, so no adapter
   is shipped.

Once those seams exist, register the bundled app-owned compiler through the
existing shared derived-recipe mechanism; its persisted source/selection/owner
binding must be reused, not replaced by a parallel NetBird state store. Keep
origin selection, exposure approval and TLS/client connectivity as distinct
claims. A compiled URL or a prepared config is none of those acceptance proofs.

## Focused validation

Bun 1.4.0 `packages/cli/tests/netbird-configuration.test.ts` passes pure
determinism/input rejection, encoding validation, actual 32-byte generation,
mode-0600 storage, unchanged inode/bytes on replay, no payload in candidate or
manifest, noncanonical same-byte rejection and direct-env rejection. The real
candidate deliberately fails current recipe validation at the recorded seams;
a narrowly neutralized fixture isolates the valid generic Base64 contract.
