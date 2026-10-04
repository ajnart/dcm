# Shared management authority review — 2026-10-03

Portainer account and durable API-key setup are source-backed. The missing
capability is an explicitly approved connection to a Docker environment, not a
login adapter. No manager recipe, socket mount, daemon configuration, or live
deployment was added during this read-only review.

## Existing implementation

- `selfhost/scripts/catalog.ts` skips validation of `capability:*` dependencies
  and only collects their names in `expandDependencies`. Consequently
  `capability:docker-api-boundary` is descriptive, not an implemented privilege
  approval or credential boundary.
- `selfhost-host/GUIDE.md` owns inspection only and prohibits socket mounts,
  reading SSH material, and host changes.
- `packages/cli/src/lib/shared-host-observation.ts` restricts shared deployment
  to the inspected local default/rootless context. Remote daemon observations
  cannot be substituted for local ownership evidence.
- `selfhost-compose/scripts/compose-project.ts` rejects Docker socket paths and
  protected mount namespaces. Its `secretRefs` can reference private files
  below the owned project's `secrets/` directory; this is a useful storage
  primitive, not approval to acquire or exercise host-control credentials.
- The setup transport already provides bounded bytes, exact write approvals,
  pre-send checkpoints, private sessions, and immutable private API-key storage.
  Reuse these; do not add another account/credential engine.

## Pinned Portainer evidence

For CE `2.39.4`, authenticated
`POST /api/users/{id}/tokens` takes a description and the internal account's
password. Only that same user may create its key; the response contains
`rawAPIKey` and key metadata. [Pinned create handler](https://raw.githubusercontent.com/portainer/portainer/2.39.4/api/http/handler/users/user_create_access_token.go)

`GET /api/users/{id}/tokens` returns metadata with the digest removed, not the
original key. Checkpoint before creation, save the plaintext privately once,
and reconcile inventory on replay. A lost unsaved response must stop rather
than create another key. [Pinned inventory handler](https://raw.githubusercontent.com/portainer/portainer/2.39.4/api/http/handler/users/user_get_access_tokens.go)

First-owner bootstrap can use `--admin-password-file`, which only initializes
the account and does not reset an existing password. The JWT from login must
remain a session, not the durable key. [Official CLI options](https://docs.portainer.io/advanced/cli)

The pinned endpoint-create handler accepts remote Docker URL, TLS configuration,
and multipart CA/client certificate/private-key files. Require TLS and both
verification flags false. [Pinned endpoint handler](https://raw.githubusercontent.com/portainer/portainer/2.39.4/api/http/handler/endpoints/endpoint_create.go)

## Smallest useful next boundary

Start with **adoption of an already provisioned, private, mutually authenticated
Docker TLS endpoint**, not daemon installation or a blanket socket exception.
The capability must bind target host identity, endpoint, CA/client identity,
opaque credential references, expiry, owner, allowed consumer, and exact
host-wide management authority into a reviewed plan and separate approval.
Provisioning/listener/firewall/certificate changes remain outside that plan.
Docker explicitly warns that client keys grant powerful host access.
[Docker daemon protection](https://docs.docker.com/engine/security/protect-access/)

An approved boundary record can then enable a real Portainer recipe: private UI,
owned `/data`, generated first-owner password, no host socket, pinned image,
and a setup adapter that privately imports TLS material into the endpoint API.
Inventory must reconcile endpoint identity and TLS policy before creation;
acceptance must prove the selected environment through authenticated bounded
Docker readback. Account/key success alone is not management acceptance.
Administrator API-key export needs explicit disclosure of equivalent authority.

Reuse `selfhost-compose` for project lifecycle and `selfhost-host` for observations.
A new application-independent authority owner needs its own internal GUIDE and
exact `references/catalog/skills.json` entry, rather than loosening the generic
renderer. Implementation seams are catalog boundary descriptors/schema/compiler,
`packages/cli/src/lib/shared-host-observation.ts`, private credential transport,
and `apps/portainer/{recipe.json,setup.ts,manifest.json}`. No automatic remote
context migration or daemon configuration is needed for this first boundary.

This does not unblock every manager: Coolify requires separately scoped host SSH
authority; Dockge requires daemon authority **and** exact writable stack-directory
ownership. WUD needs a different read-only Docker proxy policy, isolated network,
and explicit authority for the proxy's socket access. A read-only socket bind
does not make Docker API requests read-only. Do not reuse Portainer's management
grant for those distinct claims.
