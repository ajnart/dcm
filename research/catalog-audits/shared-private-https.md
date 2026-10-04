# Shared private HTTPS: reuse-first proposal

Reviewed 2026-10-03. Source-only; no deployment, tests, secret reads, or trust/DNS
changes. The coordinator identified the existing seven-app trial at
`/tmp/selfhost-homarr-stack-20260930.vbcN32` as lacking TLS. Its saved/runtime
files were deliberately not inspected; this note does not independently verify
its inventory, health, or ownership.

## Existing modules

- `selfhost-ingress/scripts/plan-ingress.ts` owns private bind, hostname,
  DNS/trust decisions and resource conflicts. `render-caddyfile.ts` aggregates
  compatible root-host routes with `tls internal`; reuse both unchanged where
  possible.
- `packages/cli/src/caddy-private.ts` already renders a bounded multi-route
  Caddy manifest, delegates Compose ownership, persists CA/config state, hashes
  review content, checkpoints before apply, locks lifecycle, exports the public
  CA root, and proves TLS with `curl --cacert --resolve`. Its checkpoint phase
  and hash machinery is reusable implementation, not client trust evidence.
- `vaultwarden-local-https.ts` adds fresh host/port inspection, a loopback
  high-port default, optional private LAN/DNS input, name-resolution observation,
  and a pre-app route whose 502 may still prove TLS. Keep Vaultwarden's DOMAIN,
  signup, and acceptance in its app adapter; do not copy this CLI per app.
- Shared ownership is `lib/shared-project-state.ts` plus
  `lib/shared-compose-project.ts`; setup's small `SetupOwner` interface is in
  `control-panel/setup-engine.ts`. There is no `shared-owner.ts` here.

## Exact missing interface

Add one shared HTTPS module at the **selection-to-owned-Compose seam**, not a
new app-name router. Conceptually:

`planPrivateHttps(sharedOwner, reviewedRoutes, hostFacts) -> candidate`

`inspectPrivateHttps(sharedOwner, savedRouteId) -> evidence`

The candidate contains the reviewed canonical origin, exact app/service/port,
private bind, Caddy image digest, route/config hash, CA public-certificate
reference/fingerprint, owner revision, and separate transport/DNS/client-trust
gates. Route approval binds these values. Existing shared apply/resume owns
mutation, checkpointing, and locking; no second public apply surface is needed.

Reuse Caddy's existing manifest/CA/proof implementation through this module.
For a one-Compose shared install, compile **one same-owner Caddy unit** serving
the selected app frontends, with persistent project-owned CA/config state and
no Docker socket. Never attach the existing standalone Caddy adapter by an
unrecorded `docker network connect`:

- `shared-unit-setup.ts:139-147` requires exact saved network membership; a
  foreign Caddy container on `front` breaks that check for existing apps.
- `shared-project-state.ts:77-88` freezes retained services/networks on add;
  `:155-186` permits only one environment-value transition. Neither authorizes
  arbitrary route mounts, network changes, or replacing an installed Caddy unit.
- `shared-compose-project.ts:96-104` puts every app frontend on `front`, and
  dependencies on app-specific networks. Keep Caddy off dependency networks;
  mark selected routes explicitly. Frontend sharing is not per-app network
  isolation. Stronger isolation needs its own reviewed manifest revision.

Therefore the missing shared state operation is narrowly reviewed HTTPS
infrastructure/config revision: preserve every unrelated unit, record Caddy
membership, retain old/new config hashes, checkpoint before write/recreate, and
inspect uncertain outcomes. Existing inert catalog Caddy cannot silently become
a proxy, and an already-owned external edge must be reported/reused only through
its exact approved ownership contract.

Setup transport also needs one owner-bound HTTPS target. Today
`control-panel/setup-transport.ts:182-187` accepts only the saved loopback HTTP
origin, and `:578` opens HTTP to 127.0.0.1. Keep adapter `context.http.request`
path-only: resolve the saved route internally, connect to the exact private
address, preserve hostname/SNI, verify its pinned CA and certificate, refuse
redirects, and bind approvals to route/owner revisions. Do not add arbitrary
URLs, caller-supplied CA paths, `rejectUnauthorized: false`, or global trust edits.

## Dependency order and remaining gaps

1. Inspect exact shared owner/listeners; select intended clients and app-valid
   hostname; obtain route/config approval and any separate DNS/trust authority.
2. Prepare reviewed Caddy route, persistent CA/config and canonical origin.
   A pre-app 502 proves transport only, not backend or account readiness.
3. Bind that origin into the app's documented environment/config before first
   startup; use shared private-file preparation, not credentials in plans.
4. Apply app and same-owner route through scoped shared lifecycle. Verify route
   delivery and run the app adapter using its owner-bound transport.
5. Verify actual client name resolution/trust, login/key readback and scoped
   restart persistence; aggregate these as distinct evidence.

Host-only `.localhost` can avoid managing private DNS, but resolution still needs
an actual host check. `--resolve` bypasses DNS; `--cacert` bypasses default trust.
CA export does not install trust on this host, browsers, phones, native clients,
or containers. LAN names require an owned private DNS mapping and client CA
trust; no automatic resolver/hosts/trust-store change is implied.

This does not unlock every TLS-sensitive recipe. Authelia's
[session contract](https://www.authelia.com/configuration/session/introduction/)
rejects `localhost` and requires an HTTPS URL/cookie domain suitable for public
CA issuance: do not synthesize `.localhost` or `.home.arpa` for it. It still needs
an owner-chosen eligible domain, policy/notifier/proxy ownership and a writable
secret-derived [user database](https://www.authelia.com/configuration/first-factor/file/).
Headscale still needs a client-reachable selected `server_url`, reviewed
[reverse-proxy protocol](https://headscale.net/stable/ref/integration/reverse-proxy/),
private one-time API-key capture and real enrollment/peer checks. A loopback-only
route cannot serve remote mesh clients. Pangolin's full tunnel authority remains
outside this private HTTPS module.

Recommendation: first extract the Caddy route/CA implementation behind the small
shared interface and prove a second TLS-sensitive adapter. Do not promote any
app merely because its proxy has a valid certificate.

## Implemented planning slice

`lib/shared-private-https.ts` now reuses the ingress planner, Caddy renderer and
shared add compiler. `app shared https-plan` is callable for installed apps of
one completed shared owner. It proposes one new same-owner Caddy, binds routes
to saved frontend/container ports, preserves other units, and uses only
host-only `.localhost` names and one observed free loopback high port. An
installed Caddy is left unchanged. Named `/config` and `/data` volumes remain
the proposed persistence; no unmounted host CA path is asserted.

Focused fixtures passed pure compilation, real Compose planning, saved-owner
CAS preservation, database rejection and command authority guards. A read-only
proposal against the existing trial resolved Homarr to container port7575 and
Immich to2283 with Compose status `pass`. No deployment or trust change ran.

The CLI returns `planning-only`, no apply token and all evidence false. Route
binding persistence/resume, CA export, owner-bound HTTPS setup, app-specific
proxy configuration, client trust and actual function/restart checks are still
missing. TCP frontend metadata does not prove an HTTP upstream. The current
HTTP Caddy setup adapter cannot verify this proposed TLS configuration. This
slice earns no live compatibility points and unlocks no TLS-sensitive recipe.
