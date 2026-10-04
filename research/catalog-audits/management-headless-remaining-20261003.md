# Management headless remaining boundaries — 2026-10-03

No safe useful management recipe fits the existing shared engine for Portainer,
Dockge, Coolify, or WUD. This is not an unknown-login conclusion: pinned owner
routes are already documented. The missing feature is a separately approved
host-control or read-only inventory authority, with exact credential transport
and connection acceptance. No login-only recipe, fake no-account contract,
socket/SSH mount, daemon enrollment, or empty WUD dashboard was added. A concrete
pure review/approval-intent gate was added, but it cannot produce verified or
usable authority and does not yet connect any app.

Reused [fresh management review](../compose-catalog-management-20261003.md),
[fresh monitoring review](../compose-catalog-monitoring-20261003.md), and
[shared authority audit](shared-management-authority.md). Those contain checked
publisher tags and first-owner/token evidence. This pass additionally read WUD
9.1.0's pinned watcher registration and Docker watcher source; it did not repeat
image discovery or fetch credentials.

## Registry-only WUD is not a supported escape hatch

[Pinned registerWatchers](https://raw.githubusercontent.com/getwud/wud/9.1.0/app/registry/index.ts)
recognizes Docker, Kubernetes, Nomad, and Swarm providers. No configured watcher
creates a Docker-local watcher; an unrecognized legacy key is still interpreted
as a Docker watcher. Registry providers are a separate component kind, not an
image-list watcher. Thus configuring registry lookup/auth alone is not a
source-backed useful registry-only topology in 9.1.0.

[Pinned Docker watcher](https://raw.githubusercontent.com/getwud/wud/9.1.0/app/watchers/providers/docker/Docker.ts)
lists containers and inspects their images to produce watched inventory. It
accepts host/port and CA/certificate/key file settings for remote TLS. Defaults
include socket `/var/run/docker.sock`, `watchbydefault=true`, and Docker events
enabled. The events path also inspects containers; digest watching inspects local
images. Disabling events does not remove the container/image API requirement.
Registry update lookup therefore cannot replace this inventory authority.

## Smallest reusable first slice: provisioned private Docker mTLS adoption

The complete adoption capability below is a proposal, **not existing verified
permission**. The new `packages/cli/src/lib/docker-api-authority.ts` implements
only `planDockerApiAuthority` and `approveDockerApiAuthorityIntent`, with exact
`AUTHORITY-INTENT:<id>:<hash>` approval. It validates
canonical scoped input and an exact approval, returning `state: approved-intent`,
`authorityVerified: false`, and `usableForApplicationSetup: false`. It rejects
unknown fields including operator assertions of verification. Management-mode
consumers are currently Portainer, Dockge and Coolify; inventory mode is WUD.
It binds owner record/manifest hashes, consumer recipe/setup hashes, a nonempty
digest-pinned service-image inventory, expected engine/X509 identities,
distinct opaque credential IDs, expiry and mandatory disclosure. SHA-256 X509
identities mean lowercase hashes of DER certificate bytes, not PEM text or keys.
Its first slice accepts only explicitly selected RFC1918 IPv4 dial addresses
plus a valid TLS DNS server name; neither is DNS or TLS verification. The caller
must later compare these expected fields and the complete image inventory with
fresh trusted observations. Approval never claims the private endpoint was
adopted. It leaves local
Compose deployment bound to its current inspected owner. It does not switch the
CLI's Docker context, install an Agent, configure a listener/firewall, mint
certificates, or enroll a remote host.

The authority owner should accept one typed record with these fields:

| Field | Exact meaning |
| --- | --- |
| `schemaVersion`, `id`, `revision` | Stable authority identity and optimistic-concurrency revision. |
| `projectOwnerSha256`, `consumerAppId`, `consumerRecipeSha256`, `consumerSetupSha256` | Bind permission to one saved shared owner and one executable consumer, not every selected app. |
| `mode` | Distinct `docker-management-mtls` or `docker-inventory-mtls`; never infer read-only authority from a TLS certificate. |
| `endpointHost`, `endpointPort`, `serverName` | Owner-provisioned private endpoint and verified TLS name. Reject URL credentials, Unix sockets, public resolution, redirects, and disabled verification. |
| `expectedEngineId`, `peerCertificateSha256`, `caCertificateSha256`, `clientCertificateSha256` | Compare inspected target and TLS peer with reviewed identity on apply/resume. Certificates themselves remain at the private boundary. |
| `caFileRef`, `clientCertificateFileRef`, `clientKeyFileRef` | Exact owner-issued, mode-0600 files imported once with bounded sizes. Never acquire keys by searching the host. |
| `notAfter`, `observedAt`, `observationSha256` | Bound expiry and freshness; reinspection invalidates authority when peer, engine, credentials, consumer, or recipe changes. |
| `authorizationPolicySha256` | Required for inventory mode: identity of separately provisioned deny-write proxy/authorization policy, not a self-asserted client flag. |

Use a separate exact `AUTHORITY-ADOPT:<id>:<hash>` approval binding the complete
record and explicit disclosure that management-mode Docker client keys convey
host-wide Docker authority. APP/shared apply approval is not a substitute.
[Docker's warning](https://docs.docker.com/engine/security/protect-access/)
supports this distinction. Ordinary status may expose identity, references,
digests, expiry, and sanitized evidence, never credential bytes. Do not silently
reuse a Portainer management grant for WUD inventory access.

The generic recipe compiler must fail closed if a selected authority descriptor
is absent, stale, mismatched, or unapproved. An application-independent internal
authority workflow and sorted registry entry should own review/adoption and
fresh observations; `selfhost-host` remains read-only inspection and
`selfhost-compose` retains the local project mutation boundary. No app-folder
exception should relax protected mounts or remote-context rejection.

## Portainer consumer and narrow transport seam

After authority adoption, a socket-free Portainer CE 2.45.1 recipe can use owned
`/data`, a private UI, and generated first-admin password passed with the sourced
`--admin-password-file` argument (a path, not a password).
[Pinned endpoint handler](https://github.com/portainer/portainer/blob/2.45.1/api/http/handler/endpoints/endpoint_create.go)
requires multipart `Name`, `EndpointCreationType=1`, `URL`, `TLS=true`,
`TLSSkipVerify=false`, `TLSSkipClientVerify=false`, and private file fields
`TLSCACertFile`, `TLSCertFile`, `TLSKeyFile` for the selected Docker TLS topology.
The URL must be explicit: an omitted URL defaults to the host socket.

Existing `SetupContext.http` accepts bounded raw bytes but exposes no approved
authority-file reader/importer. Add a **typed, source-pinned multipart binding**
that takes validated authority ID plus the three field/reference mappings and
lets the transport read private bytes only after exact approval. Fix the
multipart boundary per saved intent so approval hashes remain stable. Keep bytes
out of inputs, checkpoints, progress, argv, and the adapter's returned record.
Do not add arbitrary filesystem reads or relax loopback HTTP: the request goes
to Portainer's already saved loopback origin; Portainer connects to the approved
endpoint.

First inspect endpoint inventory and compare exact URL/name/type/TLS policy.
Checkpoint before creation, capture returned endpoint ID, then compare authenticated
endpoint inventory and bounded Docker engine identity against the adopted record.
On uncertain response, inspect inventory; never blindly POST again. An equivalent
name with different endpoint/peer/policy is a conflict, not permission to adopt.
No server-login or key success should return management-ready without this check.
Durable administrator token creation then uses existing private sessions,
one-time checkpoint, immutable `writeApiKey`, and inventory/readback semantics;
administrator-equivalent key handoff remains explicitly disclosed.

## WUD consumer and read-only proof

WUD can reuse **inventory-mode** private mTLS adoption only when the owner has
already provisioned an authorization boundary that denies mutations. Mutual TLS
against an unrestricted Docker daemon is not least privilege. Pin the upstream
operations needed by the selected watcher configuration, prove they succeed,
and obtain denial evidence from the separately owned policy's isolated fixture;
do not issue a potentially successful destructive probe against a live daemon.
Required inventory covers container listing and image inspect; container inspect
and events are needed when events remain enabled. Source-backed configuration
must bind exact host/port/CA/certificate/key file settings and disable update
triggers. Do not substitute a direct socket or a `:ro` bind.

The existing generated-password/secret-environment primitive fits
`WUD_AUTH_ADMIN_USER` / `WUD_AUTH_ADMIN_PASSWORD`, but its manifest must continue
to disclose that bootstrap **updates the matching administrator on startup**.
Headless acceptance needs exact authenticated administrator identity, anonymous
denial, nonempty selected watched inventory, and a registry lookup/update fixture
without invoking an update. Restart persistence remains separate. Homarr's pinned
WUD client reads `/api/containers` using saved Basic username/password; it does
not require a personal token. Token GET verification mutates `lastUsedAt` and
must not be silently treated as read-only.

## Distinct remaining manager boundaries

- **Dockge 1.5.0:** management authority plus exact writable stacks-tree ownership
  (same absolute host/container path), import policy, and no unmanaged-stack
  adoption. Its pinned Socket.IO `setup`/`login` events need a typed checkpointed
  app-event transport; current `socketio-control` only permits namespace-connect
  and pong. Login JWT is not a durable API key.
- **Coolify 4.3.23:** exact SSH account, pinned host key, private key reference,
  selected-host resources and install ownership, with separate host-wide approval.
  Production Compose does not require the Docker socket, but the production
  seeder imports SSH identity, creates localhost, and schedules proxy/Sentinel
  work. Four containers without that authority are not useful safe acceptance.
  The existing reviewed source identifies root seeding and scoped Sanctum tokens;
  a read-only Homarr token does not approve SSH or public proxy/DNS/TLS work.

## Changes and validation

WUD manifest facts, the pure Docker authority-intent module, its focused fixture,
and this note changed. No recipe/setup adapter can be
truthfully added before the shared authority and private multipart seams exist;
there is consequently no new app adapter. No Docker,
app apply, image pulls, remote enrollment, live account checks, browser, broad
broad tests, commits, push, or CI were performed. Owned-file `git diff --check`
passed. Bun 1.4 ran only `packages/cli/tests/docker-api-authority.test.ts`, built
only the changed module to `/dev/null`, parsed the changed WUD manifest and
checked the added pinned watcher evidence URL. These are pure/source checks,
not full catalog validation, network verification or application acceptance.
